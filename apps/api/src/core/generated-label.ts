import type { Db } from './prisma'
import { ValidationError } from '@boat/domain/validation'

const references = {
  lot: { prefix: 'LOT', sequence: 'lot_label_seq', lock: 4_202_001 },
  batch: { prefix: 'RM', sequence: 'rm_batch_label_seq', lock: 4_202_002 },
  receipt: { prefix: 'GRN', sequence: 'grn_receipt_label_seq', lock: 4_202_003 },
} as const

// Called inside the record transaction after its data/lot lock. Import takes an exclusive
// data lock, so an imported reference cannot appear between the collision check and insert.
export async function generatedLabel(db: Db, kind: keyof typeof references, requested = '') {
  const { prefix, sequence, lock } = references[kind]
  // Custom labels and automatic allocation use the same lock, preventing a manual save or
  // rename from claiming a reference between the generator's check and insert.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${lock})`
  const exists = async (label: string) => {
    const where = { label: { equals: label, mode: 'insensitive' as const } }
    return kind === 'lot'
      ? db.lot.findFirst({ where, select: { id: true } })
      : kind === 'batch'
        ? db.rmBatch.findFirst({ where, select: { id: true } })
        : db.grnReceipt.findFirst({ where, select: { id: true } })
  }
  const custom = requested.trim()
  if (custom) {
    if (new RegExp(`^${prefix}-\\d+$`, 'i').test(custom) && (await exists(custom)))
      throw new ValidationError({
        label: 'This reference is already in use. Choose a different label.',
      })
    return custom
  }
  while (true) {
    const [next] = await db.$queryRaw<
      { value: string }[]
    >`SELECT nextval(${sequence}::regclass)::text AS value`
    const label = `${prefix}-${next.value.padStart(6, '0')}`
    // Backups may bring in references allocated by another installation. Skip those too,
    // including soft-deleted records, so automatic numbers are never deliberately reused.
    if (!(await exists(label))) return label
  }
}
