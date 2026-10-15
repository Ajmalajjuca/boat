import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, lotBody, makeRecordsWorld, type RecordsWorld, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
})
afterAll(() => close())

const newLot = async (overrides: Record<string, unknown> = {}) =>
  (
    await w.planner.send(
      'post',
      '/api/v1/lots',
      lotBody(w, {
        label: 'Lot 1',
        pocId: w.lookups.pocA.id,
        rmMode: 'components',
        componentIds: [w.lookups.pcb.id],
        ...overrides,
      }),
    )
  ).body as { id: string; version: number }
const activity = async (lotId: string, query = '') =>
  (await w.viewer.agent.get(`/api/v1/lots/${lotId}/activity${query}`)).body

describe('history', () => {
  it('FR-7.1 records every create, field change, batch, receipt and note with the user', async () => {
    const lot = await newLot()
    await w.planner.send('patch', `/api/v1/lots/${lot.id}`, {
      plannedDate: '2026-10-20',
      version: 1,
    })
    const batch = await w.poc.send('post', `/api/v1/lots/${lot.id}/rm-batches`, {
      componentId: w.lookups.pcb.id,
      label: 'B1',
      receivedQty: 40,
    })
    await w.poc.send('post', `/api/v1/lots/${lot.id}/grn-receipts`, {
      label: 'GRN 1',
      date: '2026-10-12',
      quantity: 25,
    })
    await w.planner.send('delete', `/api/v1/rm-batches/${batch.body.id}`)
    await w.poc.send('post', `/api/v1/lots/${lot.id}/notes`, {
      message: 'Supplier confirmed Friday',
    })

    const res = await activity(lot.id)
    expect(res.total).toBe(6)
    expect(
      res.items.map((e: { kind: string; message: string; actorName: string }) => [
        e.kind,
        e.message,
        e.actorName,
      ]),
    ).toEqual([
      ['note', 'Supplier confirmed Friday', 'Test poc'],
      ['material', 'Deleted PCB batch B1', 'Test planner'],
      ['receipt', 'Added receipt GRN 1: 25 units', 'Test poc'],
      ['material', 'Added PCB batch B1 (40 received)', 'Test poc'],
      ['updated', 'Updated planned date', 'Test planner'],
      ['created', 'Lot Lot 1 created', 'Test planner'],
    ])
  })
  it('FR-7.1 records a delete, and the deleted lot then reads as 404', async () => {
    const lot = await newLot({ label: 'Lot 2' })
    await w.admin.send('delete', `/api/v1/lots/${lot.id}`)
    const entries = await db.activityLog.findMany({ where: { entityId: lot.id, kind: 'deleted' } })
    expect(entries.map((e) => [e.message, e.actorName])).toEqual([
      ['Lot Lot 2 deleted', 'Test admin'],
    ])
    expect((await w.viewer.agent.get(`/api/v1/lots/${lot.id}/activity`)).status).toBe(404)
  })
  it('FR-7.1 keeps history out of reach of edits and deletes, even for the app role', async () => {
    const lot = await newLot({ label: 'Lot 3' })
    await expect(
      db.$executeRaw`UPDATE activity_logs SET message = 'changed' WHERE entity_id = ${lot.id}::uuid`,
    ).rejects.toThrow()
    await expect(
      db.$executeRaw`DELETE FROM activity_logs WHERE entity_id = ${lot.id}::uuid`,
    ).rejects.toThrow()
  })
  it('keeps the name a user had at the time on their entries', async () => {
    const lot = await newLot({ label: 'Lot 4' })
    await db.user.update({ where: { id: w.planner.me.user.id }, data: { name: 'Renamed Later' } })
    const [created] = (await activity(lot.id)).items
    expect(created.actorName).toBe('Test planner')
    await db.user.update({ where: { id: w.planner.me.user.id }, data: { name: 'Test planner' } })
  })
  it('pages newest first', async () => {
    const lot = await newLot({ label: 'Lot 5' })
    for (const message of ['one', 'two', 'three'])
      await w.planner.send('post', `/api/v1/lots/${lot.id}/notes`, { message })
    const page = await activity(lot.id, '?pageSize=2&page=1')
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 2 })
    expect(page.items.map((e: { message: string }) => e.message)).toEqual(['three', 'two'])
  })
})

describe('notes', () => {
  it('FR-7.2 lets users with edit rights add a note', async () => {
    const own = await newLot({ label: 'Lot 6' })
    const res = await w.poc.send('post', `/api/v1/lots/${own.id}/notes`, {
      message: '  Called the factory ',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      kind: 'note',
      message: 'Called the factory',
      actorName: 'Test poc',
    })
  })
  it('FR-7.2 refuses viewers, POCs on other lots, and empty or very long notes', async () => {
    const theirs = await newLot({ label: 'Lot 7', pocId: w.lookups.pocB.id })
    expect(
      (await w.poc.send('post', `/api/v1/lots/${theirs.id}/notes`, { message: 'x' })).status,
    ).toBe(403)
    expect(
      (await w.viewer.send('post', `/api/v1/lots/${theirs.id}/notes`, { message: 'x' })).status,
    ).toBe(403)
    const blank = await w.planner.send('post', `/api/v1/lots/${theirs.id}/notes`, {
      message: '   ',
    })
    expect(blank.status).toBe(422)
    expect(blank.body.fields).toEqual({ message: 'Write a note first.' })
    const long = await w.planner.send('post', `/api/v1/lots/${theirs.id}/notes`, {
      message: 'x'.repeat(2001),
    })
    expect(long.status).toBe(422)
  })
})
