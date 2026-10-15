import { ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import type { Db } from '../../core/prisma'
import type { PrismaClient } from '../../generated/prisma/client'

// Imports and resets take this transaction lock, so they run one at a time.
export const dataLock = 4_201_015
export const resetPhrase = 'RESET ALL DATA'

// Every business record people see: products, lots and their entries, shipments and their lines.
// Dropdown values, users, settings and history stay. Nothing is erased (FR-9.2).
export async function softDeleteBusinessRecords(db: Db, userId: string) {
  const change = { where: { deletedAt: null }, data: { deletedAt: new Date(), deletedBy: userId } }
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${dataLock})`
      return softDeleteBusinessRecords(tx, user.id)
    },
    { timeout: 60_000 },
  )
}
