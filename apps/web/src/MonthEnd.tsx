import { LoadingState } from './ui'
import { useState, type MutableRefObject } from 'react'
import type { LotProduct } from '@boat/domain/api'
import { dateLabel, monthLabel, monthOf, quantity, today } from '@boat/domain/calculations'
import { downloadMonthEndCsv } from './api/reports'
import { useMonthEnd, useMonths } from './api/queries'
import { Badge, Button, Card, cn, Empty, Select, type CsvExport } from './ui'

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
          {inProgress && <Badge tone="amber">Month in progress</Badge>}
        </div>
        <p className="max-w-xl text-[13px] text-muted lg:text-right">
          Plan uses each lot's original planned date, so revised ETAs still count against the month
          they were planned for.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line-soft shadow-[0_1px_2px_rgba(16,24,40,.04)] md:grid-cols-4">
        {cards.map(([label, value, help]) => (
          <div
            key={label}
            title={help}
            className={cn(
              'relative bg-white px-4 pt-3.5 pb-3',
              label === cards[2][0] &&
                summary.shortfall > 0 &&
                'before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-amber-500',
            )}
          >
            <span className="metric-label">{label}</span>
            <div className="metric-value mt-1.5">{value}</div>
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
            <div className="px-4 py-4 sm:px-5">
              <h2 className="section-title">By product</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                {summary.products.length} products planned in {monthLabel(month)}, largest shortfall
                first
              </p>
            </div>
            <div className="table-wrap border-t border-line-soft">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Segment</th>
                    <th className="cell-num">Lots</th>
                    <th className="cell-num">Planned</th>
                    <th className="cell-num">Completed</th>
                    <th className="cell-num">Shortfall</th>
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
                        <td className="font-medium text-ink">{productName(row.product)}</td>
                        <td>{row.product.segment.value || '—'}</td>
                        <td className="cell-num">{row.lots}</td>
                        <td className="cell-num">{quantity(row.planned)}</td>
                        <td className="cell-num font-medium text-ink">{quantity(row.completed)}</td>
                        <td
                          className={cn(
                            'cell-num font-medium',
                            row.shortfall > 0 ? 'text-rose-700' : 'text-muted',
                          )}
                        >
                          {quantity(row.shortfall)}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line-soft">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  percent >= 100 ? 'bg-emerald-500' : 'bg-ink/70',
                                )}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                            <span className="num w-10 text-right">{percent}%</span>
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
            <div className="px-4 py-4 sm:px-5">
              <h2 className="section-title">
                {inProgress ? 'Lots still to complete' : 'Lots short of plan'}
              </h2>
              <p className="mt-0.5 text-[13px] text-muted">
                {short.length
                  ? `${short.length} of ${summary.lots.length} planned lots ${inProgress ? 'are not yet completed' : `were not completed by the end of ${monthLabel(month)}`}. Select a lot to open it.`
                  : 'Every lot planned for this month has been completed.'}
              </p>
            </div>
            {short.length > 0 && (
              <div className="table-wrap border-t border-line-soft">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lot</th>
                      <th>Product</th>
                      <th>Planned date</th>
                      <th>Current ETA</th>
                      <th className="cell-num">Planned</th>
                      <th className="cell-num">Completed</th>
                      <th className="cell-num">Short</th>
                      <th>Status today</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {short.map((row) => (
                      <tr
                        key={row.lot.id}
                        data-clickable
                        data-tone={inProgress ? 'amber' : 'red'}
                        onClick={() => onOpenLot(row.lot.id)}
                      >
                        <td className="font-semibold text-ink">{row.lot.label}</td>
                        <td>{productName(row.lot.product)}</td>
                        <td>{dateLabel(row.lot.plannedDate ?? '')}</td>
                        <td>{dateLabel(row.lot.eta ?? '')}</td>
                        <td className="cell-num">{quantity(row.planned)}</td>
                        <td className="cell-num">{quantity(row.completed)}</td>
                        <td className="cell-num font-medium text-rose-700">
                          {quantity(row.shortfall)}
                        </td>
                        <td>
                          <span className="block min-w-56 text-[13px] whitespace-normal text-ink-2">
                            {row.statusToday}
                          </span>
                        </td>
                        <td>
                          <span className="block min-w-48 text-[13px] whitespace-normal text-ink-2">
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
