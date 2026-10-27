import { timingSafeEqual } from 'node:crypto'
import type { Role } from '@boat/domain/models'
import {
  type Action,
  actionVerbs,
  deniedMessage,
  PermissionError,
  roleCan,
} from '@boat/domain/permissions'
import type { Request, RequestHandler } from 'express'
import { UnauthenticatedError } from './errors'

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  pocId: string | null
  poc: { id: string; value: string } | null
  // The backup admin: the only password sign-in (FR-11.6).
  passwordLogin: boolean
}
export type AuthContext = { user: SessionUser; sessionId: string; csrfToken: string }

declare global {
  namespace Express {
    interface Request {
      // Set by loadSession when the cookie names a live session.
      auth?: AuthContext
    }
  }
}

// Every API route starts with one of the guards below. Each carries this tag, and the route-walk
// test in api.test.ts fails for a route whose first handler has none.
const accessTag = Symbol('access')
export type Access = 'public' | 'signedIn' | 'lotAccess' | Action
const tagged = (access: Access, handler: RequestHandler) =>
  Object.assign(handler, { [accessTag]: access })
export const accessOf = (handler: unknown): Access | undefined =>
  typeof handler === 'function' ? (handler as { [accessTag]?: Access })[accessTag] : undefined

const writes = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// Every write by a signed-in user must echo the session's CSRF token in X-CSRF-Token. Another site
// can make the browser send the cookie, but it cannot read the token.
function signedIn(req: Request) {
  if (!req.auth) throw new UnauthenticatedError()
  if (writes.has(req.method) && !sameToken(req.get('x-csrf-token') ?? '', req.auth.csrfToken))
    throw new PermissionError(
      'Your session token is missing or out of date. Reload the page and try again.',
    )
  return req.auth
}

// Public routes (sign-in, invite, reset) have no session to check. They read only JSON bodies,
// which a cross-site form cannot send.
export const publicRoute = () => tagged('public', (_req, _res, next) => next())

export const requireSignedIn = () =>
  tagged('signedIn', (req, _res, next) => {
    signedIn(req)
    next()
  })

// Lot routes that a POC may use on their own lots. The same session and CSRF checks as
// requireSignedIn; the lot service then applies the per-lot check (full, progress or none),
// which needs the lot itself. The separate tag shows these routes in the permission table.
export const requireLotAccess = () =>
  tagged('lotAccess', (req, _res, next) => {
    signedIn(req)
    next()
  })

export const requirePermission = (action: Action) =>
  tagged(action, (req, _res, next) => {
    const { user } = signedIn(req)
    if (!roleCan(user.role, action))
      throw new PermissionError(deniedMessage(user.role, actionVerbs[action]))
    next()
  })

// The signed-in user, for handlers behind requireSignedIn or requirePermission.
export function authOf(req: Request) {
  if (!req.auth) throw new UnauthenticatedError()
  return req.auth
}
