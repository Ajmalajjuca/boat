import type { GRNReceipt, Lot, RMBatch, Shipment, ShipmentItem } from './models'

// "Today" as YYYY-MM-DD. The server passes the company time zone; the browser omits it and gets
// the device's local date, as before.
export function today(timeZone?: string, at = new Date()): string {
  if (timeZone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    )
    return `${parts.year}-${parts.month}-${parts.day}`
  }
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}
export function dayOffset(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
export function dayDiff(a: string, b: string): number {
  if (!a || !b) return 0
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((p(a) - p(b)) / 86400000)
}
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
export const clampPercent = (n: number) => Math.max(0, Math.min(100, n))
export const quantity = (n: number) => new Intl.NumberFormat('en-IN').format(n || 0)
export function totalGrn(receipts: GRNReceipt[]) {
  return sum(receipts.map((r) => r.quantity))
}
export function balance(lot: Lot, receipts: GRNReceipt[]) {
  return lot.lotQty - totalGrn(receipts)
}
// Every unit received through GRN. GRN is hidden for now (FEATURE_GRN); completion no longer
// depends on it.
const grnComplete = (lot: Lot, receipts: GRNReceipt[]) =>
  lot.lotQty > 0 && totalGrn(receipts) === lot.lotQty
// A lot is finished once its actual date is entered (FR-11.3).
export function isCompleted(lot: Lot) {
  return !!lot.actualDate
}
export function grnProgress(lot: Lot, receipts: GRNReceipt[]) {
  return lot.lotQty ? clampPercent((totalGrn(receipts) / lot.lotQty) * 100) : 0
}
export function fullGrnDate(lot: Lot, receipts: GRNReceipt[]) {
  return grnComplete(lot, receipts)
    ? [...receipts].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || ''
    : ''
}
// The manual RM ready date wins. In component mode it otherwise falls back to the date on which
// the last required component's received total first covered the lot quantity.
export function effectiveRmReadyDate(lot: Lot, batches: RMBatch[]) {
  if (lot.rmReadyDate) return lot.rmReadyDate
  if (lot.rmMode !== 'components' || !lot.rmComponents.length || lot.lotQty <= 0) return ''
  const dates = lot.rmComponents.map((component) => {
    let total = 0
    const received = batches
      .filter((b) => b.component === component && b.receivedQty > 0)
      .sort((a, b) => a.receivedDate.localeCompare(b.receivedDate))
    for (const b of received) {
      if (!b.receivedDate) return ''
      total += b.receivedQty
      if (total >= lot.lotQty) return b.receivedDate
    }
    return ''
  })
  return dates.every(Boolean) ? dates.sort()[dates.length - 1] : ''
}
// Days from RM ready to the actual date.
export function leadTime(lot: Lot, batches: RMBatch[] = []) {
  const ready = effectiveRmReadyDate(lot, batches)
  return lot.actualDate && ready ? dayDiff(lot.actualDate, ready) : null
}
// Days between the actual and planned dates; positive means the lot completed late.
export function planDelay(lot: Lot) {
  return lot.actualDate && lot.plannedDate ? dayDiff(lot.actualDate, lot.plannedDate) : null
}
export const signedDays = (n: number | null) =>
  n === null ? '—' : n === 0 ? 'On time' : `${Math.abs(n)}d ${n > 0 ? 'late' : 'early'}`
export function effectiveLotEta(lot: Lot) {
  return lot.revisedEta || lot.plannedDate
}
export function lotFlags(lot: Lot, date = today()) {
  const done = isCompleted(lot),
    eta = effectiveLotEta(lot),
    soon = dayOffset(date, 3)
  return {
    done,
    overdue: !done && !!eta && eta < date,
    dueSoon: !done && !!eta && eta >= date && eta <= soon,
    followUp: !done && !!lot.followUpDate && lot.followUpDate <= date,
    blocked:
      !done &&
      (lot.status === 'Delayed' ||
        lot.status === 'Hold' ||
        (!!lot.blockerCategory && lot.blockerCategory !== 'None')),
    approval: !done && lot.blockerCategory === 'Approval Blocker',
  }
}
export function rmMetrics(lot: Lot, batches: RMBatch[]) {
  const target = lot.lotQty
  if (lot.rmMode === 'all')
    return {
      target,
      bottleneck: 'Kit (All Together)',
      producible: Math.min(target, lot.readyQty),
      percent: target ? clampPercent((lot.readyQty / target) * 100) : 0,
      complete: target > 0 && lot.readyQty >= target,
    }
  const required = lot.rmComponents.filter((c) => c !== 'Kit (All Together)')
  if (!required.length)
    return {
      target,
      bottleneck: 'No components selected',
      producible: 0,
      percent: 0,
      complete: false,
    }
  const amounts = required.map((component) => ({
    component,
    received: sum(batches.filter((b) => b.component === component).map((b) => b.receivedQty)),
  }))
  const min = amounts.reduce((a, b) => (b.received < a.received ? b : a))
  const producible = Math.min(target, min.received)
  return {
    target,
    bottleneck: min.component,
    producible,
    percent: target ? clampPercent((producible / target) * 100) : 0,
    complete: target > 0 && amounts.every((a) => a.received >= target),
  }
}
export function effectiveShipmentEta(s: Shipment) {
  return s.revisedEta || s.plannedEta
}
export function shipmentFlags(s: Shipment, date = today()) {
  const eta = effectiveShipmentEta(s),
    open = !s.actualArrival
  return {
    open,
    overdue: open && !!eta && eta < date,
    soon: open && !!eta && eta >= date && eta <= dayOffset(date, 3),
    revised: !!s.revisedEta,
    arrived: !open,
  }
}
export function shipmentQuantity(items: ShipmentItem[]) {
  return sum(items.map((i) => i.quantity))
}
export function etaSlip(s: Shipment) {
  return s.plannedEta && effectiveShipmentEta(s)
    ? dayDiff(effectiveShipmentEta(s), s.plannedEta)
    : null
}
export function arrivalDelay(s: Shipment) {
  return s.plannedEta && s.actualArrival ? dayDiff(s.actualArrival, s.plannedEta) : null
}
// Status label as the client tracks it: "Overdue 8d", "Arrived 6d late", otherwise the stage.
export function shipmentStatus(s: Shipment, date = today()) {
  const f = shipmentFlags(s, date)
  if (f.arrived) {
    const delay = arrivalDelay(s)
    return delay === null
      ? 'Arrived'
      : delay === 0
        ? 'Arrived on time'
        : `Arrived ${signedDays(delay)}`
  }
  if (f.overdue) return `Overdue ${dayDiff(date, effectiveShipmentEta(s))}d`
  return s.stage || 'In transit'
}
export function dateLabel(value: string) {
  if (!value) return 'Not set'
  const [y, m, d] = value.split('-')
  return `${d} ${new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${y}`
}
// One-line lot summary in the client's format: "Delayed, 1d left — RM Blocker (Factory Production)".
export function lotSummary(lot: Lot, date = today()) {
  if (isCompleted(lot)) return `Completed (${lot.stage})`
  const eta = effectiveLotEta(lot),
    days = eta ? dayDiff(eta, date) : null
  const timing =
    days === null
      ? 'no ETA'
      : days < 0
        ? `${-days}d overdue`
        : days === 0
          ? 'due today'
          : `${days}d left`
  const blocker =
    lot.blockerCategory && lot.blockerCategory !== 'None' ? ` — ${lot.blockerCategory}` : ''
  return `${lot.status || 'No status'}, ${timing}${blocker}${lot.stage ? ` (${lot.stage})` : ''}`
}
export const monthOf = (date: string) => date.slice(0, 7)
export function monthEnd(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
export function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
// Month-end status: lots planned for the month (by original planned date) against those
// completed by the last day of the month. A completed lot counts in full; there is no partial
// progress without GRN.
export function monthSummary(lots: Lot[], month: string) {
  const end = monthEnd(month)
  const lotRows = lots
    .filter((lot) => monthOf(lot.plannedDate) === month)
    .map((lot) => {
      const completed = lot.actualDate && lot.actualDate <= end ? lot.lotQty : 0
      return { lot, planned: lot.lotQty, completed, shortfall: lot.lotQty - completed }
    })
  const products = new Map<
    string,
    { productId: string; lots: number; planned: number; completed: number; shortfall: number }
  >()
  for (const row of lotRows) {
    const p = products.get(row.lot.productId) || {
      productId: row.lot.productId,
      lots: 0,
      planned: 0,
      completed: 0,
      shortfall: 0,
    }
    p.lots++
    p.planned += row.planned
    p.completed += row.completed
    p.shortfall += row.shortfall
    products.set(p.productId, p)
  }
  const planned = sum(lotRows.map((r) => r.planned)),
    completed = sum(lotRows.map((r) => r.completed))
  return {
    lots: lotRows.sort((a, b) => b.shortfall - a.shortfall),
    products: [...products.values()].sort((a, b) => b.shortfall - a.shortfall),
    planned,
    completed,
    shortfall: sum(lotRows.map((r) => r.shortfall)),
    percent: planned ? clampPercent((completed / planned) * 100) : 0,
  }
}
