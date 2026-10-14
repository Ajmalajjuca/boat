import { describe, expect, it } from 'vitest'
import {
  makeBatch,
  makeItem,
  makeLot,
  makeProduct,
  makeReceipt,
  makeShipment,
} from './test-factories'
import {
  assertValid,
  fieldErrors,
  lineField,
  validateBatch,
  validateLookupValue,
  validateLot,
  validateProduct,
  validateReceipt,
  validateShipment,
  ValidationError,
} from './validation'

const TODAY = '2026-10-14'

describe('ValidationError helpers', () => {
  it('summarises one or several field errors', () => {
    expect(new ValidationError({ a: 'Enter A.' }).message).toBe('Enter A.')
    expect(new ValidationError({ a: 'x', b: 'y' }).message).toBe('Check 2 highlighted fields.')
  })
  it('maps any thrown value to a field map', () => {
    expect(fieldErrors(new ValidationError({ a: 'x' }))).toEqual({ a: 'x' })
    expect(fieldErrors(new Error('boom'))).toEqual({ form: 'boom' })
    expect(fieldErrors('nope')).toEqual({ form: 'Save failed.' })
  })
  it('throws only when there are errors', () => {
    expect(() => assertValid({})).not.toThrow()
    expect(() => assertValid({ a: 'x' })).toThrow(ValidationError)
  })
  it('names shipment line fields', () => {
    expect(lineField('l1', 'quantity')).toBe('line:l1:quantity')
  })
})

describe('validateProduct and validateLookupValue', () => {
  it('requires a name, a segment and a value', () => {
    expect(validateProduct(makeProduct())).toEqual({})
    expect(validateProduct(makeProduct({ name: ' ', segment: '' }))).toEqual({
      name: 'Enter the product name.',
      segment: 'Choose a segment.',
    })
    expect(validateLookupValue('  ')).toEqual({ value: 'Enter a value.' })
  })
})

describe('validateLot', () => {
  it('accepts a complete lot', () => {
    expect(validateLot(makeLot())).toEqual({})
  })
  it('requires whole, non-negative quantities', () => {
    expect(validateLot(makeLot({ lotQty: 1.5 })).lotQty).toBe(
      'Lot quantity must be a whole number, zero or more.',
    )
    expect(validateLot(makeLot({ reworkQty: -1 })).reworkQty).toBe(
      'Rework quantity must be a whole number, zero or more.',
    )
  })
  it('keeps rework within fresh production', () => {
    expect(validateLot(makeLot({ freshProductionQty: 3, reworkQty: 5 })).reworkQty).toBe(
      'Rework is part of fresh production, so it cannot be larger.',
    )
  })
  it('checks ready quantity only in all-received mode', () => {
    expect(validateLot(makeLot({ rmMode: 'all', readyQty: -1 })).readyQty).toBe(
      'Ready quantity must be a whole number, zero or more.',
    )
    expect(validateLot(makeLot({ rmMode: 'components', readyQty: -1 })).readyQty).toBeUndefined()
  })
  it('refuses the kit as a tracked component', () => {
    expect(
      validateLot(makeLot({ rmMode: 'components', rmComponents: ['Kit (All Together)'] }))
        .rmComponents,
    ).toBe('Kit is an alternative to individual components. Use All RM Received mode for a kit.')
  })
  it('requires the plan fields', () => {
    expect(
      Object.keys(
        validateLot(makeLot({ productId: '', label: '', category: '', status: '', stage: '' })),
      ),
    ).toEqual(['productId', 'label', 'category', 'status', 'stage'])
  })
})

describe('validateBatch', () => {
  it('refuses a received date after the given day', () => {
    expect(validateBatch(makeBatch({ receivedDate: '2026-10-15' }), TODAY)).toEqual({
      receivedDate: 'Received date cannot be in the future.',
    })
    expect(validateBatch(makeBatch({ receivedDate: TODAY }), TODAY)).toEqual({})
  })
  it('requires a component, a label and whole quantities', () => {
    expect(validateBatch(makeBatch({ component: '', label: '', receivedQty: 2.5 }), TODAY)).toEqual(
      {
        component: 'Choose a component.',
        label: 'Enter a batch label.',
        receivedQty: 'Received quantity must be a whole number, zero or more.',
      },
    )
  })
})

describe('validateReceipt', () => {
  it('requires a dated, positive receipt', () => {
    expect(validateReceipt(makeReceipt(), undefined, TODAY)).toEqual({})
    expect(validateReceipt(makeReceipt({ date: '' }), undefined, TODAY).date).toBe(
      'Choose the receipt date.',
    )
    expect(validateReceipt(makeReceipt({ quantity: 0 }), undefined, TODAY).quantity).toBe(
      'Quantity must be greater than zero.',
    )
  })
  it('refuses future dates, by the given day or by the real today', () => {
    expect(validateReceipt(makeReceipt({ date: '2026-10-15' }), undefined, TODAY).date).toBe(
      'Receipt date cannot be in the future.',
    )
    expect(validateReceipt(makeReceipt({ date: '2999-01-01' })).date).toBe(
      'Receipt date cannot be in the future.',
    )
  })
  it('refuses more than the lot has left to receive', () => {
    expect(validateReceipt(makeReceipt({ quantity: 50 }), 40, TODAY).quantity).toBe(
      'Only 40 units are left to receive on this lot.',
    )
  })
})

describe('validateShipment', () => {
  it('accepts a shipment with one line', () => {
    expect(validateShipment(makeShipment(), [makeItem()], TODAY)).toEqual({})
  })
  it('requires a number, a carrier and at least one line', () => {
    expect(validateShipment(makeShipment({ number: '', vessel: ' ' }), [], TODAY)).toEqual({
      number: 'Enter the shipment or invoice number.',
      vessel: 'Enter the vessel, flight, or carrier.',
      lines: 'Add at least one product line.',
    })
  })
  it('keeps ETAs and arrival on or after ETD, and arrival not in the future', () => {
    const s = makeShipment({
      etd: '2026-10-05',
      plannedEta: '2026-10-01',
      revisedEta: '2026-10-02',
      actualArrival: '2026-10-03',
    })
    expect(validateShipment(s, [makeItem()], TODAY)).toEqual({
      plannedEta: 'Planned ETA cannot be before ETD.',
      revisedEta: 'Revised ETA cannot be before ETD.',
      actualArrival: 'Arrival cannot be before ETD.',
    })
    expect(
      validateShipment(makeShipment({ actualArrival: '2026-10-15' }), [makeItem()], TODAY)
        .actualArrival,
    ).toBe('Arrival cannot be in the future.')
  })
  it('flags duplicate products and bad line quantities', () => {
    const lines = [
      makeItem({ id: 'l1', productId: 'p' }),
      makeItem({ id: 'l2', productId: 'p', quantity: 0 }),
      makeItem({ id: 'l3', productId: '', quantity: 1.5 }),
    ]
    expect(validateShipment(makeShipment(), lines, TODAY)).toEqual({
      'line:l1:productId': 'This product is already on another line. Combine the quantities.',
      'line:l2:productId': 'This product is already on another line. Combine the quantities.',
      'line:l2:quantity': 'Must be more than zero.',
      'line:l3:productId': 'Choose a product.',
      'line:l3:quantity': 'Quantity must be a whole number, zero or more.',
    })
  })
})
