import { Router } from 'express'
import { z } from 'zod'
import { authOf, requireLotAccess, requirePermission } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { optionalDate } from '../../core/dates'
import { quantity, text } from '../../core/fields'
import { parseId, parseInput } from '../../core/parse'
import { createBatch, deleteBatch, updateBatch } from './rm-batches.service'

const fields = {
  componentId: z.guid({ error: 'Choose a component.' }),
  label: z
    .string({ error: 'Enter a batch label.' })
    .max(60, { error: 'Keep the label to 60 characters or fewer.' }),
  plannedQty: quantity('planned quantity'),
  plannedDate: optionalDate,
  receivedQty: quantity('received quantity'),
  receivedDate: optionalDate,
  status: text(60),
  notes: text(1000),
}
const createBody = z.strictObject({
  ...fields,
  label: fields.label.default(''),
  plannedQty: fields.plannedQty.default(0),
  plannedDate: fields.plannedDate.default(null),
  receivedQty: fields.receivedQty.default(0),
  receivedDate: fields.receivedDate.default(null),
  status: fields.status.default(''),
  notes: fields.notes.default(''),
})
const patchBody = z.strictObject(fields).partial()

// Two routers: one adds batches under /lots/:id, the other edits and deletes them by id.
export function rmBatchRouters(deps: RecordsDeps) {
  const underLots = Router()
  underLots.post('/:id/rm-batches', requireLotAccess(), async (req, res) => {
    const input = parseInput(createBody, req.body)
    res.status(201).json(await createBatch(deps, authOf(req).user, parseId(req.params.id), input))
  })

  const batches = Router()
  batches.patch('/:id', requireLotAccess(), async (req, res) => {
    const patch = parseInput(patchBody, req.body)
    res.json(await updateBatch(deps, authOf(req).user, parseId(req.params.id), patch))
  })
  batches.delete('/:id', requirePermission('deleteEntries'), async (req, res) => {
    await deleteBatch(deps, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return { underLots, batches }
}
