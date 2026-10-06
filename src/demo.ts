import { dayOffset, today } from './calculations'
import type { DataSet, Lot, LookupKind } from './models'
import { stamp } from './models'

export const lookupSeeds: Record<LookupKind, string[]> = {
  segment: ['PA / TWS', 'Headphones & Neckbands', 'BT Speakers', 'Soundbars', 'Party Speakers'],
  category: ['BAU', 'NPI'],
  ems: ['Orion EMS', 'Aster Manufacturing', 'Delta Assembly'],
  poc: ['Maya Shah', 'Rohit Mehta', 'Anika Rao'],
  status: ['On Track', 'Delayed', 'Hold'],
  stage: ['RM Sourcing', 'Factory Production', 'Ready at Factory', 'PDI/QC', 'In Transit to WH'],
  blocker: [
    'None',
    'RM Blocker',
    'Quality-PDI Blocker',
    'Manpower Constraint',
    'Logistics-Customs Blocker',
    'Approval Blocker',
    'Other',
  ],
  logistics: ['Road', 'Air', 'Sea', 'Rail'],
  component: [
    'Kit (All Together)',
    'Plastic',
    'PCBA',
    'Battery',
    'Shell',
    'Packaging',
    'EVA',
    'Other',
  ],
  shipmentStage: ['In Transit', 'Reached Port', 'CFS Movement Awaited', 'Arrived at Warehouse'],
}
export function seedLookups() {
  return Object.entries(lookupSeeds).flatMap(([kind, values]) =>
    values.map((value, sort) => stamp({ kind: kind as LookupKind, value, sort })),
  )
}
export function newLot(productId: string): Lot {
  return stamp({
    productId,
    label: '',
    category: 'BAU',
    directFg: false,
    ems: '',
    poc: '',
    status: 'On Track',
    stage: 'RM Sourcing',
    rmMode: 'all' as const,
    rmComponents: [],
    readyQty: 0,
    lotQty: 0,
    freshProductionQty: 0,
    reworkQty: 0,
    reworkReason: '',
    rmReadyDate: '',
    plannedDate: '',
    revisedEta: '',
    actualDate: '',
    logisticsMode: '',
    blockerCategory: 'None',
    blockerDescription: '',
    followUpDate: '',
    followUpNote: '',
  })
}
export function demoData(): DataSet {
  const base = today(),
    D = (n: number) => dayOffset(base, n)
  const products = [
    stamp({ name: 'Auralite TWS Pro', variant: 'Midnight Black', segment: 'PA / TWS' }),
    stamp({ name: 'PulseWave Neckband', variant: 'Ocean Blue', segment: 'Headphones & Neckbands' }),
    stamp({ name: 'BoomBox Mini', variant: 'Graphite', segment: 'BT Speakers' }),
    stamp({ name: 'CinemaBar 420', variant: 'Matte Black', segment: 'Soundbars' }),
  ]
  const lot = (p: number, label: string, qty: number, extra: Partial<Lot>) => ({
    ...newLot(products[p].id),
    label,
    lotQty: qty,
    ...extra,
  })
  const lots = [
    lot(0, 'TWS-2401', 1200, {
      category: 'NPI',
      ems: 'Orion EMS',
      poc: 'Maya Shah',
      status: 'Delayed',
      stage: 'Factory Production',
      rmMode: 'components',
      rmComponents: ['Plastic', 'PCBA', 'Battery', 'Packaging'],
      freshProductionQty: 540,
      reworkQty: 40,
      reworkReason: 'Charging pin alignment',
      plannedDate: D(-2),
      revisedEta: D(2),
      blockerCategory: 'RM Blocker',
      blockerDescription: 'Battery batch pending',
      followUpDate: D(0),
      followUpNote: 'Confirm battery dispatch',
    }),
    lot(0, 'TWS-2402', 800, {
      ems: 'Orion EMS',
      poc: 'Maya Shah',
      stage: 'PDI/QC',
      readyQty: 800,
      rmReadyDate: D(-12),
      freshProductionQty: 800,
      plannedDate: D(1),
      blockerCategory: 'Quality-PDI Blocker',
      blockerDescription: 'Awaiting final acoustic sign-off',
    }),
    lot(1, 'NB-2318', 1000, {
      ems: 'Aster Manufacturing',
      poc: 'Rohit Mehta',
      stage: 'In Transit to WH',
      readyQty: 1000,
      rmReadyDate: D(-24),
      freshProductionQty: 1000,
      plannedDate: D(-6),
      actualDate: D(-3),
    }),
    lot(2, 'BB-1107', 650, {
      category: 'NPI',
      ems: 'Delta Assembly',
      poc: 'Anika Rao',
      stage: 'RM Sourcing',
      rmMode: 'components',
      rmComponents: ['Shell', 'PCBA', 'Packaging'],
      plannedDate: D(7),
      blockerCategory: 'Approval Blocker',
      blockerDescription: 'Artwork approval pending',
      followUpDate: D(1),
    }),
    lot(2, 'BB-1108', 500, {
      ems: 'Delta Assembly',
      poc: 'Anika Rao',
      stage: 'Factory Production',
      readyQty: 500,
      rmReadyDate: D(-4),
      freshProductionQty: 220,
      plannedDate: D(5),
    }),
    lot(3, 'SB-0804', 400, {
      ems: 'Aster Manufacturing',
      poc: 'Rohit Mehta',
      stage: 'Ready at Factory',
      readyQty: 400,
      rmReadyDate: D(-20),
      freshProductionQty: 400,
      plannedDate: D(-8),
      blockerCategory: 'None',
    }),
  ]
  const grnReceipts = [
    stamp({
      lotId: lots[0].id,
      label: 'First dock receipt',
      date: D(-1),
      quantity: 200,
      note: 'Partial cartons cleared',
    }),
    stamp({ lotId: lots[1].id, label: 'PDI cleared units', date: D(-1), quantity: 240, note: '' }),
    stamp({ lotId: lots[2].id, label: 'Dock 1', date: D(-4), quantity: 600, note: '' }),
    stamp({ lotId: lots[2].id, label: 'Dock 2', date: D(-3), quantity: 400, note: 'Full GRN' }),
    stamp({ lotId: lots[5].id, label: 'Warehouse receipt', date: D(-7), quantity: 400, note: '' }),
  ]
  const rmBatches = [
    ...[
      ['Plastic', 1200],
      ['PCBA', 1100],
      ['Battery', 600],
      ['Packaging', 1200],
    ].map(([component, receivedQty]) =>
      stamp({
        lotId: lots[0].id,
        component: String(component),
        label: `${component}-A`,
        plannedQty: 1200,
        plannedDate: D(-7),
        receivedQty: Number(receivedQty),
        receivedDate: D(-4),
        status: 'Partial',
        notes: '',
      }),
    ),
    ...[
      ['Shell', 650],
      ['PCBA', 300],
      ['Packaging', 500],
    ].map(([component, receivedQty]) =>
      stamp({
        lotId: lots[3].id,
        component: String(component),
        label: `${component}-B`,
        plannedQty: 650,
        plannedDate: D(2),
        receivedQty: Number(receivedQty),
        receivedDate: D(-1),
        status: 'Partial',
        notes: '',
      }),
    ),
  ]
  const shipments = [
    stamp({
      number: 'INV-SEA-1048',
      vessel: 'MV Pacific Star',
      etd: D(-10),
      plannedEta: D(2),
      revisedEta: D(4),
      actualArrival: '',
      stage: 'In Transit',
      remarks: 'Customs papers submitted',
    }),
    stamp({
      number: 'INV-SEA-1052',
      vessel: 'MV Horizon Bay',
      etd: D(-18),
      plannedEta: D(-2),
      revisedEta: '',
      actualArrival: '',
      stage: 'Reached Port',
      remarks: 'CFS slot awaited',
    }),
    stamp({
      number: 'INV-AIR-0987',
      vessel: 'Air cargo AC274',
      etd: D(-6),
      plannedEta: D(-1),
      revisedEta: D(0),
      actualArrival: D(0),
      stage: 'Arrived at Warehouse',
      remarks: 'Received at WH',
    }),
  ]
  const shipmentItems = [
    stamp({ shipmentId: shipments[0].id, productId: products[0].id, quantity: 600 }),
    stamp({ shipmentId: shipments[0].id, productId: products[2].id, quantity: 350 }),
    stamp({ shipmentId: shipments[1].id, productId: products[1].id, quantity: 500 }),
    stamp({ shipmentId: shipments[2].id, productId: products[3].id, quantity: 300 }),
  ]
  const etaRevisions = [
    stamp({
      shipmentId: shipments[0].id,
      previousDate: D(2),
      newDate: D(4),
      reason: 'Port congestion',
    }),
    stamp({
      shipmentId: shipments[2].id,
      previousDate: D(-1),
      newDate: D(0),
      reason: 'Air cargo rescheduled',
    }),
  ]
  return {
    products,
    lots,
    rmBatches,
    grnReceipts,
    shipments,
    shipmentItems,
    etaRevisions,
    activityLogs: [],
    lookupValues: seedLookups(),
    settings: [stamp({ key: 'initialized', value: 'demo' })],
  }
}
