import {
  effectiveLotEta,
  lotSummary,
  monthEnd,
  monthLabel,
  monthOf,
  monthSummary,
} from '@boat/domain/calculations'
import type { RecordsDeps } from '../../core/clock'
import { toCsv } from '../../core/csv'
import { fromDbDate, toDbDate } from '../../core/dates'
import { lotInclude, toDomainLot, toDomainReceipt } from '../lots/lot-view'

const activeLot = { deletedAt: null, product: { is: { deletedAt: null } } }

// FR-5.1 and FR-5.2 with the domain's monthSummary, so the figures are the demo's. SQL picks the
// lots originally planned in the month (a revised ETA doesn't move them) and their receipts;
// monthSummary counts those dated up to month end.
export async function monthEndReport({ db, clock }: RecordsDeps, month: string) {
  const date = await clock.today()
  const start = toDbDate(`${month}-01`)!
  const end = monthEnd(month)
  const rows = await db.lot.findMany({
    where: { ...activeLot, plannedDate: { gte: start, lte: toDbDate(end)! } },
    include: lotInclude,
  })
  const receipts = await db.grnReceipt.findMany({
    where: { deletedAt: null, lotId: { in: rows.map((r) => r.id) } },
  })
  const inMonth = await db.grnReceipt.aggregate({
    where: { deletedAt: null, date: { gte: start, lte: toDbDate(end)! }, lot: { is: activeLot } },
    _sum: { quantity: true },
  })
  const domainReceipts = receipts.map(toDomainReceipt)
  const summary = monthSummary(rows.map(toDomainLot), domainReceipts, month)
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const productOf = (productId: string) => rows.find((r) => r.productId === productId)!.product
  return {
    month,
    label: monthLabel(month),
    monthEnd: end,
    inProgress: date <= end,
    planned: summary.planned,
    received: summary.received,
    shortfall: summary.shortfall,
    percent: summary.percent,
    // Every receipt dated in the month, for any lot, as the demo's grnInMonth.
    grnInMonth: inMonth._sum.quantity ?? 0,
    products: summary.products.map((p) => ({
      product: productOf(p.productId),
      lots: p.lots,
      planned: p.planned,
      received: p.received,
      shortfall: p.shortfall,
    })),
    lots: summary.lots.map((r) => {
      const row = rowById.get(r.lot.id)!
      return {
        lot: {
          id: row.id,
          label: row.label,
          plannedDate: fromDbDate(row.plannedDate),
          eta: effectiveLotEta(r.lot) || null,
          product: row.product,
          blocker: row.blocker,
          blockerDescription: row.blockerDescription,
        },
        planned: r.planned,
        received: r.received,
        shortfall: r.shortfall,
        statusToday: lotSummary(
          r.lot,
          domainReceipts.filter((g) => g.lotId === r.lot.id),
          date,
        ),
      }
    }),
  }
}

// The demo's month-end CSV columns (MonthEnd.tsx).
const csvHeaders = [
  'Month',
  'Product',
  'Variant',
  'Segment',
  'Lot',
  'PlannedDate',
  'PlannedQty',
  'ReceivedByMonthEnd',
  'Shortfall',
  'Blocker',
  'BlockerDescription',
  'StatusToday',
]

export async function monthEndCsv(deps: RecordsDeps, month: string) {
  const report = await monthEndReport(deps, month)
  const rows = report.lots.map((r) => ({
    Month: month,
    Product: r.lot.product.name,
    Variant: r.lot.product.variant,
    Segment: r.lot.product.segment.value,
    Lot: r.lot.label,
    PlannedDate: r.lot.plannedDate ?? '',
    PlannedQty: r.planned,
    ReceivedByMonthEnd: r.received,
    Shortfall: r.shortfall,
    Blocker: r.lot.blocker?.value ?? '',
    BlockerDescription: r.lot.blockerDescription,
    StatusToday: r.statusToday,
  }))
  return { filename: `month-end-${month}.csv`, body: toCsv(csvHeaders, rows) }
}

// The month picker: months with planned lots or receipts, newest first, and always this month,
// as the demo builds it. Lots and receipts of deleted products don't count.
export async function monthList({ db, clock }: RecordsDeps) {
  const current = monthOf(await clock.today())
  const rows = await db.$queryRaw<{ month: string }[]>`
    SELECT to_char(l.planned_date, 'YYYY-MM') AS month
    FROM lots l JOIN products p ON p.id = l.product_id AND p.deleted_at IS NULL
    WHERE l.deleted_at IS NULL AND l.planned_date IS NOT NULL
    UNION
    SELECT to_char(g.date, 'YYYY-MM')
    FROM grn_receipts g
    JOIN lots l ON l.id = g.lot_id AND l.deleted_at IS NULL
    JOIN products p ON p.id = l.product_id AND p.deleted_at IS NULL
    WHERE g.deleted_at IS NULL`
  return { items: [...new Set([current, ...rows.map((r) => r.month)])].sort().reverse() }
}
