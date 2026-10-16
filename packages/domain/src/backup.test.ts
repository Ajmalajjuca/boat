import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BACKUP_APP, BackupError, parseImport, validateRelations } from './backup'
import type { DataSet } from './models'

const at = '2026-10-06T09:01:26.470Z'
const row = (id: string, fields: object) => ({ id, createdAt: at, updatedAt: at, ...fields })
const lookups: [string, string][] = [
  ['segment', 'Audio'],
  ['category', 'BAU'],
  ['status', 'On Track'],
  ['stage', 'RM Sourcing'],
  ['blocker', 'None'],
  ['component', 'PCB'],
  ['component', 'Kit (All Together)'],
  ['shipmentStage', 'At Sea'],
]

// A small backup that passes every check. Each failing case changes one thing.
function backup() {
  return {
    app: BACKUP_APP,
    schemaVersion: 1,
    exportedAt: at,
    data: {
      products: [row('p1', { name: 'Speaker', variant: '', segment: 'Audio' })],
      lots: [
        row('l1', {
          productId: 'p1',
          label: 'Lot 1',
          category: 'BAU',
          directFg: false,
          ems: '',
          poc: '',
          status: 'On Track',
          stage: 'RM Sourcing',
          rmMode: 'components',
          rmComponents: ['PCB'],
          readyQty: 0,
          lotQty: 100,
          freshProductionQty: 10,
          reworkQty: 0,
          reworkReason: '',
          rmReadyDate: '',
          plannedDate: '2026-10-05',
          revisedEta: '',
          actualDate: '',
          logisticsMode: '',
          blockerCategory: 'None',
          blockerDescription: '',
          followUpDate: '',
          followUpNote: '',
        }),
      ],
      rmBatches: [
        row('b1', {
          lotId: 'l1',
          component: 'PCB',
          label: 'B1',
          plannedQty: 100,
          plannedDate: '',
          receivedQty: 50,
          receivedDate: '2026-10-02',
          status: '',
          notes: '',
        }),
      ],
      grnReceipts: [
        row('g1', { lotId: 'l1', label: 'G1', date: '2026-10-04', quantity: 40, note: '' }),
      ],
      shipments: [
        row('s1', {
          number: 'INV-1',
          vessel: 'MSC',
          etd: '2026-09-26',
          plannedEta: '2026-10-04',
          revisedEta: '2026-10-09',
          actualArrival: '',
          stage: 'At Sea',
          remarks: '',
        }),
      ],
      shipmentItems: [row('i1', { shipmentId: 's1', productId: 'p1', quantity: 10 })],
      etaRevisions: [
        row('e1', {
          shipmentId: 's1',
          previousDate: '2026-10-04',
          newDate: '2026-10-09',
          reason: 'Port',
        }),
      ],
      activityLogs: [
        row('a1', { entityType: 'lot', entityId: 'l1', message: 'Note', kind: 'note' }),
      ],
      lookupValues: lookups.map(([kind, value], i) => row(`v${i}`, { kind, value, sort: i })),
      settings: [row('st1', { key: 'initialized', value: 'demo' })],
    },
  }
}
type Raw = ReturnType<typeof backup>
type Rows = Record<string, Record<string, unknown>[]>
const changed = (change: (data: Rows, raw: Raw) => void) => {
  const raw = backup()
  change(raw.data as unknown as Rows, raw)
  return raw
}
const message = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    if (e instanceof BackupError) return e.message
    throw e
  }
  return 'no error'
}
const checkAll = (raw: unknown) => validateRelations(parseImport(raw))

describe('parseImport and validateRelations', () => {
  it('accept the sample backup the demo produced', () => {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../docs/sample-test-backup.json',
    )
    const data: DataSet = parseImport(JSON.parse(readFileSync(file, 'utf8')))
    expect(data.lots).toHaveLength(4)
    expect(() => validateRelations(data)).not.toThrow()
  })
  it('accept the minimal backup', () => {
    expect(() => checkAll(backup())).not.toThrow()
  })
})

describe('parseImport', () => {
  it.each<[string, (d: Rows, raw: Raw) => void, string]>([
    ['another app', (_d, raw) => (raw.app = 'Other'), 'Unsupported JSON backup or schema version.'],
    [
      'another schema',
      (_d, raw) => (raw.schemaVersion = 2),
      'Unsupported JSON backup or schema version.',
    ],
    ['a missing table', (d) => delete d.lots, 'Missing lots records.'],
    ['a bad id', (d) => (d.products[0].id = ' '), 'Invalid products record ID or timestamps.'],
    [
      'a bad timestamp',
      (d) => (d.products[0].createdAt = 'yesterday'),
      'Invalid products record ID or timestamps.',
    ],
    ['a duplicate id', (d) => (d.lots[0].id = 'p1'), 'Duplicate record ID p1.'],
    ['a missing string', (d) => delete d.products[0].name, 'Invalid products.name.'],
    ['a non-string actor', (d) => (d.activityLogs[0].actor = 7), 'Invalid activityLogs.actor.'],
    ['a negative number', (d) => (d.lots[0].lotQty = -1), 'Invalid lots.lotQty.'],
    ['a fraction', (d) => (d.grnReceipts[0].quantity = 1.5), 'Invalid grnReceipts.quantity.'],
    ['a number too large', (d) => (d.lots[0].lotQty = 1_000_000_001), 'Invalid lots.lotQty.'],
    ['a bad boolean', (d) => (d.lots[0].directFg = 'no'), 'Invalid lots.directFg.'],
    ['a bad array', (d) => (d.lots[0].rmComponents = [1]), 'Invalid lots.rmComponents.'],
    [
      'a date that does not exist',
      (d) => (d.lots[0].plannedDate = '2026-02-30'),
      'Invalid lots.plannedDate.',
    ],
    ['a NUL character', (d) => (d.lots[0].label = 'Lot\u00001'), 'Invalid lots.label.'],
    [
      'a year before 1900',
      (d) => (d.lots[0].plannedDate = '0000-01-01'),
      'Invalid lots.plannedDate.',
    ],
    [
      'a timestamp out of range',
      (d) => (d.products[0].createdAt = '-271821-04-20T00:00:00Z'),
      'Invalid products record ID or timestamps.',
    ],
    [
      'a NUL in a list',
      (d) => (d.lots[0].rmComponents = ['P\u0000']),
      'Invalid lots.rmComponents.',
    ],
    [
      'no initialization record',
      (d) => (d.settings = []),
      'Backup is missing its initialization record.',
    ],
    [
      'a duplicate dropdown value in another case',
      (d) => d.lookupValues.push(row('vx', { kind: 'segment', value: 'AUDIO', sort: 9 })),
      'Backup has duplicate dropdown values.',
    ],
    [
      'a duplicate setting key',
      (d) => d.settings.push(row('st2', { key: 'initialized', value: 'x' })),
      'Backup has duplicate setting keys.',
    ],
  ])('refuses %s', (_name, change, expected) => {
    expect(message(() => parseImport(changed(change)))).toBe(expected)
  })
  it('refuses something that is not a backup at all', () => {
    expect(message(() => parseImport(null))).toBe('Unsupported JSON backup or schema version.')
    expect(message(() => parseImport({ ...backup(), data: [] }))).toBe(
      'Unsupported JSON backup or schema version.',
    )
  })
})

describe('validateRelations', () => {
  it.each<[string, (d: Rows) => void, string]>([
    ['an id used in two tables', (d) => (d.shipments[0].id = 'v1'), 'Duplicate record ID v1.'],
    [
      'an unknown dropdown kind',
      (d) => (d.lookupValues[0].kind = 'colour'),
      'A dropdown value has an invalid kind or blank label.',
    ],
    [
      'a product without a name',
      (d) => (d.products[0].name = ' '),
      'A product is missing its name or segment.',
    ],
    [
      'a product with an unknown segment',
      (d) => (d.products[0].segment = 'Video'),
      'Product Speaker references a missing segment.',
    ],
    [
      'a lot without its product',
      (d) => (d.lots[0].productId = 'p9'),
      'Lot Lot 1 has a missing product.',
    ],
    [
      'a lot with an unknown status',
      (d) => (d.lots[0].status = 'Late'),
      'Lot Lot 1 references a missing dropdown value.',
    ],
    [
      'a lot without a stage',
      (d) => (d.lots[0].stage = ''),
      'Lot Lot 1 is missing its category, status or stage.',
    ],
    [
      'rework above production',
      (d) => Object.assign(d.lots[0], { freshProductionQty: 1, reworkQty: 2 }),
      'Lot Lot 1 has rework above production.',
    ],
    ['an unknown RM mode', (d) => (d.lots[0].rmMode = 'some'), 'Lot Lot 1 has an invalid RM mode.'],
    [
      'a blank component',
      (d) => (d.lots[0].rmComponents = ['']),
      'Lot Lot 1 lists a blank or repeated component.',
    ],
    [
      'a component repeated in another case',
      (d) => (d.lots[0].rmComponents = ['PCB', 'pcb']),
      'Lot Lot 1 lists a blank or repeated component.',
    ],
    [
      'a batch without a component',
      (d) => (d.rmBatches[0].component = ''),
      'An RM batch has a missing lot or component.',
    ],
    [
      'the kit among components',
      (d) => (d.lots[0].rmComponents = ['Kit (All Together)']),
      'Lot Lot 1 mixes kit and components.',
    ],
    [
      'a receipt without its lot',
      (d) => (d.grnReceipts[0].lotId = 'l9'),
      'A GRN receipt has a missing lot or invalid receipt fields.',
    ],
    [
      'a batch with an unknown component',
      (d) => (d.rmBatches[0].component = 'Glass'),
      'An RM batch has a missing lot or component.',
    ],
    [
      'GRN above the lot quantity',
      (d) => (d.grnReceipts[0].quantity = 101),
      'GRN exceeds lot quantity for Lot 1.',
    ],
    [
      'a shipment without a number',
      (d) => (d.shipments[0].number = ''),
      'A shipment is missing its invoice number, vessel, or valid stage.',
    ],
    [
      'a line without its product',
      (d) => (d.shipmentItems[0].productId = 'p9'),
      'A shipment line has a missing shipment, product, or positive quantity.',
    ],
    [
      'a revision without its shipment',
      (d) => (d.etaRevisions[0].shipmentId = 's9'),
      'An ETA revision has a missing shipment.',
    ],
    [
      'history without its record',
      (d) => (d.activityLogs[0].entityId = 'l9'),
      'An activity record has a missing parent or invalid type.',
    ],
    [
      'an ETA before the ETD',
      (d) => (d.shipments[0].plannedEta = '2026-09-20'),
      'Shipment INV-1 has an ETA or arrival before its ETD.',
    ],
    [
      'two products whose names differ only in case',
      (d) => d.products.push(row('p2', { name: 'SPEAKER', variant: '', segment: 'Audio' })),
      'Product SPEAKER duplicates another product name and variant.',
    ],
    [
      'two lots of a product with the same label in another case',
      (d) => d.lots.push({ ...d.lots[0], id: 'l2', label: 'LOT 1', rmComponents: [] }),
      'Lot LOT 1 duplicates another lot label on its product.',
    ],
    [
      'two shipments with one number',
      (d) => d.shipments.push({ ...d.shipments[0], id: 's2', number: 'inv-1' }),
      'Shipment inv-1 duplicates another shipment number.',
    ],
    [
      'a product twice on one shipment',
      (d) => d.shipmentItems.push(row('i2', { shipmentId: 's1', productId: 'p1', quantity: 1 })),
      'Shipment INV-1 lists a product on more than one line.',
    ],
  ])('refuses %s', (_name, change, expected) => {
    expect(message(() => checkAll(changed(change)))).toBe(expected)
  })
  it('allows the same text under two kinds', () => {
    expect(() =>
      checkAll(
        changed((d) => d.lookupValues.push(row('vy', { kind: 'poc', value: 'Audio', sort: 1 }))),
      ),
    ).not.toThrow()
  })
})
