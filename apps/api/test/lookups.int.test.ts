import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { makeLookup, makeUser, signIn, systemLookup, testApp, unique } from './support/fixtures'

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

const listOf = async (kind: string) =>
  (await admin.agent.get(`/api/v1/lookups?kind=${kind}`)).body.items as {
    id: string
    value: string
    sort: number
    system: boolean
  }[]

describe('the six system values', () => {
  it('FR-8.2 exist from the start, marked as system values', async () => {
    const res = await admin.agent.get('/api/v1/lookups')
    expect(res.status).toBe(200)
    const system = res.body.items
      .filter((v: { system: boolean }) => v.system)
      .map((v: { kind: string; value: string }) => `${v.kind}:${v.value}`)
      .sort()
    expect(system).toEqual([
      'blocker:Approval Blocker',
      'blocker:None',
      'category:BAU',
      'status:Delayed',
      'status:Hold',
      'status:On Track',
    ])
  })
  it('FR-8.2 cannot be renamed or deleted, but can be reordered', async () => {
    const hold = await systemLookup(db, 'hold')
    const rename = await admin.send('patch', `/api/v1/lookups/${hold.id}`, { value: 'Paused' })
    expect(rename.status).toBe(422)
    expect(rename.body.fields).toEqual({
      value: 'Hold is used by app calculations and cannot be renamed.',
    })
    const del = await admin.send('delete', `/api/v1/lookups/${hold.id}`)
    expect(del.status).toBe(409)
    expect(del.body.message).toBe('Hold is used by app calculations and cannot be deleted.')
    const reorder = await admin.send('patch', `/api/v1/lookups/${hold.id}`, { sort: 7 })
    expect(reorder.status).toBe(200)
    expect(reorder.body).toMatchObject({ value: 'Hold', sort: 7, system: true })
  })
})

describe('managing values', () => {
  it('FR-8.1 admins add a value to a kind, placed after the others', async () => {
    const first = await admin.send('post', '/api/v1/lookups', {
      kind: 'stage',
      value: ' RM Sourcing ',
    })
    const second = await admin.send('post', '/api/v1/lookups', { kind: 'stage', value: 'PDI/QC' })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ kind: 'stage', value: 'RM Sourcing', system: false })
    expect(second.body.sort).toBe(first.body.sort + 1)
    expect((await listOf('stage')).map((v) => v.value)).toEqual(['RM Sourcing', 'PDI/QC'])
  })
  it('FR-8.1 refuses a blank value and a duplicate in any letter case', async () => {
    const blank = await admin.send('post', '/api/v1/lookups', { kind: 'ems', value: '  ' })
    expect(blank.status).toBe(422)
    expect(blank.body.fields).toEqual({ value: 'Enter a value.' })
    await admin.send('post', '/api/v1/lookups', { kind: 'ems', value: 'Orion EMS' })
    const twin = await admin.send('post', '/api/v1/lookups', { kind: 'ems', value: 'orion ems' })
    expect(twin.status).toBe(422)
    expect(twin.body.fields).toEqual({ value: 'This value already exists.' })
    // The same text under another kind is a different value.
    const other = await admin.send('post', '/api/v1/lookups', { kind: 'poc', value: 'Orion EMS' })
    expect(other.status).toBe(201)
  })
  it('FR-8.1 renames a value even while records use it', async () => {
    const segment = await makeLookup(db, 'segment', 'Speakers')
    await db.product.create({ data: { name: unique('P'), segmentId: segment.id } })
    const res = await admin.send('patch', `/api/v1/lookups/${segment.id}`, { value: 'BT Speakers' })
    expect(res.status).toBe(200)
    expect(res.body.value).toBe('BT Speakers')
  })
  it('refuses a rename onto another value of the same kind', async () => {
    const a = await makeLookup(db, 'logistics', 'Road')
    await makeLookup(db, 'logistics', 'Air')
    const res = await admin.send('patch', `/api/v1/lookups/${a.id}`, { value: 'AIR' })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ value: 'This value already exists.' })
  })
})

describe('deleting values', () => {
  it('FR-8.2 refuses a value that an active record uses', async () => {
    const segment = await makeLookup(db, 'segment')
    await db.product.create({ data: { name: unique('P'), segmentId: segment.id } })
    const poc = await makeLookup(db, 'poc')
    await makeUser(db, { role: 'poc', pocId: poc.id })
    for (const value of [segment, poc]) {
      const res = await admin.send('delete', `/api/v1/lookups/${value.id}`)
      expect(res.status).toBe(409)
      expect(res.body.message).toBe(`${value.value} is in use. Reassign those records first.`)
    }
  })
  it('FR-8.2 deletes an unused value, which then leaves every list', async () => {
    const value = await makeLookup(db, 'shipmentStage', 'Customs')
    expect((await admin.send('delete', `/api/v1/lookups/${value.id}`)).status).toBe(204)
    expect((await listOf('shipmentStage')).map((v) => v.value)).not.toContain('Customs')
    const row = await db.lookupValue.findUniqueOrThrow({ where: { id: value.id } })
    expect(row.deletedBy).toBe(admin.me.user.id)
    // The text is free again.
    const again = await admin.send('post', '/api/v1/lookups', {
      kind: 'shipmentStage',
      value: 'Customs',
    })
    expect(again.status).toBe(201)
    expect((await admin.send('patch', `/api/v1/lookups/${value.id}`, { sort: 1 })).status).toBe(404)
  })
  it('counts a value used only by deleted records as unused', async () => {
    const segment = await makeLookup(db, 'segment')
    await db.product.create({
      data: { name: unique('P'), segmentId: segment.id, deletedAt: new Date() },
    })
    expect((await admin.send('delete', `/api/v1/lookups/${segment.id}`)).status).toBe(204)
  })
})

describe('who may change values', () => {
  it('lets every signed-in role read, and only admins change', async () => {
    const viewer = await signIn(app, (await makeUser(db, { role: 'viewer' })).email)
    expect((await viewer.agent.get('/api/v1/lookups?kind=status')).status).toBe(200)
    const planner = await signIn(app, (await makeUser(db, { role: 'planner' })).email)
    const res = await planner.send('post', '/api/v1/lookups', { kind: 'stage', value: 'X' })
    expect(res.status).toBe(403)
    expect((await request(app).get('/api/v1/lookups')).status).toBe(401)
  })
  it('answers an unknown kind with a field error', async () => {
    const res = await admin.agent.get('/api/v1/lookups?kind=colour')
    expect(res.status).toBe(422)
    expect(Object.keys(res.body.fields)).toEqual(['kind'])
  })
})
