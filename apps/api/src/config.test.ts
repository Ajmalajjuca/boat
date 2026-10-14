import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const DATABASE_URL = 'postgresql://boat_app:x@localhost:5432/boat'

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL,
    })
  })
  it('reads PORT as a number', () => {
    expect(loadConfig({ DATABASE_URL, PORT: '8080' }).PORT).toBe(8080)
  })
  it('names each missing or invalid variable', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ DATABASE_URL, PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ DATABASE_URL, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
  })
})
