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
import { lotInclude, toDomainLot } from '../lots/lot-view'

const activeLot = { deletedAt: null, product: { is: { deletedAt: null } } }

// FR-5.1 and FR-5.2 with the domain's monthSummary. SQL picks the lots originally planned in the
// month (a revised ETA doesn't move them); monthSummary counts those whose actual date is on or
// before month end as completed in full (FR-11.3).
export async function monthEndReport({ db, clock }: RecordsDeps, month: string) {
  const date = await clock.today()
  const start = toDbDate(`${month}-01`)!
  const end = monthEnd(month)
  const rows = await db.lot.findMany({
    where: { ...activeLot, plannedDate: { gte: start, lte: toDbDate(end)! } },
    include: lotInclude,
  })
  const summary = monthSummary(rows.map(toDomainLot), month)
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const productOf = (productId: string) => rows.find((r) => r.productId === productId)!.product
  return {
    month,
    label: monthLabel(month),
    monthEnd: end,
    inProgress: date <= end,
    planned: summary.planned,
    completed: summary.completed,
    shortfall: summary.shortfall,
    percent: summary.percent,
    products: summary.products.map((p) => ({
      product: productOf(p.productId),
      lots: p.lots,
      planned: p.planned,
      completed: p.completed,
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
        completed: r.completed,
        shortfall: r.shortfall,
        statusToday: lotSummary(r.lot, date),
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
  'CompletedByMonthEnd',
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
    CompletedByMonthEnd: r.completed,
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
