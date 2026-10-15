import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { makeUser, signIn, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let admin: Awaited<ReturnType<typeof signIn>>

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db)
  admin = await signIn(app, (await makeUser(db, { role: 'admin' })).email)
})
afterAll(() => close())

describe('GET /settings', () => {
  it('gives every signed-in role the defaults', async () => {
    const viewer = await signIn(app, (await makeUser(db, { role: 'viewer' })).email)
    const res = await viewer.agent.get('/api/v1/settings')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ timeZone: 'Asia/Kolkata', idleTimeoutMinutes: 15 })
  })
  it('answers 401 when signed out', async () => {
    expect((await request(app).get('/api/v1/settings')).status).toBe(401)
  })
})

describe('PATCH /settings', () => {
  it('accepts IANA zone names, including ones with several parts', async () => {
    for (const timeZone of ['America/New_York', 'America/Argentina/Buenos_Aires', 'UTC']) {
      const res = await admin.send('patch', '/api/v1/settings', { timeZone })
      expect(res.status).toBe(200)
    }
    await admin.send('patch', '/api/v1/settings', { timeZone: 'Asia/Kolkata' })
  })
  it('saves a change for admins, recording who made it', async () => {
    const res = await admin.send('patch', '/api/v1/settings', { timeZone: 'Asia/Dubai' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ timeZone: 'Asia/Dubai', idleTimeoutMinutes: 15 })
    const row = await db.appSetting.findUniqueOrThrow({ where: { key: 'timeZone' } })
    expect(row).toMatchObject({ value: 'Asia/Dubai', updatedBy: admin.me.user.id })
    // A new app instance has an empty cache, so this read comes from the database.
    const fresh = await signIn(testApp(db), admin.me.user.email)
    expect((await fresh.agent.get('/api/v1/settings')).body.timeZone).toBe('Asia/Dubai')
    await admin.send('patch', '/api/v1/settings', { timeZone: 'Asia/Kolkata' })
  })
  it('refuses planners and viewers', async () => {
    for (const role of ['planner', 'viewer'] as const) {
      const user = await signIn(app, (await makeUser(db, { role })).email)
      const res = await user.send('patch', '/api/v1/settings', { idleTimeoutMinutes: 30 })
      expect(res.status).toBe(403)
    }
  })
  it('needs the CSRF token', async () => {
    const res = await admin.agent.patch('/api/v1/settings').send({ idleTimeoutMinutes: 30 })
    expect(res.status).toBe(403)
  })
  it('answers bad values with field errors', async () => {
    const cases: [object, string][] = [
      [{ timeZone: 'Mars/Olympus' }, 'timeZone'],
      [{ timeZone: 42 }, 'timeZone'],
      [{ idleTimeoutMinutes: 4 }, 'idleTimeoutMinutes'],
      [{ idleTimeoutMinutes: 721 }, 'idleTimeoutMinutes'],
      [{ idleTimeoutMinutes: 7.5 }, 'idleTimeoutMinutes'],
      [{ idleTimeoutMinutes: '30' }, 'idleTimeoutMinutes'],
      [{ theme: 'dark' }, 'form'],
      [{ timeZone: '+05:30' }, 'timeZone'],
      [{ timeZone: 'IST' }, 'timeZone'],
      [{ timeZone: 'asia/kolkata' }, 'timeZone'],
    ]
    for (const [body, field] of cases) {
      const res = await admin.send('patch', '/api/v1/settings', body)
      expect(res.status).toBe(422)
      expect(Object.keys(res.body.fields)).toEqual([field])
    }
  })
  it('applies a new idle timeout to existing sessions at once', async () => {
    const user = await makeUser(db, { role: 'viewer' })
    const theirs = await signIn(app, user.email)
    await db.session.updateMany({
      where: { userId: user.id },
      data: { lastSeenAt: new Date(Date.now() - 6 * 60_000) },
    })
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(200)
    await admin.send('patch', '/api/v1/settings', { idleTimeoutMinutes: 5 })
    try {
      await db.session.updateMany({
        where: { userId: user.id },
        data: { lastSeenAt: new Date(Date.now() - 6 * 60_000) },
      })
      expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
    } finally {
      await admin.send('patch', '/api/v1/settings', { idleTimeoutMinutes: 15 })
    }
  })
})
