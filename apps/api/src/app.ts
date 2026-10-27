import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import express from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import { type ApiDeps, buildApiRouter } from './api'
import { errorHandler } from './core/errors'

export type AppOptions = {
  logger: Logger
  // Built React app (apps/web/dist). Skipped when it has no index.html, e.g. in API tests.
  webDist?: string
  // Proxy hops in front of the app. Behind Render's proxy, req.ip must be the client's address,
  // or the per-IP sign-in limit would count every user together.
  trustProxy?: number
  // Strict-Transport-Security, for production behind HTTPS.
  hsts?: boolean
  api: ApiDeps
}

export function createApp({
  logger,
  webDist,
  trustProxy = 0,
  hsts = false,
  api: deps,
}: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy || false)
  if (hsts)
    app.use((_req, res, next) => {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000')
      next()
    })
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) || randomUUID()
        res.setHeader('x-request-id', id)
        return id
      },
      // Evaluated again when the response finishes, after loadSession has run, so the "request
      // completed" line names the signed-in user (PRD: request and user IDs on every log line).
      customProps: (req) => (req.auth ? { userId: req.auth.user.id } : {}),
    }),
  )
  // Every route reads JSON up to 1 MB, except a backup import, which parses its own body up to
  // 20 MB (data.router.ts).
  const json = express.json({ limit: '1mb' })
  app.use((req, res, next) => (req.path === '/api/v1/data/import' ? next() : json(req, res, next)))
  app.use(cookieParser())

  app.use('/api/v1', buildApiRouter(deps))
  // Unknown API paths stay JSON so the browser client never receives index.html by mistake.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false }))
    app.get('/{*splat}', (_req, res) => {
      // root keeps send's dot-file check to the file name, so a build under a dot directory
      // (e.g. a git worktree in .claude/worktrees) still serves.
      res.sendFile('index.html', { root: webDist })
    })
  }

  app.use(errorHandler)
  return app
}
