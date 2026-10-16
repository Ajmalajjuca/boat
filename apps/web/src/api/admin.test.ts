import type { LookupItem } from '@boat/domain/api'
import { describe, expect, it } from 'vitest'
import { userField, userInput } from './admin'

const lookups: LookupItem[] = [
  { id: 'p1', kind: 'poc', value: 'Maya Shah', sort: 0, system: false },
]

describe('userInput', () => {
  it('sends the POC as its id, only for POC users', () => {
    expect(
      userInput(
        { name: ' Ravi ', email: ' Ravi@Example.com ', role: 'poc', poc: 'maya shah' },
        lookups,
      ),
    ).toEqual({ name: 'Ravi', email: 'ravi@example.com', role: 'poc', pocId: 'p1' })
    expect(
      userInput(
        { name: 'Ravi', email: 'ravi@example.com', role: 'planner', poc: 'Maya Shah' },
        lookups,
      ),
    ).toEqual({ name: 'Ravi', email: 'ravi@example.com', role: 'planner', pocId: null })
  })
  it('names the POC field as the form does', () => {
    expect(userField('pocId')).toBe('poc')
    expect(userField('email')).toBe('email')
  })
})
