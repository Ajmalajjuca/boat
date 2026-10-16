import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { refreshCompletion } from '../src/modules/lots/lot-lock'
import { createTestDatabase } from './support/db'
import {
  day,
  fixedNow,
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

// September 2026, seen from 15 October:
//   L1  planned 10 Sep, 100 units; 40 received 20 Sep, 30 more on 2 Oct (after month end)
//   L2  planned 25 Sep, revised to 10 Oct, 50 units; 50 received 28 Sep
//   L3  planned 5 Oct (another month); 10 received 15 Sep, which still counts as GRN in September
//   L4  planned 12 Sep but deleted
//   L5  planned 5 Sep on another product, 200 units, nothing received
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  const other = await makeProduct(db, { name: 'Woofer' })
  const lot = (label: string, fields: Record<string, unknown>) =>
    makeLot(db, { productId: w.product.id, label, stageId: w.lookups.stage.id, ...fields })
  const receive = async (lotId: string, date: string, quantity: number) => {
    await db.grnReceipt.create({ data: { lotId, label: `G ${date}`, date: day(date), quantity } })
    await refreshCompletion(db, lotId)
  }
  const l1 = await lot('L1', {
    plannedDate: day('2026-09-10'),
    lotQty: 100,
    blockerId: w.lookups.rmBlocker.id,
  })
  await receive(l1.id, '2026-09-20', 40)
  await receive(l1.id, '2026-10-02', 30)
  const l2 = await lot('L2', {
    plannedDate: day('2026-09-25'),
    revisedEta: day('2026-10-10'),
    lotQty: 50,
  })
  await receive(l2.id, '2026-09-28', 50)
  const l3 = await lot('L3', { plannedDate: day('2026-10-05'), lotQty: 100 })
  await receive(l3.id, '2026-09-15', 10)
  const l4 = await lot('L4', { plannedDate: day('2026-09-12'), lotQty: 70 })
  await db.lot.update({ where: { id: l4.id }, data: { deletedAt: new Date() } })
  await lot('L5', { productId: other.id, plannedDate: day('2026-09-05'), lotQty: 200 })
})
afterAll(() => close())

describe('GET /reports/month-end', () => {
  it('FR-5.1 compares the quantity of lots planned in the month with GRN received by month end', async () => {
    const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-09')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      month: '2026-09',
      label: 'September 2026',
      monthEnd: '2026-09-30',
      inProgress: false,
      planned: 350,
      received: 90,
      shortfall: 260,
    })
    expect(res.body.percent).toBeCloseTo((90 / 350) * 100)
  })
  it('FR-5.2 shows totals by product and by lot, largest shortfall first, and all GRN dated in the month', async () => {
    const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-09')
    expect(res.body.grnInMonth).toBe(100)
    expect(
      res.body.products.map((p: { product: { name: string }; shortfall: number }) => [
        p.product.name,
        p.shortfall,
      ]),
    ).toEqual([
      ['Woofer', 200],
      ['Soundbar', 60],
    ])
    expect(
      res.body.lots.map((r: { lot: { label: string }; received: number; shortfall: number }) => [
        r.lot.label,
        r.received,
        r.shortfall,
      ]),
    ).toEqual([
      ['L5', 0, 200],
      ['L1', 40, 60],
      ['L2', 50, 0],
    ])
    const l1 = res.body.lots.find((r: { lot: { label: string } }) => r.lot.label === 'L1')
    expect(l1.lot.blocker).toEqual({ id: w.lookups.rmBlocker.id, value: 'RM Blocker' })
    // Today's status counts every receipt, including the one after month end.
    expect(l1.statusToday).toBe('On Track, 35d overdue — RM Blocker (Factory Production)')
  })
  it('marks the current month as in progress', async () => {
    const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-10')
    expect(res.body).toMatchObject({ inProgress: true, planned: 100 })
  })
  it('needs a valid month and a session', async () => {
    for (const month of ['2026-13', '2026-9', '', '0000-01'])
      expect((await w.viewer.agent.get(`/api/v1/reports/month-end?month=${month}`)).status).toBe(
        422,
      )
    expect((await request(app).get('/api/v1/reports/month-end?month=2026-09')).status).toBe(401)
  })
})

describe('GET /reports/month-end/export.csv', () => {
  it("exports the month's lots with the demo columns", async () => {
    const res = await w.viewer.agent.get('/api/v1/reports/month-end/export.csv?month=2026-09')
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="?month-end-2026-09\.csv"?$/,
    )
    const lines = res.text.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      '"Month","Product","Variant","Segment","Lot","PlannedDate","PlannedQty","ReceivedByMonthEnd","Shortfall","Blocker","BlockerDescription","StatusToday"',
    )
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('"2026-09","Woofer"')
  })
})

describe('GET /reports/months', () => {
  it('FR-5.1 lists planned and receipt months, newest first, with the current month', async () => {
    const product = await makeProduct(db)
    const lot = await makeLot(db, { productId: product.id, plannedDate: day('2025-03-14') })
    await db.grnReceipt.create({
      data: { lotId: lot.id, label: 'G', date: day('2025-05-02'), quantity: 1 },
    })
    const gone = await makeLot(db, { productId: product.id, plannedDate: day('2024-01-10') })
    await db.lot.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
    const res = await w.viewer.agent.get('/api/v1/reports/months')
    expect(res.status).toBe(200)
    const months: string[] = res.body.items
    expect(months[0]).toBe('2026-10')
    expect(months).toContain('2025-05')
    expect(months).toContain('2025-03')
    expect(months).not.toContain('2024-01')
    expect(months).toEqual([...months].sort().reverse())
    expect(new Set(months).size).toBe(months.length)
  })
})
