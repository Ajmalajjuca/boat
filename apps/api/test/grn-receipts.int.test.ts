import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import {
  day,
  fixedNow,
  lotBody,
  makeRecordsWorld,
  type RecordsWorld,
  signIn,
  testApp,
} from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  // GRN is off by default (FEATURE_GRN); these tests pin how it works when switched on.
  app = testApp(db, { now: fixedNow, features: { grn: true } })
  w = await makeRecordsWorld(db, app)
})
afterAll(() => close())

describe('the GRN switch', () => {
  it('FR-11.4 GRN routes are off unless FEATURE_GRN is on', async () => {
    const off = testApp(db, { now: fixedNow })
    const admin = await signIn(off, w.admin.me.user.email)
    const lot = await newLot()
    expect((await admin.agent.get(`/api/v1/lots/${lot.id}/grn-receipts`)).status).toBe(404)
    expect(
      (await admin.send('post', `/api/v1/lots/${lot.id}/grn-receipts`, { quantity: 1 })).status,
    ).toBe(404)
    expect((await admin.agent.get('/api/v1/auth/me')).body.features).toEqual({ grn: false })
    expect((await w.admin.agent.get('/api/v1/auth/me')).body.features).toEqual({ grn: true })
  })
})

type Signed = RecordsWorld['planner']
const newLot = async (overrides: Record<string, unknown> = {}) =>
  (
    await w.planner.send(
      'post',
      '/api/v1/lots',
      lotBody(w, { pocId: w.lookups.pocA.id, ...overrides }),
    )
  ).body as { id: string; version: number }
const receive = (
  user: Signed,
  lotId: string,
  quantity: number,
  date = '2026-10-10',
  label = 'GRN 1',
) => user.send('post', `/api/v1/lots/${lotId}/grn-receipts`, { label, date, quantity })
const detail = async (id: string) => (await w.admin.agent.get(`/api/v1/lots/${id}`)).body

describe('posting receipts', () => {
  it('FR-4.1 takes any number of partial receipts with label, date, quantity and note', async () => {
    const lot = await newLot({ lotQty: 100 })
    const first = await w.planner.send('post', `/api/v1/lots/${lot.id}/grn-receipts`, {
      label: ' GRN 1 ',
      date: '2026-10-05',
      quantity: 30,
      note: 'First truck ',
    })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({
      lotId: lot.id,
      label: 'GRN 1',
      date: '2026-10-05',
      quantity: 30,
      note: 'First truck',
      createdBy: w.planner.me.user.id,
    })
    await receive(w.planner, lot.id, 20, '2026-10-06', 'GRN 2')
    const after = await detail(lot.id)
    expect(after.grnReceipts.map((r: { label: string }) => r.label)).toEqual(['GRN 1', 'GRN 2'])
    expect(after.computed).toMatchObject({
      grnTotal: 50,
      balance: 50,
      grnPercent: 50,
      completed: false,
    })
  })
  it('FR-4.1 refuses a future date and a quantity of zero or less', async () => {
    const lot = await newLot()
    // The test clock says 15 Oct 2026.
    const future = await receive(w.planner, lot.id, 10, '2026-10-16')
    expect(future.status).toBe(422)
    expect(future.body.fields).toEqual({ date: 'Receipt date cannot be in the future.' })
    const zero = await receive(w.planner, lot.id, 0)
    expect(zero.body.fields).toEqual({ quantity: 'Quantity must be greater than zero.' })
  })
  it('FR-4.2 never lets total GRN exceed the lot quantity', async () => {
    const lot = await newLot({ lotQty: 100 })
    await receive(w.planner, lot.id, 60)
    const over = await receive(w.planner, lot.id, 41, '2026-10-11', 'GRN 2')
    expect(over.status).toBe(422)
    expect(over.body.fields).toEqual({ quantity: 'Only 40 units are left to receive on this lot.' })
    expect((await detail(lot.id)).computed.balance).toBe(40)
  })
  it('FR-4.2 holds when two receipts arrive at the same moment', async () => {
    const lot = await newLot({ lotQty: 100 })
    const results = await Promise.all([
      receive(w.planner, lot.id, 60, '2026-10-10', 'A'),
      receive(w.poc, lot.id, 60, '2026-10-10', 'B'),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 422])
    const row = await db.lot.findUniqueOrThrow({ where: { id: lot.id } })
    expect(row.grnTotal).toBe(60)
  })
})

describe('completion', () => {
  it('FR-4.3 completes the lot at full GRN and reverses when a receipt is edited or deleted', async () => {
    const lot = await newLot({ lotQty: 100 })
    await receive(w.planner, lot.id, 40, '2026-10-05', 'GRN 1')
    const last = await receive(w.planner, lot.id, 60, '2026-10-12', 'GRN 2')
    expect(await detail(lot.id)).toMatchObject({
      completedOn: '2026-10-12',
      computed: { completed: true },
    })
    const completed = await w.viewer.agent.get('/api/v1/lots?view=completed&pageSize=200')
    expect(completed.body.items.map((i: { id: string }) => i.id)).toContain(lot.id)

    await w.planner.send('patch', `/api/v1/grn-receipts/${last.body.id}`, { quantity: 50 })
    expect(await detail(lot.id)).toMatchObject({
      completedOn: null,
      computed: { completed: false },
    })
    await w.planner.send('patch', `/api/v1/grn-receipts/${last.body.id}`, { quantity: 60 })
    expect((await detail(lot.id)).completedOn).toBe('2026-10-12')
    await w.planner.send('delete', `/api/v1/grn-receipts/${last.body.id}`)
    expect(await detail(lot.id)).toMatchObject({ completedOn: null, computed: { grnTotal: 40 } })
  })
  it('FR-4.3 reverses completion when the lot quantity is raised', async () => {
    const lot = await newLot({ lotQty: 50 })
    await receive(w.planner, lot.id, 50)
    expect((await detail(lot.id)).completedOn).toBe('2026-10-10')
    const res = await w.planner.send('patch', `/api/v1/lots/${lot.id}`, { lotQty: 80, version: 1 })
    expect(res.body).toMatchObject({
      completedOn: null,
      computed: { completed: false, balance: 30 },
    })
  })
  it('FR-4.4 shows the full-GRN date, days against plan and RM-to-GRN lead time', async () => {
    const lot = await newLot({ lotQty: 100 })
    // Past forecast dates, set directly: the API only accepts them while they are in the future.
    await db.lot.update({
      where: { id: lot.id },
      data: { plannedDate: day('2026-10-10'), rmReadyDate: day('2026-10-01') },
    })
    await receive(w.planner, lot.id, 100, '2026-10-12')
    expect((await detail(lot.id)).computed).toMatchObject({
      fullGrnDate: '2026-10-12',
      planDelay: 2,
      leadTime: 11,
    })
  })
})

describe('who may post and delete', () => {
  it('lets a POC post on their own lots only', async () => {
    const own = await newLot()
    expect((await receive(w.poc, own.id, 10)).status).toBe(201)
    const theirs = await newLot({ pocId: w.lookups.pocB.id })
    expect((await receive(w.poc, theirs.id, 10)).status).toBe(403)
    expect((await receive(w.viewer, own.id, 10)).status).toBe(403)
  })
  it('needs deleteEntries to delete a receipt, and records each change', async () => {
    const lot = await newLot()
    const posted = await receive(w.poc, lot.id, 10)
    await w.poc.send('patch', `/api/v1/grn-receipts/${posted.body.id}`, { quantity: 15 })
    expect((await w.poc.send('delete', `/api/v1/grn-receipts/${posted.body.id}`)).status).toBe(403)
    expect((await w.planner.send('delete', `/api/v1/grn-receipts/${posted.body.id}`)).status).toBe(
      204,
    )
    const history = await db.activityLog.findMany({
      where: { entityId: lot.id, kind: 'receipt' },
      orderBy: { createdAt: 'asc' },
    })
    expect(history.map((h) => [h.message, h.actorName])).toEqual([
      ['Added receipt GRN 1: 10 units', 'Test poc'],
      ['Updated receipt GRN 1: 10 → 15 units', 'Test poc'],
      ['Deleted receipt GRN 1 (15 units)', 'Test planner'],
    ])
  })
  it('answers 404 for a receipt on a deleted lot', async () => {
    const lot = await newLot()
    const posted = await receive(w.planner, lot.id, 10)
    await w.admin.send('delete', `/api/v1/lots/${lot.id}`)
    expect(
      (await w.planner.send('patch', `/api/v1/grn-receipts/${posted.body.id}`, { quantity: 5 }))
        .status,
    ).toBe(404)
    expect((await receive(w.planner, lot.id, 5)).status).toBe(404)
  })
})
