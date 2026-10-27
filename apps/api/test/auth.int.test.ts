import { Writable } from 'node:stream'
import type { Role } from '@boat/domain/models'
import { pino } from 'pino'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createApp } from '../src/app'
import { hashToken } from '../src/modules/auth/tokens'
import { testDeps } from '../src/test-deps'
import { createTestDatabase } from './support/db'
import { makePoc, makeUser, password, signIn, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
})
afterAll(() => close())

const login = (app: ReturnType<typeof testApp>, email: string, pw = password) =>
  request(app).post('/api/v1/auth/login').send({ email, password: pw })
const incorrect = { error: 'unauthenticated', message: 'Email or password is incorrect.' }

// The Phase 2 gate. Expected actions are written out, not derived from the domain.
describe('each role signs in and sees its allowed actions', () => {
  const expected: Record<Role, string[]> = {
    admin: [
      'manageSettings',
      'manageData',
      'exportBackup',
      'editProducts',
      'deleteProducts',
      'createLots',
      'deleteLots',
      'editShipments',
      'deleteShipments',
      'deleteEntries',
    ],
    planner: ['exportBackup', 'editProducts', 'createLots', 'editShipments', 'deleteEntries'],
    poc: [],
    viewer: [],
  }
  for (const role of Object.keys(expected) as Role[]) {
    it(role, async () => {
      const app = testApp(db)
      const poc = role === 'poc' ? await makePoc(db) : null
      const user = await makeUser(db, { role, pocId: poc?.id ?? null })
      const { agent } = await signIn(app, user.email)
      const res = await agent.get('/api/v1/auth/me')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role,
          pocId: poc?.id ?? null,
          poc: poc ? { id: poc.id, value: poc.value } : null,
          passwordLogin: true,
        },
        allowedActions: expected[role],
        csrfToken: expect.any(String),
        idleTimeoutMinutes: 15,
        features: { grn: false },
      })
    })
  }
})

describe('POST /auth/login', () => {
  it('sets an httpOnly, SameSite=Lax cookie whose hash is the session id', async () => {
    const user = await makeUser(db)
    const res = await login(testApp(db), user.email)
    expect(res.status).toBe(200)
    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toMatch(/^boat_session=[\w-]{43};/)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).not.toMatch(/Secure/)
    const token = /^boat_session=([\w-]+)/.exec(cookie)![1]
    const session = await db.session.findUniqueOrThrow({ where: { id: hashToken(token) } })
    expect(session.userId).toBe(user.id)
  })
  it('marks the cookie Secure when the app runs behind HTTPS', async () => {
    const user = await makeUser(db)
    const res = await login(testApp(db, { secureCookies: true }), user.email)
    expect(String(res.headers['set-cookie'])).toMatch(/Secure/)
  })
  it('ignores the case and spaces of the email address', async () => {
    const user = await makeUser(db)
    expect((await login(testApp(db), `  ${user.email.toUpperCase()} `)).status).toBe(200)
  })
  it('records the sign-in time', async () => {
    const user = await makeUser(db)
    await login(testApp(db), user.email)
    const { lastLoginAt } = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(Date.now() - lastLoginAt!.getTime()).toBeLessThan(5_000)
  })
  it('gives one answer for every kind of failure', async () => {
    const app = testApp(db)
    const active = await makeUser(db)
    const invited = await makeUser(db, { status: 'invited', password: null })
    const disabled = await makeUser(db, { status: 'disabled' })
    const deleted = await makeUser(db)
    await db.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
    for (const [email, pw] of [
      [active.email, 'wrong password!!'],
      ['nobody@example.com', password],
      [invited.email, password],
      [disabled.email, password],
      [deleted.email, password],
    ]) {
      const res = await login(app, email, pw)
      expect(res.status).toBe(401)
      expect(res.body).toEqual(incorrect)
    }
  })
  it('answers a request without an email or password with field errors', async () => {
    const res = await request(testApp(db)).post('/api/v1/auth/login').send({})
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    })
  })
})

describe('sign-in rate limits', () => {
  it('locks an account after 5 failures, even for the right password', async () => {
    const app = testApp(db)
    const user = await makeUser(db)
    for (let i = 0; i < 5; i++)
      expect((await login(app, user.email, 'wrong password!!')).status).toBe(401)
    const res = await login(app, user.email)
    expect(res.status).toBe(429)
    expect(res.body).toEqual({
      error: 'rate_limited',
      message: 'Too many failed attempts. Wait 15 minutes and try again.',
    })
  })
  it('limits each client IP behind the proxy separately', async () => {
    const app = testApp(db, { trustProxy: 1 })
    const from = (ip: string, email: string) =>
      request(app)
        .post('/api/v1/auth/login')
        .set('x-forwarded-for', ip)
        .send({ email, password: 'wrong password!!' })
    for (let i = 0; i < 5; i++)
      expect((await from('203.0.113.7', `n${i}@example.com`)).status).toBe(401)
    expect((await from('203.0.113.7', 'other@example.com')).status).toBe(429)
    expect((await from('203.0.113.8', 'other@example.com')).status).toBe(401)
  })
  it('does not count successful sign-ins', async () => {
    const app = testApp(db)
    const user = await makeUser(db)
    for (let i = 0; i < 8; i++) expect((await login(app, user.email)).status).toBe(200)
  })
})

describe('request logs', () => {
  // PRD observability: request and user IDs on every log line, including pino-http's own
  // "request completed" line, which is the only record of who called PATCH /users/:id.
  it("put the signed-in user's id on the request line", async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(chunk.toString())
        done()
      },
    })
    const app = createApp({ logger: pino({ level: 'info' }, stream), api: testDeps({ db }) })
    const user = await makeUser(db)
    const { agent } = await signIn(app, user.email)
    await agent.get('/api/v1/auth/me')
    const completed = lines
      .map((l) => JSON.parse(l))
      .find((l) => l.msg === 'request completed' && l.req?.url === '/api/v1/auth/me')
    expect(completed?.userId).toBe(user.id)
  })
})

describe('GET /auth/me', () => {
  it('answers 401 without a session', async () => {
    const res = await request(testApp(db)).get('/api/v1/auth/me')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'unauthenticated' })
  })
})

describe('POST /auth/logout', () => {
  it('needs the CSRF token', async () => {
    const user = await makeUser(db)
    const { agent } = await signIn(testApp(db), user.email)
    expect((await agent.post('/api/v1/auth/logout')).status).toBe(403)
  })
  it("refuses another session's CSRF token", async () => {
    const app = testApp(db)
    const user = await makeUser(db)
    const first = await signIn(app, user.email)
    const second = await signIn(app, user.email)
    const res = await first.agent.post('/api/v1/auth/logout').set('x-csrf-token', second.csrf)
    expect(res.status).toBe(403)
  })
  it('ends the session and clears the cookie', async () => {
    const app = testApp(db)
    const user = await makeUser(db)
    const { agent, send } = await signIn(app, user.email)
    const res = await send('post', '/api/v1/auth/logout')
    expect(res.status).toBe(204)
    expect(String(res.headers['set-cookie'])).toMatch(/boat_session=;/)
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401)
    const sessions = await db.session.findMany({ where: { userId: user.id } })
    expect(sessions.every((s) => s.revokedAt)).toBe(true)
  })
})
