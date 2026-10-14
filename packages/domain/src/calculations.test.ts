import { describe, expect, it } from 'vitest'
import {
  arrivalDelay,
  balance,
  clampPercent,
  dateLabel,
  completed,
  dayDiff,
  dayOffset,
  effectiveRmReadyDate,
  etaSlip,
  fullGrnDate,
  grnProgress,
  leadTime,
  lotFlags,
  lotSummary,
  monthEnd,
  monthLabel,
  monthOf,
  monthSummary,
  planDelay,
  quantity,
  rmMetrics,
  shipmentFlags,
  shipmentQuantity,
  shipmentStatus,
  signedDays,
  sum,
  today,
  totalGrn,
} from './calculations'
import { makeBatch, makeItem, makeLot, makeReceipt, makeShipment } from './test-factories'

describe('today', () => {
  it('uses the company time zone when given one', () => {
    const at = new Date('2026-10-14T20:00:00Z')
    expect(today('Asia/Kolkata', at)).toBe('2026-10-15')
    expect(today('UTC', at)).toBe('2026-10-14')
    expect(today('America/Los_Angeles', new Date('2026-10-15T03:00:00Z'))).toBe('2026-10-14')
  })
  it('falls back to the device time zone', () => {
    expect(today(undefined, new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('dateLabel', () => {
  it('labels dates and blanks', () => {
    expect(dateLabel('')).toBe('Not set')
    expect(dateLabel('2026-10-05')).toBe('05 Oct 2026')
  })
  it('gives the same label in a time zone west of UTC', () => {
    const tz = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      expect(dateLabel('2026-10-05')).toBe('05 Oct 2026')
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
})

const TODAY = '2026-10-14'

describe('date helpers', () => {
  it('offsets and diffs calendar days across month and year ends', () => {
    expect(dayOffset('2026-02-27', 2)).toBe('2026-03-01')
    expect(dayOffset('2026-01-01', -1)).toBe('2025-12-31')
    expect(dayDiff('2026-03-01', '2026-02-27')).toBe(2)
    expect(dayDiff('', '2026-01-01')).toBe(0)
  })
  it('finds month boundaries and labels', () => {
    expect(monthOf('2026-10-14')).toBe('2026-10')
    expect(monthEnd('2026-02')).toBe('2026-02-28')
    expect(monthEnd('2028-02')).toBe('2028-02-29')
    expect(monthLabel('2026-10')).toBe('October 2026')
  })
  it('formats numbers and day counts', () => {
    expect(sum([1, 2, 3])).toBe(6)
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(42)).toBe(42)
    expect(quantity(1234567)).toBe('12,34,567')
    expect(quantity(Number.NaN)).toBe('0')
    expect(signedDays(null)).toBe('—')
    expect(signedDays(0)).toBe('On time')
    expect(signedDays(3)).toBe('3d late')
    expect(signedDays(-11)).toBe('11d early')
  })
})

describe('GRN and completion', () => {
  const lot = makeLot({ lotQty: 100, plannedDate: '2026-10-20' })
  const first = makeReceipt({ date: '2026-10-05', quantity: 40 })
  const second = makeReceipt({ date: '2026-10-09', quantity: 60 })

  it('tracks a partial receipt', () => {
    expect(totalGrn([first])).toBe(40)
    expect(balance(lot, [first])).toBe(60)
    expect(completed(lot, [first])).toBe(false)
    expect(grnProgress(lot, [first])).toBe(40)
    expect(fullGrnDate(lot, [first])).toBe('')
    expect(planDelay(lot, [first])).toBeNull()
  })
  it('completes at full GRN and dates it by the latest receipt', () => {
    expect(balance(lot, [second, first])).toBe(0)
    expect(completed(lot, [second, first])).toBe(true)
    expect(grnProgress(lot, [second, first])).toBe(100)
    expect(fullGrnDate(lot, [first, second])).toBe('2026-10-09')
    expect(planDelay(lot, [first, second])).toBe(-11)
  })
  it('never completes a zero-quantity lot', () => {
    const empty = makeLot({ lotQty: 0 })
    expect(completed(empty, [])).toBe(false)
    expect(grnProgress(empty, [])).toBe(0)
  })
})

describe('RM readiness', () => {
  const components = makeLot({
    rmMode: 'components',
    rmComponents: ['PCB', 'Enclosure'],
    lotQty: 100,
  })
  const batches = [
    makeBatch({ component: 'PCB', receivedQty: 60, receivedDate: '2026-10-02' }),
    makeBatch({ component: 'PCB', receivedQty: 50, receivedDate: '2026-10-04' }),
    makeBatch({ component: 'Enclosure', receivedQty: 90, receivedDate: '2026-10-03' }),
  ]

  it('prefers a manual RM ready date', () => {
    expect(effectiveRmReadyDate(makeLot({ rmReadyDate: '2026-10-01' }), [])).toBe('2026-10-01')
    expect(effectiveRmReadyDate(makeLot({ rmMode: 'all' }), [])).toBe('')
    expect(effectiveRmReadyDate({ ...components, lotQty: 0 }, batches)).toBe('')
  })
  it('dates component readiness by the last component to cover the lot', () => {
    expect(effectiveRmReadyDate(components, batches)).toBe('')
    const covered = [
      ...batches,
      makeBatch({ component: 'Enclosure', receivedQty: 10, receivedDate: '2026-10-03' }),
    ]
    expect(effectiveRmReadyDate(components, covered)).toBe('2026-10-04')
    const undated = [makeBatch({ component: 'PCB', receivedQty: 100, receivedDate: '' })]
    expect(effectiveRmReadyDate({ ...components, rmComponents: ['PCB'] }, undated)).toBe('')
  })
  it('measures RM-to-GRN lead time', () => {
    const covered = [
      ...batches,
      makeBatch({ component: 'Enclosure', receivedQty: 10, receivedDate: '2026-10-03' }),
    ]
    const receipts = [
      makeReceipt({ date: '2026-10-05', quantity: 40 }),
      makeReceipt({ date: '2026-10-09', quantity: 60 }),
    ]
    expect(leadTime(components, receipts, covered)).toBe(5)
    expect(leadTime(components, receipts)).toBeNull()
  })
  it('reports a kit in all-received mode', () => {
    expect(rmMetrics(makeLot({ lotQty: 100, readyQty: 80 }), [])).toEqual({
      target: 100,
      bottleneck: 'Kit (All Together)',
      producible: 80,
      percent: 80,
      complete: false,
    })
    expect(rmMetrics(makeLot({ lotQty: 100, readyQty: 120 }), [])).toMatchObject({
      producible: 100,
      percent: 100,
      complete: true,
    })
    expect(rmMetrics(makeLot({ lotQty: 0, readyQty: 0 }), [])).toMatchObject({
      percent: 0,
      complete: false,
    })
  })
  it('names the smallest component as the bottleneck', () => {
    expect(rmMetrics(components, batches)).toEqual({
      target: 100,
      bottleneck: 'Enclosure',
      producible: 90,
      percent: 90,
      complete: false,
    })
    expect(rmMetrics({ ...components, rmComponents: [] }, batches)).toEqual({
      target: 100,
      bottleneck: 'No components selected',
      producible: 0,
      percent: 0,
      complete: false,
    })
  })
})

describe('lot flags and summary', () => {
  it('flags overdue, due soon and follow-up from the effective ETA', () => {
    expect(lotFlags(makeLot({ plannedDate: '2026-10-10' }), [], TODAY)).toMatchObject({
      overdue: true,
      dueSoon: false,
    })
    expect(lotFlags(makeLot({ plannedDate: '2026-10-17' }), [], TODAY).dueSoon).toBe(true)
    expect(lotFlags(makeLot({ plannedDate: '2026-10-18' }), [], TODAY).dueSoon).toBe(false)
    expect(
      lotFlags(makeLot({ plannedDate: '2026-10-10', revisedEta: '2026-10-16' }), [], TODAY),
    ).toMatchObject({ overdue: false, dueSoon: true })
    expect(lotFlags(makeLot({ followUpDate: TODAY }), [], TODAY).followUp).toBe(true)
  })
  it('flags blocked and approval-blocked lots', () => {
    expect(lotFlags(makeLot({ status: 'Delayed' }), [], TODAY).blocked).toBe(true)
    expect(lotFlags(makeLot({ status: 'Hold' }), [], TODAY).blocked).toBe(true)
    expect(lotFlags(makeLot({ blockerCategory: 'Approval Blocker' }), [], TODAY)).toMatchObject({
      blocked: true,
      approval: true,
    })
    expect(lotFlags(makeLot(), [], TODAY).blocked).toBe(false)
  })
  it('clears every flag once the lot is complete', () => {
    const lot = makeLot({ lotQty: 100, plannedDate: '2026-10-01', status: 'Delayed' })
    expect(lotFlags(lot, [makeReceipt({ quantity: 100 })], TODAY)).toEqual({
      done: true,
      overdue: false,
      dueSoon: false,
      followUp: false,
      blocked: false,
      approval: false,
    })
  })
  it('writes the one-line status in the client format', () => {
    const delayed = makeLot({
      status: 'Delayed',
      revisedEta: '2026-10-15',
      blockerCategory: 'RM Blocker',
      stage: 'Factory Production',
    })
    expect(lotSummary(delayed, [], TODAY)).toBe(
      'Delayed, 1d left — RM Blocker (Factory Production)',
    )
    expect(lotSummary(makeLot({ plannedDate: '2026-10-11', stage: '' }), [], TODAY)).toBe(
      'On Track, 3d overdue',
    )
    expect(lotSummary(makeLot({ plannedDate: TODAY }), [], TODAY)).toBe(
      'On Track, due today (Factory Production)',
    )
    expect(lotSummary(makeLot({ plannedDate: '', status: '' }), [], TODAY)).toBe(
      'No status, no ETA (Factory Production)',
    )
    expect(lotSummary(makeLot({ lotQty: 10 }), [makeReceipt({ quantity: 10 })], TODAY)).toBe(
      'Completed (Factory Production)',
    )
  })
})

describe('shipments', () => {
  it('flags an open shipment past its ETA as overdue', () => {
    const late = makeShipment({ plannedEta: '2026-10-10' })
    expect(shipmentFlags(late, TODAY)).toEqual({
      open: true,
      overdue: true,
      soon: false,
      revised: false,
      arrived: false,
    })
    expect(shipmentStatus(late, TODAY)).toBe('Overdue 4d')
  })
  it('uses a revised ETA and falls back to the stage', () => {
    const revised = makeShipment({ plannedEta: '2026-10-10', revisedEta: '2026-10-16' })
    expect(shipmentFlags(revised, TODAY)).toMatchObject({
      overdue: false,
      soon: true,
      revised: true,
    })
    expect(etaSlip(revised)).toBe(6)
    expect(shipmentStatus(revised, TODAY)).toBe('In Transit')
    expect(shipmentStatus({ ...revised, stage: '' }, TODAY)).toBe('In transit')
    expect(etaSlip(makeShipment({ plannedEta: '' }))).toBeNull()
  })
  it('reports arrival against the planned ETA', () => {
    const base = { plannedEta: '2026-10-10' }
    expect(shipmentStatus(makeShipment({ ...base, actualArrival: '2026-10-12' }), TODAY)).toBe(
      'Arrived 2d late',
    )
    expect(shipmentStatus(makeShipment({ ...base, actualArrival: '2026-10-08' }), TODAY)).toBe(
      'Arrived 2d early',
    )
    expect(shipmentStatus(makeShipment({ ...base, actualArrival: '2026-10-10' }), TODAY)).toBe(
      'Arrived on time',
    )
    expect(
      shipmentStatus(makeShipment({ plannedEta: '', actualArrival: '2026-10-10' }), TODAY),
    ).toBe('Arrived')
    expect(arrivalDelay(makeShipment({ ...base, actualArrival: '2026-10-12' }))).toBe(2)
    expect(arrivalDelay(makeShipment(base))).toBeNull()
  })
  it('sums line quantities', () => {
    expect(shipmentQuantity([makeItem({ quantity: 5 }), makeItem({ quantity: 7 })])).toBe(12)
  })
})

describe('monthSummary', () => {
  const a = makeLot({ id: 'a', productId: 'p1', lotQty: 100, plannedDate: '2026-10-05' })
  const b = makeLot({
    id: 'b',
    productId: 'p1',
    lotQty: 50,
    plannedDate: '2026-10-28',
    revisedEta: '2026-11-05',
  })
  const c = makeLot({ id: 'c', productId: 'p2', lotQty: 30, plannedDate: '2026-11-02' })
  const receipts = [
    makeReceipt({ lotId: 'a', date: '2026-10-10', quantity: 60 }),
    makeReceipt({ lotId: 'a', date: '2026-11-01', quantity: 40 }),
    makeReceipt({ lotId: 'b', date: '2026-10-30', quantity: 50 }),
    makeReceipt({ lotId: 'c', date: '2026-10-31', quantity: 30 }),
  ]

  it('compares lots by original planned month with GRN up to month end', () => {
    const s = monthSummary([a, b, c], receipts, '2026-10')
    expect(s.lots.map((r) => [r.lot.id, r.planned, r.received, r.shortfall])).toEqual([
      ['a', 100, 60, 40],
      ['b', 50, 50, 0],
    ])
    expect(s.products).toEqual([
      { productId: 'p1', lots: 2, planned: 150, received: 110, shortfall: 40 },
    ])
    expect(s).toMatchObject({ planned: 150, received: 110, shortfall: 40, grnInMonth: 140 })
    expect(s.percent).toBeCloseTo(73.33, 2)
  })
  it('counts receipts dated before the planned month', () => {
    const s = monthSummary([a, b, c], receipts, '2026-11')
    expect(s.lots.map((r) => [r.lot.id, r.received, r.shortfall])).toEqual([['c', 30, 0]])
    expect(s.grnInMonth).toBe(40)
  })
  it('returns zeros for an empty month', () => {
    expect(monthSummary([a, b, c], receipts, '2026-12')).toMatchObject({
      planned: 0,
      received: 0,
      percent: 0,
      grnInMonth: 0,
    })
  })
})
