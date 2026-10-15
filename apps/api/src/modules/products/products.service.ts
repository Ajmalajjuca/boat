import type { Product } from '@boat/domain/models'
import { assertValid, validateProduct, ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf } from '../../core/audit'
import { ConflictError, NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { Prisma, type PrismaClient } from '../../generated/prisma/client'
import { renameFields, resolveLookups } from '../lookups/resolve'
import { softDeleteLots } from '../lots/lot-deletion'

const productSelect = {
  id: true,
  version: true,
  name: true,
  variant: true,
  segment: { select: { id: true, value: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect
export type ProductView = Prisma.ProductGetPayload<{ select: typeof productSelect }>

export type ProductInput = { name: string; variant: string; segmentId: string }
export type ProductPatch = Partial<ProductInput> & { version: number }

export async function listProducts(db: PrismaClient) {
  const items = await db.product.findMany({
    where: { deletedAt: null },
    select: productSelect,
    orderBy: [{ name: 'asc' }, { variant: 'asc' }],
  })
  return { items }
}

// Trims the input and checks it the way the demo's saveProduct does, with the segment checked
// against Settings (FR-8.3).
async function checkProduct(db: Db, input: ProductInput) {
  const name = input.name.trim()
  const variant = input.variant.trim()
  const { valueOf, errors } = await resolveLookups(db, [
    { field: 'segmentId', kind: 'segment', id: input.segmentId, label: 'a segment' },
  ])
  const domain: Product = {
    id: '',
    createdAt: '',
    updatedAt: '',
    name,
    variant,
    segment: valueOf(input.segmentId),
  }
  assertValid({ ...renameFields(validateProduct(domain), { segment: 'segmentId' }), ...errors })
  return { name, variant, segmentId: input.segmentId }
}

// FR-1.1: the partial unique index on (name, variant) is case-insensitive (citext).
const duplicateName =
  (name: string, variant: string) =>
  (err: unknown): never => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      throw new ValidationError({
        name: `${name}${variant ? ` · ${variant}` : ''} already exists. Use a different name or variant.`,
      })
    throw err
  }

async function lockProduct(db: Db, id: string) {
  const rows = await db.$queryRaw<{ version: number }[]>`
    SELECT version FROM products WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`
  if (!rows.length) throw new NotFoundError()
  return rows[0].version
}

const lockProductLots = (db: Db, productId: string) =>
  db.$queryRaw`
    SELECT id FROM lots WHERE product_id = ${productId}::uuid AND deleted_at IS NULL
    ORDER BY id FOR UPDATE`

export async function createProduct(db: PrismaClient, input: ProductInput) {
  return db.$transaction(async (tx) => {
    const data = await checkProduct(tx, input)
    return tx.product
      .create({ data, select: productSelect })
      .catch(duplicateName(data.name, data.variant))
  })
}

export async function updateProduct(db: PrismaClient, id: string, patch: ProductPatch) {
  return db.$transaction(async (tx) => {
    const version = await lockProduct(tx, id)
    const current = await tx.product.findUniqueOrThrow({ where: { id }, select: productSelect })
    if (patch.version !== version)
      throw new ConflictError(
        'Someone else changed this product. Review their changes and try again.',
        current,
      )
    const data = await checkProduct(tx, {
      name: patch.name ?? current.name,
      variant: patch.variant ?? current.variant,
      segmentId: patch.segmentId ?? current.segment.id,
    })
    return tx.product
      .update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
        select: productSelect,
      })
      .catch(duplicateName(data.name, data.variant))
  })
}

export async function deleteProduct(db: PrismaClient, user: SessionUser, id: string) {
  await db.$transaction(async (tx) => {
    // Lots first, then the product: the order every lot write uses (lot row, then the product
    // FOR SHARE), so a delete and a lot change queue instead of deadlocking. Holding the lot rows
    // also keeps a batch or receipt from landing on them after the cascade below has run.
    await lockProductLots(tx, id)
    await lockProduct(tx, id)
    // A lot created while this waited for the product is locked now too.
    await lockProductLots(tx, id)
    const onShipment = await tx.shipmentItem.count({
      where: { productId: id, deletedAt: null, shipment: { is: { deletedAt: null } } },
    })
    if (onShipment)
      throw new ConflictError(
        'This product is used in a shipment. Remove or reassign those shipment lines first.',
      )
    const lots = await tx.lot.findMany({
      where: { productId: id, deletedAt: null },
      select: { id: true, label: true },
    })
    await softDeleteLots(tx, actorOf(user), lots)
    await tx.product.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id } })
  })
}
