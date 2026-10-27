import { createHmac, timingSafeEqual } from 'node:crypto'
import { type CookieOptions, type Response, Router } from 'express'
import { z } from 'zod'
import { authOf, publicRoute, requireSignedIn } from '../../core/access'
import type { Features } from '../../core/clock'
import { NotFoundError } from '../../core/errors'
import type { Mailer } from '../../core/mailer'
import { parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import type { SettingsService } from '../settings/settings.service'
import {
  acceptInvite,
  changePassword,
  GoogleSignInError,
  mePayload,
  requestPasswordReset,
  resetPassword,
  signInWithGoogle,
  signInWithPassword,
} from './auth.service'
import type { GoogleSignIn, OidcState } from './google'
import { failedAttemptLimiters, ipFailureLimiter, requestLimiters } from './rate-limit'
import { authContext, clearSessionCookie, revokeSession, setSessionCookie } from './sessions'

export type AuthRouterDeps = {
  db: PrismaClient
  settings: SettingsService
  sessionSecret: string
  secureCookies: boolean
  mailer: Mailer
  appUrl: string
  features: Features
  // null when the Google sign-in variables aren't set.
  google: GoogleSignIn | null
}

const oidcCookie = 'boat_oidc'
const oidcCookieOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  secure,
  // Lax: the cookie must come back on Google's top-level redirect to the callback.
  sameSite: 'lax',
  path: '/api/v1/auth/google',
})
const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(`oidc:${payload}`).digest('base64url')
const signState = (state: OidcState, secret: string) => {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}
function readState(value: string, secret: string): OidcState | null {
  const [payload, mac] = value.split('.')
  if (!payload || !mac) return null
  const expected = Buffer.from(sign(payload, secret))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as OidcState
}

const loginBody = z.object({
  email: z.string({ error: 'Enter your email address.' }),
  password: z.string({ error: 'Enter your password.' }),
})
const acceptBody = z.object({
  token: z.string({ error: 'This link is incomplete. Open it again from the email.' }),
  password: z.string({ error: 'Choose a password.' }),
})
const forgotBody = z.object({ email: z.string({ error: 'Enter your email address.' }) })
const changeBody = z.object({
  currentPassword: z.string({ error: 'Enter your current password.' }),
  newPassword: z.string({ error: 'Choose a new password.' }),
})

export function authRouter(deps: AuthRouterDeps) {
  const router = Router()

  // Sets the cookie for a new session and answers with what /auth/me would return.
  async function startSession(
    res: Response,
    session: { token: string; id: string; userId: string },
  ) {
    setSessionCookie(res, session.token, deps.secureCookies)
    res.json(
      await mePayload(
        deps.settings,
        deps.features,
        await authContext(deps.db, deps.sessionSecret, session),
      ),
    )
  }

  router.post('/login', publicRoute(), ...failedAttemptLimiters(), async (req, res) => {
    const { email, password } = parseInput(loginBody, req.body)
    await startSession(
      res,
      await signInWithPassword(deps.db, email, password, req.get('user-agent')),
    )
  })

  router.post('/logout', requireSignedIn(), async (req, res) => {
    await revokeSession(deps.db, authOf(req).sessionId)
    clearSessionCookie(res, deps.secureCookies)
    res.status(204).end()
  })

  router.get('/me', requireSignedIn(), async (req, res) => {
    res.json(await mePayload(deps.settings, deps.features, authOf(req)))
  })

  // FR-11.5: Google sign-in. The sign-in page asks whether it is set up.
  router.get('/options', publicRoute(), (_req, res) => {
    res.json({ google: !!deps.google })
  })

  // A full-page navigation from the sign-in page: off to Google, with state, nonce and the PKCE
  // verifier in a short-lived signed cookie that only the callback path receives.
  router.get('/google/start', publicRoute(), async (_req, res) => {
    if (!deps.google) throw new NotFoundError()
    const { url, state } = await deps.google.start()
    res.cookie(oidcCookie, signState(state, deps.sessionSecret), {
      ...oidcCookieOptions(deps.secureCookies),
      maxAge: 10 * 60_000,
    })
    res.redirect(302, url)
  })

  // Google sends the browser back here. Any refusal or failure lands on /sign-in?error=<code>.
  router.get('/google/callback', publicRoute(), async (req, res) => {
    if (!deps.google) throw new NotFoundError()
    const signed: unknown = req.cookies?.[oidcCookie]
    res.clearCookie(oidcCookie, oidcCookieOptions(deps.secureCookies))
    try {
      const state = typeof signed === 'string' ? readState(signed, deps.sessionSecret) : null
      if (!state) throw new Error('missing or invalid sign-in state')
      const identity = await deps.google.finish(new URL(req.originalUrl, deps.appUrl), state)
      const session = await signInWithGoogle(
        deps.db,
        identity,
        deps.google.allowedDomains,
        req.get('user-agent'),
      )
      setSessionCookie(res, session.token, deps.secureCookies)
      res.redirect(302, `${deps.appUrl}/`)
    } catch (err) {
      const code = err instanceof GoogleSignInError ? err.code : 'failed'
      if (code === 'failed') req.log.warn({ err }, 'google sign-in failed')
      res.redirect(302, `${deps.appUrl}/sign-in?error=${code}`)
    }
  })

  router.post('/invites/accept', publicRoute(), async (req, res) => {
    const { token, password } = parseInput(acceptBody, req.body)
    await startSession(res, await acceptInvite(deps.db, token, password, req.get('user-agent')))
  })

  router.post('/password/forgot', publicRoute(), ...requestLimiters(), (req, res) => {
    const { email } = parseInput(forgotBody, req.body)
    // Answered before the lookup finishes, so response time doesn't reveal whether the account
    // exists. A failure is logged instead.
    requestPasswordReset(deps, email, req.log).catch((err: unknown) =>
      req.log.error({ err }, 'password reset request failed'),
    )
    res.status(202).json({
      message: 'If that email belongs to an active account, a reset link is on its way.',
    })
  })

  router.post('/password/reset', publicRoute(), async (req, res) => {
    const { token, password } = parseInput(acceptBody, req.body)
    await resetPassword(deps.db, token, password)
    res.status(204).end()
  })

  router.patch('/me/password', requireSignedIn(), ipFailureLimiter(), async (req, res) => {
    const { currentPassword, newPassword } = parseInput(changeBody, req.body)
    const session = await changePassword(
      deps.db,
      authOf(req).user.id,
      currentPassword,
      newPassword,
      req.get('user-agent'),
    )
    await startSession(res, session)
  })

  return router
}
