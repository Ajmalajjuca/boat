import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('quotes every cell, doubles quotes and ends lines with CRLF', () => {
    expect(toCsv(['A', 'B'], [{ A: 'x "y"', B: 3 }, { A: null }])).toBe(
      '"A","B"\r\n"x ""y""","3"\r\n"",""\r\n',
    )
  })
  it('neutralises text that a spreadsheet would run as a formula', () => {
    const csv = toCsv(
      ['Lot'],
      [{ Lot: '=HYPERLINK("x")' }, { Lot: '+1' }, { Lot: '@SUM' }, { Lot: '-2' }],
    )
    expect(csv).toBe('"Lot"\r\n"\'=HYPERLINK(""x"")"\r\n"\'+1"\r\n"\'@SUM"\r\n"\'-2"\r\n')
  })
  it('leaves negative numbers alone', () => {
    expect(toCsv(['Days'], [{ Days: -3 }])).toBe('"Days"\r\n"-3"\r\n')
  })
  it('writes only the header for no rows', () => {
    expect(toCsv(['A'], [])).toBe('"A"\r\n')
  })
})
