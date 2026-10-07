import { useMemo, useState, type MutableRefObject } from 'react'
import type { DataSet, Lot } from './models'
import {
  dateLabel,
  effectiveLotEta,
  lotSummary,
  monthLabel,
  monthOf,
  monthSummary,
  quantity,
  today,
} from './calculations'
import { downloadFile, toCsv } from './repository'
import { Card, Empty, Select } from './ui'

type Props = {
  data: DataSet
  onOpenLot: (lot: Lot) => void
  csvRef: MutableRefObject<(() => void) | null>
}
export default function MonthEnd({ data, onOpenLot, csvRef }: Props) {
  const current = monthOf(today())
  const months = useMemo(
    () =>
      [
        ...new Set([
          current,
          ...data.lots.map((l) => monthOf(l.plannedDate)),
          ...data.grnReceipts.map((r) => monthOf(r.date)),
        ]),
      ]
        .filter(Boolean)
        .sort()
        .reverse(),
    [data, current],
  )
  const [month, setMonth] = useState(current)
  const summary = useMemo(() => monthSummary(data.lots, data.grnReceipts, month), [data, month])
  const product = (id: string) => data.products.find((p) => p.id === id)
  const productName = (id: string) => {
    const p = product(id)
    return p ? `${p.name}${p.variant ? ` · ${p.variant}` : ''}` : 'Unknown product'
  }
  const inProgress = month === current
  const short = summary.lots.filter((row) => row.shortfall > 0)
  const receiptsFor = (id: string) => data.grnReceipts.filter((r) => r.lotId === id)
  csvRef.current = () =>
    downloadFile(
      `month-end-${month}.csv`,
      toCsv(
        summary.lots.map((row) => ({
          Month: month,
          Product: product(row.lot.productId)?.name || '',
          Variant: product(row.lot.productId)?.variant || '',
          Segment: product(row.lot.productId)?.segment || '',
          Lot: row.lot.label,
          PlannedDate: row.lot.plannedDate,
          PlannedQty: row.planned,
          ReceivedByMonthEnd: row.received,
          Shortfall: row.shortfall,
          Blocker: row.lot.blockerCategory,
          BlockerDescription: row.lot.blockerDescription,
          StatusToday: lotSummary(row.lot, receiptsFor(row.lot.id)),
        })),
      ),
      'text/csv;charset=utf-8',
    )
  const cards = [
    ['Planned units', quantity(summary.planned), 'Lot quantity of lots planned for this month.'],
    [
      inProgress ? 'Received so far' : 'Received by month end',
      quantity(summary.received),
      'GRN for those lots dated on or before the last day of the month.',
    ],
    [
      inProgress ? 'Still to receive' : 'Shortfall',
      quantity(summary.shortfall),
      'Planned units not yet received by month end.',
    ],
    ['Achieved', `${Math.round(summary.percent)}%`, 'Received as a share of planned units.'],
    [
      'All GRN in month',
      quantity(summary.grnInMonth),
      'Every receipt dated this month, including lots planned for other months.',
    ],
  ]
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Select
            aria-label="Month"
            className="w-48"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
          {inProgress && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              Month in progress
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Plan uses each lot's original planned date, so revised ETAs still count against the month
          they were planned for.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map(([label, value, help]) => (
          <div
            key={label}
            title={help}
            className={`rounded-2xl border bg-white p-4 shadow-[0_2px_14px_rgba(15,23,42,.035)] ${label === cards[2][0] && summary.shortfall ? 'border-orange-300' : 'border-slate-200'}`}
          >
            <span className="metric-label">{label}</span>
            <div className="mt-2 metric-value">{value}</div>
          </div>
        ))}
      </div>
      {!summary.lots.length ? (
        <Empty
          title={`No lots planned for ${monthLabel(month)}`}
          description="Lots appear here when their planned completion / WH receipt date falls in this month."
        />
      ) : (
        <>
          <Card>
            <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
              <h2 className="text-base font-bold text-[#173b3d]">By product</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {summary.products.length} products planned in {monthLabel(month)}, largest shortfall
                first
              </p>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Segment</th>
                    <th>Lots</th>
                    <th>Planned</th>
                    <th>Received</th>
                    <th>Shortfall</th>
                    <th>Achieved</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.products.map((row) => {
                    const percent = row.planned ? Math.round((row.received / row.planned) * 100) : 0
                    return (
                      <tr key={row.productId}>
                        <td className="font-bold text-[#193e40]">{productName(row.productId)}</td>
                        <td>{product(row.productId)?.segment || '—'}</td>
                        <td>{row.lots}</td>
                        <td>{quantity(row.planned)}</td>
                        <td className="font-semibold">{quantity(row.received)}</td>
                        <td className="font-bold text-[#bd5e2d]">{quantity(row.shortfall)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full bg-[#d96d35]"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                            {percent}%
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
              <h2 className="text-base font-bold text-[#173b3d]">
                {inProgress ? 'Lots still to receive' : 'Lots short of plan'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {short.length
                  ? `${short.length} of ${summary.lots.length} planned lots ${inProgress ? 'are not yet fully received' : `were not fully received by the end of ${monthLabel(month)}`}. Select a lot to open it.`
                  : 'Every lot planned for this month has been fully received.'}
              </p>
            </div>
            {short.length > 0 && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lot</th>
                      <th>Product</th>
                      <th>Planned date</th>
                      <th>Current ETA</th>
                      <th>Planned</th>
                      <th>Received</th>
                      <th>Short</th>
                      <th>Status today</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {short.map((row) => (
                      <tr
                        key={row.lot.id}
                        className="cursor-pointer"
                        onClick={() => onOpenLot(row.lot)}
                      >
                        <td className="font-bold text-[#193e40]">{row.lot.label}</td>
                        <td>{productName(row.lot.productId)}</td>
                        <td>{dateLabel(row.lot.plannedDate)}</td>
                        <td>{dateLabel(effectiveLotEta(row.lot))}</td>
                        <td>{quantity(row.planned)}</td>
                        <td>{quantity(row.received)}</td>
                        <td className="font-bold text-[#bd5e2d]">{quantity(row.shortfall)}</td>
                        <td>
                          <span className="block min-w-56 whitespace-normal text-xs text-slate-600">
                            {lotSummary(row.lot, receiptsFor(row.lot.id))}
                          </span>
                        </td>
                        <td>
                          <span className="block min-w-48 whitespace-normal text-xs text-slate-600">
                            {row.lot.blockerDescription ||
                              (row.lot.blockerCategory !== 'None' && row.lot.blockerCategory) ||
                              '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
