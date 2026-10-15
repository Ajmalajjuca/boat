import type { RMBatch } from '@boat/domain/models'
import { assertValid, validateBatch, ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf, recordActivity } from '../../core/audit'
import type { RecordsDeps } from '../../core/clock'
import { fromDbDate, toDbDate } from '../../core/dates'
import { NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { renameFields } from '../lookups/resolve'
import { lockLot, lockLotForEdit } from '../lots/lot-lock'
import { batchInclude, batchView, type LotRow } from '../lots/lot-view'

export type BatchInput = {
  componentId: string
  label: string
  plannedQty: number
  plannedDate: string | null
  receivedQty: number
  receivedDate: string | null
  status: string
  notes: string
}

// FR-3.1 to FR-3.3: batches belong to lots tracked by component, and only to a component
// selected on the lot. validateBatch refuses received dates after the company's today.
function checkBatch(lot: LotRow, input: BatchInput, date: string): RMBatch {
  if (lot.rmMode !== 'components')
    throw new ValidationError({
      form: 'Switch the lot to Track by Component before adding batches.',
    })
  const component = lot.components.find((c) => c.component.id === input.componentId)?.component
  const batch: RMBatch = {
    id: '',
    createdAt: '',
    updatedAt: '',
    lotId: lot.id,
    component: component?.value ?? '',
    label: input.label.trim(),
    plannedQty: input.plannedQty,
    plannedDate: input.plannedDate ?? '',
    receivedQty: input.receivedQty,
    receivedDate: input.receivedDate ?? '',
    status: input.status.trim(),
    notes: input.notes.trim(),
  }
  assertValid({
    ...renameFields(validateBatch(batch, date), { component: 'componentId' }),
    ...(!component && { componentId: 'Select this component on the lot first.' }),
  })
  return batch
}

const batchData = (input: BatchInput, b: RMBatch) => ({
  componentId: input.componentId,
  label: b.label,
  plannedQty: b.plannedQty,
  plannedDate: toDbDate(input.plannedDate),
  receivedQty: b.receivedQty,
  receivedDate: toDbDate(input.receivedDate),
  status: b.status,
  notes: b.notes,
})

// The demo's history wording.
const material = (verb: string, b: RMBatch) =>
  `${verb} ${b.component} batch ${b.label} (${b.receivedQty} received)`

// The lot of an active batch on an active lot.
async function lotOfBatch(db: Db, id: string) {
  const batch = await db.rmBatch.findFirst({
    where: { id, deletedAt: null, lot: { is: { deletedAt: null } } },
    select: { lotId: true },
  })
  if (!batch) throw new NotFoundError()
  return batch.lotId
}

export async function createBatch(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  lotId: string,
  input: BatchInput,
) {
  const date = await clock.today()
  const row = await db.$transaction(async (tx) => {
    const lot = await lockLotForEdit(tx, user, lotId)
    const b = checkBatch(lot, input, date)
    const created = await tx.rmBatch.create({
      data: { lotId, ...batchData(input, b) },
      include: batchInclude,
    })
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'material',
      message: material('Added', b),
    })
    return created
  })
  return batchView(row)
}

export async function updateBatch(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  id: string,
  patch: Partial<BatchInput>,
) {
  const date = await clock.today()
  const lotId = await lotOfBatch(db, id)
  const row = await db.$transaction(async (tx) => {
    const lot = await lockLotForEdit(tx, user, lotId)
    const current = await tx.rmBatch.findFirst({ where: { id, deletedAt: null } })
    if (!current) throw new NotFoundError()
    const input: BatchInput = {
      componentId: current.componentId,
      label: current.label,
      plannedQty: current.plannedQty,
      plannedDate: fromDbDate(current.plannedDate),
      receivedQty: current.receivedQty,
      receivedDate: fromDbDate(current.receivedDate),
      status: current.status,
      notes: current.notes,
      ...patch,
    }
    const b = checkBatch(lot, input, date)
    const updated = await tx.rmBatch.update({
      where: { id },
      data: batchData(input, b),
      include: batchInclude,
    })
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'material',
      message: material('Updated', b),
    })
    return updated
  })
  return batchView(row)
}

export async function deleteBatch({ db }: RecordsDeps, user: SessionUser, id: string) {
  const lotId = await lotOfBatch(db, id)
  await db.$transaction(async (tx) => {
    await lockLot(tx, lotId)
    const current = await tx.rmBatch.findFirst({
      where: { id, deletedAt: null },
      include: batchInclude,
    })
    if (!current) throw new NotFoundError()
    await tx.rmBatch.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id } })
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'material',
      message: `Deleted ${current.component.value} batch ${current.label}`,
    })
  })
}
