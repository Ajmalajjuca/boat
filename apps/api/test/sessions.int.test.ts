import cookieParser from 'cookie-parser'
import express from 'express'
import { pino } from 'pino'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import {
  createSession,
  loadSession,
  revokeSession,
  sessionCookie,
} from '../src/modules/auth/sessions'
import { csrfTokenFor, hashToken } from '../src/modules/auth/tokens'
import { createSettingsService } from '../src/modules/settings/settings.service'
import { createTestDatabase } from './support/db'
import { makePoc, makeUser } from './support/fixtures'

const secret = 'session-test-secret-0123456789abcdef'
let db: PrismaClient
let close: () => Promise<void>
const probe = express()

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  probe.use(cookieParser())
  probe.use((req, _res, next) => {
    req.log = pino({ level: 'silent' })
    next()
  })
  // ttl 0: settings are read on every request, so a test's settings change applies at once.
  probe.use(loadSession({ db, settings: createSettingsService(db, 0), sessionSecret: secret }))
  probe.get('/probe', (req, res) => {
    res.json(req.auth ?? null)
  })
})
afterAll(() => close())

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)
const probeWith = (token: string) =>
  request(probe).get('/probe').set('cookie', `${sessionCookie}=${token}`)

async function sessionFor(fields: Parameters<typeof makeUser>[1] = {}) {
  const user = await makeUser(db, fields)
  return { user, ...(await createSession(db, user.id)) }
}

describe('loadSession', () => {
  it('leaves a request without a cookie signed out', async () => {
    expect((await request(probe).get('/probe')).body).toBeNull()
  })
  it('ignores a token that matches no session', async () => {
    expect((await probeWith('not-a-real-token')).body).toBeNull()
  })
  it('signs in a live session with the user, role, POC and CSRF token', async () => {
    const poc = await makePoc(db)
    const { user, token, id } = await sessionFor({ role: 'poc', pocId: poc.id })
    expect((await probeWith(token)).body).toEqual({
      sessionId: id,
      csrfToken: csrfTokenFor(id, secret),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: 'poc',
        pocId: poc.id,
        poc: { id: poc.id, value: poc.value },
        passwordLogin: true,
      },
    })
  })
  it('stores only the SHA-256 of the cookie token', async () => {
    const { token, id } = await sessionFor()
    expect(id).toBe(hashToken(token))
    expect(await db.session.findUnique({ where: { id: token } })).toBeNull()
  })
  it('ends a session idle for longer than the timeout (15 minutes by default)', async () => {
    const { token, id } = await sessionFor()
    await db.session.update({ where: { id }, data: { lastSeenAt: minutesAgo(16) } })
    expect((await probeWith(token)).body).toBeNull()
  })
  it('keeps a session within the timeout and records the activity', async () => {
    const { token, id } = await sessionFor()
    await db.session.update({ where: { id }, data: { lastSeenAt: minutesAgo(14) } })
    expect((await probeWith(token)).body).not.toBeNull()
    const { lastSeenAt } = await db.session.findUniqueOrThrow({ where: { id } })
    expect(Date.now() - lastSeenAt.getTime()).toBeLessThan(5_000)
  })
  it('uses the idle timeout from settings', async () => {
    const { token, id } = await sessionFor()
    await db.session.update({ where: { id }, data: { lastSeenAt: minutesAgo(20) } })
    await db.appSetting.create({ data: { key: 'idleTimeoutMinutes', value: 30 } })
    try {
      expect((await probeWith(token)).body).not.toBeNull()
    } finally {
      // The app role cannot delete rows, so the test puts the default back.
      await db.appSetting.update({ where: { key: 'idleTimeoutMinutes' }, data: { value: 15 } })
    }
  })
  it('ends a session 12 hours after sign-in, however active', async () => {
    const { token, id } = await sessionFor()
    await db.session.update({ where: { id }, data: { expiresAt: minutesAgo(1) } })
    expect((await probeWith(token)).body).toBeNull()
  })
  it('ends a revoked session', async () => {
    const { token, id } = await sessionFor()
    await revokeSession(db, id)
    expect((await probeWith(token)).body).toBeNull()
  })
  it('signs out users who are disabled or deleted', async () => {
    const disabled = await sessionFor({ status: 'disabled' })
    expect((await probeWith(disabled.token)).body).toBeNull()
    const deleted = await sessionFor()
    await db.user.update({ where: { id: deleted.user.id }, data: { deletedAt: new Date() } })
    expect((await probeWith(deleted.token)).body).toBeNull()
  })
})
