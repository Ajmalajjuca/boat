import { allowedActions } from '@boat/domain/permissions'
import { normalizeEmail } from '@boat/domain/validation'
import type { AuthContext } from '../../core/access'
import { UnauthenticatedError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import type { SettingsService } from '../settings/settings.service'
import { verifyPassword } from './password'
import { createSession } from './sessions'

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
