import { type Response, Router } from 'express'
import { z } from 'zod'
import { authOf, publicRoute, requireSignedIn } from '../../core/access'
import { parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import type { SettingsService } from '../settings/settings.service'
import { mePayload, signInWithPassword } from './auth.service'
import { failedAttemptLimiters } from './rate-limit'
import { authContext, clearSessionCookie, revokeSession, setSessionCookie } from './sessions'

export type AuthRouterDeps = {
  db: PrismaClient
  settings: SettingsService
  sessionSecret: string
  secureCookies: boolean
}

const loginBody = z.object({
  email: z.string({ error: 'Enter your email address.' }),
  password: z.string({ error: 'Enter your password.' }),
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
      await mePayload(deps.settings, await authContext(deps.db, deps.sessionSecret, session)),
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
    res.json(await mePayload(deps.settings, authOf(req)))
  })

  return router
}
