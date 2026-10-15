import { Router } from 'express'

// Throws when a dependency is not ready.
export type ReadinessCheck = () => Promise<void>

// Public routes: Render's health check calls /ready, uptime monitors call /live.
export function healthRouter(checkDatabase: ReadinessCheck) {
  const router = Router()
  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' })
  })
  router.get('/ready', async (req, res) => {
    try {
      await checkDatabase()
      res.json({ status: 'ok' })
    } catch (err) {
      req.log.warn({ err }, 'readiness check failed')
      res.status(503).json({ status: 'unavailable' })
    }
  })
  return router
}
