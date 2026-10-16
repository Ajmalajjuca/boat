import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client'
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

type Item = {
  id: string
  label: string
  lotQty: number
  plannedDate: string | null
  revisedEta: string | null
  product: { name: string }
  category: { value: string }
  status: { id: string; value: string }
  poc: { id: string } | null
  blocker: { id: string } | null
  computed: {
    balance: number
    flags: Record<'overdue' | 'dueSoon' | 'followUp' | 'blocked' | 'approval', boolean>
    rm: { complete: boolean }
  }
}

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
const ids: Record<string, string> = {}

const lot = async (name: string, fields: Partial<Prisma.LotUncheckedCreateInput> = {}) => {
  const row = await makeLot(db, {
    productId: w.product.id,
    label: name,
    stageId: w.lookups.stage.id,
    ...fields,
  })
  ids[name] = row.id
  return row
}
const withComponents = async (name: string, received: Record<string, number>) => {
  const row = await lot(name, { rmMode: 'components' })
  for (const [componentId, qty] of Object.entries(received)) {
    await db.lotComponent.create({ data: { lotId: row.id, componentId } })
    if (qty)
      await db.rmBatch.create({
        data: { lotId: row.id, componentId, label: 'B', receivedQty: qty },
      })
  }
}

// One lot per edge of each flag. The test clock says 15 Oct 2026.
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  const L = w.lookups
  await lot('overdue', { plannedDate: day('2026-10-14') })
  await lot('due today', { plannedDate: day('2026-10-15') })
  await lot('due in 3 days', { plannedDate: day('2026-10-18') })
  await lot('due in 4 days', { plannedDate: day('2026-10-19') })
  await lot('revised ETA wins', { plannedDate: day('2026-10-01'), revisedEta: day('2026-10-17') })
  await lot('no ETA')
  await lot('follow-up today', { followUpDate: day('2026-10-15') })
  await lot('follow-up tomorrow', { followUpDate: day('2026-10-16') })
  await lot('delayed', { statusId: L.delayed.id, pocId: L.pocA.id })
  await lot('on hold', { statusId: L.hold.id, pocId: L.pocB.id })
  await lot('blocker none', { blockerId: L.none.id })
  await lot('rm blocker', { blockerId: L.rmBlocker.id })
  await lot('approval blocker', { blockerId: L.approval.id })
  await lot('npi', { categoryId: L.npi.id })
  await lot('ready kit', { readyQty: 100 })
  await lot('zero quantity', { lotQty: 0, readyQty: 0 })
  await withComponents('no components', {})
  await withComponents('kit only', { [L.kit.id]: 100 })
  await withComponents('components received', { [L.pcb.id]: 100, [L.enclosure.id]: 120 })
  await withComponents('enclosure short', { [L.pcb.id]: 100, [L.enclosure.id]: 40 })
  const done = await lot('completed', { plannedDate: day('2026-10-01') })
  await db.grnReceipt.create({
    data: { lotId: done.id, label: 'G', date: day('2026-10-05'), quantity: 100 },
  })
  await refreshCompletion(db, done.id)
  const gone = await lot('deleted lot')
  await db.lot.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
  const oldProduct = await makeProduct(db)
  await makeLot(db, { productId: oldProduct.id, label: 'lot of a deleted product' })
  await db.product.update({ where: { id: oldProduct.id }, data: { deletedAt: new Date() } })
})
afterAll(() => close())

const list = async (query = '') => {
  const res = await w.viewer.agent.get(`/api/v1/lots?pageSize=200${query}`)
  expect(res.status).toBe(200)
  return res.body as { items: Item[]; total: number; page: number; pageSize: number }
}
const labels = (items: Item[]) => items.map((i) => i.label).sort()

describe('the list', () => {
  it('answers a NUL character in the search with a field error, not a 500', async () => {
    const res = await w.viewer.agent.get('/api/v1/lots?q=a%00b')
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ q: 'Remove the hidden NUL character from this text.' })
  })
  it('FR-2.5 shows active lots by default and completed lots on request, never deleted ones', async () => {
    const active = await list()
    expect(active.items).toHaveLength(20)
    expect(active.total).toBe(20)
    expect(labels(active.items)).not.toContain('completed')
    expect(labels(active.items)).not.toContain('deleted lot')
    expect(labels(active.items)).not.toContain('lot of a deleted product')
    expect(labels((await list('&view=completed')).items)).toEqual(['completed'])
  })
  it('FR-2.5 searches product name, variant and lot label, ignoring case', async () => {
    expect(labels((await list('&q=FOLLOW-UP')).items)).toEqual([
      'follow-up today',
      'follow-up tomorrow',
    ])
    expect((await list('&q=soundbar%20x1')).total).toBe(20)
  })
  it('treats % and _ in the search text as plain characters', async () => {
    const promo = await makeProduct(db, { name: 'Promo 100%' })
    const other = await makeProduct(db, { name: 'Promo 1000' })
    await makeLot(db, { productId: promo.id, label: 'LOT_7' })
    await makeLot(db, { productId: other.id, label: 'LOTA7' })
    expect(labels((await list(`&q=${encodeURIComponent('100%')}`)).items)).toEqual(['LOT_7'])
    expect(labels((await list('&q=LOT_7')).items)).toEqual(['LOT_7'])
  })
  it('FR-2.5 filters by status, POC, blocker, category and segment', async () => {
    const L = w.lookups
    expect(labels((await list(`&statusId=${L.delayed.id}`)).items)).toEqual(['delayed'])
    expect(labels((await list(`&pocId=${L.pocB.id}`)).items)).toEqual(['on hold'])
    expect(labels((await list(`&blockerId=${L.approval.id}`)).items)).toEqual(['approval blocker'])
    expect(labels((await list(`&categoryId=${L.npi.id}`)).items)).toEqual(['npi'])
    expect((await list(`&segmentId=${L.segment.id}`)).total).toBe(20)
  })
  // Label and product sorts follow the database collation, which orders spaces and hyphens
  // differently from JavaScript, so they are checked only through stable paging below.
  it('FR-2.5 sorts by ETA with missing ETAs last, and by quantity and balance', async () => {
    const eta = (i: Item) => i.revisedEta ?? i.plannedDate ?? '9999-12-31'
    const byEta = (await list('&sort=eta-asc')).items.map(eta)
    expect(byEta).toEqual([...byEta].sort())
    const byEtaDesc = (await list('&sort=eta-desc')).items.map(eta)
    expect(byEtaDesc).toEqual([...byEtaDesc].sort().reverse())
    const byQty = (await list('&sort=qty-desc')).items.map((i) => i.lotQty)
    expect(byQty).toEqual([...byQty].sort((a, b) => b - a))
    const byBalance = (await list('&sort=balance-desc')).items.map((i) => i.computed.balance)
    expect(byBalance).toEqual([...byBalance].sort((a, b) => b - a))
  })
  it('pages in a stable order', async () => {
    const all = (await list('&sort=label-asc')).items.map((i) => i.id)
    const res = await w.viewer.agent.get('/api/v1/lots?sort=label-asc&pageSize=5&page=2')
    expect(res.body).toMatchObject({ page: 2, pageSize: 5, total: all.length })
    expect(res.body.items.map((i: Item) => i.id)).toEqual(all.slice(5, 10))
  })
  it('answers an unknown filter with a field error', async () => {
    const res = await w.viewer.agent.get('/api/v1/lots?flag=urgent')
    expect(res.status).toBe(422)
  })
  it('needs a session', async () => {
    expect((await request(app).get('/api/v1/lots')).status).toBe(401)
  })
})

// The list filters and summary run in SQL; the detail flags come from packages/domain. They must
// agree on every lot, or a card would say 3 overdue while the list shows 2.
const expected: Record<string, (i: Item) => boolean> = {
  overdue: (i) => i.computed.flags.overdue,
  dueSoon: (i) => i.computed.flags.dueSoon,
  followUp: (i) => i.computed.flags.followUp,
  blocked: (i) => i.computed.flags.blocked,
  approval: (i) => i.computed.flags.approval,
  rm: (i) => !i.computed.rm.complete,
  npi: (i) => i.category.value !== 'BAU',
  onTrack: (i) =>
    i.status.value === 'On Track' &&
    !i.computed.flags.overdue &&
    !i.computed.flags.dueSoon &&
    !i.computed.flags.blocked,
}

describe('quick filters', () => {
  it('FR-2.5 match the flags the domain computes, on every flag', async () => {
    const all = (await list()).items
    for (const [flag, holds] of Object.entries(expected)) {
      const want = labels(all.filter(holds))
      expect(want.length, flag).toBeGreaterThan(0)
      expect(want.length, flag).toBeLessThan(all.length)
      expect(labels((await list(`&flag=${flag}`)).items), flag).toEqual(want)
    }
  })
  it('pins the date edges', async () => {
    expect(labels((await list('&flag=overdue')).items)).toEqual(['overdue'])
    expect(labels((await list('&flag=dueSoon')).items)).toEqual([
      'due in 3 days',
      'due today',
      'revised ETA wins',
    ])
    expect(labels((await list('&flag=followUp')).items)).toEqual(['follow-up today'])
    expect(labels((await list('&flag=rm')).items)).not.toContain('components received')
    expect(labels((await list('&flag=rm')).items)).toContain('enclosure short')
  })
  it('combines flags with AND', async () => {
    expect(labels((await list('&flag=blocked&flag=approval')).items)).toEqual(['approval blocker'])
  })
})

describe('GET /lots/summary', () => {
  it('FR-2.6 counts active lots for each card, as the list filters do', async () => {
    const all = (await list()).items
    const res = await w.viewer.agent.get('/api/v1/lots/summary')
    expect(res.status).toBe(200)
    const count = (flag: string) => all.filter(expected[flag]).length
    expect(res.body).toEqual({
      overdue: count('overdue'),
      dueSoon: count('dueSoon'),
      onTrack: count('onTrack'),
      blocked: count('blocked'),
      approval: count('approval'),
      followUp: count('followUp'),
      rm: count('rm'),
    })
  })
})

describe('GET /lots/export.csv', () => {
  it('FR-2.5 exports the filtered rows with the demo columns', async () => {
    const res = await w.viewer.agent.get('/api/v1/lots/export.csv?q=follow-up')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    // content-disposition quotes the name only when it needs quoting.
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="?active-lots-2026-10-15\.csv"?$/,
    )
    const lines = res.text.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      '"Product","Variant","Segment","Lot","Status","StatusSummary","Category","EMS","POC","Stage","Mode","LotQty","Produced","Rework","GRN","Balance","RMReadyPercent","PlannedDate","CurrentETA","Blocker","FollowUp","FullGRNDate","DaysVsPlan","RMToGRNDays"',
    )
    expect(lines).toHaveLength(3)
  })
  it('neutralises formulas in exported text', async () => {
    await lot('=HYPERLINK("http://evil")')
    const res = await w.viewer.agent.get('/api/v1/lots/export.csv?q=HYPERLINK')
    expect(res.text).toContain('"\'=HYPERLINK(""http://evil"")"')
  })
})
