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

type Item = {
  id: string
  number: string
  computed: {
    totalQty: number
    currentEta: string | null
    status: string
    flags: Record<string, boolean>
  }
}

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
let atSea: { id: string }
const ids: Record<string, string> = {}

// The test clock says 15 Oct 2026.
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  atSea = await makeLookup(db, 'shipmentStage', 'At Sea')
  const woofer = await makeProduct(db, { name: 'Woofer' })
  const add = async (number: string, fields: Record<string, unknown>) => {
    const res = await w.planner.send(
      'post',
      '/api/v1/shipments',
      shipmentBody(w, { number, ...fields }),
    )
    ids[number] = res.body.id
  }
  await add('SEA-LATE', { plannedEta: '2026-10-05', revisedEta: '2026-10-07', stageId: atSea.id })
  await add('AIR-ARRIVED', {
    plannedEta: '2026-10-05',
    actualArrival: '2026-10-05',
    vessel: 'Air India',
  })
  await add('DUE-SOON', {
    plannedEta: '2026-10-17',
    items: [
      { productId: w.product.id, quantity: 100 },
      { productId: woofer.id, quantity: 5 },
    ],
  })
  await add('FAR', {
    plannedEta: '2026-10-30',
    items: [{ productId: w.product.id, quantity: 300 }],
  })
  await add('NO-ETA', { plannedEta: null, remarks: '=cmd()' })
  await add('GONE', {})
  await w.admin.send('delete', `/api/v1/shipments/${ids.GONE}`)
})
afterAll(() => close())

const list = async (query = '') => {
  const res = await w.viewer.agent.get(`/api/v1/shipments?pageSize=200${query}`)
  expect(res.status).toBe(200)
  return res.body as { items: Item[]; total: number }
}
const numbers = (items: Item[]) => items.map((i) => i.number)

describe('the shipment list', () => {
  it('FR-6.5 lists active shipments with their status line', async () => {
    const all = await list('&sort=number-asc')
    expect(numbers(all.items)).toEqual(['AIR-ARRIVED', 'DUE-SOON', 'FAR', 'NO-ETA', 'SEA-LATE'])
    const status = Object.fromEntries(all.items.map((i) => [i.number, i.computed.status]))
    expect(status).toMatchObject({ 'SEA-LATE': 'Overdue 8d', 'AIR-ARRIVED': 'Arrived on time' })
  })
  it('searches number, vessel and product names', async () => {
    expect(numbers((await list('&q=sea-late')).items)).toEqual(['SEA-LATE'])
    expect(numbers((await list('&q=air%20india')).items)).toEqual(['AIR-ARRIVED'])
    expect(numbers((await list('&q=woofer')).items)).toEqual(['DUE-SOON'])
  })
  it('filters by stage, vessel and each quick filter', async () => {
    expect(numbers((await list(`&stageId=${atSea.id}`)).items)).toEqual(['SEA-LATE'])
    expect(numbers((await list('&vessel=Air%20India')).items)).toEqual(['AIR-ARRIVED'])
    const all = (await list()).items
    for (const flag of ['open', 'soon', 'overdue', 'revised', 'arrived']) {
      const want = numbers(all.filter((i) => i.computed.flags[flag])).sort()
      expect(numbers((await list(`&flag=${flag}`)).items).sort(), flag).toEqual(want)
    }
    expect(numbers((await list('&flag=soon')).items)).toEqual(['DUE-SOON'])
  })
  it('sorts by ETA with missing ETAs last, and by quantity', async () => {
    expect(numbers((await list('&sort=eta-asc')).items)).toEqual([
      'AIR-ARRIVED',
      'SEA-LATE',
      'DUE-SOON',
      'FAR',
      'NO-ETA',
    ])
    expect(numbers((await list('&sort=qty-desc')).items)[0]).toBe('FAR')
  })
  it('pages', async () => {
    const res = await w.viewer.agent.get('/api/v1/shipments?sort=number-asc&pageSize=2&page=2')
    expect(res.body).toMatchObject({ total: 5, page: 2, pageSize: 2 })
    expect(numbers(res.body.items)).toEqual(['FAR', 'NO-ETA'])
  })
})

describe('GET /shipments/summary', () => {
  it('counts the cards and the units still in transit', async () => {
    const res = await w.viewer.agent.get('/api/v1/shipments/summary')
    expect(res.body).toEqual({
      open: 4,
      soon: 1,
      overdue: 1,
      revised: 1,
      arrived: 1,
      openUnits: 605,
    })
  })
})

describe('GET /shipments/export.csv', () => {
  it('exports the filtered shipments with the demo columns', async () => {
    const res = await w.viewer.agent.get('/api/v1/shipments/export.csv?sort=number-asc')
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="?shipments-2026-10-15\.csv"?$/,
    )
    const lines = res.text.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      '"Invoice","Vessel","Products","TotalQty","ETD","PlannedETA","CurrentETA","ActualWarehouseArrival","Stage","Status","ETASlipDays","ActualArrivalDelayDays","Remarks"',
    )
    expect(lines).toHaveLength(6)
    expect(lines[2]).toContain('"Soundbar (100); Woofer (5)","105"')
    expect(res.text).toContain('"\'=cmd()"')
  })
})

describe('shipment history and notes', () => {
  it('lets planners and admins add notes, newest first in the history', async () => {
    const note = await w.planner.send('post', `/api/v1/shipments/${ids.FAR}/notes`, {
      message: ' Customs cleared ',
    })
    expect(note.status).toBe(201)
    expect(note.body).toMatchObject({
      kind: 'note',
      message: 'Customs cleared',
      actorName: 'Test planner',
    })
    const res = await w.viewer.agent.get(`/api/v1/shipments/${ids.FAR}/activity`)
    expect(res.body.items.map((e: { message: string }) => e.message)).toEqual([
      'Customs cleared',
      'Shipment FAR created',
    ])
  })
  it('refuses notes from POCs and viewers, and blank notes', async () => {
    for (const user of [w.poc, w.viewer])
      expect(
        (await user.send('post', `/api/v1/shipments/${ids.FAR}/notes`, { message: 'x' })).status,
      ).toBe(403)
    const blank = await w.planner.send('post', `/api/v1/shipments/${ids.FAR}/notes`, {
      message: ' ',
    })
    expect(blank.body.fields).toEqual({ message: 'Write a note first.' })
  })
  it('answers 404 for the history of a deleted shipment', async () => {
    expect((await w.viewer.agent.get(`/api/v1/shipments/${ids.GONE}/activity`)).status).toBe(404)
  })
})
