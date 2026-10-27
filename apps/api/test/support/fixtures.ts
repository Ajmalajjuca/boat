import type { Express } from 'express'
import { pino } from 'pino'
import request from 'supertest'
import type { ApiDeps } from '../../src/api'
import { createApp } from '../../src/app'
import { testDeps } from '../../src/test-deps'
import type { Role } from '@boat/domain/models'
import type { LookupKind, Prisma, PrismaClient } from '../../src/generated/prisma/client'
import { hashPassword } from '../../src/modules/auth/password'

export const password = 'correct horse battery staple'

// Signs in through the Google flow against @boat/oidc-stub: start, choose the identity at the
// stub, then follow its redirect back to the callback with the agent's cookies. extra adds stub
// parameters (e.g. '&email_verified=false'); forgedState replaces the state sent back.
export async function googleSignIn(
  agent: ReturnType<typeof request.agent>,
  email: string,
  extra = '',
  forgedState?: string,
) {
  const start = await agent.get('/api/v1/auth/google/start')
  if (start.status !== 302) throw new Error(`google start failed: ${start.status}`)
  const chosen = await fetch(
    `${start.headers.location}&email=${encodeURIComponent(email)}${extra}`,
    { redirect: 'manual' },
  )
  const back = new URL(chosen.headers.get('location')!)
  if (forgedState) back.searchParams.set('state', forgedState)
  return agent.get(`${back.pathname}${back.search}`)
}

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

export const makeLookup = (db: PrismaClient, kind: LookupKind, value = unique(kind)) =>
  db.lookupValue.create({ data: { kind, value } })

// One of the six values the system_lookups migration creates.
export const systemLookup = (db: PrismaClient, systemKey: string) =>
  db.lookupValue.findFirstOrThrow({ where: { systemKey, deletedAt: null } })

// A business date as Prisma stores it: UTC midnight.
export const day = (s: string) => new Date(`${s}T00:00:00Z`)

// The tests' "now". 06:30 UTC is midday in India, so the company date is the same everywhere.
export const testToday = '2026-10-15'
export const fixedNow = () => new Date(`${testToday}T06:30:00Z`)

export async function makeProduct(
  db: PrismaClient,
  fields: { name?: string; variant?: string; segmentId?: string } = {},
) {
  return db.product.create({
    data: {
      name: fields.name ?? unique('Product'),
      variant: fields.variant ?? '',
      segmentId: fields.segmentId ?? (await makeLookup(db, 'segment')).id,
    },
  })
}

// A lot written straight to the database, for tests about reading, filtering or deleting lots.
// Pass grnTotal and completedOn together with matching receipts, or use the API instead.
export async function makeLot(
  db: PrismaClient,
  fields: Partial<Prisma.LotUncheckedCreateInput> = {},
) {
  return db.lot.create({
    data: {
      productId: fields.productId ?? (await makeProduct(db)).id,
      label: fields.label ?? unique('Lot'),
      categoryId: fields.categoryId ?? (await systemLookup(db, 'bau')).id,
      statusId: fields.statusId ?? (await systemLookup(db, 'on_track')).id,
      stageId: fields.stageId ?? (await makeLookup(db, 'stage')).id,
      lotQty: 100,
      ...fields,
    },
  })
}

// Users of every role, the dropdown values lots need, and one product, for the lot test files.
// Values have fixed names (status lines quote them), so call it once per test file.
export async function makeRecordsWorld(db: PrismaClient, app: Express) {
  const lookups = {
    bau: await systemLookup(db, 'bau'),
    npi: await makeLookup(db, 'category', 'NPI'),
    onTrack: await systemLookup(db, 'on_track'),
    delayed: await systemLookup(db, 'delayed'),
    hold: await systemLookup(db, 'hold'),
    none: await systemLookup(db, 'none'),
    approval: await systemLookup(db, 'approval_blocker'),
    rmBlocker: await makeLookup(db, 'blocker', 'RM Blocker'),
    stage: await makeLookup(db, 'stage', 'Factory Production'),
    ems: await makeLookup(db, 'ems', 'Orion EMS'),
    road: await makeLookup(db, 'logistics', 'Road'),
    pcb: await makeLookup(db, 'component', 'PCB'),
    enclosure: await makeLookup(db, 'component', 'Enclosure'),
    kit: await makeLookup(db, 'component', 'Kit (All Together)'),
    pocA: await makeLookup(db, 'poc', 'Maya Shah'),
    pocB: await makeLookup(db, 'poc', 'Rohit Mehta'),
    segment: await makeLookup(db, 'segment', 'Soundbars'),
  }
  const product = await makeProduct(db, {
    name: 'Soundbar',
    variant: 'X1',
    segmentId: lookups.segment.id,
  })
  const signedInAs = async (role: Role, pocId: string | null = null) =>
    signIn(app, (await makeUser(db, { role, pocId, name: `Test ${role}` })).email)
  return {
    lookups,
    product,
    admin: await signedInAs('admin'),
    planner: await signedInAs('planner'),
    poc: await signedInAs('poc', lookups.pocA.id),
    viewer: await signedInAs('viewer'),
  }
}
export type RecordsWorld = Awaited<ReturnType<typeof makeRecordsWorld>>

// A valid POST /lots body; override any field.
export const lotBody = (w: RecordsWorld, overrides: Record<string, unknown> = {}) => ({
  productId: w.product.id,
  label: unique('Lot'),
  categoryId: w.lookups.bau.id,
  statusId: w.lookups.onTrack.id,
  stageId: w.lookups.stage.id,
  lotQty: 100,
  ...overrides,
})

// A valid POST /shipments body with one line of the world's product; override any field.
export const shipmentBody = (w: RecordsWorld, overrides: Record<string, unknown> = {}) => ({
  number: unique('INV').replace(/\s/g, '-'),
  vessel: 'MSC Aurora',
  etd: '2026-09-26',
  plannedEta: '2026-10-20',
  items: [{ productId: w.product.id, quantity: 100 }],
  ...overrides,
})
