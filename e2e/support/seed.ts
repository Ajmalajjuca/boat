import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { LotInput, LookupItem, ProductItem } from '@boat/domain/api'
import type { LookupKind } from '@boat/domain/models'
import { Client } from 'pg'
import { apiAs } from './api'
import { runDir } from './env'

// The company's date in its default time zone, offset by whole days.
export function day(offset = 0) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

// The API refuses a forecast date before today (FR-11.1); in real use such dates only pass with
// time. The seeder sets them straight in the database, as time would have.
const forecastDates = ['rmReadyDate', 'plannedDate', 'revisedEta'] as const
const columns = {
  rmReadyDate: 'rm_ready_date',
  plannedDate: 'planned_date',
  revisedEta: 'revised_eta',
}
async function backdate(lotId: string, dates: Record<string, string>) {
  const { ownerUrl } = JSON.parse(readFileSync(path.join(runDir, 'seeded.json'), 'utf8'))
  const db = new Client({ connectionString: ownerUrl })
  await db.connect()
  try {
    const keys = Object.keys(dates) as (keyof typeof columns)[]
    await db.query(
      `UPDATE lots SET ${keys.map((k, i) => `${columns[k]} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [lotId, ...keys.map((k) => dates[k])],
    )
  } finally {
    await db.end()
  }
}

type LotFields = Partial<
  Omit<
    LotInput,
    | 'productId'
    | 'label'
    | 'categoryId'
    | 'statusId'
    | 'stageId'
    | 'pocId'
    | 'emsId'
    | 'blockerId'
    | 'logisticsId'
    | 'componentIds'
  >
> & {
  category?: string
  status?: string
  stage?: string
  poc?: string
  ems?: string
  blocker?: string
  logistics?: string
  components?: string[]
}

export type ShipmentFields = {
  vessel?: string
  etd?: string
  plannedEta?: string
  revisedEta?: string
  actualArrival?: string
  stage?: string
  items: { productId: string; quantity: number }[]
}

// Seeds records through the API as the admin. Dropdown values survive resets, so they are found
// by text or created.
export async function seeder() {
  const api = await apiAs('admin')
  const lookups: LookupItem[] = (await api.get('/lookups')).items
  const lookup = async (kind: LookupKind, value: string) => {
    const found = lookups.find(
      (l) => l.kind === kind && l.value.toLowerCase() === value.toLowerCase(),
    )
    if (found) return found.id
    const created: LookupItem = await api.post('/lookups', { kind, value })
    lookups.push(created)
    return created.id
  }
  const optional = async (kind: LookupKind, value?: string) => (value ? lookup(kind, value) : null)
  return {
    api,
    lookup,
    product: async (
      name: string,
      fields: { variant?: string; segment?: string } = {},
    ): Promise<ProductItem> =>
      api.post('/products', {
        name,
        variant: fields.variant ?? '',
        segmentId: await lookup('segment', fields.segment ?? 'PA / TWS'),
      }),
    lot: async (productId: string, label: string, fields: LotFields = {}) => {
      const {
        category = 'BAU',
        status = 'On Track',
        stage = 'RM Sourcing',
        poc,
        ems,
        blocker,
        logistics,
        components = [],
        ...rest
      } = fields
      const componentIds: string[] = []
      for (const c of components) componentIds.push(await lookup('component', c))
      const past = Object.fromEntries(
        forecastDates.flatMap((k) => {
          const value = rest[k]
          return value && value < day() ? [[k, value]] : []
        }),
      )
      const created = await api.post('/lots', {
        productId,
        label,
        lotQty: 100,
        ...rest,
        ...Object.fromEntries(Object.keys(past).map((k) => [k, null])),
        categoryId: await lookup('category', category),
        statusId: await lookup('status', status),
        stageId: await lookup('stage', stage),
        pocId: await optional('poc', poc),
        emsId: await optional('ems', ems),
        blockerId: await optional('blocker', blocker),
        logisticsId: await optional('logistics', logistics),
        componentIds,
      })
      if (!Object.keys(past).length) return created
      await backdate(created.id, past)
      return api.get(`/lots/${created.id}`)
    },
    batch: async (
      lotId: string,
      component: string,
      fields: {
        label?: string
        plannedQty?: number
        receivedQty?: number
        receivedDate?: string
      } = {},
    ) =>
      api.post(`/lots/${lotId}/rm-batches`, {
        componentId: await lookup('component', component),
        label: fields.label ?? `${component} batch`,
        plannedQty: fields.plannedQty ?? 0,
        receivedQty: fields.receivedQty ?? 0,
        receivedDate: fields.receivedDate ?? null,
      }),
    shipment: async (number: string, fields: ShipmentFields) => {
      const { vessel = 'MSC Aurora', stage = 'In Transit', items, ...dates } = fields
      return api.post('/shipments', {
        number,
        vessel,
        etd: dates.etd ?? null,
        plannedEta: dates.plannedEta ?? null,
        revisedEta: dates.revisedEta ?? null,
        actualArrival: dates.actualArrival ?? null,
        stageId: await lookup('shipmentStage', stage),
        remarks: '',
        items,
      })
    },
    done: () => api.dispose(),
  }
}
