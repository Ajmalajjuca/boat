import { Router } from 'express'
import type { PrismaClient } from './generated/prisma/client'
import { healthRouter, type ReadinessCheck } from './modules/health/health.router'

export type ApiDeps = {
  db: PrismaClient
  checkDatabase: ReadinessCheck
  // Signs CSRF tokens.
  sessionSecret: string
  // The web app's address, for links in emails.
  appUrl: string
  // Secure cookies need HTTPS: true in production.
  secureCookies: boolean
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
  mount(api, '/health', healthRouter(deps.checkDatabase))
  return api
}
