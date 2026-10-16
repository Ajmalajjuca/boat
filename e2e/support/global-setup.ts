import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { acceptInvite, apiAs } from './api'
import {
  apiDir,
  appUrl,
  authFile,
  logFile,
  pocValue,
  port,
  repo,
  runDir,
  sessionSecret,
  users,
} from './env'
import { nextEmail, tokenIn } from './mail'

const built = [
  'apps/web/dist/index.html',
  'apps/api/dist/server.js',
  'apps/api/dist/create-admin.js',
]

const withUser = (url: string, name: string, pw: string) => {
  const u = new URL(url)
  u.username = name
  u.password = pw
  return u.toString()
}

async function waitForReady(server: ReturnType<typeof spawn>) {
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    if (server.exitCode !== null) break
    try {
      if ((await fetch(`${appUrl}/api/v1/health/ready`)).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`The API did not start. Its log:\n${readFileSync(logFile, 'utf8').slice(-4000)}`)
}

// Postgres in Docker, migrated with the app role's grants; the built API serving the built web
// app on one origin; then one user per role, created through the real invite flow.
export default async function globalSetup() {
  for (const file of built)
    if (!existsSync(path.join(repo, file)))
      throw new Error(`${file} is missing. Run pnpm build before the end-to-end tests.`)
  mkdirSync(runDir, { recursive: true })

  const container = await new PostgreSqlContainer('postgres:17').start()
  const ownerUrl = container.getConnectionUri()
  const owner = new Client({ connectionString: ownerUrl })
  await owner.connect()
  await owner.query("CREATE ROLE boat_app LOGIN PASSWORD 'boat_app'")
  await owner.end()
  for (const args of [
    ['migrate', 'deploy'],
    ['db', 'execute', '--file', 'prisma/grants.sql'],
  ])
    execFileSync('pnpm', ['exec', 'prisma', ...args], {
      cwd: apiDir,
      env: { ...process.env, DIRECT_URL: ownerUrl },
      stdio: 'pipe',
    })

  // No RESEND_API_KEY: emails go to the log, where the tests read their links.
  const { RESEND_API_KEY: _key, MAIL_FROM: _from, ...inherited } = process.env
  const env = {
    ...inherited,
    NODE_ENV: 'test',
    PORT: String(port),
    LOG_LEVEL: 'info',
    DATABASE_URL: withUser(ownerUrl, 'boat_app', 'boat_app'),
    SESSION_SECRET: sessionSecret,
    APP_URL: appUrl,
    TRUST_PROXY: '0',
  }
  const log = openSync(logFile, 'w')
  // The repository root has no .env, so nothing overrides this environment.
  const server = spawn(process.execPath, ['apps/api/dist/server.js'], {
    cwd: repo,
    env,
    stdio: ['ignore', log, log],
  })
  await waitForReady(server)

  const created = execFileSync(
    process.execPath,
    ['apps/api/dist/create-admin.js', '--email', users.admin.email, '--name', users.admin.name],
    { cwd: repo, env, encoding: 'utf8' },
  )
  const first = await acceptInvite(tokenIn(created))
  await first.ctx.storageState({ path: authFile('admin') })
  await first.ctx.dispose()

  const admin = await apiAs('admin')
  const poc = await admin.post('/lookups', { kind: 'poc', value: pocValue })
  for (const role of ['planner', 'poc', 'viewer'] as const) {
    const { email, name } = users[role]
    await admin.post('/users', { email, name, role, pocId: role === 'poc' ? poc.id : null })
    const invited = await acceptInvite(tokenIn((await nextEmail(email, 0)).text))
    await invited.ctx.storageState({ path: authFile(role) })
    await invited.ctx.dispose()
  }
  await admin.dispose()
  writeFileSync(path.join(runDir, 'seeded.json'), JSON.stringify({ pocId: poc.id }))

  return async () => {
    server.kill()
    await container.stop()
  }
}
