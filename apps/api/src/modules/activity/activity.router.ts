import { Router } from 'express'
import { z } from 'zod'
import { authOf, requireLotAccess, requireSignedIn } from '../../core/access'
import { pageQuery } from '../../core/pagination'
import { parseId, parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import { addLotNote, lotActivity } from './activity.service'

const noteBody = z.strictObject({
  message: z
    .string({ error: 'Write a note first.' })
    .max(2000, { error: 'Keep the note to 2,000 characters or fewer.' }),
})

export function activityRouter(db: PrismaClient) {
  const router = Router()

  router.get('/:id/activity', requireSignedIn(), async (req, res) => {
    res.json(await lotActivity(db, parseId(req.params.id), parseInput(pageQuery, req.query)))
  })

  router.post('/:id/notes', requireLotAccess(), async (req, res) => {
    const { message } = parseInput(noteBody, req.body)
    res.status(201).json(await addLotNote(db, authOf(req).user, parseId(req.params.id), message))
  })

  return router
}
