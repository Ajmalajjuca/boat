import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { refreshCompletion } from '../src/modules/lots/lot-lock'
import { createTestDatabase } from './support/db'
import {
  day,
  fixedNow,
  lotBody,
  makeLookup,
  makeLot,
  makeProduct,
  makeRecordsWorld,
  type RecordsWorld,
  testApp,
} from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
})
afterAll(() => close())

const create = (overrides: Record<string, unknown> = {}) =>
  w.planner.send('post', '/api/v1/lots', lotBody(w, overrides))
const detail = async (id: string) => (await w.admin.agent.get(`/api/v1/lots/${id}`)).body

describe('creating lots', () => {
  it('FR-2.1 a planner creates a lot for a product and gets its detail back', async () => {
    const res = await create({ label: ' Lot 1 ' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      version: 1,
      label: 'Lot 1',
      product: { id: w.product.id, name: 'Soundbar', variant: 'X1' },
      category: { id: w.lookups.bau.id, value: 'BAU' },
      status: { id: w.lookups.onTrack.id, value: 'On Track' },
      rmMode: 'all',
      lotQty: 100,
      rmBatches: [],
      grnReceipts: [],
      access: 'full',
      computed: { grnTotal: 0, balance: 100, completed: false },
    })
  })
  it('FR-2.1 keeps labels unique within a product, ignoring case', async () => {
    await create({ label: 'Lot 7' })
    const twin = await create({ label: 'LOT 7' })
    expect(twin.status).toBe(422)
    expect(twin.body.fields).toEqual({ label: 'This product already has a lot labelled LOT 7.' })
    const other = await makeProduct(db)
    expect((await create({ label: 'Lot 7', productId: other.id })).status).toBe(201)
  })
  it('FR-2.2 records every lot field and returns dropdowns as { id, value }', async () => {
    const res = await create({
      categoryId: w.lookups.npi.id,
      directFg: true,
      emsId: w.lookups.ems.id,
      pocId: w.lookups.pocA.id,
      statusId: w.lookups.delayed.id,
      rmMode: 'components',
      componentIds: [w.lookups.pcb.id, w.lookups.enclosure.id],
      lotQty: 500,
      freshProductionQty: 120,
      reworkQty: 20,
      reworkReason: 'Solder ',
      rmReadyDate: '2026-10-16',
      plannedDate: '2026-10-20',
      revisedEta: '2026-10-24',
      actualDate: '',
      logisticsId: w.lookups.road.id,
      blockerId: w.lookups.rmBlocker.id,
      blockerDescription: 'Waiting on PCBs',
      followUpDate: '2026-10-16',
      followUpNote: 'Call supplier',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      category: { value: 'NPI' },
      directFg: true,
      ems: { value: 'Orion EMS' },
      poc: { value: 'Maya Shah' },
      components: [
        { id: w.lookups.enclosure.id, value: 'Enclosure' },
        { id: w.lookups.pcb.id, value: 'PCB' },
      ],
      freshProductionQty: 120,
      reworkQty: 20,
      reworkReason: 'Solder',
      rmReadyDate: '2026-10-16',
      plannedDate: '2026-10-20',
      revisedEta: '2026-10-24',
      actualDate: null,
      logistics: { value: 'Road' },
      blocker: { value: 'RM Blocker' },
      blockerDescription: 'Waiting on PCBs',
      followUpDate: '2026-10-16',
      followUpNote: 'Call supplier',
    })
  })
  it('FR-2.3 needs whole quantities of zero or more, with rework within fresh production', async () => {
    const cases: [Record<string, unknown>, Record<string, string>][] = [
      [{ lotQty: -1 }, { lotQty: 'Lot quantity must be a whole number, zero or more.' }],
      [{ lotQty: 2.5 }, { lotQty: 'Lot quantity must be a whole number, zero or more.' }],
      [
        { freshProductionQty: 10, reworkQty: 11 },
        { reworkQty: 'Rework is part of fresh production, so it cannot be larger.' },
      ],
    ]
    for (const [overrides, fields] of cases) {
      const res = await create(overrides)
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual(fields)
    }
  })
  it('refuses impossible dates and quantities Postgres cannot hold, with field errors', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ plannedDate: '2026-02-30' }, 'plannedDate'],
      [{ revisedEta: '20/10/2026' }, 'revisedEta'],
      [{ lotQty: 3_000_000_000 }, 'lotQty'],
      [{ lotQty: '100' }, 'lotQty'],
      // validateLot checks readyQty only in "all received" mode; the shape check covers both.
      [{ rmMode: 'components', readyQty: -5 }, 'readyQty'],
      [{ rmMode: 'components', readyQty: 2.5 }, 'readyQty'],
    ]
    for (const [overrides, field] of cases) {
      const res = await create(overrides)
      expect(res.status).toBe(422)
      expect(Object.keys(res.body.fields)).toEqual([field])
    }
  })
  it('FR-8.3 refuses dropdown ids that are not an active value of the right kind', async () => {
    const deleted = await makeLookup(db, 'stage')
    await db.lookupValue.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
    const cases: [Record<string, unknown>, Record<string, string>][] = [
      [{ statusId: w.lookups.segment.id }, { statusId: 'Choose an overall status from the list.' }],
      [{ stageId: deleted.id }, { stageId: 'Choose a stage from the list.' }],
      [
        { pocId: '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90' },
        { pocId: 'Choose a point of contact from the list.' },
      ],
      [{ componentIds: [w.lookups.ems.id] }, { componentIds: 'Choose components from the list.' }],
      [
        { productId: '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90' },
        { productId: 'This product no longer exists. Choose another.' },
      ],
    ]
    for (const [overrides, fields] of cases) {
      const res = await create(overrides)
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual(fields)
    }
  })
  it('FR-3.1 tracks RM as one ready quantity or by component, and keeps the kit out of component mode', async () => {
    const all = await create({ rmMode: 'all', readyQty: 40 })
    expect(all.body.computed.rm).toEqual({
      producible: 40,
      bottleneck: 'Kit (All Together)',
      percent: 40,
      complete: false,
    })
    const kit = await create({ rmMode: 'components', componentIds: [w.lookups.kit.id] })
    expect(kit.status).toBe(422)
    expect(kit.body.fields).toEqual({
      componentIds:
        'Kit is an alternative to individual components. Use All RM Received mode for a kit.',
    })
  })
  it('refuses unknown fields rather than ignoring them', async () => {
    const res = await create({ status: 'Delayed' })
    expect(res.status).toBe(422)
    expect(Object.keys(res.body.fields)).toEqual(['form'])
  })
  it('lets only admins and planners create lots', async () => {
    for (const user of [w.poc, w.viewer]) {
      const res = await user.send('post', '/api/v1/lots', lotBody(w))
      expect(res.status).toBe(403)
    }
  })
})

describe('the lot detail', () => {
  it('FR-2.7 carries the one-line status in the client format', async () => {
    const created = await create({
      statusId: w.lookups.delayed.id,
      plannedDate: '2026-10-15',
      revisedEta: '2026-10-16',
      blockerId: w.lookups.rmBlocker.id,
    })
    // The test clock says 15 Oct 2026.
    expect(created.body.computed.summary).toBe('Delayed, 1d left — RM Blocker (Factory Production)')
  })
  it('FR-8.1 shows a renamed dropdown value at once', async () => {
    const created = await create({ logisticsId: w.lookups.road.id })
    await w.admin.send('patch', `/api/v1/lookups/${w.lookups.road.id}`, { value: 'Road freight' })
    expect((await detail(created.body.id)).logistics.value).toBe('Road freight')
    await w.admin.send('patch', `/api/v1/lookups/${w.lookups.road.id}`, { value: 'Road' })
  })
  it('lets every signed-in role read a lot, and answers 404 for none', async () => {
    const created = await create()
    for (const user of [w.poc, w.viewer])
      expect((await user.agent.get(`/api/v1/lots/${created.body.id}`)).status).toBe(200)
    expect((await request(app).get(`/api/v1/lots/${created.body.id}`)).status).toBe(401)
    expect(
      (await w.admin.agent.get('/api/v1/lots/6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90')).status,
    ).toBe(404)
  })
})

describe('editing lots', () => {
  it('saves a change, moves the version on and records which fields changed', async () => {
    const created = await create({ plannedDate: '2026-10-20' })
    const res = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, {
      lotQty: 150,
      plannedDate: '2026-10-25',
      version: 1,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ lotQty: 150, plannedDate: '2026-10-25', version: 2 })
    const history = await db.activityLog.findMany({
      where: { entityId: created.body.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(history.map((h) => [h.kind, h.message, h.actorName])).toEqual([
      ['created', `Lot ${created.body.label} created`, 'Test planner'],
      ['updated', 'Updated lot qty, planned date', 'Test planner'],
    ])
    expect(history[1].changes).toEqual({
      lotQty: [100, 150],
      plannedDate: ['2026-10-20', '2026-10-25'],
    })
  })
  it('answers a stale version with 409 and the lot as it now stands', async () => {
    const created = await create()
    await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, { lotQty: 120, version: 1 })
    const stale = await w.admin.send('patch', `/api/v1/lots/${created.body.id}`, {
      lotQty: 130,
      version: 1,
    })
    expect(stale.status).toBe(409)
    expect(stale.body.current).toMatchObject({ lotQty: 120, version: 2 })
  })
  it('lets a POC update progress on their own lots, but not plan fields', async () => {
    const own = await create({ pocId: w.lookups.pocA.id })
    const progress = await w.poc.send('patch', `/api/v1/lots/${own.body.id}`, {
      statusId: w.lookups.delayed.id,
      freshProductionQty: 30,
      followUpDate: '2026-10-18',
      version: 1,
    })
    expect(progress.status).toBe(200)
    const plan = await w.poc.send('patch', `/api/v1/lots/${own.body.id}`, {
      lotQty: 90,
      version: 2,
    })
    expect(plan.status).toBe(403)
    expect(plan.body.message).toBe(
      "POC profiles can't change plan fields such as product, lot quantity, planned date, or POC. Ask an admin.",
    )
  })
  it("refuses a POC on another POC's lot and viewers on any lot", async () => {
    const theirs = await create({ pocId: w.lookups.pocB.id })
    const poc = await w.poc.send('patch', `/api/v1/lots/${theirs.body.id}`, {
      followUpNote: 'x',
      version: 1,
    })
    expect(poc.status).toBe(403)
    expect(poc.body.message).toBe(
      "POC profiles can't edit lots owned by Rohit Mehta. Ask an admin.",
    )
    const viewer = await w.viewer.send('patch', `/api/v1/lots/${theirs.body.id}`, {
      followUpNote: 'x',
      version: 1,
    })
    expect(viewer.status).toBe(403)
  })
  it('FR-2.4 keeps lot quantity at or above the GRN already received', async () => {
    const created = await create({ lotQty: 100 })
    await db.grnReceipt.create({
      data: { lotId: created.body.id, label: 'G1', date: day('2026-10-10'), quantity: 60 },
    })
    await refreshCompletion(db, created.body.id)
    const res = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, {
      lotQty: 50,
      version: 1,
    })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      lotQty: 'Lot quantity cannot be below the 60 units already received.',
    })
    expect(
      (await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, { lotQty: 60, version: 1 }))
        .status,
    ).toBe(200)
    expect((await detail(created.body.id)).completedOn).toBe('2026-10-10')
  })
  it('FR-3.3 keeps a component selected while it has batches', async () => {
    const created = await create({
      rmMode: 'components',
      componentIds: [w.lookups.pcb.id, w.lookups.enclosure.id],
    })
    await db.rmBatch.create({
      data: { lotId: created.body.id, componentId: w.lookups.pcb.id, label: 'B1', receivedQty: 10 },
    })
    const res = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, {
      componentIds: [w.lookups.enclosure.id],
      version: 1,
    })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      componentIds:
        'PCB still has material batches. Keep the component selected or delete its batches first.',
    })
    const dropEnclosure = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, {
      componentIds: [w.lookups.pcb.id],
      version: 1,
    })
    expect(dropEnclosure.body.components).toEqual([{ id: w.lookups.pcb.id, value: 'PCB' }])
  })
})

describe('component choices and batches', () => {
  it('FR-3.3 keeps batches tied to selected components through a switch to all-received and back', async () => {
    const created = await create({ rmMode: 'components', componentIds: [w.lookups.pcb.id] })
    await db.rmBatch.create({
      data: { lotId: created.body.id, componentId: w.lookups.pcb.id, label: 'B1', receivedQty: 10 },
    })
    const toAll = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, {
      rmMode: 'all',
      componentIds: [],
      version: 1,
    })
    expect(toAll.status).toBe(200)
    const back = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, {
      rmMode: 'components',
      version: 2,
    })
    expect(back.status).toBe(422)
    expect(back.body.fields).toEqual({
      componentIds:
        'PCB still has material batches. Keep the component selected or delete its batches first.',
    })
  })
})

describe('deleting lots', () => {
  it('soft-deletes the lot and its entries; only admins may', async () => {
    const created = await create()
    await db.grnReceipt.create({
      data: { lotId: created.body.id, label: 'G1', date: day('2026-10-10'), quantity: 5 },
    })
    expect((await w.planner.send('delete', `/api/v1/lots/${created.body.id}`)).status).toBe(403)
    expect((await w.admin.send('delete', `/api/v1/lots/${created.body.id}`)).status).toBe(204)
    expect((await w.admin.agent.get(`/api/v1/lots/${created.body.id}`)).status).toBe(404)
    const receipt = await db.grnReceipt.findFirstOrThrow({ where: { lotId: created.body.id } })
    expect(receipt.deletedAt).not.toBeNull()
    expect(
      (await w.admin.send('patch', `/api/v1/lots/${created.body.id}`, { lotQty: 1, version: 1 }))
        .status,
    ).toBe(404)
  })
})

describe('date rules', () => {
  // The test clock says 15 Oct 2026.
  it('FR-11.1 refuses a forecast date before today and an actual date after it', async () => {
    const res = await create({ plannedDate: '2026-10-14', actualDate: '2026-10-16' })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      plannedDate: 'Planned completion cannot be before today.',
      actualDate: 'Actual date cannot be in the future.',
    })
  })
  it('FR-11.1 keeps a past planned date that the edit does not touch', async () => {
    // Seeded directly, so no rule ran when the planned date was set.
    const lot = await makeLot(db, { productId: w.product.id, plannedDate: day('2026-09-01') })
    const res = await w.planner.send('patch', `/api/v1/lots/${lot.id}`, {
      version: lot.version,
      plannedDate: '2026-09-01',
      blockerDescription: 'waiting on PCB',
    })
    expect(res.status).toBe(200)
    const moved = await w.planner.send('patch', `/api/v1/lots/${lot.id}`, {
      version: lot.version + 1,
      plannedDate: '2026-09-02',
    })
    expect(moved.body.fields).toEqual({ plannedDate: 'Planned completion cannot be before today.' })
  })
})
