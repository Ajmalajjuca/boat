import { type Actor, recordActivity } from '../../core/audit'
import type { Db } from '../../core/prisma'

// Soft-deletes lots with their batches, receipts and component choices, and writes a "deleted"
// history entry for each lot (FR-1.2, DELETE /lots/:id). History itself is never deleted.
export async function softDeleteLots(db: Db, actor: Actor, lots: { id: string; label: string }[]) {
  if (!lots.length) return
  const ids = lots.map((l) => l.id)
  const stamp = { deletedAt: new Date(), deletedBy: actor.id }
  const children = { lotId: { in: ids }, deletedAt: null }
  await db.rmBatch.updateMany({ where: children, data: stamp })
  await db.grnReceipt.updateMany({ where: children, data: stamp })
  await db.lotComponent.updateMany({ where: children, data: stamp })
  await db.lot.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: stamp })
  for (const lot of lots)
    await recordActivity(db, actor, {
      entityType: 'lot',
      entityId: lot.id,
      kind: 'deleted',
      message: `Lot ${lot.label} deleted`,
    })
}
