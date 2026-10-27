import { deniedMessage, PermissionError } from '@boat/domain/permissions'
import type { SessionUser } from '../../core/access'
import { NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { holdDataLockShared } from '../../core/data-lock'
import { lotAccess, lotInclude, type LotRow } from './lot-view'

// Every change to a lot or its entries starts by locking the lot row. Concurrent changes to one
// lot then run one after another, so checks such as "total GRN ≤ lot quantity" see every
// committed receipt (PRD: over-receipt guard).
export async function lockLot(db: Db, id: string) {
  await holdDataLockShared(db)
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM lots WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`
  if (!rows.length) throw new NotFoundError()
  return db.lot.findUniqueOrThrow({ where: { id }, include: lotInclude })
}

// The browser's wording: "POC profiles can't edit lots owned by Rohit Mehta. Ask an admin."
export const lotDenial = (user: SessionUser, lot: LotRow) =>
  new PermissionError(
    deniedMessage(
      user.role,
      lot.poc ? `edit lots owned by ${lot.poc.value}` : 'edit lots without a POC',
    ),
  )

// lockLot plus the per-lot check: admins and planners have full access, a POC has progress
// access to lots assigned to their point of contact, everyone else none.
export async function lockLotForEdit(db: Db, user: SessionUser, id: string) {
  const lot = await lockLot(db, id)
  if (lotAccess(user, lot) === 'none') throw lotDenial(user, lot)
  return lot
}

// Keeps grn_total in step with the lot's active receipts and completed_on with its actual date:
// a lot is complete once its actual date is set (FR-11.3), whatever GRN says. Call it after a
// change to the lot or its receipts, inside the same transaction.
export async function refreshCompletion(db: Db, lotId: string) {
  await db.$executeRaw`
    UPDATE lots l
    SET grn_total = s.total,
        completed_on = l.actual_date
    FROM (
      SELECT COALESCE(SUM(quantity), 0)::int AS total
      FROM grn_receipts
      WHERE lot_id = ${lotId}::uuid AND deleted_at IS NULL
    ) s
    WHERE l.id = ${lotId}::uuid`
}
