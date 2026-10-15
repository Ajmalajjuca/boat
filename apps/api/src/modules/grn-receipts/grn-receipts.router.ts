import { Router } from 'express'
import { z } from 'zod'
import { authOf, requireLotAccess, requirePermission } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { isoDate } from '../../core/dates'
import { quantity, text } from '../../core/fields'
import { parseId, parseInput } from '../../core/parse'
import { createReceipt, deleteReceipt, updateReceipt } from './grn-receipts.service'

const fields = {
  label: z
    .string({ error: 'Enter a receipt label.' })
    .max(60, { error: 'Keep the label to 60 characters or fewer.' }),
  date: isoDate,
  quantity: quantity('quantity'),
  note: text(1000),
}
const createBody = z.strictObject({ ...fields, note: fields.note.default('') })
const patchBody = z.strictObject(fields).partial()

// Two routers: one posts receipts under /lots/:id, the other edits and deletes them by id.
export function grnReceiptRouters(deps: RecordsDeps) {
  const underLots = Router()
  underLots.post('/:id/grn-receipts', requireLotAccess(), async (req, res) => {
    const input = parseInput(createBody, req.body)
    res.status(201).json(await createReceipt(deps, authOf(req).user, parseId(req.params.id), input))
  })

  const receipts = Router()
  receipts.patch('/:id', requireLotAccess(), async (req, res) => {
    const patch = parseInput(patchBody, req.body)
    res.json(await updateReceipt(deps, authOf(req).user, parseId(req.params.id), patch))
  })
  receipts.delete('/:id', requirePermission('deleteEntries'), async (req, res) => {
    await deleteReceipt(deps, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return { underLots, receipts }
}
