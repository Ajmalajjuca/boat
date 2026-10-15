import { randomUUID } from 'node:crypto'
import { effectiveShipmentEta } from '@boat/domain/calculations'
import type { Shipment, ShipmentItem } from '@boat/domain/models'
import {
  assertValid,
  type FieldErrors,
  validateShipment,
  ValidationError,
} from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { type Actor, actorOf, recordActivity } from '../../core/audit'
import type { RecordsDeps } from '../../core/clock'
import { toCsv } from '../../core/csv'
import { fromDbDate, toDbDate } from '../../core/dates'
import { ConflictError, NotFoundError } from '../../core/errors'
import { type Page, pageOf } from '../../core/pagination'
import type { Db } from '../../core/prisma'
import { Prisma, type PrismaClient } from '../../generated/prisma/client'
import { entryView } from '../activity/activity.service'
import { resolveLookups } from '../lookups/resolve'
import {
  getShipmentDetail,
  shipmentInclude,
  type ShipmentRow,
  shipmentView,
  type ShipmentView,
  toDomainShipment,
} from './shipment-view'

export type ShipmentInput = {
  number: string
  vessel: string
  etd: string | null
  plannedEta: string | null
  revisedEta: string | null
  actualArrival: string | null
  stageId: string | null
  remarks: string
  items: { productId: string; quantity: number }[]
}
export type ShipmentPatch = Partial<ShipmentInput> & { version: number; etaChangeReason?: string }

export async function lockShipment(db: Db, id: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM shipments WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`
  if (!rows.length) throw new NotFoundError()
  return db.shipment.findUniqueOrThrow({ where: { id }, include: shipmentInclude })
}

// validateShipment names line fields line:<id>:<field>. Lines here are numbered by position, so
// line:2:quantity becomes items.2.quantity, the path the request itself used.
const lineNames = (errors: FieldErrors): FieldErrors =>
  Object.fromEntries(
    Object.entries(errors).map(([key, message]) => {
      const line = /^line:(\d+):(\w+)$/.exec(key)
      return [line ? `items.${line[1]}.${line[2]}` : key === 'lines' ? 'items' : key, message]
    }),
  )

// FR-6.1 to FR-6.3 through the shared validateShipment, the stage through Settings (FR-8.3), and
// each line's product through the product table. FOR SHARE on the products means a product
// delete running at the same moment either waits and then sees this line, or wins and this
// save is refused.
async function checkShipment(db: Db, id: string, input: ShipmentInput, date: string) {
  const productIds = [...new Set(input.items.map((i) => i.productId))]
  const products = productIds.length
    ? await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM products
        WHERE id IN (${Prisma.join(productIds.map((p) => Prisma.sql`${p}::uuid`))}) AND deleted_at IS NULL
        FOR SHARE`
    : []
  const found = new Set(products.map((p) => p.id))
  const { valueOf, errors } = await resolveLookups(db, [
    { field: 'stageId', kind: 'shipmentStage', id: input.stageId, label: 'a shipment stage' },
  ])
  const shipment: Shipment = {
    id,
    createdAt: '',
    updatedAt: '',
    number: input.number.trim(),
    vessel: input.vessel.trim(),
    etd: input.etd ?? '',
    plannedEta: input.plannedEta ?? '',
    revisedEta: input.revisedEta ?? '',
    actualArrival: input.actualArrival ?? '',
    stage: valueOf(input.stageId),
    remarks: input.remarks.trim(),
  }
  const items: ShipmentItem[] = input.items.map((item, i) => ({
    id: String(i),
    createdAt: '',
    updatedAt: '',
    shipmentId: id,
    productId: item.productId,
    quantity: item.quantity,
  }))
  const missing: FieldErrors = Object.fromEntries(
    input.items.flatMap((item, i) =>
      found.has(item.productId) ? [] : [[`items.${i}.productId`, 'This product no longer exists.']],
    ),
  )
  assertValid({ ...lineNames(validateShipment(shipment, items, date)), ...missing, ...errors })
  return shipment
}

const inputOf = (row: ShipmentRow): ShipmentInput => ({
  number: row.number,
  vessel: row.vessel,
  etd: fromDbDate(row.etd),
  plannedEta: fromDbDate(row.plannedEta),
  revisedEta: fromDbDate(row.revisedEta),
  actualArrival: fromDbDate(row.actualArrival),
  stageId: row.stageId,
  remarks: row.remarks,
  items: row.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
})

const shipmentData = (input: ShipmentInput, s: Shipment) => ({
  number: s.number,
  vessel: s.vessel,
  etd: toDbDate(input.etd),
  plannedEta: toDbDate(input.plannedEta),
  revisedEta: toDbDate(input.revisedEta),
  actualArrival: toDbDate(input.actualArrival),
  stageId: input.stageId,
  remarks: s.remarks,
})

// FR-6.1: the partial unique index on number is case-insensitive (citext).
const duplicateNumber =
  (number: string) =>
  (err: unknown): never => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      throw new ValidationError({ number: `Shipment ${number} already exists.` })
    throw err
  }

// Lines are keyed by product (FR-6.2: a product appears once). Returns whether anything changed.
async function syncItems(
  db: Db,
  user: SessionUser,
  current: ShipmentRow,
  items: ShipmentInput['items'],
) {
  const before = new Map(current.items.map((i) => [i.productId, i]))
  const after = new Map(items.map((i) => [i.productId, i.quantity]))
  let changed = false
  for (const [productId, line] of before)
    if (!after.has(productId)) {
      await db.shipmentItem.update({
        where: { id: line.id },
        data: { deletedAt: new Date(), deletedBy: user.id },
      })
      changed = true
    }
  for (const [productId, quantity] of after) {
    const line = before.get(productId)
    if (!line)
      await db.shipmentItem.create({ data: { shipmentId: current.id, productId, quantity } })
    else if (line.quantity !== quantity)
      await db.shipmentItem.update({ where: { id: line.id }, data: { quantity } })
    else continue
    changed = true
  }
  return changed
}

const notSet = (d: string) => d || 'Not set'
const spaced = (field: string) => field.replace(/([A-Z])/g, ' $1').toLowerCase()

// FR-6.4, as the demo's saveShipment: one immutable revision when the planned ETA changes, and
// one when the effective ETA (revised, else planned) changes. History mirrors each.
async function recordChanges(
  db: Db,
  actor: Actor,
  old: Shipment,
  next: Shipment,
  reason: string,
  linesChanged: boolean,
) {
  const entityId = old.id
  const revise = async (
    kind: 'planned' | 'current',
    previous: string,
    current: string,
    label: string,
    revisionReason: string,
  ) => {
    await db.etaRevision.create({
      data: {
        shipmentId: entityId,
        kind,
        previousDate: toDbDate(previous || null),
        newDate: toDbDate(current || null),
        reason: revisionReason,
        createdBy: actor.id,
      },
    })
    await recordActivity(db, actor, {
      entityType: 'shipment',
      entityId,
      kind: 'eta',
      message: `${label}: ${notSet(previous)} → ${notSet(current)}${reason ? ` (${reason})` : ''}`,
    })
  }
  if (old.plannedEta !== next.plannedEta)
    await revise(
      'planned',
      old.plannedEta,
      next.plannedEta,
      'Original planned ETA revised',
      `Original plan${reason ? `: ${reason}` : ''}`,
    )
  if (
    old.revisedEta !== next.revisedEta &&
    effectiveShipmentEta(old) !== effectiveShipmentEta(next)
  )
    await revise(
      'current',
      effectiveShipmentEta(old),
      effectiveShipmentEta(next),
      'Current ETA revised',
      reason,
    )
  const fields = ['number', 'vessel', 'etd', 'actualArrival', 'stage', 'remarks'] as const
  const changed = fields.filter((k) => old[k] !== next[k])
  if (changed.length)
    await recordActivity(db, actor, {
      entityType: 'shipment',
      entityId,
      kind: 'updated',
      message: `Updated ${changed.map(spaced).join(', ')}`,
      changes: Object.fromEntries(changed.map((k) => [k, [old[k], next[k]]])),
    })
  if (linesChanged)
    await recordActivity(db, actor, {
      entityType: 'shipment',
      entityId,
      kind: 'lines',
      message: 'Product lines updated',
    })
}

export async function createShipment(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  input: ShipmentInput,
) {
  const date = await clock.today()
  const id = randomUUID()
  await db.$transaction(async (tx) => {
    const shipment = await checkShipment(tx, id, input, date)
    await tx.shipment
      .create({ data: { id, ...shipmentData(input, shipment) } })
      .catch(duplicateNumber(shipment.number))
    await tx.shipmentItem.createMany({
      data: input.items.map((i) => ({
        shipmentId: id,
        productId: i.productId,
        quantity: i.quantity,
      })),
    })
    await recordActivity(tx, actorOf(user), {
      entityType: 'shipment',
      entityId: id,
      kind: 'created',
      message: `Shipment ${shipment.number} created`,
    })
  })
  return getShipmentDetail(db, id, date)
}

export async function updateShipment(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  id: string,
  patch: ShipmentPatch,
) {
  const date = await clock.today()
  await db.$transaction(async (tx) => {
    const current = await lockShipment(tx, id)
    const { version, etaChangeReason, ...changes } = patch
    if (version !== current.version)
      throw new ConflictError(
        'Someone else changed this shipment. Review their changes and try again.',
        await getShipmentDetail(tx, id, date),
      )
    const input: ShipmentInput = { ...inputOf(current), ...changes }
    const old = toDomainShipment(current)
    const next = await checkShipment(tx, id, input, date)
    await tx.shipment
      .update({ where: { id }, data: { ...shipmentData(input, next), version: { increment: 1 } } })
      .catch(duplicateNumber(next.number))
    const linesChanged = await syncItems(tx, user, current, input.items)
    await recordChanges(tx, actorOf(user), old, next, (etaChangeReason ?? '').trim(), linesChanged)
  })
  return getShipmentDetail(db, id, date)
}

export async function deleteShipment({ db }: RecordsDeps, user: SessionUser, id: string) {
  await db.$transaction(async (tx) => {
    const current = await lockShipment(tx, id)
    const stamp = { deletedAt: new Date(), deletedBy: user.id }
    await tx.shipmentItem.updateMany({ where: { shipmentId: id, deletedAt: null }, data: stamp })
    await tx.shipment.update({ where: { id }, data: stamp })
    // ETA revisions are insert-only and stay; the shipment's history records the delete.
    await recordActivity(tx, actorOf(user), {
      entityType: 'shipment',
      entityId: id,
      kind: 'deleted',
      message: `Shipment ${current.number} deleted`,
    })
  })
}

export const shipmentFlagNames = ['open', 'soon', 'overdue', 'revised', 'arrived'] as const
export type ShipmentFlag = (typeof shipmentFlagNames)[number]
export const shipmentSorts = ['eta-asc', 'eta-desc', 'qty-desc', 'number-asc'] as const
export type ShipmentSort = (typeof shipmentSorts)[number]
export type ShipmentFilters = {
  q: string
  stageId?: string
  vessel?: string
  flag?: ShipmentFlag
  sort: ShipmentSort
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const eta = (v: ShipmentView) => v.computed.currentEta ?? '9999'
// The demo's sorts; a shipment with no ETA sorts as 9999, last going up.
const sorts: Record<ShipmentSort, (a: ShipmentView, b: ShipmentView) => number> = {
  'eta-asc': (a, b) => compareText(eta(a), eta(b)),
  'eta-desc': (a, b) => compareText(eta(b), eta(a)),
  'qty-desc': (a, b) => b.computed.totalQty - a.computed.totalQty,
  'number-asc': (a, b) => compareText(a.number, b.number),
}

// Shipments are few (one per invoice), so they are filtered in memory with the domain's own
// flags. Lots run to tens of thousands and need SQL; shipments don't.
async function matchingShipments(db: Db, f: ShipmentFilters, date: string) {
  const rows = await db.shipment.findMany({
    where: {
      deletedAt: null,
      ...(f.stageId && { stageId: f.stageId }),
      ...(f.vessel && { vessel: f.vessel }),
    },
    include: shipmentInclude,
  })
  const term = f.q.trim().toLowerCase()
  return rows
    .map((row) => shipmentView(row, date))
    .filter(
      (v) =>
        (!term ||
          `${v.number} ${v.vessel} ${v.items.map((i) => i.product.name).join(' ')}`
            .toLowerCase()
            .includes(term)) &&
        (!f.flag || v.computed.flags[f.flag]),
    )
    .sort(sorts[f.sort])
}

export async function listShipments(
  { db, clock }: RecordsDeps,
  filters: ShipmentFilters,
  page: Page,
) {
  const all = await matchingShipments(db, filters, await clock.today())
  const start = (page.page - 1) * page.pageSize
  return pageOf(all.slice(start, start + page.pageSize), all.length, page)
}

// The demo's cards, over every active shipment.
export async function shipmentCards({ db, clock }: RecordsDeps) {
  const all = await matchingShipments(db, { q: '', sort: 'eta-asc' }, await clock.today())
  const count = (flag: ShipmentFlag) => all.filter((v) => v.computed.flags[flag]).length
  return {
    open: count('open'),
    soon: count('soon'),
    overdue: count('overdue'),
    revised: count('revised'),
    arrived: count('arrived'),
    openUnits: all
      .filter((v) => v.computed.flags.open)
      .reduce((n, v) => n + v.computed.totalQty, 0),
  }
}

// The demo's CSV columns (Shipments.tsx).
const csvHeaders = [
  'Invoice',
  'Vessel',
  'Products',
  'TotalQty',
  'ETD',
  'PlannedETA',
  'CurrentETA',
  'ActualWarehouseArrival',
  'Stage',
  'Status',
  'ETASlipDays',
  'ActualArrivalDelayDays',
  'Remarks',
]

export async function exportShipmentsCsv({ db, clock }: RecordsDeps, filters: ShipmentFilters) {
  const date = await clock.today()
  const rows = (await matchingShipments(db, filters, date)).map((v) => ({
    Invoice: v.number,
    Vessel: v.vessel,
    Products: v.items.map((i) => `${i.product.name} (${i.quantity})`).join('; '),
    TotalQty: v.computed.totalQty,
    ETD: v.etd ?? '',
    PlannedETA: v.plannedEta ?? '',
    CurrentETA: v.computed.currentEta ?? '',
    ActualWarehouseArrival: v.actualArrival ?? '',
    Stage: v.stage?.value ?? '',
    Status: v.computed.status,
    ETASlipDays: v.computed.etaSlip ?? '',
    ActualArrivalDelayDays: v.computed.arrivalDelay ?? '',
    Remarks: v.remarks,
  }))
  return { filename: `shipments-${date}.csv`, body: toCsv(csvHeaders, rows) }
}

// FR-7.2 for shipments: users who may edit shipments may add a note.
export async function addShipmentNote(
  db: PrismaClient,
  user: SessionUser,
  id: string,
  message: string,
) {
  const text = message.trim()
  if (!text) throw new ValidationError({ message: 'Write a note first.' })
  return db.$transaction(async (tx) => {
    await lockShipment(tx, id)
    const entry = await recordActivity(tx, actorOf(user), {
      entityType: 'shipment',
      entityId: id,
      kind: 'note',
      message: text,
    })
    return entryView(entry)
  })
}
