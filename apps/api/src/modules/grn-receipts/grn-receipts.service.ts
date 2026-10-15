import type { GRNReceipt } from '@boat/domain/models'
import { assertValid, validateReceipt } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf, recordActivity } from '../../core/audit'
import type { RecordsDeps } from '../../core/clock'
import { fromDbDate, toDbDate } from '../../core/dates'
import { NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { lockLot, lockLotForEdit, refreshCompletion } from '../lots/lot-lock'
import { receiptView } from '../lots/lot-view'

export type ReceiptInput = { label: string; date: string; quantity: number; note: string }

// FR-4.2: units still to receive, from the lot's active receipts other than the one being edited.
// Called with the lot row locked, so no other receipt can land between this sum and the write.
async function available(db: Db, lot: { id: string; lotQty: number }, excluding?: string) {
  const { _sum } = await db.grnReceipt.aggregate({
    where: { lotId: lot.id, deletedAt: null, ...(excluding && { id: { not: excluding } }) },
    _sum: { quantity: true },
  })
  return lot.lotQty - (_sum.quantity ?? 0)
}

// FR-4.1 and FR-4.2 through the shared validateReceipt, with the company's today.
function checkReceipt(lotId: string, input: ReceiptInput, left: number, date: string): GRNReceipt {
  const receipt: GRNReceipt = {
    id: '',
    createdAt: '',
    updatedAt: '',
    lotId,
    label: input.label.trim(),
    date: input.date,
    quantity: input.quantity,
    note: input.note.trim(),
  }
  assertValid(validateReceipt(receipt, left, date))
  return receipt
}

async function lotOfReceipt(db: Db, id: string) {
  const receipt = await db.grnReceipt.findFirst({
    where: { id, deletedAt: null, lot: { is: { deletedAt: null } } },
    select: { lotId: true },
  })
  if (!receipt) throw new NotFoundError()
  return receipt.lotId
}

export async function createReceipt(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  lotId: string,
  input: ReceiptInput,
) {
  const date = await clock.today()
  const row = await db.$transaction(async (tx) => {
    const lot = await lockLotForEdit(tx, user, lotId)
    const r = checkReceipt(lotId, input, await available(tx, lot), date)
    const created = await tx.grnReceipt.create({
      data: {
        lotId,
        label: r.label,
        date: toDbDate(r.date)!,
        quantity: r.quantity,
        note: r.note,
        createdBy: user.id,
      },
    })
    await refreshCompletion(tx, lotId)
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'receipt',
      message: `Added receipt ${r.label}: ${r.quantity} units`,
    })
    return created
  })
  return receiptView(row)
}

export async function updateReceipt(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  id: string,
  patch: Partial<ReceiptInput>,
) {
  const date = await clock.today()
  const lotId = await lotOfReceipt(db, id)
  const row = await db.$transaction(async (tx) => {
    const lot = await lockLotForEdit(tx, user, lotId)
    const current = await tx.grnReceipt.findFirst({ where: { id, deletedAt: null } })
    if (!current) throw new NotFoundError()
    const input: ReceiptInput = {
      label: current.label,
      date: fromDbDate(current.date)!,
      quantity: current.quantity,
      note: current.note,
      ...patch,
    }
    const r = checkReceipt(lotId, input, await available(tx, lot, id), date)
    const updated = await tx.grnReceipt.update({
      where: { id },
      data: { label: r.label, date: toDbDate(r.date)!, quantity: r.quantity, note: r.note },
    })
    await refreshCompletion(tx, lotId)
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'receipt',
      message: `Updated receipt ${r.label}: ${current.quantity} → ${r.quantity} units`,
    })
    return updated
  })
  return receiptView(row)
}

export async function deleteReceipt({ db }: RecordsDeps, user: SessionUser, id: string) {
  const lotId = await lotOfReceipt(db, id)
  await db.$transaction(async (tx) => {
    await lockLot(tx, lotId)
    const current = await tx.grnReceipt.findFirst({ where: { id, deletedAt: null } })
    if (!current) throw new NotFoundError()
    await tx.grnReceipt.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: user.id },
    })
    await refreshCompletion(tx, lotId)
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'receipt',
      message: `Deleted receipt ${current.label} (${current.quantity} units)`,
    })
  })
}
