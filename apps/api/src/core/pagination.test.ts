import { describe, expect, it } from 'vitest'
import { pageArgs, pageOf, pageQuery } from './pagination'
import { parseInput } from './parse'

describe('pageQuery', () => {
  it('defaults to the first page of 50', () => {
    expect(parseInput(pageQuery, {})).toEqual({ page: 1, pageSize: 50 })
  })
  it('reads query-string numbers', () => {
    expect(parseInput(pageQuery, { page: '3', pageSize: '20' })).toEqual({ page: 3, pageSize: 20 })
  })
  it('refuses pages below 1 and sizes above 200', () => {
    expect(() => parseInput(pageQuery, { page: '0' })).toThrow()
    expect(() => parseInput(pageQuery, { pageSize: '500' })).toThrow()
  })
})

describe('pageArgs and pageOf', () => {
  it('turn a page into skip/take and wrap the result', () => {
    expect(pageArgs({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 })
    expect(pageOf(['a'], 41, { page: 3, pageSize: 20 })).toEqual({
      items: ['a'],
      total: 41,
      page: 3,
      pageSize: 20,
    })
  })
})
