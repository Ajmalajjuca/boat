import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission, requireSignedIn } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { optionalDate } from '../../core/dates'
import { quantity, text } from '../../core/fields'
import { pageQuery } from '../../core/pagination'
import { parseId, parseInput } from '../../core/parse'
import { entityActivity } from '../activity/activity.service'
import { getShipmentDetail } from './shipment-view'
import {
  addShipmentNote,
  createShipment,
  deleteShipment,
  exportShipmentsCsv,
  listShipments,
  shipmentCards,
  shipmentFlagNames,
  shipmentSorts,
  updateShipment,
} from './shipments.service'

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

const listQuery = z.object({
  q: z.string().max(100, { error: 'Keep the search to 100 characters or fewer.' }).default(''),
  stageId: z.guid({ error: 'Choose a value from the list.' }).optional(),
  vessel: z.string().max(100).optional(),
  flag: z.enum(shipmentFlagNames, { error: 'Choose a known quick filter.' }).optional(),
  sort: z.enum(shipmentSorts, { error: 'Choose a known sort.' }).default('eta-asc'),
})
const noteBody = z.strictObject({
  message: z
    .string({ error: 'Write a note first.' })
    .max(2000, { error: 'Keep the note to 2,000 characters or fewer.' }),
})

export function shipmentsRouter(deps: RecordsDeps) {
  const router = Router()

  router.get('/', requireSignedIn(), async (req, res) => {
    const { page, pageSize, ...filters } = parseInput(listQuery.extend(pageQuery.shape), req.query)
    res.json(await listShipments(deps, filters, { page, pageSize }))
  })

  router.get('/summary', requireSignedIn(), async (_req, res) => {
    res.json(await shipmentCards(deps))
  })

  router.get('/export.csv', requireSignedIn(), async (req, res) => {
    const { filename, body } = await exportShipmentsCsv(deps, parseInput(listQuery, req.query))
    res.type('text/csv; charset=utf-8').attachment(filename).send(body)
  })

  router.get('/:id/activity', requireSignedIn(), async (req, res) => {
    res.json(
      await entityActivity(
        deps.db,
        'shipment',
        parseId(req.params.id),
        parseInput(pageQuery, req.query),
      ),
    )
  })

  router.post('/:id/notes', requirePermission('editShipments'), async (req, res) => {
    const { message } = parseInput(noteBody, req.body)
    res
      .status(201)
      .json(await addShipmentNote(deps.db, authOf(req).user, parseId(req.params.id), message))
  })

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
