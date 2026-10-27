import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConflictError } from '../src/core/errors'
import { memoryMailer } from '../src/core/mailer'
import type { PrismaClient } from '../src/generated/prisma/client'
import { hashToken } from '../src/modules/auth/tokens'
import { inviteFirstAdmin } from '../src/modules/users/users.service'
import { createTestDatabase } from './support/db'
import { makeUser } from './support/fixtures'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const log = pino({ level: 'silent' })
let db: PrismaClient
let url: string
let close: () => Promise<void>
beforeAll(async () => {
  ;({ db, url, close } = await createTestDatabase())
})
afterAll(() => close())

const deps = () => ({
  db,
  mailer: memoryMailer(),
  appUrl: 'https://boat.example.com',
  allowedDomains: [],
})
const tokenIn = (link: string) => /#token=([\w-]+)/.exec(link)![1]

// These run in order on one database: no admin, a pending admin, then an active one.
describe('inviteFirstAdmin', () => {
  it('invites the first admin and returns the link', async () => {
    const mailer = memoryMailer()
    const result = await inviteFirstAdmin(
      { ...deps(), mailer },
      { email: 'Owner@Example.com', name: 'Owner' },
      log,
    )
    expect(result.user).toMatchObject({
      email: 'owner@example.com',
      role: 'admin',
      status: 'invited',
    })
    expect(result.inviteUrl).toMatch(/^https:\/\/boat\.example\.com\/invite#token=/)
    expect(result.inviteEmailSent).toBe(true)
    expect(mailer.sent[0].text).toContain(result.inviteUrl)
  })
  it('sends a fresh link when run again for the pending admin', async () => {
    const first = await db.authToken.findFirstOrThrow({ where: { usedAt: null } })
    const again = await inviteFirstAdmin(deps(), { email: 'owner@example.com', name: 'Owner' }, log)
    expect(hashToken(tokenIn(again.inviteUrl))).not.toBe(first.tokenHash)
    expect(
      (await db.authToken.findUniqueOrThrow({ where: { id: first.id } })).usedAt,
    ).not.toBeNull()
  })
  it('refuses an email that belongs to a non-admin', async () => {
    const planner = await makeUser(db, { role: 'planner' })
    await expect(
      inviteFirstAdmin(deps(), { email: planner.email, name: 'X' }, log),
    ).rejects.toBeInstanceOf(ConflictError)
  })
  it('refuses once an active admin exists', async () => {
    await makeUser(db, { role: 'admin' })
    await expect(
      inviteFirstAdmin(deps(), { email: 'someone@example.com', name: 'X' }, log),
    ).rejects.toThrow(/An active admin already exists/)
  })
})

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

  it('prints usage and exits 2 without --email and --name', () => {
    const run = spawnSync('pnpm', tsx, { cwd: apiRoot, env: env(), encoding: 'utf8' })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('Usage: create-admin --email <address> --name <name>')
  })
  it('reports a refusal and exits 1', () => {
    // An active admin exists from the tests above.
    const run = spawnSync('pnpm', [...tsx, '--email', 'late@example.com', '--name', 'Late'], {
      cwd: apiRoot,
      env: env(),
      encoding: 'utf8',
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('An active admin already exists')
  })
  it('prints the invite link on a fresh database', async () => {
    const fresh = await createTestDatabase()
    try {
      const out = execFileSync(
        'pnpm',
        [...tsx, '--email', 'first@example.com', '--name', 'First Admin'],
        { cwd: apiRoot, env: { ...env(), DATABASE_URL: fresh.url }, encoding: 'utf8' },
      )
      expect(out).toContain('Invited first@example.com as admin.')
      expect(out).toMatch(/http:\/\/localhost:5173\/invite#token=[\w-]{43}/)
    } finally {
      await fresh.close()
    }
  })
})
