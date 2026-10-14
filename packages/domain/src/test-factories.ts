import type { GRNReceipt, Lot, Product, RMBatch, Shipment, ShipmentItem } from './models'

const stampFields = { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }
let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

export const makeProduct = (o: Partial<Product> = {}): Product => ({
  id: nextId('product'),
  ...stampFields,
  name: 'Inverter',
  variant: '5 kW',
  segment: 'Solar',
  ...o,
})

export const makeLot = (o: Partial<Lot> = {}): Lot => ({
  id: nextId('lot'),
  ...stampFields,
  productId: 'product-a',
  label: 'Lot 1',
  category: 'BAU',
  directFg: false,
  ems: '',
  poc: '',
  status: 'On Track',
  stage: 'Factory Production',
  rmMode: 'all',
  rmComponents: [],
  readyQty: 0,
  lotQty: 100,
  freshProductionQty: 0,
  reworkQty: 0,
  reworkReason: '',
  rmReadyDate: '',
  plannedDate: '2026-10-20',
  revisedEta: '',
  actualDate: '',
  logisticsMode: '',
  blockerCategory: 'None',
  blockerDescription: '',
  followUpDate: '',
  followUpNote: '',
  ...o,
})

export const makeReceipt = (o: Partial<GRNReceipt> = {}): GRNReceipt => ({
  id: nextId('receipt'),
  ...stampFields,
  lotId: 'lot-a',
  label: 'GRN 1',
  date: '2026-10-05',
  quantity: 10,
  note: '',
  ...o,
})

export const makeBatch = (o: Partial<RMBatch> = {}): RMBatch => ({
  id: nextId('batch'),
  ...stampFields,
  lotId: 'lot-a',
  component: 'PCB',
  label: 'Batch 1',
  plannedQty: 0,
  plannedDate: '',
  receivedQty: 0,
  receivedDate: '',
  status: '',
  notes: '',
  ...o,
})

export const makeShipment = (o: Partial<Shipment> = {}): Shipment => ({
  id: nextId('shipment'),
  ...stampFields,
  number: 'INV-1',
  vessel: 'MSC Aurora',
  etd: '2026-10-01',
  plannedEta: '2026-10-10',
  revisedEta: '',
  actualArrival: '',
  stage: 'In Transit',
  remarks: '',
  ...o,
})

export const makeItem = (o: Partial<ShipmentItem> = {}): ShipmentItem => ({
  id: nextId('item'),
  ...stampFields,
  shipmentId: 'shipment-a',
  productId: 'product-a',
  quantity: 10,
  ...o,
})
