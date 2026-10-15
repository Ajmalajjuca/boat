import { Router } from 'express'
import type { Mailer } from './core/mailer'
import type { PrismaClient } from './generated/prisma/client'
import { authRouter } from './modules/auth/auth.router'
import { loadSession } from './modules/auth/sessions'
import { healthRouter, type ReadinessCheck } from './modules/health/health.router'
import { createSettingsService } from './modules/settings/settings.service'
import { usersRouter } from './modules/users/users.router'

export type ApiDeps = {
  db: PrismaClient
  checkDatabase: ReadinessCheck
  // Signs CSRF tokens.
  sessionSecret: string
  // The web app's address, for links in emails.
  appUrl: string
  // Secure cookies need HTTPS: true in production.
  secureCookies: boolean
  mailer: Mailer
}

const mountPaths = new WeakMap<object, string>()
// Express 5 does not keep a mounted router's path where a test can read it, so mount() records it
// for the route walk in api.test.ts.
function mount(api: Router, path: string, router: Router) {
  mountPaths.set(router, path)
  api.use(path, router)
}
export const mountPathOf = (router: object) => mountPaths.get(router)

export function buildApiRouter(deps: ApiDeps) {
  const api = Router()
  const settings = createSettingsService(deps.db)
  api.use(loadSession({ db: deps.db, settings, sessionSecret: deps.sessionSecret }))
  mount(api, '/health', healthRouter(deps.checkDatabase))
  mount(api, '/auth', authRouter({ ...deps, settings }))
  mount(api, '/users', usersRouter(deps))
  return api
}
