import { randomUUID } from 'node:crypto'
import { generatedLabel } from '../../core/generated-label'
import type { Lot } from '@boat/domain/models'
import { changedPlanFields, deniedMessage, PermissionError } from '@boat/domain/permissions'
import { assertValid, validateLot, ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf, recordActivity } from '../../core/audit'
import { toCsv } from '../../core/csv'
import type { RecordsDeps } from '../../core/clock'
import { fromDbDate, toDbDate } from '../../core/dates'
import { ConflictError } from '../../core/errors'
import { type Page, pageArgs, pageOf } from '../../core/pagination'
import type { Db } from '../../core/prisma'
import { holdDataLockShared } from '../../core/data-lock'
import { type LookupKind, Prisma } from '../../generated/prisma/client'
import { renameFields, resolveLookups } from '../lookups/resolve'
import { softDeleteLots } from './lot-deletion'
import { countLots, findLotIds, lotCardCounts, type LotFilters, lotGroupRows } from './lot-list'
import { lockLot, lockLotForEdit, refreshCompletion } from './lot-lock'
import {
  batchInclude,
  getLotDetail,
  loadLotViews,
  lotAccess,
  lotInclude,
  type LotRow,
  type LotView,
  toDomainLot,
} from './lot-view'

export type LotInput = {
  productId: string
  label: string
  categoryId: string
  directFg: boolean
  emsId: string | null
  pocId: string | null
  statusId: string
  stageId: string
  rmMode: 'all' | 'components'
  componentIds: string[]
  readyQty: number
  lotQty: number
  freshProductionQty: number
  reworkQty: number
  reworkReason: string
  rmReadyDate: string | null
  plannedDate: string | null
  revisedEta: string | null
  actualDate: string | null
  logisticsId: string | null
  blockerId: string | null
  blockerDescription: string
  followUpDate: string | null
  followUpNote: string
}
export type LotPatch = Partial<LotInput> & { version: number }

type IdField =
  'categoryId' | 'emsId' | 'pocId' | 'statusId' | 'stageId' | 'logisticsId' | 'blockerId'
const references: [IdField, LookupKind, string][] = [
  ['categoryId', 'category', 'a product category'],
  ['emsId', 'ems', 'an EMS'],
  ['pocId', 'poc', 'a point of contact'],
  ['statusId', 'status', 'an overall status'],
  ['stageId', 'stage', 'a stage'],
  ['logisticsId', 'logistics', 'a logistics mode'],
  ['blockerId', 'blocker', 'a blocker category'],
]
// validateLot names fields as the browser does; the API takes ids.
const apiNames = {
  category: 'categoryId',
  ems: 'emsId',
  poc: 'pocId',
  status: 'statusId',
  stage: 'stageId',
  rmComponents: 'componentIds',
  logisticsMode: 'logisticsId',
  blockerCategory: 'blockerId',
}
// The demo's lot fields in its order. History names the ones that changed.
const historyFields: (keyof Lot)[] = [
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
const spaced = (field: string) => field.replace(/([A-Z])/g, ' $1').toLowerCase()

// Checks every reference against Settings (FR-8.3) and the product table, runs the shared
// validateLot, and returns the lot in the domain's shape for plan-field checks and history.
// FOR SHARE on the product keeps a concurrent product delete from missing this lot.
async function checkLot(db: Db, id: string, input: LotInput): Promise<Lot> {
  const product = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM products WHERE id = ${input.productId}::uuid AND deleted_at IS NULL FOR SHARE`
  const { valueOf, errors } = await resolveLookups(db, [
    ...references.map(([field, kind, label]) => ({ field, kind, id: input[field], label })),
    ...input.componentIds.map((cid) => ({
      field: 'componentIds',
      kind: 'component' as const,
      id: cid,
      label: 'components',
    })),
  ])
  const lot: Lot = {
    id,
    createdAt: '',
    updatedAt: '',
    productId: input.productId,
    label: input.label.trim(),
    category: valueOf(input.categoryId),
    directFg: input.directFg,
    ems: valueOf(input.emsId),
    poc: valueOf(input.pocId),
    status: valueOf(input.statusId),
    stage: valueOf(input.stageId),
    rmMode: input.rmMode,
    rmComponents: input.componentIds.map(valueOf).sort(),
    readyQty: input.readyQty,
    lotQty: input.lotQty,
    freshProductionQty: input.freshProductionQty,
    reworkQty: input.reworkQty,
    reworkReason: input.reworkReason.trim(),
    rmReadyDate: input.rmReadyDate ?? '',
    plannedDate: input.plannedDate ?? '',
    revisedEta: input.revisedEta ?? '',
    actualDate: input.actualDate ?? '',
    logisticsMode: valueOf(input.logisticsId),
    blockerCategory: valueOf(input.blockerId),
    blockerDescription: input.blockerDescription.trim(),
    followUpDate: input.followUpDate ?? '',
    followUpNote: input.followUpNote.trim(),
  }
  assertValid({
    ...renameFields(validateLot(lot), apiNames),
    ...(!product.length && { productId: 'This product no longer exists. Choose another.' }),
    ...errors,
  })
  return lot
}

const inputOf = (row: LotRow): LotInput => ({
  productId: row.productId,
  label: row.label,
  categoryId: row.categoryId,
  directFg: row.directFg,
  emsId: row.emsId,
  pocId: row.pocId,
  statusId: row.statusId,
  stageId: row.stageId,
  rmMode: row.rmMode,
  componentIds: row.components.map((c) => c.component.id),
  readyQty: row.readyQty,
  lotQty: row.lotQty,
  freshProductionQty: row.freshProductionQty,
  reworkQty: row.reworkQty,
  reworkReason: row.reworkReason,
  rmReadyDate: fromDbDate(row.rmReadyDate),
  plannedDate: fromDbDate(row.plannedDate),
  revisedEta: fromDbDate(row.revisedEta),
  actualDate: fromDbDate(row.actualDate),
  logisticsId: row.logisticsId,
  blockerId: row.blockerId,
  blockerDescription: row.blockerDescription,
  followUpDate: fromDbDate(row.followUpDate),
  followUpNote: row.followUpNote,
})

const lotData = (input: LotInput, lot: Lot) => ({
  productId: input.productId,
  label: lot.label,
  categoryId: input.categoryId,
  directFg: input.directFg,
  emsId: input.emsId,
  pocId: input.pocId,
  statusId: input.statusId,
  stageId: input.stageId,
  rmMode: input.rmMode,
  readyQty: input.readyQty,
  lotQty: input.lotQty,
  freshProductionQty: input.freshProductionQty,
  reworkQty: input.reworkQty,
  reworkReason: lot.reworkReason,
  rmReadyDate: toDbDate(input.rmReadyDate),
  plannedDate: toDbDate(input.plannedDate),
  revisedEta: toDbDate(input.revisedEta),
  actualDate: toDbDate(input.actualDate),
  logisticsId: input.logisticsId,
  blockerId: input.blockerId,
  blockerDescription: lot.blockerDescription,
  followUpDate: toDbDate(input.followUpDate),
  followUpNote: lot.followUpNote,
})

// FR-2.1: the partial unique index on (product_id, label) is case-insensitive (citext).
const duplicateLabel =
  (label: string) =>
  (err: unknown): never => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      throw new ValidationError({ label: `This product already has a lot labelled ${label}.` })
    throw err
  }

// FR-3.3: in component mode, every component that still has batches must stay selected. This
// checks all active batches, not just this edit's removals, so switching to "all received" and
// back can't strand a batch on an unselected component (the demo's saveLot does the same).
async function assertComponentsFree(db: Db, current: LotRow, input: LotInput) {
  if (input.rmMode !== 'components') return
  const batches = await db.rmBatch.findMany({
    where: { lotId: current.id, deletedAt: null, componentId: { notIn: input.componentIds } },
    include: batchInclude,
  })
  const names = [...new Set(batches.map((b) => b.component.value))].sort()
  if (names.length)
    throw new ValidationError({
      componentIds: `${names.join(', ')} still ha${names.length > 1 ? 've' : 's'} material batches. Keep the component selected or delete its batches first.`,
    })
}

async function syncComponents(db: Db, user: SessionUser, current: LotRow, ids: string[]) {
  const before = current.components.map((c) => c.component.id)
  const removed = before.filter((cid) => !ids.includes(cid))
  const added = ids.filter((cid) => !before.includes(cid))
  if (removed.length)
    await db.lotComponent.updateMany({
      where: { lotId: current.id, deletedAt: null, componentId: { in: removed } },
      data: { deletedAt: new Date(), deletedBy: user.id },
    })
  if (added.length)
    await db.lotComponent.createMany({
      data: added.map((componentId) => ({ lotId: current.id, componentId })),
    })
}

export async function createLot({ db, clock }: RecordsDeps, user: SessionUser, input: LotInput) {
  const id = randomUUID()
  const clean = { ...input, componentIds: [...new Set(input.componentIds)] }
  await db.$transaction(async (tx) => {
    await holdDataLockShared(tx)
    clean.label = await generatedLabel(tx, 'lot', clean.label)
    const lot = await checkLot(tx, id, clean)
    await tx.lot.create({ data: { id, ...lotData(clean, lot) } }).catch(duplicateLabel(lot.label))
    if (clean.componentIds.length)
      await tx.lotComponent.createMany({
        data: clean.componentIds.map((componentId) => ({ lotId: id, componentId })),
      })
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: id,
      kind: 'created',
      message: `Lot ${lot.label} created`,
    })
  })
  return getLotDetail(db, id, await clock.today(), user)
}

export async function updateLot(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  id: string,
  patch: LotPatch,
) {
  const date = await clock.today()
  await db.$transaction(async (tx) => {
    const current = await lockLotForEdit(tx, user, id)
    const { version, ...changes } = patch
    if (version !== current.version)
      throw new ConflictError(
        'Someone else changed this lot. Review their changes and try again.',
        await getLotDetail(tx, id, date, user),
      )
    const merged = { ...inputOf(current), ...changes }
    if (merged.label.trim() && merged.label.trim().toLowerCase() !== current.label.toLowerCase())
      merged.label = await generatedLabel(tx, 'lot', merged.label)
    const input = { ...merged, componentIds: [...new Set(merged.componentIds)] }
    const old = toDomainLot(current)
    const next = await checkLot(tx, id, input)
    if (lotAccess(user, current) === 'progress' && changedPlanFields(old, next).length)
      throw new PermissionError(
        deniedMessage(
          user.role,
          'change plan fields such as product, lot quantity, planned date, or POC',
        ),
      )
    if (next.lotQty < current.grnTotal)
      throw new ValidationError({
        lotQty: `Lot quantity cannot be below the ${current.grnTotal} units already received.`,
      })
    await assertComponentsFree(tx, current, input)
    await tx.lot
      .update({ where: { id }, data: { ...lotData(input, next), version: { increment: 1 } } })
      .catch(duplicateLabel(next.label))
    await syncComponents(tx, user, current, input.componentIds)
    await refreshCompletion(tx, id)
    const changed = historyFields.filter((k) => JSON.stringify(old[k]) !== JSON.stringify(next[k]))
    if (changed.length)
      await recordActivity(tx, actorOf(user), {
        entityType: 'lot',
        entityId: id,
        kind: 'updated',
        message: `Updated ${changed.map(spaced).join(', ')}`,
        changes: Object.fromEntries(
          changed.map((k) => [k, [old[k], next[k]]]),
        ) as Prisma.InputJsonObject,
      })
  })
  return getLotDetail(db, id, date, user)
}

export async function deleteLot({ db }: RecordsDeps, user: SessionUser, id: string) {
  await db.$transaction(async (tx) => {
    const lot = await lockLot(tx, id)
    await softDeleteLots(tx, actorOf(user), [{ id, label: lot.label }])
  })
}

export async function listLots(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  filters: LotFilters,
  page: Page,
) {
  const date = await clock.today()
  const [ids, total] = await Promise.all([
    findLotIds(db, filters, date, pageArgs(page)),
    countLots(db, filters, date),
  ])
  return pageOf(await loadLotViews(db, ids, date, user), total, page)
}

export async function lotCards({ db, clock }: RecordsDeps) {
  return lotCardCounts(db, await clock.today())
}

// The demo's CSV columns (Production.tsx).
const csvHeaders = [
  'Product',
  'Variant',
  'Segment',
  'Lot',
  'Status',
  'StatusSummary',
  'Category',
  'EMS',
  'POC',
  'Stage',
  'Mode',
  'LotQty',
  'Produced',
  'Rework',
  'GRN',
  'Balance',
  'RMReadyPercent',
  'PlannedDate',
  'CurrentETA',
  'Blocker',
  'FollowUp',
  'FullGRNDate',
  'DaysVsPlan',
  'RMToGRNDays',
]
const csvRow = (v: LotView) => ({
  Product: v.product.name,
  Variant: v.product.variant,
  Segment: v.product.segment.value,
  Lot: v.label,
  Status: v.status.value,
  StatusSummary: v.computed.summary,
  Category: v.category.value,
  EMS: v.ems?.value ?? '',
  POC: v.poc?.value ?? '',
  Stage: v.stage.value,
  Mode: v.logistics?.value ?? '',
  LotQty: v.lotQty,
  Produced: v.freshProductionQty,
  Rework: v.reworkQty,
  GRN: v.computed.grnTotal,
  Balance: v.computed.balance,
  RMReadyPercent: Math.round(v.computed.rm.percent),
  PlannedDate: v.plannedDate ?? '',
  CurrentETA: v.revisedEta ?? v.plannedDate ?? '',
  Blocker: v.blocker?.value ?? '',
  FollowUp: v.followUpDate ?? '',
  FullGRNDate: v.computed.fullGrnDate ?? '',
  DaysVsPlan: v.computed.planDelay ?? '',
  RMToGRNDays: v.computed.leadTime ?? '',
})

// Every matching lot, loaded 500 at a time.
export async function exportLotsCsv(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  filters: LotFilters,
) {
  const date = await clock.today()
  const ids = await findLotIds(db, filters, date)
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 500)
    for (const view of await loadLotViews(db, ids.slice(i, i + 500), date, user))
      rows.push(csvRow(view))
  return { filename: `${filters.view}-lots-${date}.csv`, body: toCsv(csvHeaders, rows) }
}

// Filters that hide products without active lots, as the demo's Production view does.
const narrowing = [
  'productId',
  'categoryId',
  'emsId',
  'pocId',
  'statusId',
  'stageId',
  'logisticsId',
  'blockerId',
] as const

// The grouped Production view: products in the order of their first matching lot with their
// totals, then, on the unfiltered active view, products that have no active lots.
export async function lotGroups({ db, clock }: RecordsDeps, filters: LotFilters) {
  const rows = await lotGroupRows(db, filters, await clock.today())
  const select = lotInclude.product.select
  const products = await db.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    select,
  })
  const byId = new Map(products.map((p) => [p.id, p]))
  const showEmpty =
    filters.view === 'active' && !filters.flags.length && !narrowing.some((k) => filters[k])
  const term = filters.q.trim().toLowerCase()
  const empty = showEmpty
    ? (
        await db.product.findMany({
          where: {
            deletedAt: null,
            ...(filters.segmentId && { segmentId: filters.segmentId }),
            lots: { none: { deletedAt: null, completedOn: null } },
          },
          select,
          orderBy: [{ name: 'asc' }, { variant: 'asc' }],
        })
      ).filter((p) => `${p.name} ${p.variant}`.toLowerCase().includes(term))
    : []
  const zero = { lots: 0, delayed: 0, lotQty: 0, produced: 0, grnTotal: 0, balance: 0 }
  return {
    items: [
      ...rows.map(({ productId, ...totals }) => ({ product: byId.get(productId)!, ...totals })),
      ...empty.map((product) => ({ product, ...zero })),
    ],
  }
}
