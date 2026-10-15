import type { CookieOptions, RequestHandler, Response } from 'express'
import type { AuthContext } from '../../core/access'
import type { Db } from '../../core/prisma'
import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import type { SettingsService } from '../settings/settings.service'
import { csrfTokenFor, hashToken, newToken } from './tokens'

export const sessionCookie = 'boat_session'
export const maxSessionMs = 12 * 60 * 60_000
// lastSeenAt is written at most once a minute, so idle expiry is accurate to about a minute.
const touchAfterMs = 60_000

export const sessionUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  pocId: true,
  poc: { select: { id: true, value: true } },
} satisfies Prisma.UserSelect

export async function createSession(db: Db, userId: string, userAgent?: string) {
  const token = newToken()
  const id = hashToken(token)
  await db.session.create({
    data: {
      id,
      userId,
      userAgent: userAgent?.slice(0, 200),
      expiresAt: new Date(Date.now() + maxSessionMs),
    },
  })
  return { token, id, userId }
}

// Sessions are never deleted (the app role cannot DELETE); revoking stamps revokedAt.
export const revokeSession = (db: Db, id: string) =>
  db.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })
export const revokeUserSessions = (db: Db, userId: string) =>
  db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })

const cookieBase = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'lax',
  path: '/',
})
export const setSessionCookie = (res: Response, token: string, secure: boolean) =>
  res.cookie(sessionCookie, token, { ...cookieBase(secure), maxAge: maxSessionMs })
export const clearSessionCookie = (res: Response, secure: boolean) =>
  res.clearCookie(sessionCookie, cookieBase(secure))

export async function authContext(
  db: Db,
  sessionSecret: string,
  session: { id: string; userId: string },
): Promise<AuthContext> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: sessionUserSelect,
  })
  return { user, sessionId: session.id, csrfToken: csrfTokenFor(session.id, sessionSecret) }
}

// Turns the session cookie into req.auth when the session is live: not revoked, within 12 hours
// of sign-in, active within the idle timeout, and its user active and not deleted. Otherwise the
// request carries on signed out, and the route's guard decides.
export function loadSession(deps: {
  db: PrismaClient
  settings: SettingsService
  sessionSecret: string
}): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[sessionCookie]
    if (typeof token !== 'string' || !token) return next()
    const id = hashToken(token)
    const now = new Date()
    const { idleTimeoutMinutes } = await deps.settings.get()
    const session = await deps.db.session.findFirst({
      where: {
        id,
        revokedAt: null,
        expiresAt: { gt: now },
        lastSeenAt: { gt: new Date(now.getTime() - idleTimeoutMinutes * 60_000) },
        user: { is: { status: 'active', deletedAt: null } },
      },
      select: { lastSeenAt: true, user: { select: sessionUserSelect } },
    })
    if (!session) return next()
    if (now.getTime() - session.lastSeenAt.getTime() > touchAfterMs)
      await deps.db.session.update({ where: { id }, data: { lastSeenAt: now } })
    req.auth = {
      user: session.user,
      sessionId: id,
      csrfToken: csrfTokenFor(id, deps.sessionSecret),
    }
    // PRD observability: the user id on every log line after this point.
    req.log = req.log.child({ userId: session.user.id })
    next()
  }
}
