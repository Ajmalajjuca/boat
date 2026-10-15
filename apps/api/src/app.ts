import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import { errorHandler } from './core/errors'
import { healthRouter, type ReadinessCheck } from './modules/health/health.router'

export type AppOptions = {
  logger: Logger
  // Built React app (apps/web/dist). Skipped when it has no index.html, e.g. in API tests.
  webDist?: string
  checkDatabase: ReadinessCheck
}

export function createApp({ logger, webDist, checkDatabase }: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) || randomUUID()
        res.setHeader('x-request-id', id)
        return id
      },
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  const api = express.Router()
  api.use('/health', healthRouter(checkDatabase))
  app.use('/api/v1', api)
  // Unknown API paths stay JSON so the browser client never receives index.html by mistake.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false }))
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
