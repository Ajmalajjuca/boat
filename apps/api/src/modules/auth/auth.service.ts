import { allowedActions } from '@boat/domain/permissions'
import {
  assertValid,
  normalizeEmail,
  validatePassword,
  ValidationError,
} from '@boat/domain/validation'
import type { Logger } from 'pino'
import type { AuthContext } from '../../core/access'
import { UnauthenticatedError } from '../../core/errors'
import { type Mailer, sendOrLog } from '../../core/mailer'
import type { Db } from '../../core/prisma'
import type { PrismaClient } from '../../generated/prisma/client'
import type { SettingsService } from '../settings/settings.service'
import { consumeToken, issueToken } from './auth-tokens'
import { resetEmail } from './emails'
import { hashPassword, verifyPassword } from './password'
import { createSession, revokeUserSessions } from './sessions'

// One message for an unknown email, a wrong password, and an account that is invited, disabled or
// deleted, so a failed sign-in reveals nothing about which accounts exist.
const incorrect = 'Email or password is incorrect.'

export async function signInWithPassword(
  db: Db,
  email: string,
  password: string,
  userAgent?: string,
) {
  const user = await db.user.findFirst({
    where: { email: normalizeEmail(email), deletedAt: null },
    select: { id: true, status: true, passwordHash: true },
  })
  const ok = await verifyPassword(user?.passwordHash, password)
  if (!user || !ok || user.status !== 'active') throw new UnauthenticatedError(incorrect)
  const session = await createSession(db, user.id, userAgent)
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  return session
}

// What the browser needs after sign-in and on every page load.
export async function mePayload(settings: SettingsService, auth: AuthContext) {
  const { idleTimeoutMinutes } = await settings.get()
  return {
    user: auth.user,
    allowedActions: allowedActions(auth.user.role),
    csrfToken: auth.csrfToken,
    idleTimeoutMinutes,
  }
}
export type MePayload = Awaited<ReturnType<typeof mePayload>>

const expiredInvite =
  'This invite link has expired or was already used. Ask an admin to send a new one.'
const expiredReset = 'This reset link has expired or was already used. Request a new one.'

// The password is checked and hashed before the transaction: a short password leaves the link
// usable, and the slow hash doesn't hold row locks.
export async function acceptInvite(
  db: PrismaClient,
  token: string,
  password: string,
  userAgent?: string,
) {
  assertValid(validatePassword(password))
  const passwordHash = await hashPassword(password)
  return db.$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, 'invite')
    const { count } = await tx.user.updateMany({
      where: { id: userId, status: 'invited', deletedAt: null },
      data: { passwordHash, status: 'active', lastLoginAt: new Date() },
    })
    if (count !== 1) throw new ValidationError({ token: expiredInvite })
    return createSession(tx, userId, userAgent)
  })
}

// Sends a reset link to an active user. The caller answers the same way whatever happens here,
// so the reply never reveals whether an account exists.
export async function requestPasswordReset(
  deps: { db: PrismaClient; mailer: Mailer; appUrl: string },
  email: string,
  log: Logger,
) {
  const user = await deps.db.user.findFirst({
    where: { email: normalizeEmail(email), status: 'active', deletedAt: null },
    select: { id: true, name: true, email: true },
  })
  if (!user) return
  const token = await issueToken(deps.db, user.id, 'password_reset')
  await sendOrLog(deps.mailer, log, {
    to: user.email,
    ...resetEmail(deps.appUrl, user.name, token),
  })
}

export async function resetPassword(db: PrismaClient, token: string, password: string) {
  assertValid(validatePassword(password))
  const passwordHash = await hashPassword(password)
  await db.$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, 'password_reset')
    const { count } = await tx.user.updateMany({
      where: { id: userId, status: 'active', deletedAt: null },
      data: { passwordHash },
    })
    if (count !== 1) throw new ValidationError({ token: expiredReset })
    await revokeUserSessions(tx, userId)
    await tx.authToken.updateMany({
      where: { userId, purpose: 'password_reset', usedAt: null },
      data: { usedAt: new Date() },
    })
  })
}

// PRD: changing a password revokes all of the user's sessions. The request that made the change
// moves to a fresh session so the person stays signed in here.
export async function changePassword(
  db: PrismaClient,
  userId: string,
  current: string,
  next: string,
  userAgent?: string,
) {
  const { passwordHash } = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  })
  if (!(await verifyPassword(passwordHash, current)))
    throw new ValidationError({ currentPassword: 'That is not your current password.' })
  assertValid(validatePassword(next, 'newPassword'))
  if (next === current)
    throw new ValidationError({ newPassword: 'Choose a password different from your current one.' })
  const newHash = await hashPassword(next)
  return db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: newHash } })
    await revokeUserSessions(tx, userId)
    return createSession(tx, userId, userAgent)
  })
}
