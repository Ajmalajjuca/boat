import { Client } from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ConflictError } from '../src/core/errors'
import { failingMailer, memoryMailer } from '../src/core/mailer'
import type { PrismaClient } from '../src/generated/prisma/client'
import { hashToken } from '../src/modules/auth/tokens'
import { updateUser } from '../src/modules/users/users.service'
import { createTestDatabase } from './support/db'
import { makePoc, makeUser, password, signIn, testApp, unique } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let url: string
let mailer: ReturnType<typeof memoryMailer>
let app: ReturnType<typeof testApp>
let admin: Awaited<ReturnType<typeof signIn>>

beforeAll(async () => {
  ;({ db, url, close } = await createTestDatabase())
  mailer = memoryMailer()
  app = testApp(db, { mailer })
  const adminUser = await makeUser(db, { role: 'admin', name: 'First Admin' })
  admin = await signIn(app, adminUser.email)
})
afterAll(() => close())

const newEmail = () => `${unique('new').replace(/\W/g, '')}@example.com`
const tokenIn = (text: string) => /#token=([\w-]+)/.exec(text)?.[1]

describe('who may manage users', () => {
  it('answers 401 when signed out', async () => {
    expect((await request(app).get('/api/v1/users')).status).toBe(401)
  })
  it('refuses planners and viewers', async () => {
    for (const role of ['planner', 'viewer'] as const) {
      const user = await makeUser(db, { role })
      const { agent } = await signIn(app, user.email)
      const res = await agent.get('/api/v1/users')
      expect(res.status).toBe(403)
      expect(res.body.message).toMatch(/can't change Settings or profiles/)
    }
  })
})

describe('GET /users', () => {
  it('lists active, invited and disabled users, paged, without deleted ones', async () => {
    const disabled = await makeUser(db, { status: 'disabled', name: 'Aaron Disabled' })
    const deleted = await makeUser(db, { name: 'Aaron Deleted' })
    await db.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
    const res = await admin.agent.get('/api/v1/users?pageSize=200')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ page: 1, pageSize: 200 })
    const ids = res.body.items.map((u: { id: string }) => u.id)
    expect(ids).toContain(disabled.id)
    expect(ids).not.toContain(deleted.id)
    expect(res.body.total).toBe(res.body.items.length)
    expect(res.body.items[0]).not.toHaveProperty('passwordHash')
  })
})

describe('POST /users', () => {
  it('creates an invited user and emails a 72-hour invite link', async () => {
    const email = newEmail()
    const res = await admin.send('post', '/api/v1/users', {
      email: `  ${email.toUpperCase()} `,
      name: ' Asha Rao ',
      role: 'planner',
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      user: {
        id: expect.any(String),
        email,
        name: 'Asha Rao',
        role: 'planner',
        status: 'invited',
        poc: null,
        lastLoginAt: null,
        createdAt: expect.any(String),
      },
      inviteEmailSent: true,
    })
    const sent = mailer.sent.at(-1)!
    expect(sent.to).toBe(email)
    expect(sent.text).toContain('http://localhost:5173/invite#token=')
    const token = await db.authToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(tokenIn(sent.text)!) },
    })
    expect(token).toMatchObject({ userId: res.body.user.id, purpose: 'invite', usedAt: null })
    const hours = (token.expiresAt.getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(71.9)
    expect(hours).toBeLessThanOrEqual(72)
  })
  it('links a POC user to their point of contact, and nobody else', async () => {
    const poc = await makePoc(db)
    const asPoc = await admin.send('post', '/api/v1/users', {
      email: newEmail(),
      name: 'Factory Lead',
      role: 'poc',
      pocId: poc.id,
    })
    expect(asPoc.body.user.poc).toEqual({ id: poc.id, value: poc.value })
    const asPlanner = await admin.send('post', '/api/v1/users', {
      email: newEmail(),
      name: 'Planner',
      role: 'planner',
      pocId: poc.id,
    })
    expect(asPlanner.body.user.poc).toBeNull()
  })
  it('answers bad input with field errors', async () => {
    const segment = await db.lookupValue.create({ data: { kind: 'segment', value: unique('Seg') } })
    const cases: [object, Record<string, string>][] = [
      [
        { email: 'asha@example', name: 'A', role: 'planner' },
        { email: 'Enter a valid email address.' },
      ],
      [{ email: newEmail(), name: '', role: 'planner' }, { name: 'Enter a name.' }],
      [{ email: newEmail(), name: 'A', role: 'owner' }, { role: 'Choose a role.' }],
      [
        { email: newEmail(), name: 'A', role: 'poc' },
        { pocId: 'Choose the point of contact this user owns.' },
      ],
      [
        { email: newEmail(), name: 'A', role: 'poc', pocId: 'abc' },
        { pocId: 'Choose a point of contact from the list.' },
      ],
      [
        { email: newEmail(), name: 'A', role: 'poc', pocId: segment.id },
        { pocId: 'Choose a point of contact from the list.' },
      ],
    ]
    for (const [body, fields] of cases) {
      const res = await admin.send('post', '/api/v1/users', body)
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual(fields)
    }
  })
  it('refuses an email that another user already has, in any case', async () => {
    const existing = await makeUser(db)
    const res = await admin.send('post', '/api/v1/users', {
      email: existing.email.toUpperCase(),
      name: 'Twin',
      role: 'viewer',
    })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ email: 'A user with this email already exists.' })
  })
  it('still creates the user when the email fails, and says so', async () => {
    const quiet = await signIn(testApp(db, { mailer: failingMailer() }), admin.me.user.email)
    const res = await quiet.send('post', '/api/v1/users', {
      email: newEmail(),
      name: 'No Mail',
      role: 'viewer',
    })
    expect(res.status).toBe(201)
    expect(res.body.inviteEmailSent).toBe(false)
  })
})

describe('POST /users/:id/invite', () => {
  it('sends a new link and cancels the old one', async () => {
    const created = await admin.send('post', '/api/v1/users', {
      email: newEmail(),
      name: 'Slow Reader',
      role: 'viewer',
    })
    const first = tokenIn(mailer.sent.at(-1)!.text)!
    const res = await admin.send('post', `/api/v1/users/${created.body.user.id}/invite`)
    expect(res.status).toBe(200)
    expect(res.body.inviteEmailSent).toBe(true)
    const second = tokenIn(mailer.sent.at(-1)!.text)!
    expect(second).not.toBe(first)
    const old = await db.authToken.findUniqueOrThrow({ where: { tokenHash: hashToken(first) } })
    expect(old.usedAt).not.toBeNull()
  })
  it('refuses users who already set a password', async () => {
    const user = await makeUser(db)
    const res = await admin.send('post', `/api/v1/users/${user.id}/invite`)
    expect(res.status).toBe(409)
  })
})

describe('PATCH /users/:id', () => {
  it('renames a user', async () => {
    const user = await makeUser(db)
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { name: 'New Name' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('New Name')
  })
  it('signs a user out everywhere when their role changes', async () => {
    const user = await makeUser(db, { role: 'planner' })
    const theirs = await signIn(app, user.email)
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { role: 'viewer' })
    expect(res.body.role).toBe('viewer')
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
  })
  it('drops the POC link when a POC user gets another role', async () => {
    const poc = await makePoc(db)
    const user = await makeUser(db, { role: 'poc', pocId: poc.id })
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { role: 'planner' })
    expect(res.body.poc).toBeNull()
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).pocId).toBeNull()
  })
  it('disables a user, ending their sessions and sign-ins', async () => {
    const user = await makeUser(db)
    const theirs = await signIn(app, user.email)
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { status: 'disabled' })
    expect(res.body.status).toBe('disabled')
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
    const again = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password })
    expect(again.status).toBe(401)
  })
  it("won't activate a user who hasn't accepted their invite", async () => {
    const user = await makeUser(db, { status: 'invited', password: null, name: 'Pending' })
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { status: 'active' })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      status: "Pending hasn't accepted their invite yet. Resend the invite instead.",
    })
  })
  it('refuses fields it does not change, such as email', async () => {
    const user = await makeUser(db)
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { email: 'x@example.com' })
    expect(res.status).toBe(422)
  })
  it('answers 404 for an id that is not a UUID, or no user', async () => {
    for (const id of ['abc', '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90']) {
      const res = await admin.send('patch', `/api/v1/users/${id}`, { name: 'X' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'not_found' })
    }
  })
})

describe('concurrent edits', () => {
  // Another admin's role change is in flight and holds the row. A rename that read the row before
  // that commit would write the old role back over it.
  it("don't undo another admin's change made at the same moment", async () => {
    const user = await makeUser(db, { role: 'planner', name: 'Before' })
    const other = new Client({ connectionString: url })
    await other.connect()
    try {
      await other.query('BEGIN')
      await other.query("UPDATE users SET role = 'viewer' WHERE id = $1", [user.id])
      const rename = updateUser(db, user.id, { name: 'After' })
      await new Promise((r) => setTimeout(r, 300))
      await other.query('COMMIT')
      await rename
    } finally {
      await other.end()
    }
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row).toMatchObject({ name: 'After', role: 'viewer' })
  })
})

describe('DELETE /users/:id', () => {
  it('soft-deletes the user, ends their sessions and frees the email', async () => {
    const user = await makeUser(db)
    const theirs = await signIn(app, user.email)
    expect((await admin.send('delete', `/api/v1/users/${user.id}`)).status).toBe(204)
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.deletedAt).not.toBeNull()
    expect(row.deletedBy).toBe(admin.me.user.id)
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
    expect((await admin.send('patch', `/api/v1/users/${user.id}`, { name: 'X' })).status).toBe(404)
    const again = await admin.send('post', '/api/v1/users', {
      email: user.email,
      name: 'Returning',
      role: 'viewer',
    })
    expect(again.status).toBe(201)
  })
})

// Each test gets its own database, because these depend on how many admins exist.
describe('the last active admin', () => {
  let fresh: Awaited<ReturnType<typeof createTestDatabase>>
  afterEach(() => fresh.close())
  async function world() {
    fresh = await createTestDatabase()
    const freshApp = testApp(fresh.db)
    const only = await makeUser(fresh.db, { role: 'admin', name: 'Only Admin' })
    return { db: fresh.db, app: freshApp, only, session: await signIn(freshApp, only.email) }
  }

  it('cannot be demoted, disabled or deleted', async () => {
    const { only, session } = await world()
    for (const [method, body] of [
      ['patch', { role: 'planner' }],
      ['patch', { status: 'disabled' }],
      ['delete', undefined],
    ] as const) {
      const res = await session.send(method, `/api/v1/users/${only.id}`, body)
      expect(res.status).toBe(409)
      expect(res.body.message).toMatch(/Only Admin is the last active admin/)
    }
  })
  it('does not count invited or disabled admins as another admin', async () => {
    const { db: d, only, session } = await world()
    await makeUser(d, { role: 'admin', status: 'invited', password: null })
    await makeUser(d, { role: 'admin', status: 'disabled' })
    const res = await session.send('patch', `/api/v1/users/${only.id}`, { role: 'planner' })
    expect(res.status).toBe(409)
  })
  it('can step down once another admin is active', async () => {
    const { db: d, only, session } = await world()
    await makeUser(d, { role: 'admin' })
    const res = await session.send('patch', `/api/v1/users/${only.id}`, { role: 'planner' })
    expect(res.status).toBe(200)
  })
  it('survives two admins demoting each other at the same moment', async () => {
    const { db: d, only } = await world()
    const second = await makeUser(d, { role: 'admin' })
    const results = await Promise.allSettled([
      updateUser(d, only.id, { role: 'planner' }),
      updateUser(d, second.id, { role: 'planner' }),
    ])
    const refused = results.filter((r) => r.status === 'rejected')
    expect(refused).toHaveLength(1)
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError)
    expect(
      await d.user.count({ where: { role: 'admin', status: 'active', deletedAt: null } }),
    ).toBe(1)
  })
})
