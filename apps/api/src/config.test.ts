import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const DATABASE_URL = 'postgresql://boat_app:x@localhost:5432/boat'
const SESSION_SECRET = 's'.repeat(32)
const base = { DATABASE_URL, SESSION_SECRET }
const production = {
  ...base,
  NODE_ENV: 'production',
  APP_URL: 'https://boat.onrender.com',
  RESEND_API_KEY: 're_123',
  MAIL_FROM: 'BOAT <noreply@example.com>',
}

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL,
      SESSION_SECRET,
      APP_URL: 'http://localhost:5173',
      TRUST_PROXY: 0,
    })
  })
  it('reads PORT and TRUST_PROXY as numbers', () => {
    expect(loadConfig({ ...base, PORT: '8080', TRUST_PROXY: '1' })).toMatchObject({
      PORT: 8080,
      TRUST_PROXY: 1,
    })
  })
  it('names each missing or invalid variable', () => {
    expect(() => loadConfig({ SESSION_SECRET })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...base, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
    expect(() => loadConfig({ ...base, APP_URL: 'not a url' })).toThrow(/APP_URL/)
  })
  it('needs a session secret of at least 32 characters', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/SESSION_SECRET/)
    expect(() => loadConfig({ DATABASE_URL, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
  })
  it('needs a sender address whenever a Resend key is set', () => {
    expect(() => loadConfig({ ...base, RESEND_API_KEY: 're_123' })).toThrow(/MAIL_FROM/)
  })
  it('accepts a complete production config', () => {
    expect(loadConfig(production).NODE_ENV).toBe('production')
  })
  it('requires email sending and an https APP_URL in production', () => {
    expect(() => loadConfig({ ...production, RESEND_API_KEY: undefined })).toThrow(/RESEND_API_KEY/)
    expect(() => loadConfig({ ...production, APP_URL: 'http://boat.onrender.com' })).toThrow(
      /APP_URL/,
    )
  })
})
