import type {
  BatchItem,
  LookupItem,
  LotItem,
  ReceiptItem,
  ShipmentListItem,
} from '@boat/domain/api'
import type { ShipmentItem } from '@boat/domain/models'
import { describe, expect, it } from 'vitest'
import {
  batchField,
  batchInput,
  lookupId,
  lotField,
  lotInput,
  receiptInput,
  shipmentField,
  shipmentInput,
  toBatch,
  toLot,
  toLines,
  toReceipt,
  toShipment,
  values,
} from './mappers'

const ref = (id: string, value: string) => ({ id, value })
const lookup = (id: string, kind: LookupItem['kind'], value: string, sort = 0): LookupItem => ({
  id,
  kind,
  value,
  sort,
  system: false,
})
const lookups = [
  lookup('c1', 'category', 'BAU'),
  lookup('s1', 'status', 'On Track'),
  lookup('g1', 'stage', 'Factory Production'),
  lookup('p1', 'poc', 'Maya Shah'),
  lookup('k2', 'component', 'PCB', 2),
  lookup('k1', 'component', 'Enclosure', 1),
  lookup('b1', 'blocker', 'None'),
  lookup('t1', 'shipmentStage', 'In Transit'),
]
const computed = {
  grnTotal: 0,
  balance: 100,
  completed: false,
  grnPercent: 0,
  fullGrnDate: null,
  planDelay: null,
  leadTime: null,
  rmReadyDate: null,
  flags: { overdue: false, dueSoon: false, followUp: false, blocked: false, approval: false },
  summary: 'On track',
  rm: { producible: 0, bottleneck: 'PCB', percent: 0, complete: false },
}
const item: LotItem = {
  id: 'l1',
  version: 3,
  product: { id: 'pr1', name: 'Soundbar', variant: 'X1', segment: ref('sg', 'Soundbars') },
  label: 'Lot 1',
  category: ref('c1', 'BAU'),
  directFg: false,
  ems: null,
  poc: ref('p1', 'Maya Shah'),
  status: ref('s1', 'On Track'),
  stage: ref('g1', 'Factory Production'),
  rmMode: 'components',
  components: [ref('k1', 'Enclosure'), ref('k2', 'PCB')],
  readyQty: 0,
  lotQty: 100,
  freshProductionQty: 10,
  reworkQty: 0,
  reworkReason: '',
  rmReadyDate: null,
  plannedDate: '2026-10-20',
  revisedEta: null,
  actualDate: null,
  logistics: null,
  blocker: ref('b1', 'None'),
  blockerDescription: '',
  followUpDate: null,
  followUpNote: '',
  completedOn: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  computed,
  access: 'full',
}

describe('lots', () => {
  it('maps a lot to the domain shape, with empty dates as empty strings', () => {
    const lot = toLot(item)
    expect(lot).toMatchObject({
      id: 'l1',
      version: 3,
      productId: 'pr1',
      category: 'BAU',
      ems: '',
      poc: 'Maya Shah',
      rmComponents: ['Enclosure', 'PCB'],
      plannedDate: '2026-10-20',
      revisedEta: '',
      logisticsMode: '',
      blockerCategory: 'None',
      completedOn: '',
      access: 'full',
    })
  })
  it('maps the domain shape back to ids, ignoring the letter case of values', () => {
    const input = lotInput({ ...toLot(item), poc: 'maya shah', revisedEta: '2026-10-22' }, lookups)
    expect(input).toMatchObject({
      categoryId: 'c1',
      statusId: 's1',
      stageId: 'g1',
      pocId: 'p1',
      emsId: null,
      componentIds: ['k1', 'k2'],
      blockerId: 'b1',
      logisticsId: null,
      plannedDate: '2026-10-20',
      revisedEta: '2026-10-22',
      rmReadyDate: null,
    })
    expect(input).not.toHaveProperty('id')
  })
  it('sends an empty id for a required value that no longer exists, so the server names the field', () => {
    expect(lotInput({ ...toLot(item), status: 'Gone' }, lookups).statusId).toBe('')
  })
  it("renames the server's lot fields to the form's", () => {
    expect(lotField('categoryId')).toBe('category')
    expect(lotField('componentIds.1')).toBe('rmComponents')
    expect(lotField('logisticsId')).toBe('logisticsMode')
    expect(lotField('blockerId')).toBe('blockerCategory')
    expect(lotField('label')).toBe('label')
  })
})

describe('entries', () => {
  it('maps batches and receipts both ways', () => {
    const batch: BatchItem = {
      id: 'b',
      lotId: 'l1',
      component: ref('k2', 'PCB'),
      label: 'B1',
      plannedQty: 10,
      plannedDate: null,
      receivedQty: 5,
      receivedDate: '2026-10-03',
      status: 'Partial',
      notes: '',
      createdAt: 'c',
      updatedAt: 'u',
    }
    expect(toBatch(batch)).toMatchObject({
      component: 'PCB',
      plannedDate: '',
      receivedDate: '2026-10-03',
    })
    expect(batchInput(toBatch(batch), lookups)).toEqual({
      componentId: 'k2',
      label: 'B1',
      plannedQty: 10,
      plannedDate: null,
      receivedQty: 5,
      receivedDate: '2026-10-03',
      status: 'Partial',
      notes: '',
    })
    expect(batchField('componentId')).toBe('component')
    const receipt: ReceiptItem = {
      id: 'r',
      lotId: 'l1',
      label: 'G1',
      date: '2026-10-04',
      quantity: 40,
      note: 'n',
      createdBy: null,
      createdAt: 'c',
      updatedAt: 'u',
    }
    expect(receiptInput(toReceipt(receipt))).toEqual({
      label: 'G1',
      date: '2026-10-04',
      quantity: 40,
      note: 'n',
    })
  })
})

describe('shipments', () => {
  const shipment: ShipmentListItem = {
    id: 's',
    version: 2,
    number: 'INV-1',
    vessel: 'MSC Aurora',
    etd: '2026-09-26',
    plannedEta: '2026-10-20',
    revisedEta: null,
    actualArrival: null,
    stage: ref('t1', 'In Transit'),
    remarks: '',
    items: [
      { id: 'i1', product: { id: 'pr1', name: 'Soundbar', variant: 'X1' }, quantity: 100 },
      { id: 'i2', product: { id: 'pr2', name: 'Earbuds', variant: '' }, quantity: 50 },
    ],
    createdAt: 'c',
    updatedAt: 'u',
    computed: {
      totalQty: 150,
      currentEta: '2026-10-20',
      flags: { open: true, soon: false, overdue: false, revised: false, arrived: false },
      status: 'In Transit',
      etaSlip: 0,
      arrivalDelay: null,
    },
  }
  it('maps a shipment and its lines both ways', () => {
    expect(toShipment(shipment)).toMatchObject({ stage: 'In Transit', revisedEta: '', version: 2 })
    const lines = toLines(shipment)
    expect(lines.map((l) => [l.productId, l.quantity])).toEqual([
      ['pr1', 100],
      ['pr2', 50],
    ])
    expect(shipmentInput(toShipment(shipment), lines, lookups)).toMatchObject({
      stageId: 't1',
      revisedEta: null,
      items: [
        { productId: 'pr1', quantity: 100 },
        { productId: 'pr2', quantity: 50 },
      ],
    })
  })
  it('puts line errors on the line the server numbered', () => {
    const lines = [{ id: 'first' }, { id: 'second' }] as ShipmentItem[]
    const field = shipmentField(lines)
    expect(field('items.1.productId')).toBe('line:second:productId')
    expect(field('items.0.quantity')).toBe('line:first:quantity')
    expect(field('items')).toBe('lines')
    expect(field('items.7.quantity')).toBe('lines')
    expect(field('stageId')).toBe('stage')
    expect(field('number')).toBe('number')
  })
})

describe('lookups', () => {
  it('finds ids ignoring case, and lists values in their order', () => {
    expect(lookupId(lookups, 'poc', 'MAYA SHAH')).toBe('p1')
    expect(lookupId(lookups, 'poc', '')).toBeNull()
    expect(lookupId(lookups, 'ems', 'Orion')).toBeNull()
    expect(values(lookups, 'component')).toEqual(['Enclosure', 'PCB'])
  })
})
