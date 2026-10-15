import { ValidationError } from '@boat/domain/validation'
import type { Db } from '../../core/prisma'
import type { TokenPurpose } from '../../generated/prisma/client'
import { hashToken, newToken } from './tokens'

const lifetimeMs: Record<TokenPurpose, number> = {
  invite: 72 * 60 * 60_000,
  password_reset: 60 * 60_000,
}
const unusable: Record<TokenPurpose, string> = {
  invite: 'This invite link has expired or was already used. Ask an admin to send a new one.',
  password_reset: 'This reset link has expired or was already used. Request a new one.',
}

// Issues a single-use token for an emailed link. Earlier unused tokens for the same purpose stop
// working, so only the newest email's link is valid.
export async function issueToken(db: Db, userId: string, purpose: TokenPurpose) {
  const now = new Date()
  await db.authToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: now },
  })
  const token = newToken()
  await db.authToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + lifetimeMs[purpose]),
    },
  })
  return token
}

// Marks the token used and returns its user's id. Call it inside the transaction that acts on the
// token. The conditional update means two requests racing with one link cannot both succeed.
export async function consumeToken(db: Db, token: string, purpose: TokenPurpose) {
  const now = new Date()
  const found = await db.authToken.findFirst({
    where: { tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true },
  })
  const { count } = found
    ? await db.authToken.updateMany({
        where: { id: found.id, usedAt: null },
        data: { usedAt: now },
      })
    : { count: 0 }
  if (!found || count !== 1) throw new ValidationError({ token: unusable[purpose] })
  return found.userId
}
