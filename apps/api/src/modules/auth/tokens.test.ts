import { describe, expect, it } from 'vitest'
import { csrfTokenFor, hashToken, newToken } from './tokens'

describe('newToken', () => {
  it('makes 256 random bits as URL-safe text', () => {
    const a = newToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newToken()).not.toBe(a)
  })
})

describe('hashToken', () => {
  it('is a stable SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('csrfTokenFor', () => {
  it('is stable for one session and differs across sessions and secrets', () => {
    const secret = 's'.repeat(32)
    expect(csrfTokenFor('a', secret)).toBe(csrfTokenFor('a', secret))
    expect(csrfTokenFor('b', secret)).not.toBe(csrfTokenFor('a', secret))
    expect(csrfTokenFor('a', 't'.repeat(32))).not.toBe(csrfTokenFor('a', secret))
  })
})
