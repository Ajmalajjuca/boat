import { ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { holdDataLockExclusive } from '../../core/data-lock'
import type { Db } from '../../core/prisma'
import type { PrismaClient } from '../../generated/prisma/client'

export const resetPhrase = 'RESET ALL DATA'

// Every business record people see: products, lots and their entries, shipments and their lines.
// Dropdown values, users, settings and history stay. Nothing is erased (FR-9.2), and each lot and
// shipment gets a history entry naming the user and the reason (FR-7.1).
export async function softDeleteBusinessRecords(db: Db, user: SessionUser, reason: string) {
  const active = { deletedAt: null }
  const [lots, shipments] = await Promise.all([
    db.lot.findMany({ where: active, select: { id: true, label: true } }),
    db.shipment.findMany({ where: active, select: { id: true, number: true } }),
  ])
  const actor = { kind: 'deleted', actorId: user.id, actorName: user.name }
  await db.activityLog.createMany({
    data: [
      ...lots.map((l) => ({
        ...actor,
        entityType: 'lot' as const,
        entityId: l.id,
        message: `Lot ${l.label} deleted by ${reason}`,
      })),
      ...shipments.map((s) => ({
        ...actor,
        entityType: 'shipment' as const,
        entityId: s.id,
        message: `Shipment ${s.number} deleted by ${reason}`,
      })),
    ],
  })
  const change = { where: active, data: { deletedAt: new Date(), deletedBy: user.id } }
  return {
    shipmentItems: (await db.shipmentItem.updateMany(change)).count,
    shipments: (await db.shipment.updateMany(change)).count,
    grnReceipts: (await db.grnReceipt.updateMany(change)).count,
    rmBatches: (await db.rmBatch.updateMany(change)).count,
    lotComponents: (await db.lotComponent.updateMany(change)).count,
    lots: (await db.lot.updateMany(change)).count,
    products: (await db.product.updateMany(change)).count,
  }
}

export async function resetData(db: PrismaClient, user: SessionUser, confirm: string) {
  if (confirm !== resetPhrase)
    throw new ValidationError({ confirm: `Type ${resetPhrase} to confirm.` })
  return db.$transaction(
    async (tx) => {
      await holdDataLockExclusive(tx)
      return softDeleteBusinessRecords(tx, user, 'a data reset')
    },
    { timeout: 60_000 },
  )
}
