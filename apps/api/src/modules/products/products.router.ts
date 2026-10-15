import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission, requireSignedIn } from '../../core/access'
import { parseId, parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import { createProduct, deleteProduct, listProducts, updateProduct } from './products.service'

const name = z
  .string({ error: 'Enter the product name.' })
  .max(100, { error: 'Keep the name to 100 characters or fewer.' })
const variant = z.string().max(100, { error: 'Keep the variant to 100 characters or fewer.' })
const segmentId = z.guid({ error: 'Choose a segment from the list.' })
const version = z.number({ error: 'Reload the record and try again.' }).int()
const createBody = z.strictObject({ name, variant: variant.default(''), segmentId })
const patchBody = z.strictObject({
  name: name.optional(),
  variant: variant.optional(),
  segmentId: segmentId.optional(),
  version,
})

export function productsRouter(db: PrismaClient) {
  const router = Router()

  router.get('/', requireSignedIn(), async (_req, res) => {
    res.json(await listProducts(db))
  })

  router.post('/', requirePermission('editProducts'), async (req, res) => {
    res.status(201).json(await createProduct(db, parseInput(createBody, req.body)))
  })

  router.patch('/:id', requirePermission('editProducts'), async (req, res) => {
    res.json(await updateProduct(db, parseId(req.params.id), parseInput(patchBody, req.body)))
  })

  router.delete('/:id', requirePermission('deleteProducts'), async (req, res) => {
    await deleteProduct(db, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
