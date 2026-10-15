import type { Express } from 'express'
import { pino } from 'pino'
import request from 'supertest'
import type { ApiDeps } from '../../src/api'
import { createApp } from '../../src/app'
import { testDeps } from '../../src/test-deps'
import type { Role } from '@boat/domain/models'
import type { PrismaClient } from '../../src/generated/prisma/client'
import { hashPassword } from '../../src/modules/auth/password'

export const password = 'correct horse battery staple'

let counter = 0
export const unique = (prefix: string) => `${prefix} ${++counter}-${Date.now().toString(36)}`

export const makePoc = (db: PrismaClient, value = unique('POC')) =>
  db.lookupValue.create({ data: { kind: 'poc', value } })

type UserFields = {
  role?: Role
  status?: 'invited' | 'active' | 'disabled'
  pocId?: string | null
  email?: string
  name?: string
  // null: no password yet, like a user who hasn't accepted their invite.
  password?: string | null
}
export async function makeUser(db: PrismaClient, fields: UserFields = {}) {
  const pw = fields.password === undefined ? password : fields.password
  return db.user.create({
    data: {
      email: fields.email ?? `${unique('user').replace(/\W/g, '')}@example.com`,
      name: fields.name ?? 'Test User',
      role: fields.role ?? 'planner',
      status: fields.status ?? 'active',
      pocId: fields.pocId ?? null,
      passwordHash: pw ? await hashPassword(pw) : null,
    },
  })
}

// The real app on a test database. Each call has its own rate-limit counters.
export function testApp(
  db: PrismaClient,
  { trustProxy, ...api }: Partial<ApiDeps> & { trustProxy?: number } = {},
) {
  return createApp({
    logger: pino({ level: 'silent' }),
    trustProxy,
    api: testDeps({ db, ...api }),
  })
}

// Signs in through the API. The agent keeps the session cookie; send() adds the CSRF token.
export async function signIn(app: Express, email: string, pw = password) {
  const agent = request.agent(app)
  const res = await agent.post('/api/v1/auth/login').send({ email, password: pw })
  if (res.status !== 200)
    throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`)
  const csrf: string = res.body.csrfToken
  const send = (method: 'post' | 'patch' | 'delete', url: string, body?: object) => {
    const req = agent[method](url).set('x-csrf-token', csrf)
    return body ? req.send(body) : req
  }
  return { agent, csrf, me: res.body, send }
}
