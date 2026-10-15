import { hash, verify } from '@node-rs/argon2'

// @node-rs/argon2 defaults to Argon2id with 19 MiB of memory and 2 passes: OWASP's minimum.
export const hashPassword = (password: string) => hash(password)

let dummyHash: Promise<string> | undefined
// With no stored hash (unknown email, invite not accepted) this still spends the time of one
// verification, so the response time doesn't reveal which emails have accounts.
export async function verifyPassword(stored: string | null | undefined, password: string) {
  if (!stored) {
    dummyHash ??= hash('placeholder password for timing')
    await verify(await dummyHash, password)
    return false
  }
  return verify(stored, password)
}
