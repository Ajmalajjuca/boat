import { describe, expect, it } from 'vitest'
import type { SessionUser } from '../../core/access'
import {
  type BatchRow,
  computeLot,
  type LotRow,
  lotAccess,
  lotView,
  type ReceiptRow,
  toDomainBatch,
  toDomainLot,
  toDomainReceipt,
} from './lot-view'

const at = new Date('2026-10-01T00:00:00Z')
const d = (s: string) => new Date(`${s}T00:00:00Z`)
const ref = (id: string, value: string) => ({ id, value })

function lotRow(overrides: Partial<LotRow> = {}): LotRow {
  return {
    id: 'lot-1',
    productId: 'p-1',
    product: { id: 'p-1', name: 'Inverter', variant: '5 kW', segment: ref('s-1', 'Power') },
    label: 'Lot 3',
    categoryId: 'c-1',
    category: ref('c-1', 'BAU'),
    directFg: false,
    emsId: null,
    ems: null,
    pocId: 'poc-1',
    poc: ref('poc-1', 'Ravi'),
    statusId: 'st-1',
    status: ref('st-1', 'Delayed'),
    stageId: 'sg-1',
    stage: ref('sg-1', 'Factory Production'),
    rmMode: 'components',
    components: [{ component: ref('k-2', 'PCB') }, { component: ref('k-1', 'Enclosure') }],
    readyQty: 0,
    lotQty: 500,
    freshProductionQty: 0,
    reworkQty: 0,
    reworkReason: '',
    rmReadyDate: null,
    plannedDate: d('2026-10-20'),
    revisedEta: d('2026-10-24'),
    actualDate: null,
    logisticsId: null,
    logistics: null,
    blockerId: 'b-1',
    blocker: ref('b-1', 'RM Blocker'),
    blockerDescription: '',
    followUpDate: d('2026-10-13'),
    followUpNote: '',
    grnTotal: 300,
    completedOn: null,
    version: 4,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  }
}
const batch = (
  component: ReturnType<typeof ref>,
  receivedQty: number,
  receivedDate = '2026-10-05',
): BatchRow => ({
  id: `b-${component.value}-${receivedQty}`,
  lotId: 'lot-1',
  componentId: component.id,
  component,
  label: 'B',
  plannedQty: 0,
  plannedDate: null,
  receivedQty,
  receivedDate: d(receivedDate),
  status: '',
  notes: '',
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  deletedBy: null,
})
const receipt = (quantity: number, date: string): ReceiptRow => ({
  id: `r-${quantity}-${date}`,
  lotId: 'lot-1',
  label: 'G',
  date: d(date),
  quantity,
  note: '',
  createdBy: null,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  deletedBy: null,
})
const user = (role: SessionUser['role'], pocId: string | null = null): SessionUser => ({
  id: 'u',
  email: 'u@example.com',
  name: 'U',
  role,
  pocId,
  poc: null,
  passwordLogin: false,
})

describe('toDomainLot', () => {
  it('maps dropdowns to their values, components sorted, missing dates to ""', () => {
    expect(toDomainLot(lotRow())).toMatchObject({
      category: 'BAU',
      ems: '',
      poc: 'Ravi',
      status: 'Delayed',
      stage: 'Factory Production',
      rmComponents: ['Enclosure', 'PCB'],
      plannedDate: '2026-10-20',
      revisedEta: '2026-10-24',
      actualDate: '',
      logisticsMode: '',
      blockerCategory: 'RM Blocker',
    })
  })
  it('maps batches and receipts to the shapes the calculations take', () => {
    expect(toDomainBatch(batch(ref('k-2', 'PCB'), 40))).toMatchObject({
      component: 'PCB',
      receivedQty: 40,
      receivedDate: '2026-10-05',
      plannedDate: '',
    })
    expect(toDomainReceipt(receipt(60, '2026-10-12'))).toMatchObject({
      quantity: 60,
      date: '2026-10-12',
    })
  })
})

describe('lotAccess', () => {
  it('gives admins and planners full access, a POC progress on their own lots, others none', () => {
    const row = { pocId: 'poc-1' }
    expect(lotAccess(user('admin'), row)).toBe('full')
    expect(lotAccess(user('planner'), row)).toBe('full')
    expect(lotAccess(user('poc', 'poc-1'), row)).toBe('progress')
    expect(lotAccess(user('poc', 'poc-2'), row)).toBe('none')
    expect(lotAccess(user('poc', 'poc-1'), { pocId: null })).toBe('none')
    expect(lotAccess(user('viewer'), row)).toBe('none')
  })
})

describe('computeLot', () => {
  const lot = toDomainLot(lotRow())
  it("matches the PRD's lot detail example", () => {
    const batches = [batch(ref('k-2', 'PCB'), 500), batch(ref('k-1', 'Enclosure'), 420)].map(
      toDomainBatch,
    )
    const receipts = [receipt(300, '2026-10-10')].map(toDomainReceipt)
    expect(computeLot(lot, batches, receipts, '2026-10-13')).toEqual({
      grnTotal: 300,
      balance: 200,
      completed: false,
      grnPercent: 60,
      fullGrnDate: null,
      planDelay: null,
      leadTime: null,
      rmReadyDate: null,
      flags: { overdue: false, dueSoon: false, followUp: true, blocked: true, approval: false },
      summary: 'Delayed, 11d left — RM Blocker (Factory Production)',
      rm: { producible: 420, bottleneck: 'Enclosure', percent: 84, complete: false },
    })
  })
  it('FR-11.3 reports completion, days against plan and lead time from the actual date', () => {
    const done = toDomainLot(
      lotRow({
        lotQty: 100,
        rmReadyDate: d('2026-10-01'),
        plannedDate: d('2026-10-10'),
        actualDate: d('2026-10-12'),
      }),
    )
    expect(computeLot(done, [], [], '2026-10-15')).toMatchObject({
      completed: true,
      planDelay: 2,
      leadTime: 11,
      rmReadyDate: '2026-10-01',
      summary: 'Completed (Factory Production)',
    })
  })
  it('keeps the GRN figures for when GRN is switched back on', () => {
    const lot = toDomainLot(lotRow({ lotQty: 100 }))
    const receipts = [receipt(40, '2026-10-05'), receipt(60, '2026-10-12')].map(toDomainReceipt)
    expect(computeLot(lot, [], receipts, '2026-10-15')).toMatchObject({
      completed: false,
      balance: 0,
      fullGrnDate: '2026-10-12',
    })
  })
})

describe('lotView', () => {
  it('returns dropdowns as { id, value }, dates as strings or null, and the access level', () => {
    const view = lotView(lotRow(), [], [], '2026-10-13', user('poc', 'poc-1'))
    expect(view).toMatchObject({
      id: 'lot-1',
      version: 4,
      product: { id: 'p-1', name: 'Inverter', variant: '5 kW' },
      status: { id: 'st-1', value: 'Delayed' },
      ems: null,
      components: [ref('k-1', 'Enclosure'), ref('k-2', 'PCB')],
      plannedDate: '2026-10-20',
      actualDate: null,
      completedOn: null,
      access: 'progress',
    })
  })
})
