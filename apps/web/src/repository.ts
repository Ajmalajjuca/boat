import { parseImport, validateRelations } from '@boat/domain/backup'
import { db, allTables, getData, SCHEMA_VERSION } from './db'
import { demoData, seedLookups } from './demo'
import { effectiveShipmentEta, sum, totalGrn } from './calculations'
import {
  actorName,
  hashSecret,
  newRecoveryKey,
  newSalt,
  normalizeRecoveryKey,
  requireAction,
  requireLotEdit,
  validatePin,
} from './access'
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
  UserProfile,
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
  validateUser,
  ValidationError,
} from './validation'

export { parseImport }

const required = (s: string, name: string) => {
  if (!s.trim()) throw new Error(`${name} is required.`)
}
const invalid = (field: string, message: string) => new ValidationError({ [field]: message })
const log = (
  entityType: ActivityLog['entityType'],
  entityId: string,
  message: string,
  kind: string,
) => {
  const actor = actorName()
  return db.activityLogs.add(
    stamp({ entityType, entityId, message, kind, ...(actor ? { actor } : {}) }),
  )
}
const clean = (s: string) => s.trim()
const sameText = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase()
// Exported backups are validated against Settings values, so saved records must use them too.
async function requireLookup(kind: LookupKind, value: string, field: string) {
  if (value && !(await db.lookupValues.where('[kind+value]').equals([kind, value]).first()))
    throw invalid(field, `"${value}" is no longer in Settings. Choose another option.`)
}

export async function initialize(choice: 'demo' | 'empty') {
  requireAction('manageData')
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
  requireAction('editProducts')
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
  requireAction('deleteProducts')
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
      if (old) requireLotEdit(old, input)
      else requireAction('createLots')
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
  requireAction('deleteLots')
  await db.transaction('rw', db.lots, db.rmBatches, db.grnReceipts, db.activityLogs, async () =>
    deleteLotInside(id),
  )
}

export async function saveBatch(item: RMBatch) {
  assertValid(validateBatch(item))
  await db.transaction('rw', db.rmBatches, db.lots, db.activityLogs, async () => {
    const lot = await db.lots.get(item.lotId)
    if (!lot) throw new Error('Lot no longer exists.')
    requireLotEdit(lot)
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
  requireAction('deleteEntries')
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
    requireLotEdit(lot)
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
  requireAction('deleteEntries')
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
  if (entityType === 'shipment') requireAction('editShipments')
  else {
    const lot = await db.lots.get(entityId)
    if (!lot) throw new Error('Lot no longer exists.')
    requireLotEdit(lot)
  }
  await log(entityType, entityId, clean(message), 'note')
}

export async function saveShipment(input: Shipment, lines: ShipmentItem[], reason: string) {
  requireAction('editShipments')
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
  requireAction('deleteShipments')
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
      return (
        !!(await db.lots.where('poc').equals(value).count()) ||
        (await db.users.toArray()).some((user) => user.poc === value)
      )
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
// Lookup checks also read profiles, because a POC profile owns a point-of-contact value.
const lookupTables = [...allTables, db.users]
export async function saveLookup(kind: LookupKind, value: string, existing?: LookupValue) {
  requireAction('manageSettings')
  assertValid(validateLookupValue(value))
  const normalized = clean(value)
  await db.transaction('rw', lookupTables, async () => {
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
  requireAction('manageSettings')
  await db.transaction('rw', lookupTables, async () => {
    if (await lookupInUse(item.kind, item.value))
      throw new Error('This value is in use. Reassign records before deleting it.')
    await db.lookupValues.delete(item.id)
  })
}

export async function resetData() {
  requireAction('manageData')
  await db.transaction('rw', allTables, async () => {
    for (const table of allTables) await table.clear()
  })
}
export async function exportData() {
  requireAction('exportBackup')
  return {
    app: 'Supply Chain Control Tower',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    data: await getData(),
  }
}

export async function importData(raw: unknown, mode: 'merge' | 'replace') {
  requireAction('manageData')
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

// Role profiles. They live only in this browser and are left out of backups and resets.
const recoveryKey = 'recoveryKey'
async function pinFields(pin: string) {
  const pinSalt = newSalt()
  return { pinSalt, pinHash: await hashSecret(pin, pinSalt) }
}
export async function checkPin(user: UserProfile, pin: string) {
  if (!user.pinHash) return true
  return (await hashSecret(pin, user.pinSalt)) === user.pinHash
}
// Hashing is awaited outside transactions: IndexedDB commits a transaction that waits on
// non-database work such as crypto.subtle.
async function newRecoveryRecord() {
  const key = newRecoveryKey(),
    salt = newSalt()
  const hash = await hashSecret(normalizeRecoveryKey(key), salt)
  return { key, record: { key: recoveryKey, value: JSON.stringify({ salt, hash }) } }
}
// Creates the first admin and turns roles on. Returns the one-time recovery key.
// The caller picks the id so it can mark the profile signed in before the write lands.
export async function setupRoles(id: string, name: string, pin: string, confirm: string) {
  const user: UserProfile = {
    ...stamp({ name: clean(name), role: 'admin' as const, poc: '', pinHash: '', pinSalt: '' }),
    id,
  }
  assertValid(validateUser(user, pin, confirm))
  const secured = { ...user, ...(await pinFields(pin)) },
    recovery = await newRecoveryRecord()
  await db.transaction('rw', db.users, db.localSettings, async () => {
    if (await db.users.count()) throw new Error('Roles are already set up. Sign in as an admin.')
    await db.users.add(secured)
    await db.localSettings.put(recovery.record)
  })
  return { user: secured, recoveryKey: recovery.key }
}
export async function saveUser(input: UserProfile, pin: string, confirm: string) {
  requireAction('manageSettings')
  const item = {
    ...input,
    name: clean(input.name),
    poc: input.role === 'poc' ? input.poc : '',
    updatedAt: now(),
  }
  assertValid(validateUser(item, pin, confirm))
  const secured = pin ? { ...item, ...(await pinFields(pin)) } : item
  await db.transaction('rw', db.users, db.lookupValues, async () => {
    const users = await db.users.toArray(),
      old = users.find((u) => u.id === item.id)
    if (users.some((u) => u.id !== item.id && sameText(u.name, item.name)))
      throw invalid('name', `A profile named ${item.name} already exists.`)
    if (item.role === 'poc') await requireLookup('poc', item.poc, 'poc')
    if (
      old?.role === 'admin' &&
      item.role !== 'admin' &&
      users.filter((u) => u.role === 'admin').length === 1
    )
      throw invalid('role', 'Keep at least one admin. Make another profile admin first.')
    await db.users.put(secured)
  })
  return secured
}
export async function deleteUser(user: UserProfile, signedInId: string) {
  requireAction('manageSettings')
  if (user.id === signedInId)
    throw new Error('You cannot delete the profile you are signed in with.')
  await db.transaction('rw', db.users, async () => {
    const admins = await db.users.where('id').notEqual(user.id).toArray()
    if (user.role === 'admin' && !admins.some((u) => u.role === 'admin'))
      throw new Error('Keep at least one admin.')
    await db.users.delete(user.id)
  })
}
export async function changeOwnPin(
  user: UserProfile,
  current: string,
  pin: string,
  confirm: string,
) {
  if (!(await checkPin(user, current))) throw invalid('current', 'The current PIN is not correct.')
  const message = validatePin(pin)
  if (message) throw invalid('pin', message)
  if (pin !== confirm) throw invalid('confirm', 'The two PINs do not match.')
  const latest = await db.users.get(user.id)
  if (!latest) throw new Error('This profile no longer exists.')
  await db.users.put({ ...latest, ...(await pinFields(pin)), updatedAt: now() })
}
// Lets someone who has the recovery key set a new PIN for an admin profile.
export async function recoverAdmin(key: string, adminId: string, pin: string, confirm: string) {
  const stored = await db.localSettings.get(recoveryKey)
  const saved = stored ? (JSON.parse(stored.value) as { salt: string; hash: string }) : null
  if (!saved || (await hashSecret(normalizeRecoveryKey(key), saved.salt)) !== saved.hash)
    throw invalid('key', 'This recovery key is not correct.')
  const admin = await db.users.get(adminId)
  if (!admin || admin.role !== 'admin') throw invalid('admin', 'Choose an admin profile.')
  const message = validatePin(pin)
  if (message) throw invalid('pin', message)
  if (pin !== confirm) throw invalid('confirm', 'The two PINs do not match.')
  const next = { ...admin, ...(await pinFields(pin)), updatedAt: now() }
  await db.users.put(next)
  return next
}
export async function replaceRecoveryKey() {
  requireAction('manageSettings')
  const recovery = await newRecoveryRecord()
  await db.localSettings.put(recovery.record)
  return recovery.key
}
export async function turnOffRoles() {
  requireAction('manageSettings')
  await db.transaction('rw', db.users, db.localSettings, async () => {
    await db.users.clear()
    await db.localSettings.delete(recoveryKey)
  })
}
export async function setLockMinutes(minutes: number) {
  requireAction('manageSettings')
  await db.localSettings.put({ key: 'lockMinutes', value: String(minutes) })
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
