import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseImport } from '@boat/domain/backup'
import { lotSummary, monthSummary } from '@boat/domain/calculations'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import {
  fixedNow,
  makeRecordsWorld,
  type RecordsWorld,
  testApp,
  testToday,
} from './support/fixtures'

const samplePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/sample-test-backup.json',
)
const sample = () => JSON.parse(readFileSync(samplePath, 'utf8'))
const byId = <T extends { id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id))

let db: PrismaClient
let close: () => Promise<void>
let w: RecordsWorld

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  w = await makeRecordsWorld(db, testApp(db, { now: fixedNow }))
})
afterAll(() => close())

const replaceWith = (body: unknown) =>
  w.admin.send('post', '/api/v1/data/import?mode=replace', body as object)

describe('the sample backup', () => {
  it('FR-9.3 imports from the browser backup format (schema version 1)', async () => {
    const res = await replaceWith(sample())
    expect(res.status).toBe(200)
    expect(res.body.imported).toMatchObject({ products: 4, lots: 4, shipments: 3 })
  })
  it("FR-5.1 matches the domain's month-end figures for the sample backup", async () => {
    const data = parseImport(sample())
    const demo = monthSummary(data.lots, '2026-10')
    const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-10')
    expect(res.body).toMatchObject({
      planned: demo.planned,
      completed: demo.completed,
      shortfall: demo.shortfall,
    })
    expect(res.body.percent).toBeCloseTo(demo.percent)
    type ApiLot = { lot: { id: string }; planned: number; completed: number; shortfall: number }
    type ApiProduct = {
      product: { id: string }
      lots: number
      planned: number
      completed: number
      shortfall: number
    }
    const lots = (rows: { id: string; planned: number; completed: number; shortfall: number }[]) =>
      byId(rows).map((r) => [r.id, r.planned, r.completed, r.shortfall])
    expect(lots(res.body.lots.map((r: ApiLot) => ({ ...r, id: r.lot.id })))).toEqual(
      lots(demo.lots.map((r) => ({ ...r, id: r.lot.id }))),
    )
    expect(
      byId<ApiProduct & { id: string }>(
        res.body.products.map((p: ApiProduct) => ({ ...p, id: p.product.id })),
      ).map((p) => [p.id, p.lots, p.planned, p.completed, p.shortfall]),
    ).toEqual(
      byId(demo.products.map((p) => ({ ...p, id: p.productId }))).map((p) => [
        p.id,
        p.lots,
        p.planned,
        p.completed,
        p.shortfall,
      ]),
    )
  })
  it("shows each lot's status line as the demo would", async () => {
    const data = parseImport(sample())
    for (const lot of data.lots) {
      const expected = lotSummary(lot, testToday)
      const res = await w.viewer.agent.get(`/api/v1/lots/${lot.id}`)
      expect(res.body.computed.summary, lot.label).toBe(expected)
    }
  })
  it('exports, replaces from that export, and exports the same data again', async () => {
    const first = (await w.admin.agent.get('/api/v1/data/export')).body
    expect((await replaceWith(first)).status).toBe(200)
    const second = (await w.admin.agent.get('/api/v1/data/export')).body
    // Settings get fresh ids on every export, and "initialized" is synthetic.
    type Row = { id: string; key?: string; value?: string }
    const comparable = (backup: { data: Record<string, Row[]> }) =>
      Object.fromEntries(
        Object.entries(backup.data).map(([table, rows]) => [
          table,
          table === 'settings'
            ? rows.filter((s) => s.key !== 'initialized').map((s) => [s.key, s.value])
            : byId(rows),
        ]),
      )
    // The replace adds history of its own (FR-7.1): every earlier entry must survive unchanged,
    // and the only new ones are the import's.
    const { activityLogs: before, ...firstRest } = comparable(first)
    const { activityLogs: after, ...secondRest } = comparable(second)
    expect(secondRest).toEqual(firstRest)
    expect(after).toEqual(expect.arrayContaining(before as unknown[]))
    const added = (after as { id: string; kind?: string }[]).filter(
      (a) => !(before as { id: string }[]).some((b) => b.id === a.id),
    )
    expect(added.length).toBeGreaterThan(0)
    expect(new Set(added.map((a) => a.kind))).toEqual(new Set(['deleted', 'imported']))
  })
})
