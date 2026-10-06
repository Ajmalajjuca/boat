import type { GRNReceipt, Lot, RMBatch, Shipment, ShipmentItem } from './models'

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
export function completed(lot: Lot, receipts: GRNReceipt[]) {
  return lot.lotQty > 0 && totalGrn(receipts) === lot.lotQty
}
export function grnProgress(lot: Lot, receipts: GRNReceipt[]) {
  return lot.lotQty ? clampPercent((totalGrn(receipts) / lot.lotQty) * 100) : 0
}
export function fullGrnDate(lot: Lot, receipts: GRNReceipt[]) {
  return completed(lot, receipts)
    ? [...receipts].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || ''
    : ''
}
export function leadTime(lot: Lot, receipts: GRNReceipt[]) {
  const date = fullGrnDate(lot, receipts)
  return date && lot.rmReadyDate ? dayDiff(date, lot.rmReadyDate) : null
}
export function effectiveLotEta(lot: Lot) {
  return lot.revisedEta || lot.plannedDate
}
export function lotFlags(lot: Lot, receipts: GRNReceipt[], date = today()) {
  const done = completed(lot, receipts),
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
export function dateLabel(value: string) {
  if (!value) return 'Not set'
  const [y, m, d] = value.split('-')
  return `${d} ${new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString('en', { month: 'short' })} ${y}`
}
