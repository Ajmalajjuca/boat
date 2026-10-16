import type {
  BatchInput,
  BatchItem,
  LookupItem,
  LotComputed,
  LotInput,
  LotItem,
  LotProduct,
  ProductInput,
  ProductItem,
  ReceiptInput,
  ReceiptItem,
  Ref,
  ShipmentComputed,
  ShipmentInput,
  ShipmentLine,
  ShipmentListItem,
} from '@boat/domain/api'
import type {
  GRNReceipt,
  LookupKind,
  Lot,
  Product,
  RMBatch,
  Shipment,
  ShipmentItem,
} from '@boat/domain/models'
import type { LotAccess } from '@boat/domain/permissions'
import { lineField } from '@boat/domain/validation'

// The screens work on the domain's shapes, where dropdowns are display text and an empty date is
// '', so the domain's calculations and validators apply in the browser as they did before. This
// file is the only place that knows the API's shapes: ids, { id, value } and null dates.

const text = (ref: Ref | null) => ref?.value ?? ''
const day = (date: string | null) => date ?? ''
const orNull = (date: string) => date || null

// Dropdown values are unique per kind ignoring case, as the server's citext index enforces.
export function lookupId(lookups: LookupItem[], kind: LookupKind, value: string) {
  if (!value) return null
  const wanted = value.toLowerCase()
  return lookups.find((l) => l.kind === kind && l.value.toLowerCase() === wanted)?.id ?? null
}
export const values = (lookups: LookupItem[], kind: LookupKind) =>
  lookups
    .filter((l) => l.kind === kind)
    .sort((a, b) => a.sort - b.sort)
    .map((l) => l.value)

export type LotRecord = Lot & {
  version: number
  product: LotProduct
  computed: LotComputed
  access: LotAccess
  completedOn: string
}
export function toLot(item: LotItem): LotRecord {
  return {
    id: item.id,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    version: item.version,
    productId: item.product.id,
    product: item.product,
    label: item.label,
    category: item.category.value,
    directFg: item.directFg,
    ems: text(item.ems),
    poc: text(item.poc),
    status: item.status.value,
    stage: item.stage.value,
    rmMode: item.rmMode,
    rmComponents: item.components.map((c) => c.value),
    readyQty: item.readyQty,
    lotQty: item.lotQty,
    freshProductionQty: item.freshProductionQty,
    reworkQty: item.reworkQty,
    reworkReason: item.reworkReason,
    rmReadyDate: day(item.rmReadyDate),
    plannedDate: day(item.plannedDate),
    revisedEta: day(item.revisedEta),
    actualDate: day(item.actualDate),
    logisticsMode: text(item.logistics),
    blockerCategory: text(item.blocker),
    blockerDescription: item.blockerDescription,
    followUpDate: day(item.followUpDate),
    followUpNote: item.followUpNote,
    completedOn: day(item.completedOn),
    computed: item.computed,
    access: item.access,
  }
}
// Required values that can't be found are sent as '', so the server's 422 names the field.
export function lotInput(lot: Lot, lookups: LookupItem[]): LotInput {
  const id = (kind: LookupKind, value: string) => lookupId(lookups, kind, value)
  return {
    productId: lot.productId,
    label: lot.label,
    categoryId: id('category', lot.category) ?? '',
    directFg: lot.directFg,
    emsId: id('ems', lot.ems),
    pocId: id('poc', lot.poc),
    statusId: id('status', lot.status) ?? '',
    stageId: id('stage', lot.stage) ?? '',
    rmMode: lot.rmMode,
    componentIds: lot.rmComponents.map((c) => id('component', c) ?? ''),
    readyQty: lot.readyQty,
    lotQty: lot.lotQty,
    freshProductionQty: lot.freshProductionQty,
    reworkQty: lot.reworkQty,
    reworkReason: lot.reworkReason,
    rmReadyDate: orNull(lot.rmReadyDate),
    plannedDate: orNull(lot.plannedDate),
    revisedEta: orNull(lot.revisedEta),
    actualDate: orNull(lot.actualDate),
    logisticsId: id('logistics', lot.logisticsMode),
    blockerId: id('blocker', lot.blockerCategory),
    blockerDescription: lot.blockerDescription,
    followUpDate: orNull(lot.followUpDate),
    followUpNote: lot.followUpNote,
  }
}
// The server names fields as the API does; the lot form uses the domain's names.
const lotNames: Record<string, string> = {
  categoryId: 'category',
  emsId: 'ems',
  pocId: 'poc',
  statusId: 'status',
  stageId: 'stage',
  componentIds: 'rmComponents',
  logisticsId: 'logisticsMode',
  blockerId: 'blockerCategory',
}
export const lotField = (name: string) => {
  const top = name.split('.')[0]
  return lotNames[top] ?? top
}

export const toBatch = (b: BatchItem): RMBatch => ({
  id: b.id,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
  lotId: b.lotId,
  component: b.component.value,
  label: b.label,
  plannedQty: b.plannedQty,
  plannedDate: day(b.plannedDate),
  receivedQty: b.receivedQty,
  receivedDate: day(b.receivedDate),
  status: b.status,
  notes: b.notes,
})
export const batchInput = (b: RMBatch, lookups: LookupItem[]): BatchInput => ({
  componentId: lookupId(lookups, 'component', b.component) ?? '',
  label: b.label,
  plannedQty: b.plannedQty,
  plannedDate: orNull(b.plannedDate),
  receivedQty: b.receivedQty,
  receivedDate: orNull(b.receivedDate),
  status: b.status,
  notes: b.notes,
})
export const batchField = (name: string) => (name === 'componentId' ? 'component' : name)

export const toReceipt = (r: ReceiptItem): GRNReceipt => ({
  id: r.id,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  lotId: r.lotId,
  label: r.label,
  date: day(r.date),
  quantity: r.quantity,
  note: r.note,
})
export const receiptInput = (r: GRNReceipt): ReceiptInput => ({
  label: r.label,
  date: r.date,
  quantity: r.quantity,
  note: r.note,
})

export type ProductRecord = Product & { version: number }
export const toProduct = (p: ProductItem): ProductRecord => ({
  id: p.id,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  version: p.version,
  name: p.name,
  variant: p.variant,
  segment: p.segment.value,
})
export const productInput = (p: Product, lookups: LookupItem[]): ProductInput => ({
  name: p.name,
  variant: p.variant,
  segmentId: lookupId(lookups, 'segment', p.segment) ?? '',
})
export const productField = (name: string) => (name === 'segmentId' ? 'segment' : name)

export type ShipmentRecord = Shipment & {
  version: number
  computed: ShipmentComputed
  lines: ShipmentLine[]
}
export const toShipment = (s: ShipmentListItem): ShipmentRecord => ({
  id: s.id,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  version: s.version,
  number: s.number,
  vessel: s.vessel,
  etd: day(s.etd),
  plannedEta: day(s.plannedEta),
  revisedEta: day(s.revisedEta),
  actualArrival: day(s.actualArrival),
  stage: text(s.stage),
  remarks: s.remarks,
  computed: s.computed,
  lines: s.items,
})
export const toLines = (s: ShipmentListItem): ShipmentItem[] =>
  s.items.map((i) => ({
    id: i.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    shipmentId: s.id,
    productId: i.product.id,
    quantity: i.quantity,
  }))
export const shipmentInput = (
  s: Shipment,
  lines: ShipmentItem[],
  lookups: LookupItem[],
): ShipmentInput => ({
  number: s.number,
  vessel: s.vessel,
  etd: orNull(s.etd),
  plannedEta: orNull(s.plannedEta),
  revisedEta: orNull(s.revisedEta),
  actualArrival: orNull(s.actualArrival),
  stageId: lookupId(lookups, 'shipmentStage', s.stage),
  remarks: s.remarks,
  items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
})
// Lines are sent in the form's order, so the server's items.2.quantity is the form's third line.
export function shipmentField(lines: ShipmentItem[]) {
  return (name: string) => {
    const line = /^items\.(\d+)\.(productId|quantity)$/.exec(name)
    const target = line && lines[Number(line[1])]
    if (target) return lineField(target.id, line[2] as 'productId' | 'quantity')
    if (name === 'items' || name.startsWith('items.')) return 'lines'
    return name === 'stageId' ? 'stage' : name
  }
}
