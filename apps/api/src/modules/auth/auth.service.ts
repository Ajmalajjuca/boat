import { allowedActions, PermissionError } from '@boat/domain/permissions'
import {
  assertValid,
  normalizeEmail,
  validatePassword,
  ValidationError,
} from '@boat/domain/validation'
import type { AuthContext } from '../../core/access'
import type { Features } from '../../core/clock'
import { UnauthenticatedError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import type { PrismaClient } from '../../generated/prisma/client'
import type { SettingsService } from '../settings/settings.service'
import type { GoogleIdentity } from './google'
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
    select: { id: true, status: true, passwordHash: true, passwordLogin: true },
  })
  const ok = await verifyPassword(user?.passwordHash, password)
  // FR-11.6: password sign-in is the backup admin's alone.
  if (!user || !ok || user.status !== 'active' || !user.passwordLogin)
    throw new UnauthenticatedError(incorrect)
  const session = await createSession(db, user.id, userAgent)
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  return session
}

// Why a Google sign-in was refused; the callback sends the browser to /sign-in?error=<code>.
export type GoogleRefusal = 'unverified' | 'domain' | 'not_added' | 'disabled'
export class GoogleSignInError extends Error {
  constructor(readonly code: GoogleRefusal) {
    super(code)
  }
}

// FR-11.5: a verified Google account on an allowed Workspace domain whose email an admin has
// added. Nothing is created here; the first sign-in turns an invited user active. The domain
// comes from Google's hd claim, so a personal Gmail an admin added by mistake is still refused.
export async function signInWithGoogle(
  db: Db,
  identity: GoogleIdentity,
  allowedDomains: string[],
  userAgent?: string,
) {
  if (!identity.emailVerified) throw new GoogleSignInError('unverified')
  const email = normalizeEmail(identity.email)
  const domain = (identity.hd ?? email.split('@')[1] ?? '').toLowerCase()
  if (!allowedDomains.includes(domain)) throw new GoogleSignInError('domain')
  const user = await db.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, status: true },
  })
  if (!user) throw new GoogleSignInError('not_added')
  if (user.status === 'disabled') throw new GoogleSignInError('disabled')
  const session = await createSession(db, user.id, userAgent)
  await db.user.update({
    where: { id: user.id },
    data: { status: 'active', lastLoginAt: new Date() },
  })
  return session
}

// What the browser needs after sign-in and on every page load.
// features tells the browser which switched-off areas to hide.
export async function mePayload(settings: SettingsService, features: Features, auth: AuthContext) {
  const { idleTimeoutMinutes } = await settings.get()
  return {
    user: auth.user,
    allowedActions: allowedActions(auth.user.role),
    csrfToken: auth.csrfToken,
    idleTimeoutMinutes,
    features,
  }
}
export type MePayload = Awaited<ReturnType<typeof mePayload>>

// PRD: changing a password revokes all of the user's sessions. The request that made the change
// moves to a fresh session so the person stays signed in here. Only the backup admin has a
// password (FR-11.6); everyone else signs in with Google.
export async function changePassword(
  db: PrismaClient,
  userId: string,
  current: string,
  next: string,
  userAgent?: string,
) {
  const { passwordHash, passwordLogin } = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true, passwordLogin: true },
  })
  if (!passwordLogin)
    throw new PermissionError('You sign in with Google, so there is no password to change.')
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
