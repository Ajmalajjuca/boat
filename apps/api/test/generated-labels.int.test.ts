import { afterAll, beforeAll, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, lotBody, makeRecordsWorld, type RecordsWorld, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let w: RecordsWorld
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  w = await makeRecordsWorld(db, testApp(db, { now: fixedNow, features: { grn: true } }))
})
afterAll(() => close())

const create = (label?: string) =>
  w.planner.send('post', '/api/v1/lots', {
    ...lotBody(w),
    label,
    rmMode: 'components',
    componentIds: [w.lookups.pcb.id],
  })

it('generates lot labels when omitted, empty or whitespace, skipping existing references', async () => {
  expect((await create('LOT-000001')).status).toBe(201)
  for (const label of [undefined, '', '   ']) {
    const result = await create(label)
    expect(result.status).toBe(201)
    expect(result.body.label).toMatch(/^LOT-\d{6,}$/)
    expect(result.body.label).not.toBe('LOT-000001')
    const history = await db.activityLog.findFirst({
      where: { entityId: result.body.id, kind: 'created' },
    })
    expect(history?.message).toContain(result.body.label)
  }
})

it('allocates different lot labels for simultaneous saves', async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => create()))
  expect(results.map((r) => r.status)).toEqual(Array(6).fill(201))
  expect(new Set(results.map((r) => r.body.label)).size).toBe(6)
})

it('generates batch and receipt references, skips existing ones, and records them in history', async () => {
  const lot = (await create()).body
  for (const [path, prefix, body] of [
    ['rm-batches', 'RM', { componentId: w.lookups.pcb.id }],
    ['grn-receipts', 'GRN', { date: '2026-10-10', quantity: 1 }],
  ] as const) {
    const existing = `${prefix}-000001`
    expect(
      (await w.planner.send('post', `/api/v1/lots/${lot.id}/${path}`, { ...body, label: existing }))
        .status,
    ).toBe(201)
    const references: string[] = []
    for (const label of [undefined, '', '  ']) {
      const result = await w.planner.send('post', `/api/v1/lots/${lot.id}/${path}`, {
        ...body,
        label,
      })
      expect(result.status).toBe(201)
      expect(result.body.label).toMatch(new RegExp(`^${prefix}-\\d{6,}$`))
      expect(result.body.label).not.toBe(existing)
      references.push(result.body.label)
    }
    expect(new Set(references).size).toBe(3)
    const messages = await db.activityLog.findMany({ where: { entityId: lot.id } })
    for (const label of references)
      expect(messages.some((m) => m.message.includes(label))).toBe(true)
  }
})

it('preserves a generated label on edits and rejects clearing a saved label', async () => {
  const lot = (await create()).body
  const updated = await w.planner.send('patch', `/api/v1/lots/${lot.id}`, {
    version: lot.version,
    lotQty: 200,
  })
  expect(updated.status).toBe(200)
  expect(updated.body.label).toBe(lot.label)
  const cleared = await w.planner.send('patch', `/api/v1/lots/${lot.id}`, {
    version: updated.body.version,
    label: '',
  })
  expect(cleared.status).toBe(422)
})

it('does not reuse generated references after records are deleted', async () => {
  const lot = (await create()).body
  expect((await w.admin.send('delete', `/api/v1/lots/${lot.id}`)).status).toBe(204)
  const next = await create()
  expect(next.status).toBe(201)
  expect(next.body.label).not.toBe(lot.label)
})

it('protects generated references from custom labels on other lots', async () => {
  const first = (await create()).body
  const second = (await create()).body
  for (const [path, body] of [
    ['rm-batches', { componentId: w.lookups.pcb.id }],
    ['grn-receipts', { date: '2026-10-10', quantity: 1 }],
  ] as const) {
    const generated = await w.planner.send('post', `/api/v1/lots/${first.id}/${path}`, body)
    expect(generated.status).toBe(201)
    const duplicate = await w.planner.send('post', `/api/v1/lots/${second.id}/${path}`, {
      ...body,
      label: generated.body.label.toLowerCase(),
    })
    expect(duplicate.status).toBe(422)
    expect(duplicate.body.fields.label).toContain('already in use')
  }
})
