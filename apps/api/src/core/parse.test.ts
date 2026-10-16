import { ValidationError } from '@boat/domain/validation'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { NotFoundError } from './errors'
import { parseId, parseInput } from './parse'

function fieldsOf(fn: () => unknown) {
  try {
    fn()
  } catch (e) {
    if (e instanceof ValidationError) return e.fields
    throw e
  }
  throw new Error('expected a ValidationError')
}

const schema = z.object({
  name: z.string({ error: 'Enter a name.' }),
  qty: z.number({ error: 'Enter a quantity.' }),
})

describe('parseInput', () => {
  it('returns the parsed value', () => {
    expect(parseInput(schema, { name: 'a', qty: 1 })).toEqual({ name: 'a', qty: 1 })
  })
  it('turns problems into a field map', () => {
    expect(fieldsOf(() => parseInput(schema, { qty: 'x' }))).toEqual({
      name: 'Enter a name.',
      qty: 'Enter a quantity.',
    })
  })
  it('treats a missing body as an empty object', () => {
    expect(fieldsOf(() => parseInput(schema, undefined))).toEqual({
      name: 'Enter a name.',
      qty: 'Enter a quantity.',
    })
  })
  it('files problems with the whole body under "form"', () => {
    expect(Object.keys(fieldsOf(() => parseInput(z.strictObject({}), { extra: 1 })))).toEqual([
      'form',
    ])
  })
})

describe('parseId', () => {
  it('accepts any UUID Postgres accepts', () => {
    expect(parseId('6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90')).toBe(
      '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90',
    )
    expect(parseId('00000000-0000-0000-0000-000000000000')).toBe(
      '00000000-0000-0000-0000-000000000000',
    )
  })
  it('answers anything else as not found', () => {
    for (const bad of ['abc', '', 42, undefined]) expect(() => parseId(bad)).toThrow(NotFoundError)
  })
})

describe('NUL characters', () => {
  const nested = z.object({
    name: z.string(),
    items: z.array(z.object({ label: z.string() })),
  })
  it('are refused wherever they appear, naming the field', () => {
    expect(fieldsOf(() => parseInput(schema, { name: 'a\u0000b', qty: 1 }))).toEqual({
      name: 'Remove the hidden NUL character from this text.',
    })
    expect(
      fieldsOf(() =>
        parseInput(nested, { name: 'ok', items: [{ label: 'x' }, { label: '\u0000' }] }),
      ),
    ).toEqual({ 'items.1.label': 'Remove the hidden NUL character from this text.' })
  })
  it('leave other control characters to the schema', () => {
    expect(parseInput(schema, { name: 'tab\there', qty: 1 })).toEqual({ name: 'tab\there', qty: 1 })
  })
})
