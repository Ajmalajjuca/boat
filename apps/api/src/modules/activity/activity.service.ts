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

export async function lotActivity(db: PrismaClient, lotId: string, page: Page) {
  const lot = await db.lot.findFirst({
    where: { id: lotId, deletedAt: null },
    select: { id: true },
  })
  if (!lot) throw new NotFoundError()
  const where = { entityType: 'lot' as const, entityId: lotId }
  const [items, total] = await Promise.all([
    db.activityLog.findMany({
      where,
      select: entrySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(page),
    }),
    db.activityLog.count({ where }),
  ])
  return pageOf(items, total, page)
}

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
    return {
      id: entry.id,
      kind: entry.kind,
      message: entry.message,
      changes: entry.changes,
      actorId: entry.actorId,
      actorName: entry.actorName,
      createdAt: entry.createdAt,
    }
  })
}
