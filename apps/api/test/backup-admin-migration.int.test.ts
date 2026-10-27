import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { makeUser } from './support/fixtures'

const migration = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations/20261027020000_backup_admin/migration.sql',
)

let db: PrismaClient
let close: () => Promise<void>

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
})
afterAll(() => close())

describe('the backup admin migration', () => {
  it('FR-11.6 keeps one password: the earliest active admin with one', async () => {
    // Rows as they stood before the migration: passwords for everyone who accepted an invite.
    const older = await makeUser(db, { role: 'admin', passwordLogin: false })
    const newer = await makeUser(db, { role: 'admin', passwordLogin: false })
    const planner = await makeUser(db, { role: 'planner', passwordLogin: false })
    const invited = await makeUser(db, { status: 'invited', password: null, passwordLogin: false })
    await db.user.update({ where: { id: older.id }, data: { createdAt: new Date('2026-01-01') } })
    await db.user.update({ where: { id: newer.id }, data: { createdAt: new Date('2026-02-01') } })
    const statements = readFileSync(migration, 'utf8')
      .split(';')
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean)
    for (const sql of statements) await db.$executeRawUnsafe(sql)
    const after = (id: string) => db.user.findUniqueOrThrow({ where: { id } })
    expect(await after(older.id)).toMatchObject({
      passwordLogin: true,
      passwordHash: older.passwordHash,
    })
    for (const u of [newer, planner, invited])
      expect(await after(u.id)).toMatchObject({ passwordLogin: false, passwordHash: null })
  })
})
