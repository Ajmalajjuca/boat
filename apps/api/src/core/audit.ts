import type { Prisma } from '../generated/prisma/client'
import type { SessionUser } from './access'
import type { Db } from './prisma'

export type Actor = { id: string; name: string }
export const actorOf = (user: SessionUser): Actor => ({ id: user.id, name: user.name })

export type ActivityEntry = {
  entityType: 'lot' | 'shipment'
  entityId: string
  kind: string
  message: string
  changes?: Prisma.InputJsonObject
}

// FR-7.1: every change writes a history entry naming the user. Call it inside the transaction
// that makes the change, so a change that rolls back leaves no entry. The app's database role
// can insert into activity_logs but never update or delete it. The name is a snapshot, so it
// survives a later rename or deletion of the user.
export const recordActivity = (db: Db, actor: Actor, entry: ActivityEntry) =>
  db.activityLog.create({ data: { ...entry, actorId: actor.id, actorName: actor.name } })
