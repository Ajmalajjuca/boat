import { BackupError, parseImport, validateRelations } from '@boat/domain/backup'
import { type DataSet, dataKeys, type LookupKind } from '@boat/domain/models'
import { ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { holdDataLockExclusive } from '../../core/data-lock'
import { toDbDate } from '../../core/dates'
import type { Db } from '../../core/prisma'
import type { PrismaClient } from '../../generated/prisma/client'
import { refreshCompletion } from '../lots/lot-lock'
import { knownTimeZone, type SettingsService } from '../settings/settings.service'
import { currentDataSet } from './backup-mapping'
import { softDeleteBusinessRecords } from './reset.service'

export type ImportMode = 'merge' | 'replace'
type Ref = (kind: LookupKind, value: string) => string | null

const folded = (s: string) => s.trim().toLowerCase()
const keyOf = (kind: string, value: string) => `${kind}\u0000${folded(value)}`
const date = (s: string) => toDbDate(s || null)
const times = (r: { createdAt: string; updatedAt: string }) => ({
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
})
const revive = { deletedAt: null, deletedBy: null }

// Every primary key is a Postgres uuid, stored in lowercase. The demo's ids are crypto.randomUUID()
// values; anything else would fail on insert, or slip past the duplicate-id checks.
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
function checkIds(data: DataSet) {
  for (const key of dataKeys)
    for (const row of data[key])
      if (!canonicalUuid.test(row.id)) throw new BackupError(`Invalid ${key} record ID ${row.id}.`)
}

// In merge mode, rows the file overwrites are soft-deleted first, so the writes below only ever
// revive them. Unique names then can't collide halfway through (two products swapping names),
// because validateRelations has already checked the final state.
async function setAsideExisting(db: Db, data: DataSet, userId: string) {
  const stamp = { deletedAt: new Date(), deletedBy: userId }
  const by = (rows: { id: string }[]) => ({
    where: { id: { in: rows.map((r) => r.id) }, deletedAt: null },
    data: stamp,
  })
  await db.shipmentItem.updateMany(by(data.shipmentItems))
  await db.shipment.updateMany(by(data.shipments))
  await db.grnReceipt.updateMany(by(data.grnReceipts))
  await db.rmBatch.updateMany(by(data.rmBatches))
  await db.lot.updateMany(by(data.lots))
  await db.product.updateMany(by(data.products))
}

// FR-7.1: each lot and shipment the file brings in gets a history entry naming the user.
async function recordImported(db: Db, data: DataSet, user: SessionUser, mode: ImportMode) {
  const entry = {
    kind: 'imported',
    message: `Imported from a backup (${mode})`,
    actorId: user.id,
    actorName: user.name,
  }
  await db.activityLog.createMany({
    data: [
      ...data.lots.map((l) => ({ ...entry, entityType: 'lot' as const, entityId: l.id })),
      ...data.shipments.map((s) => ({ ...entry, entityType: 'shipment' as const, entityId: s.id })),
    ],
  })
}

// The demo's messages name the problem; the API reports them against the uploaded file.
function asFileError(err: unknown): never {
  if (err instanceof BackupError) throw new ValidationError({ file: err.message })
  throw err
}

const byId = <T extends { id: string }>(current: T[], incoming: T[]) => [
  ...new Map([...current, ...incoming].map((row) => [row.id, row])).values(),
]

// What the database will hold afterwards, for validateRelations. Merge: current records, with
// incoming ones overwriting by id (the demo's merge). Replace: the incoming records only. Dropdown
// values always merge by text, and settings come only from the file.
function afterImport(current: DataSet, incoming: DataSet, mode: ImportMode): DataSet {
  const known = new Set(current.lookupValues.map((v) => keyOf(v.kind, v.value)))
  const lookupValues = [
    ...current.lookupValues,
    ...incoming.lookupValues.filter((v) => !known.has(keyOf(v.kind, v.value))),
  ]
  if (mode === 'replace') return { ...incoming, lookupValues }
  return {
    products: byId(current.products, incoming.products),
    lots: byId(current.lots, incoming.lots),
    rmBatches: byId(current.rmBatches, incoming.rmBatches),
    grnReceipts: byId(current.grnReceipts, incoming.grnReceipts),
    shipments: byId(current.shipments, incoming.shipments),
    shipmentItems: byId(current.shipmentItems, incoming.shipmentItems),
    etaRevisions: byId(current.etaRevisions, incoming.etaRevisions),
    activityLogs: byId(current.activityLogs, incoming.activityLogs),
    lookupValues,
    settings: incoming.settings,
  }
}

// Dropdown values match by kind and text, ignoring case: a backup's "on track" is the database's
// "On Track", system values included. Missing values are created. Backups refer to dropdowns by
// text, so a created value doesn't need the backup's id.
async function importLookups(db: Db, values: DataSet['lookupValues']): Promise<Ref> {
  const existing = await db.lookupValue.findMany({
    where: { deletedAt: null },
    select: { id: true, kind: true, value: true },
  })
  const ids = new Map(existing.map((v) => [keyOf(v.kind, v.value), v.id]))
  for (const v of values) {
    const key = keyOf(v.kind, v.value)
    if (ids.has(key)) continue
    const created = await db.lookupValue.create({
      data: { kind: v.kind, value: v.value.trim(), sort: v.sort },
    })
    ids.set(key, created.id)
  }
  return (kind, value) => (value.trim() ? (ids.get(keyOf(kind, value)) ?? null) : null)
}

// Inserts new ids and overwrites existing ones, reviving rows a replace or an earlier delete
// soft-deleted.
async function upsertAll<T extends { id: string }>(
  rows: T[],
  findIds: (ids: string[]) => Promise<{ id: string }[]>,
  create: (rows: T[]) => Promise<unknown>,
  update: (row: T) => Promise<unknown>,
) {
  if (!rows.length) return
  const existing = new Set((await findIds(rows.map((r) => r.id))).map((r) => r.id))
  const fresh = rows.filter((r) => !existing.has(r.id))
  if (fresh.length) await create(fresh)
  for (const row of rows) if (existing.has(row.id)) await update(row)
}

async function writeRecords(db: Db, data: DataSet, ref: Ref, userId: string) {
  const ids = (ids: string[]) => ({ where: { id: { in: ids } }, select: { id: true } })

  const product = (p: DataSet['products'][number]) => ({
    name: p.name.trim(),
    variant: p.variant.trim(),
    segmentId: ref('segment', p.segment)!,
    ...times(p),
  })
  await upsertAll(
    data.products,
    (list) => db.product.findMany(ids(list)),
    (rows) => db.product.createMany({ data: rows.map((p) => ({ id: p.id, ...product(p) })) }),
    (p) =>
      db.product.update({
        where: { id: p.id },
        data: { ...product(p), ...revive, version: { increment: 1 } },
      }),
  )

  // grn_total starts at 0 and refreshCompletion sets it from the receipts below, so the
  // "GRN ≤ lot quantity" check holds at every step.
  const lot = (l: DataSet['lots'][number]) => ({
    productId: l.productId,
    label: l.label.trim(),
    categoryId: ref('category', l.category)!,
    directFg: l.directFg,
    emsId: ref('ems', l.ems),
    pocId: ref('poc', l.poc),
    statusId: ref('status', l.status)!,
    stageId: ref('stage', l.stage)!,
    rmMode: l.rmMode,
    readyQty: l.readyQty,
    lotQty: l.lotQty,
    freshProductionQty: l.freshProductionQty,
    reworkQty: l.reworkQty,
    reworkReason: l.reworkReason,
    rmReadyDate: date(l.rmReadyDate),
    plannedDate: date(l.plannedDate),
    revisedEta: date(l.revisedEta),
    actualDate: date(l.actualDate),
    logisticsId: ref('logistics', l.logisticsMode),
    blockerId: ref('blocker', l.blockerCategory),
    blockerDescription: l.blockerDescription,
    followUpDate: date(l.followUpDate),
    followUpNote: l.followUpNote,
    grnTotal: 0,
    completedOn: null,
    ...times(l),
  })
  await upsertAll(
    data.lots,
    (list) => db.lot.findMany(ids(list)),
    (rows) => db.lot.createMany({ data: rows.map((l) => ({ id: l.id, ...lot(l) })) }),
    (l) =>
      db.lot.update({
        where: { id: l.id },
        data: { ...lot(l), ...revive, version: { increment: 1 } },
      }),
  )
  // A lot's component choices are replaced by the backup's.
  const lotIds = data.lots.map((l) => l.id)
  await db.lotComponent.updateMany({
    where: { lotId: { in: lotIds }, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: userId },
  })
  await db.lotComponent.createMany({
    data: data.lots.flatMap((l) =>
      [...new Set(l.rmComponents)].map((c) => ({ lotId: l.id, componentId: ref('component', c)! })),
    ),
  })

  const batch = (b: DataSet['rmBatches'][number]) => ({
    lotId: b.lotId,
    componentId: ref('component', b.component)!,
    label: b.label.trim(),
    plannedQty: b.plannedQty,
    plannedDate: date(b.plannedDate),
    receivedQty: b.receivedQty,
    receivedDate: date(b.receivedDate),
    status: b.status,
    notes: b.notes,
    ...times(b),
  })
  await upsertAll(
    data.rmBatches,
    (list) => db.rmBatch.findMany(ids(list)),
    (rows) => db.rmBatch.createMany({ data: rows.map((b) => ({ id: b.id, ...batch(b) })) }),
    (b) => db.rmBatch.update({ where: { id: b.id }, data: { ...batch(b), ...revive } }),
  )

  // A receipt the file moves to another lot leaves its old lot's totals to refresh too.
  const movedFrom = (
    await db.grnReceipt.findMany({
      where: { id: { in: data.grnReceipts.map((r) => r.id) } },
      select: { lotId: true },
    })
  ).map((r) => r.lotId)
  const receipt = (r: DataSet['grnReceipts'][number]) => ({
    lotId: r.lotId,
    label: r.label.trim(),
    date: date(r.date)!,
    quantity: r.quantity,
    note: r.note,
    ...times(r),
  })
  await upsertAll(
    data.grnReceipts,
    (list) => db.grnReceipt.findMany(ids(list)),
    (rows) => db.grnReceipt.createMany({ data: rows.map((r) => ({ id: r.id, ...receipt(r) })) }),
    (r) => db.grnReceipt.update({ where: { id: r.id }, data: { ...receipt(r), ...revive } }),
  )
  for (const id of new Set([...lotIds, ...movedFrom, ...data.grnReceipts.map((r) => r.lotId)]))
    await refreshCompletion(db, id)

  const shipment = (s: DataSet['shipments'][number]) => ({
    number: s.number.trim(),
    vessel: s.vessel.trim(),
    etd: date(s.etd),
    plannedEta: date(s.plannedEta),
    revisedEta: date(s.revisedEta),
    actualArrival: date(s.actualArrival),
    stageId: ref('shipmentStage', s.stage),
    remarks: s.remarks,
    ...times(s),
  })
  await upsertAll(
    data.shipments,
    (list) => db.shipment.findMany(ids(list)),
    (rows) => db.shipment.createMany({ data: rows.map((s) => ({ id: s.id, ...shipment(s) })) }),
    (s) =>
      db.shipment.update({
        where: { id: s.id },
        data: { ...shipment(s), ...revive, version: { increment: 1 } },
      }),
  )

  const item = (i: DataSet['shipmentItems'][number]) => ({
    shipmentId: i.shipmentId,
    productId: i.productId,
    quantity: i.quantity,
    ...times(i),
  })
  await upsertAll(
    data.shipmentItems,
    (list) => db.shipmentItem.findMany(ids(list)),
    (rows) => db.shipmentItem.createMany({ data: rows.map((i) => ({ id: i.id, ...item(i) })) }),
    (i) => db.shipmentItem.update({ where: { id: i.id }, data: { ...item(i), ...revive } }),
  )

  // History and ETA revisions are insert-only: an entry whose id is already there is the same
  // entry, so it is skipped. The backup doesn't say which ETA a revision changed; the demo starts
  // every planned-ETA reason with "Original plan".
  const knownRevisions = new Set(
    (await db.etaRevision.findMany(ids(data.etaRevisions.map((r) => r.id)))).map((r) => r.id),
  )
  await db.etaRevision.createMany({
    data: data.etaRevisions
      .filter((r) => !knownRevisions.has(r.id))
      .map((r) => ({
        id: r.id,
        shipmentId: r.shipmentId,
        kind: r.reason.startsWith('Original plan') ? ('planned' as const) : ('current' as const),
        previousDate: date(r.previousDate),
        newDate: date(r.newDate),
        reason: r.reason,
        createdAt: new Date(r.createdAt),
      })),
  })
  const knownEntries = new Set(
    (await db.activityLog.findMany(ids(data.activityLogs.map((a) => a.id)))).map((a) => a.id),
  )
  await db.activityLog.createMany({
    data: data.activityLogs
      .filter((a) => !knownEntries.has(a.id))
      .map((a) => ({
        id: a.id,
        entityType: a.entityType,
        entityId: a.entityId,
        kind: a.kind,
        message: a.message,
        actorName: a.actor ?? null,
        createdAt: new Date(a.createdAt),
      })),
  })
}

// Only the server's two settings come across, and only valid values. The demo's "initialized"
// record and anything unknown are ignored.
async function importSettings(db: Db, rows: DataSet['settings'], userId: string) {
  const put = (key: string, value: string | number) =>
    db.appSetting.upsert({
      where: { key },
      create: { key, value, updatedBy: userId },
      update: { value, updatedBy: userId },
    })
  for (const { key, value } of rows) {
    if (key === 'timeZone' && knownTimeZone(value)) await put(key, value)
    const minutes = Number(value)
    if (key === 'idleTimeoutMinutes' && /^\d+$/.test(value) && minutes >= 5 && minutes <= 720)
      await put(key, minutes)
  }
}

// FR-9.1 and FR-9.3: checks the whole file, then writes it in one transaction.
export async function importBackup(
  db: PrismaClient,
  settings: SettingsService,
  user: SessionUser,
  raw: unknown,
  mode: ImportMode,
) {
  let incoming: DataSet
  try {
    incoming = parseImport(raw)
    checkIds(incoming)
  } catch (err) {
    asFileError(err)
  }
  const imported = await db.$transaction(
    async (tx) => {
      await holdDataLockExclusive(tx)
      try {
        validateRelations(afterImport(await currentDataSet(tx), incoming, mode))
      } catch (err) {
        asFileError(err)
      }
      if (mode === 'replace') await softDeleteBusinessRecords(tx, user, 'a replace import')
      else await setAsideExisting(tx, incoming, user.id)
      const ref = await importLookups(tx, incoming.lookupValues)
      await writeRecords(tx, incoming, ref, user.id)
      await recordImported(tx, incoming, user, mode)
      await importSettings(tx, incoming.settings, user.id)
      return Object.fromEntries(dataKeys.map((key) => [key, incoming[key].length])) as Record<
        keyof DataSet,
        number
      >
    },
    { timeout: 120_000, maxWait: 10_000 },
  )
  settings.forget()
  return { mode, imported }
}
