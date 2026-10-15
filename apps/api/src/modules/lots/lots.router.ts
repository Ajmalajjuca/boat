import { Router } from 'express'
import { z } from 'zod'
import { authOf, requireLotAccess, requirePermission, requireSignedIn } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { optionalDate } from '../../core/dates'
import { parseId, parseInput } from '../../core/parse'
import { getLotDetail } from './lot-view'
import { createLot, deleteLot, updateLot } from './lots.service'

const choose = (label: string) => z.guid({ error: `Choose ${label} from the list.` })
// Whole-number and sign rules come from validateLot; this keeps values inside Postgres integer.
const qty = (label: string) =>
  z
    .number({ error: `Enter the ${label} as a number.` })
    .max(1_000_000_000, { error: 'Enter 1,000,000,000 or less.' })
const text = (max: number) =>
  z.string({ error: 'Enter text.' }).max(max, { error: `Keep this to ${max} characters or fewer.` })

const fields = {
  productId: z.guid({ error: 'Choose a product.' }),
  label: z
    .string({ error: 'Enter a lot label, e.g. Lot 1.' })
    .max(60, { error: 'Keep the label to 60 characters or fewer.' }),
  categoryId: choose('a product category'),
  directFg: z.boolean({ error: 'Choose yes or no.' }),
  emsId: choose('an EMS').nullable(),
  pocId: choose('a point of contact').nullable(),
  statusId: choose('an overall status'),
  stageId: choose('a stage'),
  rmMode: z.enum(['all', 'components'], { error: 'Choose how RM is tracked.' }),
  componentIds: z.array(choose('components')).max(50, { error: 'Choose 50 components or fewer.' }),
  readyQty: qty('ready quantity'),
  lotQty: qty('lot quantity'),
  freshProductionQty: qty('fresh production quantity'),
  reworkQty: qty('rework quantity'),
  reworkReason: text(500),
  rmReadyDate: optionalDate,
  plannedDate: optionalDate,
  revisedEta: optionalDate,
  actualDate: optionalDate,
  logisticsId: choose('a logistics mode').nullable(),
  blockerId: choose('a blocker category').nullable(),
  blockerDescription: text(1000),
  followUpDate: optionalDate,
  followUpNote: text(1000),
}
// Unknown keys are refused, so a typo such as "status" for "statusId" fails loudly.
const createBody = z.strictObject({
  ...fields,
  directFg: fields.directFg.default(false),
  emsId: fields.emsId.default(null),
  pocId: fields.pocId.default(null),
  rmMode: fields.rmMode.default('all'),
  componentIds: fields.componentIds.default([]),
  readyQty: fields.readyQty.default(0),
  lotQty: fields.lotQty.default(0),
  freshProductionQty: fields.freshProductionQty.default(0),
  reworkQty: fields.reworkQty.default(0),
  reworkReason: fields.reworkReason.default(''),
  rmReadyDate: fields.rmReadyDate.default(null),
  plannedDate: fields.plannedDate.default(null),
  revisedEta: fields.revisedEta.default(null),
  actualDate: fields.actualDate.default(null),
  logisticsId: fields.logisticsId.default(null),
  blockerId: fields.blockerId.default(null),
  blockerDescription: fields.blockerDescription.default(''),
  followUpDate: fields.followUpDate.default(null),
  followUpNote: fields.followUpNote.default(''),
})
const patchBody = z
  .strictObject(fields)
  .partial()
  .extend({ version: z.number({ error: 'Reload the lot and try again.' }).int() })

export function lotsRouter(deps: RecordsDeps) {
  const router = Router()

  // List, summary and CSV routes (Task 6) go above /:id, which would otherwise match them.

  router.get('/:id', requireSignedIn(), async (req, res) => {
    const date = await deps.clock.today()
    res.json(await getLotDetail(deps.db, parseId(req.params.id), date, authOf(req).user))
  })

  router.post('/', requirePermission('createLots'), async (req, res) => {
    res.status(201).json(await createLot(deps, authOf(req).user, parseInput(createBody, req.body)))
  })

  router.patch('/:id', requireLotAccess(), async (req, res) => {
    const patch = parseInput(patchBody, req.body)
    res.json(await updateLot(deps, authOf(req).user, parseId(req.params.id), patch))
  })

  router.delete('/:id', requirePermission('deleteLots'), async (req, res) => {
    await deleteLot(deps, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
