import { ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf, recordActivity } from '../../core/audit'
import { NotFoundError } from '../../core/errors'
import { type Page, pageArgs, pageOf } from '../../core/pagination'
import type { PrismaClient } from '../../generated/prisma/client'
import { lockLotForEdit } from '../lots/lot-lock'

const entrySelect = {
  id: true,
  kind: true,
  message: true,
  changes: true,
  actorId: true,
  actorName: true,
  createdAt: true,
} as const

export const entryView = (entry: {
  id: string
  kind: string
  message: string
  changes: unknown
  actorId: string | null
  actorName: string | null
  createdAt: Date
}) => ({
  id: entry.id,
  kind: entry.kind,
  message: entry.message,
  changes: entry.changes,
  actorId: entry.actorId,
  actorName: entry.actorName,
  createdAt: entry.createdAt,
})

// History of an active lot or shipment, newest first. A deleted record's history reads as 404.
export async function entityActivity(
  db: PrismaClient,
  entityType: 'lot' | 'shipment',
  entityId: string,
  page: Page,
) {
  const where = { id: entityId, deletedAt: null }
  const exists =
    entityType === 'lot'
      ? await db.lot.findFirst({ where, select: { id: true } })
      : await db.shipment.findFirst({ where, select: { id: true } })
  if (!exists) throw new NotFoundError()
  const filter = { entityType, entityId }
  const [items, total] = await Promise.all([
    db.activityLog.findMany({
      where: filter,
      select: entrySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(page),
    }),
    db.activityLog.count({ where: filter }),
  ])
  return pageOf(items, total, page)
}

export const lotActivity = (db: PrismaClient, lotId: string, page: Page) =>
  entityActivity(db, 'lot', lotId, page)

// FR-7.2: users who can edit the lot (full or progress access) may add a note.
export async function addLotNote(
  db: PrismaClient,
  user: SessionUser,
  lotId: string,
  message: string,
) {
  const text = message.trim()
  if (!text) throw new ValidationError({ message: 'Write a note first.' })
  return db.$transaction(async (tx) => {
    await lockLotForEdit(tx, user, lotId)
    const entry = await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'note',
      message: text,
    })
    return entryView(entry)
  })
}
