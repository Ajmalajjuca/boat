import type { Role } from '@boat/domain/models'
import express, { type RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import {
  accessOf,
  type AuthContext,
  publicRoute,
  requireLotAccess,
  requirePermission,
  requireSignedIn,
} from './access'
import { errorHandler } from './errors'

const signedInAs = (role: Role): AuthContext => ({
  user: { id: 'u1', email: 'a@example.com', name: 'A', role, pocId: null, poc: null },
  sessionId: 's1',
  csrfToken: 'csrf-1',
})

function appWith(auth: AuthContext | undefined, guard: RequestHandler) {
  const app = express()
  app.use((req, _res, next) => {
    req.auth = auth
    next()
  })
  app.all('/', guard, (_req, res) => {
    res.json({ ok: true })
  })
  app.use(errorHandler)
  return app
}

describe('requireSignedIn', () => {
  it('answers 401 without a session', async () => {
    const res = await request(appWith(undefined, requireSignedIn())).get('/')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'unauthenticated' })
  })
  it('lets any signed-in role read', async () => {
    expect((await request(appWith(signedInAs('viewer'), requireSignedIn())).get('/')).status).toBe(
      200,
    )
  })
  it('refuses a write without the matching CSRF token', async () => {
    const app = appWith(signedInAs('viewer'), requireSignedIn())
    for (const token of [undefined, 'csrf-2']) {
      const req = request(app).post('/')
      const res = await (token ? req.set('x-csrf-token', token) : req)
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('forbidden')
    }
  })
  it('accepts a write with the session CSRF token', async () => {
    const res = await request(appWith(signedInAs('viewer'), requireSignedIn()))
      .patch('/')
      .set('x-csrf-token', 'csrf-1')
    expect(res.status).toBe(200)
  })
})

describe('requirePermission', () => {
  it('answers 401 without a session', async () => {
    const res = await request(appWith(undefined, requirePermission('manageSettings'))).get('/')
    expect(res.status).toBe(401)
  })
  it("refuses roles that lack the action, saying what they can't do", async () => {
    const res = await request(
      appWith(signedInAs('planner'), requirePermission('manageSettings')),
    ).get('/')
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      error: 'forbidden',
      message: "Planner profiles can't change Settings or profiles. Ask an admin.",
    })
  })
  it('allows roles that have the action', async () => {
    const res = await request(
      appWith(signedInAs('admin'), requirePermission('manageSettings')),
    ).get('/')
    expect(res.status).toBe(200)
  })
  it('still checks the CSRF token on writes', async () => {
    const res = await request(
      appWith(signedInAs('admin'), requirePermission('manageSettings')),
    ).delete('/')
    expect(res.status).toBe(403)
  })
})

describe('publicRoute', () => {
  it('lets anyone through, writes included', async () => {
    expect((await request(appWith(undefined, publicRoute())).post('/')).status).toBe(200)
  })
})

describe('accessOf', () => {
  it('tags lot routes separately, so the permission table shows them', () => {
    expect(accessOf(requireLotAccess())).toBe('lotAccess')
  })
  it('reads the tag each guard carries', () => {
    expect(accessOf(publicRoute())).toBe('public')
    expect(accessOf(requireSignedIn())).toBe('signedIn')
    expect(accessOf(requirePermission('deleteLots'))).toBe('deleteLots')
    expect(accessOf(() => {})).toBeUndefined()
    expect(accessOf(undefined)).toBeUndefined()
  })
})

describe('requireLotAccess', () => {
  it('needs a session and the CSRF token, like requireSignedIn', async () => {
    expect((await request(appWith(undefined, requireLotAccess())).get('/')).status).toBe(401)
    expect((await request(appWith(signedInAs('poc'), requireLotAccess())).post('/')).status).toBe(
      403,
    )
    const res = await request(appWith(signedInAs('poc'), requireLotAccess()))
      .post('/')
      .set('x-csrf-token', 'csrf-1')
    expect(res.status).toBe(200)
  })
})
