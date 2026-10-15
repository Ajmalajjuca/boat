import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { inject } from 'vitest'
import { createPrisma } from '../../src/core/prisma'
import { templateDb, withDatabase } from './urls'

// A fresh copy of the migrated template for one test file, connected as the app role boat_app,
// as in production. Table grants live in each database, so the copy has them too.
export async function createTestDatabase() {
  const postgresUrl = inject('postgresUrl')
  const name = `t_${randomUUID().replaceAll('-', '')}`
  const admin = new Client({ connectionString: postgresUrl })
  await admin.connect()
  try {
    // Copies from one template run one at a time, so parallel files never collide.
    await admin.query('SELECT pg_advisory_lock(42)')
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${templateDb}`)
    await admin.query('SELECT pg_advisory_unlock(42)')
  } finally {
    await admin.end()
  }
  const url = withDatabase(postgresUrl, name, { name: 'boat_app', password: 'boat_app' })
  const db = createPrisma(url)
  return { db, url, close: () => db.$disconnect() }
}
