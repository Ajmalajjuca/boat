import { totalGrn } from './calculations'
import { type DataSet, dataKeys, type LookupKind } from './models'

export const BACKUP_APP = 'Supply Chain Control Tower'
export const SCHEMA_VERSION = 1
export type Backup = { app: string; schemaVersion: number; exportedAt: string; data: DataSet }

// A backup that can't be imported. The message names the problem and, where it can, the record.
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}
// A declaration (not an arrow) so TypeScript narrows types after a call.
function fail(message: string): never {
  throw new BackupError(message)
}

const maxQuantity = 1_000_000_000
const isObject = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)
// Postgres text can't hold NUL, so a backup carrying one is refused as invalid text.
const isText = (x: unknown): x is string => typeof x === 'string' && !x.includes('\u0000')
const isDate = (s: string) =>
  !s ||
  (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
    new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s)
const folded = (s: string) => s.trim().toLowerCase()

const fields: Record<
  keyof DataSet,
  {
    strings: string[]
    optionalStrings?: string[]
    numbers?: string[]
    dates?: string[]
    booleans?: string[]
    arrays?: string[]
  }
> = {
  products: { strings: ['name', 'variant', 'segment'] },
  lots: {
    strings: [
      'productId',
      'label',
      'category',
      'ems',
      'poc',
      'status',
      'stage',
      'rmMode',
      'reworkReason',
      'rmReadyDate',
      'plannedDate',
      'revisedEta',
      'actualDate',
      'logisticsMode',
      'blockerCategory',
      'blockerDescription',
      'followUpDate',
      'followUpNote',
    ],
    numbers: ['readyQty', 'lotQty', 'freshProductionQty', 'reworkQty'],
    dates: ['rmReadyDate', 'plannedDate', 'revisedEta', 'actualDate', 'followUpDate'],
    booleans: ['directFg'],
    arrays: ['rmComponents'],
  },
  rmBatches: {
    strings: ['lotId', 'component', 'label', 'plannedDate', 'receivedDate', 'status', 'notes'],
    numbers: ['plannedQty', 'receivedQty'],
    dates: ['plannedDate', 'receivedDate'],
  },
  grnReceipts: {
    strings: ['lotId', 'label', 'date', 'note'],
    numbers: ['quantity'],
    dates: ['date'],
  },
  shipments: {
    strings: [
      'number',
      'vessel',
      'etd',
      'plannedEta',
      'revisedEta',
      'actualArrival',
      'stage',
      'remarks',
    ],
    dates: ['etd', 'plannedEta', 'revisedEta', 'actualArrival'],
  },
  shipmentItems: { strings: ['shipmentId', 'productId'], numbers: ['quantity'] },
  etaRevisions: {
    strings: ['shipmentId', 'previousDate', 'newDate', 'reason'],
    dates: ['previousDate', 'newDate'],
  },
  activityLogs: {
    strings: ['entityType', 'entityId', 'message', 'kind'],
    optionalStrings: ['actor'],
  },
  lookupValues: { strings: ['kind', 'value'], numbers: ['sort'] },
  settings: { strings: ['key', 'value'] },
}

// The demo's backup checks (apps/web repository.ts until Phase 4), shared by browser and server.
export function parseImport(raw: unknown): DataSet {
  if (
    !isObject(raw) ||
    raw.schemaVersion !== SCHEMA_VERSION ||
    raw.app !== BACKUP_APP ||
    typeof raw.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.exportedAt)) ||
    !isObject(raw.data)
  )
    fail('Unsupported JSON backup or schema version.')
  const source = (raw as { data: Record<string, unknown> }).data
  const ids = new Set<string>()
  const data = {} as DataSet
  for (const key of dataKeys) {
    const rows = source[key]
    if (!Array.isArray(rows)) fail(`Missing ${key} records.`)
    for (const row of rows as unknown[]) {
      if (
        !isObject(row) ||
        !isText(row.id) ||
        !row.id.trim() ||
        typeof row.createdAt !== 'string' ||
        typeof row.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.createdAt)) ||
        !Number.isFinite(Date.parse(row.updatedAt))
      )
        fail(`Invalid ${key} record ID or timestamps.`)
      const r = row as Record<string, unknown>
      const id = r.id as string
      if (ids.has(id)) fail(`Duplicate record ID ${id}.`)
      ids.add(id)
      const spec = fields[key]
      for (const name of spec.strings) if (!isText(r[name])) fail(`Invalid ${key}.${name}.`)
      for (const name of spec.optionalStrings || [])
        if (r[name] !== undefined && !isText(r[name])) fail(`Invalid ${key}.${name}.`)
      for (const name of spec.numbers || [])
        if (!Number.isInteger(r[name]) || Number(r[name]) < 0 || Number(r[name]) > maxQuantity)
          fail(`Invalid ${key}.${name}.`)
      for (const name of spec.booleans || [])
        if (typeof r[name] !== 'boolean') fail(`Invalid ${key}.${name}.`)
      for (const name of spec.arrays || [])
        if (!Array.isArray(r[name]) || !(r[name] as unknown[]).every(isText))
          fail(`Invalid ${key}.${name}.`)
      for (const name of spec.dates || [])
        if (!isDate(String(r[name]))) fail(`Invalid ${key}.${name}.`)
    }
    ;(data as unknown as Record<string, unknown>)[key] = rows
  }
  if (!data.settings.some((s) => s.key === 'initialized'))
    fail('Backup is missing its initialization record.')
  const lookupKeys = data.lookupValues.map((v) => `${v.kind}\u0000${folded(v.value)}`)
  if (new Set(lookupKeys).size !== lookupKeys.length) fail('Backup has duplicate dropdown values.')
  if (new Set(data.settings.map((s) => s.key)).size !== data.settings.length)
    fail('Backup has duplicate setting keys.')
  return data
}

const kinds = new Set<LookupKind>([
  'segment',
  'category',
  'ems',
  'poc',
  'status',
  'stage',
  'blocker',
  'logistics',
  'component',
  'shipmentStage',
])

// Finds the first record whose key repeats, ignoring case and surrounding spaces.
function firstDuplicate<T>(rows: T[], key: (row: T) => string) {
  const seen = new Set<string>()
  for (const row of rows) {
    const k = key(row)
    if (seen.has(k)) return row
    seen.add(k)
  }
  return undefined
}

// Cross-record checks: references, quantities, and the uniqueness and date rules the database
// enforces. Run on the data as it will be after the import (merged with current data in merge mode).
export function validateRelations(data: DataSet) {
  const allIds = dataKeys.flatMap((key) => data[key].map((row) => row.id))
  const repeated = firstDuplicate(allIds, (id) => id)
  if (repeated) fail(`Duplicate record ID ${repeated}.`)
  const lookupKeys = data.lookupValues.map((v) => `${v.kind}\u0000${folded(v.value)}`)
  if (new Set(lookupKeys).size !== lookupKeys.length) fail('Dropdown values collide after merge.')
  if (new Set(data.settings.map((s) => s.key)).size !== data.settings.length)
    fail('Setting keys collide after merge.')
  const products = new Set(data.products.map((x) => x.id))
  const lots = new Map(data.lots.map((x) => [x.id, x]))
  const shipments = new Map(data.shipments.map((x) => [x.id, x]))
  for (const value of data.lookupValues)
    if (!kinds.has(value.kind) || !value.value.trim())
      fail('A dropdown value has an invalid kind or blank label.')
  const lookup = (kind: LookupKind, value: string) =>
    !value || data.lookupValues.some((v) => v.kind === kind && folded(v.value) === folded(value))
  for (const p of data.products)
    if (!p.name.trim() || !p.segment.trim()) fail('A product is missing its name or segment.')
  for (const p of data.products)
    if (!lookup('segment', p.segment)) fail(`Product ${p.name} references a missing segment.`)
  const twinProduct = firstDuplicate(
    data.products,
    (p) => `${folded(p.name)}\u0000${folded(p.variant)}`,
  )
  if (twinProduct) fail(`Product ${twinProduct.name} duplicates another product name and variant.`)
  for (const l of data.lots) {
    if (!products.has(l.productId)) fail(`Lot ${l.label} has a missing product.`)
    // The database requires these three; the demo's forms always set them.
    if (!l.category.trim() || !l.status.trim() || !l.stage.trim())
      fail(`Lot ${l.label} is missing its category, status or stage.`)
    if (
      !l.label.trim() ||
      !lookup('category', l.category) ||
      !lookup('ems', l.ems) ||
      !lookup('poc', l.poc) ||
      !lookup('status', l.status) ||
      !lookup('stage', l.stage) ||
      !lookup('blocker', l.blockerCategory) ||
      !lookup('logistics', l.logisticsMode) ||
      l.rmComponents.some((c) => !lookup('component', c))
    )
      fail(`Lot ${l.label} references a missing dropdown value.`)
    if (l.reworkQty > l.freshProductionQty) fail(`Lot ${l.label} has rework above production.`)
    if (l.rmMode !== 'all' && l.rmMode !== 'components')
      fail(`Lot ${l.label} has an invalid RM mode.`)
    if (l.rmMode === 'components' && l.rmComponents.includes('Kit (All Together)'))
      fail(`Lot ${l.label} mixes kit and components.`)
  }
  const twinLot = firstDuplicate(data.lots, (l) => `${l.productId}\u0000${folded(l.label)}`)
  if (twinLot) fail(`Lot ${twinLot.label} duplicates another lot label on its product.`)
  for (const r of data.grnReceipts)
    if (!lots.has(r.lotId) || !r.label.trim() || !r.date || r.quantity <= 0)
      fail('A GRN receipt has a missing lot or invalid receipt fields.')
  for (const b of data.rmBatches)
    if (!lots.has(b.lotId) || !b.label.trim() || !lookup('component', b.component))
      fail('An RM batch has a missing lot or component.')
  for (const l of data.lots)
    if (totalGrn(data.grnReceipts.filter((r) => r.lotId === l.id)) > l.lotQty)
      fail(`GRN exceeds lot quantity for ${l.label}.`)
  for (const s of data.shipments) {
    if (!s.number.trim() || !s.vessel.trim() || !lookup('shipmentStage', s.stage))
      fail('A shipment is missing its invoice number, vessel, or valid stage.')
    if (s.etd && [s.plannedEta, s.revisedEta, s.actualArrival].some((d) => d && d < s.etd))
      fail(`Shipment ${s.number} has an ETA or arrival before its ETD.`)
  }
  const twinShipment = firstDuplicate(data.shipments, (s) => folded(s.number))
  if (twinShipment) fail(`Shipment ${twinShipment.number} duplicates another shipment number.`)
  for (const i of data.shipmentItems)
    if (!shipments.has(i.shipmentId) || !products.has(i.productId) || i.quantity <= 0)
      fail('A shipment line has a missing shipment, product, or positive quantity.')
  const twinLine = firstDuplicate(data.shipmentItems, (i) => `${i.shipmentId}\u0000${i.productId}`)
  if (twinLine)
    fail(
      `Shipment ${shipments.get(twinLine.shipmentId)?.number} lists a product on more than one line.`,
    )
  for (const r of data.etaRevisions)
    if (!shipments.has(r.shipmentId)) fail('An ETA revision has a missing shipment.')
  for (const a of data.activityLogs)
    if (
      (a.entityType !== 'lot' && a.entityType !== 'shipment') ||
      (a.entityType === 'lot' && !lots.has(a.entityId)) ||
      (a.entityType === 'shipment' && !shipments.has(a.entityId))
    )
      fail('An activity record has a missing parent or invalid type.')
}
