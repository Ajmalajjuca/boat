import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import {
  fixedNow,
  makeLookup,
  makeProduct,
  makeRecordsWorld,
  type RecordsWorld,
  shipmentBody,
  testApp,
} from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
let atSea: { id: string; value: string }
let arrivedStage: { id: string; value: string }

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  atSea = await makeLookup(db, 'shipmentStage', 'At Sea')
  arrivedStage = await makeLookup(db, 'shipmentStage', 'Arrived at Warehouse')
})
afterAll(() => close())

type Body = Record<string, unknown>
const create = (overrides: Body = {}) =>
  w.planner.send('post', '/api/v1/shipments', shipmentBody(w, overrides))
const edit = (id: string, body: Body) => w.planner.send('patch', `/api/v1/shipments/${id}`, body)
const detail = async (id: string) => (await w.viewer.agent.get(`/api/v1/shipments/${id}`)).body
const history = async (id: string) =>
  (await db.activityLog.findMany({ where: { entityId: id }, orderBy: { createdAt: 'asc' } })).map(
    (h) => h.message,
  )

describe('creating shipments', () => {
  it('FR-6.1 records number, vessel, dates, stage, remarks and lines', async () => {
    const res = await create({ number: ' INV-100 ', stageId: atSea.id, remarks: 'Fragile ' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      version: 1,
      number: 'INV-100',
      vessel: 'MSC Aurora',
      etd: '2026-09-26',
      plannedEta: '2026-10-20',
      revisedEta: null,
      actualArrival: null,
      stage: { id: atSea.id, value: 'At Sea' },
      remarks: 'Fragile',
      items: [{ product: { id: w.product.id, name: 'Soundbar', variant: 'X1' }, quantity: 100 }],
      etaRevisions: [],
      computed: {
        totalQty: 100,
        currentEta: '2026-10-20',
        status: 'At Sea',
        flags: { open: true, arrived: false },
      },
    })
    expect(await history(res.body.id)).toEqual(['Shipment INV-100 created'])
  })
  it('FR-6.1 keeps shipment numbers unique, ignoring case', async () => {
    await create({ number: 'INV-200' })
    const twin = await create({ number: 'inv-200' })
    expect(twin.status).toBe(422)
    expect(twin.body.fields).toEqual({ number: 'Shipment inv-200 already exists.' })
  })
  it('FR-6.2 needs at least one line, each above zero, each product once', async () => {
    const none = await create({ items: [] })
    expect(none.body.fields).toEqual({ items: 'Add at least one product line.' })
    const zero = await create({ items: [{ productId: w.product.id, quantity: 0 }] })
    expect(zero.body.fields).toEqual({ 'items.0.quantity': 'Must be more than zero.' })
    const twice = await create({
      items: [
        { productId: w.product.id, quantity: 1 },
        { productId: w.product.id, quantity: 2 },
      ],
    })
    expect(twice.status).toBe(422)
    expect(twice.body.fields).toEqual({
      'items.0.productId': 'This product is already on another line. Combine the quantities.',
      'items.1.productId': 'This product is already on another line. Combine the quantities.',
    })
  })
  it('refuses a line for a product that no longer exists', async () => {
    const gone = await makeProduct(db)
    await db.product.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
    const res = await create({ items: [{ productId: gone.id, quantity: 5 }] })
    expect(res.body.fields).toEqual({ 'items.0.productId': 'This product no longer exists.' })
  })
  it('FR-6.3 refuses ETAs or arrival before the ETD, and arrival in the future', async () => {
    const early = await create({ plannedEta: '2026-09-20' })
    expect(early.body.fields).toEqual({ plannedEta: 'Planned ETA cannot be before ETD.' })
    // The test clock says 15 Oct 2026.
    const future = await create({ actualArrival: '2026-10-16' })
    expect(future.body.fields).toEqual({ actualArrival: 'Arrival cannot be in the future.' })
  })
  it('lets only planners and admins create shipments', async () => {
    for (const user of [w.poc, w.viewer])
      expect((await user.send('post', '/api/v1/shipments', shipmentBody(w))).status).toBe(403)
  })
})

describe('status', () => {
  it('FR-6.3 counts a shipment as arrived only once it has an actual arrival date', async () => {
    const created = await create({ stageId: arrivedStage.id })
    expect(created.body.computed.flags).toMatchObject({ arrived: false, open: true })
    const res = await edit(created.body.id, { actualArrival: '2026-10-14', version: 1 })
    expect(res.body.computed.flags).toMatchObject({ arrived: true, open: false })
  })
  it('FR-6.5 reads Overdue Nd from the current ETA, or Arrived Nd late or early against plan', async () => {
    const overdue = await create({ plannedEta: '2026-10-05', revisedEta: '2026-10-07' })
    expect(overdue.body.computed.status).toBe('Overdue 8d')
    const late = await create({ plannedEta: '2026-10-06', actualArrival: '2026-10-12' })
    expect(late.body.computed.status).toBe('Arrived 6d late')
    const early = await create({ plannedEta: '2026-10-06', actualArrival: '2026-10-04' })
    expect(early.body.computed.status).toBe('Arrived 2d early')
  })
})

describe('ETA history', () => {
  it('FR-6.4 writes a revision when the planned ETA changes and when the current ETA changes', async () => {
    const created = await create({ plannedEta: '2026-10-04' })
    const id = created.body.id
    await edit(id, { plannedEta: '2026-10-06', etaChangeReason: 'Supplier delay', version: 1 })
    await edit(id, { revisedEta: '2026-10-09', etaChangeReason: 'Port congestion', version: 2 })
    await edit(id, { revisedEta: '2026-10-06', version: 3 })
    // The revised ETA equals the planned one, so clearing it leaves the current ETA as it was:
    // the demo writes no revision for that.
    await edit(id, { revisedEta: null, remarks: 'x', version: 4 })
    const revisions = (await detail(id)).etaRevisions
    expect(revisions.map((r: Body) => [r.kind, r.previousDate, r.newDate, r.reason])).toEqual([
      ['current', '2026-10-09', '2026-10-06', ''],
      ['current', '2026-10-06', '2026-10-09', 'Port congestion'],
      ['planned', '2026-10-04', '2026-10-06', 'Original plan: Supplier delay'],
    ])
    expect(await history(id)).toEqual([
      `Shipment ${created.body.number} created`,
      'Original planned ETA revised: 2026-10-04 → 2026-10-06 (Supplier delay)',
      'Current ETA revised: 2026-10-06 → 2026-10-09 (Port congestion)',
      'Current ETA revised: 2026-10-09 → 2026-10-06',
      'Updated remarks',
    ])
  })
  it('says "Not set" when an ETA goes from unset to set', async () => {
    const created = await create({ plannedEta: null })
    await edit(created.body.id, { plannedEta: '2026-10-25', version: 1 })
    const [revision] = (await detail(created.body.id)).etaRevisions
    expect(revision).toMatchObject({ kind: 'planned', previousDate: null, newDate: '2026-10-25' })
    expect(await history(created.body.id)).toContain(
      'Original planned ETA revised: Not set → 2026-10-25',
    )
  })
  it('FR-6.4 keeps revisions out of reach of edits and deletes, even for the app role', async () => {
    await expect(db.$executeRaw`UPDATE eta_revisions SET reason = 'changed'`).rejects.toThrow()
    await expect(db.$executeRaw`DELETE FROM eta_revisions`).rejects.toThrow()
  })
})

describe('editing and deleting', () => {
  it('FR-6.2 replaces lines and records that they changed', async () => {
    const other = await makeProduct(db, { name: 'Woofer' })
    const created = await create({
      items: [
        { productId: w.product.id, quantity: 100 },
        { productId: other.id, quantity: 5 },
      ],
    })
    const res = await edit(created.body.id, {
      items: [{ productId: w.product.id, quantity: 80 }],
      version: 1,
    })
    expect(res.body.items).toEqual([
      expect.objectContaining({
        product: expect.objectContaining({ id: w.product.id }),
        quantity: 80,
      }),
    ])
    expect(res.body.computed.totalQty).toBe(80)
    expect(await history(created.body.id)).toContain('Product lines updated')
  })
  it('answers a stale version with 409 and the shipment as it now stands', async () => {
    const created = await create()
    await edit(created.body.id, { vessel: 'A', version: 1 })
    const stale = await w.admin.send('patch', `/api/v1/shipments/${created.body.id}`, {
      vessel: 'B',
      version: 1,
    })
    expect(stale.status).toBe(409)
    expect(stale.body.current).toMatchObject({ vessel: 'A', version: 2 })
  })
  it('lets only admins delete; a deleted shipment frees its products and reads as 404', async () => {
    const product = await makeProduct(db)
    const created = await create({ items: [{ productId: product.id, quantity: 1 }] })
    expect((await w.planner.send('delete', `/api/v1/shipments/${created.body.id}`)).status).toBe(
      403,
    )
    expect((await w.admin.send('delete', `/api/v1/shipments/${created.body.id}`)).status).toBe(204)
    expect((await w.viewer.agent.get(`/api/v1/shipments/${created.body.id}`)).status).toBe(404)
    expect(await history(created.body.id)).toContain(`Shipment ${created.body.number} deleted`)
    expect((await w.admin.send('delete', `/api/v1/products/${product.id}`)).status).toBe(204)
  })
})
