import { describe, expect, it } from 'vitest'
import type { Lot } from './models'
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
  normalizeEmail,
  validateAccount,
  validateBatch,
  validateLookupValue,
  validateLot,
  validatePassword,
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
  it('allows an empty label only while creating an automatically labelled lot', () => {
    expect(validateLot(makeLot({ label: '' }), true, null, TODAY)).toEqual({})
    expect(validateLot(makeLot({ label: '' })).label).toBeTruthy()
  })
  it('accepts a complete lot', () => {
    expect(validateLot(makeLot(), false, null, TODAY)).toEqual({})
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
        validateLot(
          makeLot({ productId: '', label: '', category: '', status: '', stage: '' }),
          false,
          null,
          TODAY,
        ),
      ),
    ).toEqual(['productId', 'label', 'category', 'status', 'stage'])
  })
})

describe('date rules', () => {
  const lotOn = (o: Partial<Lot>) => makeLot({ plannedDate: '', ...o })
  it('FR-10.1 keeps forecast dates on or after today', () => {
    const e = validateLot(
      lotOn({ rmReadyDate: '2026-10-13', plannedDate: '2026-10-13', revisedEta: '2026-10-13' }),
      false,
      null,
      TODAY,
    )
    expect(e.rmReadyDate).toBe('RM ready date at factory cannot be before today.')
    expect(e.plannedDate).toBe('Planned completion cannot be before today.')
    expect(e.revisedEta).toBe('Current revised ETA cannot be before today.')
    expect(
      validateLot(lotOn({ rmReadyDate: TODAY, plannedDate: TODAY }), false, null, TODAY),
    ).toEqual({})
  })
  it('FR-10.1 keeps the actual date on or before today', () => {
    expect(validateLot(lotOn({ actualDate: '2026-10-15' }), false, null, TODAY).actualDate).toBe(
      'Actual date cannot be in the future.',
    )
    expect(validateLot(lotOn({ actualDate: '2026-01-02' }), false, null, TODAY)).toEqual({})
  })
  it('FR-10.1 keeps planned completion and revised ETA on or after RM ready', () => {
    const e = validateLot(
      lotOn({ rmReadyDate: '2026-10-20', plannedDate: '2026-10-18', revisedEta: '2026-10-19' }),
      false,
      null,
      TODAY,
    )
    expect(e.plannedDate).toBe('Planned completion cannot be before the RM ready date.')
    expect(e.revisedEta).toBe('Current revised ETA cannot be before the RM ready date.')
  })
  it('FR-10.1 only checks a forecast date that is new or changed', () => {
    const stored = lotOn({
      rmReadyDate: '2026-09-01',
      plannedDate: '2026-09-10',
      revisedEta: '2026-09-12',
    })
    expect(validateLot({ ...stored, status: 'Delayed' }, false, stored, TODAY)).toEqual({})
    expect(
      validateLot({ ...stored, plannedDate: '2026-09-11' }, false, stored, TODAY).plannedDate,
    ).toBe('Planned completion cannot be before today.')
  })
  it('allows clearing a forecast date', () => {
    const stored = lotOn({ plannedDate: '2026-09-10' })
    expect(validateLot({ ...stored, plannedDate: '' }, false, stored, TODAY)).toEqual({})
  })
  it('FR-10.2 keeps a new or changed batch planned date on or after today', () => {
    expect(validateBatch(makeBatch({ plannedDate: '2026-10-13' }), TODAY).plannedDate).toBe(
      'Planned date cannot be before today.',
    )
    const stored = makeBatch({ plannedDate: '2026-09-01' })
    expect(validateBatch({ ...stored, notes: 'x' }, TODAY, false, stored)).toEqual({})
  })
})

describe('validateBatch', () => {
  it('allows an empty label only while creating an automatically labelled batch', () => {
    expect(validateBatch(makeBatch({ label: '' }), TODAY, true)).toEqual({})
    expect(validateBatch(makeBatch({ label: '' }), TODAY).label).toBeTruthy()
  })
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
  it('allows an empty label only while creating an automatically labelled receipt', () => {
    expect(validateReceipt(makeReceipt({ label: '' }), undefined, TODAY, true)).toEqual({})
    expect(validateReceipt(makeReceipt({ label: '' }), undefined, TODAY).label).toBeTruthy()
  })
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

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Asha.Rao@Example.COM ')).toBe('asha.rao@example.com')
  })
})

describe('validatePassword', () => {
  it('needs at least 12 characters', () => {
    expect(validatePassword('a'.repeat(11))).toEqual({ password: 'Use at least 12 characters.' })
    expect(validatePassword('a'.repeat(12))).toEqual({})
  })
  it('caps the length at 128 characters', () => {
    expect(validatePassword('a'.repeat(128))).toEqual({})
    expect(validatePassword('a'.repeat(129))).toEqual({
      password: 'Keep the password to 128 characters or fewer.',
    })
  })
  it('reports under the field it is given', () => {
    expect(validatePassword('short', 'newPassword')).toEqual({
      newPassword: 'Use at least 12 characters.',
    })
  })
})

describe('validateAccount', () => {
  const ok = { email: 'asha@example.com', name: 'Asha', role: 'planner', pocId: null }
  it('accepts a complete account', () => {
    expect(validateAccount(ok)).toEqual({})
  })
  it('needs a valid email address', () => {
    expect(validateAccount({ ...ok, email: ' ' })).toEqual({ email: 'Enter an email address.' })
    expect(validateAccount({ ...ok, email: 'asha@example' })).toEqual({
      email: 'Enter a valid email address.',
    })
    expect(validateAccount({ ...ok, email: `${'a'.repeat(250)}@x.io` })).toEqual({
      email: 'Enter a valid email address.',
    })
  })
  it('needs a name of 40 characters or fewer', () => {
    expect(validateAccount({ ...ok, name: '  ' })).toEqual({ name: 'Enter a name.' })
    expect(validateAccount({ ...ok, name: 'a'.repeat(41) })).toEqual({
      name: 'Keep the name to 40 characters or fewer.',
    })
  })
  it('needs a known role', () => {
    expect(validateAccount({ ...ok, role: 'owner' })).toEqual({ role: 'Choose a role.' })
  })
  it('needs a point of contact for POC users only', () => {
    expect(validateAccount({ ...ok, role: 'poc' })).toEqual({
      pocId: 'Choose the point of contact this user owns.',
    })
    expect(validateAccount({ ...ok, role: 'poc', pocId: 'p1' })).toEqual({})
  })
})
