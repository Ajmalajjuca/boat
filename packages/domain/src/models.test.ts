import { describe, expect, it } from 'vitest'
import { isSystemLookup, productChoices, stamp } from './models'
import { makeProduct } from './test-factories'

describe('models', () => {
  it('protects the system lookup values', () => {
    expect(isSystemLookup('status', 'Delayed')).toBe(true)
    expect(isSystemLookup('blocker', 'Approval Blocker')).toBe(true)
    expect(isSystemLookup('status', 'Custom')).toBe(false)
    expect(isSystemLookup('ems', 'BAU')).toBe(false)
  })
  it('stamps new records with an id and timestamps', () => {
    const record = stamp({ name: 'x' })
    expect(record.name).toBe('x')
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
  it('labels product choices and disambiguates repeated names', () => {
    const choices = productChoices([
      makeProduct({ id: 'aaaaaa-1', segment: 'Solar' }),
      makeProduct({ id: 'bbbbbb-2', segment: 'UPS' }),
      makeProduct({ id: 'cccccc-3', name: 'Battery', variant: '' }),
    ])
    expect(choices.map((c) => c.label)).toEqual([
      'Inverter · 5 kW · Solar · aaaaaa',
      'Inverter · 5 kW · UPS · bbbbbb',
      'Battery',
    ])
    expect(choices[0].value).toBe('aaaaaa-1')
  })
})
