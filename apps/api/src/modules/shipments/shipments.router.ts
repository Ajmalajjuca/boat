import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission, requireSignedIn } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { optionalDate } from '../../core/dates'
import { quantity, text } from '../../core/fields'
import { parseId, parseInput } from '../../core/parse'
import { getShipmentDetail } from './shipment-view'
import { createShipment, deleteShipment, updateShipment } from './shipments.service'

const item = z.strictObject({
  productId: z.guid({ error: 'Choose a product.' }),
  quantity: quantity('quantity'),
})
const fields = {
  number: z
    .string({ error: 'Enter the shipment or invoice number.' })
    .max(60, { error: 'Keep the number to 60 characters or fewer.' }),
  vessel: z
    .string({ error: 'Enter the vessel, flight, or carrier.' })
    .max(100, { error: 'Keep this to 100 characters or fewer.' }),
  etd: optionalDate,
  plannedEta: optionalDate,
  revisedEta: optionalDate,
  actualArrival: optionalDate,
  stageId: z.guid({ error: 'Choose a shipment stage from the list.' }).nullable(),
  remarks: text(1000),
  items: z
    .array(item, { error: 'Add at least one product line.' })
    .max(200, { error: 'Keep a shipment to 200 lines or fewer.' }),
}
const createBody = z.strictObject({
  ...fields,
  etd: fields.etd.default(null),
  plannedEta: fields.plannedEta.default(null),
  revisedEta: fields.revisedEta.default(null),
  actualArrival: fields.actualArrival.default(null),
  stageId: fields.stageId.default(null),
  remarks: fields.remarks.default(''),
})
const patchBody = z
  .strictObject(fields)
  .partial()
  .extend({
    version: z.number({ error: 'Reload the shipment and try again.' }).int(),
    etaChangeReason: text(500).optional(),
  })

export function shipmentsRouter(deps: RecordsDeps) {
  const router = Router()

  // List, summary and CSV routes (Task 4) go above /:id, which would otherwise match them.

  router.get('/:id', requireSignedIn(), async (req, res) => {
    res.json(await getShipmentDetail(deps.db, parseId(req.params.id), await deps.clock.today()))
  })

  router.post('/', requirePermission('editShipments'), async (req, res) => {
    res
      .status(201)
      .json(await createShipment(deps, authOf(req).user, parseInput(createBody, req.body)))
  })

  router.patch('/:id', requirePermission('editShipments'), async (req, res) => {
    const patch = parseInput(patchBody, req.body)
    res.json(await updateShipment(deps, authOf(req).user, parseId(req.params.id), patch))
  })

  router.delete('/:id', requirePermission('deleteShipments'), async (req, res) => {
    await deleteShipment(deps, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
