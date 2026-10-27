import { type Response, Router } from 'express'
import { z } from 'zod'
import { authOf, publicRoute, requireSignedIn } from '../../core/access'
import type { Features } from '../../core/clock'
import type { Mailer } from '../../core/mailer'
import { parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import type { SettingsService } from '../settings/settings.service'
import {
  acceptInvite,
  changePassword,
  mePayload,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
} from './auth.service'
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
