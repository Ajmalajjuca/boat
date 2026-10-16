// The JSON the API sends and accepts. The web app reads these shapes, and apps/api/src/contract.ts
// checks at compile time that the server's views produce exactly them. Dates are YYYY-MM-DD
// strings or null; timestamps are ISO strings; dropdown values are { id, value }.
import type { DataSet, LookupKind, RMMode, Role } from './models'
import type { Action, LotAccess } from './permissions'

// The lot list's quick filters and sorts, and the shipment list's.
export const lotFlagNames = [
  'overdue',
  'dueSoon',
  'followUp',
  'blocked',
  'approval',
  'rm',
  'npi',
  'onTrack',
] as const
export type LotFlag = (typeof lotFlagNames)[number]
export const lotSorts = [
  'eta-asc',
  'eta-desc',
  'qty-desc',
  'balance-desc',
  'product-asc',
  'label-asc',
] as const
export type LotSort = (typeof lotSorts)[number]
export const shipmentFlagNames = ['open', 'soon', 'overdue', 'revised', 'arrived'] as const
export type ShipmentFlag = (typeof shipmentFlagNames)[number]
export const shipmentSorts = ['eta-asc', 'eta-desc', 'qty-desc', 'number-asc'] as const
export type ShipmentSort = (typeof shipmentSorts)[number]

export type Ref = { id: string; value: string }
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  pocId: string | null
  poc: Ref | null
}
export type MePayload = {
  user: SessionUser
  allowedActions: Action[]
  csrfToken: string
  idleTimeoutMinutes: number
}
export type Settings = { timeZone: string; idleTimeoutMinutes: number }

export type LookupItem = {
  id: string
  kind: LookupKind
  value: string
  sort: number
  system: boolean
}
export type ProductItem = {
  id: string
  version: number
  name: string
  variant: string
  segment: Ref
  createdAt: string
  updatedAt: string
}

export type LotProduct = { id: string; name: string; variant: string; segment: Ref }
export type LotComputed = {
  grnTotal: number
  balance: number
  completed: boolean
  grnPercent: number
  fullGrnDate: string | null
  planDelay: number | null
  leadTime: number | null
  rmReadyDate: string | null
  flags: {
    overdue: boolean
    dueSoon: boolean
    followUp: boolean
    blocked: boolean
    approval: boolean
  }
  summary: string
  rm: { producible: number; bottleneck: string; percent: number; complete: boolean }
}
export type LotItem = {
  id: string
  version: number
  product: LotProduct
  label: string
  category: Ref
  directFg: boolean
  ems: Ref | null
  poc: Ref | null
  status: Ref
  stage: Ref
  rmMode: RMMode
  components: Ref[]
  readyQty: number
  lotQty: number
  freshProductionQty: number
  reworkQty: number
  reworkReason: string
  rmReadyDate: string | null
  plannedDate: string | null
  revisedEta: string | null
  actualDate: string | null
  logistics: Ref | null
  blocker: Ref | null
  blockerDescription: string
  followUpDate: string | null
  followUpNote: string
  completedOn: string | null
  createdAt: string
  updatedAt: string
  computed: LotComputed
  access: LotAccess
}
export type BatchItem = {
  id: string
  lotId: string
  component: Ref
  label: string
  plannedQty: number
  plannedDate: string | null
  receivedQty: number
  receivedDate: string | null
  status: string
  notes: string
  createdAt: string
  updatedAt: string
}
export type ReceiptItem = {
  id: string
  lotId: string
  label: string
  date: string | null
  quantity: number
  note: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}
export type LotDetail = LotItem & { rmBatches: BatchItem[]; grnReceipts: ReceiptItem[] }
export type LotCards = Record<
  'overdue' | 'dueSoon' | 'onTrack' | 'blocked' | 'approval' | 'followUp' | 'rm' | 'npi',
  number
>
export type LotGroup = {
  product: LotProduct
  lots: number
  delayed: number
  lotQty: number
  produced: number
  grnTotal: number
  balance: number
}
export type ActivityEntry = {
  id: string
  kind: string
  message: string
  changes: unknown
  actorId: string | null
  actorName: string | null
  createdAt: string
}

export type ShipmentLine = {
  id: string
  product: { id: string; name: string; variant: string }
  quantity: number
}
export type ShipmentComputed = {
  totalQty: number
  currentEta: string | null
  flags: Record<ShipmentFlag, boolean>
  status: string
  etaSlip: number | null
  arrivalDelay: number | null
}
export type ShipmentListItem = {
  id: string
  version: number
  number: string
  vessel: string
  etd: string | null
  plannedEta: string | null
  revisedEta: string | null
  actualArrival: string | null
  stage: Ref | null
  remarks: string
  items: ShipmentLine[]
  createdAt: string
  updatedAt: string
  computed: ShipmentComputed
}
export type EtaRevisionItem = {
  id: string
  kind: 'planned' | 'current'
  previousDate: string | null
  newDate: string | null
  reason: string
  createdBy: string | null
  createdAt: string
}
export type ShipmentDetail = ShipmentListItem & { etaRevisions: EtaRevisionItem[] }
export type ShipmentCards = Record<ShipmentFlag, number> & { openUnits: number; vessels: string[] }

export type MonthEndReport = {
  month: string
  label: string
  monthEnd: string
  inProgress: boolean
  planned: number
  received: number
  shortfall: number
  percent: number
  grnInMonth: number
  products: {
    product: LotProduct
    lots: number
    planned: number
    received: number
    shortfall: number
  }[]
  lots: {
    lot: {
      id: string
      label: string
      plannedDate: string | null
      eta: string | null
      product: LotProduct
      blocker: Ref | null
      blockerDescription: string
    }
    planned: number
    received: number
    shortfall: number
    statusToday: string
  }[]
}

export type UserItem = {
  id: string
  email: string
  name: string
  role: Role
  status: 'invited' | 'active' | 'disabled'
  lastLoginAt: string | null
  createdAt: string
  poc: Ref | null
}
export type InviteResult = { user: UserItem; inviteEmailSent: boolean }
export type ResetResult = {
  deleted: Record<
    | 'shipmentItems'
    | 'shipments'
    | 'grnReceipts'
    | 'rmBatches'
    | 'lotComponents'
    | 'lots'
    | 'products',
    number
  >
}
export type ImportResult = {
  mode: 'merge' | 'replace'
  imported: Record<keyof DataSet, number>
}

export type LotInput = {
  productId: string
  label: string
  categoryId: string
  directFg: boolean
  emsId: string | null
  pocId: string | null
  statusId: string
  stageId: string
  rmMode: RMMode
  componentIds: string[]
  readyQty: number
  lotQty: number
  freshProductionQty: number
  reworkQty: number
  reworkReason: string
  rmReadyDate: string | null
  plannedDate: string | null
  revisedEta: string | null
  actualDate: string | null
  logisticsId: string | null
  blockerId: string | null
  blockerDescription: string
  followUpDate: string | null
  followUpNote: string
}
export type LotPatch = Partial<LotInput> & { version: number }
export type BatchInput = {
  componentId: string
  label: string
  plannedQty: number
  plannedDate: string | null
  receivedQty: number
  receivedDate: string | null
  status: string
  notes: string
}
export type ReceiptInput = { label: string; date: string; quantity: number; note: string }
export type ProductInput = { name: string; variant: string; segmentId: string }
export type ProductPatch = Partial<ProductInput> & { version: number }
export type ShipmentInput = {
  number: string
  vessel: string
  etd: string | null
  plannedEta: string | null
  revisedEta: string | null
  actualArrival: string | null
  stageId: string | null
  remarks: string
  items: { productId: string; quantity: number }[]
}
export type ShipmentPatch = Partial<ShipmentInput> & { version: number; etaChangeReason?: string }
export type NewUser = { email: string; name: string; role: Role; pocId: string | null }
export type UserPatch = {
  name?: string
  role?: Role
  pocId?: string | null
  status?: 'active' | 'disabled'
}
