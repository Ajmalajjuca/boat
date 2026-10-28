import { startOidcStub } from '@boat/oidc-stub'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createGoogleSignIn } from '../src/modules/auth/google'
import { createTestDatabase } from './support/db'
import { googleSignIn, makeUser, testApp } from './support/fixtures'

const appUrl = 'http://localhost:5173'
let db: PrismaClient
let close: () => Promise<void>
let stub: Awaited<ReturnType<typeof startOidcStub>>
let app: ReturnType<typeof testApp>

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  stub = await startOidcStub({ clientId: 'test-client', clientSecret: 'test-secret' })
  app = testApp(db, {
    appUrl,
    google: createGoogleSignIn({
      issuer: stub.issuer,
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: `${appUrl}/api/v1/auth/google/callback`,
      allowedDomains: ['company.test'],
    }),
  })
})
afterAll(async () => {
  await stub.close()
  await close()
})

describe('signing in with Google', () => {
  it('FR-11.5 signs in an added user on the allowed domain and activates them', async () => {
    const user = await makeUser(db, {
      email: 'jash@company.test',
      status: 'invited',
      password: null,
    })
    const agent = request.agent(app)
    const res = await googleSignIn(agent, 'Jash@Company.test')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${appUrl}/`)
    expect((await agent.get('/api/v1/auth/me')).body.user.email).toBe('jash@company.test')
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('active')
  })
  it.each([
    ['not_added', 'nobody@company.test', ''],
    ['domain', 'someone@gmail.com', ''],
    ['unverified', 'verify@company.test', '&email_verified=false'],
  ])('FR-11.5 refuses with %s', async (code, email, extra) => {
    if (code === 'unverified') await makeUser(db, { email })
    const agent = request.agent(app)
    const res = await googleSignIn(agent, email, extra)
    expect(res.headers.location).toBe(`${appUrl}/sign-in?error=${code}`)
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401)
  })
  it('FR-11.5 refuses a disabled user', async () => {
    await makeUser(db, { email: 'gone@company.test', status: 'disabled' })
    const res = await googleSignIn(request.agent(app), 'gone@company.test')
    expect(res.headers.location).toBe(`${appUrl}/sign-in?error=disabled`)
  })
  it('FR-11.5 refuses a personal address even when an admin added it', async () => {
    await makeUser(db, { email: 'personal@gmail.com' })
    const res = await googleSignIn(request.agent(app), 'personal@gmail.com')
    expect(res.headers.location).toBe(`${appUrl}/sign-in?error=domain`)
  })
  it('FR-11.5 refuses a callback whose state does not match', async () => {
    await makeUser(db, { email: 'forged@company.test' })
    const agent = request.agent(app)
    const res = await googleSignIn(agent, 'forged@company.test', '', 'forged-state')
    expect(res.headers.location).toBe(`${appUrl}/sign-in?error=failed`)
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401)
  })
  it('refuses a callback without the state cookie', async () => {
    const res = await request(app).get('/api/v1/auth/google/callback?code=x&state=y')
    expect(res.headers.location).toBe(`${appUrl}/sign-in?error=failed`)
  })
  it('reports whether Google sign-in is configured, and for which domains', async () => {
    expect((await request(app).get('/api/v1/auth/options')).body).toEqual({
      google: true,
      domains: ['company.test'],
    })
    const plain = testApp(db)
    expect((await request(plain).get('/api/v1/auth/options')).body).toEqual({
      google: false,
      domains: [],
    })
    expect((await request(plain).get('/api/v1/auth/google/start')).status).toBe(404)
  })
})
