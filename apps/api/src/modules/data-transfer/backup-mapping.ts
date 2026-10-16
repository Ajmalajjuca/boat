import { randomUUID } from 'node:crypto'
import type { DataSet } from '@boat/domain/models'
import { fromDbDate } from '../../core/dates'
import type { Db } from '../../core/prisma'
import {
  batchInclude,
  lotInclude,
  toDomainBatch,
  toDomainLot,
  toDomainReceipt,
} from '../lots/lot-view'
import { shipmentInclude, toDomainItems, toDomainShipment } from '../shipments/shipment-view'

const stamps = (row: { id: string; createdAt: Date; updatedAt?: Date }) => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
})

// The database as the browser's DataSet: active records only, dropdowns as text, empty dates as
// ''. History and ETA revisions come only for records that are still active, because the
// backup format requires every entry's parent to exist.
export async function currentDataSet(db: Db): Promise<DataSet> {
  const active = { deletedAt: null }
  const [products, lots, shipments, lookups, settings] = await Promise.all([
    db.product.findMany({
      where: active,
      include: { segment: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.lot.findMany({
      where: { ...active, product: { is: active } },
      include: lotInclude,
      orderBy: { createdAt: 'asc' },
    }),
    db.shipment.findMany({
      where: active,
      include: shipmentInclude,
      orderBy: { createdAt: 'asc' },
    }),
    db.lookupValue.findMany({ where: active, orderBy: [{ kind: 'asc' }, { sort: 'asc' }] }),
    db.appSetting.findMany(),
  ])
  const lotIds = lots.map((l) => l.id)
  const shipmentIds = shipments.map((s) => s.id)
  const [batches, receipts, revisions, history] = await Promise.all([
    db.rmBatch.findMany({
      where: { ...active, lotId: { in: lotIds } },
      include: batchInclude,
      orderBy: { createdAt: 'asc' },
    }),
    db.grnReceipt.findMany({
      where: { ...active, lotId: { in: lotIds } },
      orderBy: { createdAt: 'asc' },
    }),
    db.etaRevision.findMany({
      where: { shipmentId: { in: shipmentIds } },
      orderBy: { createdAt: 'asc' },
    }),
    db.activityLog.findMany({
      where: {
        OR: [
          { entityType: 'lot', entityId: { in: lotIds } },
          { entityType: 'shipment', entityId: { in: shipmentIds } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  const now = new Date().toISOString()
  return {
    products: products.map((p) => ({
      ...stamps(p),
      name: p.name,
      variant: p.variant,
      segment: p.segment.value,
    })),
    lots: lots.map(toDomainLot),
    rmBatches: batches.map(toDomainBatch),
    grnReceipts: receipts.map(toDomainReceipt),
    shipments: shipments.map(toDomainShipment),
    shipmentItems: shipments.flatMap(toDomainItems),
    etaRevisions: revisions.map((r) => ({
      ...stamps(r),
      shipmentId: r.shipmentId,
      previousDate: fromDbDate(r.previousDate) ?? '',
      newDate: fromDbDate(r.newDate) ?? '',
      reason: r.reason,
    })),
    activityLogs: history.map((a) => ({
      ...stamps(a),
      entityType: a.entityType,
      entityId: a.entityId,
      message: a.message,
      kind: a.kind,
      ...(a.actorName ? { actor: a.actorName } : {}),
    })),
    lookupValues: lookups.map((v) => ({
      ...stamps(v),
      kind: v.kind,
      value: v.value,
      sort: v.sort,
    })),
    // The demo requires an "initialized" record; server settings travel as strings, as the demo
    // stores them. Settings have no ids of their own, so each export gives them fresh ones.
    settings: [
      { id: randomUUID(), createdAt: now, updatedAt: now, key: 'initialized', value: 'server' },
      ...settings.map((s) => ({
        id: randomUUID(),
        createdAt: s.updatedAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        key: s.key,
        value: typeof s.value === 'string' ? s.value : JSON.stringify(s.value),
      })),
    ],
  }
}
