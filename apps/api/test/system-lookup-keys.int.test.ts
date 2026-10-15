import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'

const migration = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../prisma/migrations/20261015130000_system_lookup_keys/migration.sql',
  ),
  'utf8',
)

let db: PrismaClient
let close: () => Promise<void>
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
})
afterAll(() => close())

describe('the system_lookup_keys migration', () => {
  it('gives a pre-existing same-text value its system key', async () => {
    // As if "Delayed" had been there before system_lookups ran, so that migration skipped it.
    await db.lookupValue.updateMany({ where: { systemKey: 'delayed' }, data: { systemKey: null } })
    await db.$executeRawUnsafe(migration)
    const delayed = await db.lookupValue.findFirstOrThrow({
      where: { kind: 'status', value: 'Delayed' },
    })
    expect(delayed.systemKey).toBe('delayed')
  })
  it('changes nothing when every system value already has its key', async () => {
    const before = await db.lookupValue.findMany({ orderBy: { id: 'asc' } })
    await db.$executeRawUnsafe(migration)
    expect(await db.lookupValue.findMany({ orderBy: { id: 'asc' } })).toEqual(before)
  })
})
