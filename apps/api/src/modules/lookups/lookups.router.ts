import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission, requireSignedIn } from '../../core/access'
import { parseId, parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import { createLookup, deleteLookup, listLookups, updateLookup } from './lookups.service'

const kind = z.enum(
  [
    'segment',
    'category',
    'ems',
    'poc',
    'status',
    'stage',
    'blocker',
    'logistics',
    'component',
    'shipmentStage',
  ],
  { error: 'Choose a kind of value.' },
)
const value = z
  .string({ error: 'Enter a value.' })
  .max(100, { error: 'Keep the value to 100 characters or fewer.' })
const listQuery = z.object({ kind: kind.optional() })
const createBody = z.strictObject({ kind, value })
const patchBody = z.strictObject({
  value: value.optional(),
  sort: z.number({ error: 'Enter a position.' }).int().min(0).max(100_000).optional(),
})

export function lookupsRouter(db: PrismaClient) {
  const router = Router()

  router.get('/', requireSignedIn(), async (req, res) => {
    res.json(await listLookups(db, parseInput(listQuery, req.query).kind))
  })

  router.post('/', requirePermission('manageSettings'), async (req, res) => {
    const body = parseInput(createBody, req.body)
    res.status(201).json(await createLookup(db, body.kind, body.value))
  })

  router.patch('/:id', requirePermission('manageSettings'), async (req, res) => {
    res.json(await updateLookup(db, parseId(req.params.id), parseInput(patchBody, req.body)))
  })

  router.delete('/:id', requirePermission('manageSettings'), async (req, res) => {
    await deleteLookup(db, authOf(req).user.id, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
