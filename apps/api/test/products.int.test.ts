import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import {
  day,
  makeLookup,
  makeLot,
  makeProduct,
  makeUser,
  signIn,
  testApp,
  unique,
} from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let admin: Awaited<ReturnType<typeof signIn>>
let planner: Awaited<ReturnType<typeof signIn>>
let segmentId: string

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db)
  admin = await signIn(app, (await makeUser(db, { role: 'admin' })).email)
  planner = await signIn(app, (await makeUser(db, { role: 'planner' })).email)
  segmentId = (await makeLookup(db, 'segment', 'Soundbars')).id
})
afterAll(() => close())

const create = (body: object) => planner.send('post', '/api/v1/products', body)

describe('creating and editing products', () => {
  it('FR-1.1 a planner creates a product with name, variant and segment', async () => {
    const res = await create({ name: ' Inverter ', variant: '5 kW', segmentId })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.any(String),
      version: 1,
      name: 'Inverter',
      variant: '5 kW',
      segment: { id: segmentId, value: 'Soundbars' },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    const list = await planner.agent.get('/api/v1/products')
    expect(list.body.items.map((p: { id: string }) => p.id)).toContain(res.body.id)
  })
  it('FR-1.1 keeps name plus variant unique, ignoring case', async () => {
    await create({ name: 'Soundbar X', variant: 'Black', segmentId })
    const twin = await create({ name: 'soundbar x', variant: 'BLACK', segmentId })
    expect(twin.status).toBe(422)
    expect(twin.body.fields).toEqual({
      name: 'soundbar x · BLACK already exists. Use a different name or variant.',
    })
    expect((await create({ name: 'Soundbar X', variant: 'White', segmentId })).status).toBe(201)
  })
  it('FR-8.3 needs an active segment value', async () => {
    const stage = await makeLookup(db, 'stage')
    for (const id of [stage.id, '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90']) {
      const res = await create({ name: unique('P'), segmentId: id })
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual({ segmentId: 'Choose a segment from the list.' })
    }
    const blank = await create({ name: ' ', segmentId })
    expect(blank.body.fields).toEqual({ name: 'Enter the product name.' })
  })
  it('FR-1.1 edits a product and moves its version on', async () => {
    const created = await create({ name: unique('P'), segmentId })
    const res = await planner.send('patch', `/api/v1/products/${created.body.id}`, {
      variant: 'Pro',
      version: 1,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ variant: 'Pro', version: 2 })
  })
  it('answers a stale version with 409 and the product as it now stands', async () => {
    const created = await create({ name: unique('P'), segmentId })
    await planner.send('patch', `/api/v1/products/${created.body.id}`, { variant: 'A', version: 1 })
    const stale = await admin.send('patch', `/api/v1/products/${created.body.id}`, {
      variant: 'B',
      version: 1,
    })
    expect(stale.status).toBe(409)
    expect(stale.body.current).toMatchObject({ variant: 'A', version: 2 })
  })
  it('lets POCs and viewers read but not change products', async () => {
    for (const role of ['poc', 'viewer'] as const) {
      const user = await signIn(app, (await makeUser(db, { role })).email)
      expect((await user.agent.get('/api/v1/products')).status).toBe(200)
      expect((await user.send('post', '/api/v1/products', { name: 'X', segmentId })).status).toBe(
        403,
      )
    }
  })
})

describe('deleting products', () => {
  it('FR-1.2 soft-deletes the product with its lots, batches and receipts, keeping history', async () => {
    const product = await makeProduct(db, { segmentId })
    const lot = await makeLot(db, { productId: product.id, label: 'Lot 1' })
    const component = await makeLookup(db, 'component')
    await db.lotComponent.create({ data: { lotId: lot.id, componentId: component.id } })
    await db.rmBatch.create({ data: { lotId: lot.id, componentId: component.id, label: 'B1' } })
    await db.grnReceipt.create({
      data: { lotId: lot.id, label: 'G1', date: day('2026-10-01'), quantity: 10 },
    })
    expect((await admin.send('delete', `/api/v1/products/${product.id}`)).status).toBe(204)

    const after = {
      product: await db.product.findUniqueOrThrow({ where: { id: product.id } }),
      lot: await db.lot.findUniqueOrThrow({ where: { id: lot.id } }),
      batches: await db.rmBatch.findMany({ where: { lotId: lot.id } }),
      receipts: await db.grnReceipt.findMany({ where: { lotId: lot.id } }),
      components: await db.lotComponent.findMany({ where: { lotId: lot.id } }),
    }
    for (const row of [
      after.product,
      after.lot,
      ...after.batches,
      ...after.receipts,
      ...after.components,
    ]) {
      expect(row.deletedAt).not.toBeNull()
      expect(row.deletedBy).toBe(admin.me.user.id)
    }
    const history = await db.activityLog.findMany({ where: { entityId: lot.id } })
    expect(history).toEqual([
      expect.objectContaining({
        kind: 'deleted',
        message: 'Lot Lot 1 deleted',
        actorId: admin.me.user.id,
        actorName: admin.me.user.name,
      }),
    ])
    const list = await admin.agent.get('/api/v1/products')
    expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(product.id)
    expect(
      (await admin.send('patch', `/api/v1/products/${product.id}`, { name: 'X', version: 1 }))
        .status,
    ).toBe(404)
  })
  it('FR-1.2 is refused while an active shipment line uses the product', async () => {
    const product = await makeProduct(db, { segmentId })
    const shipment = await db.shipment.create({ data: { number: unique('INV'), vessel: 'MSC' } })
    await db.shipmentItem.create({
      data: { shipmentId: shipment.id, productId: product.id, quantity: 5 },
    })
    const res = await admin.send('delete', `/api/v1/products/${product.id}`)
    expect(res.status).toBe(409)
    expect(res.body.message).toBe(
      'This product is used in a shipment. Remove or reassign those shipment lines first.',
    )
    // A deleted shipment no longer holds the product.
    await db.shipment.update({ where: { id: shipment.id }, data: { deletedAt: new Date() } })
    expect((await admin.send('delete', `/api/v1/products/${product.id}`)).status).toBe(204)
  })
  it('lets only admins delete', async () => {
    const product = await makeProduct(db, { segmentId })
    expect((await planner.send('delete', `/api/v1/products/${product.id}`)).status).toBe(403)
    expect((await request(app).delete(`/api/v1/products/${product.id}`)).status).toBe(401)
  })
  it('frees the name for a new product', async () => {
    const created = await create({ name: 'Reusable', segmentId })
    await admin.send('delete', `/api/v1/products/${created.body.id}`)
    expect((await create({ name: 'Reusable', segmentId })).status).toBe(201)
  })
})
