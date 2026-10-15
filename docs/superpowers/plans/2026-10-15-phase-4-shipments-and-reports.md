# Phase 4: Shipments and Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API takes over the demo's remaining records and data tools. That covers finished-goods shipments (product lines, ETA revision history, notes), the month-end summary, CSV exports, and JSON export, import (merge or replace) and reset. `docs/sample-test-backup.json` imports, and its month-end figures match the demo's.

**Architecture:** A `shipments` module follows Phase 3's pattern. It locks the shipment row, checks the version, resolves references, runs the shared `validateShipment`, writes the shipment, its lines and ETA revisions, and records history in one transaction. A `reports` module builds the month-end summary with the domain's `monthSummary` over lots and receipts selected in SQL. A `data-transfer` module exports the database in the demo's backup format and imports it back. The demo's backup validation moves into `@boat/domain/backup`, so the browser and the server check a backup by the same rules.

**Tech Stack:** As in Phase 3. No new dependencies.

**Spec:** [Supply Chain App — Backend PRD & Architecture](https://claude.ai/code/artifact/313da010-aa6a-4a87-be4b-2c401635a8cd) (rev 56). Sections: FR-5, FR-6 and FR-9, "REST API design" (shipments, reports and data endpoints), "Business rules and calculations on the server" (ETA revision history, month-end summary), "Migration and rollout phases" ("Mapping existing browser data") and "Testing strategy" (the import contract test). Read the roadmap first, including "Where Phase 4 departs from the PRD": [2026-10-14-fullstack-roadmap.md](2026-10-14-fullstack-roadmap.md). The demo's behaviour is the reference where the PRD is silent: `apps/web/src/repository.ts` (`saveShipment`, `deleteShipment`, `parseImport`, `validateRelations`, `importData`, `exportData`, `resetData`), `apps/web/src/Shipments.tsx` and `apps/web/src/MonthEnd.tsx`.

## Global Constraints

- Everything in the Phase 1–3 Global Constraints still holds: dates, `<field>Id` dropdowns in and `{ id, value }` out, quantities from 0 to 1,000,000,000, versions on `PATCH`, soft delete, the company date through `Clock`, history in the same transaction, `FR-x.y` test titles, and no change to `apps/web` behaviour.
- No new dependencies.
- The backup format stays the demo's: `{ app: 'Supply Chain Control Tower', schemaVersion: 1, exportedAt, data: { products, lots, rmBatches, grnReceipts, shipments, shipmentItems, etaRevisions, activityLogs, lookupValues, settings } }`, with dropdowns as text and empty dates as `''`. A server export must import into the demo, and a demo backup into the server.
- Import accepts bodies up to 20 MB on `POST /data/import` only. Every other route keeps the 1 MB limit.
- An import or reset either completes or changes nothing: one transaction, and imports and resets run one at a time.
- A text value containing a NUL character (`\u0000`) is a 422, never a 500.
- Reset needs the typed phrase `RESET ALL DATA`.
- Branch `phase-4-shipments-and-reports` from `dev`; it merges back into `dev`.

## Review Focus

1. **Restoring the same backup after a replace.** "Replace" soft-deletes the current records, so their ids still exist. Importing a backup that contains those records again, which is the normal restore, would hit primary-key conflicts. Those rows must come back, overwritten from the backup. Pinned in Task 7.
2. **A backup that breaks rules the demo never checked.** An ETA before the ETD, two products whose names differ only in case, a quantity above 1,000,000,000, or a NUL character would pass the demo's checks and then fail in Postgres with a 500. Each must be a 422 naming the record. Pinned in Tasks 2 and 7.
3. **Dropdown text that differs only in case.** A backup's "on track" against the database's "On Track" must reuse the existing value, not trip the case-insensitive unique index. Pinned in Task 7.
4. **The round trip.** Export, then replace-import, then export again must give the same data, including history, ETA revisions and component choices. Pinned in Task 8.
5. **An ETA going from unset to set, or back.** Revision rows and history must say "Not set" rather than writing a null or skipping the change. Pinned in Task 3.

Also covered: receipts dated after the month end (Task 5), a shipment line for a deleted product (Task 3), and a stale shipment version (Task 3).

---

## File Structure

```
packages/domain/src/
├─ backup.ts                               # SCHEMA_VERSION, BACKUP_APP, BackupError, parseImport, validateRelations
└─ backup.test.ts
apps/web/src/
├─ db.ts                                   # SCHEMA_VERSION re-exported from @boat/domain/backup
└─ repository.ts                           # parseImport/validateRelations imported from @boat/domain/backup
apps/api/
├─ prisma/migrations/20261015130000_system_lookup_keys/   # key pre-existing same-text values
├─ src/
│  ├─ app.ts                               # 1 MB JSON everywhere except POST /api/v1/data/import
│  ├─ core/parse.ts                        # refuses NUL characters
│  └─ modules/
│     ├─ activity/activity.service.ts      # entityActivity(db, type, id, page) shared by lots and shipments
│     ├─ shipments/
│     │  ├─ shipment-view.ts               # rows → domain shapes, computed fields, detail
│     │  ├─ shipments.service.ts           # create, update (lines, ETA revisions), delete, list, summary, CSV, notes
│     │  └─ shipments.router.ts
│     ├─ reports/
│     │  ├─ month-end.service.ts           # monthEndReport, monthEndCsv
│     │  └─ reports.router.ts
│     └─ data-transfer/
│        ├─ backup-mapping.ts              # database → DataSet (export and the import's current state)
│        ├─ export.service.ts              # exportBackup
│        ├─ import.service.ts              # importBackup(merge | replace)
│        ├─ reset.service.ts               # resetData
│        └─ data.router.ts
└─ test/
   ├─ system-lookup-keys.int.test.ts
   ├─ shipments.int.test.ts
   ├─ shipments-list.int.test.ts
   ├─ month-end.int.test.ts
   ├─ data-export.int.test.ts
   ├─ data-import.int.test.ts
   └─ sample-backup.int.test.ts            # the Phase 4 gate
```

---

### Task 1: Input hygiene: NUL characters and keys for pre-existing system values

Two leftovers from the Phase 3 review that Phase 4 depends on. Postgres can't store `\u0000`, so a pasted NUL anywhere turned into a 500; `parseInput` now refuses it centrally. And the `system_lookups` migration skipped values whose text already existed without giving them their `system_key`. Imports now link backup values to system rows by key, so a later migration fills in the missing keys.

**Files:**
- Modify: `apps/api/src/core/parse.ts`, `apps/api/src/core/parse.test.ts`
- Create: `apps/api/prisma/migrations/20261015130000_system_lookup_keys/migration.sql`
- Modify: `apps/api/test/lots-list.int.test.ts`
- Test: `apps/api/test/system-lookup-keys.int.test.ts`

**Interfaces:**
- Consumes: `parseInput` from Phase 2; `createTestDatabase` and `makeLookup` from the test support.
- Produces: `parseInput` refuses any string containing `\u0000`, at any depth, with `{ [path]: 'Remove the hidden NUL character from this text.' }`.

- [ ] **Step 1: Create the branch**

```bash
git switch dev && git pull --ff-only
git switch -c phase-4-shipments-and-reports
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/src/core/parse.test.ts`:

```ts
describe('NUL characters', () => {
  const nested = z.object({
    name: z.string(),
    items: z.array(z.object({ label: z.string() })),
  })
  it('are refused wherever they appear, naming the field', () => {
    expect(fieldsOf(() => parseInput(schema, { name: 'a\u0000b', qty: 1 }))).toEqual({
      name: 'Remove the hidden NUL character from this text.',
    })
    expect(
      fieldsOf(() => parseInput(nested, { name: 'ok', items: [{ label: 'x' }, { label: '\u0000' }] })),
    ).toEqual({ 'items.1.label': 'Remove the hidden NUL character from this text.' })
  })
  it('leave other control characters to the schema', () => {
    expect(parseInput(schema, { name: 'tab\there', qty: 1 })).toEqual({ name: 'tab\there', qty: 1 })
  })
})
```

In `apps/api/test/lots-list.int.test.ts`, add inside `describe('the list', …)`:

```ts
  it('answers a NUL character in the search with a field error, not a 500', async () => {
    const res = await w.viewer.agent.get('/api/v1/lots?q=a%00b')
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ q: 'Remove the hidden NUL character from this text.' })
  })
```

Create `apps/api/test/system-lookup-keys.int.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'

const migration = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../prisma/migrations/20261015130000_system_lookup_keys/migration.sql',
  ),
  'utf8',
)

let db: PrismaClient
let close: () => Promise<void>
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
})
afterAll(() => close())

describe('the system_lookup_keys migration', () => {
  it('gives a pre-existing same-text value its system key', async () => {
    // As if "Delayed" had been there before system_lookups ran, so that migration skipped it.
    await db.lookupValue.updateMany({ where: { systemKey: 'delayed' }, data: { systemKey: null } })
    await db.$executeRawUnsafe(migration)
    const delayed = await db.lookupValue.findFirstOrThrow({ where: { kind: 'status', value: 'Delayed' } })
    expect(delayed.systemKey).toBe('delayed')
  })
  it('changes nothing when every system value already has its key', async () => {
    const before = await db.lookupValue.findMany({ orderBy: { id: 'asc' } })
    await db.$executeRawUnsafe(migration)
    expect(await db.lookupValue.findMany({ orderBy: { id: 'asc' } })).toEqual(before)
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test -- src/core/parse.test.ts`
Expected: FAIL. The NUL strings are accepted.

Run: `pnpm --filter @boat/api test:int -- test/system-lookup-keys.int.test.ts test/lots-list.int.test.ts`
Expected: FAIL. The migration file doesn't exist, and the NUL search answers 500.

- [ ] **Step 4: Refuse NUL characters**

In `apps/api/src/core/parse.ts`, add above `parseInput`:

```ts
// Postgres text can't hold \u0000, so a pasted NUL would fail the query with a 500. Any string,
// at any depth of a body or query, is checked before the schema runs.
function nulPath(value: unknown, path: string[] = []): string[] | undefined {
  if (typeof value === 'string') return value.includes('\u0000') ? path : undefined
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = nulPath(item, [...path, String(i)])
      if (found) return found
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const found = nulPath(item, [...path, key])
      if (found) return found
    }
  }
  return undefined
}
```

and make `parseInput` start with:

```ts
  const nul = nulPath(value)
  if (nul) throw new ValidationError({ [nul.join('.') || 'form']: 'Remove the hidden NUL character from this text.' })
```

- [ ] **Step 5: Write the migration**

Create `apps/api/prisma/migrations/20261015130000_system_lookup_keys/migration.sql`:

```sql
-- system_lookups skipped a value whose text already existed but never gave that row its key.
-- Code finds system values by key, so fill it in, unless another active row already has it.
UPDATE lookup_values l
SET system_key = v.system_key
FROM (VALUES
  ('status', 'On Track', 'on_track'),
  ('status', 'Delayed', 'delayed'),
  ('status', 'Hold', 'hold'),
  ('blocker', 'None', 'none'),
  ('blocker', 'Approval Blocker', 'approval_blocker'),
  ('category', 'BAU', 'bau')
) AS v(kind, value, system_key)
WHERE l.kind = v.kind::"LookupKind"
  AND lower(l.value::text) = lower(v.value)
  AND l.system_key IS NULL
  AND l.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM lookup_values k
    WHERE k.kind = l.kind AND k.system_key = v.system_key AND k.deleted_at IS NULL
  );
```

- [ ] **Step 6: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 7: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Refuse NUL characters and key pre-existing system values

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Backup validation in `@boat/domain`, with the database's rules added

The demo's `parseImport` and `validateRelations` move from `apps/web/src/repository.ts` into `packages/domain/src/backup.ts`. The browser and the server then check backups by one set of rules. The move adds the rules the database enforces but the demo never checked:
- a NUL character in any text,
- quantities above 1,000,000,000,
- ETAs or arrival before the ETD,
- a lot without a category, status or stage,
- names unique ignoring case (products, lot labels per product, shipment numbers, dropdown values),
- each product once per shipment.

Errors are `BackupError` so the server can tell a bad file from a bug. The web app keeps working: it imports the same functions, and a backup that passed before still passes unless it would have broken the database.

**Files:**
- Create: `packages/domain/src/backup.ts`, `packages/domain/src/backup.test.ts`
- Modify: `packages/domain/package.json` (export `./backup`)
- Modify: `apps/web/src/repository.ts`, `apps/web/src/db.ts`

**Interfaces:**
- Consumes: `DataSet`, `dataKeys`, `LookupKind` from `@boat/domain/models`; `totalGrn` from `@boat/domain/calculations`.
- Produces:
  - `BACKUP_APP = 'Supply Chain Control Tower'`, `SCHEMA_VERSION = 1`
  - `class BackupError extends Error`
  - `type Backup = { app: string; schemaVersion: number; exportedAt: string; data: DataSet }`
  - `parseImport(raw: unknown): DataSet` and `validateRelations(data: DataSet): void`, both throwing `BackupError`

- [ ] **Step 1: Write the failing tests**

In `packages/domain/package.json`, add to `exports`:

```json
    "./backup": "./src/backup.ts",
```

Create `packages/domain/src/backup.test.ts`:

```ts
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
      grnReceipts: [row('g1', { lotId: 'l1', label: 'G1', date: '2026-10-04', quantity: 40, note: '' })],
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
        row('e1', { shipmentId: 's1', previousDate: '2026-10-04', newDate: '2026-10-09', reason: 'Port' }),
      ],
      activityLogs: [row('a1', { entityType: 'lot', entityId: 'l1', message: 'Note', kind: 'note' })],
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
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/sample-test-backup.json')
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
    ['another schema', (_d, raw) => (raw.schemaVersion = 2), 'Unsupported JSON backup or schema version.'],
    ['a missing table', (d) => delete d.lots, 'Missing lots records.'],
    ['a bad id', (d) => (d.products[0].id = ' '), 'Invalid products record ID or timestamps.'],
    ['a bad timestamp', (d) => (d.products[0].createdAt = 'yesterday'), 'Invalid products record ID or timestamps.'],
    ['a duplicate id', (d) => (d.lots[0].id = 'p1'), 'Duplicate record ID p1.'],
    ['a missing string', (d) => delete d.products[0].name, 'Invalid products.name.'],
    ['a non-string actor', (d) => (d.activityLogs[0].actor = 7), 'Invalid activityLogs.actor.'],
    ['a negative number', (d) => (d.lots[0].lotQty = -1), 'Invalid lots.lotQty.'],
    ['a fraction', (d) => (d.grnReceipts[0].quantity = 1.5), 'Invalid grnReceipts.quantity.'],
    ['a number too large', (d) => (d.lots[0].lotQty = 1_000_000_001), 'Invalid lots.lotQty.'],
    ['a bad boolean', (d) => (d.lots[0].directFg = 'no'), 'Invalid lots.directFg.'],
    ['a bad array', (d) => (d.lots[0].rmComponents = [1]), 'Invalid lots.rmComponents.'],
    ['a date that does not exist', (d) => (d.lots[0].plannedDate = '2026-02-30'), 'Invalid lots.plannedDate.'],
    ['a NUL character', (d) => (d.lots[0].label = 'Lot\u00001'), 'Invalid lots.label.'],
    ['a NUL in a list', (d) => (d.lots[0].rmComponents = ['P\u0000']), 'Invalid lots.rmComponents.'],
    ['no initialization record', (d) => (d.settings = []), 'Backup is missing its initialization record.'],
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
    expect(message(() => parseImport({ ...backup(), data: [] }))).toBe('Unsupported JSON backup or schema version.')
  })
})

describe('validateRelations', () => {
  it.each<[string, (d: Rows) => void, string]>([
    ['an id used in two tables', (d) => (d.shipments[0].id = 'v1'), 'Duplicate record ID v1.'],
    ['an unknown dropdown kind', (d) => (d.lookupValues[0].kind = 'colour'), 'A dropdown value has an invalid kind or blank label.'],
    ['a product without a name', (d) => (d.products[0].name = ' '), 'A product is missing its name or segment.'],
    ['a product with an unknown segment', (d) => (d.products[0].segment = 'Video'), 'Product Speaker references a missing segment.'],
    ['a lot without its product', (d) => (d.lots[0].productId = 'p9'), 'Lot Lot 1 has a missing product.'],
    ['a lot with an unknown status', (d) => (d.lots[0].status = 'Late'), 'Lot Lot 1 references a missing dropdown value.'],
    ['a lot without a stage', (d) => (d.lots[0].stage = ''), 'Lot Lot 1 is missing its category, status or stage.'],
    [
      'rework above production',
      (d) => Object.assign(d.lots[0], { freshProductionQty: 1, reworkQty: 2 }),
      'Lot Lot 1 has rework above production.',
    ],
    ['an unknown RM mode', (d) => (d.lots[0].rmMode = 'some'), 'Lot Lot 1 has an invalid RM mode.'],
    ['the kit among components', (d) => (d.lots[0].rmComponents = ['Kit (All Together)']), 'Lot Lot 1 mixes kit and components.'],
    ['a receipt without its lot', (d) => (d.grnReceipts[0].lotId = 'l9'), 'A GRN receipt has a missing lot or invalid receipt fields.'],
    ['a batch with an unknown component', (d) => (d.rmBatches[0].component = 'Glass'), 'An RM batch has a missing lot or component.'],
    ['GRN above the lot quantity', (d) => (d.grnReceipts[0].quantity = 101), 'GRN exceeds lot quantity for Lot 1.'],
    ['a shipment without a number', (d) => (d.shipments[0].number = ''), 'A shipment is missing its invoice number, vessel, or valid stage.'],
    ['a line without its product', (d) => (d.shipmentItems[0].productId = 'p9'), 'A shipment line has a missing shipment, product, or positive quantity.'],
    ['a revision without its shipment', (d) => (d.etaRevisions[0].shipmentId = 's9'), 'An ETA revision has a missing shipment.'],
    ['history without its record', (d) => (d.activityLogs[0].entityId = 'l9'), 'An activity record has a missing parent or invalid type.'],
    ['an ETA before the ETD', (d) => (d.shipments[0].plannedEta = '2026-09-20'), 'Shipment INV-1 has an ETA or arrival before its ETD.'],
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
      checkAll(changed((d) => d.lookupValues.push(row('vy', { kind: 'poc', value: 'Audio', sort: 1 })))),
    ).not.toThrow()
  })
})
```

Run: `pnpm --filter @boat/domain test -- src/backup.test.ts`
Expected: FAIL. `./backup` doesn't exist.

- [ ] **Step 2: Implement the backup module**

Create `packages/domain/src/backup.ts`:

```ts
import { totalGrn } from './calculations'
import { type DataSet, dataKeys, type LookupKind } from './models'

export const BACKUP_APP = 'Supply Chain Control Tower'
export const SCHEMA_VERSION = 1
export type Backup = { app: string; schemaVersion: number; exportedAt: string; data: DataSet }

// A backup that can't be imported. The message names the problem and, where it can, the record.
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}
// A declaration (not an arrow) so TypeScript narrows types after a call.
function fail(message: string): never {
  throw new BackupError(message)
}

const maxQuantity = 1_000_000_000
const isObject = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)
// Postgres text can't hold NUL, so a backup carrying one is refused as invalid text.
const isText = (x: unknown): x is string => typeof x === 'string' && !x.includes('\u0000')
const isDate = (s: string) =>
  !s ||
  (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
    new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s)
const folded = (s: string) => s.trim().toLowerCase()

const fields: Record<
  keyof DataSet,
  {
    strings: string[]
    optionalStrings?: string[]
    numbers?: string[]
    dates?: string[]
    booleans?: string[]
    arrays?: string[]
  }
> = {
  products: { strings: ['name', 'variant', 'segment'] },
  lots: {
    strings: [
      'productId',
      'label',
      'category',
      'ems',
      'poc',
      'status',
      'stage',
      'rmMode',
      'reworkReason',
      'rmReadyDate',
      'plannedDate',
      'revisedEta',
      'actualDate',
      'logisticsMode',
      'blockerCategory',
      'blockerDescription',
      'followUpDate',
      'followUpNote',
    ],
    numbers: ['readyQty', 'lotQty', 'freshProductionQty', 'reworkQty'],
    dates: ['rmReadyDate', 'plannedDate', 'revisedEta', 'actualDate', 'followUpDate'],
    booleans: ['directFg'],
    arrays: ['rmComponents'],
  },
  rmBatches: {
    strings: ['lotId', 'component', 'label', 'plannedDate', 'receivedDate', 'status', 'notes'],
    numbers: ['plannedQty', 'receivedQty'],
    dates: ['plannedDate', 'receivedDate'],
  },
  grnReceipts: {
    strings: ['lotId', 'label', 'date', 'note'],
    numbers: ['quantity'],
    dates: ['date'],
  },
  shipments: {
    strings: ['number', 'vessel', 'etd', 'plannedEta', 'revisedEta', 'actualArrival', 'stage', 'remarks'],
    dates: ['etd', 'plannedEta', 'revisedEta', 'actualArrival'],
  },
  shipmentItems: { strings: ['shipmentId', 'productId'], numbers: ['quantity'] },
  etaRevisions: {
    strings: ['shipmentId', 'previousDate', 'newDate', 'reason'],
    dates: ['previousDate', 'newDate'],
  },
  activityLogs: {
    strings: ['entityType', 'entityId', 'message', 'kind'],
    optionalStrings: ['actor'],
  },
  lookupValues: { strings: ['kind', 'value'], numbers: ['sort'] },
  settings: { strings: ['key', 'value'] },
}

// The demo's backup checks (apps/web repository.ts until Phase 4), shared by browser and server.
export function parseImport(raw: unknown): DataSet {
  if (
    !isObject(raw) ||
    raw.schemaVersion !== SCHEMA_VERSION ||
    raw.app !== BACKUP_APP ||
    typeof raw.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.exportedAt)) ||
    !isObject(raw.data)
  )
    fail('Unsupported JSON backup or schema version.')
  const source = (raw as { data: Record<string, unknown> }).data
  const ids = new Set<string>()
  const data = {} as DataSet
  for (const key of dataKeys) {
    const rows = source[key]
    if (!Array.isArray(rows)) fail(`Missing ${key} records.`)
    for (const row of rows as unknown[]) {
      if (
        !isObject(row) ||
        !isText(row.id) ||
        !row.id.trim() ||
        typeof row.createdAt !== 'string' ||
        typeof row.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.createdAt)) ||
        !Number.isFinite(Date.parse(row.updatedAt))
      )
        fail(`Invalid ${key} record ID or timestamps.`)
      const r = row as Record<string, unknown>
      const id = r.id as string
      if (ids.has(id)) fail(`Duplicate record ID ${id}.`)
      ids.add(id)
      const spec = fields[key]
      for (const name of spec.strings) if (!isText(r[name])) fail(`Invalid ${key}.${name}.`)
      for (const name of spec.optionalStrings || [])
        if (r[name] !== undefined && !isText(r[name])) fail(`Invalid ${key}.${name}.`)
      for (const name of spec.numbers || [])
        if (!Number.isInteger(r[name]) || Number(r[name]) < 0 || Number(r[name]) > maxQuantity)
          fail(`Invalid ${key}.${name}.`)
      for (const name of spec.booleans || [])
        if (typeof r[name] !== 'boolean') fail(`Invalid ${key}.${name}.`)
      for (const name of spec.arrays || [])
        if (!Array.isArray(r[name]) || !(r[name] as unknown[]).every(isText))
          fail(`Invalid ${key}.${name}.`)
      for (const name of spec.dates || []) if (!isDate(String(r[name]))) fail(`Invalid ${key}.${name}.`)
    }
    ;(data as unknown as Record<string, unknown>)[key] = rows
  }
  if (!data.settings.some((s) => s.key === 'initialized'))
    fail('Backup is missing its initialization record.')
  const lookupKeys = data.lookupValues.map((v) => `${v.kind}\u0000${folded(v.value)}`)
  if (new Set(lookupKeys).size !== lookupKeys.length) fail('Backup has duplicate dropdown values.')
  if (new Set(data.settings.map((s) => s.key)).size !== data.settings.length)
    fail('Backup has duplicate setting keys.')
  return data
}

const kinds = new Set<LookupKind>([
  'segment',
  'category',
  'ems',
  'poc',
  'status',
  'stage',
  'blocker',
  'logistics',
  'component',
  'shipmentStage',
])

// Finds the first record whose key repeats, ignoring case and surrounding spaces.
function firstDuplicate<T>(rows: T[], key: (row: T) => string) {
  const seen = new Set<string>()
  for (const row of rows) {
    const k = key(row)
    if (seen.has(k)) return row
    seen.add(k)
  }
  return undefined
}

// Cross-record checks: references, quantities, and the uniqueness and date rules the database
// enforces. Run on the data as it will be after the import (merged with current data in merge mode).
export function validateRelations(data: DataSet) {
  const allIds = dataKeys.flatMap((key) => data[key].map((row) => row.id))
  const repeated = firstDuplicate(allIds, (id) => id)
  if (repeated) fail(`Duplicate record ID ${repeated}.`)
  const lookupKeys = data.lookupValues.map((v) => `${v.kind}\u0000${folded(v.value)}`)
  if (new Set(lookupKeys).size !== lookupKeys.length) fail('Dropdown values collide after merge.')
  if (new Set(data.settings.map((s) => s.key)).size !== data.settings.length)
    fail('Setting keys collide after merge.')
  const products = new Set(data.products.map((x) => x.id))
  const lots = new Map(data.lots.map((x) => [x.id, x]))
  const shipments = new Map(data.shipments.map((x) => [x.id, x]))
  for (const value of data.lookupValues)
    if (!kinds.has(value.kind) || !value.value.trim())
      fail('A dropdown value has an invalid kind or blank label.')
  const lookup = (kind: LookupKind, value: string) =>
    !value || data.lookupValues.some((v) => v.kind === kind && folded(v.value) === folded(value))
  for (const p of data.products)
    if (!p.name.trim() || !p.segment.trim()) fail('A product is missing its name or segment.')
  for (const p of data.products)
    if (!lookup('segment', p.segment)) fail(`Product ${p.name} references a missing segment.`)
  const twinProduct = firstDuplicate(data.products, (p) => `${folded(p.name)}\u0000${folded(p.variant)}`)
  if (twinProduct) fail(`Product ${twinProduct.name} duplicates another product name and variant.`)
  for (const l of data.lots) {
    if (!products.has(l.productId)) fail(`Lot ${l.label} has a missing product.`)
    // The database requires these three; the demo's forms always set them.
    if (!l.category.trim() || !l.status.trim() || !l.stage.trim())
      fail(`Lot ${l.label} is missing its category, status or stage.`)
    if (
      !l.label.trim() ||
      !lookup('category', l.category) ||
      !lookup('ems', l.ems) ||
      !lookup('poc', l.poc) ||
      !lookup('status', l.status) ||
      !lookup('stage', l.stage) ||
      !lookup('blocker', l.blockerCategory) ||
      !lookup('logistics', l.logisticsMode) ||
      l.rmComponents.some((c) => !lookup('component', c))
    )
      fail(`Lot ${l.label} references a missing dropdown value.`)
    if (l.reworkQty > l.freshProductionQty) fail(`Lot ${l.label} has rework above production.`)
    if (l.rmMode !== 'all' && l.rmMode !== 'components') fail(`Lot ${l.label} has an invalid RM mode.`)
    if (l.rmMode === 'components' && l.rmComponents.includes('Kit (All Together)'))
      fail(`Lot ${l.label} mixes kit and components.`)
  }
  const twinLot = firstDuplicate(data.lots, (l) => `${l.productId}\u0000${folded(l.label)}`)
  if (twinLot) fail(`Lot ${twinLot.label} duplicates another lot label on its product.`)
  for (const r of data.grnReceipts)
    if (!lots.has(r.lotId) || !r.label.trim() || !r.date || r.quantity <= 0)
      fail('A GRN receipt has a missing lot or invalid receipt fields.')
  for (const b of data.rmBatches)
    if (!lots.has(b.lotId) || !b.label.trim() || !lookup('component', b.component))
      fail('An RM batch has a missing lot or component.')
  for (const l of data.lots)
    if (totalGrn(data.grnReceipts.filter((r) => r.lotId === l.id)) > l.lotQty)
      fail(`GRN exceeds lot quantity for ${l.label}.`)
  for (const s of data.shipments) {
    if (!s.number.trim() || !s.vessel.trim() || !lookup('shipmentStage', s.stage))
      fail('A shipment is missing its invoice number, vessel, or valid stage.')
    if (s.etd && [s.plannedEta, s.revisedEta, s.actualArrival].some((d) => d && d < s.etd))
      fail(`Shipment ${s.number} has an ETA or arrival before its ETD.`)
  }
  const twinShipment = firstDuplicate(data.shipments, (s) => folded(s.number))
  if (twinShipment) fail(`Shipment ${twinShipment.number} duplicates another shipment number.`)
  for (const i of data.shipmentItems)
    if (!shipments.has(i.shipmentId) || !products.has(i.productId) || i.quantity <= 0)
      fail('A shipment line has a missing shipment, product, or positive quantity.')
  const twinLine = firstDuplicate(data.shipmentItems, (i) => `${i.shipmentId}\u0000${i.productId}`)
  if (twinLine) fail(`Shipment ${shipments.get(twinLine.shipmentId)?.number} lists a product on more than one line.`)
  for (const r of data.etaRevisions)
    if (!shipments.has(r.shipmentId)) fail('An ETA revision has a missing shipment.')
  for (const a of data.activityLogs)
    if (
      (a.entityType !== 'lot' && a.entityType !== 'shipment') ||
      (a.entityType === 'lot' && !lots.has(a.entityId)) ||
      (a.entityType === 'shipment' && !shipments.has(a.entityId))
    )
      fail('An activity record has a missing parent or invalid type.')
}
```

The demo matched dropdown text exactly. This version ignores case and surrounding spaces when matching references and finding duplicates, because the database's `citext` columns do. A backup the demo accepted can therefore only become stricter where the database would have refused it anyway.

- [ ] **Step 3: Run the domain tests and the coverage gate**

Run: `pnpm --filter @boat/domain test && pnpm --filter @boat/domain test:coverage`
Expected: PASS, with line coverage at 95% or more.

- [ ] **Step 4: Point the web app at the shared module**

In `apps/web/src/db.ts`, replace `export const SCHEMA_VERSION = 1` with:

```ts
export { SCHEMA_VERSION } from '@boat/domain/backup'
```

In `apps/web/src/repository.ts`:
1. Delete everything from `const isObject = (x: unknown)` down to the closing brace of `function validateRelations`, the line before `export async function importData`.
2. Add these lines next to the other imports:

   ```ts
   import { parseImport, validateRelations } from '@boat/domain/backup'
   export { parseImport }
   ```

3. Remove anything the typecheck then reports as unused from the `./models` import.

`App.tsx` keeps importing `parseImport` from `./repository`.

Run: `pnpm typecheck && pnpm --filter @boat/web build`
Expected: PASS.

- [ ] **Step 5: Check the web import by hand**

Run `pnpm dev`, go to Settings, and import `docs/sample-test-backup.json` in replace mode. Expected: the import succeeds with the same counts as before (4 products, 4 lots, 3 shipments). Importing a copy with one product renamed to differ only in case from another is refused with "duplicates another product name and variant".

- [ ] **Step 6: Format and commit**

```bash
pnpm format && pnpm typecheck && pnpm test
git add -A
git commit -m "Move backup validation into the domain and add the database's rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shipments: create, edit with ETA history, delete and detail

FR-6.1 to FR-6.5. The write path follows the lots service. It locks the shipment row, checks the version, resolves the stage against Settings, locks the line products `FOR SHARE`, runs the shared `validateShipment`, then writes the shipment and its lines. Each edit records ETA revisions the way the demo's `saveShipment` does:
- a "planned" revision when the planned ETA changes,
- a "current" revision when the effective ETA (revised, else planned) changes,
- history entries for the ETA, other fields and the lines.

**Files:**
- Create: `apps/api/src/modules/shipments/shipment-view.ts`
- Create: `apps/api/src/modules/shipments/shipments.service.ts`, `apps/api/src/modules/shipments/shipments.router.ts`
- Modify: `apps/api/src/api.ts`, `apps/api/src/api.test.ts`, `apps/api/test/support/fixtures.ts`
- Test: `apps/api/test/shipments.int.test.ts`

**Interfaces:**
- Consumes: `effectiveShipmentEta`, `shipmentFlags`, `shipmentQuantity`, `shipmentStatus`, `etaSlip`, `arrivalDelay` from `@boat/domain/calculations`; `validateShipment` from `@boat/domain/validation`; from Phase 3, `resolveLookups`, `recordActivity`, `actorOf`, `RecordsDeps`, `optionalDate`, `toDbDate`, `fromDbDate`, `quantity`, `text`.
- Produces:
  - `shipmentInclude`, `type ShipmentRow`, `toDomainShipment(row): Shipment`, `toDomainItems(row): ShipmentItem[]`
  - `computeShipment(s, items, date)` → `{ totalQty, currentEta, flags: { open, overdue, soon, revised, arrived }, status, etaSlip, arrivalDelay }`
  - `shipmentView(row, date)` and `type ShipmentView`; `getShipmentDetail(db, id, date)` → `ShipmentView & { etaRevisions }`
  - `type ShipmentInput`, `type ShipmentPatch = Partial<ShipmentInput> & { version: number; etaChangeReason?: string }`
  - `createShipment(deps, user, input)`, `updateShipment(deps, user, id, patch)` (both return the detail), `deleteShipment(deps, user, id)`, `lockShipment(db, id)`
  - `shipmentsRouter(deps)`, with routes `GET /shipments/:id` (signedIn), `POST /shipments` (`editShipments`) → 201, `PATCH /shipments/:id` (`editShipments`), `DELETE /shipments/:id` (`deleteShipments`) → 204
  - Fixture: `shipmentBody(world, overrides?)`

- [ ] **Step 1: Add the fixture**

Append to `apps/api/test/support/fixtures.ts`:

```ts
// A valid POST /shipments body with one line of the world's product; override any field.
export const shipmentBody = (w: RecordsWorld, overrides: Record<string, unknown> = {}) => ({
  number: unique('INV').replace(/\s/g, '-'),
  vessel: 'MSC Aurora',
  etd: '2026-09-26',
  plannedEta: '2026-10-20',
  items: [{ productId: w.product.id, quantity: 100 }],
  ...overrides,
})
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/shipments.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import {
  fixedNow,
  makeLookup,
  makeProduct,
  makeRecordsWorld,
  type RecordsWorld,
  shipmentBody,
  testApp,
} from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
let atSea: { id: string; value: string }
let arrivedStage: { id: string; value: string }

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  atSea = await makeLookup(db, 'shipmentStage', 'At Sea')
  arrivedStage = await makeLookup(db, 'shipmentStage', 'Arrived at Warehouse')
})
afterAll(() => close())

type Body = Record<string, unknown>
const create = (overrides: Body = {}) => w.planner.send('post', '/api/v1/shipments', shipmentBody(w, overrides))
const edit = (id: string, body: Body) => w.planner.send('patch', `/api/v1/shipments/${id}`, body)
const detail = async (id: string) => (await w.viewer.agent.get(`/api/v1/shipments/${id}`)).body
const history = async (id: string) =>
  (await db.activityLog.findMany({ where: { entityId: id }, orderBy: { createdAt: 'asc' } })).map((h) => h.message)

describe('creating shipments', () => {
  it('FR-6.1 records number, vessel, dates, stage, remarks and lines', async () => {
    const res = await create({ number: ' INV-100 ', stageId: atSea.id, remarks: 'Fragile ' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      version: 1,
      number: 'INV-100',
      vessel: 'MSC Aurora',
      etd: '2026-09-26',
      plannedEta: '2026-10-20',
      revisedEta: null,
      actualArrival: null,
      stage: { id: atSea.id, value: 'At Sea' },
      remarks: 'Fragile',
      items: [{ product: { id: w.product.id, name: 'Soundbar', variant: 'X1' }, quantity: 100 }],
      etaRevisions: [],
      computed: { totalQty: 100, currentEta: '2026-10-20', status: 'At Sea', flags: { open: true, arrived: false } },
    })
    expect(await history(res.body.id)).toEqual(['Shipment INV-100 created'])
  })
  it('FR-6.1 keeps shipment numbers unique, ignoring case', async () => {
    await create({ number: 'INV-200' })
    const twin = await create({ number: 'inv-200' })
    expect(twin.status).toBe(422)
    expect(twin.body.fields).toEqual({ number: 'Shipment inv-200 already exists.' })
  })
  it('FR-6.2 needs at least one line, each above zero, each product once', async () => {
    const none = await create({ items: [] })
    expect(none.body.fields).toEqual({ items: 'Add at least one product line.' })
    const zero = await create({ items: [{ productId: w.product.id, quantity: 0 }] })
    expect(zero.body.fields).toEqual({ 'items.0.quantity': 'Must be more than zero.' })
    const twice = await create({
      items: [
        { productId: w.product.id, quantity: 1 },
        { productId: w.product.id, quantity: 2 },
      ],
    })
    expect(twice.status).toBe(422)
    expect(twice.body.fields).toEqual({
      'items.0.productId': 'This product is already on another line. Combine the quantities.',
      'items.1.productId': 'This product is already on another line. Combine the quantities.',
    })
  })
  it('refuses a line for a product that no longer exists', async () => {
    const gone = await makeProduct(db)
    await db.product.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
    const res = await create({ items: [{ productId: gone.id, quantity: 5 }] })
    expect(res.body.fields).toEqual({ 'items.0.productId': 'This product no longer exists.' })
  })
  it('FR-6.3 refuses ETAs or arrival before the ETD, and arrival in the future', async () => {
    const early = await create({ plannedEta: '2026-09-20' })
    expect(early.body.fields).toEqual({ plannedEta: 'Planned ETA cannot be before ETD.' })
    // The test clock says 15 Oct 2026.
    const future = await create({ actualArrival: '2026-10-16' })
    expect(future.body.fields).toEqual({ actualArrival: 'Arrival cannot be in the future.' })
  })
  it('lets only planners and admins create shipments', async () => {
    for (const user of [w.poc, w.viewer])
      expect((await user.send('post', '/api/v1/shipments', shipmentBody(w))).status).toBe(403)
  })
})

describe('status', () => {
  it('FR-6.3 counts a shipment as arrived only once it has an actual arrival date', async () => {
    const created = await create({ stageId: arrivedStage.id })
    expect(created.body.computed.flags).toMatchObject({ arrived: false, open: true })
    const res = await edit(created.body.id, { actualArrival: '2026-10-14', version: 1 })
    expect(res.body.computed.flags).toMatchObject({ arrived: true, open: false })
  })
  it('FR-6.5 reads Overdue Nd from the current ETA, or Arrived Nd late or early against plan', async () => {
    const overdue = await create({ plannedEta: '2026-10-05', revisedEta: '2026-10-07' })
    expect(overdue.body.computed.status).toBe('Overdue 8d')
    const late = await create({ plannedEta: '2026-10-06', actualArrival: '2026-10-12' })
    expect(late.body.computed.status).toBe('Arrived 6d late')
    const early = await create({ plannedEta: '2026-10-06', actualArrival: '2026-10-04' })
    expect(early.body.computed.status).toBe('Arrived 2d early')
  })
})

describe('ETA history', () => {
  it('FR-6.4 writes a revision when the planned ETA changes and when the current ETA changes', async () => {
    const created = await create({ plannedEta: '2026-10-04' })
    const id = created.body.id
    await edit(id, { plannedEta: '2026-10-06', etaChangeReason: 'Supplier delay', version: 1 })
    await edit(id, { revisedEta: '2026-10-09', etaChangeReason: 'Port congestion', version: 2 })
    await edit(id, { revisedEta: '2026-10-06', version: 3 })
    // The revised ETA equals the planned one, so clearing it leaves the current ETA as it was:
    // the demo writes no revision for that.
    await edit(id, { revisedEta: null, remarks: 'x', version: 4 })
    const revisions = (await detail(id)).etaRevisions
    expect(revisions.map((r: Body) => [r.kind, r.previousDate, r.newDate, r.reason])).toEqual([
      ['current', '2026-10-09', '2026-10-06', ''],
      ['current', '2026-10-06', '2026-10-09', 'Port congestion'],
      ['planned', '2026-10-04', '2026-10-06', 'Original plan: Supplier delay'],
    ])
    expect(await history(id)).toEqual([
      `Shipment ${created.body.number} created`,
      'Original planned ETA revised: 2026-10-04 → 2026-10-06 (Supplier delay)',
      'Current ETA revised: 2026-10-06 → 2026-10-09 (Port congestion)',
      'Current ETA revised: 2026-10-09 → 2026-10-06',
      'Updated remarks',
    ])
  })
  it('says "Not set" when an ETA goes from unset to set', async () => {
    const created = await create({ plannedEta: null })
    await edit(created.body.id, { plannedEta: '2026-10-25', version: 1 })
    const [revision] = (await detail(created.body.id)).etaRevisions
    expect(revision).toMatchObject({ kind: 'planned', previousDate: null, newDate: '2026-10-25' })
    expect(await history(created.body.id)).toContain('Original planned ETA revised: Not set → 2026-10-25')
  })
  it('FR-6.4 keeps revisions out of reach of edits and deletes, even for the app role', async () => {
    await expect(db.$executeRaw`UPDATE eta_revisions SET reason = 'changed'`).rejects.toThrow()
    await expect(db.$executeRaw`DELETE FROM eta_revisions`).rejects.toThrow()
  })
})

describe('editing and deleting', () => {
  it('FR-6.2 replaces lines and records that they changed', async () => {
    const other = await makeProduct(db, { name: 'Woofer' })
    const created = await create({
      items: [
        { productId: w.product.id, quantity: 100 },
        { productId: other.id, quantity: 5 },
      ],
    })
    const res = await edit(created.body.id, { items: [{ productId: w.product.id, quantity: 80 }], version: 1 })
    expect(res.body.items).toEqual([expect.objectContaining({ product: expect.objectContaining({ id: w.product.id }), quantity: 80 })])
    expect(res.body.computed.totalQty).toBe(80)
    expect(await history(created.body.id)).toContain('Product lines updated')
  })
  it('answers a stale version with 409 and the shipment as it now stands', async () => {
    const created = await create()
    await edit(created.body.id, { vessel: 'A', version: 1 })
    const stale = await w.admin.send('patch', `/api/v1/shipments/${created.body.id}`, { vessel: 'B', version: 1 })
    expect(stale.status).toBe(409)
    expect(stale.body.current).toMatchObject({ vessel: 'A', version: 2 })
  })
  it('lets only admins delete; a deleted shipment frees its products and reads as 404', async () => {
    const product = await makeProduct(db)
    const created = await create({ items: [{ productId: product.id, quantity: 1 }] })
    expect((await w.planner.send('delete', `/api/v1/shipments/${created.body.id}`)).status).toBe(403)
    expect((await w.admin.send('delete', `/api/v1/shipments/${created.body.id}`)).status).toBe(204)
    expect((await w.viewer.agent.get(`/api/v1/shipments/${created.body.id}`)).status).toBe(404)
    expect(await history(created.body.id)).toContain(`Shipment ${created.body.number} deleted`)
    expect((await w.admin.send('delete', `/api/v1/products/${product.id}`)).status).toBe(204)
  })
})
```

Run: `pnpm --filter @boat/api test:int -- test/shipments.int.test.ts`
Expected: FAIL. `/api/v1/shipments` answers the JSON 404.

- [ ] **Step 3: Implement the shipment views**

Create `apps/api/src/modules/shipments/shipment-view.ts`:

```ts
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
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
  const row = await db.shipment.findFirst({ where: { id, deletedAt: null }, include: shipmentInclude })
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
```

- [ ] **Step 4: Implement the service**

Create `apps/api/src/modules/shipments/shipments.service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { effectiveShipmentEta } from '@boat/domain/calculations'
import type { Shipment, ShipmentItem } from '@boat/domain/models'
import { assertValid, type FieldErrors, validateShipment, ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { type Actor, actorOf, recordActivity } from '../../core/audit'
import type { RecordsDeps } from '../../core/clock'
import { fromDbDate, toDbDate } from '../../core/dates'
import { ConflictError, NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { Prisma } from '../../generated/prisma/client'
import { resolveLookups } from '../lookups/resolve'
import { getShipmentDetail, shipmentInclude, type ShipmentRow, toDomainShipment } from './shipment-view'

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

export async function lockShipment(db: Db, id: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM shipments WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`
  if (!rows.length) throw new NotFoundError()
  return db.shipment.findUniqueOrThrow({ where: { id }, include: shipmentInclude })
}

// validateShipment names line fields line:<id>:<field>. Lines here are numbered by position, so
// line:2:quantity becomes items.2.quantity, the path the request itself used.
const lineNames = (errors: FieldErrors): FieldErrors =>
  Object.fromEntries(
    Object.entries(errors).map(([key, message]) => {
      const line = /^line:(\d+):(\w+)$/.exec(key)
      return [line ? `items.${line[1]}.${line[2]}` : key === 'lines' ? 'items' : key, message]
    }),
  )

// FR-6.1 to FR-6.3 through the shared validateShipment, the stage through Settings (FR-8.3), and
// each line's product through the product table. FOR SHARE on the products means a product
// delete running at the same moment either waits and then sees this line, or wins and this
// save is refused.
async function checkShipment(db: Db, id: string, input: ShipmentInput, date: string) {
  const productIds = [...new Set(input.items.map((i) => i.productId))]
  const products = productIds.length
    ? await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM products
        WHERE id IN (${Prisma.join(productIds.map((p) => Prisma.sql`${p}::uuid`))}) AND deleted_at IS NULL
        FOR SHARE`
    : []
  const found = new Set(products.map((p) => p.id))
  const { valueOf, errors } = await resolveLookups(db, [
    { field: 'stageId', kind: 'shipmentStage', id: input.stageId, label: 'a shipment stage' },
  ])
  const shipment: Shipment = {
    id,
    createdAt: '',
    updatedAt: '',
    number: input.number.trim(),
    vessel: input.vessel.trim(),
    etd: input.etd ?? '',
    plannedEta: input.plannedEta ?? '',
    revisedEta: input.revisedEta ?? '',
    actualArrival: input.actualArrival ?? '',
    stage: valueOf(input.stageId),
    remarks: input.remarks.trim(),
  }
  const items: ShipmentItem[] = input.items.map((item, i) => ({
    id: String(i),
    createdAt: '',
    updatedAt: '',
    shipmentId: id,
    productId: item.productId,
    quantity: item.quantity,
  }))
  const missing: FieldErrors = Object.fromEntries(
    input.items.flatMap((item, i) =>
      found.has(item.productId) ? [] : [[`items.${i}.productId`, 'This product no longer exists.']],
    ),
  )
  assertValid({ ...lineNames(validateShipment(shipment, items, date)), ...missing, ...errors })
  return shipment
}

const inputOf = (row: ShipmentRow): ShipmentInput => ({
  number: row.number,
  vessel: row.vessel,
  etd: fromDbDate(row.etd),
  plannedEta: fromDbDate(row.plannedEta),
  revisedEta: fromDbDate(row.revisedEta),
  actualArrival: fromDbDate(row.actualArrival),
  stageId: row.stageId,
  remarks: row.remarks,
  items: row.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
})

const shipmentData = (input: ShipmentInput, s: Shipment) => ({
  number: s.number,
  vessel: s.vessel,
  etd: toDbDate(input.etd),
  plannedEta: toDbDate(input.plannedEta),
  revisedEta: toDbDate(input.revisedEta),
  actualArrival: toDbDate(input.actualArrival),
  stageId: input.stageId,
  remarks: s.remarks,
})

// FR-6.1: the partial unique index on number is case-insensitive (citext).
const duplicateNumber = (number: string) => (err: unknown): never => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    throw new ValidationError({ number: `Shipment ${number} already exists.` })
  throw err
}

// Lines are keyed by product (FR-6.2: a product appears once). Returns whether anything changed.
async function syncItems(db: Db, user: SessionUser, current: ShipmentRow, items: ShipmentInput['items']) {
  const before = new Map(current.items.map((i) => [i.productId, i]))
  const after = new Map(items.map((i) => [i.productId, i.quantity]))
  let changed = false
  for (const [productId, line] of before)
    if (!after.has(productId)) {
      await db.shipmentItem.update({ where: { id: line.id }, data: { deletedAt: new Date(), deletedBy: user.id } })
      changed = true
    }
  for (const [productId, quantity] of after) {
    const line = before.get(productId)
    if (!line) await db.shipmentItem.create({ data: { shipmentId: current.id, productId, quantity } })
    else if (line.quantity !== quantity) await db.shipmentItem.update({ where: { id: line.id }, data: { quantity } })
    else continue
    changed = true
  }
  return changed
}

const notSet = (d: string) => d || 'Not set'
const spaced = (field: string) => field.replace(/([A-Z])/g, ' $1').toLowerCase()

// FR-6.4, as the demo's saveShipment: one immutable revision when the planned ETA changes, and
// one when the effective ETA (revised, else planned) changes. History mirrors each.
async function recordChanges(
  db: Db,
  actor: Actor,
  old: Shipment,
  next: Shipment,
  reason: string,
  linesChanged: boolean,
) {
  const entityId = old.id
  const revise = async (
    kind: 'planned' | 'current',
    previous: string,
    current: string,
    label: string,
    revisionReason: string,
  ) => {
    await db.etaRevision.create({
      data: {
        shipmentId: entityId,
        kind,
        previousDate: toDbDate(previous || null),
        newDate: toDbDate(current || null),
        reason: revisionReason,
        createdBy: actor.id,
      },
    })
    await recordActivity(db, actor, {
      entityType: 'shipment',
      entityId,
      kind: 'eta',
      message: `${label}: ${notSet(previous)} → ${notSet(current)}${reason ? ` (${reason})` : ''}`,
    })
  }
  if (old.plannedEta !== next.plannedEta)
    await revise(
      'planned',
      old.plannedEta,
      next.plannedEta,
      'Original planned ETA revised',
      `Original plan${reason ? `: ${reason}` : ''}`,
    )
  if (old.revisedEta !== next.revisedEta && effectiveShipmentEta(old) !== effectiveShipmentEta(next))
    await revise('current', effectiveShipmentEta(old), effectiveShipmentEta(next), 'Current ETA revised', reason)
  const fields = ['number', 'vessel', 'etd', 'actualArrival', 'stage', 'remarks'] as const
  const changed = fields.filter((k) => old[k] !== next[k])
  if (changed.length)
    await recordActivity(db, actor, {
      entityType: 'shipment',
      entityId,
      kind: 'updated',
      message: `Updated ${changed.map(spaced).join(', ')}`,
      changes: Object.fromEntries(changed.map((k) => [k, [old[k], next[k]]])),
    })
  if (linesChanged)
    await recordActivity(db, actor, { entityType: 'shipment', entityId, kind: 'lines', message: 'Product lines updated' })
}

export async function createShipment({ db, clock }: RecordsDeps, user: SessionUser, input: ShipmentInput) {
  const date = await clock.today()
  const id = randomUUID()
  await db.$transaction(async (tx) => {
    const shipment = await checkShipment(tx, id, input, date)
    await tx.shipment.create({ data: { id, ...shipmentData(input, shipment) } }).catch(duplicateNumber(shipment.number))
    await tx.shipmentItem.createMany({
      data: input.items.map((i) => ({ shipmentId: id, productId: i.productId, quantity: i.quantity })),
    })
    await recordActivity(tx, actorOf(user), {
      entityType: 'shipment',
      entityId: id,
      kind: 'created',
      message: `Shipment ${shipment.number} created`,
    })
  })
  return getShipmentDetail(db, id, date)
}

export async function updateShipment(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  id: string,
  patch: ShipmentPatch,
) {
  const date = await clock.today()
  await db.$transaction(async (tx) => {
    const current = await lockShipment(tx, id)
    const { version, etaChangeReason, ...changes } = patch
    if (version !== current.version)
      throw new ConflictError(
        'Someone else changed this shipment. Review their changes and try again.',
        await getShipmentDetail(tx, id, date),
      )
    const input: ShipmentInput = { ...inputOf(current), ...changes }
    const old = toDomainShipment(current)
    const next = await checkShipment(tx, id, input, date)
    await tx.shipment
      .update({ where: { id }, data: { ...shipmentData(input, next), version: { increment: 1 } } })
      .catch(duplicateNumber(next.number))
    const linesChanged = await syncItems(tx, user, current, input.items)
    await recordChanges(tx, actorOf(user), old, next, (etaChangeReason ?? '').trim(), linesChanged)
  })
  return getShipmentDetail(db, id, date)
}

export async function deleteShipment({ db }: RecordsDeps, user: SessionUser, id: string) {
  await db.$transaction(async (tx) => {
    const current = await lockShipment(tx, id)
    const stamp = { deletedAt: new Date(), deletedBy: user.id }
    await tx.shipmentItem.updateMany({ where: { shipmentId: id, deletedAt: null }, data: stamp })
    await tx.shipment.update({ where: { id }, data: stamp })
    // ETA revisions are insert-only and stay; the shipment's history records the delete.
    await recordActivity(tx, actorOf(user), {
      entityType: 'shipment',
      entityId: id,
      kind: 'deleted',
      message: `Shipment ${current.number} deleted`,
    })
  })
}
```

- [ ] **Step 5: Implement the router and mount it**

Create `apps/api/src/modules/shipments/shipments.router.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission, requireSignedIn } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { optionalDate } from '../../core/dates'
import { quantity, text } from '../../core/fields'
import { parseId, parseInput } from '../../core/parse'
import { getShipmentDetail } from './shipment-view'
import { createShipment, deleteShipment, updateShipment } from './shipments.service'

const item = z.strictObject({
  productId: z.guid({ error: 'Choose a product.' }),
  quantity: quantity('quantity'),
})
const fields = {
  number: z
    .string({ error: 'Enter the shipment or invoice number.' })
    .max(60, { error: 'Keep the number to 60 characters or fewer.' }),
  vessel: z
    .string({ error: 'Enter the vessel, flight, or carrier.' })
    .max(100, { error: 'Keep this to 100 characters or fewer.' }),
  etd: optionalDate,
  plannedEta: optionalDate,
  revisedEta: optionalDate,
  actualArrival: optionalDate,
  stageId: z.guid({ error: 'Choose a shipment stage from the list.' }).nullable(),
  remarks: text(1000),
  items: z.array(item, { error: 'Add at least one product line.' }).max(200, { error: 'Keep a shipment to 200 lines or fewer.' }),
}
const createBody = z.strictObject({
  ...fields,
  etd: fields.etd.default(null),
  plannedEta: fields.plannedEta.default(null),
  revisedEta: fields.revisedEta.default(null),
  actualArrival: fields.actualArrival.default(null),
  stageId: fields.stageId.default(null),
  remarks: fields.remarks.default(''),
})
const patchBody = z
  .strictObject(fields)
  .partial()
  .extend({
    version: z.number({ error: 'Reload the shipment and try again.' }).int(),
    etaChangeReason: text(500).optional(),
  })

export function shipmentsRouter(deps: RecordsDeps) {
  const router = Router()

  // List, summary and CSV routes (Task 4) go above /:id, which would otherwise match them.

  router.get('/:id', requireSignedIn(), async (req, res) => {
    res.json(await getShipmentDetail(deps.db, parseId(req.params.id), await deps.clock.today()))
  })

  router.post('/', requirePermission('editShipments'), async (req, res) => {
    res.status(201).json(await createShipment(deps, authOf(req).user, parseInput(createBody, req.body)))
  })

  router.patch('/:id', requirePermission('editShipments'), async (req, res) => {
    const patch = parseInput(patchBody, req.body)
    res.json(await updateShipment(deps, authOf(req).user, parseId(req.params.id), patch))
  })

  router.delete('/:id', requirePermission('deleteShipments'), async (req, res) => {
    await deleteShipment(deps, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
```

In `apps/api/src/api.ts`, import `shipmentsRouter` from `./modules/shipments/shipments.router` and mount it after the activity router:

```ts
  mount(api, '/shipments', shipmentsRouter(records))
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /shipments/:id signedIn',
        'POST /shipments editShipments',
        'PATCH /shipments/:id editShipments',
        'DELETE /shipments/:id deleteShipments',
```

- [ ] **Step 6: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 7: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add shipments with product lines and ETA history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shipment list, summary cards, CSV, history and notes

The demo's shipment screen: search, stage, vessel and one quick filter, four sorts, five cards plus open units, and the CSV. Shipments are few (one per invoice), so the list loads every active shipment and filters with the domain's own flags. There's no SQL copy that could drift. History and notes reuse the activity module, generalised from lots to either record type.

**Files:**
- Modify: `apps/api/src/modules/activity/activity.service.ts` (`entityActivity`, `entryView`)
- Modify: `apps/api/src/modules/shipments/shipments.service.ts`, `apps/api/src/modules/shipments/shipments.router.ts`, `apps/api/src/api.test.ts`
- Test: `apps/api/test/shipments-list.int.test.ts`

**Interfaces:**
- Consumes: from Task 3, `shipmentInclude`, `shipmentView`, `ShipmentView`, `lockShipment`; from Phase 3, `toCsv`, `pageQuery`, `pageOf`, `recordActivity`, `actorOf`.
- Produces:
  - `entityActivity(db, entityType: 'lot' | 'shipment', entityId, page)`, with `lotActivity` kept as a wrapper; `entryView(entry)`
  - `shipmentFlagNames` (`'open' | 'soon' | 'overdue' | 'revised' | 'arrived'`), `shipmentSorts` (`'eta-asc' | 'eta-desc' | 'qty-desc' | 'number-asc'`), `type ShipmentFilters`
  - `listShipments(deps, filters, page)`, `shipmentCards(deps)` → `{ open, soon, overdue, revised, arrived, openUnits }`, `exportShipmentsCsv(deps, filters)` → `{ filename, body }`, `addShipmentNote(db, user, id, message)`
  - Routes (signedIn unless noted, list routes above `/:id`):
    - `GET /shipments?q=&stageId=&vessel=&flag=&sort=&page=&pageSize=`
    - `GET /shipments/summary`
    - `GET /shipments/export.csv`
    - `GET /shipments/:id/activity`
    - `POST /shipments/:id/notes` (`editShipments`) → 201

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/shipments-list.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import {
  fixedNow,
  makeLookup,
  makeProduct,
  makeRecordsWorld,
  type RecordsWorld,
  shipmentBody,
  testApp,
} from './support/fixtures'

type Item = {
  id: string
  number: string
  computed: { totalQty: number; currentEta: string | null; status: string; flags: Record<string, boolean> }
}

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
let atSea: { id: string }
const ids: Record<string, string> = {}

// The test clock says 15 Oct 2026.
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  atSea = await makeLookup(db, 'shipmentStage', 'At Sea')
  const woofer = await makeProduct(db, { name: 'Woofer' })
  const add = async (number: string, fields: Record<string, unknown>) => {
    const res = await w.planner.send('post', '/api/v1/shipments', shipmentBody(w, { number, ...fields }))
    ids[number] = res.body.id
  }
  await add('SEA-LATE', { plannedEta: '2026-10-05', revisedEta: '2026-10-07', stageId: atSea.id })
  await add('AIR-ARRIVED', { plannedEta: '2026-10-05', actualArrival: '2026-10-05', vessel: 'Air India' })
  await add('DUE-SOON', {
    plannedEta: '2026-10-17',
    items: [
      { productId: w.product.id, quantity: 100 },
      { productId: woofer.id, quantity: 5 },
    ],
  })
  await add('FAR', { plannedEta: '2026-10-30', items: [{ productId: w.product.id, quantity: 300 }] })
  await add('NO-ETA', { plannedEta: null, remarks: '=cmd()' })
  await add('GONE', {})
  await w.admin.send('delete', `/api/v1/shipments/${ids.GONE}`)
})
afterAll(() => close())

const list = async (query = '') => {
  const res = await w.viewer.agent.get(`/api/v1/shipments?pageSize=200${query}`)
  expect(res.status).toBe(200)
  return res.body as { items: Item[]; total: number }
}
const numbers = (items: Item[]) => items.map((i) => i.number)

describe('the shipment list', () => {
  it('FR-6.5 lists active shipments with their status line', async () => {
    const all = await list('&sort=number-asc')
    expect(numbers(all.items)).toEqual(['AIR-ARRIVED', 'DUE-SOON', 'FAR', 'NO-ETA', 'SEA-LATE'])
    const status = Object.fromEntries(all.items.map((i) => [i.number, i.computed.status]))
    expect(status).toMatchObject({ 'SEA-LATE': 'Overdue 8d', 'AIR-ARRIVED': 'Arrived on time' })
  })
  it('searches number, vessel and product names', async () => {
    expect(numbers((await list('&q=sea-late')).items)).toEqual(['SEA-LATE'])
    expect(numbers((await list('&q=air%20india')).items)).toEqual(['AIR-ARRIVED'])
    expect(numbers((await list('&q=woofer')).items)).toEqual(['DUE-SOON'])
  })
  it('filters by stage, vessel and each quick filter', async () => {
    expect(numbers((await list(`&stageId=${atSea.id}`)).items)).toEqual(['SEA-LATE'])
    expect(numbers((await list('&vessel=Air%20India')).items)).toEqual(['AIR-ARRIVED'])
    const all = (await list()).items
    for (const flag of ['open', 'soon', 'overdue', 'revised', 'arrived']) {
      const want = numbers(all.filter((i) => i.computed.flags[flag])).sort()
      expect(numbers((await list(`&flag=${flag}`)).items).sort(), flag).toEqual(want)
    }
    expect(numbers((await list('&flag=soon')).items)).toEqual(['DUE-SOON'])
  })
  it('sorts by ETA with missing ETAs last, and by quantity', async () => {
    expect(numbers((await list('&sort=eta-asc')).items)).toEqual([
      'AIR-ARRIVED',
      'SEA-LATE',
      'DUE-SOON',
      'FAR',
      'NO-ETA',
    ])
    expect(numbers((await list('&sort=qty-desc')).items)[0]).toBe('FAR')
  })
  it('pages', async () => {
    const res = await w.viewer.agent.get('/api/v1/shipments?sort=number-asc&pageSize=2&page=2')
    expect(res.body).toMatchObject({ total: 5, page: 2, pageSize: 2 })
    expect(numbers(res.body.items)).toEqual(['FAR', 'NO-ETA'])
  })
})

describe('GET /shipments/summary', () => {
  it('counts the cards and the units still in transit', async () => {
    const res = await w.viewer.agent.get('/api/v1/shipments/summary')
    expect(res.body).toEqual({ open: 4, soon: 1, overdue: 1, revised: 1, arrived: 1, openUnits: 605 })
  })
})

describe('GET /shipments/export.csv', () => {
  it('exports the filtered shipments with the demo columns', async () => {
    const res = await w.viewer.agent.get('/api/v1/shipments/export.csv?sort=number-asc')
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="?shipments-2026-10-15\.csv"?$/)
    const lines = res.text.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      '"Invoice","Vessel","Products","TotalQty","ETD","PlannedETA","CurrentETA","ActualWarehouseArrival","Stage","Status","ETASlipDays","ActualArrivalDelayDays","Remarks"',
    )
    expect(lines).toHaveLength(6)
    expect(lines[2]).toContain('"Soundbar (100); Woofer (5)","105"')
    expect(res.text).toContain('"\'=cmd()"')
  })
})

describe('shipment history and notes', () => {
  it('lets planners and admins add notes, newest first in the history', async () => {
    const note = await w.planner.send('post', `/api/v1/shipments/${ids.FAR}/notes`, { message: ' Customs cleared ' })
    expect(note.status).toBe(201)
    expect(note.body).toMatchObject({ kind: 'note', message: 'Customs cleared', actorName: 'Test planner' })
    const res = await w.viewer.agent.get(`/api/v1/shipments/${ids.FAR}/activity`)
    expect(res.body.items.map((e: { message: string }) => e.message)).toEqual([
      'Customs cleared',
      'Shipment FAR created',
    ])
  })
  it('refuses notes from POCs and viewers, and blank notes', async () => {
    for (const user of [w.poc, w.viewer])
      expect((await user.send('post', `/api/v1/shipments/${ids.FAR}/notes`, { message: 'x' })).status).toBe(403)
    const blank = await w.planner.send('post', `/api/v1/shipments/${ids.FAR}/notes`, { message: ' ' })
    expect(blank.body.fields).toEqual({ message: 'Write a note first.' })
  })
  it('answers 404 for the history of a deleted shipment', async () => {
    expect((await w.viewer.agent.get(`/api/v1/shipments/${ids.GONE}/activity`)).status).toBe(404)
  })
})
```

Run: `pnpm --filter @boat/api test:int -- test/shipments-list.int.test.ts`
Expected: FAIL. `GET /api/v1/shipments` reaches `/:id` and answers 404.

- [ ] **Step 2: Generalise history**

In `apps/api/src/modules/activity/activity.service.ts`, replace `lotActivity` with:

```ts
export const entryView = (entry: {
  id: string
  kind: string
  message: string
  changes: unknown
  actorId: string | null
  actorName: string | null
  createdAt: Date
}) => ({
  id: entry.id,
  kind: entry.kind,
  message: entry.message,
  changes: entry.changes,
  actorId: entry.actorId,
  actorName: entry.actorName,
  createdAt: entry.createdAt,
})

// History of an active lot or shipment, newest first. A deleted record's history reads as 404.
export async function entityActivity(
  db: PrismaClient,
  entityType: 'lot' | 'shipment',
  entityId: string,
  page: Page,
) {
  const where = { id: entityId, deletedAt: null }
  const exists =
    entityType === 'lot'
      ? await db.lot.findFirst({ where, select: { id: true } })
      : await db.shipment.findFirst({ where, select: { id: true } })
  if (!exists) throw new NotFoundError()
  const filter = { entityType, entityId }
  const [items, total] = await Promise.all([
    db.activityLog.findMany({
      where: filter,
      select: entrySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(page),
    }),
    db.activityLog.count({ where: filter }),
  ])
  return pageOf(items, total, page)
}

export const lotActivity = (db: PrismaClient, lotId: string, page: Page) =>
  entityActivity(db, 'lot', lotId, page)
```

and make `addLotNote` return `entryView(entry)` instead of building the object inline.

Run: `pnpm --filter @boat/api test:int -- test/activity.int.test.ts`
Expected: PASS (no behaviour change).

- [ ] **Step 3: Add the list, cards, CSV and notes to the service**

In `apps/api/src/modules/shipments/shipments.service.ts`, add these imports:

```ts
import { toCsv } from '../../core/csv'
import { type Page, pageOf } from '../../core/pagination'
import { entryView } from '../activity/activity.service'
```

Add `shipmentView` and `type ShipmentView` to the `./shipment-view` import. Then append:

```ts
export const shipmentFlagNames = ['open', 'soon', 'overdue', 'revised', 'arrived'] as const
export type ShipmentFlag = (typeof shipmentFlagNames)[number]
export const shipmentSorts = ['eta-asc', 'eta-desc', 'qty-desc', 'number-asc'] as const
export type ShipmentSort = (typeof shipmentSorts)[number]
export type ShipmentFilters = {
  q: string
  stageId?: string
  vessel?: string
  flag?: ShipmentFlag
  sort: ShipmentSort
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const eta = (v: ShipmentView) => v.computed.currentEta ?? '9999'
// The demo's sorts; a shipment with no ETA sorts as 9999, last going up.
const sorts: Record<ShipmentSort, (a: ShipmentView, b: ShipmentView) => number> = {
  'eta-asc': (a, b) => compareText(eta(a), eta(b)),
  'eta-desc': (a, b) => compareText(eta(b), eta(a)),
  'qty-desc': (a, b) => b.computed.totalQty - a.computed.totalQty,
  'number-asc': (a, b) => compareText(a.number, b.number),
}

// Shipments are few (one per invoice), so they are filtered in memory with the domain's own
// flags. Lots run to tens of thousands and need SQL; shipments don't.
async function matchingShipments(db: Db, f: ShipmentFilters, date: string) {
  const rows = await db.shipment.findMany({
    where: { deletedAt: null, ...(f.stageId && { stageId: f.stageId }), ...(f.vessel && { vessel: f.vessel }) },
    include: shipmentInclude,
  })
  const term = f.q.trim().toLowerCase()
  return rows
    .map((row) => shipmentView(row, date))
    .filter(
      (v) =>
        (!term ||
          `${v.number} ${v.vessel} ${v.items.map((i) => i.product.name).join(' ')}`.toLowerCase().includes(term)) &&
        (!f.flag || v.computed.flags[f.flag]),
    )
    .sort(sorts[f.sort])
}

export async function listShipments({ db, clock }: RecordsDeps, filters: ShipmentFilters, page: Page) {
  const all = await matchingShipments(db, filters, await clock.today())
  const start = (page.page - 1) * page.pageSize
  return pageOf(all.slice(start, start + page.pageSize), all.length, page)
}

// The demo's cards, over every active shipment.
export async function shipmentCards({ db, clock }: RecordsDeps) {
  const all = await matchingShipments(db, { q: '', sort: 'eta-asc' }, await clock.today())
  const count = (flag: ShipmentFlag) => all.filter((v) => v.computed.flags[flag]).length
  return {
    open: count('open'),
    soon: count('soon'),
    overdue: count('overdue'),
    revised: count('revised'),
    arrived: count('arrived'),
    openUnits: all.filter((v) => v.computed.flags.open).reduce((n, v) => n + v.computed.totalQty, 0),
  }
}

// The demo's CSV columns (Shipments.tsx).
const csvHeaders = [
  'Invoice',
  'Vessel',
  'Products',
  'TotalQty',
  'ETD',
  'PlannedETA',
  'CurrentETA',
  'ActualWarehouseArrival',
  'Stage',
  'Status',
  'ETASlipDays',
  'ActualArrivalDelayDays',
  'Remarks',
]

export async function exportShipmentsCsv({ db, clock }: RecordsDeps, filters: ShipmentFilters) {
  const date = await clock.today()
  const rows = (await matchingShipments(db, filters, date)).map((v) => ({
    Invoice: v.number,
    Vessel: v.vessel,
    Products: v.items.map((i) => `${i.product.name} (${i.quantity})`).join('; '),
    TotalQty: v.computed.totalQty,
    ETD: v.etd ?? '',
    PlannedETA: v.plannedEta ?? '',
    CurrentETA: v.computed.currentEta ?? '',
    ActualWarehouseArrival: v.actualArrival ?? '',
    Stage: v.stage?.value ?? '',
    Status: v.computed.status,
    ETASlipDays: v.computed.etaSlip ?? '',
    ActualArrivalDelayDays: v.computed.arrivalDelay ?? '',
    Remarks: v.remarks,
  }))
  return { filename: `shipments-${date}.csv`, body: toCsv(csvHeaders, rows) }
}

// FR-7.2 for shipments: users who may edit shipments may add a note.
export async function addShipmentNote(db: PrismaClient, user: SessionUser, id: string, message: string) {
  const text = message.trim()
  if (!text) throw new ValidationError({ message: 'Write a note first.' })
  return db.$transaction(async (tx) => {
    await lockShipment(tx, id)
    const entry = await recordActivity(tx, actorOf(user), {
      entityType: 'shipment',
      entityId: id,
      kind: 'note',
      message: text,
    })
    return entryView(entry)
  })
}
```

Change the client import at the top to `import { Prisma, type PrismaClient } from '../../generated/prisma/client'`.

- [ ] **Step 4: Add the routes above `/:id`**

In `apps/api/src/modules/shipments/shipments.router.ts`, add these imports:

```ts
import { pageQuery } from '../../core/pagination'
import { entityActivity } from '../activity/activity.service'
```

and add `addShipmentNote`, `exportShipmentsCsv`, `listShipments`, `shipmentCards`, `shipmentFlagNames` and `shipmentSorts` to the `./shipments.service` import. Add below `patchBody`:

```ts
const listQuery = z.object({
  q: z.string().max(100, { error: 'Keep the search to 100 characters or fewer.' }).default(''),
  stageId: z.guid({ error: 'Choose a value from the list.' }).optional(),
  vessel: z.string().max(100).optional(),
  flag: z.enum(shipmentFlagNames, { error: 'Choose a known quick filter.' }).optional(),
  sort: z.enum(shipmentSorts, { error: 'Choose a known sort.' }).default('eta-asc'),
})
const noteBody = z.strictObject({
  message: z
    .string({ error: 'Write a note first.' })
    .max(2000, { error: 'Keep the note to 2,000 characters or fewer.' }),
})
```

Replace the comment `// List, summary and CSV routes (Task 4) go above /:id, …` with:

```ts
  router.get('/', requireSignedIn(), async (req, res) => {
    const { page, pageSize, ...filters } = parseInput(listQuery.extend(pageQuery.shape), req.query)
    res.json(await listShipments(deps, filters, { page, pageSize }))
  })

  router.get('/summary', requireSignedIn(), async (_req, res) => {
    res.json(await shipmentCards(deps))
  })

  router.get('/export.csv', requireSignedIn(), async (req, res) => {
    const { filename, body } = await exportShipmentsCsv(deps, parseInput(listQuery, req.query))
    res.type('text/csv; charset=utf-8').attachment(filename).send(body)
  })

  router.get('/:id/activity', requireSignedIn(), async (req, res) => {
    res.json(await entityActivity(deps.db, 'shipment', parseId(req.params.id), parseInput(pageQuery, req.query)))
  })

  router.post('/:id/notes', requirePermission('editShipments'), async (req, res) => {
    const { message } = parseInput(noteBody, req.body)
    res.status(201).json(await addShipmentNote(deps.db, authOf(req).user, parseId(req.params.id), message))
  })
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /shipments signedIn',
        'GET /shipments/summary signedIn',
        'GET /shipments/export.csv signedIn',
        'GET /shipments/:id/activity signedIn',
        'POST /shipments/:id/notes editShipments',
```

- [ ] **Step 5: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 6: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add the shipment list, cards, CSV, history and notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Month-end summary and its CSV

FR-5.1 and FR-5.2. The report takes the lots originally planned in the month (a revised ETA doesn't move them) and their receipts from SQL. It hands them to the domain's `monthSummary`, so its figures are the demo's by construction. "GRN in month" counts every receipt dated in the month, for any lot, as the demo does.

**Files:**
- Create: `apps/api/src/modules/reports/month-end.service.ts`, `apps/api/src/modules/reports/reports.router.ts`
- Modify: `apps/api/src/api.ts`, `apps/api/src/api.test.ts`
- Test: `apps/api/test/month-end.int.test.ts`

**Interfaces:**
- Consumes: `monthSummary`, `monthEnd`, `monthLabel`, `lotSummary` from `@boat/domain/calculations`; from Phase 3, `lotInclude`, `toDomainLot`, `toDomainReceipt`, `toDbDate`, `fromDbDate`, `toCsv`, `RecordsDeps`.
- Produces:
  - `monthEndReport(deps, month)` → `{ month, label, monthEnd, inProgress, planned, received, shortfall, percent, grnInMonth, products: [{ product, lots, planned, received, shortfall }], lots: [{ lot: { id, label, plannedDate, product, blocker, blockerDescription }, planned, received, shortfall, statusToday }] }`
  - `monthEndCsv(deps, month)` → `{ filename, body }`
  - Routes (signedIn): `GET /reports/month-end?month=YYYY-MM`, `GET /reports/month-end/export.csv?month=YYYY-MM`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/month-end.int.test.ts`:

```ts
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { refreshCompletion } from '../src/modules/lots/lot-lock'
import { createTestDatabase } from './support/db'
import { day, fixedNow, makeLot, makeProduct, makeRecordsWorld, type RecordsWorld, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld

// September 2026, seen from 15 October:
//   L1  planned 10 Sep, 100 units; 40 received 20 Sep, 30 more on 2 Oct (after month end)
//   L2  planned 25 Sep, revised to 10 Oct, 50 units; 50 received 28 Sep
//   L3  planned 5 Oct (another month); 10 received 15 Sep, which still counts as GRN in September
//   L4  planned 12 Sep but deleted
//   L5  planned 5 Sep on another product, 200 units, nothing received
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  const other = await makeProduct(db, { name: 'Woofer' })
  const lot = (label: string, fields: Record<string, unknown>) =>
    makeLot(db, { productId: w.product.id, label, stageId: w.lookups.stage.id, ...fields })
  const receive = async (lotId: string, date: string, quantity: number) => {
    await db.grnReceipt.create({ data: { lotId, label: `G ${date}`, date: day(date), quantity } })
    await refreshCompletion(db, lotId)
  }
  const l1 = await lot('L1', { plannedDate: day('2026-09-10'), lotQty: 100, blockerId: w.lookups.rmBlocker.id })
  await receive(l1.id, '2026-09-20', 40)
  await receive(l1.id, '2026-10-02', 30)
  const l2 = await lot('L2', { plannedDate: day('2026-09-25'), revisedEta: day('2026-10-10'), lotQty: 50 })
  await receive(l2.id, '2026-09-28', 50)
  const l3 = await lot('L3', { plannedDate: day('2026-10-05'), lotQty: 100 })
  await receive(l3.id, '2026-09-15', 10)
  const l4 = await lot('L4', { plannedDate: day('2026-09-12'), lotQty: 70 })
  await db.lot.update({ where: { id: l4.id }, data: { deletedAt: new Date() } })
  await lot('L5', { productId: other.id, plannedDate: day('2026-09-05'), lotQty: 200 })
})
afterAll(() => close())

describe('GET /reports/month-end', () => {
  it('FR-5.1 compares the quantity of lots planned in the month with GRN received by month end', async () => {
    const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-09')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      month: '2026-09',
      label: 'September 2026',
      monthEnd: '2026-09-30',
      inProgress: false,
      planned: 350,
      received: 90,
      shortfall: 260,
    })
    expect(res.body.percent).toBeCloseTo((90 / 350) * 100)
  })
  it('FR-5.2 shows totals by product and by lot, largest shortfall first, and all GRN dated in the month', async () => {
    const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-09')
    expect(res.body.grnInMonth).toBe(100)
    expect(res.body.products.map((p: { product: { name: string }; shortfall: number }) => [p.product.name, p.shortfall])).toEqual([
      ['Woofer', 200],
      ['Soundbar', 60],
    ])
    expect(
      res.body.lots.map((r: { lot: { label: string }; received: number; shortfall: number }) => [r.lot.label, r.received, r.shortfall]),
    ).toEqual([
      ['L5', 0, 200],
      ['L1', 40, 60],
      ['L2', 50, 0],
    ])
    const l1 = res.body.lots.find((r: { lot: { label: string } }) => r.lot.label === 'L1')
    expect(l1.lot.blocker).toEqual({ id: w.lookups.rmBlocker.id, value: 'RM Blocker' })
    // Today's status counts every receipt, including the one after month end.
    expect(l1.statusToday).toBe('On Track, 35d overdue — RM Blocker (Factory Production)')
  })
  it('marks the current month as in progress', async () => {
    const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-10')
    expect(res.body).toMatchObject({ inProgress: true, planned: 100 })
  })
  it('needs a valid month and a session', async () => {
    for (const month of ['2026-13', '2026-9', ''])
      expect((await w.viewer.agent.get(`/api/v1/reports/month-end?month=${month}`)).status).toBe(422)
    expect((await request(app).get('/api/v1/reports/month-end?month=2026-09')).status).toBe(401)
  })
})

describe('GET /reports/month-end/export.csv', () => {
  it("exports the month's lots with the demo columns", async () => {
    const res = await w.viewer.agent.get('/api/v1/reports/month-end/export.csv?month=2026-09')
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="?month-end-2026-09\.csv"?$/)
    const lines = res.text.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      '"Month","Product","Variant","Segment","Lot","PlannedDate","PlannedQty","ReceivedByMonthEnd","Shortfall","Blocker","BlockerDescription","StatusToday"',
    )
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('"2026-09","Woofer"')
  })
})
```

Run: `pnpm --filter @boat/api test:int -- test/month-end.int.test.ts`
Expected: FAIL. `/api/v1/reports/month-end` answers the JSON 404.

- [ ] **Step 2: Implement the report**

Create `apps/api/src/modules/reports/month-end.service.ts`:

```ts
import { lotSummary, monthEnd, monthLabel, monthSummary } from '@boat/domain/calculations'
import type { RecordsDeps } from '../../core/clock'
import { toCsv } from '../../core/csv'
import { fromDbDate, toDbDate } from '../../core/dates'
import { lotInclude, toDomainLot, toDomainReceipt } from '../lots/lot-view'

const activeLot = { deletedAt: null, product: { is: { deletedAt: null } } }

// FR-5.1 and FR-5.2 with the domain's monthSummary, so the figures are the demo's. SQL picks the
// lots originally planned in the month (a revised ETA doesn't move them) and their receipts;
// monthSummary counts those dated up to month end.
export async function monthEndReport({ db, clock }: RecordsDeps, month: string) {
  const date = await clock.today()
  const start = toDbDate(`${month}-01`)!
  const end = monthEnd(month)
  const rows = await db.lot.findMany({
    where: { ...activeLot, plannedDate: { gte: start, lte: toDbDate(end)! } },
    include: lotInclude,
  })
  const receipts = await db.grnReceipt.findMany({
    where: { deletedAt: null, lotId: { in: rows.map((r) => r.id) } },
  })
  const inMonth = await db.grnReceipt.aggregate({
    where: { deletedAt: null, date: { gte: start, lte: toDbDate(end)! }, lot: { is: activeLot } },
    _sum: { quantity: true },
  })
  const domainReceipts = receipts.map(toDomainReceipt)
  const summary = monthSummary(rows.map(toDomainLot), domainReceipts, month)
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const productOf = (productId: string) => rows.find((r) => r.productId === productId)!.product
  return {
    month,
    label: monthLabel(month),
    monthEnd: end,
    inProgress: date <= end,
    planned: summary.planned,
    received: summary.received,
    shortfall: summary.shortfall,
    percent: summary.percent,
    // Every receipt dated in the month, for any lot, as the demo's grnInMonth.
    grnInMonth: inMonth._sum.quantity ?? 0,
    products: summary.products.map((p) => ({
      product: productOf(p.productId),
      lots: p.lots,
      planned: p.planned,
      received: p.received,
      shortfall: p.shortfall,
    })),
    lots: summary.lots.map((r) => {
      const row = rowById.get(r.lot.id)!
      return {
        lot: {
          id: row.id,
          label: row.label,
          plannedDate: fromDbDate(row.plannedDate),
          product: row.product,
          blocker: row.blocker,
          blockerDescription: row.blockerDescription,
        },
        planned: r.planned,
        received: r.received,
        shortfall: r.shortfall,
        statusToday: lotSummary(r.lot, domainReceipts.filter((g) => g.lotId === r.lot.id), date),
      }
    }),
  }
}

// The demo's month-end CSV columns (MonthEnd.tsx).
const csvHeaders = [
  'Month',
  'Product',
  'Variant',
  'Segment',
  'Lot',
  'PlannedDate',
  'PlannedQty',
  'ReceivedByMonthEnd',
  'Shortfall',
  'Blocker',
  'BlockerDescription',
  'StatusToday',
]

export async function monthEndCsv(deps: RecordsDeps, month: string) {
  const report = await monthEndReport(deps, month)
  const rows = report.lots.map((r) => ({
    Month: month,
    Product: r.lot.product.name,
    Variant: r.lot.product.variant,
    Segment: r.lot.product.segment.value,
    Lot: r.lot.label,
    PlannedDate: r.lot.plannedDate ?? '',
    PlannedQty: r.planned,
    ReceivedByMonthEnd: r.received,
    Shortfall: r.shortfall,
    Blocker: r.lot.blocker?.value ?? '',
    BlockerDescription: r.lot.blockerDescription,
    StatusToday: r.statusToday,
  }))
  return { filename: `month-end-${month}.csv`, body: toCsv(csvHeaders, rows) }
}
```

`inProgress` is "today is on or before the month's last day". That is true for the current month and for future months; the demo only ever shows past months and the current one.

- [ ] **Step 3: Implement the router and mount it**

Create `apps/api/src/modules/reports/reports.router.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { requireSignedIn } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { parseInput } from '../../core/parse'
import { monthEndCsv, monthEndReport } from './month-end.service'

const monthQuery = z.object({
  month: z
    .string({ error: 'Choose a month.' })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Use the format YYYY-MM.' }),
})

export function reportsRouter(deps: RecordsDeps) {
  const router = Router()

  router.get('/month-end', requireSignedIn(), async (req, res) => {
    res.json(await monthEndReport(deps, parseInput(monthQuery, req.query).month))
  })

  router.get('/month-end/export.csv', requireSignedIn(), async (req, res) => {
    const { filename, body } = await monthEndCsv(deps, parseInput(monthQuery, req.query).month)
    res.type('text/csv; charset=utf-8').attachment(filename).send(body)
  })

  return router
}
```

In `apps/api/src/api.ts`, import `reportsRouter` from `./modules/reports/reports.router` and mount it after `/shipments`:

```ts
  mount(api, '/reports', reportsRouter(records))
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /reports/month-end signedIn',
        'GET /reports/month-end/export.csv signedIn',
```

- [ ] **Step 4: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 5: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add the month-end summary and its CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: JSON export in the demo's backup format

FR-9.1 (export). Every active record maps back to the browser's shapes, with dropdowns as text and empty dates as `''`. The result is a file the demo can import, and it passes `@boat/domain/backup`'s checks. Deleted records and their history stay out. The same mapping gives Task 7 the database's current state for merge validation.

**Files:**
- Create: `apps/api/src/modules/data-transfer/backup-mapping.ts`
- Create: `apps/api/src/modules/data-transfer/export.service.ts`, `apps/api/src/modules/data-transfer/data.router.ts`
- Modify: `apps/api/src/api.ts`, `apps/api/src/api.test.ts`
- Test: `apps/api/test/data-export.int.test.ts`

**Interfaces:**
- Consumes: from Phase 3, `lotInclude`, `batchInclude`, `toDomainLot`, `toDomainBatch`, `toDomainReceipt`; from Task 3, `shipmentInclude`, `toDomainShipment`, `toDomainItems`; `BACKUP_APP`, `SCHEMA_VERSION`, `Backup` from `@boat/domain/backup`.
- Produces:
  - `currentDataSet(db: Db): Promise<DataSet>` (active records only, history only for active parents)
  - `exportBackup(db: Db): Promise<Backup>`
  - `dataRouter(deps)`, with route `GET /data/export` (`exportBackup`), sent as an attachment named `boat-backup-YYYY-MM-DD.json`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/data-export.int.test.ts`:

```ts
import { parseImport, validateRelations } from '@boat/domain/backup'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, lotBody, makeLookup, makeRecordsWorld, type RecordsWorld, shipmentBody, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
let lotId: string
let goneLotId: string
let shipmentId: string

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  const lot = await w.planner.send(
    'post',
    '/api/v1/lots',
    lotBody(w, { label: 'Lot A', rmMode: 'components', componentIds: [w.lookups.pcb.id], blockerId: w.lookups.rmBlocker.id }),
  )
  lotId = lot.body.id
  await w.planner.send('post', `/api/v1/lots/${lotId}/rm-batches`, { componentId: w.lookups.pcb.id, label: 'B1', receivedQty: 40 })
  await w.planner.send('post', `/api/v1/lots/${lotId}/grn-receipts`, { label: 'G1', date: '2026-10-10', quantity: 30 })
  await w.planner.send('post', `/api/v1/lots/${lotId}/notes`, { message: 'Supplier called' })
  const gone = await w.planner.send('post', '/api/v1/lots', lotBody(w, { label: 'Gone' }))
  goneLotId = gone.body.id
  await w.admin.send('delete', `/api/v1/lots/${goneLotId}`)
  const stage = await makeLookup(db, 'shipmentStage', 'At Sea')
  const shipment = await w.planner.send('post', '/api/v1/shipments', shipmentBody(w, { number: 'INV-1', stageId: stage.id, plannedEta: '2026-10-04' }))
  shipmentId = shipment.body.id
  await w.planner.send('patch', `/api/v1/shipments/${shipmentId}`, { revisedEta: '2026-10-09', etaChangeReason: 'Port', version: 1 })
})
afterAll(() => close())

const exportFile = async () => {
  const res = await w.planner.agent.get('/api/v1/data/export')
  expect(res.status).toBe(200)
  return res
}

describe('GET /data/export', () => {
  it('FR-9.1 exports every active record in the demo backup format', async () => {
    const res = await exportFile()
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="?boat-backup-\d{4}-\d{2}-\d{2}\.json"?$/)
    expect(res.body).toMatchObject({ app: 'Supply Chain Control Tower', schemaVersion: 1 })
    const data = parseImport(res.body)
    expect(() => validateRelations(data)).not.toThrow()
    const lot = data.lots.find((l) => l.id === lotId)!
    expect(lot).toMatchObject({
      label: 'Lot A',
      category: 'BAU',
      status: 'On Track',
      stage: 'Factory Production',
      rmMode: 'components',
      rmComponents: ['PCB'],
      blockerCategory: 'RM Blocker',
      plannedDate: '',
      ems: '',
    })
    expect(data.rmBatches.filter((b) => b.lotId === lotId)).toMatchObject([{ component: 'PCB', receivedQty: 40, plannedDate: '' }])
    expect(data.grnReceipts.filter((r) => r.lotId === lotId)).toMatchObject([{ date: '2026-10-10', quantity: 30 }])
    expect(data.shipments.find((s) => s.id === shipmentId)).toMatchObject({
      number: 'INV-1',
      stage: 'At Sea',
      plannedEta: '2026-10-04',
      revisedEta: '2026-10-09',
      actualArrival: '',
    })
    expect(data.shipmentItems.filter((i) => i.shipmentId === shipmentId)).toMatchObject([{ productId: w.product.id, quantity: 100 }])
    expect(data.etaRevisions).toMatchObject([{ shipmentId, previousDate: '2026-10-04', newDate: '2026-10-09', reason: 'Port' }])
    expect(data.activityLogs).toContainEqual(
      expect.objectContaining({ entityType: 'lot', entityId: lotId, kind: 'note', message: 'Supplier called', actor: 'Test planner' }),
    )
    expect(data.lookupValues).toContainEqual(expect.objectContaining({ kind: 'status', value: 'On Track' }))
    expect(data.settings).toContainEqual(expect.objectContaining({ key: 'initialized', value: 'server' }))
  })
  it('leaves deleted records and their history out', async () => {
    const data = parseImport((await exportFile()).body)
    expect(data.lots.map((l) => l.id)).not.toContain(goneLotId)
    expect(data.activityLogs.map((a) => a.entityId)).not.toContain(goneLotId)
  })
  it('FR-9.1 lets admins and planners export, and nobody else', async () => {
    expect((await w.admin.agent.get('/api/v1/data/export')).status).toBe(200)
    for (const user of [w.poc, w.viewer]) expect((await user.agent.get('/api/v1/data/export')).status).toBe(403)
  })
})
```

Run: `pnpm --filter @boat/api test:int -- test/data-export.int.test.ts`
Expected: FAIL. `/api/v1/data/export` answers the JSON 404.

- [ ] **Step 2: Implement the mapping and export**

Create `apps/api/src/modules/data-transfer/backup-mapping.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { DataSet } from '@boat/domain/models'
import { fromDbDate } from '../../core/dates'
import type { Db } from '../../core/prisma'
import { batchInclude, lotInclude, toDomainBatch, toDomainLot, toDomainReceipt } from '../lots/lot-view'
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
    db.product.findMany({ where: active, include: { segment: true }, orderBy: { createdAt: 'asc' } }),
    db.lot.findMany({ where: { ...active, product: { is: active } }, include: lotInclude, orderBy: { createdAt: 'asc' } }),
    db.shipment.findMany({ where: active, include: shipmentInclude, orderBy: { createdAt: 'asc' } }),
    db.lookupValue.findMany({ where: active, orderBy: [{ kind: 'asc' }, { sort: 'asc' }] }),
    db.appSetting.findMany(),
  ])
  const lotIds = lots.map((l) => l.id)
  const shipmentIds = shipments.map((s) => s.id)
  const [batches, receipts, revisions, history] = await Promise.all([
    db.rmBatch.findMany({ where: { ...active, lotId: { in: lotIds } }, include: batchInclude, orderBy: { createdAt: 'asc' } }),
    db.grnReceipt.findMany({ where: { ...active, lotId: { in: lotIds } }, orderBy: { createdAt: 'asc' } }),
    db.etaRevision.findMany({ where: { shipmentId: { in: shipmentIds } }, orderBy: { createdAt: 'asc' } }),
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
    products: products.map((p) => ({ ...stamps(p), name: p.name, variant: p.variant, segment: p.segment.value })),
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
    lookupValues: lookups.map((v) => ({ ...stamps(v), kind: v.kind, value: v.value, sort: v.sort })),
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
```

Create `apps/api/src/modules/data-transfer/export.service.ts`:

```ts
import { type Backup, BACKUP_APP, SCHEMA_VERSION } from '@boat/domain/backup'
import type { Db } from '../../core/prisma'
import { currentDataSet } from './backup-mapping'

// FR-9.1: the demo's backup format, so a server export imports into the demo and back.
export async function exportBackup(db: Db): Promise<Backup> {
  return {
    app: BACKUP_APP,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: await currentDataSet(db),
  }
}
```

Create `apps/api/src/modules/data-transfer/data.router.ts`:

```ts
import { Router } from 'express'
import { requirePermission } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { exportBackup } from './export.service'

export function dataRouter(deps: RecordsDeps) {
  const router = Router()

  router.get('/export', requirePermission('exportBackup'), async (_req, res) => {
    const date = await deps.clock.today()
    res.attachment(`boat-backup-${date}.json`).json(await exportBackup(deps.db))
  })

  return router
}
```

In `apps/api/src/api.ts`, import `dataRouter` from `./modules/data-transfer/data.router` and mount it after `/reports`:

```ts
  mount(api, '/data', dataRouter(records))
```

In `apps/api/src/api.test.ts`, add this row to the table:

```ts
        'GET /data/export exportBackup',
```

- [ ] **Step 3: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 4: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Export the database in the demo's backup format

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: JSON import (merge or replace) and reset

FR-9.1 (import) and FR-9.2. Import follows the demo's `importData`, with these rules:
- **Validation first:** parse the file, then validate what the database will hold afterwards, in merge mode the current records with the incoming ones overwriting by id.
- **One transaction:** everything is written or nothing is.
- **Ids are kept.** A record whose id already exists, active or soft-deleted, is overwritten and revived. That makes restoring a backup after a replace work. History and ETA revisions are insert-only, so an entry whose id already exists is skipped.
- **Dropdown values match by text, ignoring case,** including the system values. Values the database lacks are created. Dropdown values are Settings, not data, so a replace keeps them and a reset doesn't touch them. Users' POC links depend on them.
- **Settings:** only the server's two settings come across, and only valid values.
- **Reset** soft-deletes every business record after the typed phrase.

**Files:**
- Modify: `apps/api/src/modules/settings/settings.service.ts` (`knownTimeZone`, `forget`), `apps/api/src/modules/settings/settings.router.ts`
- Create: `apps/api/src/modules/data-transfer/reset.service.ts`, `apps/api/src/modules/data-transfer/import.service.ts`
- Modify: `apps/api/src/modules/data-transfer/data.router.ts`, `apps/api/src/app.ts`, `apps/api/src/api.ts`, `apps/api/src/api.test.ts`
- Test: `apps/api/test/data-import.int.test.ts`

**Interfaces:**
- Consumes: `parseImport`, `validateRelations`, `BackupError` from `@boat/domain/backup`; `dataKeys`, `DataSet` from `@boat/domain/models`; from Task 6, `currentDataSet`; from Phase 3, `refreshCompletion`, `toDbDate`.
- Produces:
  - `knownTimeZone(tz: string): boolean` (moved to `settings.service.ts`) and `SettingsService.forget(): void`
  - `dataLock`, `resetPhrase = 'RESET ALL DATA'`, `softDeleteBusinessRecords(db, userId)` → counts, `resetData(db, user, confirm)`
  - `type ImportMode = 'merge' | 'replace'`, `importBackup(db, settings, user, raw, mode)` → `{ mode, imported: Record<keyof DataSet, number> }`
  - `dataRouter(deps, settings)`, which adds `POST /data/import?mode=merge|replace` (`manageData`, 20 MB) and `POST /data/reset` (`manageData`) → `{ deleted }`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/data-import.int.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDatabase } from './support/db'
import { fixedNow, makeRecordsWorld, testApp } from './support/fixtures'

const samplePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/sample-test-backup.json')
type Rows = Record<string, Record<string, unknown>[]>
const sample = () => JSON.parse(readFileSync(samplePath, 'utf8')) as { data: Rows } & Record<string, unknown>
const lotId = (backup: { data: Rows }, label: string) => backup.data.lots.find((l) => l.label === label)!.id as string

// Each test gets its own database, because imports replace and reset everything.
let fresh: Awaited<ReturnType<typeof createTestDatabase>>
afterEach(() => fresh.close())
async function world() {
  fresh = await createTestDatabase()
  const app = testApp(fresh.db, { now: fixedNow })
  const w = await makeRecordsWorld(fresh.db, app)
  const importFile = (body: unknown, mode = 'replace', user = w.admin) =>
    user.send('post', `/api/v1/data/import?mode=${mode}`, body as object)
  return { db: fresh.db, app, w, importFile }
}

describe('POST /data/import', () => {
  it('FR-9.1 replaces the data with a backup, soft-deleting the current records', async () => {
    const { db, w, importFile } = await world()
    const res = await importFile(sample())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      mode: 'replace',
      imported: {
        products: 4,
        lots: 4,
        rmBatches: 6,
        grnReceipts: 4,
        shipments: 3,
        shipmentItems: 4,
        etaRevisions: 1,
        activityLogs: 2,
        lookupValues: 44,
        settings: 1,
      },
    })
    expect(await db.product.count({ where: { deletedAt: null } })).toBe(4)
    expect((await db.product.findUniqueOrThrow({ where: { id: w.product.id } })).deletedAt).not.toBeNull()
    // Dropdown values are Settings: the world's values survive a replace.
    expect((await db.lookupValue.findUniqueOrThrow({ where: { id: w.lookups.pocA.id } })).deletedAt).toBeNull()
    const backup = sample()
    const done = (await w.viewer.agent.get(`/api/v1/lots/${lotId(backup, 'TEST-EP-002')}`)).body
    expect(done).toMatchObject({ completedOn: '2026-10-05', computed: { grnTotal: 500, completed: true } })
    const parts = (await w.viewer.agent.get(`/api/v1/lots/${lotId(backup, 'TEST-EP-001')}`)).body
    expect(parts.components.map((c: { value: string }) => c.value)).toEqual(['Battery', 'PCBA', 'Plastic'])
  })
  it('FR-9.1 checks the whole backup first, so a bad one changes nothing', async () => {
    const { db, importFile } = await world()
    const bad = sample()
    bad.data.grnReceipts.push({ ...bad.data.grnReceipts[1], id: '0b7f6b1e-0000-4000-8000-000000000001', quantity: 400 })
    const res = await importFile(bad)
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ file: 'GRN exceeds lot quantity for TEST-EP-002.' })
    expect(await db.product.count({ where: { deletedAt: null } })).toBe(1)
  })
  it("refuses a backup that breaks the database's rules, naming the record", async () => {
    const { importFile } = await world()
    const early = sample()
    early.data.shipments[0].plannedEta = '2026-09-01'
    expect((await importFile(early)).body.fields).toEqual({
      file: 'Shipment TEST-SEA-001 has an ETA or arrival before its ETD.',
    })
    const nul = sample()
    nul.data.lots[0].label = 'TEST\u0000'
    expect((await importFile(nul)).body.fields).toEqual({ file: 'Invalid lots.label.' })
    expect((await importFile({ app: 'Something else' })).body.fields).toEqual({
      file: 'Unsupported JSON backup or schema version.',
    })
  })
  it('restores the same backup again after a replace', async () => {
    const { db, w, importFile } = await world()
    expect((await importFile(sample())).status).toBe(200)
    expect((await importFile(sample())).status).toBe(200)
    expect(await db.lot.count({ where: { deletedAt: null } })).toBe(4)
    expect(await db.grnReceipt.count({ where: { deletedAt: null } })).toBe(4)
    const backup = sample()
    const note = backup.data.activityLogs[0].id as string
    expect(await db.activityLog.count({ where: { id: note } })).toBe(1)
    const lot = (await w.viewer.agent.get(`/api/v1/lots/${lotId(backup, 'TEST-EP-002')}`)).body
    expect(lot.computed.grnTotal).toBe(500)
  })
  it('FR-9.1 merges: new records come in and records with the same id are overwritten', async () => {
    const { db, w, importFile } = await world()
    await importFile(sample())
    const next = sample()
    next.data.products[0].name = 'Renamed Speaker'
    next.data.products.push({
      ...next.data.products[1],
      id: '0b7f6b1e-0000-4000-8000-000000000002',
      name: 'Brand New',
    })
    const res = await importFile(next, 'merge')
    expect(res.status).toBe(200)
    expect(await db.product.count({ where: { deletedAt: null } })).toBe(5)
    const names = (await w.viewer.agent.get('/api/v1/products')).body.items.map((p: { name: string }) => p.name)
    expect(names).toEqual(expect.arrayContaining(['Renamed Speaker', 'Brand New']))
  })
  it('reuses dropdown values that differ only in case, system values included', async () => {
    const { db, importFile } = await world()
    const backup = sample()
    for (const v of backup.data.lookupValues) if (v.value === 'On Track') v.value = 'on track'
    for (const l of backup.data.lots) if (l.status === 'On Track') l.status = 'on track'
    expect((await importFile(backup, 'merge')).status).toBe(200)
    const onTrack = await db.lookupValue.findMany({ where: { kind: 'status', value: 'On Track', deletedAt: null } })
    expect(onTrack).toHaveLength(1)
    expect(onTrack[0].systemKey).toBe('on_track')
    const lot = await db.lot.findUniqueOrThrow({ where: { id: lotId(backup, 'TEST-EP-002') } })
    expect(lot.statusId).toBe(onTrack[0].id)
  })
  it('refuses a merge that would give two products the same name and variant', async () => {
    const { importFile } = await world()
    const backup = sample()
    Object.assign(backup.data.products[0], { name: 'soundbar', variant: 'x1' })
    const res = await importFile(backup, 'merge')
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ file: 'Product soundbar duplicates another product name and variant.' })
  })
  it('infers which ETA each revision changed', async () => {
    const { db, importFile } = await world()
    const backup = sample()
    backup.data.etaRevisions.push({
      ...backup.data.etaRevisions[0],
      id: '0b7f6b1e-0000-4000-8000-000000000003',
      reason: 'Original plan: supplier',
    })
    await importFile(backup)
    const kinds = (await db.etaRevision.findMany({ orderBy: { reason: 'asc' } })).map((r) => [r.reason, r.kind])
    expect(kinds).toEqual([
      ['Original plan: supplier', 'planned'],
      ['Port congestion', 'current'],
    ])
  })
  it('brings in valid server settings and ignores the rest', async () => {
    const { w, importFile } = await world()
    const backup = sample()
    const row = backup.data.settings[0]
    backup.data.settings.push(
      { ...row, id: '0b7f6b1e-0000-4000-8000-000000000004', key: 'timeZone', value: 'Asia/Dubai' },
      { ...row, id: '0b7f6b1e-0000-4000-8000-000000000005', key: 'idleTimeoutMinutes', value: '30' },
      { ...row, id: '0b7f6b1e-0000-4000-8000-000000000006', key: 'lockMinutes', value: '5' },
    )
    await importFile(backup)
    expect((await w.viewer.agent.get('/api/v1/settings')).body).toEqual({
      timeZone: 'Asia/Dubai',
      idleTimeoutMinutes: 30,
    })
  })
  it('takes bodies over 1 MB, up to 20 MB', async () => {
    const { w } = await world()
    const post = (text: string) =>
      w.admin.agent
        .post('/api/v1/data/import?mode=replace')
        .set('x-csrf-token', w.admin.csrf)
        .set('content-type', 'application/json')
        .send(text)
    expect((await post(JSON.stringify(sample()) + ' '.repeat(2_000_000))).status).toBe(200)
    expect((await post(JSON.stringify(sample()) + ' '.repeat(21_000_000))).status).toBe(413)
  })
  it('FR-9.1 lets only admins import, in a known mode', async () => {
    const { w, importFile } = await world()
    expect((await importFile(sample(), 'replace', w.planner)).status).toBe(403)
    expect((await importFile(sample(), 'append')).status).toBe(422)
  })
})

describe('POST /data/reset', () => {
  it('FR-9.2 soft-deletes every business record after the typed phrase', async () => {
    const { db, w, importFile } = await world()
    await importFile(sample())
    const wrong = await w.admin.send('post', '/api/v1/data/reset', { confirm: 'reset' })
    expect(wrong.status).toBe(422)
    expect(wrong.body.fields).toEqual({ confirm: 'Type RESET ALL DATA to confirm.' })
    expect((await w.planner.send('post', '/api/v1/data/reset', { confirm: 'RESET ALL DATA' })).status).toBe(403)
    const res = await w.admin.send('post', '/api/v1/data/reset', { confirm: 'RESET ALL DATA' })
    expect(res.status).toBe(200)
    expect(res.body.deleted).toMatchObject({ products: 4, lots: 4, shipments: 3, grnReceipts: 4 })
    expect((await w.viewer.agent.get('/api/v1/lots')).body.total).toBe(0)
    expect(await db.lot.count()).toBe(4)
    expect(await db.lookupValue.count({ where: { deletedAt: null, kind: 'status' } })).toBeGreaterThan(0)
  })
})
```

Run: `pnpm --filter @boat/api test:int -- test/data-import.int.test.ts`
Expected: FAIL. `/api/v1/data/import` answers the JSON 404.

- [ ] **Step 2: Share the time-zone check and add `forget`**

In `apps/api/src/modules/settings/settings.service.ts`, move `ianaName` and `knownTimeZone` (with their comment) from `settings.router.ts`, and export `knownTimeZone`. Inside `createSettingsService`, add:

```ts
  // For writes that bypass update() (an import), so the next read reloads.
  function forget() {
    cached = undefined
  }
```

and return `{ get, update, forget }`. In `settings.router.ts`, delete the moved code and import `knownTimeZone` from `./settings.service`.

Run: `pnpm --filter @boat/api test:int -- test/settings.int.test.ts`
Expected: PASS.

- [ ] **Step 3: Implement reset**

Create `apps/api/src/modules/data-transfer/reset.service.ts`:

```ts
import { ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import type { Db } from '../../core/prisma'
import type { PrismaClient } from '../../generated/prisma/client'

// Imports and resets take this transaction lock, so they run one at a time.
export const dataLock = 4_201_015
export const resetPhrase = 'RESET ALL DATA'

// Every business record people see: products, lots and their entries, shipments and their lines.
// Dropdown values, users, settings and history stay. Nothing is erased (FR-9.2).
export async function softDeleteBusinessRecords(db: Db, userId: string) {
  const change = { where: { deletedAt: null }, data: { deletedAt: new Date(), deletedBy: userId } }
  return {
    shipmentItems: (await db.shipmentItem.updateMany(change)).count,
    shipments: (await db.shipment.updateMany(change)).count,
    grnReceipts: (await db.grnReceipt.updateMany(change)).count,
    rmBatches: (await db.rmBatch.updateMany(change)).count,
    lotComponents: (await db.lotComponent.updateMany(change)).count,
    lots: (await db.lot.updateMany(change)).count,
    products: (await db.product.updateMany(change)).count,
  }
}

export async function resetData(db: PrismaClient, user: SessionUser, confirm: string) {
  if (confirm !== resetPhrase) throw new ValidationError({ confirm: `Type ${resetPhrase} to confirm.` })
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${dataLock})`
      return softDeleteBusinessRecords(tx, user.id)
    },
    { timeout: 60_000 },
  )
}
```

- [ ] **Step 4: Implement import**

Create `apps/api/src/modules/data-transfer/import.service.ts`:

```ts
import { BackupError, parseImport, validateRelations } from '@boat/domain/backup'
import { type DataSet, dataKeys, type LookupKind } from '@boat/domain/models'
import { ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { toDbDate } from '../../core/dates'
import type { Db } from '../../core/prisma'
import type { PrismaClient } from '../../generated/prisma/client'
import { refreshCompletion } from '../lots/lot-lock'
import { knownTimeZone, type SettingsService } from '../settings/settings.service'
import { currentDataSet } from './backup-mapping'
import { dataLock, softDeleteBusinessRecords } from './reset.service'

export type ImportMode = 'merge' | 'replace'
type Ref = (kind: LookupKind, value: string) => string | null

const folded = (s: string) => s.trim().toLowerCase()
const keyOf = (kind: string, value: string) => `${kind}\u0000${folded(value)}`
const date = (s: string) => toDbDate(s || null)
const times = (r: { createdAt: string; updatedAt: string }) => ({
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
})
const revive = { deletedAt: null, deletedBy: null }

// The demo's messages name the problem; the API reports them against the uploaded file.
function asFileError(err: unknown): never {
  if (err instanceof BackupError) throw new ValidationError({ file: err.message })
  throw err
}

const byId = <T extends { id: string }>(current: T[], incoming: T[]) => [
  ...new Map([...current, ...incoming].map((row) => [row.id, row])).values(),
]

// What the database will hold afterwards, for validateRelations. Merge: current records, with
// incoming ones overwriting by id (the demo's merge). Replace: the incoming records only. Dropdown
// values always merge by text, and settings come only from the file.
function afterImport(current: DataSet, incoming: DataSet, mode: ImportMode): DataSet {
  const known = new Set(current.lookupValues.map((v) => keyOf(v.kind, v.value)))
  const lookupValues = [
    ...current.lookupValues,
    ...incoming.lookupValues.filter((v) => !known.has(keyOf(v.kind, v.value))),
  ]
  if (mode === 'replace') return { ...incoming, lookupValues }
  return {
    products: byId(current.products, incoming.products),
    lots: byId(current.lots, incoming.lots),
    rmBatches: byId(current.rmBatches, incoming.rmBatches),
    grnReceipts: byId(current.grnReceipts, incoming.grnReceipts),
    shipments: byId(current.shipments, incoming.shipments),
    shipmentItems: byId(current.shipmentItems, incoming.shipmentItems),
    etaRevisions: byId(current.etaRevisions, incoming.etaRevisions),
    activityLogs: byId(current.activityLogs, incoming.activityLogs),
    lookupValues,
    settings: incoming.settings,
  }
}

// Dropdown values match by kind and text, ignoring case: a backup's "on track" is the database's
// "On Track", system values included. Missing values are created. Backups refer to dropdowns by
// text, so a created value doesn't need the backup's id.
async function importLookups(db: Db, values: DataSet['lookupValues']): Promise<Ref> {
  const existing = await db.lookupValue.findMany({
    where: { deletedAt: null },
    select: { id: true, kind: true, value: true },
  })
  const ids = new Map(existing.map((v) => [keyOf(v.kind, v.value), v.id]))
  for (const v of values) {
    const key = keyOf(v.kind, v.value)
    if (ids.has(key)) continue
    const created = await db.lookupValue.create({ data: { kind: v.kind, value: v.value.trim(), sort: v.sort } })
    ids.set(key, created.id)
  }
  return (kind, value) => (value.trim() ? (ids.get(keyOf(kind, value)) ?? null) : null)
}

// Inserts new ids and overwrites existing ones, reviving rows a replace or an earlier delete
// soft-deleted.
async function upsertAll<T extends { id: string }>(
  rows: T[],
  findIds: (ids: string[]) => Promise<{ id: string }[]>,
  create: (rows: T[]) => Promise<unknown>,
  update: (row: T) => Promise<unknown>,
) {
  if (!rows.length) return
  const existing = new Set((await findIds(rows.map((r) => r.id))).map((r) => r.id))
  const fresh = rows.filter((r) => !existing.has(r.id))
  if (fresh.length) await create(fresh)
  for (const row of rows) if (existing.has(row.id)) await update(row)
}

async function writeRecords(db: Db, data: DataSet, ref: Ref, userId: string) {
  const ids = (ids: string[]) => ({ where: { id: { in: ids } }, select: { id: true } })

  const product = (p: DataSet['products'][number]) => ({
    name: p.name.trim(),
    variant: p.variant.trim(),
    segmentId: ref('segment', p.segment)!,
    ...times(p),
  })
  await upsertAll(
    data.products,
    (list) => db.product.findMany(ids(list)),
    (rows) => db.product.createMany({ data: rows.map((p) => ({ id: p.id, ...product(p) })) }),
    (p) => db.product.update({ where: { id: p.id }, data: { ...product(p), ...revive, version: { increment: 1 } } }),
  )

  // grn_total starts at 0 and refreshCompletion sets it from the receipts below, so the
  // "GRN ≤ lot quantity" check holds at every step.
  const lot = (l: DataSet['lots'][number]) => ({
    productId: l.productId,
    label: l.label.trim(),
    categoryId: ref('category', l.category)!,
    directFg: l.directFg,
    emsId: ref('ems', l.ems),
    pocId: ref('poc', l.poc),
    statusId: ref('status', l.status)!,
    stageId: ref('stage', l.stage)!,
    rmMode: l.rmMode,
    readyQty: l.readyQty,
    lotQty: l.lotQty,
    freshProductionQty: l.freshProductionQty,
    reworkQty: l.reworkQty,
    reworkReason: l.reworkReason,
    rmReadyDate: date(l.rmReadyDate),
    plannedDate: date(l.plannedDate),
    revisedEta: date(l.revisedEta),
    actualDate: date(l.actualDate),
    logisticsId: ref('logistics', l.logisticsMode),
    blockerId: ref('blocker', l.blockerCategory),
    blockerDescription: l.blockerDescription,
    followUpDate: date(l.followUpDate),
    followUpNote: l.followUpNote,
    grnTotal: 0,
    completedOn: null,
    ...times(l),
  })
  await upsertAll(
    data.lots,
    (list) => db.lot.findMany(ids(list)),
    (rows) => db.lot.createMany({ data: rows.map((l) => ({ id: l.id, ...lot(l) })) }),
    (l) => db.lot.update({ where: { id: l.id }, data: { ...lot(l), ...revive, version: { increment: 1 } } }),
  )
  // A lot's component choices are replaced by the backup's.
  const lotIds = data.lots.map((l) => l.id)
  await db.lotComponent.updateMany({
    where: { lotId: { in: lotIds }, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: userId },
  })
  await db.lotComponent.createMany({
    data: data.lots.flatMap((l) =>
      [...new Set(l.rmComponents)].map((c) => ({ lotId: l.id, componentId: ref('component', c)! })),
    ),
  })

  const batch = (b: DataSet['rmBatches'][number]) => ({
    lotId: b.lotId,
    componentId: ref('component', b.component)!,
    label: b.label.trim(),
    plannedQty: b.plannedQty,
    plannedDate: date(b.plannedDate),
    receivedQty: b.receivedQty,
    receivedDate: date(b.receivedDate),
    status: b.status,
    notes: b.notes,
    ...times(b),
  })
  await upsertAll(
    data.rmBatches,
    (list) => db.rmBatch.findMany(ids(list)),
    (rows) => db.rmBatch.createMany({ data: rows.map((b) => ({ id: b.id, ...batch(b) })) }),
    (b) => db.rmBatch.update({ where: { id: b.id }, data: { ...batch(b), ...revive } }),
  )

  const receipt = (r: DataSet['grnReceipts'][number]) => ({
    lotId: r.lotId,
    label: r.label.trim(),
    date: date(r.date)!,
    quantity: r.quantity,
    note: r.note,
    ...times(r),
  })
  await upsertAll(
    data.grnReceipts,
    (list) => db.grnReceipt.findMany(ids(list)),
    (rows) => db.grnReceipt.createMany({ data: rows.map((r) => ({ id: r.id, ...receipt(r) })) }),
    (r) => db.grnReceipt.update({ where: { id: r.id }, data: { ...receipt(r), ...revive } }),
  )
  for (const id of new Set([...lotIds, ...data.grnReceipts.map((r) => r.lotId)])) await refreshCompletion(db, id)

  const shipment = (s: DataSet['shipments'][number]) => ({
    number: s.number.trim(),
    vessel: s.vessel.trim(),
    etd: date(s.etd),
    plannedEta: date(s.plannedEta),
    revisedEta: date(s.revisedEta),
    actualArrival: date(s.actualArrival),
    stageId: ref('shipmentStage', s.stage),
    remarks: s.remarks,
    ...times(s),
  })
  await upsertAll(
    data.shipments,
    (list) => db.shipment.findMany(ids(list)),
    (rows) => db.shipment.createMany({ data: rows.map((s) => ({ id: s.id, ...shipment(s) })) }),
    (s) => db.shipment.update({ where: { id: s.id }, data: { ...shipment(s), ...revive, version: { increment: 1 } } }),
  )

  const item = (i: DataSet['shipmentItems'][number]) => ({
    shipmentId: i.shipmentId,
    productId: i.productId,
    quantity: i.quantity,
    ...times(i),
  })
  await upsertAll(
    data.shipmentItems,
    (list) => db.shipmentItem.findMany(ids(list)),
    (rows) => db.shipmentItem.createMany({ data: rows.map((i) => ({ id: i.id, ...item(i) })) }),
    (i) => db.shipmentItem.update({ where: { id: i.id }, data: { ...item(i), ...revive } }),
  )

  // History and ETA revisions are insert-only: an entry whose id is already there is the same
  // entry, so it is skipped. The backup doesn't say which ETA a revision changed; the demo starts
  // every planned-ETA reason with "Original plan".
  const knownRevisions = new Set(
    (await db.etaRevision.findMany(ids(data.etaRevisions.map((r) => r.id)))).map((r) => r.id),
  )
  await db.etaRevision.createMany({
    data: data.etaRevisions
      .filter((r) => !knownRevisions.has(r.id))
      .map((r) => ({
        id: r.id,
        shipmentId: r.shipmentId,
        kind: r.reason.startsWith('Original plan') ? ('planned' as const) : ('current' as const),
        previousDate: date(r.previousDate),
        newDate: date(r.newDate),
        reason: r.reason,
        createdAt: new Date(r.createdAt),
      })),
  })
  const knownEntries = new Set(
    (await db.activityLog.findMany(ids(data.activityLogs.map((a) => a.id)))).map((a) => a.id),
  )
  await db.activityLog.createMany({
    data: data.activityLogs
      .filter((a) => !knownEntries.has(a.id))
      .map((a) => ({
        id: a.id,
        entityType: a.entityType,
        entityId: a.entityId,
        kind: a.kind,
        message: a.message,
        actorName: a.actor ?? null,
        createdAt: new Date(a.createdAt),
      })),
  })
}

// Only the server's two settings come across, and only valid values. The demo's "initialized"
// record and anything unknown are ignored.
async function importSettings(db: Db, rows: DataSet['settings'], userId: string) {
  const put = (key: string, value: string | number) =>
    db.appSetting.upsert({
      where: { key },
      create: { key, value, updatedBy: userId },
      update: { value, updatedBy: userId },
    })
  for (const { key, value } of rows) {
    if (key === 'timeZone' && knownTimeZone(value)) await put(key, value)
    const minutes = Number(value)
    if (key === 'idleTimeoutMinutes' && /^\d+$/.test(value) && minutes >= 5 && minutes <= 720)
      await put(key, minutes)
  }
}

// FR-9.1 and FR-9.3: checks the whole file, then writes it in one transaction.
export async function importBackup(
  db: PrismaClient,
  settings: SettingsService,
  user: SessionUser,
  raw: unknown,
  mode: ImportMode,
) {
  let incoming: DataSet
  try {
    incoming = parseImport(raw)
  } catch (err) {
    asFileError(err)
  }
  const imported = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${dataLock})`
      try {
        validateRelations(afterImport(await currentDataSet(tx), incoming, mode))
      } catch (err) {
        asFileError(err)
      }
      if (mode === 'replace') await softDeleteBusinessRecords(tx, user.id)
      const ref = await importLookups(tx, incoming.lookupValues)
      await writeRecords(tx, incoming, ref, user.id)
      await importSettings(tx, incoming.settings, user.id)
      return Object.fromEntries(dataKeys.map((key) => [key, incoming[key].length])) as Record<keyof DataSet, number>
    },
    { timeout: 120_000, maxWait: 10_000 },
  )
  settings.forget()
  return { mode, imported }
}
```

- [ ] **Step 5: Give import its own body limit and add the routes**

In `apps/api/src/app.ts`, replace `app.use(express.json({ limit: '1mb' }))` with:

```ts
  // Every route reads JSON up to 1 MB, except a backup import, which parses its own body up to
  // 20 MB (data.router.ts).
  const json = express.json({ limit: '1mb' })
  app.use((req, res, next) => (req.path === '/api/v1/data/import' ? next() : json(req, res, next)))
```

Replace `apps/api/src/modules/data-transfer/data.router.ts` with:

```ts
import express, { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { parseInput } from '../../core/parse'
import type { SettingsService } from '../settings/settings.service'
import { exportBackup } from './export.service'
import { importBackup } from './import.service'
import { resetData, resetPhrase } from './reset.service'

const modeQuery = z.object({
  mode: z.enum(['merge', 'replace'], { error: 'Choose merge or replace.' }),
})
const resetBody = z.strictObject({ confirm: z.string({ error: `Type ${resetPhrase} to confirm.` }) })

export function dataRouter(deps: RecordsDeps, settings: SettingsService) {
  const router = Router()

  router.get('/export', requirePermission('exportBackup'), async (_req, res) => {
    const date = await deps.clock.today()
    res.attachment(`boat-backup-${date}.json`).json(await exportBackup(deps.db))
  })

  // The body is a whole backup, so it may be up to 20 MB (PRD).
  router.post('/import', requirePermission('manageData'), express.json({ limit: '20mb' }), async (req, res) => {
    const { mode } = parseInput(modeQuery, req.query)
    res.json(await importBackup(deps.db, settings, authOf(req).user, req.body, mode))
  })

  router.post('/reset', requirePermission('manageData'), async (req, res) => {
    const { confirm } = parseInput(resetBody, req.body)
    res.json({ deleted: await resetData(deps.db, authOf(req).user, confirm) })
  })

  return router
}
```

In `apps/api/src/api.ts`, change the mount to pass the settings service:

```ts
  mount(api, '/data', dataRouter(records, settings))
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'POST /data/import manageData',
        'POST /data/reset manageData',
```

- [ ] **Step 6: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS. The 1 MB tests in `app.test.ts` still pass, because only the import path skips the global parser.

- [ ] **Step 7: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Import backups in merge or replace mode, and reset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Phase 4 gate: the sample backup, the round trip and FR coverage

The roadmap's gate: `docs/sample-test-backup.json` imports, and its month-end figures match the demo's. "The demo's" here means the domain's `monthSummary` run on the backup itself, exactly as the browser runs it. This task also pins the export-import round trip, adds FR-5, FR-6 and FR-9 to the coverage check, and updates the docs.

**Files:**
- Test: `apps/api/test/sample-backup.int.test.ts`
- Modify: `apps/api/src/fr-coverage.test.ts`, `AGENTS.md`

**Interfaces:**
- Consumes: everything above; `monthSummary`, `lotSummary` from `@boat/domain/calculations`; `parseImport` from `@boat/domain/backup`.
- Produces: the gate test and an FR coverage list that now includes FR-5.1, FR-5.2, FR-6.1 to FR-6.5 and FR-9.1 to FR-9.3.

- [ ] **Step 1: Write the gate test**

Create `apps/api/test/sample-backup.int.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseImport } from '@boat/domain/backup'
import { lotSummary, monthSummary } from '@boat/domain/calculations'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, makeRecordsWorld, type RecordsWorld, testApp, testToday } from './support/fixtures'

const samplePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/sample-test-backup.json')
const sample = () => JSON.parse(readFileSync(samplePath, 'utf8'))
const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))

let db: PrismaClient
let close: () => Promise<void>
let w: RecordsWorld

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  w = await makeRecordsWorld(db, testApp(db, { now: fixedNow }))
})
afterAll(() => close())

const replaceWith = (body: unknown) => w.admin.send('post', '/api/v1/data/import?mode=replace', body as object)

describe('the sample backup', () => {
  it('FR-9.3 imports from the browser backup format (schema version 1)', async () => {
    const res = await replaceWith(sample())
    expect(res.status).toBe(200)
    expect(res.body.imported).toMatchObject({ products: 4, lots: 4, shipments: 3 })
  })
  it("FR-5.1 matches the demo's month-end figures (the Phase 4 gate)", async () => {
    const data = parseImport(sample())
    const demo = monthSummary(data.lots, data.grnReceipts, '2026-10')
    const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-10')
    expect(res.body).toMatchObject({
      planned: demo.planned,
      received: demo.received,
      shortfall: demo.shortfall,
      grnInMonth: demo.grnInMonth,
    })
    expect(res.body.percent).toBeCloseTo(demo.percent)
    type ApiLot = { lot: { id: string }; planned: number; received: number; shortfall: number }
    type ApiProduct = { product: { id: string }; lots: number; planned: number; received: number; shortfall: number }
    const lots = (rows: { id: string; planned: number; received: number; shortfall: number }[]) =>
      byId(rows).map((r) => [r.id, r.planned, r.received, r.shortfall])
    expect(lots(res.body.lots.map((r: ApiLot) => ({ ...r, id: r.lot.id })))).toEqual(
      lots(demo.lots.map((r) => ({ ...r, id: r.lot.id }))),
    )
    expect(
      byId(res.body.products.map((p: ApiProduct) => ({ ...p, id: p.product.id }))).map((p) => [p.id, p.lots, p.planned, p.received, p.shortfall]),
    ).toEqual(byId(demo.products.map((p) => ({ ...p, id: p.productId }))).map((p) => [p.id, p.lots, p.planned, p.received, p.shortfall]))
  })
  it("shows each lot's status line as the demo would", async () => {
    const data = parseImport(sample())
    for (const lot of data.lots) {
      const expected = lotSummary(lot, data.grnReceipts.filter((r) => r.lotId === lot.id), testToday)
      const res = await w.viewer.agent.get(`/api/v1/lots/${lot.id}`)
      expect(res.body.computed.summary, lot.label).toBe(expected)
    }
  })
  it('exports, replaces from that export, and exports the same data again', async () => {
    const first = (await w.admin.agent.get('/api/v1/data/export')).body
    expect((await replaceWith(first)).status).toBe(200)
    const second = (await w.admin.agent.get('/api/v1/data/export')).body
    // Settings get fresh ids on every export, and "initialized" is synthetic.
    type Row = { id: string; key?: string; value?: string }
    const comparable = (backup: { data: Record<string, Row[]> }) =>
      Object.fromEntries(
        Object.entries(backup.data).map(([table, rows]) => [
          table,
          table === 'settings'
            ? rows.filter((s) => s.key !== 'initialized').map((s) => [s.key, s.value])
            : byId(rows),
        ]),
      )
    expect(comparable(second)).toEqual(comparable(first))
  })
})
```

Run: `pnpm --filter @boat/api test:int -- test/sample-backup.int.test.ts`
Expected: PASS. The earlier tasks built everything this test uses, so it should pass the first time. If it fails, the difference it prints is a real bug: fix the code, not the test.

To check the test can fail, temporarily change `grnInMonth: inMonth._sum.quantity ?? 0` in `month-end.service.ts` to `grnInMonth: 0`. Run it: expected FAIL on `grnInMonth`. Put it back.

- [ ] **Step 2: Add the Phase 4 requirements to the coverage check**

In `apps/api/src/fr-coverage.test.ts`, add these ids to `required`, keeping the list in order:

```ts
  'FR-5.1',
  'FR-5.2',
  'FR-6.1',
  'FR-6.2',
  'FR-6.3',
  'FR-6.4',
  'FR-6.5',
```

after `'FR-4.4'`, and these after `'FR-8.3'`:

```ts
  'FR-9.1',
  'FR-9.2',
  'FR-9.3',
```

Change its first comment to say the list now covers FR-1 to FR-9.

Run: `pnpm --filter @boat/api test -- src/fr-coverage.test.ts`
Expected: PASS.

- [ ] **Step 3: Update AGENTS.md**

In `AGENTS.md`, append to the `apps/api` paragraph of "Project Structure & Module Organization":

```markdown
`shipments` follows the lots pattern (row lock, version, `validateShipment`, history), with ETA revisions written as the demo's `saveShipment` does. `reports` builds the month-end summary with the domain's `monthSummary`. `data-transfer` exports and imports the demo's backup format; backup validation lives in `@boat/domain/backup`, shared with the browser, so tighten it there.
```

- [ ] **Step 4: Run the full verification**

```bash
pnpm format:check && pnpm typecheck && pnpm test \
  && pnpm --filter @boat/domain test:coverage \
  && pnpm --filter @boat/api test:int && pnpm build
```

Expected: everything passes. `git diff dev --stat -- apps/web` shows only `db.ts` and `repository.ts` (Task 2's move).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Pin the sample backup's month-end figures and the export round trip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then finish the branch as agreed: merge into `dev` locally, or push `phase-4-shipments-and-reports` and open a pull request into `dev`.

---

## Phase 4 gate

- [ ] `sample-backup.int.test.ts` passes: the sample backup imports, and its month-end figures match the domain's `monthSummary` on the same file.
- [ ] `src/fr-coverage.test.ts` passes with FR-1 to FR-9.
- [ ] The full verification in Task 8, Step 4 passes.
- [ ] `api.test.ts` shows every route with an access check, and the permission table matches.
- [ ] The web app's import still works by hand (Task 2, Step 5).
