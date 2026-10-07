import { db, allTables, getData, SCHEMA_VERSION } from './db'
import { demoData, seedLookups } from './demo'
import { effectiveShipmentEta, sum, totalGrn } from './calculations'
import type {
  ActivityLog,
  DataSet,
  ETARevision,
  GRNReceipt,
  Lot,
  LookupKind,
  LookupValue,
  Product,
  RMBatch,
  Shipment,
  ShipmentItem,
} from './models'
import { dataKeys, isSystemLookup, now, stamp, uid } from './models'
import {
  assertValid,
  lineField,
  validateBatch,
  validateLookupValue,
  validateLot,
  validateProduct,
  validateReceipt,
  validateShipment,
  ValidationError,
} from './validation'

const required = (s: string, name: string) => {
  if (!s.trim()) throw new Error(`${name} is required.`)
}
const invalid = (field: string, message: string) => new ValidationError({ [field]: message })
const log = (
  entityType: ActivityLog['entityType'],
  entityId: string,
  message: string,
  kind: string,
) => db.activityLogs.add(stamp({ entityType, entityId, message, kind }))
const clean = (s: string) => s.trim()
const sameText = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase()
// Exported backups are validated against Settings values, so saved records must use them too.
async function requireLookup(kind: LookupKind, value: string, field: string) {
  if (value && !(await db.lookupValues.where('[kind+value]').equals([kind, value]).first()))
    throw invalid(field, `"${value}" is no longer in Settings. Choose another option.`)
}

export async function initialize(choice: 'demo' | 'empty') {
  await db.transaction('rw', allTables, async () => {
    if (await db.settings.where('key').equals('initialized').first()) return
    if ((await db.products.count()) || (await db.lots.count()) || (await db.shipments.count()))
      throw new Error(
        'Existing records were found. Export them before initializing this workspace.',
      )
    const data =
      choice === 'demo'
        ? demoData()
        : {
            products: [],
            lots: [],
            rmBatches: [],
            grnReceipts: [],
            shipments: [],
            shipmentItems: [],
            etaRevisions: [],
            activityLogs: [],
            lookupValues: seedLookups(),
            settings: [stamp({ key: 'initialized', value: 'empty' })],
          }
    for (const key of dataKeys) await db.table(key).bulkAdd(data[key])
  })
}
export async function saveProduct(input: Product) {
  assertValid(validateProduct(input))
  const item = {
    ...input,
    name: clean(input.name),
    variant: clean(input.variant),
    updatedAt: now(),
  }
  await db.transaction('rw', db.products, db.lookupValues, async () => {
    await requireLookup('segment', item.segment, 'segment')
    const others = await db.products.filter((p) => p.id !== item.id).toArray()
    if (others.some((p) => sameText(p.name, item.name) && sameText(p.variant, item.variant)))
      throw invalid(
        'name',
        `${item.name}${item.variant ? ` · ${item.variant}` : ''} already exists. Use a different name or variant.`,
      )
    await db.products.put(item)
  })
  return item
}
export async function deleteProduct(id: string) {
  await db.transaction('rw', allTables, async () => {
    if (await db.shipmentItems.where('productId').equals(id).count())
      throw new Error(
        'This product is used in a shipment. Remove or reassign those shipment lines first.',
      )
    const lots = await db.lots.where('productId').equals(id).toArray()
    for (const lot of lots) await deleteLotInside(lot.id)
    await db.products.delete(id)
  })
}
const lotFields: (keyof Lot)[] = [
  'productId',
  'label',
  'category',
  'directFg',
  'ems',
  'poc',
  'status',
  'stage',
  'rmMode',
  'rmComponents',
  'readyQty',
  'lotQty',
  'freshProductionQty',
  'reworkQty',
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
]
export async function saveLot(input: Lot) {
  assertValid(validateLot(input))
  await db.transaction(
    'rw',
    [db.lots, db.grnReceipts, db.rmBatches, db.activityLogs, db.products, db.lookupValues],
    async () => {
      if (!(await db.products.get(input.productId)))
        throw invalid('productId', 'This product no longer exists. Choose another.')
      await requireLookup('category', input.category, 'category')
      await requireLookup('ems', input.ems, 'ems')
      await requireLookup('poc', input.poc, 'poc')
      await requireLookup('status', input.status, 'status')
      await requireLookup('stage', input.stage, 'stage')
      await requireLookup('blocker', input.blockerCategory, 'blockerCategory')
      await requireLookup('logistics', input.logisticsMode, 'logisticsMode')
      for (const component of input.rmComponents)
        await requireLookup('component', component, 'rmComponents')
      const siblings = await db.lots.where('productId').equals(input.productId).toArray()
      if (siblings.some((l) => l.id !== input.id && sameText(l.label, input.label)))
        throw invalid('label', `This product already has a lot labelled ${clean(input.label)}.`)
      if (input.rmMode === 'components') {
        const batches = await db.rmBatches.where('lotId').equals(input.id).toArray()
        const orphaned = [...new Set(batches.map((b) => b.component))].filter(
          (c) => !input.rmComponents.includes(c),
        )
        if (orphaned.length)
          throw invalid(
            'rmComponents',
            `${orphaned.join(', ')} still ha${orphaned.length > 1 ? 've' : 's'} material batches. Keep the component selected or delete its batches first.`,
          )
      }
      const receipts = await db.grnReceipts.where('lotId').equals(input.id).toArray()
      if (totalGrn(receipts) > input.lotQty)
        throw invalid(
          'lotQty',
          `Lot quantity cannot be below the ${totalGrn(receipts)} units already received.`,
        )
      const old = await db.lots.get(input.id)
      const item = {
        ...input,
        label: clean(input.label),
        reworkReason: clean(input.reworkReason),
        blockerDescription: clean(input.blockerDescription),
        followUpNote: clean(input.followUpNote),
        updatedAt: now(),
      }
      await db.lots.put(item)
      if (!old) await log('lot', input.id, `Lot ${item.label} created`, 'created')
      else {
        const changes = lotFields.filter((k) => JSON.stringify(old[k]) !== JSON.stringify(item[k]))
        if (changes.length)
          await log(
            'lot',
            input.id,
            `Updated ${changes.map((k) => k.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')}`,
            'updated',
          )
      }
    },
  )
}
async function deleteLotInside(id: string) {
  await db.rmBatches.where('lotId').equals(id).delete()
  await db.grnReceipts.where('lotId').equals(id).delete()
  await db.activityLogs.where('[entityType+entityId]').equals(['lot', id]).delete()
  await db.lots.delete(id)
}
export async function deleteLot(id: string) {
  await db.transaction('rw', db.lots, db.rmBatches, db.grnReceipts, db.activityLogs, async () =>
    deleteLotInside(id),
  )
}

export async function saveBatch(item: RMBatch) {
  assertValid(validateBatch(item))
  await db.transaction('rw', db.rmBatches, db.lots, db.activityLogs, async () => {
    const lot = await db.lots.get(item.lotId)
    if (!lot) throw new Error('Lot no longer exists.')
    if (lot.rmMode !== 'components')
      throw new Error('Switch the lot to Track by Component before adding batches.')
    if (!lot.rmComponents.includes(item.component))
      throw invalid('component', 'Select this component on the lot first.')
    const previous = await db.rmBatches.get(item.id)
    await db.rmBatches.put({
      ...item,
      label: clean(item.label),
      notes: clean(item.notes),
      updatedAt: now(),
    })
    await log(
      'lot',
      item.lotId,
      `${previous ? 'Updated' : 'Added'} ${item.component} batch ${clean(item.label)} (${item.receivedQty} received)`,
      'material',
    )
  })
}
export async function deleteBatch(item: RMBatch) {
  await db.transaction('rw', db.rmBatches, db.activityLogs, async () => {
    await db.rmBatches.delete(item.id)
    await log('lot', item.lotId, `Deleted ${item.component} batch ${item.label}`, 'material')
  })
}
export async function saveReceipt(item: GRNReceipt) {
  assertValid(validateReceipt(item))
  await db.transaction('rw', db.grnReceipts, db.lots, db.activityLogs, async () => {
    const lot = await db.lots.get(item.lotId)
    if (!lot) throw new Error('Lot no longer exists.')
    const old = await db.grnReceipts.get(item.id)
    const current = await db.grnReceipts.where('lotId').equals(item.lotId).toArray()
    const next = sum(current.filter((r) => r.id !== item.id).map((r) => r.quantity)) + item.quantity
    if (next > lot.lotQty)
      throw invalid(
        'quantity',
        `Total GRN would be ${next}, above the lot quantity of ${lot.lotQty}. Only ${lot.lotQty - (next - item.quantity)} units are left to receive.`,
      )
    await db.grnReceipts.put({
      ...item,
      label: clean(item.label),
      note: clean(item.note),
      updatedAt: now(),
    })
    await log(
      'lot',
      item.lotId,
      `${old ? 'Updated' : 'Added'} receipt ${clean(item.label)}: ${old ? `${old.quantity} → ` : ''}${item.quantity} units`,
      'receipt',
    )
  })
}
export async function deleteReceipt(item: GRNReceipt) {
  await db.transaction('rw', db.grnReceipts, db.activityLogs, async () => {
    await db.grnReceipts.delete(item.id)
    await log(
      'lot',
      item.lotId,
      `Deleted receipt ${item.label} (${item.quantity} units)`,
      'receipt',
    )
  })
}
export async function addNote(
  entityType: ActivityLog['entityType'],
  entityId: string,
  message: string,
) {
  required(message, 'Note')
  await log(entityType, entityId, clean(message), 'note')
}

export async function saveShipment(input: Shipment, lines: ShipmentItem[], reason: string) {
  assertValid(validateShipment(input, lines))
  await db.transaction(
    'rw',
    [
      db.shipments,
      db.shipmentItems,
      db.etaRevisions,
      db.activityLogs,
      db.products,
      db.lookupValues,
    ],
    async () => {
      await requireLookup('shipmentStage', input.stage, 'stage')
      const others = await db.shipments.filter((s) => s.id !== input.id).toArray()
      if (others.some((s) => sameText(s.number, input.number)))
        throw invalid('number', `Shipment ${clean(input.number)} already exists.`)
      for (const line of lines)
        if (!(await db.products.get(line.productId)))
          throw invalid(lineField(line.id, 'productId'), 'This product no longer exists.')
      const old = await db.shipments.get(input.id)
      const oldLines = old
        ? await db.shipmentItems.where('shipmentId').equals(input.id).toArray()
        : []
      const item = {
        ...input,
        number: clean(input.number),
        vessel: clean(input.vessel),
        remarks: clean(input.remarks),
        updatedAt: now(),
      }
      await db.shipments.put(item)
      await db.shipmentItems.where('shipmentId').equals(input.id).delete()
      await db.shipmentItems.bulkAdd(
        lines.map((line) => ({ ...line, shipmentId: input.id, updatedAt: now() })),
      )
      if (!old) await log('shipment', input.id, `Shipment ${item.number} created`, 'created')
      else {
        const recordRevision = async (
          previousDate: string,
          newDate: string,
          label: string,
          revisionReason: string,
        ) => {
          const revision: ETARevision = stamp({
            shipmentId: item.id,
            previousDate,
            newDate,
            reason: revisionReason,
          })
          await db.etaRevisions.add(revision)
          await log(
            'shipment',
            item.id,
            `${label}: ${revision.previousDate || 'Not set'} → ${revision.newDate || 'Not set'}${reason ? ` (${clean(reason)})` : ''}`,
            'eta',
          )
        }
        if (old.plannedEta !== item.plannedEta)
          await recordRevision(
            old.plannedEta,
            item.plannedEta,
            'Original planned ETA revised',
            `Original plan${reason ? `: ${clean(reason)}` : ''}`,
          )
        // Only a change in the effective ETA is a revision; equal dates add no history.
        if (
          old.revisedEta !== item.revisedEta &&
          effectiveShipmentEta(old) !== effectiveShipmentEta(item)
        )
          await recordRevision(
            effectiveShipmentEta(old),
            effectiveShipmentEta(item),
            'Current ETA revised',
            clean(reason),
          )
        const other = ['number', 'vessel', 'etd', 'actualArrival', 'stage', 'remarks'] as const
        const changes = other.filter((k) => old[k] !== item[k])
        if (changes.length)
          await log('shipment', item.id, `Updated ${changes.join(', ')}`, 'updated')
        if (
          JSON.stringify(oldLines.map((x) => [x.id, x.productId, x.quantity]).sort()) !==
          JSON.stringify(lines.map((x) => [x.id, x.productId, x.quantity]).sort())
        )
          await log('shipment', item.id, 'Product lines updated', 'lines')
      }
    },
  )
}
export async function deleteShipment(id: string) {
  await db.transaction(
    'rw',
    db.shipments,
    db.shipmentItems,
    db.etaRevisions,
    db.activityLogs,
    async () => {
      await db.shipmentItems.where('shipmentId').equals(id).delete()
      await db.etaRevisions.where('shipmentId').equals(id).delete()
      await db.activityLogs.where('[entityType+entityId]').equals(['shipment', id]).delete()
      await db.shipments.delete(id)
    },
  )
}

export async function lookupInUse(kind: LookupKind, value: string) {
  switch (kind) {
    case 'segment':
      return !!(await db.products.where('segment').equals(value).count())
    case 'category':
      return !!(await db.lots.where('category').equals(value).count())
    case 'ems':
      return !!(await db.lots.where('ems').equals(value).count())
    case 'poc':
      return !!(await db.lots.where('poc').equals(value).count())
    case 'status':
      return !!(await db.lots.where('status').equals(value).count())
    case 'stage':
      return !!(await db.lots.where('stage').equals(value).count())
    case 'blocker':
      return (await db.lots.toArray()).some((lot) => lot.blockerCategory === value)
    case 'logistics':
      return (await db.lots.toArray()).some((lot) => lot.logisticsMode === value)
    case 'shipmentStage':
      return !!(await db.shipments.where('stage').equals(value).count())
    case 'component':
      return (
        !!(await db.rmBatches.where('component').equals(value).count()) ||
        !!(await db.lots.toArray()).find((l) => l.rmComponents.includes(value))
      )
  }
}
export async function saveLookup(kind: LookupKind, value: string, existing?: LookupValue) {
  assertValid(validateLookupValue(value))
  const normalized = clean(value)
  await db.transaction('rw', allTables, async () => {
    if (
      (await db.lookupValues.where('[kind+value]').equals([kind, normalized]).first()) &&
      normalized !== existing?.value
    )
      throw invalid('value', 'This value already exists.')
    if (existing && existing.value !== normalized && isSystemLookup(kind, existing.value))
      throw invalid('value', `${existing.value} is used by app calculations and cannot be renamed.`)
    if (existing && existing.value !== normalized && (await lookupInUse(kind, existing.value)))
      throw invalid('value', 'This value is in use. Reassign records before renaming it.')
    await db.lookupValues.put(
      existing
        ? { ...existing, value: normalized, updatedAt: now() }
        : stamp({
            kind,
            value: normalized,
            sort:
              Math.max(
                -1,
                ...(await db.lookupValues.where('kind').equals(kind).toArray()).map((v) => v.sort),
              ) + 1,
          }),
    )
  })
}
export async function deleteLookup(item: LookupValue) {
  if (isSystemLookup(item.kind, item.value))
    throw new Error(`${item.value} is used by app calculations and cannot be deleted.`)
  await db.transaction('rw', allTables, async () => {
    if (await lookupInUse(item.kind, item.value))
      throw new Error('This value is in use. Reassign records before deleting it.')
    await db.lookupValues.delete(item.id)
  })
}

export async function resetData() {
  await db.transaction('rw', allTables, async () => {
    for (const table of allTables) await table.clear()
  })
}
export async function exportData() {
  return {
    app: 'Supply Chain Control Tower',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    data: await getData(),
  }
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)
const isDate = (s: string) =>
  !s ||
  (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
    new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s)
const fields: Record<
  keyof DataSet,
  {
    strings: string[]
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
  activityLogs: { strings: ['entityType', 'entityId', 'message', 'kind'] },
  lookupValues: { strings: ['kind', 'value'], numbers: ['sort'] },
  settings: { strings: ['key', 'value'] },
}
export function parseImport(raw: unknown): DataSet {
  if (
    !isObject(raw) ||
    raw.schemaVersion !== SCHEMA_VERSION ||
    raw.app !== 'Supply Chain Control Tower' ||
    typeof raw.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.exportedAt)) ||
    !isObject(raw.data)
  )
    throw new Error('Unsupported JSON backup or schema version.')
  const source = raw.data,
    ids = new Set<string>(),
    data = {} as DataSet
  for (const key of dataKeys) {
    const rows = source[key]
    if (!Array.isArray(rows)) throw new Error(`Missing ${key} records.`)
    for (const row of rows) {
      if (
        !isObject(row) ||
        typeof row.id !== 'string' ||
        !row.id.trim() ||
        typeof row.createdAt !== 'string' ||
        typeof row.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.createdAt)) ||
        !Number.isFinite(Date.parse(row.updatedAt))
      )
        throw new Error(`Invalid ${key} record ID or timestamps.`)
      if (ids.has(row.id)) throw new Error(`Duplicate record ID ${row.id}.`)
      ids.add(row.id)
      for (const name of fields[key].strings)
        if (typeof row[name] !== 'string') throw new Error(`Invalid ${key}.${name}.`)
      for (const name of fields[key].numbers || [])
        if (!Number.isInteger(row[name]) || Number(row[name]) < 0)
          throw new Error(`Invalid ${key}.${name}.`)
      for (const name of fields[key].booleans || [])
        if (typeof row[name] !== 'boolean') throw new Error(`Invalid ${key}.${name}.`)
      for (const name of fields[key].arrays || [])
        if (
          !Array.isArray(row[name]) ||
          !(row[name] as unknown[]).every((v) => typeof v === 'string')
        )
          throw new Error(`Invalid ${key}.${name}.`)
      for (const name of fields[key].dates || [])
        if (!isDate(String(row[name]))) throw new Error(`Invalid ${key}.${name}.`)
    }
    ;(data as unknown as Record<string, unknown>)[key] = rows
  }
  if (!data.settings.some((s) => s.key === 'initialized'))
    throw new Error('Backup is missing its initialization record.')
  if (
    new Set(data.lookupValues.map((value) => `${value.kind}\u0000${value.value}`)).size !==
    data.lookupValues.length
  )
    throw new Error('Backup has duplicate dropdown values.')
  if (new Set(data.settings.map((setting) => setting.key)).size !== data.settings.length)
    throw new Error('Backup has duplicate setting keys.')
  return data
}
function validateRelations(data: DataSet) {
  const allIds = dataKeys.flatMap((key) => data[key].map((row) => row.id))
  if (new Set(allIds).size !== allIds.length)
    throw new Error('A record ID is used by more than one table.')
  if (
    new Set(data.lookupValues.map((value) => `${value.kind}\u0000${value.value}`)).size !==
    data.lookupValues.length
  )
    throw new Error('Dropdown values collide after merge.')
  if (new Set(data.settings.map((setting) => setting.key)).size !== data.settings.length)
    throw new Error('Setting keys collide after merge.')
  const products = new Set(data.products.map((x) => x.id)),
    lots = new Map(data.lots.map((x) => [x.id, x])),
    shipments = new Set(data.shipments.map((x) => x.id))
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
  for (const value of data.lookupValues)
    if (!kinds.has(value.kind) || !value.value.trim())
      throw new Error('A dropdown value has an invalid kind or blank label.')
  const lookup = (kind: LookupKind, value: string) =>
    !value || data.lookupValues.some((v) => v.kind === kind && v.value === value)
  for (const p of data.products)
    if (!p.name.trim() || !p.segment.trim())
      throw new Error('A product is missing its name or segment.')
  for (const p of data.products)
    if (!lookup('segment', p.segment))
      throw new Error(`Product ${p.name} references a missing segment.`)
  for (const l of data.lots) {
    if (!products.has(l.productId)) throw new Error(`Lot ${l.label} has a missing product.`)
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
      throw new Error(`Lot ${l.label} references a missing dropdown value.`)
    if (l.reworkQty > l.freshProductionQty)
      throw new Error(`Lot ${l.label} has rework above production.`)
    if (l.rmMode !== 'all' && l.rmMode !== 'components')
      throw new Error(`Lot ${l.label} has an invalid RM mode.`)
    if (l.rmMode === 'components' && l.rmComponents.includes('Kit (All Together)'))
      throw new Error(`Lot ${l.label} mixes kit and components.`)
  }
  for (const r of data.grnReceipts)
    if (!lots.has(r.lotId) || !r.label.trim() || !r.date || r.quantity <= 0)
      throw new Error('A GRN receipt has a missing lot or invalid receipt fields.')
  for (const b of data.rmBatches)
    if (!lots.has(b.lotId) || !b.label.trim() || !lookup('component', b.component))
      throw new Error('An RM batch has a missing lot or component.')
  for (const l of data.lots)
    if (totalGrn(data.grnReceipts.filter((r) => r.lotId === l.id)) > l.lotQty)
      throw new Error(`GRN exceeds lot quantity for ${l.label}.`)
  for (const s of data.shipments)
    if (!s.number.trim() || !s.vessel.trim() || !lookup('shipmentStage', s.stage))
      throw new Error('A shipment is missing its invoice number, vessel, or valid stage.')
  for (const i of data.shipmentItems)
    if (!shipments.has(i.shipmentId) || !products.has(i.productId) || i.quantity <= 0)
      throw new Error('A shipment line has a missing shipment, product, or positive quantity.')
  for (const r of data.etaRevisions)
    if (!shipments.has(r.shipmentId)) throw new Error('An ETA revision has a missing shipment.')
  for (const a of data.activityLogs)
    if (
      (a.entityType !== 'lot' && a.entityType !== 'shipment') ||
      (a.entityType === 'lot' && !lots.has(a.entityId)) ||
      (a.entityType === 'shipment' && !shipments.has(a.entityId))
    )
      throw new Error('An activity record has a missing parent or invalid type.')
}
export async function importData(raw: unknown, mode: 'merge' | 'replace') {
  const incoming = parseImport(raw)
  const current = mode === 'merge' ? await getData() : null
  if (current) {
    incoming.lookupValues = incoming.lookupValues.filter(
      (value) =>
        !current.lookupValues.some(
          (existing) =>
            existing.id !== value.id &&
            existing.kind === value.kind &&
            existing.value === value.value,
        ),
    )
    incoming.settings = incoming.settings.filter(
      (setting) =>
        !current.settings.some(
          (existing) => existing.id !== setting.id && existing.key === setting.key,
        ),
    )
  }
  const combined = {} as DataSet
  for (const key of dataKeys) {
    const rows = current
      ? [...new Map([...current[key], ...incoming[key]].map((row) => [row.id, row])).values()]
      : incoming[key]
    ;(combined as unknown as Record<string, unknown>)[key] = rows
  }
  validateRelations(combined)
  await db.transaction('rw', allTables, async () => {
    if (mode === 'replace') for (const table of allTables) await table.clear()
    for (const key of dataKeys) await db.table(key).bulkPut(incoming[key])
  })
  return Object.fromEntries(dataKeys.map((key) => [key, incoming[key].length])) as Record<
    keyof DataSet,
    number
  >
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
const csvCell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  return [
    keys.map(csvCell).join(','),
    ...rows.map((row) => keys.map((k) => csvCell(row[k])).join(',')),
  ].join('\r\n')
}
export const freshId = uid
