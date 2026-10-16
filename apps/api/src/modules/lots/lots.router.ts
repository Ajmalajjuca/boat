import { Router } from 'express'
import { z } from 'zod'
import { authOf, requireLotAccess, requirePermission, requireSignedIn } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { optionalDate } from '../../core/dates'
import { quantity, text } from '../../core/fields'
import { pageQuery } from '../../core/pagination'
import { parseId, parseInput } from '../../core/parse'
import { type LotFilters, lotFlagNames, lotSorts } from './lot-list'
import { getLotDetail } from './lot-view'
import {
  createLot,
  deleteLot,
  exportLotsCsv,
  listLots,
  lotCards,
  lotGroups,
  updateLot,
} from './lots.service'

const choose = (label: string) => z.guid({ error: `Choose ${label} from the list.` })
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
  readyQty: quantity('ready quantity'),
  lotQty: quantity('lot quantity'),
  freshProductionQty: quantity('fresh production quantity'),
  reworkQty: quantity('rework quantity'),
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

const filterId = z.guid({ error: 'Choose a value from the list.' }).optional()
const listQuery = z.object({
  view: z.enum(['active', 'completed'], { error: 'Choose active or completed.' }).default('active'),
  q: z.string().max(100, { error: 'Keep the search to 100 characters or fewer.' }).default(''),
  productId: filterId,
  segmentId: filterId,
  categoryId: filterId,
  emsId: filterId,
  pocId: filterId,
  statusId: filterId,
  stageId: filterId,
  logisticsId: filterId,
  blockerId: filterId,
  // ?flag=overdue&flag=rm arrives as an array, a single ?flag=overdue as a string.
  flag: z.preprocess(
    (v) => (v === undefined ? [] : [v].flat()),
    z.array(z.enum(lotFlagNames, { error: 'Choose a known quick filter.' })),
  ),
  sort: z.enum(lotSorts, { error: 'Choose a known sort.' }).default('eta-asc'),
})
const toFilters = ({ flag, ...rest }: z.output<typeof listQuery>): LotFilters => ({
  ...rest,
  flags: flag,
})

export function lotsRouter(deps: RecordsDeps) {
  const router = Router()

  router.get('/', requireSignedIn(), async (req, res) => {
    const { page, pageSize, ...query } = parseInput(listQuery.extend(pageQuery.shape), req.query)
    res.json(await listLots(deps, authOf(req).user, toFilters(query), { page, pageSize }))
  })

  router.get('/summary', requireSignedIn(), async (_req, res) => {
    res.json(await lotCards(deps))
  })

  router.get('/groups', requireSignedIn(), async (req, res) => {
    res.json(await lotGroups(deps, toFilters(parseInput(listQuery, req.query))))
  })

  router.get('/export.csv', requireSignedIn(), async (req, res) => {
    const filters = toFilters(parseInput(listQuery, req.query))
    const { filename, body } = await exportLotsCsv(deps, authOf(req).user, filters)
    res.type('text/csv; charset=utf-8').attachment(filename).send(body)
  })

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
