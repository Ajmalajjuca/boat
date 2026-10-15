import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import type { TestProject } from 'vitest/node'
import { templateDb, withDatabase } from './urls'

declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string
  }
}

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// One Postgres for the whole run, migrated once into a template database that each test file
// copies (db.ts). database.int.test.ts still starts its own container, because it tests the
// migrations themselves.
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17').start()
  const url = container.getConnectionUri()
  const admin = new Client({ connectionString: url })
  await admin.connect()
  await admin.query("CREATE ROLE boat_app LOGIN PASSWORD 'boat_app'")
  await admin.query(`CREATE DATABASE ${templateDb}`)
  await admin.end()
  const env = { ...process.env, DIRECT_URL: withDatabase(url, templateDb) }
  for (const args of [
    ['migrate', 'deploy'],
    ['db', 'execute', '--file', 'prisma/grants.sql'],
  ])
    execFileSync('pnpm', ['exec', 'prisma', ...args], { cwd: apiRoot, env, stdio: 'pipe' })
  project.provide('postgresUrl', url)
  return async () => {
    await container.stop()
  }
}
