export interface RecordBase {
  id: string
  createdAt: string
  updatedAt: string
}
export interface Product extends RecordBase {
  name: string
  variant: string
  segment: string
}
export type RMMode = 'all' | 'components'
export interface Lot extends RecordBase {
  productId: string
  label: string
  category: string
  directFg: boolean
  ems: string
  poc: string
  status: string
  stage: string
  rmMode: RMMode
  rmComponents: string[]
  readyQty: number
  lotQty: number
  freshProductionQty: number
  reworkQty: number
  reworkReason: string
  rmReadyDate: string
  plannedDate: string
  revisedEta: string
  actualDate: string
  logisticsMode: string
  blockerCategory: string
  blockerDescription: string
  followUpDate: string
  followUpNote: string
}
export interface RMBatch extends RecordBase {
  lotId: string
  component: string
  label: string
  plannedQty: number
  plannedDate: string
  receivedQty: number
  receivedDate: string
  status: string
  notes: string
}
export interface GRNReceipt extends RecordBase {
  lotId: string
  label: string
  date: string
  quantity: number
  note: string
}
export interface Shipment extends RecordBase {
  number: string
  vessel: string
  etd: string
  plannedEta: string
  revisedEta: string
  actualArrival: string
  stage: string
  remarks: string
}
export interface ShipmentItem extends RecordBase {
  shipmentId: string
  productId: string
  quantity: number
}
export interface ETARevision extends RecordBase {
  shipmentId: string
  previousDate: string
  newDate: string
  reason: string
}
export interface ActivityLog extends RecordBase {
  entityType: 'lot' | 'shipment'
  entityId: string
  message: string
  kind: string
}
export type LookupKind =
  | 'segment'
  | 'category'
  | 'ems'
  | 'poc'
  | 'status'
  | 'stage'
  | 'blocker'
  | 'logistics'
  | 'component'
  | 'shipmentStage'
export interface LookupValue extends RecordBase {
  kind: LookupKind
  value: string
  sort: number
}
export interface AppSetting extends RecordBase {
  key: string
  value: string
}
export type DataSet = {
  products: Product[]
  lots: Lot[]
  rmBatches: RMBatch[]
  grnReceipts: GRNReceipt[]
  shipments: Shipment[]
  shipmentItems: ShipmentItem[]
  etaRevisions: ETARevision[]
  activityLogs: ActivityLog[]
  lookupValues: LookupValue[]
  settings: AppSetting[]
}
export const dataKeys: (keyof DataSet)[] = [
  'products',
  'lots',
  'rmBatches',
  'grnReceipts',
  'shipments',
  'shipmentItems',
  'etaRevisions',
  'activityLogs',
  'lookupValues',
  'settings',
]
export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
export const stamp = <T extends object>(value: T): T & RecordBase => ({
  ...value,
  id: uid(),
  createdAt: now(),
  updatedAt: now(),
})
export function productChoices(products: Product[]) {
  return products.map((product) => {
    const base = `${product.name}${product.variant ? ` · ${product.variant}` : ''}`
    const repeated =
      products.filter((other) => other.name === product.name && other.variant === product.variant)
        .length > 1
    return {
      value: product.id,
      label: repeated ? `${base} · ${product.segment} · ${product.id.slice(0, 6)}` : base,
    }
  })
}
