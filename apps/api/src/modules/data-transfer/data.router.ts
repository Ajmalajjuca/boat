import express, { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { parseInput } from '../../core/parse'
import type { SettingsService } from '../settings/settings.service'
import { exportBackup } from './export.service'
import { importBackup } from './import.service'
import { resetData, resetPhrase } from './reset.service'

const modeQuery = z.object({
  mode: z.enum(['merge', 'replace'], { error: 'Choose merge or replace.' }),
})
const resetBody = z.strictObject({
  confirm: z.string({ error: `Type ${resetPhrase} to confirm.` }),
})

export function dataRouter(deps: RecordsDeps, settings: SettingsService) {
  const router = Router()

  router.get('/export', requirePermission('exportBackup'), async (_req, res) => {
    const date = await deps.clock.today()
    res.attachment(`boat-backup-${date}.json`).json(await exportBackup(deps.db))
  })

  // The body is a whole backup, so it may be up to 20 MB (PRD).
  router.post(
    '/import',
    requirePermission('manageData'),
    express.json({ limit: '20mb' }),
    async (req, res) => {
      const { mode } = parseInput(modeQuery, req.query)
      res.json(await importBackup(deps.db, settings, authOf(req).user, req.body, mode))
    },
  )

  router.post('/reset', requirePermission('manageData'), async (req, res) => {
    const { confirm } = parseInput(resetBody, req.body)
    res.json({ deleted: await resetData(deps.db, authOf(req).user, confirm) })
  })

  return router
}
