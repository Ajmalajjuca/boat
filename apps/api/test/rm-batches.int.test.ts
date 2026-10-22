import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, lotBody, makeRecordsWorld, type RecordsWorld, testApp } from './support/fixtures'

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

type Signed = RecordsWorld['planner']
// A lot tracked by PCB and Enclosure, owned by the world's POC unless told otherwise.
const componentLot = async (overrides: Record<string, unknown> = {}) =>
  (
    await w.planner.send(
      'post',
      '/api/v1/lots',
      lotBody(w, {
        rmMode: 'components',
        componentIds: [w.lookups.pcb.id, w.lookups.enclosure.id],
        pocId: w.lookups.pocA.id,
        ...overrides,
      }),
    )
  ).body as { id: string; version: number }
const addBatch = (user: Signed, lotId: string, body: Record<string, unknown>) =>
  user.send('post', `/api/v1/lots/${lotId}/rm-batches`, {
    componentId: w.lookups.pcb.id,
    label: 'B1',
    ...body,
  })
const detail = async (id: string) => (await w.admin.agent.get(`/api/v1/lots/${id}`)).body
const history = async (lotId: string) =>
  (
    await db.activityLog.findMany({
      where: { entityId: lotId, kind: 'material' },
      orderBy: { createdAt: 'asc' },
    })
  ).map((h) => h.message)

describe('adding batches', () => {
  it('FR-3.2 records component, label, planned and received quantities and dates, status and notes', async () => {
    const lot = await componentLot()
    const res = await addBatch(w.planner, lot.id, {
      label: ' B1 ',
      plannedQty: 100,
      plannedDate: '2026-10-10',
      receivedQty: 70,
      receivedDate: '2026-10-12',
      status: 'Partial',
      notes: 'Short shipped',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      lotId: lot.id,
      component: { id: w.lookups.pcb.id, value: 'PCB' },
      label: 'B1',
      plannedQty: 100,
      plannedDate: '2026-10-10',
      receivedQty: 70,
      receivedDate: '2026-10-12',
      status: 'Partial',
      notes: 'Short shipped',
    })
    expect((await detail(lot.id)).rmBatches).toHaveLength(1)
    expect(await history(lot.id)).toEqual(['Added PCB batch B1 (70 received)'])
  })
  it('FR-3.2 refuses a received date in the future and generates a blank label', async () => {
    const lot = await componentLot()
    // The test clock says 15 Oct 2026.
    const future = await addBatch(w.planner, lot.id, { receivedQty: 5, receivedDate: '2026-10-16' })
    expect(future.status).toBe(422)
    expect(future.body.fields).toEqual({ receivedDate: 'Received date cannot be in the future.' })
    const blank = await addBatch(w.planner, lot.id, { label: ' ' })
    expect(blank.status).toBe(201)
    expect(blank.body.label).toMatch(/^RM-\d{6,}$/)
    expect((await addBatch(w.planner, lot.id, { receivedDate: '2026-10-15' })).status).toBe(201)
  })
  it('FR-3.1 takes batches only on lots tracked by component', async () => {
    const lot = await componentLot({ rmMode: 'all', componentIds: [] })
    const res = await addBatch(w.planner, lot.id, {})
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      form: 'Switch the lot to Track by Component before adding batches.',
    })
  })
  it("FR-3.3 needs the batch's component to be selected on the lot", async () => {
    const lot = await componentLot({ componentIds: [w.lookups.enclosure.id] })
    const res = await addBatch(w.planner, lot.id, { componentId: w.lookups.pcb.id })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ componentId: 'Select this component on the lot first.' })
  })
  it('lets a POC add batches on their own lots only, and viewers never', async () => {
    const own = await componentLot()
    expect((await addBatch(w.poc, own.id, {})).status).toBe(201)
    const theirs = await componentLot({ pocId: w.lookups.pocB.id })
    const res = await addBatch(w.poc, theirs.id, {})
    expect(res.status).toBe(403)
    expect(res.body.message).toBe(
      "POC profiles can't edit lots owned by Rohit Mehta. Ask an admin.",
    )
    expect((await addBatch(w.viewer, own.id, {})).status).toBe(403)
  })
})

describe('RM readiness', () => {
  it('FR-3.4 producible is the smallest received total across components, capped at lot quantity', async () => {
    const lot = await componentLot({ lotQty: 100 })
    await addBatch(w.planner, lot.id, { componentId: w.lookups.pcb.id, receivedQty: 70 })
    await addBatch(w.planner, lot.id, {
      componentId: w.lookups.pcb.id,
      label: 'B2',
      receivedQty: 50,
    })
    await addBatch(w.planner, lot.id, { componentId: w.lookups.enclosure.id, receivedQty: 80 })
    expect((await detail(lot.id)).computed.rm).toEqual({
      producible: 80,
      bottleneck: 'Enclosure',
      percent: 80,
      complete: false,
    })
    await addBatch(w.planner, lot.id, {
      componentId: w.lookups.enclosure.id,
      label: 'B3',
      receivedQty: 40,
    })
    expect((await detail(lot.id)).computed.rm).toEqual({
      producible: 100,
      bottleneck: 'Enclosure',
      percent: 100,
      complete: true,
    })
  })
})

describe('editing and deleting batches', () => {
  it('edits a batch and records the change', async () => {
    const lot = await componentLot()
    const added = await addBatch(w.poc, lot.id, { receivedQty: 70 })
    const res = await w.poc.send('patch', `/api/v1/rm-batches/${added.body.id}`, {
      receivedQty: 90,
    })
    expect(res.status).toBe(200)
    expect(res.body.receivedQty).toBe(90)
    expect(await history(lot.id)).toEqual([
      'Added PCB batch B1 (70 received)',
      'Updated PCB batch B1 (90 received)',
    ])
  })
  it('FR-3.3 refuses moving a batch to a component the lot has not selected', async () => {
    const lot = await componentLot({ componentIds: [w.lookups.pcb.id] })
    const added = await addBatch(w.planner, lot.id, {})
    const res = await w.planner.send('patch', `/api/v1/rm-batches/${added.body.id}`, {
      componentId: w.lookups.enclosure.id,
    })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ componentId: 'Select this component on the lot first.' })
  })
  it('needs deleteEntries to delete, then leaves the batch out of the lot', async () => {
    const lot = await componentLot()
    const added = await addBatch(w.poc, lot.id, {})
    expect((await w.poc.send('delete', `/api/v1/rm-batches/${added.body.id}`)).status).toBe(403)
    expect((await w.planner.send('delete', `/api/v1/rm-batches/${added.body.id}`)).status).toBe(204)
    expect((await detail(lot.id)).rmBatches).toEqual([])
    expect(await history(lot.id)).toContain('Deleted PCB batch B1')
    expect(
      (await w.planner.send('patch', `/api/v1/rm-batches/${added.body.id}`, { receivedQty: 1 }))
        .status,
    ).toBe(404)
  })
  it('answers 404 for a lot or batch that is gone', async () => {
    const lot = await componentLot()
    await w.admin.send('delete', `/api/v1/lots/${lot.id}`)
    expect((await addBatch(w.planner, lot.id, {})).status).toBe(404)
    const missing = '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90'
    expect(
      (await w.planner.send('patch', `/api/v1/rm-batches/${missing}`, { receivedQty: 1 })).status,
    ).toBe(404)
  })
})
