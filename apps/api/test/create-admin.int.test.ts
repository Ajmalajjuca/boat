import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { makeUser } from './support/fixtures'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let db: PrismaClient
let url: string
let close: () => Promise<void>
beforeAll(async () => {
  ;({ db, url, close } = await createTestDatabase())
})
afterAll(() => close())

describe('the create-admin command', () => {
  const env = () => ({
    ...process.env,
    // Skip the developer's apps/api/.env, which could hold a real Resend key.
    DOTENV_CONFIG_PATH: path.join(apiRoot, 'no-such.env'),
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: url,
    SESSION_SECRET: 'cli-test-secret-0123456789abcdef',
    APP_URL: 'http://localhost:5173',
  })
  const tsx = ['exec', 'tsx', 'src/cli/create-admin.ts']
  const run = (args: string[], dbUrl = url) =>
    spawnSync('pnpm', [...tsx, ...args], {
      cwd: apiRoot,
      env: { ...env(), DATABASE_URL: dbUrl },
      encoding: 'utf8',
    })

  it('prints usage and exits 2 without --email and --name', () => {
    const res = run([])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('Usage: create-admin --email <address> --name <name>')
  })
  it('FR-11.6 creates the backup admin and prints its password once', () => {
    const out = execFileSync('pnpm', [...tsx, '--email', 'First@Example.com', '--name', 'First'], {
      cwd: apiRoot,
      env: env(),
      encoding: 'utf8',
    })
    expect(out).toContain('Backup admin: first@example.com')
    expect(out).toMatch(/Password \(shown once\): [\w-]{24}/)
  })
  it('reports a refusal and exits 1', async () => {
    const viewer = await makeUser(db, { role: 'viewer', passwordLogin: false })
    const res = run(['--email', viewer.email, '--name', 'V'])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('first@example.com is already the backup admin.')
  })
})
