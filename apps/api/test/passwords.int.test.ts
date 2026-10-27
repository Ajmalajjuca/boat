import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createSession } from '../src/modules/auth/sessions'
import { csrfTokenFor } from '../src/modules/auth/tokens'
import { setBackupAdmin } from '../src/modules/users/users.service'
import { createTestDatabase } from './support/db'
import { makeUser, password, signIn, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db)
})
afterAll(() => close())

const newPassword = 'a brand new passphrase'
const login = (email: string, pw = password) =>
  request(app).post('/api/v1/auth/login').send({ email, password: pw })

describe('the backup admin', () => {
  it('FR-11.6 only the backup admin can sign in with a password', async () => {
    const planner = await makeUser(db, { role: 'planner', passwordLogin: false })
    const refused = await login(planner.email)
    expect(refused.status).toBe(401)
    expect(refused.body.message).toBe('Email or password is incorrect.')
    const { password: pw } = await setBackupAdmin(db, { email: 'Ops@Gmail.com', name: 'Ops' })
    expect(pw.length).toBeGreaterThanOrEqual(24)
    const res = await login('ops@gmail.com', pw)
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ role: 'admin', passwordLogin: true })
  })
  it('FR-11.6 keeps a single backup admin, and resets its password when run again', async () => {
    await expect(
      setBackupAdmin(db, { email: 'other@company.test', name: 'Other' }),
    ).rejects.toThrow('ops@gmail.com is already the backup admin.')
    const first = await setBackupAdmin(db, { email: 'ops@gmail.com', name: 'Ops' })
    const signedIn = await signIn(app, 'ops@gmail.com', first.password)
    const second = await setBackupAdmin(db, { email: 'ops@gmail.com', name: 'Ops' })
    expect(second.password).not.toBe(first.password)
    expect((await login('ops@gmail.com', first.password)).status).toBe(401)
    expect((await login('ops@gmail.com', second.password)).status).toBe(200)
    // A reset ends the old sessions.
    expect((await signedIn.agent.get('/api/v1/auth/me')).status).toBe(401)
  })
  it('refuses an email that belongs to a non-admin', async () => {
    const viewer = await makeUser(db, { role: 'viewer', passwordLogin: false })
    await db.user.updateMany({ where: { passwordLogin: true }, data: { passwordLogin: false } })
    await expect(setBackupAdmin(db, { email: viewer.email, name: 'V' })).rejects.toThrow(
      `${viewer.email} already belongs to a viewer user.`,
    )
  })
  it('promotes an existing admin to backup admin', async () => {
    await db.user.updateMany({ where: { passwordLogin: true }, data: { passwordLogin: false } })
    const admin = await makeUser(db, { role: 'admin', status: 'invited', passwordLogin: false })
    const { user, password: pw } = await setBackupAdmin(db, { email: admin.email, name: 'A' })
    expect(user.id).toBe(admin.id)
    expect(await db.user.findUniqueOrThrow({ where: { id: admin.id } })).toMatchObject({
      status: 'active',
      passwordLogin: true,
    })
    expect((await login(admin.email, pw)).status).toBe(200)
  })
})

describe('PATCH /auth/me/password', () => {
  it('needs the current password', async () => {
    const user = await makeUser(db)
    const { send } = await signIn(app, user.email)
    const res = await send('patch', '/api/v1/auth/me/password', {
      currentPassword: 'not my password',
      newPassword,
    })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ currentPassword: 'That is not your current password.' })
  })
  it('checks the new password', async () => {
    const user = await makeUser(db)
    const { send } = await signIn(app, user.email)
    for (const [next, message] of [
      ['short', 'Use at least 12 characters.'],
      [password, 'Choose a password different from your current one.'],
    ]) {
      const res = await send('patch', '/api/v1/auth/me/password', {
        currentPassword: password,
        newPassword: next,
      })
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual({ newPassword: message })
    }
  })
  it('ends every other session and moves this one to a new session', async () => {
    const user = await makeUser(db)
    const other = await signIn(app, user.email)
    const here = await signIn(app, user.email)
    const res = await here.send('patch', '/api/v1/auth/me/password', {
      currentPassword: password,
      newPassword,
    })
    expect(res.status).toBe(200)
    expect(res.body.csrfToken).not.toBe(here.csrf)
    expect((await other.agent.get('/api/v1/auth/me')).status).toBe(401)
    expect((await here.agent.get('/api/v1/auth/me')).status).toBe(200)
    // The old CSRF token belonged to the old session.
    const stale = await here.agent.post('/api/v1/auth/logout').set('x-csrf-token', here.csrf)
    expect(stale.status).toBe(403)
  })
  it('FR-11.6 is refused to people who sign in with Google', async () => {
    const user = await makeUser(db, { passwordLogin: false })
    const session = await createSession(db, user.id)
    const res = await request(app)
      .patch('/api/v1/auth/me/password')
      .set('Cookie', `boat_session=${session.token}`)
      .set('x-csrf-token', csrfTokenFor(session.id, 'test-session-secret-0123456789abcdef'))
      .send({ currentPassword: password, newPassword })
    expect(res.status).toBe(403)
  })
})

describe('removed routes', () => {
  it('no longer offers invite links or password resets', async () => {
    for (const url of ['/auth/invites/accept', '/auth/password/forgot', '/auth/password/reset'])
      expect((await request(app).post(`/api/v1${url}`).send({})).status).toBe(404)
  })
})
