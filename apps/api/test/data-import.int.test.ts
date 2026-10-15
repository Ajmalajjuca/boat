import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDatabase } from './support/db'
import { fixedNow, makeRecordsWorld, testApp } from './support/fixtures'

const samplePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/sample-test-backup.json',
)
type Rows = Record<string, Record<string, unknown>[]>
const sample = () =>
  JSON.parse(readFileSync(samplePath, 'utf8')) as { data: Rows } & Record<string, unknown>
const lotId = (backup: { data: Rows }, label: string) =>
  backup.data.lots.find((l) => l.label === label)!.id as string

// Each test gets its own database, because imports replace and reset everything.
let fresh: Awaited<ReturnType<typeof createTestDatabase>>
afterEach(() => fresh.close())
async function world() {
  fresh = await createTestDatabase()
  const app = testApp(fresh.db, { now: fixedNow })
  const w = await makeRecordsWorld(fresh.db, app)
  const importFile = (body: unknown, mode = 'replace', user = w.admin) =>
    user.send('post', `/api/v1/data/import?mode=${mode}`, body as object)
  return { db: fresh.db, app, w, importFile }
}

describe('POST /data/import', () => {
  it('FR-9.1 replaces the data with a backup, soft-deleting the current records', async () => {
    const { db, w, importFile } = await world()
    const res = await importFile(sample())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      mode: 'replace',
      imported: {
        products: 4,
        lots: 4,
        rmBatches: 6,
        grnReceipts: 4,
        shipments: 3,
        shipmentItems: 4,
        etaRevisions: 1,
        activityLogs: 2,
        lookupValues: 44,
        settings: 1,
      },
    })
    expect(await db.product.count({ where: { deletedAt: null } })).toBe(4)
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: w.product.id } })).deletedAt,
    ).not.toBeNull()
    // Dropdown values are Settings: the world's values survive a replace.
    expect(
      (await db.lookupValue.findUniqueOrThrow({ where: { id: w.lookups.pocA.id } })).deletedAt,
    ).toBeNull()
    const backup = sample()
    const done = (await w.viewer.agent.get(`/api/v1/lots/${lotId(backup, 'TEST-EP-002')}`)).body
    expect(done).toMatchObject({
      completedOn: '2026-10-05',
      computed: { grnTotal: 500, completed: true },
    })
    const parts = (await w.viewer.agent.get(`/api/v1/lots/${lotId(backup, 'TEST-EP-001')}`)).body
    expect(parts.components.map((c: { value: string }) => c.value)).toEqual([
      'Battery',
      'PCBA',
      'Plastic',
    ])
  })
  it('FR-9.1 checks the whole backup first, so a bad one changes nothing', async () => {
    const { db, importFile } = await world()
    const bad = sample()
    bad.data.grnReceipts.push({
      ...bad.data.grnReceipts[1],
      id: '0b7f6b1e-0000-4000-8000-000000000001',
      quantity: 400,
    })
    const res = await importFile(bad)
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ file: 'GRN exceeds lot quantity for TEST-EP-002.' })
    expect(await db.product.count({ where: { deletedAt: null } })).toBe(1)
  })
  it("refuses a backup that breaks the database's rules, naming the record", async () => {
    const { importFile } = await world()
    const early = sample()
    early.data.shipments[0].plannedEta = '2026-09-01'
    expect((await importFile(early)).body.fields).toEqual({
      file: 'Shipment TEST-SEA-001 has an ETA or arrival before its ETD.',
    })
    const nul = sample()
    nul.data.lots[0].label = 'TEST\u0000'
    expect((await importFile(nul)).body.fields).toEqual({ file: 'Invalid lots.label.' })
    expect((await importFile({ app: 'Something else' })).body.fields).toEqual({
      file: 'Unsupported JSON backup or schema version.',
    })
  })
  it('restores the same backup again after a replace', async () => {
    const { db, w, importFile } = await world()
    expect((await importFile(sample())).status).toBe(200)
    expect((await importFile(sample())).status).toBe(200)
    expect(await db.lot.count({ where: { deletedAt: null } })).toBe(4)
    expect(await db.grnReceipt.count({ where: { deletedAt: null } })).toBe(4)
    const backup = sample()
    const note = backup.data.activityLogs[0].id as string
    expect(await db.activityLog.count({ where: { id: note } })).toBe(1)
    const lot = (await w.viewer.agent.get(`/api/v1/lots/${lotId(backup, 'TEST-EP-002')}`)).body
    expect(lot.computed.grnTotal).toBe(500)
  })
  it('FR-9.1 merges: new records come in and records with the same id are overwritten', async () => {
    const { db, w, importFile } = await world()
    await importFile(sample())
    const next = sample()
    next.data.products[0].name = 'Renamed Speaker'
    next.data.products.push({
      ...next.data.products[1],
      id: '0b7f6b1e-0000-4000-8000-000000000002',
      name: 'Brand New',
    })
    const res = await importFile(next, 'merge')
    expect(res.status).toBe(200)
    expect(await db.product.count({ where: { deletedAt: null } })).toBe(5)
    const names = (await w.viewer.agent.get('/api/v1/products')).body.items.map(
      (p: { name: string }) => p.name,
    )
    expect(names).toEqual(expect.arrayContaining(['Renamed Speaker', 'Brand New']))
  })
  it('reuses dropdown values that differ only in case, system values included', async () => {
    const { db, importFile } = await world()
    const backup = sample()
    for (const v of backup.data.lookupValues) if (v.value === 'On Track') v.value = 'on track'
    for (const l of backup.data.lots) if (l.status === 'On Track') l.status = 'on track'
    expect((await importFile(backup, 'merge')).status).toBe(200)
    const onTrack = await db.lookupValue.findMany({
      where: { kind: 'status', value: 'On Track', deletedAt: null },
    })
    expect(onTrack).toHaveLength(1)
    expect(onTrack[0].systemKey).toBe('on_track')
    const lot = await db.lot.findUniqueOrThrow({ where: { id: lotId(backup, 'TEST-EP-002') } })
    expect(lot.statusId).toBe(onTrack[0].id)
  })
  it('refuses a merge that would give two products the same name and variant', async () => {
    const { importFile } = await world()
    const backup = sample()
    Object.assign(backup.data.products[0], { name: 'soundbar', variant: 'x1' })
    const res = await importFile(backup, 'merge')
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      file: 'Product soundbar duplicates another product name and variant.',
    })
  })
  it('infers which ETA each revision changed', async () => {
    const { db, importFile } = await world()
    const backup = sample()
    backup.data.etaRevisions.push({
      ...backup.data.etaRevisions[0],
      id: '0b7f6b1e-0000-4000-8000-000000000003',
      reason: 'Original plan: supplier',
    })
    await importFile(backup)
    const kinds = (await db.etaRevision.findMany({ orderBy: { reason: 'asc' } })).map((r) => [
      r.reason,
      r.kind,
    ])
    expect(kinds).toEqual([
      ['Original plan: supplier', 'planned'],
      ['Port congestion', 'current'],
    ])
  })
  it('brings in valid server settings and ignores the rest', async () => {
    const { w, importFile } = await world()
    const backup = sample()
    const row = backup.data.settings[0]
    backup.data.settings.push(
      { ...row, id: '0b7f6b1e-0000-4000-8000-000000000004', key: 'timeZone', value: 'Asia/Dubai' },
      {
        ...row,
        id: '0b7f6b1e-0000-4000-8000-000000000005',
        key: 'idleTimeoutMinutes',
        value: '30',
      },
      { ...row, id: '0b7f6b1e-0000-4000-8000-000000000006', key: 'lockMinutes', value: '5' },
    )
    await importFile(backup)
    expect((await w.viewer.agent.get('/api/v1/settings')).body).toEqual({
      timeZone: 'Asia/Dubai',
      idleTimeoutMinutes: 30,
    })
  })
  it('takes bodies over 1 MB, up to 20 MB', async () => {
    const { w } = await world()
    const post = (text: string) =>
      w.admin.agent
        .post('/api/v1/data/import?mode=replace')
        .set('x-csrf-token', w.admin.csrf)
        .set('content-type', 'application/json')
        .send(text)
    expect((await post(JSON.stringify(sample()) + ' '.repeat(2_000_000))).status).toBe(200)
    expect((await post(JSON.stringify(sample()) + ' '.repeat(21_000_000))).status).toBe(413)
  })
  it('FR-9.1 lets only admins import, in a known mode', async () => {
    const { w, importFile } = await world()
    expect((await importFile(sample(), 'replace', w.planner)).status).toBe(403)
    expect((await importFile(sample(), 'append')).status).toBe(422)
  })
})

describe('POST /data/reset', () => {
  it('FR-9.2 soft-deletes every business record after the typed phrase', async () => {
    const { db, w, importFile } = await world()
    await importFile(sample())
    const wrong = await w.admin.send('post', '/api/v1/data/reset', { confirm: 'reset' })
    expect(wrong.status).toBe(422)
    expect(wrong.body.fields).toEqual({ confirm: 'Type RESET ALL DATA to confirm.' })
    expect(
      (await w.planner.send('post', '/api/v1/data/reset', { confirm: 'RESET ALL DATA' })).status,
    ).toBe(403)
    const res = await w.admin.send('post', '/api/v1/data/reset', { confirm: 'RESET ALL DATA' })
    expect(res.status).toBe(200)
    expect(res.body.deleted).toMatchObject({ products: 4, lots: 4, shipments: 3, grnReceipts: 4 })
    expect((await w.viewer.agent.get('/api/v1/lots')).body.total).toBe(0)
    expect(await db.lot.count()).toBe(4)
    expect(
      await db.lookupValue.count({ where: { deletedAt: null, kind: 'status' } }),
    ).toBeGreaterThan(0)
  })
})
