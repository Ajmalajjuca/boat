import {
  arrivalDelay,
  effectiveShipmentEta,
  etaSlip,
  shipmentFlags,
  shipmentQuantity,
  shipmentStatus,
} from '@boat/domain/calculations'
import type { Shipment, ShipmentItem } from '@boat/domain/models'
import { fromDbDate } from '../../core/dates'
import { NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import type { Prisma } from '../../generated/prisma/client'

export const shipmentInclude = {
  stage: { select: { id: true, value: true } },
  items: {
    where: { deletedAt: null },
    include: { product: { select: { id: true, name: true, variant: true } } },
    // Lines saved together share a createdAt, so the product name makes the order stable.
    orderBy: [{ createdAt: 'asc' }, { product: { name: 'asc' } }, { id: 'asc' }],
  },
} satisfies Prisma.ShipmentInclude
export type ShipmentRow = Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>

const text = (d: Date | null) => fromDbDate(d) ?? ''

// The browser's shapes, so the domain's flags, status line and slip calculations apply as-is.
export const toDomainShipment = (row: ShipmentRow): Shipment => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  number: row.number,
  vessel: row.vessel,
  etd: text(row.etd),
  plannedEta: text(row.plannedEta),
  revisedEta: text(row.revisedEta),
  actualArrival: text(row.actualArrival),
  stage: row.stage?.value ?? '',
  remarks: row.remarks,
})

export const toDomainItems = (row: ShipmentRow): ShipmentItem[] =>
  row.items.map((i) => ({
    id: i.id,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    shipmentId: row.id,
    productId: i.productId,
    quantity: i.quantity,
  }))

export function computeShipment(s: Shipment, items: ShipmentItem[], date: string) {
  return {
    totalQty: shipmentQuantity(items),
    currentEta: effectiveShipmentEta(s) || null,
    flags: shipmentFlags(s, date),
    status: shipmentStatus(s, date),
    etaSlip: etaSlip(s),
    arrivalDelay: arrivalDelay(s),
  }
}

export const shipmentView = (row: ShipmentRow, date: string) => ({
  id: row.id,
  version: row.version,
  number: row.number,
  vessel: row.vessel,
  etd: fromDbDate(row.etd),
  plannedEta: fromDbDate(row.plannedEta),
  revisedEta: fromDbDate(row.revisedEta),
  actualArrival: fromDbDate(row.actualArrival),
  stage: row.stage,
  remarks: row.remarks,
  items: row.items.map((i) => ({ id: i.id, product: i.product, quantity: i.quantity })),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  computed: computeShipment(toDomainShipment(row), toDomainItems(row), date),
})
export type ShipmentView = ReturnType<typeof shipmentView>

export async function getShipmentDetail(db: Db, id: string, date: string) {
  const row = await db.shipment.findFirst({
    where: { id, deletedAt: null },
    include: shipmentInclude,
  })
  if (!row) throw new NotFoundError()
  const revisions = await db.etaRevision.findMany({
    where: { shipmentId: id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return {
    ...shipmentView(row, date),
    etaRevisions: revisions.map((r) => ({
      id: r.id,
      kind: r.kind,
      previousDate: fromDbDate(r.previousDate),
      newDate: fromDbDate(r.newDate),
      reason: r.reason,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    })),
  }
}
