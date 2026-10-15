import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('passwords', () => {
  it('hash with Argon2id', async () => {
    expect(await hashPassword('correct horse battery')).toMatch(/^\$argon2id\$/)
  })
  it('verify the right password only', async () => {
    const stored = await hashPassword('correct horse battery')
    expect(await verifyPassword(stored, 'correct horse battery')).toBe(true)
    expect(await verifyPassword(stored, 'wrong horse battery')).toBe(false)
  })
  it('refuse when there is no stored hash', async () => {
    expect(await verifyPassword(null, 'anything at all')).toBe(false)
    expect(await verifyPassword(undefined, 'anything at all')).toBe(false)
  })
})
