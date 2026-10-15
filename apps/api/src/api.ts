import { Router } from 'express'
import { createClock } from './core/clock'
import type { Mailer } from './core/mailer'
import type { PrismaClient } from './generated/prisma/client'
import { authRouter } from './modules/auth/auth.router'
import { activityRouter } from './modules/activity/activity.router'
import { loadSession } from './modules/auth/sessions'
import { healthRouter, type ReadinessCheck } from './modules/health/health.router'
import { settingsRouter } from './modules/settings/settings.router'
import { createSettingsService } from './modules/settings/settings.service'
import { lookupsRouter } from './modules/lookups/lookups.router'
import { lotsRouter } from './modules/lots/lots.router'
import { grnReceiptRouters } from './modules/grn-receipts/grn-receipts.router'
import { productsRouter } from './modules/products/products.router'
import { rmBatchRouters } from './modules/rm-batches/rm-batches.router'
import { shipmentsRouter } from './modules/shipments/shipments.router'
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
  // The time for "today". Tests pass a fixed one; production uses the real time.
  now?: () => Date
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
  const records = { db: deps.db, clock: createClock(settings, deps.now) }
  api.use(loadSession({ db: deps.db, settings, sessionSecret: deps.sessionSecret }))
  mount(api, '/health', healthRouter(deps.checkDatabase))
  mount(api, '/auth', authRouter({ ...deps, settings }))
  mount(api, '/users', usersRouter(deps))
  mount(api, '/settings', settingsRouter(settings))
  mount(api, '/lookups', lookupsRouter(deps.db))
  mount(api, '/products', productsRouter(deps.db))
  mount(api, '/lots', lotsRouter(records))
  const batches = rmBatchRouters(records)
  mount(api, '/lots', batches.underLots)
  mount(api, '/rm-batches', batches.batches)
  const receipts = grnReceiptRouters(records)
  mount(api, '/lots', receipts.underLots)
  mount(api, '/grn-receipts', receipts.receipts)
  mount(api, '/lots', activityRouter(deps.db))
  mount(api, '/shipments', shipmentsRouter(records))
  return api
}
