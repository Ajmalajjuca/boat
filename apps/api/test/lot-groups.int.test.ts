import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client'
import { refreshCompletion } from '../src/modules/lots/lot-lock'
import { createTestDatabase } from './support/db'
import {
  day,
  fixedNow,
  makeLookup,
  makeLot,
  makeProduct,
  makeRecordsWorld,
  type RecordsWorld,
  testApp,
} from './support/fixtures'

type Group = {
  product: { id: string; name: string; segment: { value: string } }
  lots: number
  delayed: number
  lotQty: number
  produced: number
  grnTotal: number
  balance: number
}
type Item = {
  product: { id: string }
  lotQty: number
  freshProductionQty: number
  status: { value: string }
  computed: { grnTotal: number; balance: number }
}

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
let headphonesId: string
const ids: Record<string, string> = {}

const product = async (name: string, segmentId: string) =>
  (ids[name] = (await makeProduct(db, { name, segmentId })).id)
const lot = (productName: string, fields: Partial<Prisma.LotUncheckedCreateInput>) =>
  makeLot(db, { productId: ids[productName], stageId: w.lookups.stage.id, ...fields })
const receive = async (lotId: string, quantity: number) => {
  await db.grnReceipt.create({ data: { lotId, label: 'G', date: day('2026-10-10'), quantity } })
  await refreshCompletion(db, lotId)
}

// Alpha and Bravo have active lots; Charlie and Delta have none. The test clock says 15 Oct 2026.
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  const L = w.lookups
  headphonesId = (await makeLookup(db, 'segment', 'Headphones')).id
  await product('Alpha', L.segment.id)
  await product('Bravo', L.segment.id)
  await product('Charlie', L.segment.id)
  await product('Delta', headphonesId)
  await lot('Alpha', {
    label: 'a1',
    plannedDate: day('2026-10-20'),
    lotQty: 100,
    freshProductionQty: 40,
  })
  await lot('Alpha', {
    label: 'a2',
    plannedDate: day('2026-10-25'),
    lotQty: 50,
    statusId: L.delayed.id,
  })
  const b1 = await lot('Bravo', { label: 'b1', plannedDate: day('2026-10-18'), lotQty: 200 })
  await receive(b1.id, 80)
  // Complete by its actual date (FR-11.3), with its full GRN as before.
  const b2 = await lot('Bravo', {
    label: 'b2',
    plannedDate: day('2026-10-01'),
    lotQty: 30,
    actualDate: day('2026-10-10'),
  })
  await receive(b2.id, 30)
  const gone = await lot('Charlie', { label: 'deleted lot' })
  await db.lot.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
  await product('Echo', L.segment.id)
  await lot('Echo', { label: 'lot of a deleted product' })
  await db.product.update({ where: { id: ids.Echo }, data: { deletedAt: new Date() } })
})
afterAll(() => close())

const groups = async (query = '') => {
  const res = await w.viewer.agent.get(`/api/v1/lots/groups?${query}`)
  expect(res.status).toBe(200)
  return res.body.items as Group[]
}
const names = (items: Group[]) => items.map((g) => g.product.name)

describe('GET /lots/groups', () => {
  it('FR-2.5 lists products in the order of their first lot, then products without active lots', async () => {
    // Soundbar is the world's product, which has no lots.
    expect(names(await groups())).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta', 'Soundbar'])
    expect(names(await groups('sort=qty-desc')).slice(0, 2)).toEqual(['Bravo', 'Alpha'])
  })

  it('FR-2.5 totals the matching lots as the lot list computes them', async () => {
    const list = await w.viewer.agent.get('/api/v1/lots?pageSize=200')
    const items = list.body.items as Item[]
    for (const group of await groups()) {
      const mine = items.filter((i) => i.product.id === group.product.id)
      expect(group, group.product.name).toEqual({
        product: expect.objectContaining({ id: group.product.id }),
        lots: mine.length,
        delayed: mine.filter((i) => i.status.value === 'Delayed').length,
        lotQty: mine.reduce((n, i) => n + i.lotQty, 0),
        produced: mine.reduce((n, i) => n + i.freshProductionQty, 0),
        grnTotal: mine.reduce((n, i) => n + i.computed.grnTotal, 0),
        balance: mine.reduce((n, i) => n + i.computed.balance, 0),
      })
    }
    const [bravo, alpha] = await groups()
    expect(bravo).toMatchObject({ lots: 1, lotQty: 200, grnTotal: 80, balance: 120 })
    expect(alpha).toMatchObject({ lots: 2, delayed: 1, lotQty: 150, produced: 40, balance: 150 })
  })

  it('FR-2.5 shows completed lots without empty products', async () => {
    const done = await groups('view=completed')
    expect(names(done)).toEqual(['Bravo'])
    expect(done[0]).toMatchObject({ lots: 1, lotQty: 30, grnTotal: 30, balance: 0 })
  })

  it('FR-2.5 leaves out empty products once a filter other than segment or search is set', async () => {
    expect(names(await groups(`statusId=${w.lookups.delayed.id}`))).toEqual(['Alpha'])
    expect(names(await groups('flag=overdue'))).toEqual([])
  })

  it('FR-2.5 narrows empty products by segment and search', async () => {
    expect(names(await groups(`segmentId=${headphonesId}`))).toEqual(['Delta'])
    expect(names(await groups('q=CHAR'))).toEqual(['Charlie'])
  })

  it('FR-2.5 narrows the lot list and the groups to one product', async () => {
    const res = await w.viewer.agent.get(`/api/v1/lots?productId=${ids.Alpha}`)
    expect(res.status).toBe(200)
    expect(res.body.items.map((i: { label: string }) => i.label).sort()).toEqual(['a1', 'a2'])
    expect(names(await groups(`productId=${ids.Alpha}`))).toEqual(['Alpha'])
  })

  it('never shows deleted lots or deleted products', async () => {
    const all = await groups()
    expect(names(all)).not.toContain('Echo')
    expect(all.find((g) => g.product.name === 'Charlie')).toMatchObject({ lots: 0 })
  })

  it('answers an unknown sort with a field error', async () => {
    const res = await w.viewer.agent.get('/api/v1/lots/groups?sort=random')
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ sort: 'Choose a known sort.' })
  })
})
