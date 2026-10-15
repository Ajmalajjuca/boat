import { Router } from 'express'
import { requirePermission } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { exportBackup } from './export.service'

export function dataRouter(deps: RecordsDeps) {
  const router = Router()

  router.get('/export', requirePermission('exportBackup'), async (_req, res) => {
    const date = await deps.clock.today()
    res.attachment(`boat-backup-${date}.json`).json(await exportBackup(deps.db))
  })

  return router
}
