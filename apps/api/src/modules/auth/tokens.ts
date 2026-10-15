import { createHash, createHmac, randomBytes } from 'node:crypto'

// 256 random bits, URL-safe. Cookies and emailed links carry the token; the database keeps only
// its hash, so a leaked database cannot be used to sign in.
export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// Bound to one session and signed with the secret: it can't be guessed, or reused from another session.
export const csrfTokenFor = (sessionId: string, secret: string) =>
  createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('base64url')
