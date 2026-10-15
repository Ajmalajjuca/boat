import { assertValid, validateLookupValue, ValidationError } from '@boat/domain/validation'
import { ConflictError, NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { type LookupKind, Prisma, type PrismaClient } from '../../generated/prisma/client'

const lookupSelect = {
  id: true,
  kind: true,
  value: true,
  sort: true,
  systemKey: true,
} satisfies Prisma.LookupValueSelect
type LookupRow = Prisma.LookupValueGetPayload<{ select: typeof lookupSelect }>
const view = ({ systemKey, ...row }: LookupRow) => ({ ...row, system: systemKey !== null })
export type LookupView = ReturnType<typeof view>

// The partial unique index on (kind, value) catches duplicates, in any letter case (citext).
function rethrowDuplicate(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    throw new ValidationError({ value: 'This value already exists.' })
  throw err
}

export async function listLookups(db: PrismaClient, kind?: LookupKind) {
  const rows = await db.lookupValue.findMany({
    where: { deletedAt: null, ...(kind && { kind }) },
    select: lookupSelect,
    orderBy: [{ kind: 'asc' }, { sort: 'asc' }, { value: 'asc' }],
  })
  return { items: rows.map(view) }
}

export async function createLookup(db: PrismaClient, kind: LookupKind, value: string) {
  assertValid(validateLookupValue(value))
  return db.$transaction(async (tx) => {
    const { _max } = await tx.lookupValue.aggregate({
      where: { kind, deletedAt: null },
      _max: { sort: true },
    })
    const row = await tx.lookupValue
      .create({
        data: { kind, value: value.trim(), sort: (_max.sort ?? -1) + 1 },
        select: lookupSelect,
      })
      .catch(rethrowDuplicate)
    return view(row)
  })
}

export async function updateLookup(
  db: PrismaClient,
  id: string,
  patch: { value?: string; sort?: number },
) {
  const current = await db.lookupValue.findFirst({
    where: { id, deletedAt: null },
    select: lookupSelect,
  })
  if (!current) throw new NotFoundError()
  const value = patch.value?.trim()
  if (value !== undefined) {
    assertValid(validateLookupValue(value))
    if (current.systemKey && value !== current.value)
      throw new ValidationError({
        value: `${current.value} is used by app calculations and cannot be renamed.`,
      })
  }
  const row = await db.lookupValue
    .update({
      where: { id },
      data: {
        ...(value !== undefined && { value }),
        ...(patch.sort !== undefined && { sort: patch.sort }),
      },
      select: lookupSelect,
    })
    .catch(rethrowDuplicate)
  return view(row)
}

const lotFields: Partial<Record<LookupKind, string>> = {
  category: 'categoryId',
  ems: 'emsId',
  poc: 'pocId',
  status: 'statusId',
  stage: 'stageId',
  blocker: 'blockerId',
  logistics: 'logisticsId',
}

// Active records that point at the value. Records that are deleted don't count.
async function inUse(db: Db, kind: LookupKind, id: string) {
  const counts: Promise<number>[] = []
  const lotField = lotFields[kind]
  if (lotField)
    counts.push(
      db.lot.count({ where: { deletedAt: null, [lotField]: id } as Prisma.LotWhereInput }),
    )
  if (kind === 'segment')
    counts.push(db.product.count({ where: { deletedAt: null, segmentId: id } }))
  if (kind === 'poc') counts.push(db.user.count({ where: { deletedAt: null, pocId: id } }))
  if (kind === 'component') {
    const activeLot = { is: { deletedAt: null } }
    counts.push(
      db.lotComponent.count({ where: { deletedAt: null, componentId: id, lot: activeLot } }),
      db.rmBatch.count({ where: { deletedAt: null, componentId: id, lot: activeLot } }),
    )
  }
  if (kind === 'shipmentStage')
    counts.push(db.shipment.count({ where: { deletedAt: null, stageId: id } }))
  return (await Promise.all(counts)).some((n) => n > 0)
}

export async function deleteLookup(db: PrismaClient, actorId: string, id: string) {
  await db.$transaction(async (tx) => {
    // Waits for any transaction that holds this value FOR SHARE (resolveLookups) to finish, so
    // the in-use check below sees a record saved at the same moment.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM lookup_values WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`
    if (!locked.length) throw new NotFoundError()
    const current = await tx.lookupValue.findUniqueOrThrow({ where: { id }, select: lookupSelect })
    if (current.systemKey)
      throw new ConflictError(`${current.value} is used by app calculations and cannot be deleted.`)
    if (await inUse(tx, current.kind, id))
      throw new ConflictError(`${current.value} is in use. Reassign those records first.`)
    await tx.lookupValue.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: actorId },
    })
  })
}
