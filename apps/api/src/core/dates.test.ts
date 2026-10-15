import { describe, expect, it } from 'vitest'
import { fromDbDate, isoDate, optionalDate, toDbDate } from './dates'

describe('isoDate', () => {
  it('accepts real calendar dates', () => {
    for (const s of ['2026-10-15', '2024-02-29', '2026-12-31'])
      expect(isoDate.safeParse(s).success).toBe(true)
  })
  it('refuses other formats and days that do not exist', () => {
    for (const s of ['2026-02-30', '2025-02-29', '2026-13-01', '15/10/2026', '2026-1-5', ''])
      expect(isoDate.safeParse(s).success).toBe(false)
  })
})

describe('optionalDate', () => {
  it('reads "" and null as not set', () => {
    expect(optionalDate.parse('')).toBeNull()
    expect(optionalDate.parse(null)).toBeNull()
    expect(optionalDate.parse('2026-10-15')).toBe('2026-10-15')
    expect(optionalDate.safeParse('2026-02-30').success).toBe(false)
  })
})

describe('toDbDate and fromDbDate', () => {
  it('round-trip through UTC midnight', () => {
    const d = toDbDate('2026-10-15')!
    expect(d.toISOString()).toBe('2026-10-15T00:00:00.000Z')
    expect(fromDbDate(d)).toBe('2026-10-15')
    expect(toDbDate(null)).toBeNull()
    expect(fromDbDate(null)).toBeNull()
  })
})
