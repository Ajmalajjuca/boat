import { today } from './calculations'
import type { GRNReceipt, Lot, Product, RMBatch, Shipment, ShipmentItem } from './models'

// Field name → message. Forms show each message under its field; the repository throws the
// same errors so a save that slips past the form is still rejected with field detail.
export type FieldErrors = Record<string, string>
export class ValidationError extends Error {
  fields: FieldErrors
  constructor(fields: FieldErrors) {
    const messages = Object.values(fields)
    super(messages.length === 1 ? messages[0] : `Check ${messages.length} highlighted fields.`)
    this.name = 'ValidationError'
    this.fields = fields
  }
}
export const fieldErrors = (e: unknown): FieldErrors =>
  e instanceof ValidationError
    ? e.fields
    : { form: e instanceof Error ? e.message : 'Save failed.' }
export function assertValid(errors: FieldErrors) {
  if (Object.keys(errors).length) throw new ValidationError(errors)
}
export const lineField = (id: string, field: 'productId' | 'quantity') => `line:${id}:${field}`

const blank = (s: string) => !s.trim()
// Quantities are whole units; fractions would make exact GRN completion checks unreliable.
const wholeNumber = (n: number, name: string) =>
  Number.isInteger(n) && n >= 0 ? '' : `${name} must be a whole number, zero or more.`
function collect(entries: [string, string | false | undefined][]) {
  const errors: FieldErrors = {}
  for (const [field, message] of entries) if (message && !errors[field]) errors[field] = message
  return errors
}

export const validateProduct = (p: Product) =>
  collect([
    ['name', blank(p.name) && 'Enter the product name.'],
    ['segment', blank(p.segment) && 'Choose a segment.'],
  ])

export const validateLot = (l: Lot) =>
  collect([
    ['productId', blank(l.productId) && 'Choose a product.'],
    ['label', blank(l.label) && 'Enter a lot label, e.g. Lot 1.'],
    ['category', blank(l.category) && 'Choose a product category.'],
    ['status', blank(l.status) && 'Choose an overall status.'],
    ['stage', blank(l.stage) && 'Choose the current stage.'],
    ['lotQty', wholeNumber(l.lotQty, 'Lot quantity')],
    ['freshProductionQty', wholeNumber(l.freshProductionQty, 'Fresh production quantity')],
    ['reworkQty', wholeNumber(l.reworkQty, 'Rework quantity')],
    [
      'reworkQty',
      l.reworkQty > l.freshProductionQty &&
        'Rework is part of fresh production, so it cannot be larger.',
    ],
    ['readyQty', l.rmMode === 'all' && wholeNumber(l.readyQty, 'Ready quantity')],
    [
      'rmComponents',
      l.rmMode === 'components' &&
        l.rmComponents.includes('Kit (All Together)') &&
        'Kit is an alternative to individual components. Use All RM Received mode for a kit.',
    ],
  ])

export const validateBatch = (b: RMBatch) =>
  collect([
    ['component', blank(b.component) && 'Choose a component.'],
    ['label', blank(b.label) && 'Enter a batch label.'],
    ['plannedQty', wholeNumber(b.plannedQty, 'Planned quantity')],
    ['receivedQty', wholeNumber(b.receivedQty, 'Received quantity')],
    ['receivedDate', b.receivedDate > today() && 'Received date cannot be in the future.'],
  ])

export const validateReceipt = (r: GRNReceipt, available?: number) =>
  collect([
    ['label', blank(r.label) && 'Enter a receipt label.'],
    ['date', !r.date && 'Choose the receipt date.'],
    ['date', r.date > today() && 'Receipt date cannot be in the future.'],
    ['quantity', wholeNumber(r.quantity, 'Quantity')],
    ['quantity', r.quantity <= 0 && 'Quantity must be greater than zero.'],
    [
      'quantity',
      available !== undefined &&
        r.quantity > available &&
        `Only ${available} units are left to receive on this lot.`,
    ],
  ])

export function validateShipment(s: Shipment, lines: ShipmentItem[]) {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line.productId, (counts.get(line.productId) || 0) + 1)
  const beforeEtd = (date: string) => !!s.etd && !!date && date < s.etd
  return collect([
    ['number', blank(s.number) && 'Enter the shipment or invoice number.'],
    ['vessel', blank(s.vessel) && 'Enter the vessel, flight, or carrier.'],
    ['plannedEta', beforeEtd(s.plannedEta) && 'Planned ETA cannot be before ETD.'],
    ['revisedEta', beforeEtd(s.revisedEta) && 'Revised ETA cannot be before ETD.'],
    ['actualArrival', beforeEtd(s.actualArrival) && 'Arrival cannot be before ETD.'],
    ['actualArrival', s.actualArrival > today() && 'Arrival cannot be in the future.'],
    ['lines', !lines.length && 'Add at least one product line.'],
    ...lines.flatMap((line): [string, string | false][] => [
      [lineField(line.id, 'productId'), !line.productId && 'Choose a product.'],
      [
        lineField(line.id, 'productId'),
        !!line.productId &&
          (counts.get(line.productId) || 0) > 1 &&
          'This product is already on another line. Combine the quantities.',
      ],
      [lineField(line.id, 'quantity'), wholeNumber(line.quantity, 'Quantity')],
      [lineField(line.id, 'quantity'), line.quantity <= 0 && 'Must be more than zero.'],
    ]),
  ])
}

export const validateLookupValue = (value: string) =>
  collect([['value', blank(value) && 'Enter a value.']])
