import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, makeRecordsWorld, type RecordsWorld, testApp } from './support/fixtures'

// PRD: list and summary endpoints answer in under 300 ms at p95 for 20,000 lots. Setting up
// 20,000 lots is slow, so this runs only on request:
//   PERF=1 pnpm --filter @boat/api test:int -- test/perf.int.test.ts
describe.runIf(process.env.PERF === '1')('20,000 lots', () => {
  let db: PrismaClient
  let close: () => Promise<void>
  let w: RecordsWorld

  beforeAll(async () => {
    ;({ db, close } = await createTestDatabase())
    w = await makeRecordsWorld(db, testApp(db, { now: fixedNow }))
    const L = w.lookups
    await db.$executeRaw`
      INSERT INTO lots (id, product_id, label, category_id, status_id, stage_id, blocker_id,
                        lot_qty, planned_date, follow_up_date, updated_at)
      SELECT gen_random_uuid(), ${w.product.id}::uuid, 'Lot ' || g, ${L.bau.id}::uuid,
             CASE WHEN g % 5 = 0 THEN ${L.delayed.id}::uuid ELSE ${L.onTrack.id}::uuid END,
             ${L.stage.id}::uuid,
             CASE WHEN g % 11 = 0 THEN ${L.rmBlocker.id}::uuid END,
             100, DATE '2026-09-01' + (g % 90),
             CASE WHEN g % 7 = 0 THEN DATE '2026-10-01' + (g % 30) END, now()
      FROM generate_series(1, 20000) g`
  }, 300_000)
  afterAll(() => close())

  const p95 = async (url: string) => {
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      const res = await w.viewer.agent.get(url)
      times.push(performance.now() - start)
      expect(res.status).toBe(200)
    }
    return times.sort((a, b) => a - b)[18]
  }

  it.each([
    '/api/v1/lots?pageSize=50',
    '/api/v1/lots?flag=overdue&pageSize=50',
    '/api/v1/lots?q=Lot%201999&sort=balance-desc',
    '/api/v1/lots/summary',
  ])('answers %s within 300 ms at p95', async (url) => {
    const ms = await p95(url)
    console.log(`${url}: p95 ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(300)
  })
})
