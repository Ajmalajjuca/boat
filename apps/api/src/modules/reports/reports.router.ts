import { Router } from 'express'
import { z } from 'zod'
import { requireSignedIn } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { parseInput } from '../../core/parse'
import { monthEndCsv, monthEndReport, monthList } from './month-end.service'

const monthQuery = z.object({
  month: z
    .string({ error: 'Choose a month.' })
    .regex(/^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])$/, { error: 'Use the format YYYY-MM.' }),
})

export function reportsRouter(deps: RecordsDeps) {
  const router = Router()

  router.get('/month-end', requireSignedIn(), async (req, res) => {
    res.json(await monthEndReport(deps, parseInput(monthQuery, req.query).month))
  })

  router.get('/months', requireSignedIn(), async (_req, res) => {
    res.json(await monthList(deps))
  })

  router.get('/month-end/export.csv', requireSignedIn(), async (req, res) => {
    const { filename, body } = await monthEndCsv(deps, parseInput(monthQuery, req.query).month)
    res.type('text/csv; charset=utf-8').attachment(filename).send(body)
  })

  return router
}
