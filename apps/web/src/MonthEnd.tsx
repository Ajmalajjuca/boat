import { LoadingState } from './ui'
import { useState, type MutableRefObject } from 'react'
import type { LotProduct } from '@boat/domain/api'
import { dateLabel, monthLabel, monthOf, quantity, today } from '@boat/domain/calculations'
import { downloadMonthEndCsv } from './api/reports'
import { useMonthEnd, useMonths } from './api/queries'
import { Button, Card, Empty, Select, type CsvExport } from './ui'

type Props = {
  onOpenLot: (id: string) => void
  csvRef: MutableRefObject<CsvExport | null>
}
const productName = (p: LotProduct) => `${p.name}${p.variant ? ` · ${p.variant}` : ''}`

export default function MonthEnd({ onOpenLot, csvRef }: Props) {
  const current = monthOf(today())
  const months = useMonths().data ?? [current]
  const [month, setMonth] = useState(current)
  const reportQuery = useMonthEnd(month),
    report = reportQuery.data
  csvRef.current = async () => {
    if (!report?.lots.length) return false
    await downloadMonthEndCsv(month)
    return true
  }
  if (reportQuery.isError && !report)
    return (
      <Empty
        title="Couldn't load the month-end summary"
        description={reportQuery.error.message}
        action={
          <Button variant="secondary" onClick={() => reportQuery.refetch()}>
            Try again
          </Button>
        }
      />
    )
  if (!report) return <LoadingState label="Loading month-end summary" />
  const summary = report,
    inProgress = report.inProgress
  const short = summary.lots.filter((row) => row.shortfall > 0)
  const cards = [
    ['Planned units', quantity(summary.planned), 'Lot quantity of lots planned for this month.'],
    [
      inProgress ? 'Completed so far' : 'Completed by month end',
      quantity(summary.completed),
      'Lots from that plan whose actual date is on or before the last day of the month.',
    ],
    [
      inProgress ? 'Still to complete' : 'Shortfall',
      quantity(summary.shortfall),
      'Planned units of lots not completed by month end.',
    ],
    ['Achieved', `${Math.round(summary.percent)}%`, 'Completed as a share of planned units.'],
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
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
              <h2 className="text-base font-bold text-[#1a2024]">By product</h2>
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
                    <th>Completed</th>
                    <th>Shortfall</th>
                    <th>Achieved</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.products.map((row) => {
                    const percent = row.planned
                      ? Math.round((row.completed / row.planned) * 100)
                      : 0
                    return (
                      <tr key={row.product.id}>
                        <td className="font-bold text-[#193e40]">{productName(row.product)}</td>
                        <td>{row.product.segment.value || '—'}</td>
                        <td>{row.lots}</td>
                        <td>{quantity(row.planned)}</td>
                        <td className="font-semibold">{quantity(row.completed)}</td>
                        <td className="font-bold text-[#bd5e2d]">{quantity(row.shortfall)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full bg-[#ed1c24]"
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
              <h2 className="text-base font-bold text-[#1a2024]">
                {inProgress ? 'Lots still to complete' : 'Lots short of plan'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {short.length
                  ? `${short.length} of ${summary.lots.length} planned lots ${inProgress ? 'are not yet completed' : `were not completed by the end of ${monthLabel(month)}`}. Select a lot to open it.`
                  : 'Every lot planned for this month has been completed.'}
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
                      <th>Completed</th>
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
                        onClick={() => onOpenLot(row.lot.id)}
                      >
                        <td className="font-bold text-[#193e40]">{row.lot.label}</td>
                        <td>{productName(row.lot.product)}</td>
                        <td>{dateLabel(row.lot.plannedDate ?? '')}</td>
                        <td>{dateLabel(row.lot.eta ?? '')}</td>
                        <td>{quantity(row.planned)}</td>
                        <td>{quantity(row.completed)}</td>
                        <td className="font-bold text-[#bd5e2d]">{quantity(row.shortfall)}</td>
                        <td>
                          <span className="block min-w-56 whitespace-normal text-xs text-slate-600">
                            {row.statusToday}
                          </span>
                        </td>
                        <td>
                          <span className="block min-w-48 whitespace-normal text-xs text-slate-600">
                            {row.lot.blockerDescription ||
                              (row.lot.blocker &&
                                row.lot.blocker.value !== 'None' &&
                                row.lot.blocker.value) ||
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
