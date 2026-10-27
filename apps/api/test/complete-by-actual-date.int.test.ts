import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { day, makeLot } from './support/fixtures'

const migration = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations/20261027000000_complete_by_actual_date/migration.sql',
)

let db: PrismaClient
let close: () => Promise<void>

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
})
afterAll(() => close())

// The test database is already migrated, so the rows are put back in their pre-migration state
// (completion from full GRN) and the migration's statements run again over them.
async function runMigration() {
  const statements = readFileSync(migration, 'utf8')
    .split(';')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
  for (const sql of statements) await db.$executeRawUnsafe(sql)
}

describe('the completion migration', () => {
  it('FR-11.3 backfills the actual date of lots that finished through GRN', async () => {
    const grn = await makeLot(db, { completedOn: day('2026-09-30'), actualDate: null })
    const actual = await makeLot(db, { completedOn: null, actualDate: day('2026-10-01') })
    const open = await makeLot(db, { completedOn: null, actualDate: null })
    await runMigration()
    const after = async (id: string) => db.lot.findUniqueOrThrow({ where: { id } })
    expect(await after(grn.id)).toMatchObject({
      actualDate: day('2026-09-30'),
      completedOn: day('2026-09-30'),
    })
    expect((await after(actual.id)).completedOn).toEqual(day('2026-10-01'))
    expect((await after(open.id)).completedOn).toBeNull()
    const history = await db.activityLog.findMany({ where: { entityId: grn.id } })
    expect(history.map((h) => [h.kind, h.message, h.actorId])).toEqual([
      ['updated', 'Actual date set from the full GRN date', null],
    ])
    expect(await db.activityLog.count({ where: { entityId: actual.id } })).toBe(0)
  })
})
