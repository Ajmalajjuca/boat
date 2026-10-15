import { parseImport, validateRelations } from '@boat/domain/backup'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import {
  fixedNow,
  lotBody,
  makeLookup,
  makeRecordsWorld,
  type RecordsWorld,
  shipmentBody,
  testApp,
} from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
let lotId: string
let goneLotId: string
let shipmentId: string

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  const lot = await w.planner.send(
    'post',
    '/api/v1/lots',
    lotBody(w, {
      label: 'Lot A',
      rmMode: 'components',
      componentIds: [w.lookups.pcb.id],
      blockerId: w.lookups.rmBlocker.id,
    }),
  )
  lotId = lot.body.id
  await w.planner.send('post', `/api/v1/lots/${lotId}/rm-batches`, {
    componentId: w.lookups.pcb.id,
    label: 'B1',
    receivedQty: 40,
  })
  await w.planner.send('post', `/api/v1/lots/${lotId}/grn-receipts`, {
    label: 'G1',
    date: '2026-10-10',
    quantity: 30,
  })
  await w.planner.send('post', `/api/v1/lots/${lotId}/notes`, { message: 'Supplier called' })
  const gone = await w.planner.send('post', '/api/v1/lots', lotBody(w, { label: 'Gone' }))
  goneLotId = gone.body.id
  await w.admin.send('delete', `/api/v1/lots/${goneLotId}`)
  const stage = await makeLookup(db, 'shipmentStage', 'At Sea')
  const shipment = await w.planner.send(
    'post',
    '/api/v1/shipments',
    shipmentBody(w, { number: 'INV-1', stageId: stage.id, plannedEta: '2026-10-04' }),
  )
  shipmentId = shipment.body.id
  await w.planner.send('patch', `/api/v1/shipments/${shipmentId}`, {
    revisedEta: '2026-10-09',
    etaChangeReason: 'Port',
    version: 1,
  })
})
afterAll(() => close())

const exportFile = async () => {
  const res = await w.planner.agent.get('/api/v1/data/export')
  expect(res.status).toBe(200)
  return res
}

describe('GET /data/export', () => {
  it('FR-9.1 exports every active record in the demo backup format', async () => {
    const res = await exportFile()
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="?boat-backup-\d{4}-\d{2}-\d{2}\.json"?$/,
    )
    expect(res.body).toMatchObject({ app: 'Supply Chain Control Tower', schemaVersion: 1 })
    const data = parseImport(res.body)
    expect(() => validateRelations(data)).not.toThrow()
    const lot = data.lots.find((l) => l.id === lotId)!
    expect(lot).toMatchObject({
      label: 'Lot A',
      category: 'BAU',
      status: 'On Track',
      stage: 'Factory Production',
      rmMode: 'components',
      rmComponents: ['PCB'],
      blockerCategory: 'RM Blocker',
      plannedDate: '',
      ems: '',
    })
    expect(data.rmBatches.filter((b) => b.lotId === lotId)).toMatchObject([
      { component: 'PCB', receivedQty: 40, plannedDate: '' },
    ])
    expect(data.grnReceipts.filter((r) => r.lotId === lotId)).toMatchObject([
      { date: '2026-10-10', quantity: 30 },
    ])
    expect(data.shipments.find((s) => s.id === shipmentId)).toMatchObject({
      number: 'INV-1',
      stage: 'At Sea',
      plannedEta: '2026-10-04',
      revisedEta: '2026-10-09',
      actualArrival: '',
    })
    expect(data.shipmentItems.filter((i) => i.shipmentId === shipmentId)).toMatchObject([
      { productId: w.product.id, quantity: 100 },
    ])
    expect(data.etaRevisions).toMatchObject([
      { shipmentId, previousDate: '2026-10-04', newDate: '2026-10-09', reason: 'Port' },
    ])
    expect(data.activityLogs).toContainEqual(
      expect.objectContaining({
        entityType: 'lot',
        entityId: lotId,
        kind: 'note',
        message: 'Supplier called',
        actor: 'Test planner',
      }),
    )
    expect(data.lookupValues).toContainEqual(
      expect.objectContaining({ kind: 'status', value: 'On Track' }),
    )
    expect(data.settings).toContainEqual(
      expect.objectContaining({ key: 'initialized', value: 'server' }),
    )
  })
  it('leaves deleted records and their history out', async () => {
    const data = parseImport((await exportFile()).body)
    expect(data.lots.map((l) => l.id)).not.toContain(goneLotId)
    expect(data.activityLogs.map((a) => a.entityId)).not.toContain(goneLotId)
  })
  it('FR-9.1 lets admins and planners export, and nobody else', async () => {
    expect((await w.admin.agent.get('/api/v1/data/export')).status).toBe(200)
    for (const user of [w.poc, w.viewer])
      expect((await user.agent.get('/api/v1/data/export')).status).toBe(403)
  })
})
