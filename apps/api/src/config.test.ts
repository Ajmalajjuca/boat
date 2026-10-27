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
      SMTP_PORT: 465,
      TRUST_PROXY: 0,
      FEATURE_GRN: false,
      GOOGLE_ALLOWED_DOMAINS: [],
      GOOGLE_ISSUER: 'https://accounts.google.com',
    })
  })
  it('reads FEATURE_GRN as a boolean, off by default', () => {
    expect(loadConfig({ ...base, FEATURE_GRN: 'on' }).FEATURE_GRN).toBe(true)
    expect(loadConfig({ ...base, FEATURE_GRN: 'off' }).FEATURE_GRN).toBe(false)
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
  it('needs credentials and a sender whenever an SMTP host is set', () => {
    const smtp = { ...base, SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'a@gmail.com', SMTP_PASS: 'p' }
    expect(loadConfig({ ...smtp, MAIL_FROM: 'BOAT <a@gmail.com>' }).SMTP_HOST).toBe(
      'smtp.gmail.com',
    )
    expect(() => loadConfig(smtp)).toThrow(/MAIL_FROM/)
    expect(() => loadConfig({ ...smtp, SMTP_USER: undefined })).toThrow(/SMTP_USER/)
    expect(() => loadConfig({ ...smtp, SMTP_PASS: undefined })).toThrow(/SMTP_PASS/)
  })
  it('refuses both Resend and SMTP at once', () => {
    expect(() =>
      loadConfig({ ...production, SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'a', SMTP_PASS: 'p' }),
    ).toThrow(/SMTP_HOST/)
  })
  it('accepts a complete production config', () => {
    expect(loadConfig(production).NODE_ENV).toBe('production')
    const smtp = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'a@gmail.com', SMTP_PASS: 'p' }
    expect(loadConfig({ ...production, RESEND_API_KEY: undefined, ...smtp }).SMTP_PORT).toBe(465)
  })
  it('reads the Google sign-in settings, all or none', () => {
    const google = {
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_ALLOWED_DOMAINS: ' Company.test, other.test ',
    }
    expect(loadConfig({ ...base, ...google })).toMatchObject({
      GOOGLE_ALLOWED_DOMAINS: ['company.test', 'other.test'],
      GOOGLE_ISSUER: 'https://accounts.google.com',
    })
    expect(loadConfig(base).GOOGLE_ALLOWED_DOMAINS).toEqual([])
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/)
    expect(() => loadConfig({ ...base, ...google, GOOGLE_ALLOWED_DOMAINS: ' ' })).toThrow(
      /GOOGLE_ALLOWED_DOMAINS/,
    )
    // A test issuer is only for tests: production talks to Google over https.
    expect(() =>
      loadConfig({ ...production, ...google, GOOGLE_ISSUER: 'http://127.0.0.1:9999' }),
    ).toThrow(/GOOGLE_ISSUER/)
    // Production without Google still starts, so the backup admin can sign in.
    expect(loadConfig(production).GOOGLE_CLIENT_ID).toBeUndefined()
  })
  it('requires email sending and an https APP_URL in production', () => {
    expect(() => loadConfig({ ...production, RESEND_API_KEY: undefined })).toThrow(/SMTP_HOST/)
    expect(() => loadConfig({ ...production, APP_URL: 'http://boat.onrender.com' })).toThrow(
      /APP_URL/,
    )
  })
})
