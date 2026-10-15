import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { memoryMailer } from '../src/core/mailer'
import type { PrismaClient } from '../src/generated/prisma/client'
import { issueToken } from '../src/modules/auth/auth-tokens'
import { hashToken } from '../src/modules/auth/tokens'
import { createTestDatabase } from './support/db'
import { makeUser, password, signIn, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let mailer: ReturnType<typeof memoryMailer>
let app: ReturnType<typeof testApp>

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  mailer = memoryMailer()
  app = testApp(db, { mailer })
})
afterAll(() => close())

const newPassword = 'a brand new passphrase'
const tokenIn = (text: string) => /#token=([\w-]+)/.exec(text)![1]
const post = (url: string, body: object) => request(app).post(`/api/v1${url}`).send(body)
const accept = (token: string, pw = newPassword) =>
  post('/auth/invites/accept', { token, password: pw })
const expiredInvite =
  'This invite link has expired or was already used. Ask an admin to send a new one.'
const expiredReset = 'This reset link has expired or was already used. Request a new one.'

async function invited() {
  const user = await makeUser(db, { status: 'invited', password: null })
  return { user, token: await issueToken(db, user.id, 'invite') }
}

describe('POST /auth/invites/accept', () => {
  it('sets the password, activates the user and signs them in', async () => {
    const { user, token } = await invited()
    const agent = request.agent(app)
    const res = await agent
      .post('/api/v1/auth/invites/accept')
      .send({ token, password: newPassword })
    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe(user.id)
    expect(String(res.headers['set-cookie'])).toMatch(/^boat_session=/)
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200)
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('active')
    expect((await post('/auth/login', { email: user.email, password: newPassword })).status).toBe(
      200,
    )
  })
  it('keeps the link usable when the password is too short', async () => {
    const { token } = await invited()
    const res = await accept(token, 'short')
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ password: 'Use at least 12 characters.' })
    expect((await accept(token)).status).toBe(200)
  })
  it('works once', async () => {
    const { token } = await invited()
    expect((await accept(token)).status).toBe(200)
    const again = await accept(token)
    expect(again.status).toBe(422)
    expect(again.body.fields).toEqual({ token: expiredInvite })
  })
  it('lets only one of two simultaneous uses through', async () => {
    const { token } = await invited()
    const statuses = (await Promise.all([accept(token), accept(token)])).map((r) => r.status)
    expect(statuses.sort()).toEqual([200, 422])
  })
  it('refuses an expired link, a reset link, and a link for a deleted user', async () => {
    const expired = await invited()
    await db.authToken.update({
      where: { tokenHash: hashToken(expired.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const reset = await makeUser(db)
    const resetToken = await issueToken(db, reset.id, 'password_reset')
    const deleted = await invited()
    await db.user.update({ where: { id: deleted.user.id }, data: { deletedAt: new Date() } })
    for (const token of [expired.token, resetToken, deleted.token, 'made-up']) {
      const res = await accept(token)
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual({ token: expiredInvite })
    }
  })
})

describe('POST /auth/password/forgot', () => {
  const reply = {
    message: 'If that email belongs to an active account, a reset link is on its way.',
  }
  it('emails an active user a 1-hour reset link', async () => {
    const user = await makeUser(db)
    const before = mailer.sent.length
    const res = await post('/auth/password/forgot', { email: user.email.toUpperCase() })
    expect(res.status).toBe(202)
    expect(res.body).toEqual(reply)
    await vi.waitFor(() => expect(mailer.sent.length).toBe(before + 1))
    const sent = mailer.sent.at(-1)!
    expect(sent.to).toBe(user.email)
    expect(sent.text).toContain('http://localhost:5173/reset-password#token=')
    const token = await db.authToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(tokenIn(sent.text)) },
    })
    const minutes = (token.expiresAt.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(59)
    expect(minutes).toBeLessThanOrEqual(60)
  })
  it('gives the same answer, and sends nothing, for unknown, invited and disabled users', async () => {
    const invitedUser = await makeUser(db, { status: 'invited', password: null })
    const disabled = await makeUser(db, { status: 'disabled' })
    const before = mailer.sent.length
    for (const email of ['nobody@example.com', invitedUser.email, disabled.email]) {
      const res = await post('/auth/password/forgot', { email })
      expect(res.status).toBe(202)
      expect(res.body).toEqual(reply)
    }
    await new Promise((r) => setTimeout(r, 200))
    expect(mailer.sent.length).toBe(before)
  })
  it('stops after 5 requests from one address in 15 minutes', async () => {
    const limited = testApp(db, { mailer: memoryMailer() })
    const ask = () =>
      request(limited).post('/api/v1/auth/password/forgot').send({ email: 'x@example.com' })
    for (let i = 0; i < 5; i++) expect((await ask()).status).toBe(202)
    expect((await ask()).status).toBe(429)
  })
})

describe('POST /auth/password/reset', () => {
  it('sets the new password and signs the user out everywhere', async () => {
    const user = await makeUser(db)
    const theirs = await signIn(app, user.email)
    const token = await issueToken(db, user.id, 'password_reset')
    expect((await post('/auth/password/reset', { token, password: newPassword })).status).toBe(204)
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
    expect((await post('/auth/login', { email: user.email, password })).status).toBe(401)
    expect((await post('/auth/login', { email: user.email, password: newPassword })).status).toBe(
      200,
    )
  })
  it('works once and refuses expired links, invite links and disabled users', async () => {
    const user = await makeUser(db)
    const used = await issueToken(db, user.id, 'password_reset')
    await post('/auth/password/reset', { token: used, password: newPassword })
    const expiredUser = await makeUser(db)
    const expired = await issueToken(db, expiredUser.id, 'password_reset')
    await db.authToken.update({
      where: { tokenHash: hashToken(expired) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const { token: inviteToken } = await invited()
    const disabled = await makeUser(db)
    const disabledToken = await issueToken(db, disabled.id, 'password_reset')
    await db.user.update({ where: { id: disabled.id }, data: { status: 'disabled' } })
    for (const token of [used, expired, inviteToken, disabledToken]) {
      const res = await post('/auth/password/reset', { token, password: newPassword })
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual({ token: expiredReset })
    }
  })
  it('refuses a short password without using up the link', async () => {
    const user = await makeUser(db)
    const token = await issueToken(db, user.id, 'password_reset')
    const res = await post('/auth/password/reset', { token, password: 'short' })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ password: 'Use at least 12 characters.' })
    expect((await post('/auth/password/reset', { token, password: newPassword })).status).toBe(204)
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
})
