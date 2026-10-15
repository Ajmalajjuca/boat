import {
  balance,
  effectiveRmReadyDate,
  fullGrnDate,
  grnProgress,
  leadTime,
  lotFlags,
  lotSummary,
  planDelay,
  rmMetrics,
  totalGrn,
} from '@boat/domain/calculations'
import type { GRNReceipt, Lot, RMBatch } from '@boat/domain/models'
import { actorLotAccess } from '@boat/domain/permissions'
import type { SessionUser } from '../../core/access'
import { fromDbDate } from '../../core/dates'
import { NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import type { GrnReceipt, Prisma } from '../../generated/prisma/client'

const ref = { select: { id: true, value: true } } as const
export const lotInclude = {
  product: { select: { id: true, name: true, variant: true, segment: ref } },
  category: ref,
  ems: ref,
  poc: ref,
  status: ref,
  stage: ref,
  logistics: ref,
  blocker: ref,
  components: { where: { deletedAt: null }, select: { component: ref } },
} satisfies Prisma.LotInclude
export type LotRow = Prisma.LotGetPayload<{ include: typeof lotInclude }>
export const batchInclude = { component: ref } satisfies Prisma.RmBatchInclude
export type BatchRow = Prisma.RmBatchGetPayload<{ include: typeof batchInclude }>
export type ReceiptRow = GrnReceipt

const text = (d: Date | null) => fromDbDate(d) ?? ''
const byValue = (a: { value: string }, b: { value: string }) => a.value.localeCompare(b.value)
const stamps = (row: { id: string; createdAt: Date; updatedAt: Date }) => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

// The domain calculations take the browser's shapes, where dropdowns are display text. Mapping
// rows to those shapes lets the server compute exactly what the demo computes. System values
// can't be renamed, so text checks such as status === 'Delayed' stay valid.
export function toDomainLot(row: LotRow): Lot {
  return {
    ...stamps(row),
    productId: row.productId,
    label: row.label,
    category: row.category.value,
    directFg: row.directFg,
    ems: row.ems?.value ?? '',
    poc: row.poc?.value ?? '',
    status: row.status.value,
    stage: row.stage.value,
    rmMode: row.rmMode,
    rmComponents: row.components.map((c) => c.component.value).sort(),
    readyQty: row.readyQty,
    lotQty: row.lotQty,
    freshProductionQty: row.freshProductionQty,
    reworkQty: row.reworkQty,
    reworkReason: row.reworkReason,
    rmReadyDate: text(row.rmReadyDate),
    plannedDate: text(row.plannedDate),
    revisedEta: text(row.revisedEta),
    actualDate: text(row.actualDate),
    logisticsMode: row.logistics?.value ?? '',
    blockerCategory: row.blocker?.value ?? '',
    blockerDescription: row.blockerDescription,
    followUpDate: text(row.followUpDate),
    followUpNote: row.followUpNote,
  }
}

export const toDomainBatch = (row: BatchRow): RMBatch => ({
  ...stamps(row),
  lotId: row.lotId,
  component: row.component.value,
  label: row.label,
  plannedQty: row.plannedQty,
  plannedDate: text(row.plannedDate),
  receivedQty: row.receivedQty,
  receivedDate: text(row.receivedDate),
  status: row.status,
  notes: row.notes,
})

export const toDomainReceipt = (row: ReceiptRow): GRNReceipt => ({
  ...stamps(row),
  lotId: row.lotId,
  label: row.label,
  date: text(row.date),
  quantity: row.quantity,
  note: row.note,
})

// actorLotAccess compares the user's point of contact with the lot's. Ids compare as well as
// the names the browser uses.
export const lotAccess = (user: SessionUser, row: { pocId: string | null }) =>
  actorLotAccess({ role: user.role, poc: user.pocId ?? '' }, { poc: row.pocId ?? '' })

export function computeLot(lot: Lot, batches: RMBatch[], receipts: GRNReceipt[], date: string) {
  const { done, ...flags } = lotFlags(lot, receipts, date)
  const rm = rmMetrics(lot, batches)
  return {
    grnTotal: totalGrn(receipts),
    balance: balance(lot, receipts),
    completed: done,
    grnPercent: grnProgress(lot, receipts),
    fullGrnDate: fullGrnDate(lot, receipts) || null,
    planDelay: planDelay(lot, receipts),
    leadTime: leadTime(lot, receipts, batches),
    rmReadyDate: effectiveRmReadyDate(lot, batches) || null,
    flags,
    summary: lotSummary(lot, receipts, date),
    rm: {
      producible: rm.producible,
      bottleneck: rm.bottleneck,
      percent: rm.percent,
      complete: rm.complete,
    },
  }
}

export const batchView = (row: BatchRow) => ({
  id: row.id,
  lotId: row.lotId,
  component: row.component,
  label: row.label,
  plannedQty: row.plannedQty,
  plannedDate: fromDbDate(row.plannedDate),
  receivedQty: row.receivedQty,
  receivedDate: fromDbDate(row.receivedDate),
  status: row.status,
  notes: row.notes,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const receiptView = (row: ReceiptRow) => ({
  id: row.id,
  lotId: row.lotId,
  label: row.label,
  date: fromDbDate(row.date),
  quantity: row.quantity,
  note: row.note,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export function lotView(
  row: LotRow,
  batches: BatchRow[],
  receipts: ReceiptRow[],
  date: string,
  user: SessionUser,
) {
  return {
    id: row.id,
    version: row.version,
    product: row.product,
    label: row.label,
    category: row.category,
    directFg: row.directFg,
    ems: row.ems,
    poc: row.poc,
    status: row.status,
    stage: row.stage,
    rmMode: row.rmMode,
    components: row.components.map((c) => c.component).sort(byValue),
    readyQty: row.readyQty,
    lotQty: row.lotQty,
    freshProductionQty: row.freshProductionQty,
    reworkQty: row.reworkQty,
    reworkReason: row.reworkReason,
    rmReadyDate: fromDbDate(row.rmReadyDate),
    plannedDate: fromDbDate(row.plannedDate),
    revisedEta: fromDbDate(row.revisedEta),
    actualDate: fromDbDate(row.actualDate),
    logistics: row.logistics,
    blocker: row.blocker,
    blockerDescription: row.blockerDescription,
    followUpDate: fromDbDate(row.followUpDate),
    followUpNote: row.followUpNote,
    completedOn: fromDbDate(row.completedOn),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    computed: computeLot(
      toDomainLot(row),
      batches.map(toDomainBatch),
      receipts.map(toDomainReceipt),
      date,
    ),
    access: lotAccess(user, row),
  }
}
export type LotView = ReturnType<typeof lotView>

async function loadBundles(db: Db, ids: string[]) {
  const [rows, batches, receipts] = await Promise.all([
    db.lot.findMany({ where: { id: { in: ids }, deletedAt: null }, include: lotInclude }),
    db.rmBatch.findMany({
      where: { lotId: { in: ids }, deletedAt: null },
      include: batchInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.grnReceipt.findMany({
      where: { lotId: { in: ids }, deletedAt: null },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
  ])
  const group = <T extends { lotId: string }>(items: T[]) => {
    const byLot = new Map<string, T[]>()
    for (const item of items) byLot.set(item.lotId, [...(byLot.get(item.lotId) ?? []), item])
    return byLot
  }
  const batchesOf = group(batches)
  const receiptsOf = group(receipts)
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap((id) => {
    const row = rowsById.get(id)
    return row
      ? [{ row, batches: batchesOf.get(id) ?? [], receipts: receiptsOf.get(id) ?? [] }]
      : []
  })
}

// Three queries for any number of lots; the result keeps the order of ids.
export async function loadLotViews(db: Db, ids: string[], date: string, user: SessionUser) {
  if (!ids.length) return []
  const bundles = await loadBundles(db, ids)
  return bundles.map((b) => lotView(b.row, b.batches, b.receipts, date, user))
}

export async function getLotDetail(db: Db, id: string, date: string, user: SessionUser) {
  const [found] = await loadBundles(db, [id])
  if (!found) throw new NotFoundError()
  return {
    ...lotView(found.row, found.batches, found.receipts, date, user),
    rmBatches: found.batches.map(batchView),
    grnReceipts: found.receipts.map(receiptView),
  }
}
