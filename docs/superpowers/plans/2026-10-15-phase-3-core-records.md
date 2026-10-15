# Phase 3: Core Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API takes over the demo's production records: dropdown values, products, lots, RM batches, GRN receipts, history and notes. Every rule in FR-1 to FR-4, FR-7 and FR-8 is enforced on the server and pinned by a passing integration test.

**Architecture:** Six new modules under `apps/api/src/modules/`: `lookups`, `products`, `lots` (with list, summary and CSV export), `rm-batches`, `grn-receipts` and `activity`. Services lock the lot row (`SELECT … FOR UPDATE`) before any change to a lot or its entries, check references and run the shared `@boat/domain` validators, write the change, then write a history entry in the same transaction. Reads map database rows to the browser's domain shapes, so the server computes flags, status lines and RM metrics with the same functions as the demo. List filters and summary counts run in SQL, and a parity test holds them to the domain's flags.

**Tech Stack:** As in Phase 2 (Express 5.3, Prisma 7.10 with `@prisma/adapter-pg`, PostgreSQL 17, zod 4, Vitest 5, Testcontainers 12, Supertest 7). No new dependencies.

**Spec:** [Supply Chain App — Backend PRD & Architecture](https://claude.ai/code/artifact/313da010-aa6a-4a87-be4b-2c401635a8cd) (rev 56). Sections: "Functional requirements" 1–4, 7 and 8, "Domain models and database schema", "REST API design" (conventions, error shape, endpoints for lookups, products, lots, RM batches, GRN receipts, activity and notes, and the lot detail example), "Business rules and calculations on the server" and "Testing strategy". Read the roadmap first, including "Where Phase 3 departs from the PRD": [2026-10-14-fullstack-roadmap.md](2026-10-14-fullstack-roadmap.md). The demo's behaviour is the reference for anything the PRD leaves open: `apps/web/src/repository.ts` (saves, deletes, history messages) and `apps/web/src/Production.tsx` (filters, sorts, CSV columns).

## Global Constraints

- Everything in the Phase 1 and Phase 2 Global Constraints still holds (Node 24, pnpm 10.33.2, TypeScript 7 strict, Prettier, pinned versions, soft delete only, commit format).
- No new dependencies.
- Dates go in and out as `YYYY-MM-DD` strings, or `null` when not set. A date that doesn't exist on the calendar (`2026-02-30`) is a 422, never a 500.
- Dropdown fields go in as ids named `<field>Id` (`statusId`, `componentIds`) and come out as `{ id, value }`.
- Quantities are whole numbers from 0 to 1,000,000,000.
- `PATCH` on products and lots needs the record's `version`. A stale version answers `409 { error: 'conflict', message, current }`, where `current` is the record as it now stands.
- `DELETE` soft-deletes (sets `deleted_at` and `deleted_by`) and answers 204. The record then reads as 404 and leaves every list, dropdown and summary.
- "Today" is the company date from the time-zone setting (default `Asia/Kolkata`), through `Clock`.
- Every change to a lot, an RM batch or a GRN receipt writes an `activity_logs` entry naming the user, in the same transaction as the change.
- Lots and activity lists are paged (`{ items, total, page, pageSize }`, default 50, max 200). Lookups and products are reference lists and come back whole as `{ items }`.
- Each integration test that pins a functional requirement starts its title with the requirement's id, e.g. `it('FR-4.2 refuses a receipt above the balance', …)`. Task 10's coverage test checks every id has one.
- No change to `apps/web`.
- Branch `phase-3-core-records` from `dev`; it merges back into `dev`.

## Review Focus

1. **Search text with `%` or `_`.** People search for "100%" or a label like "LOT_7". These must match literally, not act as wildcards. Pinned in Task 6.
2. **Impossible dates and huge quantities.** `2026-02-30` or a lot quantity of 3,000,000,000 would pass a shape check and then fail in Postgres with a 500. Both must be 422 with a field message. Pinned in Task 5.
3. **A dropdown id of the wrong kind.** Foreign keys check only that a lookup row exists, not its kind, so `statusId` set to a segment's id would save. It must be refused (FR-8.3). Pinned in Task 3 (segment) and Task 5 (every lot dropdown).
4. **SQL flags drifting from the domain.** List filters and summary counts compute overdue, due soon, follow-up, blocked, approval, RM incomplete, NPI and on-track in SQL, while detail views use `lotFlags` and `rmMetrics`. If they disagree, a card says 3 overdue and the list shows 2. Pinned by a parity test on every flag in Task 6.
5. **Spreadsheet formulas in CSV.** A lot label such as `=HYPERLINK(…)` would run as a formula when the export opens in Excel. Cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading apostrophe. Pinned in Task 6.

Also covered: two receipts racing past the lot quantity (Task 8), a POC changing plan fields (Task 5), a stale version (Tasks 3 and 5), and child routes on a deleted lot (Tasks 7–9).

---

## File Structure

```
apps/api/
├─ prisma/
│  ├─ schema.prisma                         # + @@index([followUpDate]) on Lot
│  └─ migrations/
│     ├─ 20261015120000_system_lookups/     # the six system values with system_key
│     └─ 20261015120100_lot_follow_up_index/
├─ src/
│  ├─ api.ts                                # + now in ApiDeps, Clock, five modules mounted
│  ├─ api.test.ts                           # + permission table rows
│  ├─ fr-coverage.test.ts                   # every FR-1–4, 7, 8 id has an integration test
│  ├─ core/
│  │  ├─ access.ts                          # + requireLotAccess()
│  │  ├─ audit.ts                           # Actor, actorOf, recordActivity
│  │  ├─ clock.ts                           # createClock(settings, now)
│  │  ├─ csv.ts                             # toCsv(headers, rows) with formula guard
│  │  └─ dates.ts                           # isoDate, optionalDate, toDbDate, fromDbDate
│  └─ modules/
│     ├─ lookups/
│     │  ├─ lookups.router.ts
│     │  ├─ lookups.service.ts              # list, create, rename/reorder, delete with in-use check
│     │  └─ resolve.ts                      # resolveLookups (FR-8.3), renameFields
│     ├─ products/
│     │  ├─ products.router.ts
│     │  └─ products.service.ts
│     ├─ lots/
│     │  ├─ lot-view.ts                     # row ↔ domain mapping, computed fields, lotView/lotDetail
│     │  ├─ lot-lock.ts                     # lockLot, lockLotForEdit, lotDenial, refreshCompletion
│     │  ├─ lot-deletion.ts                 # softDeleteLots (lots, products)
│     │  ├─ lot-list.ts                     # SQL filters, flags, sort, summary
│     │  ├─ lots.service.ts                 # create, update, delete, detail, list, CSV
│     │  └─ lots.router.ts
│     ├─ rm-batches/
│     │  ├─ rm-batches.service.ts
│     │  └─ rm-batches.router.ts            # POST under /lots, PATCH/DELETE under /rm-batches
│     ├─ grn-receipts/
│     │  ├─ grn-receipts.service.ts
│     │  └─ grn-receipts.router.ts
│     ├─ activity/
│     │  ├─ activity.service.ts
│     │  └─ activity.router.ts              # GET /lots/:id/activity, POST /lots/:id/notes
│     └─ settings/settings.router.ts        # time zone: IANA names only
└─ test/
   ├─ support/fixtures.ts                   # + lookups, products, lots, records world, fixed clock
   ├─ lookups.int.test.ts
   ├─ products.int.test.ts
   ├─ lots.int.test.ts
   ├─ lots-list.int.test.ts
   ├─ rm-batches.int.test.ts
   ├─ grn-receipts.int.test.ts
   ├─ activity.int.test.ts
   └─ perf.int.test.ts                      # PERF=1 only: 20,000 lots
```

Each module keeps Phase 2's shape: a router (HTTP, request shape) and a service (rules, transactions, Prisma). Child records have two routers. One is mounted at `/lots` for `POST /lots/:id/…`, and one at its own path for `PATCH` and `DELETE`. `mount()` records both for the route walk.

---

### Task 1: Clock, business dates, the lot-access guard and stricter time zones

Shared pieces the record modules need before any of them exist. The time-zone check carries over from the Phase 2 review: `Intl` accepts `+05:30`, `IST` and `asia/kolkata`, and other systems read those differently.

**Files:**
- Create: `apps/api/src/core/clock.ts`, `apps/api/src/core/clock.test.ts`
- Create: `apps/api/src/core/dates.ts`, `apps/api/src/core/dates.test.ts`
- Modify: `apps/api/src/core/access.ts`, `apps/api/src/core/access.test.ts`
- Modify: `apps/api/src/modules/settings/settings.router.ts`
- Test: `apps/api/test/settings.int.test.ts`

**Interfaces:**
- Consumes: `today(timeZone, at)` from `@boat/domain/calculations`; `SettingsService` from Phase 2.
- Produces:
  - `type Clock = { today(): Promise<string> }` and `createClock(settings: SettingsService, now?: () => Date): Clock`
  - `isoDate` (zod schema, a real `YYYY-MM-DD` date) and `optionalDate` (zod schema: `''` or `null` mean not set; output `string | null`)
  - `toDbDate(s: string | null): Date | null`, `fromDbDate(d: Date | null): string | null`
  - `requireLotAccess(): RequestHandler`, with access tag `'lotAccess'` (`Access` gains `'lotAccess'`)

- [ ] **Step 1: Create the branch**

```bash
git switch dev && git pull --ff-only
git switch -c phase-3-core-records
```

- [ ] **Step 2: Write the failing unit tests**

Create `apps/api/src/core/clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SettingsService } from '../modules/settings/settings.service'
import { createClock } from './clock'

const settingsIn = (timeZone: string) =>
  ({
    get: async () => ({ timeZone, idleTimeoutMinutes: 15 }),
    update: async () => ({ timeZone, idleTimeoutMinutes: 15 }),
  }) as SettingsService

describe('createClock', () => {
  // 20:00 UTC on 14 Oct is already 15 Oct in India.
  const now = () => new Date('2026-10-14T20:00:00Z')
  it('gives the date in the company time zone', async () => {
    expect(await createClock(settingsIn('Asia/Kolkata'), now).today()).toBe('2026-10-15')
    expect(await createClock(settingsIn('UTC'), now).today()).toBe('2026-10-14')
  })
  it('reads the real time by default', async () => {
    expect(await createClock(settingsIn('UTC')).today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
```

Create `apps/api/src/core/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fromDbDate, isoDate, optionalDate, toDbDate } from './dates'

describe('isoDate', () => {
  it('accepts real calendar dates', () => {
    for (const s of ['2026-10-15', '2024-02-29', '2026-12-31'])
      expect(isoDate.safeParse(s).success).toBe(true)
  })
  it('refuses other formats and days that do not exist', () => {
    for (const s of ['2026-02-30', '2025-02-29', '2026-13-01', '15/10/2026', '2026-1-5', ''])
      expect(isoDate.safeParse(s).success).toBe(false)
  })
})

describe('optionalDate', () => {
  it('reads "" and null as not set', () => {
    expect(optionalDate.parse('')).toBeNull()
    expect(optionalDate.parse(null)).toBeNull()
    expect(optionalDate.parse('2026-10-15')).toBe('2026-10-15')
    expect(optionalDate.safeParse('2026-02-30').success).toBe(false)
  })
})

describe('toDbDate and fromDbDate', () => {
  it('round-trip through UTC midnight', () => {
    const d = toDbDate('2026-10-15')!
    expect(d.toISOString()).toBe('2026-10-15T00:00:00.000Z')
    expect(fromDbDate(d)).toBe('2026-10-15')
    expect(toDbDate(null)).toBeNull()
    expect(fromDbDate(null)).toBeNull()
  })
})
```

In `apps/api/src/core/access.test.ts`, add `requireLotAccess` to the import from `./access`. Then add this inside `describe('accessOf', …)`:

```ts
  it('tags lot routes separately, so the permission table shows them', () => {
    expect(accessOf(requireLotAccess())).toBe('lotAccess')
  })
```

and append:

```ts
describe('requireLotAccess', () => {
  it('needs a session and the CSRF token, like requireSignedIn', async () => {
    expect((await request(appWith(undefined, requireLotAccess())).get('/')).status).toBe(401)
    expect((await request(appWith(signedInAs('poc'), requireLotAccess())).post('/')).status).toBe(
      403,
    )
    const res = await request(appWith(signedInAs('poc'), requireLotAccess()))
      .post('/')
      .set('x-csrf-token', 'csrf-1')
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test`
Expected: FAIL. `./clock` and `./dates` don't exist, and `requireLotAccess` is not exported.

- [ ] **Step 4: Implement the clock, dates and guard**

Create `apps/api/src/core/clock.ts`:

```ts
import { today } from '@boat/domain/calculations'
import type { SettingsService } from '../modules/settings/settings.service'

// "Today" as YYYY-MM-DD in the company time zone, for the no-future-date rules and lot flags.
// Tests pass a fixed now, so date rules don't depend on when the tests run.
export type Clock = { today(): Promise<string> }

export const createClock = (
  settings: SettingsService,
  now: () => Date = () => new Date(),
): Clock => ({
  async today() {
    return today((await settings.get()).timeZone, now())
  },
})
```

Create `apps/api/src/core/dates.ts`:

```ts
import { z } from 'zod'

// Business dates are YYYY-MM-DD with no time zone. Prisma returns Postgres `date` columns as
// Dates at UTC midnight, so every conversion goes through UTC.
const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export const isoDate = z
  .string({ error: 'Enter a date.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Use the format YYYY-MM-DD.' })
  .refine(realDate, { error: 'This date does not exist.' })

// Optional date fields take '' or null for "not set". A bad date reports isoDate's own message.
export const optionalDate = z.preprocess((v) => (v === '' ? null : v), isoDate.nullable())

export const toDbDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null)
export const fromDbDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
```

In `apps/api/src/core/access.ts`, widen the access type:

```ts
export type Access = 'public' | 'signedIn' | 'lotAccess' | Action
```

and add below `requireSignedIn`:

```ts
// Lot routes that a POC may use on their own lots. The same session and CSRF checks as
// requireSignedIn; the lot service then applies the per-lot check (full, progress or none),
// which needs the lot itself. The separate tag shows these routes in the permission table.
export const requireLotAccess = () =>
  tagged('lotAccess', (req, _res, next) => {
    signedIn(req)
    next()
  })
```

- [ ] **Step 5: Run the unit tests**

Run: `pnpm --filter @boat/api test`
Expected: PASS.

- [ ] **Step 6: Write the failing time-zone tests**

In `apps/api/test/settings.int.test.ts`, add these two cases to the `cases` array in "answers bad values with field errors":

```ts
      [{ timeZone: '+05:30' }, 'timeZone'],
      [{ timeZone: 'IST' }, 'timeZone'],
      [{ timeZone: 'asia/kolkata' }, 'timeZone'],
```

and add this test inside `describe('PATCH /settings', …)`:

```ts
  it('accepts IANA zone names, including ones with several parts', async () => {
    for (const timeZone of ['America/New_York', 'America/Argentina/Buenos_Aires', 'UTC']) {
      const res = await admin.send('patch', '/api/v1/settings', { timeZone })
      expect(res.status).toBe(200)
    }
    await admin.send('patch', '/api/v1/settings', { timeZone: 'Asia/Kolkata' })
  })
```

Run: `pnpm --filter @boat/api test:int -- test/settings.int.test.ts`
Expected: FAIL. `+05:30`, `IST` and `asia/kolkata` are accepted.

- [ ] **Step 7: Accept IANA names only**

In `apps/api/src/modules/settings/settings.router.ts`, replace `knownTimeZone` and its comment with:

```ts
// IANA names only ("Asia/Kolkata", "America/Argentina/Buenos_Aires", "UTC"). Intl also accepts
// offsets ("+05:30"), abbreviations ("IST") and any letter case, which other systems read
// differently, so those are refused even though today() would cope.
const ianaName = /^[A-Z][A-Za-z_-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/
const knownTimeZone = (tz: string) => {
  if (tz !== 'UTC' && !ianaName.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 8: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 9: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add the clock, business dates and lot-access guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Dropdown values (lookups) and the six system values

Admins manage the dropdown values for ten kinds. Because records now point at a value by id, a rename shows on every record at once, so renaming a value in use is allowed (PRD, "Domain models"). Deleting a value in use is still refused. The six values the calculations depend on are created by a migration, carry a `system_key`, and can't be renamed or deleted.

**Files:**
- Create: `apps/api/prisma/migrations/20261015120000_system_lookups/migration.sql`
- Create: `apps/api/src/modules/lookups/resolve.ts`
- Create: `apps/api/src/modules/lookups/lookups.service.ts`, `apps/api/src/modules/lookups/lookups.router.ts`
- Modify: `apps/api/src/api.ts`, `apps/api/src/api.test.ts`, `apps/api/test/support/fixtures.ts`
- Test: `apps/api/test/lookups.int.test.ts`

**Interfaces:**
- Consumes: `validateLookupValue`, `assertValid`, `ValidationError`, `FieldErrors` from `@boat/domain/validation`; from Phase 2, `ConflictError`, `NotFoundError`, `Db`, `parseInput`, `parseId`, `requireSignedIn`, `requirePermission` and `authOf`.
- Produces:
  - `type LookupRef = { field: string; kind: LookupKind; id: string | null; label: string }`
  - `resolveLookups(db: Db, refs: LookupRef[]): Promise<{ valueOf(id: string | null): string; errors: FieldErrors }>`. It locks the found rows `FOR SHARE` until the transaction ends.
  - `renameFields(errors: FieldErrors, names: Record<string, string>): FieldErrors`
  - `type LookupView = { id: string; kind: LookupKind; value: string; sort: number; system: boolean }`
  - `listLookups(db, kind?)`, `createLookup(db, kind, value)`, `updateLookup(db, id, patch)`, `deleteLookup(db, actorId, id)`
  - Routes: `GET /lookups?kind=` (signedIn) → `{ items: LookupView[] }`; `POST /lookups` → 201; `PATCH /lookups/:id`; `DELETE /lookups/:id` → 204 (all three `manageSettings`)
  - Fixtures: `makeLookup(db, kind, value?)`, `systemLookup(db, systemKey)`

- [ ] **Step 1: Add the lookup fixtures**

In `apps/api/test/support/fixtures.ts`, change the Prisma import to also bring in the enum type:

```ts
import type { LookupKind, PrismaClient } from '../../src/generated/prisma/client'
```

and append:

```ts
export const makeLookup = (db: PrismaClient, kind: LookupKind, value = unique(kind)) =>
  db.lookupValue.create({ data: { kind, value } })

// One of the six values the system_lookups migration creates.
export const systemLookup = (db: PrismaClient, systemKey: string) =>
  db.lookupValue.findFirstOrThrow({ where: { systemKey, deletedAt: null } })
```

Phase 2's `makePoc` stays as it is.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/lookups.int.test.ts`:

```ts
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { makeLookup, makeUser, signIn, systemLookup, testApp, unique } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let admin: Awaited<ReturnType<typeof signIn>>

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db)
  admin = await signIn(app, (await makeUser(db, { role: 'admin' })).email)
})
afterAll(() => close())

const listOf = async (kind: string) =>
  (await admin.agent.get(`/api/v1/lookups?kind=${kind}`)).body.items as {
    id: string
    value: string
    sort: number
    system: boolean
  }[]

describe('the six system values', () => {
  it('FR-8.2 exist from the start, marked as system values', async () => {
    const res = await admin.agent.get('/api/v1/lookups')
    expect(res.status).toBe(200)
    const system = res.body.items
      .filter((v: { system: boolean }) => v.system)
      .map((v: { kind: string; value: string }) => `${v.kind}:${v.value}`)
      .sort()
    expect(system).toEqual([
      'blocker:Approval Blocker',
      'blocker:None',
      'category:BAU',
      'status:Delayed',
      'status:Hold',
      'status:On Track',
    ])
  })
  it('FR-8.2 cannot be renamed or deleted, but can be reordered', async () => {
    const hold = await systemLookup(db, 'hold')
    const rename = await admin.send('patch', `/api/v1/lookups/${hold.id}`, { value: 'Paused' })
    expect(rename.status).toBe(422)
    expect(rename.body.fields).toEqual({
      value: 'Hold is used by app calculations and cannot be renamed.',
    })
    const del = await admin.send('delete', `/api/v1/lookups/${hold.id}`)
    expect(del.status).toBe(409)
    expect(del.body.message).toBe('Hold is used by app calculations and cannot be deleted.')
    const reorder = await admin.send('patch', `/api/v1/lookups/${hold.id}`, { sort: 7 })
    expect(reorder.status).toBe(200)
    expect(reorder.body).toMatchObject({ value: 'Hold', sort: 7, system: true })
  })
})

describe('managing values', () => {
  it('FR-8.1 admins add a value to a kind, placed after the others', async () => {
    const first = await admin.send('post', '/api/v1/lookups', { kind: 'stage', value: ' RM Sourcing ' })
    const second = await admin.send('post', '/api/v1/lookups', { kind: 'stage', value: 'PDI/QC' })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ kind: 'stage', value: 'RM Sourcing', system: false })
    expect(second.body.sort).toBe(first.body.sort + 1)
    expect((await listOf('stage')).map((v) => v.value)).toEqual(['RM Sourcing', 'PDI/QC'])
  })
  it('FR-8.1 refuses a blank value and a duplicate in any letter case', async () => {
    const blank = await admin.send('post', '/api/v1/lookups', { kind: 'ems', value: '  ' })
    expect(blank.status).toBe(422)
    expect(blank.body.fields).toEqual({ value: 'Enter a value.' })
    await admin.send('post', '/api/v1/lookups', { kind: 'ems', value: 'Orion EMS' })
    const twin = await admin.send('post', '/api/v1/lookups', { kind: 'ems', value: 'orion ems' })
    expect(twin.status).toBe(422)
    expect(twin.body.fields).toEqual({ value: 'This value already exists.' })
    // The same text under another kind is a different value.
    const other = await admin.send('post', '/api/v1/lookups', { kind: 'poc', value: 'Orion EMS' })
    expect(other.status).toBe(201)
  })
  it('FR-8.1 renames a value even while records use it', async () => {
    const segment = await makeLookup(db, 'segment', 'Speakers')
    await db.product.create({ data: { name: unique('P'), segmentId: segment.id } })
    const res = await admin.send('patch', `/api/v1/lookups/${segment.id}`, { value: 'BT Speakers' })
    expect(res.status).toBe(200)
    expect(res.body.value).toBe('BT Speakers')
  })
  it('refuses a rename onto another value of the same kind', async () => {
    const a = await makeLookup(db, 'logistics', 'Road')
    await makeLookup(db, 'logistics', 'Air')
    const res = await admin.send('patch', `/api/v1/lookups/${a.id}`, { value: 'AIR' })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ value: 'This value already exists.' })
  })
})

describe('deleting values', () => {
  it('FR-8.2 refuses a value that an active record uses', async () => {
    const segment = await makeLookup(db, 'segment')
    await db.product.create({ data: { name: unique('P'), segmentId: segment.id } })
    const poc = await makeLookup(db, 'poc')
    await makeUser(db, { role: 'poc', pocId: poc.id })
    for (const value of [segment, poc]) {
      const res = await admin.send('delete', `/api/v1/lookups/${value.id}`)
      expect(res.status).toBe(409)
      expect(res.body.message).toBe(`${value.value} is in use. Reassign those records first.`)
    }
  })
  it('FR-8.2 deletes an unused value, which then leaves every list', async () => {
    const value = await makeLookup(db, 'shipmentStage', 'Customs')
    expect((await admin.send('delete', `/api/v1/lookups/${value.id}`)).status).toBe(204)
    expect((await listOf('shipmentStage')).map((v) => v.value)).not.toContain('Customs')
    const row = await db.lookupValue.findUniqueOrThrow({ where: { id: value.id } })
    expect(row.deletedBy).toBe(admin.me.user.id)
    // The text is free again.
    const again = await admin.send('post', '/api/v1/lookups', { kind: 'shipmentStage', value: 'Customs' })
    expect(again.status).toBe(201)
    expect((await admin.send('patch', `/api/v1/lookups/${value.id}`, { sort: 1 })).status).toBe(404)
  })
  it('counts a value used only by deleted records as unused', async () => {
    const segment = await makeLookup(db, 'segment')
    await db.product.create({
      data: { name: unique('P'), segmentId: segment.id, deletedAt: new Date() },
    })
    expect((await admin.send('delete', `/api/v1/lookups/${segment.id}`)).status).toBe(204)
  })
})

describe('who may change values', () => {
  it('lets every signed-in role read, and only admins change', async () => {
    const viewer = await signIn(app, (await makeUser(db, { role: 'viewer' })).email)
    expect((await viewer.agent.get('/api/v1/lookups?kind=status')).status).toBe(200)
    const planner = await signIn(app, (await makeUser(db, { role: 'planner' })).email)
    const res = await planner.send('post', '/api/v1/lookups', { kind: 'stage', value: 'X' })
    expect(res.status).toBe(403)
    expect((await request(app).get('/api/v1/lookups')).status).toBe(401)
  })
  it('answers an unknown kind with a field error', async () => {
    const res = await admin.agent.get('/api/v1/lookups?kind=colour')
    expect(res.status).toBe(422)
    expect(Object.keys(res.body.fields)).toEqual(['kind'])
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/lookups.int.test.ts`
Expected: FAIL. `/api/v1/lookups` answers the JSON 404, and no system values exist.

- [ ] **Step 4: Write the migration**

Create `apps/api/prisma/migrations/20261015120000_system_lookups/migration.sql`:

```sql
-- The six values the calculations depend on (FR-8.2). Code finds them by system_key, never by
-- display text. Skipped when a database already has them, by key or by text.
INSERT INTO lookup_values (id, kind, value, system_key, sort, updated_at)
SELECT gen_random_uuid(), v.kind::"LookupKind", v.value, v.system_key, v.sort, now()
FROM (VALUES
  ('status', 'On Track', 'on_track', 0),
  ('status', 'Delayed', 'delayed', 1),
  ('status', 'Hold', 'hold', 2),
  ('blocker', 'None', 'none', 0),
  ('blocker', 'Approval Blocker', 'approval_blocker', 1),
  ('category', 'BAU', 'bau', 0)
) AS v(kind, value, system_key, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM lookup_values l
  WHERE l.kind = v.kind::"LookupKind"
    AND l.deleted_at IS NULL
    AND (l.system_key = v.system_key OR lower(l.value::text) = lower(v.value))
);
```

- [ ] **Step 5: Implement reference checks**

Create `apps/api/src/modules/lookups/resolve.ts`:

```ts
import type { FieldErrors } from '@boat/domain/validation'
import type { Db } from '../../core/prisma'
import { type LookupKind, Prisma } from '../../generated/prisma/client'

export type LookupRef = { field: string; kind: LookupKind; id: string | null; label: string }

// FR-8.3: a record may only use values that exist in Settings. Foreign keys check that a row
// exists, not its kind or whether it is deleted, so this checks both and returns the display
// values for validation and history. FOR SHARE holds the rows until the transaction ends: a
// delete running at the same moment waits, then sees the new use and refuses.
export async function resolveLookups(db: Db, refs: LookupRef[]) {
  const ids = [...new Set(refs.flatMap((r) => (r.id ? [r.id] : [])))]
  const rows = ids.length
    ? await db.$queryRaw<{ id: string; kind: string; value: string }[]>`
        SELECT id, kind::text AS kind, value::text AS value
        FROM lookup_values
        WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
          AND deleted_at IS NULL
        FOR SHARE`
    : []
  const found = new Map(rows.map((r) => [r.id, r]))
  const errors: FieldErrors = {}
  for (const ref of refs) {
    if (!ref.id) continue
    if (found.get(ref.id)?.kind !== ref.kind) errors[ref.field] ??= `Choose ${ref.label} from the list.`
  }
  const valueOf = (id: string | null) => (id && found.get(id)?.value) || ''
  return { valueOf, errors }
}

// The domain validators name dropdown fields after the browser's text fields (status); the API
// takes ids (statusId). This moves each message to the field the request used.
export const renameFields = (errors: FieldErrors, names: Record<string, string>) =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [names[k] ?? k, v])) as FieldErrors
```

- [ ] **Step 6: Implement the service**

Create `apps/api/src/modules/lookups/lookups.service.ts`:

```ts
import { assertValid, validateLookupValue, ValidationError } from '@boat/domain/validation'
import { ConflictError, NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { type LookupKind, Prisma, type PrismaClient } from '../../generated/prisma/client'

const lookupSelect = {
  id: true,
  kind: true,
  value: true,
  sort: true,
  systemKey: true,
} satisfies Prisma.LookupValueSelect
type LookupRow = Prisma.LookupValueGetPayload<{ select: typeof lookupSelect }>
const view = ({ systemKey, ...row }: LookupRow) => ({ ...row, system: systemKey !== null })
export type LookupView = ReturnType<typeof view>

// The partial unique index on (kind, value) catches duplicates, in any letter case (citext).
function rethrowDuplicate(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    throw new ValidationError({ value: 'This value already exists.' })
  throw err
}

export async function listLookups(db: PrismaClient, kind?: LookupKind) {
  const rows = await db.lookupValue.findMany({
    where: { deletedAt: null, ...(kind && { kind }) },
    select: lookupSelect,
    orderBy: [{ kind: 'asc' }, { sort: 'asc' }, { value: 'asc' }],
  })
  return { items: rows.map(view) }
}

export async function createLookup(db: PrismaClient, kind: LookupKind, value: string) {
  assertValid(validateLookupValue(value))
  return db.$transaction(async (tx) => {
    const { _max } = await tx.lookupValue.aggregate({
      where: { kind, deletedAt: null },
      _max: { sort: true },
    })
    const row = await tx.lookupValue
      .create({
        data: { kind, value: value.trim(), sort: (_max.sort ?? -1) + 1 },
        select: lookupSelect,
      })
      .catch(rethrowDuplicate)
    return view(row)
  })
}

export async function updateLookup(
  db: PrismaClient,
  id: string,
  patch: { value?: string; sort?: number },
) {
  const current = await db.lookupValue.findFirst({
    where: { id, deletedAt: null },
    select: lookupSelect,
  })
  if (!current) throw new NotFoundError()
  const value = patch.value?.trim()
  if (value !== undefined) {
    assertValid(validateLookupValue(value))
    if (current.systemKey && value !== current.value)
      throw new ValidationError({
        value: `${current.value} is used by app calculations and cannot be renamed.`,
      })
  }
  const row = await db.lookupValue
    .update({
      where: { id },
      data: {
        ...(value !== undefined && { value }),
        ...(patch.sort !== undefined && { sort: patch.sort }),
      },
      select: lookupSelect,
    })
    .catch(rethrowDuplicate)
  return view(row)
}

const lotFields: Partial<Record<LookupKind, string>> = {
  category: 'categoryId',
  ems: 'emsId',
  poc: 'pocId',
  status: 'statusId',
  stage: 'stageId',
  blocker: 'blockerId',
  logistics: 'logisticsId',
}

// Active records that point at the value. Records that are deleted don't count.
async function inUse(db: Db, kind: LookupKind, id: string) {
  const counts: Promise<number>[] = []
  const lotField = lotFields[kind]
  if (lotField)
    counts.push(db.lot.count({ where: { deletedAt: null, [lotField]: id } as Prisma.LotWhereInput }))
  if (kind === 'segment') counts.push(db.product.count({ where: { deletedAt: null, segmentId: id } }))
  if (kind === 'poc') counts.push(db.user.count({ where: { deletedAt: null, pocId: id } }))
  if (kind === 'component') {
    const activeLot = { is: { deletedAt: null } }
    counts.push(
      db.lotComponent.count({ where: { deletedAt: null, componentId: id, lot: activeLot } }),
      db.rmBatch.count({ where: { deletedAt: null, componentId: id, lot: activeLot } }),
    )
  }
  if (kind === 'shipmentStage')
    counts.push(db.shipment.count({ where: { deletedAt: null, stageId: id } }))
  return (await Promise.all(counts)).some((n) => n > 0)
}

export async function deleteLookup(db: PrismaClient, actorId: string, id: string) {
  await db.$transaction(async (tx) => {
    // Waits for any transaction that holds this value FOR SHARE (resolveLookups) to finish, so
    // the in-use check below sees a record saved at the same moment.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM lookup_values WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`
    if (!locked.length) throw new NotFoundError()
    const current = await tx.lookupValue.findUniqueOrThrow({ where: { id }, select: lookupSelect })
    if (current.systemKey)
      throw new ConflictError(`${current.value} is used by app calculations and cannot be deleted.`)
    if (await inUse(tx, current.kind, id))
      throw new ConflictError(`${current.value} is in use. Reassign those records first.`)
    await tx.lookupValue.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: actorId } })
  })
}
```

- [ ] **Step 7: Implement the router and mount it**

Create `apps/api/src/modules/lookups/lookups.router.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission, requireSignedIn } from '../../core/access'
import { parseId, parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import { createLookup, deleteLookup, listLookups, updateLookup } from './lookups.service'

const kind = z.enum(
  [
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
  ],
  { error: 'Choose a kind of value.' },
)
const value = z
  .string({ error: 'Enter a value.' })
  .max(100, { error: 'Keep the value to 100 characters or fewer.' })
const listQuery = z.object({ kind: kind.optional() })
const createBody = z.strictObject({ kind, value })
const patchBody = z.strictObject({
  value: value.optional(),
  sort: z.number({ error: 'Enter a position.' }).int().min(0).max(100_000).optional(),
})

export function lookupsRouter(db: PrismaClient) {
  const router = Router()

  router.get('/', requireSignedIn(), async (req, res) => {
    res.json(await listLookups(db, parseInput(listQuery, req.query).kind))
  })

  router.post('/', requirePermission('manageSettings'), async (req, res) => {
    const body = parseInput(createBody, req.body)
    res.status(201).json(await createLookup(db, body.kind, body.value))
  })

  router.patch('/:id', requirePermission('manageSettings'), async (req, res) => {
    res.json(await updateLookup(db, parseId(req.params.id), parseInput(patchBody, req.body)))
  })

  router.delete('/:id', requirePermission('manageSettings'), async (req, res) => {
    await deleteLookup(db, authOf(req).user.id, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
```

In `apps/api/src/api.ts`, import `lookupsRouter` from `./modules/lookups/lookups.router` and mount it after `/settings`:

```ts
  mount(api, '/lookups', lookupsRouter(deps.db))
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /lookups signedIn',
        'POST /lookups manageSettings',
        'PATCH /lookups/:id manageSettings',
        'DELETE /lookups/:id manageSettings',
```

- [ ] **Step 8: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS. That includes `database.int.test.ts`'s "migrations match schema.prisma exactly", because the new migration only inserts rows.

- [ ] **Step 9: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add dropdown values with protected system values

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Products, the history writer and cascading lot deletes

Products get create, edit (with version), list and delete. Deleting a product soft-deletes its lots, their batches, receipts and component choices, and writes a "deleted" history entry for each lot (FR-1.2). That cascade lives in `lot-deletion.ts` because Task 5's lot delete uses it too. It is written here against the lot tables, which exist since Phase 1.

**Files:**
- Create: `apps/api/src/core/audit.ts`
- Create: `apps/api/src/modules/lots/lot-deletion.ts`
- Create: `apps/api/src/modules/products/products.service.ts`, `apps/api/src/modules/products/products.router.ts`
- Modify: `apps/api/src/api.ts`, `apps/api/src/api.test.ts`, `apps/api/test/support/fixtures.ts`
- Test: `apps/api/test/products.int.test.ts`

**Interfaces:**
- Consumes: from Task 2, `resolveLookups` and `renameFields`; `validateProduct` from `@boat/domain/validation`; `Product` from `@boat/domain/models`; from Phase 2, `SessionUser`, `ConflictError` and `NotFoundError`.
- Produces:
  - `type Actor = { id: string; name: string }`, `actorOf(user: SessionUser): Actor`
  - `type ActivityEntry = { entityType: 'lot' | 'shipment'; entityId: string; kind: string; message: string; changes?: Prisma.InputJsonObject }`
  - `recordActivity(db: Db, actor: Actor, entry: ActivityEntry)`, which returns the created row
  - `softDeleteLots(db: Db, actor: Actor, lots: { id: string; label: string }[]): Promise<void>`
  - `type ProductView = { id, version, name, variant, segment: { id, value }, createdAt, updatedAt }`
  - `listProducts(db)`, `createProduct(db, input)`, `updateProduct(db, id, patch)`, `deleteProduct(db, user, id)`
  - Routes: `GET /products` (signedIn) → `{ items: ProductView[] }`; `POST /products` (`editProducts`) → 201; `PATCH /products/:id` (`editProducts`); `DELETE /products/:id` (`deleteProducts`) → 204
  - Fixtures: `day(s: string): Date`, `fixedNow`, `testToday`, `makeProduct(db, fields?)`, `makeLot(db, fields?)`

- [ ] **Step 1: Add the product and lot fixtures**

In `apps/api/test/support/fixtures.ts`, add `Prisma` to the Prisma import:

```ts
import type { LookupKind, Prisma, PrismaClient } from '../../src/generated/prisma/client'
```

and append:

```ts
// A business date as Prisma stores it: UTC midnight.
export const day = (s: string) => new Date(`${s}T00:00:00Z`)

// The tests' "now". 06:30 UTC is midday in India, so the company date is the same everywhere.
export const testToday = '2026-10-15'
export const fixedNow = () => new Date(`${testToday}T06:30:00Z`)

export async function makeProduct(
  db: PrismaClient,
  fields: { name?: string; variant?: string; segmentId?: string } = {},
) {
  return db.product.create({
    data: {
      name: fields.name ?? unique('Product'),
      variant: fields.variant ?? '',
      segmentId: fields.segmentId ?? (await makeLookup(db, 'segment')).id,
    },
  })
}

// A lot written straight to the database, for tests about reading, filtering or deleting lots.
// Pass grnTotal and completedOn together with matching receipts, or use the API instead.
export async function makeLot(db: PrismaClient, fields: Partial<Prisma.LotUncheckedCreateInput> = {}) {
  return db.lot.create({
    data: {
      productId: fields.productId ?? (await makeProduct(db)).id,
      label: fields.label ?? unique('Lot'),
      categoryId: fields.categoryId ?? (await systemLookup(db, 'bau')).id,
      statusId: fields.statusId ?? (await systemLookup(db, 'on_track')).id,
      stageId: fields.stageId ?? (await makeLookup(db, 'stage')).id,
      lotQty: 100,
      ...fields,
    },
  })
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/products.int.test.ts`:

```ts
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import {
  day,
  makeLookup,
  makeLot,
  makeProduct,
  makeUser,
  signIn,
  testApp,
  unique,
} from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let admin: Awaited<ReturnType<typeof signIn>>
let planner: Awaited<ReturnType<typeof signIn>>
let segmentId: string

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db)
  admin = await signIn(app, (await makeUser(db, { role: 'admin' })).email)
  planner = await signIn(app, (await makeUser(db, { role: 'planner' })).email)
  segmentId = (await makeLookup(db, 'segment', 'Soundbars')).id
})
afterAll(() => close())

const create = (body: object) => planner.send('post', '/api/v1/products', body)

describe('creating and editing products', () => {
  it('FR-1.1 a planner creates a product with name, variant and segment', async () => {
    const res = await create({ name: ' Inverter ', variant: '5 kW', segmentId })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.any(String),
      version: 1,
      name: 'Inverter',
      variant: '5 kW',
      segment: { id: segmentId, value: 'Soundbars' },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    const list = await planner.agent.get('/api/v1/products')
    expect(list.body.items.map((p: { id: string }) => p.id)).toContain(res.body.id)
  })
  it('FR-1.1 keeps name plus variant unique, ignoring case', async () => {
    await create({ name: 'Soundbar X', variant: 'Black', segmentId })
    const twin = await create({ name: 'soundbar x', variant: 'BLACK', segmentId })
    expect(twin.status).toBe(422)
    expect(twin.body.fields).toEqual({
      name: 'soundbar x · BLACK already exists. Use a different name or variant.',
    })
    expect((await create({ name: 'Soundbar X', variant: 'White', segmentId })).status).toBe(201)
  })
  it('FR-8.3 needs an active segment value', async () => {
    const stage = await makeLookup(db, 'stage')
    for (const id of [stage.id, '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90']) {
      const res = await create({ name: unique('P'), segmentId: id })
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual({ segmentId: 'Choose a segment from the list.' })
    }
    const blank = await create({ name: ' ', segmentId })
    expect(blank.body.fields).toEqual({ name: 'Enter the product name.' })
  })
  it('FR-1.1 edits a product and moves its version on', async () => {
    const created = await create({ name: unique('P'), segmentId })
    const res = await planner.send('patch', `/api/v1/products/${created.body.id}`, {
      variant: 'Pro',
      version: 1,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ variant: 'Pro', version: 2 })
  })
  it('answers a stale version with 409 and the product as it now stands', async () => {
    const created = await create({ name: unique('P'), segmentId })
    await planner.send('patch', `/api/v1/products/${created.body.id}`, { variant: 'A', version: 1 })
    const stale = await admin.send('patch', `/api/v1/products/${created.body.id}`, {
      variant: 'B',
      version: 1,
    })
    expect(stale.status).toBe(409)
    expect(stale.body.current).toMatchObject({ variant: 'A', version: 2 })
  })
  it('lets POCs and viewers read but not change products', async () => {
    for (const role of ['poc', 'viewer'] as const) {
      const user = await signIn(app, (await makeUser(db, { role })).email)
      expect((await user.agent.get('/api/v1/products')).status).toBe(200)
      expect((await user.send('post', '/api/v1/products', { name: 'X', segmentId })).status).toBe(403)
    }
  })
})

describe('deleting products', () => {
  it('FR-1.2 soft-deletes the product with its lots, batches and receipts, keeping history', async () => {
    const product = await makeProduct(db, { segmentId })
    const lot = await makeLot(db, { productId: product.id, label: 'Lot 1' })
    const component = await makeLookup(db, 'component')
    await db.lotComponent.create({ data: { lotId: lot.id, componentId: component.id } })
    await db.rmBatch.create({ data: { lotId: lot.id, componentId: component.id, label: 'B1' } })
    await db.grnReceipt.create({
      data: { lotId: lot.id, label: 'G1', date: day('2026-10-01'), quantity: 10 },
    })
    expect((await admin.send('delete', `/api/v1/products/${product.id}`)).status).toBe(204)

    const after = {
      product: await db.product.findUniqueOrThrow({ where: { id: product.id } }),
      lot: await db.lot.findUniqueOrThrow({ where: { id: lot.id } }),
      batches: await db.rmBatch.findMany({ where: { lotId: lot.id } }),
      receipts: await db.grnReceipt.findMany({ where: { lotId: lot.id } }),
      components: await db.lotComponent.findMany({ where: { lotId: lot.id } }),
    }
    for (const row of [after.product, after.lot, ...after.batches, ...after.receipts, ...after.components]) {
      expect(row.deletedAt).not.toBeNull()
      expect(row.deletedBy).toBe(admin.me.user.id)
    }
    const history = await db.activityLog.findMany({ where: { entityId: lot.id } })
    expect(history).toEqual([
      expect.objectContaining({
        kind: 'deleted',
        message: 'Lot Lot 1 deleted',
        actorId: admin.me.user.id,
        actorName: admin.me.user.name,
      }),
    ])
    const list = await admin.agent.get('/api/v1/products')
    expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(product.id)
    expect(
      (await admin.send('patch', `/api/v1/products/${product.id}`, { name: 'X', version: 1 })).status,
    ).toBe(404)
  })
  it('FR-1.2 is refused while an active shipment line uses the product', async () => {
    const product = await makeProduct(db, { segmentId })
    const shipment = await db.shipment.create({ data: { number: unique('INV'), vessel: 'MSC' } })
    await db.shipmentItem.create({ data: { shipmentId: shipment.id, productId: product.id, quantity: 5 } })
    const res = await admin.send('delete', `/api/v1/products/${product.id}`)
    expect(res.status).toBe(409)
    expect(res.body.message).toBe(
      'This product is used in a shipment. Remove or reassign those shipment lines first.',
    )
    // A deleted shipment no longer holds the product.
    await db.shipment.update({ where: { id: shipment.id }, data: { deletedAt: new Date() } })
    expect((await admin.send('delete', `/api/v1/products/${product.id}`)).status).toBe(204)
  })
  it('lets only admins delete', async () => {
    const product = await makeProduct(db, { segmentId })
    expect((await planner.send('delete', `/api/v1/products/${product.id}`)).status).toBe(403)
    expect((await request(app).delete(`/api/v1/products/${product.id}`)).status).toBe(401)
  })
  it('frees the name for a new product', async () => {
    const created = await create({ name: 'Reusable', segmentId })
    await admin.send('delete', `/api/v1/products/${created.body.id}`)
    expect((await create({ name: 'Reusable', segmentId })).status).toBe(201)
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/products.int.test.ts`
Expected: FAIL. `/api/v1/products` answers the JSON 404.

- [ ] **Step 4: Implement the history writer and the lot cascade**

Create `apps/api/src/core/audit.ts`:

```ts
import type { Prisma } from '../generated/prisma/client'
import type { SessionUser } from './access'
import type { Db } from './prisma'

export type Actor = { id: string; name: string }
export const actorOf = (user: SessionUser): Actor => ({ id: user.id, name: user.name })

export type ActivityEntry = {
  entityType: 'lot' | 'shipment'
  entityId: string
  kind: string
  message: string
  changes?: Prisma.InputJsonObject
}

// FR-7.1: every change writes a history entry naming the user. Call it inside the transaction
// that makes the change, so a change that rolls back leaves no entry. The app's database role
// can insert into activity_logs but never update or delete it. The name is a snapshot, so it
// survives a later rename or deletion of the user.
export const recordActivity = (db: Db, actor: Actor, entry: ActivityEntry) =>
  db.activityLog.create({ data: { ...entry, actorId: actor.id, actorName: actor.name } })
```

Create `apps/api/src/modules/lots/lot-deletion.ts`:

```ts
import { type Actor, recordActivity } from '../../core/audit'
import type { Db } from '../../core/prisma'

// Soft-deletes lots with their batches, receipts and component choices, and writes a "deleted"
// history entry for each lot (FR-1.2, DELETE /lots/:id). History itself is never deleted.
export async function softDeleteLots(db: Db, actor: Actor, lots: { id: string; label: string }[]) {
  if (!lots.length) return
  const ids = lots.map((l) => l.id)
  const stamp = { deletedAt: new Date(), deletedBy: actor.id }
  const children = { lotId: { in: ids }, deletedAt: null }
  await db.rmBatch.updateMany({ where: children, data: stamp })
  await db.grnReceipt.updateMany({ where: children, data: stamp })
  await db.lotComponent.updateMany({ where: children, data: stamp })
  await db.lot.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: stamp })
  for (const lot of lots)
    await recordActivity(db, actor, {
      entityType: 'lot',
      entityId: lot.id,
      kind: 'deleted',
      message: `Lot ${lot.label} deleted`,
    })
}
```

- [ ] **Step 5: Implement the products service**

Create `apps/api/src/modules/products/products.service.ts`:

```ts
import type { Product } from '@boat/domain/models'
import { assertValid, validateProduct, ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf } from '../../core/audit'
import { ConflictError, NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { Prisma, type PrismaClient } from '../../generated/prisma/client'
import { renameFields, resolveLookups } from '../lookups/resolve'
import { softDeleteLots } from '../lots/lot-deletion'

const productSelect = {
  id: true,
  version: true,
  name: true,
  variant: true,
  segment: { select: { id: true, value: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect
export type ProductView = Prisma.ProductGetPayload<{ select: typeof productSelect }>

export type ProductInput = { name: string; variant: string; segmentId: string }
export type ProductPatch = Partial<ProductInput> & { version: number }

export async function listProducts(db: PrismaClient) {
  const items = await db.product.findMany({
    where: { deletedAt: null },
    select: productSelect,
    orderBy: [{ name: 'asc' }, { variant: 'asc' }],
  })
  return { items }
}

// Trims the input and checks it the way the demo's saveProduct does, with the segment checked
// against Settings (FR-8.3).
async function checkProduct(db: Db, input: ProductInput) {
  const name = input.name.trim()
  const variant = input.variant.trim()
  const { valueOf, errors } = await resolveLookups(db, [
    { field: 'segmentId', kind: 'segment', id: input.segmentId, label: 'a segment' },
  ])
  const domain: Product = { id: '', createdAt: '', updatedAt: '', name, variant, segment: valueOf(input.segmentId) }
  assertValid({ ...renameFields(validateProduct(domain), { segment: 'segmentId' }), ...errors })
  return { name, variant, segmentId: input.segmentId }
}

// FR-1.1: the partial unique index on (name, variant) is case-insensitive (citext).
const duplicateName = (name: string, variant: string) => (err: unknown): never => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    throw new ValidationError({
      name: `${name}${variant ? ` · ${variant}` : ''} already exists. Use a different name or variant.`,
    })
  throw err
}

async function lockProduct(db: Db, id: string) {
  const rows = await db.$queryRaw<{ version: number }[]>`
    SELECT version FROM products WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`
  if (!rows.length) throw new NotFoundError()
  return rows[0].version
}

export async function createProduct(db: PrismaClient, input: ProductInput) {
  return db.$transaction(async (tx) => {
    const data = await checkProduct(tx, input)
    return tx.product
      .create({ data, select: productSelect })
      .catch(duplicateName(data.name, data.variant))
  })
}

export async function updateProduct(db: PrismaClient, id: string, patch: ProductPatch) {
  return db.$transaction(async (tx) => {
    const version = await lockProduct(tx, id)
    const current = await tx.product.findUniqueOrThrow({ where: { id }, select: productSelect })
    if (patch.version !== version)
      throw new ConflictError(
        'Someone else changed this product. Review their changes and try again.',
        current,
      )
    const data = await checkProduct(tx, {
      name: patch.name ?? current.name,
      variant: patch.variant ?? current.variant,
      segmentId: patch.segmentId ?? current.segment.id,
    })
    return tx.product
      .update({ where: { id }, data: { ...data, version: { increment: 1 } }, select: productSelect })
      .catch(duplicateName(data.name, data.variant))
  })
}

export async function deleteProduct(db: PrismaClient, user: SessionUser, id: string) {
  await db.$transaction(async (tx) => {
    await lockProduct(tx, id)
    const onShipment = await tx.shipmentItem.count({
      where: { productId: id, deletedAt: null, shipment: { is: { deletedAt: null } } },
    })
    if (onShipment)
      throw new ConflictError(
        'This product is used in a shipment. Remove or reassign those shipment lines first.',
      )
    const lots = await tx.lot.findMany({
      where: { productId: id, deletedAt: null },
      select: { id: true, label: true },
    })
    await softDeleteLots(tx, actorOf(user), lots)
    await tx.product.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id } })
  })
}
```

- [ ] **Step 6: Implement the router and mount it**

Create `apps/api/src/modules/products/products.router.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission, requireSignedIn } from '../../core/access'
import { parseId, parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import { createProduct, deleteProduct, listProducts, updateProduct } from './products.service'

const name = z
  .string({ error: 'Enter the product name.' })
  .max(100, { error: 'Keep the name to 100 characters or fewer.' })
const variant = z.string().max(100, { error: 'Keep the variant to 100 characters or fewer.' })
const segmentId = z.guid({ error: 'Choose a segment from the list.' })
const version = z.number({ error: 'Reload the record and try again.' }).int()
const createBody = z.strictObject({ name, variant: variant.default(''), segmentId })
const patchBody = z.strictObject({
  name: name.optional(),
  variant: variant.optional(),
  segmentId: segmentId.optional(),
  version,
})

export function productsRouter(db: PrismaClient) {
  const router = Router()

  router.get('/', requireSignedIn(), async (_req, res) => {
    res.json(await listProducts(db))
  })

  router.post('/', requirePermission('editProducts'), async (req, res) => {
    res.status(201).json(await createProduct(db, parseInput(createBody, req.body)))
  })

  router.patch('/:id', requirePermission('editProducts'), async (req, res) => {
    res.json(await updateProduct(db, parseId(req.params.id), parseInput(patchBody, req.body)))
  })

  router.delete('/:id', requirePermission('deleteProducts'), async (req, res) => {
    await deleteProduct(db, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
```

In `apps/api/src/api.ts`, import `productsRouter` from `./modules/products/products.router` and mount it after `/lookups`:

```ts
  mount(api, '/products', productsRouter(deps.db))
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /products signedIn',
        'POST /products editProducts',
        'PATCH /products/:id editProducts',
        'DELETE /products/:id deleteProducts',
```

- [ ] **Step 7: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 8: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add products with versioned edits and cascading deletes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lot views: rows to domain shapes and computed fields

The PRD wants detail responses to carry computed fields (balance, completion, flags, status line, RM metrics) so the browser need not derive them. The `@boat/domain` functions already compute them, on the browser's shapes, where dropdowns are text. This task maps database rows to those shapes and builds the lot view. It's pure code with unit tests; Task 5 serves it.

**Files:**
- Create: `apps/api/src/modules/lots/lot-view.ts`
- Test: `apps/api/src/modules/lots/lot-view.test.ts`

**Interfaces:**
- Consumes: `Lot`, `RMBatch`, `GRNReceipt` from `@boat/domain/models`; `actorLotAccess` from `@boat/domain/permissions`; `balance`, `effectiveRmReadyDate`, `fullGrnDate`, `grnProgress`, `leadTime`, `lotFlags`, `lotSummary`, `planDelay`, `rmMetrics` and `totalGrn` from `@boat/domain/calculations`; from Task 1, `fromDbDate`; from Phase 2, `SessionUser`, `Db` and `NotFoundError`.
- Produces:
  - `lotInclude`, `batchInclude` (Prisma includes), and the types `LotRow`, `BatchRow`, `ReceiptRow`
  - `toDomainLot(row: LotRow): Lot`, `toDomainBatch(row: BatchRow): RMBatch`, `toDomainReceipt(row: ReceiptRow): GRNReceipt`
  - `lotAccess(user: SessionUser, row: { pocId: string | null }): 'full' | 'progress' | 'none'`
  - `computeLot(lot, batches, receipts, date)`, which returns `{ grnTotal, balance, completed, grnPercent, fullGrnDate, planDelay, leadTime, rmReadyDate, flags: { overdue, dueSoon, followUp, blocked, approval }, summary, rm: { producible, bottleneck, percent, complete } }`
  - `batchView(row)`, `receiptView(row)`
  - `lotView(row, batches, receipts, date, user)` and `type LotView`
  - `loadLotViews(db, ids, date, user): Promise<LotView[]>` (keeps `ids` order) and `getLotDetail(db, id, date, user)`, which returns `LotView & { rmBatches, grnReceipts }` (404 when missing or deleted)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/lots/lot-view.test.ts`:

```ts
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
const batch = (component: ReturnType<typeof ref>, receivedQty: number, receivedDate = '2026-10-05'): BatchRow => ({
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
    const batches = [batch(ref('k-2', 'PCB'), 500), batch(ref('k-1', 'Enclosure'), 420)].map(toDomainBatch)
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
  it('reports completion with the full-GRN date, days against plan and lead time', () => {
    const done = toDomainLot(lotRow({ lotQty: 100, rmReadyDate: d('2026-10-01'), plannedDate: d('2026-10-10') }))
    const receipts = [receipt(40, '2026-10-05'), receipt(60, '2026-10-12')].map(toDomainReceipt)
    expect(computeLot(done, [], receipts, '2026-10-15')).toMatchObject({
      completed: true,
      balance: 0,
      fullGrnDate: '2026-10-12',
      planDelay: 2,
      leadTime: 11,
      rmReadyDate: '2026-10-01',
      summary: 'Completed (Factory Production)',
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
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test -- src/modules/lots/lot-view.test.ts`
Expected: FAIL. `./lot-view` doesn't exist.

- [ ] **Step 3: Implement the lot views**

Create `apps/api/src/modules/lots/lot-view.ts`:

```ts
import {
  balance,
  effectiveRmReadyDate,
  fullGrnDate,
  grnProgress,
  leadTime,
  lotFlags,
  lotSummary,
  planDelay,
  rmMetrics,
  totalGrn,
} from '@boat/domain/calculations'
import type { GRNReceipt, Lot, RMBatch } from '@boat/domain/models'
import { actorLotAccess } from '@boat/domain/permissions'
import type { SessionUser } from '../../core/access'
import { fromDbDate } from '../../core/dates'
import { NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import type { GrnReceipt, Prisma } from '../../generated/prisma/client'

const ref = { select: { id: true, value: true } } as const
export const lotInclude = {
  product: { select: { id: true, name: true, variant: true, segment: ref } },
  category: ref,
  ems: ref,
  poc: ref,
  status: ref,
  stage: ref,
  logistics: ref,
  blocker: ref,
  components: { where: { deletedAt: null }, select: { component: ref } },
} satisfies Prisma.LotInclude
export type LotRow = Prisma.LotGetPayload<{ include: typeof lotInclude }>
export const batchInclude = { component: ref } satisfies Prisma.RmBatchInclude
export type BatchRow = Prisma.RmBatchGetPayload<{ include: typeof batchInclude }>
export type ReceiptRow = GrnReceipt

const text = (d: Date | null) => fromDbDate(d) ?? ''
const byValue = (a: { value: string }, b: { value: string }) => a.value.localeCompare(b.value)
const stamps = (row: { id: string; createdAt: Date; updatedAt: Date }) => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

// The domain calculations take the browser's shapes, where dropdowns are display text. Mapping
// rows to those shapes lets the server compute exactly what the demo computes. System values
// can't be renamed, so text checks such as status === 'Delayed' stay valid.
export function toDomainLot(row: LotRow): Lot {
  return {
    ...stamps(row),
    productId: row.productId,
    label: row.label,
    category: row.category.value,
    directFg: row.directFg,
    ems: row.ems?.value ?? '',
    poc: row.poc?.value ?? '',
    status: row.status.value,
    stage: row.stage.value,
    rmMode: row.rmMode,
    rmComponents: row.components.map((c) => c.component.value).sort(),
    readyQty: row.readyQty,
    lotQty: row.lotQty,
    freshProductionQty: row.freshProductionQty,
    reworkQty: row.reworkQty,
    reworkReason: row.reworkReason,
    rmReadyDate: text(row.rmReadyDate),
    plannedDate: text(row.plannedDate),
    revisedEta: text(row.revisedEta),
    actualDate: text(row.actualDate),
    logisticsMode: row.logistics?.value ?? '',
    blockerCategory: row.blocker?.value ?? '',
    blockerDescription: row.blockerDescription,
    followUpDate: text(row.followUpDate),
    followUpNote: row.followUpNote,
  }
}

export const toDomainBatch = (row: BatchRow): RMBatch => ({
  ...stamps(row),
  lotId: row.lotId,
  component: row.component.value,
  label: row.label,
  plannedQty: row.plannedQty,
  plannedDate: text(row.plannedDate),
  receivedQty: row.receivedQty,
  receivedDate: text(row.receivedDate),
  status: row.status,
  notes: row.notes,
})

export const toDomainReceipt = (row: ReceiptRow): GRNReceipt => ({
  ...stamps(row),
  lotId: row.lotId,
  label: row.label,
  date: text(row.date),
  quantity: row.quantity,
  note: row.note,
})

// actorLotAccess compares the user's point of contact with the lot's. Ids compare as well as
// the names the browser uses.
export const lotAccess = (user: SessionUser, row: { pocId: string | null }) =>
  actorLotAccess({ role: user.role, poc: user.pocId ?? '' }, { poc: row.pocId ?? '' })

export function computeLot(lot: Lot, batches: RMBatch[], receipts: GRNReceipt[], date: string) {
  const { done, ...flags } = lotFlags(lot, receipts, date)
  const rm = rmMetrics(lot, batches)
  return {
    grnTotal: totalGrn(receipts),
    balance: balance(lot, receipts),
    completed: done,
    grnPercent: grnProgress(lot, receipts),
    fullGrnDate: fullGrnDate(lot, receipts) || null,
    planDelay: planDelay(lot, receipts),
    leadTime: leadTime(lot, receipts, batches),
    rmReadyDate: effectiveRmReadyDate(lot, batches) || null,
    flags,
    summary: lotSummary(lot, receipts, date),
    rm: { producible: rm.producible, bottleneck: rm.bottleneck, percent: rm.percent, complete: rm.complete },
  }
}

export const batchView = (row: BatchRow) => ({
  id: row.id,
  lotId: row.lotId,
  component: row.component,
  label: row.label,
  plannedQty: row.plannedQty,
  plannedDate: fromDbDate(row.plannedDate),
  receivedQty: row.receivedQty,
  receivedDate: fromDbDate(row.receivedDate),
  status: row.status,
  notes: row.notes,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const receiptView = (row: ReceiptRow) => ({
  id: row.id,
  lotId: row.lotId,
  label: row.label,
  date: fromDbDate(row.date),
  quantity: row.quantity,
  note: row.note,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export function lotView(
  row: LotRow,
  batches: BatchRow[],
  receipts: ReceiptRow[],
  date: string,
  user: SessionUser,
) {
  return {
    id: row.id,
    version: row.version,
    product: row.product,
    label: row.label,
    category: row.category,
    directFg: row.directFg,
    ems: row.ems,
    poc: row.poc,
    status: row.status,
    stage: row.stage,
    rmMode: row.rmMode,
    components: row.components.map((c) => c.component).sort(byValue),
    readyQty: row.readyQty,
    lotQty: row.lotQty,
    freshProductionQty: row.freshProductionQty,
    reworkQty: row.reworkQty,
    reworkReason: row.reworkReason,
    rmReadyDate: fromDbDate(row.rmReadyDate),
    plannedDate: fromDbDate(row.plannedDate),
    revisedEta: fromDbDate(row.revisedEta),
    actualDate: fromDbDate(row.actualDate),
    logistics: row.logistics,
    blocker: row.blocker,
    blockerDescription: row.blockerDescription,
    followUpDate: fromDbDate(row.followUpDate),
    followUpNote: row.followUpNote,
    completedOn: fromDbDate(row.completedOn),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    computed: computeLot(
      toDomainLot(row),
      batches.map(toDomainBatch),
      receipts.map(toDomainReceipt),
      date,
    ),
    access: lotAccess(user, row),
  }
}
export type LotView = ReturnType<typeof lotView>

async function loadBundles(db: Db, ids: string[]) {
  const [rows, batches, receipts] = await Promise.all([
    db.lot.findMany({ where: { id: { in: ids }, deletedAt: null }, include: lotInclude }),
    db.rmBatch.findMany({
      where: { lotId: { in: ids }, deletedAt: null },
      include: batchInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.grnReceipt.findMany({
      where: { lotId: { in: ids }, deletedAt: null },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
  ])
  const group = <T extends { lotId: string }>(items: T[]) => {
    const byLot = new Map<string, T[]>()
    for (const item of items) byLot.set(item.lotId, [...(byLot.get(item.lotId) ?? []), item])
    return byLot
  }
  const batchesOf = group(batches)
  const receiptsOf = group(receipts)
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap((id) => {
    const row = rowsById.get(id)
    return row ? [{ row, batches: batchesOf.get(id) ?? [], receipts: receiptsOf.get(id) ?? [] }] : []
  })
}

// Three queries for any number of lots; the result keeps the order of ids.
export async function loadLotViews(db: Db, ids: string[], date: string, user: SessionUser) {
  if (!ids.length) return []
  const bundles = await loadBundles(db, ids)
  return bundles.map((b) => lotView(b.row, b.batches, b.receipts, date, user))
}

export async function getLotDetail(db: Db, id: string, date: string, user: SessionUser) {
  const [found] = await loadBundles(db, [id])
  if (!found) throw new NotFoundError()
  return {
    ...lotView(found.row, found.batches, found.receipts, date, user),
    rmBatches: found.batches.map(batchView),
    grnReceipts: found.receipts.map(receiptView),
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @boat/api test -- src/modules/lots/lot-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Map lot rows to the domain and compute lot views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Lots: create, edit, delete and detail

The core write path. Each change locks the lot row, checks the user's per-lot access, checks the version, resolves every dropdown id against Settings, and runs the shared `validateLot`. It refuses plan-field changes from a POC, keeps lot quantity at or above GRN received, and keeps component choices consistent with batches. It then writes the lot and its component rows, refreshes completion and records history.

**Files:**
- Modify: `apps/api/src/core/clock.ts` (`RecordsDeps`)
- Create: `apps/api/src/modules/lots/lot-lock.ts`
- Create: `apps/api/src/modules/lots/lots.service.ts`, `apps/api/src/modules/lots/lots.router.ts`
- Modify: `apps/api/src/api.ts` (`now` in `ApiDeps`, the clock, mount `/lots`), `apps/api/src/api.test.ts`
- Modify: `apps/api/test/support/fixtures.ts` (`makeRecordsWorld`, `lotBody`)
- Test: `apps/api/test/lots.int.test.ts`

**Interfaces:**
- Consumes: from Task 4, `lotInclude`, `batchInclude`, `LotRow`, `toDomainLot`, `lotAccess` and `getLotDetail`; from Task 3, `recordActivity`, `actorOf` and `softDeleteLots`; from Task 2, `resolveLookups` and `renameFields`; from Task 1, `Clock`, `createClock`, `optionalDate`, `toDbDate`, `fromDbDate` and `requireLotAccess`; from `@boat/domain`, `validateLot`, `changedPlanFields`, `deniedMessage` and `PermissionError`.
- Produces:
  - `type RecordsDeps = { db: PrismaClient; clock: Clock }` (in `core/clock.ts`)
  - `lockLot(db, id): Promise<LotRow>` (row lock, 404 when missing or deleted), `lotDenial(user, lot): PermissionError`, `lockLotForEdit(db, user, id): Promise<LotRow>` (adds the per-lot check), `refreshCompletion(db, lotId): Promise<void>`
  - `type LotInput` (the API's lot fields) and `type LotPatch = Partial<LotInput> & { version: number }`
  - `createLot(deps, user, input)`, `updateLot(deps, user, id, patch)` (both return the lot detail), `deleteLot(deps, user, id)`
  - `lotsRouter(deps: RecordsDeps): Router`, with routes `GET /lots/:id` (signedIn), `POST /lots` (`createLots`) → 201, `PATCH /lots/:id` (`lotAccess`), `DELETE /lots/:id` (`deleteLots`) → 204
  - `ApiDeps.now?: () => Date`
  - Fixtures: `makeRecordsWorld(db, app)` → `{ lookups, product, admin, planner, poc, viewer }` (call it once per test file; it creates fixed value names), and `lotBody(world, overrides?)`

- [ ] **Step 1: Add the clock to the API and the world fixtures**

In `apps/api/src/core/clock.ts`, add `import type { PrismaClient } from '../generated/prisma/client'` and append:

```ts
// What every record module takes: the database and today's company date.
export type RecordsDeps = { db: PrismaClient; clock: Clock }
```

In `apps/api/src/api.ts`, import `createClock` from `./core/clock` and add to `ApiDeps`:

```ts
  // The time for "today". Tests pass a fixed one; production uses the real time.
  now?: () => Date
```

In `buildApiRouter`, below `const settings = …`, add:

```ts
  const records = { db: deps.db, clock: createClock(settings, deps.now) }
```

Append to `apps/api/test/support/fixtures.ts`:

```ts
// Users of every role, the dropdown values lots need, and one product, for the lot test files.
// Values have fixed names (status lines quote them), so call it once per test file.
export async function makeRecordsWorld(db: PrismaClient, app: Express) {
  const lookups = {
    bau: await systemLookup(db, 'bau'),
    npi: await makeLookup(db, 'category', 'NPI'),
    onTrack: await systemLookup(db, 'on_track'),
    delayed: await systemLookup(db, 'delayed'),
    hold: await systemLookup(db, 'hold'),
    none: await systemLookup(db, 'none'),
    approval: await systemLookup(db, 'approval_blocker'),
    rmBlocker: await makeLookup(db, 'blocker', 'RM Blocker'),
    stage: await makeLookup(db, 'stage', 'Factory Production'),
    ems: await makeLookup(db, 'ems', 'Orion EMS'),
    road: await makeLookup(db, 'logistics', 'Road'),
    pcb: await makeLookup(db, 'component', 'PCB'),
    enclosure: await makeLookup(db, 'component', 'Enclosure'),
    kit: await makeLookup(db, 'component', 'Kit (All Together)'),
    pocA: await makeLookup(db, 'poc', 'Maya Shah'),
    pocB: await makeLookup(db, 'poc', 'Rohit Mehta'),
    segment: await makeLookup(db, 'segment', 'Soundbars'),
  }
  const product = await makeProduct(db, { name: 'Soundbar', variant: 'X1', segmentId: lookups.segment.id })
  const signedInAs = async (role: Role, pocId: string | null = null) =>
    signIn(app, (await makeUser(db, { role, pocId, name: `Test ${role}` })).email)
  return {
    lookups,
    product,
    admin: await signedInAs('admin'),
    planner: await signedInAs('planner'),
    poc: await signedInAs('poc', lookups.pocA.id),
    viewer: await signedInAs('viewer'),
  }
}
export type RecordsWorld = Awaited<ReturnType<typeof makeRecordsWorld>>

// A valid POST /lots body; override any field.
export const lotBody = (w: RecordsWorld, overrides: Record<string, unknown> = {}) => ({
  productId: w.product.id,
  label: unique('Lot'),
  categoryId: w.lookups.bau.id,
  statusId: w.lookups.onTrack.id,
  stageId: w.lookups.stage.id,
  lotQty: 100,
  ...overrides,
})
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/lots.int.test.ts`:

```ts
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { refreshCompletion } from '../src/modules/lots/lot-lock'
import { createTestDatabase } from './support/db'
import {
  day,
  fixedNow,
  lotBody,
  makeLookup,
  makeProduct,
  makeRecordsWorld,
  type RecordsWorld,
  testApp,
} from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
})
afterAll(() => close())

const create = (overrides: Record<string, unknown> = {}) =>
  w.planner.send('post', '/api/v1/lots', lotBody(w, overrides))
const detail = async (id: string) => (await w.admin.agent.get(`/api/v1/lots/${id}`)).body

describe('creating lots', () => {
  it('FR-2.1 a planner creates a lot for a product and gets its detail back', async () => {
    const res = await create({ label: ' Lot 1 ' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      version: 1,
      label: 'Lot 1',
      product: { id: w.product.id, name: 'Soundbar', variant: 'X1' },
      category: { id: w.lookups.bau.id, value: 'BAU' },
      status: { id: w.lookups.onTrack.id, value: 'On Track' },
      rmMode: 'all',
      lotQty: 100,
      rmBatches: [],
      grnReceipts: [],
      access: 'full',
      computed: { grnTotal: 0, balance: 100, completed: false },
    })
  })
  it('FR-2.1 keeps labels unique within a product, ignoring case', async () => {
    await create({ label: 'Lot 7' })
    const twin = await create({ label: 'LOT 7' })
    expect(twin.status).toBe(422)
    expect(twin.body.fields).toEqual({ label: 'This product already has a lot labelled LOT 7.' })
    const other = await makeProduct(db)
    expect((await create({ label: 'Lot 7', productId: other.id })).status).toBe(201)
  })
  it('FR-2.2 records every lot field and returns dropdowns as { id, value }', async () => {
    const res = await create({
      categoryId: w.lookups.npi.id,
      directFg: true,
      emsId: w.lookups.ems.id,
      pocId: w.lookups.pocA.id,
      statusId: w.lookups.delayed.id,
      rmMode: 'components',
      componentIds: [w.lookups.pcb.id, w.lookups.enclosure.id],
      lotQty: 500,
      freshProductionQty: 120,
      reworkQty: 20,
      reworkReason: 'Solder ',
      rmReadyDate: '2026-10-01',
      plannedDate: '2026-10-20',
      revisedEta: '2026-10-24',
      actualDate: '',
      logisticsId: w.lookups.road.id,
      blockerId: w.lookups.rmBlocker.id,
      blockerDescription: 'Waiting on PCBs',
      followUpDate: '2026-10-16',
      followUpNote: 'Call supplier',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      category: { value: 'NPI' },
      directFg: true,
      ems: { value: 'Orion EMS' },
      poc: { value: 'Maya Shah' },
      components: [
        { id: w.lookups.enclosure.id, value: 'Enclosure' },
        { id: w.lookups.pcb.id, value: 'PCB' },
      ],
      freshProductionQty: 120,
      reworkQty: 20,
      reworkReason: 'Solder',
      rmReadyDate: '2026-10-01',
      plannedDate: '2026-10-20',
      revisedEta: '2026-10-24',
      actualDate: null,
      logistics: { value: 'Road' },
      blocker: { value: 'RM Blocker' },
      blockerDescription: 'Waiting on PCBs',
      followUpDate: '2026-10-16',
      followUpNote: 'Call supplier',
    })
  })
  it('FR-2.3 needs whole quantities of zero or more, with rework within fresh production', async () => {
    const cases: [Record<string, unknown>, Record<string, string>][] = [
      [{ lotQty: -1 }, { lotQty: 'Lot quantity must be a whole number, zero or more.' }],
      [{ lotQty: 2.5 }, { lotQty: 'Lot quantity must be a whole number, zero or more.' }],
      [
        { freshProductionQty: 10, reworkQty: 11 },
        { reworkQty: 'Rework is part of fresh production, so it cannot be larger.' },
      ],
    ]
    for (const [overrides, fields] of cases) {
      const res = await create(overrides)
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual(fields)
    }
  })
  it('refuses impossible dates and quantities Postgres cannot hold, with field errors', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ plannedDate: '2026-02-30' }, 'plannedDate'],
      [{ revisedEta: '20/10/2026' }, 'revisedEta'],
      [{ lotQty: 3_000_000_000 }, 'lotQty'],
      [{ lotQty: '100' }, 'lotQty'],
    ]
    for (const [overrides, field] of cases) {
      const res = await create(overrides)
      expect(res.status).toBe(422)
      expect(Object.keys(res.body.fields)).toEqual([field])
    }
  })
  it('FR-8.3 refuses dropdown ids that are not an active value of the right kind', async () => {
    const deleted = await makeLookup(db, 'stage')
    await db.lookupValue.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
    const cases: [Record<string, unknown>, Record<string, string>][] = [
      [{ statusId: w.lookups.segment.id }, { statusId: 'Choose an overall status from the list.' }],
      [{ stageId: deleted.id }, { stageId: 'Choose a stage from the list.' }],
      [{ pocId: '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90' }, { pocId: 'Choose a point of contact from the list.' }],
      [{ componentIds: [w.lookups.ems.id] }, { componentIds: 'Choose components from the list.' }],
      [{ productId: '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90' }, { productId: 'This product no longer exists. Choose another.' }],
    ]
    for (const [overrides, fields] of cases) {
      const res = await create(overrides)
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual(fields)
    }
  })
  it('FR-3.1 tracks RM as one ready quantity or by component, and keeps the kit out of component mode', async () => {
    const all = await create({ rmMode: 'all', readyQty: 40 })
    expect(all.body.computed.rm).toEqual({
      producible: 40,
      bottleneck: 'Kit (All Together)',
      percent: 40,
      complete: false,
    })
    const kit = await create({ rmMode: 'components', componentIds: [w.lookups.kit.id] })
    expect(kit.status).toBe(422)
    expect(kit.body.fields).toEqual({
      componentIds:
        'Kit is an alternative to individual components. Use All RM Received mode for a kit.',
    })
  })
  it('refuses unknown fields rather than ignoring them', async () => {
    const res = await create({ status: 'Delayed' })
    expect(res.status).toBe(422)
    expect(Object.keys(res.body.fields)).toEqual(['form'])
  })
  it('lets only admins and planners create lots', async () => {
    for (const user of [w.poc, w.viewer]) {
      const res = await user.send('post', '/api/v1/lots', lotBody(w))
      expect(res.status).toBe(403)
    }
  })
})

describe('the lot detail', () => {
  it('FR-2.7 carries the one-line status in the client format', async () => {
    const created = await create({
      statusId: w.lookups.delayed.id,
      plannedDate: '2026-10-10',
      revisedEta: '2026-10-16',
      blockerId: w.lookups.rmBlocker.id,
    })
    // The test clock says 15 Oct 2026.
    expect(created.body.computed.summary).toBe('Delayed, 1d left — RM Blocker (Factory Production)')
  })
  it('FR-8.1 shows a renamed dropdown value at once', async () => {
    const created = await create({ logisticsId: w.lookups.road.id })
    await w.admin.send('patch', `/api/v1/lookups/${w.lookups.road.id}`, { value: 'Road freight' })
    expect((await detail(created.body.id)).logistics.value).toBe('Road freight')
    await w.admin.send('patch', `/api/v1/lookups/${w.lookups.road.id}`, { value: 'Road' })
  })
  it('lets every signed-in role read a lot, and answers 404 for none', async () => {
    const created = await create()
    for (const user of [w.poc, w.viewer])
      expect((await user.agent.get(`/api/v1/lots/${created.body.id}`)).status).toBe(200)
    expect((await request(app).get(`/api/v1/lots/${created.body.id}`)).status).toBe(401)
    expect((await w.admin.agent.get('/api/v1/lots/6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90')).status).toBe(404)
  })
})

describe('editing lots', () => {
  it('saves a change, moves the version on and records which fields changed', async () => {
    const created = await create({ plannedDate: '2026-10-20' })
    const res = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, {
      lotQty: 150,
      plannedDate: '2026-10-25',
      version: 1,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ lotQty: 150, plannedDate: '2026-10-25', version: 2 })
    const history = await db.activityLog.findMany({
      where: { entityId: created.body.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(history.map((h) => [h.kind, h.message, h.actorName])).toEqual([
      ['created', `Lot ${created.body.label} created`, 'Test planner'],
      ['updated', 'Updated lot qty, planned date', 'Test planner'],
    ])
    expect(history[1].changes).toEqual({
      lotQty: [100, 150],
      plannedDate: ['2026-10-20', '2026-10-25'],
    })
  })
  it('answers a stale version with 409 and the lot as it now stands', async () => {
    const created = await create()
    await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, { lotQty: 120, version: 1 })
    const stale = await w.admin.send('patch', `/api/v1/lots/${created.body.id}`, { lotQty: 130, version: 1 })
    expect(stale.status).toBe(409)
    expect(stale.body.current).toMatchObject({ lotQty: 120, version: 2 })
  })
  it('lets a POC update progress on their own lots, but not plan fields', async () => {
    const own = await create({ pocId: w.lookups.pocA.id })
    const progress = await w.poc.send('patch', `/api/v1/lots/${own.body.id}`, {
      statusId: w.lookups.delayed.id,
      freshProductionQty: 30,
      followUpDate: '2026-10-18',
      version: 1,
    })
    expect(progress.status).toBe(200)
    const plan = await w.poc.send('patch', `/api/v1/lots/${own.body.id}`, { lotQty: 90, version: 2 })
    expect(plan.status).toBe(403)
    expect(plan.body.message).toBe(
      "POC profiles can't change plan fields such as product, lot quantity, planned date, or POC. Ask an admin.",
    )
  })
  it("refuses a POC on another POC's lot and viewers on any lot", async () => {
    const theirs = await create({ pocId: w.lookups.pocB.id })
    const poc = await w.poc.send('patch', `/api/v1/lots/${theirs.body.id}`, { followUpNote: 'x', version: 1 })
    expect(poc.status).toBe(403)
    expect(poc.body.message).toBe("POC profiles can't edit lots owned by Rohit Mehta. Ask an admin.")
    const viewer = await w.viewer.send('patch', `/api/v1/lots/${theirs.body.id}`, { followUpNote: 'x', version: 1 })
    expect(viewer.status).toBe(403)
  })
  it('FR-2.4 keeps lot quantity at or above the GRN already received', async () => {
    const created = await create({ lotQty: 100 })
    await db.grnReceipt.create({
      data: { lotId: created.body.id, label: 'G1', date: day('2026-10-10'), quantity: 60 },
    })
    await refreshCompletion(db, created.body.id)
    const res = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, { lotQty: 50, version: 1 })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ lotQty: 'Lot quantity cannot be below the 60 units already received.' })
    expect((await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, { lotQty: 60, version: 1 })).status).toBe(200)
    expect((await detail(created.body.id)).completedOn).toBe('2026-10-10')
  })
  it('FR-3.3 keeps a component selected while it has batches', async () => {
    const created = await create({
      rmMode: 'components',
      componentIds: [w.lookups.pcb.id, w.lookups.enclosure.id],
    })
    await db.rmBatch.create({
      data: { lotId: created.body.id, componentId: w.lookups.pcb.id, label: 'B1', receivedQty: 10 },
    })
    const res = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, {
      componentIds: [w.lookups.enclosure.id],
      version: 1,
    })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      componentIds:
        'PCB still has material batches. Keep the component selected or delete its batches first.',
    })
    const dropEnclosure = await w.planner.send('patch', `/api/v1/lots/${created.body.id}`, {
      componentIds: [w.lookups.pcb.id],
      version: 1,
    })
    expect(dropEnclosure.body.components).toEqual([{ id: w.lookups.pcb.id, value: 'PCB' }])
  })
})

describe('deleting lots', () => {
  it('soft-deletes the lot and its entries; only admins may', async () => {
    const created = await create()
    await db.grnReceipt.create({
      data: { lotId: created.body.id, label: 'G1', date: day('2026-10-10'), quantity: 5 },
    })
    expect((await w.planner.send('delete', `/api/v1/lots/${created.body.id}`)).status).toBe(403)
    expect((await w.admin.send('delete', `/api/v1/lots/${created.body.id}`)).status).toBe(204)
    expect((await w.admin.agent.get(`/api/v1/lots/${created.body.id}`)).status).toBe(404)
    const receipt = await db.grnReceipt.findFirstOrThrow({ where: { lotId: created.body.id } })
    expect(receipt.deletedAt).not.toBeNull()
    expect(
      (await w.admin.send('patch', `/api/v1/lots/${created.body.id}`, { lotQty: 1, version: 1 })).status,
    ).toBe(404)
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/lots.int.test.ts`
Expected: FAIL. `lot-lock.ts` doesn't exist, so the file can't import `refreshCompletion`.

- [ ] **Step 4: Implement the lot lock and completion**

Create `apps/api/src/modules/lots/lot-lock.ts`:

```ts
import { deniedMessage, PermissionError } from '@boat/domain/permissions'
import type { SessionUser } from '../../core/access'
import { NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { lotAccess, lotInclude, type LotRow } from './lot-view'

// Every change to a lot or its entries starts by locking the lot row. Concurrent changes to one
// lot then run one after another, so checks such as "total GRN ≤ lot quantity" see every
// committed receipt (PRD: over-receipt guard).
export async function lockLot(db: Db, id: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM lots WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`
  if (!rows.length) throw new NotFoundError()
  return db.lot.findUniqueOrThrow({ where: { id }, include: lotInclude })
}

// The browser's wording: "POC profiles can't edit lots owned by Rohit Mehta. Ask an admin."
export const lotDenial = (user: SessionUser, lot: LotRow) =>
  new PermissionError(
    deniedMessage(user.role, lot.poc ? `edit lots owned by ${lot.poc.value}` : 'edit lots without a POC'),
  )

// lockLot plus the per-lot check: admins and planners have full access, a POC has progress
// access to lots assigned to their point of contact, everyone else none.
export async function lockLotForEdit(db: Db, user: SessionUser, id: string) {
  const lot = await lockLot(db, id)
  if (lotAccess(user, lot) === 'none') throw lotDenial(user, lot)
  return lot
}

// FR-4.3: keeps grn_total and completed_on in step with the lot's active receipts. A lot is
// complete when its quantity is above zero and every unit has been received; the full-GRN date
// is the latest receipt's date. Editing or deleting a receipt, or raising the lot quantity,
// clears it. Call it after the change, inside the same transaction.
export async function refreshCompletion(db: Db, lotId: string) {
  await db.$executeRaw`
    UPDATE lots l
    SET grn_total = s.total,
        completed_on = CASE WHEN l.lot_qty > 0 AND s.total = l.lot_qty THEN s.last END
    FROM (
      SELECT COALESCE(SUM(quantity), 0)::int AS total, MAX(date) AS last
      FROM grn_receipts
      WHERE lot_id = ${lotId}::uuid AND deleted_at IS NULL
    ) s
    WHERE l.id = ${lotId}::uuid`
}
```

- [ ] **Step 5: Implement the lots service**

Create `apps/api/src/modules/lots/lots.service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { Lot } from '@boat/domain/models'
import { changedPlanFields, deniedMessage, PermissionError } from '@boat/domain/permissions'
import { assertValid, validateLot, ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf, recordActivity } from '../../core/audit'
import type { RecordsDeps } from '../../core/clock'
import { fromDbDate, toDbDate } from '../../core/dates'
import { ConflictError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { type LookupKind, Prisma } from '../../generated/prisma/client'
import { renameFields, resolveLookups } from '../lookups/resolve'
import { softDeleteLots } from './lot-deletion'
import { lockLot, lockLotForEdit, refreshCompletion } from './lot-lock'
import { batchInclude, getLotDetail, lotAccess, type LotRow, toDomainLot } from './lot-view'

export type LotInput = {
  productId: string
  label: string
  categoryId: string
  directFg: boolean
  emsId: string | null
  pocId: string | null
  statusId: string
  stageId: string
  rmMode: 'all' | 'components'
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

type IdField = 'categoryId' | 'emsId' | 'pocId' | 'statusId' | 'stageId' | 'logisticsId' | 'blockerId'
const references: [IdField, LookupKind, string][] = [
  ['categoryId', 'category', 'a product category'],
  ['emsId', 'ems', 'an EMS'],
  ['pocId', 'poc', 'a point of contact'],
  ['statusId', 'status', 'an overall status'],
  ['stageId', 'stage', 'a stage'],
  ['logisticsId', 'logistics', 'a logistics mode'],
  ['blockerId', 'blocker', 'a blocker category'],
]
// validateLot names fields as the browser does; the API takes ids.
const apiNames = {
  category: 'categoryId',
  ems: 'emsId',
  poc: 'pocId',
  status: 'statusId',
  stage: 'stageId',
  rmComponents: 'componentIds',
  logisticsMode: 'logisticsId',
  blockerCategory: 'blockerId',
}
// The demo's lot fields in its order. History names the ones that changed.
const historyFields: (keyof Lot)[] = [
  'productId',
  'label',
  'category',
  'directFg',
  'ems',
  'poc',
  'status',
  'stage',
  'rmMode',
  'rmComponents',
  'readyQty',
  'lotQty',
  'freshProductionQty',
  'reworkQty',
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
]
const spaced = (field: string) => field.replace(/([A-Z])/g, ' $1').toLowerCase()

// Checks every reference against Settings (FR-8.3) and the product table, runs the shared
// validateLot, and returns the lot in the domain's shape for plan-field checks and history.
// FOR SHARE on the product keeps a concurrent product delete from missing this lot.
async function checkLot(db: Db, id: string, input: LotInput): Promise<Lot> {
  const product = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM products WHERE id = ${input.productId}::uuid AND deleted_at IS NULL FOR SHARE`
  const { valueOf, errors } = await resolveLookups(db, [
    ...references.map(([field, kind, label]) => ({ field, kind, id: input[field], label })),
    ...input.componentIds.map((cid) => ({
      field: 'componentIds',
      kind: 'component' as const,
      id: cid,
      label: 'components',
    })),
  ])
  const lot: Lot = {
    id,
    createdAt: '',
    updatedAt: '',
    productId: input.productId,
    label: input.label.trim(),
    category: valueOf(input.categoryId),
    directFg: input.directFg,
    ems: valueOf(input.emsId),
    poc: valueOf(input.pocId),
    status: valueOf(input.statusId),
    stage: valueOf(input.stageId),
    rmMode: input.rmMode,
    rmComponents: input.componentIds.map(valueOf).sort(),
    readyQty: input.readyQty,
    lotQty: input.lotQty,
    freshProductionQty: input.freshProductionQty,
    reworkQty: input.reworkQty,
    reworkReason: input.reworkReason.trim(),
    rmReadyDate: input.rmReadyDate ?? '',
    plannedDate: input.plannedDate ?? '',
    revisedEta: input.revisedEta ?? '',
    actualDate: input.actualDate ?? '',
    logisticsMode: valueOf(input.logisticsId),
    blockerCategory: valueOf(input.blockerId),
    blockerDescription: input.blockerDescription.trim(),
    followUpDate: input.followUpDate ?? '',
    followUpNote: input.followUpNote.trim(),
  }
  assertValid({
    ...renameFields(validateLot(lot), apiNames),
    ...(!product.length && { productId: 'This product no longer exists. Choose another.' }),
    ...errors,
  })
  return lot
}

const inputOf = (row: LotRow): LotInput => ({
  productId: row.productId,
  label: row.label,
  categoryId: row.categoryId,
  directFg: row.directFg,
  emsId: row.emsId,
  pocId: row.pocId,
  statusId: row.statusId,
  stageId: row.stageId,
  rmMode: row.rmMode,
  componentIds: row.components.map((c) => c.component.id),
  readyQty: row.readyQty,
  lotQty: row.lotQty,
  freshProductionQty: row.freshProductionQty,
  reworkQty: row.reworkQty,
  reworkReason: row.reworkReason,
  rmReadyDate: fromDbDate(row.rmReadyDate),
  plannedDate: fromDbDate(row.plannedDate),
  revisedEta: fromDbDate(row.revisedEta),
  actualDate: fromDbDate(row.actualDate),
  logisticsId: row.logisticsId,
  blockerId: row.blockerId,
  blockerDescription: row.blockerDescription,
  followUpDate: fromDbDate(row.followUpDate),
  followUpNote: row.followUpNote,
})

const lotData = (input: LotInput, lot: Lot) => ({
  productId: input.productId,
  label: lot.label,
  categoryId: input.categoryId,
  directFg: input.directFg,
  emsId: input.emsId,
  pocId: input.pocId,
  statusId: input.statusId,
  stageId: input.stageId,
  rmMode: input.rmMode,
  readyQty: input.readyQty,
  lotQty: input.lotQty,
  freshProductionQty: input.freshProductionQty,
  reworkQty: input.reworkQty,
  reworkReason: lot.reworkReason,
  rmReadyDate: toDbDate(input.rmReadyDate),
  plannedDate: toDbDate(input.plannedDate),
  revisedEta: toDbDate(input.revisedEta),
  actualDate: toDbDate(input.actualDate),
  logisticsId: input.logisticsId,
  blockerId: input.blockerId,
  blockerDescription: lot.blockerDescription,
  followUpDate: toDbDate(input.followUpDate),
  followUpNote: lot.followUpNote,
})

// FR-2.1: the partial unique index on (product_id, label) is case-insensitive (citext).
const duplicateLabel = (label: string) => (err: unknown): never => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    throw new ValidationError({ label: `This product already has a lot labelled ${label}.` })
  throw err
}

// FR-3.3: in component mode, a component can't be unselected while it still has batches.
async function assertComponentsFree(db: Db, current: LotRow, input: LotInput) {
  if (input.rmMode !== 'components') return
  const removed = current.components
    .map((c) => c.component.id)
    .filter((cid) => !input.componentIds.includes(cid))
  if (!removed.length) return
  const batches = await db.rmBatch.findMany({
    where: { lotId: current.id, deletedAt: null, componentId: { in: removed } },
    include: batchInclude,
  })
  const names = [...new Set(batches.map((b) => b.component.value))].sort()
  if (names.length)
    throw new ValidationError({
      componentIds: `${names.join(', ')} still ha${names.length > 1 ? 've' : 's'} material batches. Keep the component selected or delete its batches first.`,
    })
}

async function syncComponents(db: Db, user: SessionUser, current: LotRow, ids: string[]) {
  const before = current.components.map((c) => c.component.id)
  const removed = before.filter((cid) => !ids.includes(cid))
  const added = ids.filter((cid) => !before.includes(cid))
  if (removed.length)
    await db.lotComponent.updateMany({
      where: { lotId: current.id, deletedAt: null, componentId: { in: removed } },
      data: { deletedAt: new Date(), deletedBy: user.id },
    })
  if (added.length)
    await db.lotComponent.createMany({
      data: added.map((componentId) => ({ lotId: current.id, componentId })),
    })
}

export async function createLot({ db, clock }: RecordsDeps, user: SessionUser, input: LotInput) {
  const id = randomUUID()
  const clean = { ...input, componentIds: [...new Set(input.componentIds)] }
  await db.$transaction(async (tx) => {
    const lot = await checkLot(tx, id, clean)
    await tx.lot.create({ data: { id, ...lotData(clean, lot) } }).catch(duplicateLabel(lot.label))
    if (clean.componentIds.length)
      await tx.lotComponent.createMany({
        data: clean.componentIds.map((componentId) => ({ lotId: id, componentId })),
      })
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: id,
      kind: 'created',
      message: `Lot ${lot.label} created`,
    })
  })
  return getLotDetail(db, id, await clock.today(), user)
}

export async function updateLot(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  id: string,
  patch: LotPatch,
) {
  const date = await clock.today()
  await db.$transaction(async (tx) => {
    const current = await lockLotForEdit(tx, user, id)
    const { version, ...changes } = patch
    if (version !== current.version)
      throw new ConflictError(
        'Someone else changed this lot. Review their changes and try again.',
        await getLotDetail(tx, id, date, user),
      )
    const merged = { ...inputOf(current), ...changes }
    const input = { ...merged, componentIds: [...new Set(merged.componentIds)] }
    const old = toDomainLot(current)
    const next = await checkLot(tx, id, input)
    if (lotAccess(user, current) === 'progress' && changedPlanFields(old, next).length)
      throw new PermissionError(
        deniedMessage(user.role, 'change plan fields such as product, lot quantity, planned date, or POC'),
      )
    if (next.lotQty < current.grnTotal)
      throw new ValidationError({
        lotQty: `Lot quantity cannot be below the ${current.grnTotal} units already received.`,
      })
    await assertComponentsFree(tx, current, input)
    await tx.lot
      .update({ where: { id }, data: { ...lotData(input, next), version: { increment: 1 } } })
      .catch(duplicateLabel(next.label))
    await syncComponents(tx, user, current, input.componentIds)
    await refreshCompletion(tx, id)
    const changed = historyFields.filter((k) => JSON.stringify(old[k]) !== JSON.stringify(next[k]))
    if (changed.length)
      await recordActivity(tx, actorOf(user), {
        entityType: 'lot',
        entityId: id,
        kind: 'updated',
        message: `Updated ${changed.map(spaced).join(', ')}`,
        changes: Object.fromEntries(changed.map((k) => [k, [old[k], next[k]]])) as Prisma.InputJsonObject,
      })
  })
  return getLotDetail(db, id, date, user)
}

export async function deleteLot({ db }: RecordsDeps, user: SessionUser, id: string) {
  await db.$transaction(async (tx) => {
    const lot = await lockLot(tx, id)
    await softDeleteLots(tx, actorOf(user), [{ id, label: lot.label }])
  })
}
```

The test expects the history message `Updated lot qty, planned date`. `spaced('lotQty')` gives `lot qty`, which is the demo's own wording for that field (`repository.ts` builds the message the same way).

- [ ] **Step 6: Implement the router and mount it**

Create `apps/api/src/modules/lots/lots.router.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requireLotAccess, requirePermission, requireSignedIn } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { optionalDate } from '../../core/dates'
import { parseId, parseInput } from '../../core/parse'
import { getLotDetail } from './lot-view'
import { createLot, deleteLot, updateLot } from './lots.service'

const choose = (label: string) => z.guid({ error: `Choose ${label} from the list.` })
// Whole-number and sign rules come from validateLot; this keeps values inside Postgres integer.
const qty = (label: string) =>
  z
    .number({ error: `Enter the ${label} as a number.` })
    .max(1_000_000_000, { error: 'Enter 1,000,000,000 or less.' })
const text = (max: number) =>
  z.string({ error: 'Enter text.' }).max(max, { error: `Keep this to ${max} characters or fewer.` })

const fields = {
  productId: z.guid({ error: 'Choose a product.' }),
  label: z
    .string({ error: 'Enter a lot label, e.g. Lot 1.' })
    .max(60, { error: 'Keep the label to 60 characters or fewer.' }),
  categoryId: choose('a product category'),
  directFg: z.boolean({ error: 'Choose yes or no.' }),
  emsId: choose('an EMS').nullable(),
  pocId: choose('a point of contact').nullable(),
  statusId: choose('an overall status'),
  stageId: choose('a stage'),
  rmMode: z.enum(['all', 'components'], { error: 'Choose how RM is tracked.' }),
  componentIds: z.array(choose('components')).max(50, { error: 'Choose 50 components or fewer.' }),
  readyQty: qty('ready quantity'),
  lotQty: qty('lot quantity'),
  freshProductionQty: qty('fresh production quantity'),
  reworkQty: qty('rework quantity'),
  reworkReason: text(500),
  rmReadyDate: optionalDate,
  plannedDate: optionalDate,
  revisedEta: optionalDate,
  actualDate: optionalDate,
  logisticsId: choose('a logistics mode').nullable(),
  blockerId: choose('a blocker category').nullable(),
  blockerDescription: text(1000),
  followUpDate: optionalDate,
  followUpNote: text(1000),
}
// Unknown keys are refused, so a typo such as "status" for "statusId" fails loudly.
const createBody = z.strictObject({
  ...fields,
  directFg: fields.directFg.default(false),
  emsId: fields.emsId.default(null),
  pocId: fields.pocId.default(null),
  rmMode: fields.rmMode.default('all'),
  componentIds: fields.componentIds.default([]),
  readyQty: fields.readyQty.default(0),
  lotQty: fields.lotQty.default(0),
  freshProductionQty: fields.freshProductionQty.default(0),
  reworkQty: fields.reworkQty.default(0),
  reworkReason: fields.reworkReason.default(''),
  rmReadyDate: fields.rmReadyDate.default(null),
  plannedDate: fields.plannedDate.default(null),
  revisedEta: fields.revisedEta.default(null),
  actualDate: fields.actualDate.default(null),
  logisticsId: fields.logisticsId.default(null),
  blockerId: fields.blockerId.default(null),
  blockerDescription: fields.blockerDescription.default(''),
  followUpDate: fields.followUpDate.default(null),
  followUpNote: fields.followUpNote.default(''),
})
const patchBody = z
  .strictObject(fields)
  .partial()
  .extend({ version: z.number({ error: 'Reload the lot and try again.' }).int() })

export function lotsRouter(deps: RecordsDeps) {
  const router = Router()

  // List, summary and CSV routes (Task 6) go above /:id, which would otherwise match them.

  router.get('/:id', requireSignedIn(), async (req, res) => {
    const date = await deps.clock.today()
    res.json(await getLotDetail(deps.db, parseId(req.params.id), date, authOf(req).user))
  })

  router.post('/', requirePermission('createLots'), async (req, res) => {
    res.status(201).json(await createLot(deps, authOf(req).user, parseInput(createBody, req.body)))
  })

  router.patch('/:id', requireLotAccess(), async (req, res) => {
    const patch = parseInput(patchBody, req.body)
    res.json(await updateLot(deps, authOf(req).user, parseId(req.params.id), patch))
  })

  router.delete('/:id', requirePermission('deleteLots'), async (req, res) => {
    await deleteLot(deps, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
```

In `apps/api/src/api.ts`, import `lotsRouter` from `./modules/lots/lots.router` and mount it after `/products`:

```ts
  mount(api, '/lots', lotsRouter(records))
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /lots/:id signedIn',
        'POST /lots createLots',
        'PATCH /lots/:id lotAccess',
        'DELETE /lots/:id deleteLots',
```

- [ ] **Step 7: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 8: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add lot create, edit, delete and detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Lot list, summary cards and CSV export

FR-2.5 and FR-2.6. Filters, flags and sorting run in SQL, so the list stays fast at 20,000 lots. Only the requested page is loaded and passed through `lotView`. The flags must mean exactly what `lotFlags` and `rmMetrics` mean, so a parity test runs every flag filter against the flags the domain computes for the same lots. The filters and quick filters are the demo's (`Production.tsx`), so the Phase 5 switch is mechanical.

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`@@index([followUpDate])` on `Lot`)
- Create: `apps/api/prisma/migrations/20261015120100_lot_follow_up_index/migration.sql`
- Create: `apps/api/src/core/csv.ts`, `apps/api/src/core/csv.test.ts`
- Create: `apps/api/src/modules/lots/lot-list.ts`
- Modify: `apps/api/src/modules/lots/lots.service.ts`, `apps/api/src/modules/lots/lots.router.ts`, `apps/api/src/api.test.ts`
- Test: `apps/api/test/lots-list.int.test.ts`

**Interfaces:**
- Consumes: from Task 4, `loadLotViews` and `LotView`; from Phase 2, `pageQuery`, `pageArgs`, `pageOf` and `Page`; `dayOffset` from `@boat/domain/calculations`.
- Produces:
  - `toCsv(headers: string[], rows: Record<string, unknown>[]): string`
  - `lotFlagNames` (`'overdue' | 'dueSoon' | 'followUp' | 'blocked' | 'approval' | 'rm' | 'npi' | 'onTrack'`), `lotSorts` (`'eta-asc' | 'eta-desc' | 'qty-desc' | 'balance-desc' | 'product-asc' | 'label-asc'`), and the types `LotFlag`, `LotSort`, `LotFilters`
  - `findLotIds(db, filters, today, page?)`, `countLots(db, filters, today)`, `lotCardCounts(db, today)`
  - `listLots(deps, user, filters, page)` → `{ items: LotView[], total, page, pageSize }`; `lotCards(deps)` → `{ overdue, dueSoon, onTrack, blocked, approval, followUp, rm }`; `exportLotsCsv(deps, user, filters)` → `{ filename, body }`
  - Routes (all signedIn, declared above `/:id`):
    - `GET /lots?view=&q=&segmentId=&categoryId=&emsId=&pocId=&statusId=&stageId=&logisticsId=&blockerId=&flag=&sort=&page=&pageSize=`
    - `GET /lots/summary`
    - `GET /lots/export.csv` (same filters, no paging)

- [ ] **Step 1: Write the failing CSV test**

Create `apps/api/src/core/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('quotes every cell, doubles quotes and ends lines with CRLF', () => {
    expect(toCsv(['A', 'B'], [{ A: 'x "y"', B: 3 }, { A: null }])).toBe(
      '"A","B"\r\n"x ""y""","3"\r\n"",""\r\n',
    )
  })
  it('neutralises text that a spreadsheet would run as a formula', () => {
    const csv = toCsv(['Lot'], [{ Lot: '=HYPERLINK("x")' }, { Lot: '+1' }, { Lot: '@SUM' }, { Lot: '-2' }])
    expect(csv).toBe('"Lot"\r\n"\'=HYPERLINK(""x"")"\r\n"\'+1"\r\n"\'@SUM"\r\n"\'-2"\r\n')
  })
  it('leaves negative numbers alone', () => {
    expect(toCsv(['Days'], [{ Days: -3 }])).toBe('"Days"\r\n"-3"\r\n')
  })
  it('writes only the header for no rows', () => {
    expect(toCsv(['A'], [])).toBe('"A"\r\n')
  })
})
```

Run: `pnpm --filter @boat/api test -- src/core/csv.test.ts`
Expected: FAIL. `./csv` doesn't exist.

- [ ] **Step 2: Implement CSV**

Create `apps/api/src/core/csv.ts`:

```ts
// Excel and Google Sheets run a cell that starts with = + - @ (or a tab or carriage return) as a
// formula, so text cells starting with one get a leading apostrophe (OWASP "CSV injection").
// Numbers are left alone: -3 is a number, not a formula.
const formula = /^[=+\-@\t\r]/

function cell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  const safe = typeof value === 'string' && formula.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export const toCsv = (headers: string[], rows: Record<string, unknown>[]) =>
  [headers, ...rows.map((row) => headers.map((h) => row[h]))]
    .map((line) => line.map(cell).join(','))
    .join('\r\n') + '\r\n'
```

Run: `pnpm --filter @boat/api test -- src/core/csv.test.ts`
Expected: PASS.

- [ ] **Step 3: Add the follow-up index**

In `apps/api/prisma/schema.prisma`, add to `model Lot`, next to the other indexes:

```prisma
  @@index([followUpDate])
```

Create `apps/api/prisma/migrations/20261015120100_lot_follow_up_index/migration.sql`:

```sql
-- The follow-up flag filters on follow_up_date <= today (PRD, "List filters at scale").
CREATE INDEX "lots_follow_up_date_idx" ON "lots"("follow_up_date");
```

The PRD also asks for an expression index on `COALESCE(revised_eta, planned_date)`. Prisma can't declare one, so it would look like drift and a later migration would drop it. The roadmap explains why it isn't needed at 20,000 lots, and Task 10 measures it.

Run: `pnpm --filter @boat/api generate && pnpm --filter @boat/api test:int -- test/database.int.test.ts`
Expected: PASS, including "migrations match schema.prisma exactly".

- [ ] **Step 4: Write the failing list tests**

Create `apps/api/test/lots-list.int.test.ts`:

```ts
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client'
import { refreshCompletion } from '../src/modules/lots/lot-lock'
import { createTestDatabase } from './support/db'
import {
  day,
  fixedNow,
  makeLot,
  makeProduct,
  makeRecordsWorld,
  type RecordsWorld,
  testApp,
} from './support/fixtures'

type Item = {
  id: string
  label: string
  lotQty: number
  plannedDate: string | null
  revisedEta: string | null
  product: { name: string }
  category: { value: string }
  status: { id: string; value: string }
  poc: { id: string } | null
  blocker: { id: string } | null
  computed: {
    balance: number
    flags: Record<'overdue' | 'dueSoon' | 'followUp' | 'blocked' | 'approval', boolean>
    rm: { complete: boolean }
  }
}

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
const ids: Record<string, string> = {}

const lot = async (name: string, fields: Partial<Prisma.LotUncheckedCreateInput> = {}) => {
  const row = await makeLot(db, {
    productId: w.product.id,
    label: name,
    stageId: w.lookups.stage.id,
    ...fields,
  })
  ids[name] = row.id
  return row
}
const withComponents = async (name: string, received: Record<string, number>) => {
  const row = await lot(name, { rmMode: 'components' })
  for (const [componentId, qty] of Object.entries(received)) {
    await db.lotComponent.create({ data: { lotId: row.id, componentId } })
    if (qty) await db.rmBatch.create({ data: { lotId: row.id, componentId, label: 'B', receivedQty: qty } })
  }
}

// One lot per edge of each flag. The test clock says 15 Oct 2026.
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  const L = w.lookups
  await lot('overdue', { plannedDate: day('2026-10-14') })
  await lot('due today', { plannedDate: day('2026-10-15') })
  await lot('due in 3 days', { plannedDate: day('2026-10-18') })
  await lot('due in 4 days', { plannedDate: day('2026-10-19') })
  await lot('revised ETA wins', { plannedDate: day('2026-10-01'), revisedEta: day('2026-10-17') })
  await lot('no ETA')
  await lot('follow-up today', { followUpDate: day('2026-10-15') })
  await lot('follow-up tomorrow', { followUpDate: day('2026-10-16') })
  await lot('delayed', { statusId: L.delayed.id, pocId: L.pocA.id })
  await lot('on hold', { statusId: L.hold.id, pocId: L.pocB.id })
  await lot('blocker none', { blockerId: L.none.id })
  await lot('rm blocker', { blockerId: L.rmBlocker.id })
  await lot('approval blocker', { blockerId: L.approval.id })
  await lot('npi', { categoryId: L.npi.id })
  await lot('ready kit', { readyQty: 100 })
  await lot('zero quantity', { lotQty: 0, readyQty: 0 })
  await withComponents('no components', {})
  await withComponents('kit only', { [L.kit.id]: 100 })
  await withComponents('components received', { [L.pcb.id]: 100, [L.enclosure.id]: 120 })
  await withComponents('enclosure short', { [L.pcb.id]: 100, [L.enclosure.id]: 40 })
  const done = await lot('completed', { plannedDate: day('2026-10-01') })
  await db.grnReceipt.create({ data: { lotId: done.id, label: 'G', date: day('2026-10-05'), quantity: 100 } })
  await refreshCompletion(db, done.id)
  const gone = await lot('deleted lot')
  await db.lot.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
  const oldProduct = await makeProduct(db)
  await makeLot(db, { productId: oldProduct.id, label: 'lot of a deleted product' })
  await db.product.update({ where: { id: oldProduct.id }, data: { deletedAt: new Date() } })
})
afterAll(() => close())

const list = async (query = '') => {
  const res = await w.viewer.agent.get(`/api/v1/lots?pageSize=200${query}`)
  expect(res.status).toBe(200)
  return res.body as { items: Item[]; total: number; page: number; pageSize: number }
}
const labels = (items: Item[]) => items.map((i) => i.label).sort()

describe('the list', () => {
  it('FR-2.5 shows active lots by default and completed lots on request, never deleted ones', async () => {
    const active = await list()
    expect(active.items).toHaveLength(20)
    expect(active.total).toBe(20)
    expect(labels(active.items)).not.toContain('completed')
    expect(labels(active.items)).not.toContain('deleted lot')
    expect(labels(active.items)).not.toContain('lot of a deleted product')
    expect(labels((await list('&view=completed')).items)).toEqual(['completed'])
  })
  it('FR-2.5 searches product name, variant and lot label, ignoring case', async () => {
    expect(labels((await list('&q=FOLLOW-UP')).items)).toEqual(['follow-up today', 'follow-up tomorrow'])
    expect((await list('&q=soundbar%20x1')).total).toBe(20)
  })
  it('treats % and _ in the search text as plain characters', async () => {
    const promo = await makeProduct(db, { name: 'Promo 100%' })
    const other = await makeProduct(db, { name: 'Promo 1000' })
    await makeLot(db, { productId: promo.id, label: 'LOT_7' })
    await makeLot(db, { productId: other.id, label: 'LOTA7' })
    expect(labels((await list(`&q=${encodeURIComponent('100%')}`)).items)).toEqual(['LOT_7'])
    expect(labels((await list('&q=LOT_7')).items)).toEqual(['LOT_7'])
  })
  it('FR-2.5 filters by status, POC, blocker, category and segment', async () => {
    const L = w.lookups
    expect(labels((await list(`&statusId=${L.delayed.id}`)).items)).toEqual(['delayed'])
    expect(labels((await list(`&pocId=${L.pocB.id}`)).items)).toEqual(['on hold'])
    expect(labels((await list(`&blockerId=${L.approval.id}`)).items)).toEqual(['approval blocker'])
    expect(labels((await list(`&categoryId=${L.npi.id}`)).items)).toEqual(['npi'])
    expect((await list(`&segmentId=${L.segment.id}`)).total).toBe(20)
  })
  // Label and product sorts follow the database collation, which orders spaces and hyphens
  // differently from JavaScript, so they are checked only through stable paging below.
  it('FR-2.5 sorts by ETA with missing ETAs last, and by quantity and balance', async () => {
    const eta = (i: Item) => i.revisedEta ?? i.plannedDate ?? '9999-12-31'
    const byEta = (await list('&sort=eta-asc')).items.map(eta)
    expect(byEta).toEqual([...byEta].sort())
    const byEtaDesc = (await list('&sort=eta-desc')).items.map(eta)
    expect(byEtaDesc).toEqual([...byEtaDesc].sort().reverse())
    const byQty = (await list('&sort=qty-desc')).items.map((i) => i.lotQty)
    expect(byQty).toEqual([...byQty].sort((a, b) => b - a))
    const byBalance = (await list('&sort=balance-desc')).items.map((i) => i.computed.balance)
    expect(byBalance).toEqual([...byBalance].sort((a, b) => b - a))
  })
  it('pages in a stable order', async () => {
    const all = (await list('&sort=label-asc')).items.map((i) => i.id)
    const res = await w.viewer.agent.get('/api/v1/lots?sort=label-asc&pageSize=5&page=2')
    expect(res.body).toMatchObject({ page: 2, pageSize: 5, total: all.length })
    expect(res.body.items.map((i: Item) => i.id)).toEqual(all.slice(5, 10))
  })
  it('answers an unknown filter with a field error', async () => {
    const res = await w.viewer.agent.get('/api/v1/lots?flag=urgent')
    expect(res.status).toBe(422)
  })
  it('needs a session', async () => {
    expect((await request(app).get('/api/v1/lots')).status).toBe(401)
  })
})

// The list filters and summary run in SQL; the detail flags come from packages/domain. They must
// agree on every lot, or a card would say 3 overdue while the list shows 2.
const expected: Record<string, (i: Item) => boolean> = {
  overdue: (i) => i.computed.flags.overdue,
  dueSoon: (i) => i.computed.flags.dueSoon,
  followUp: (i) => i.computed.flags.followUp,
  blocked: (i) => i.computed.flags.blocked,
  approval: (i) => i.computed.flags.approval,
  rm: (i) => !i.computed.rm.complete,
  npi: (i) => i.category.value !== 'BAU',
  onTrack: (i) =>
    i.status.value === 'On Track' &&
    !i.computed.flags.overdue &&
    !i.computed.flags.dueSoon &&
    !i.computed.flags.blocked,
}

describe('quick filters', () => {
  it('FR-2.5 match the flags the domain computes, on every flag', async () => {
    const all = (await list()).items
    for (const [flag, holds] of Object.entries(expected)) {
      const want = labels(all.filter(holds))
      expect(want.length, flag).toBeGreaterThan(0)
      expect(want.length, flag).toBeLessThan(all.length)
      expect(labels((await list(`&flag=${flag}`)).items), flag).toEqual(want)
    }
  })
  it('pins the date edges', async () => {
    expect(labels((await list('&flag=overdue')).items)).toEqual(['overdue'])
    expect(labels((await list('&flag=dueSoon')).items)).toEqual([
      'due in 3 days',
      'due today',
      'revised ETA wins',
    ])
    expect(labels((await list('&flag=followUp')).items)).toEqual(['follow-up today'])
    expect(labels((await list('&flag=rm')).items)).not.toContain('components received')
    expect(labels((await list('&flag=rm')).items)).toContain('enclosure short')
  })
  it('combines flags with AND', async () => {
    expect(labels((await list('&flag=blocked&flag=approval')).items)).toEqual(['approval blocker'])
  })
})

describe('GET /lots/summary', () => {
  it('FR-2.6 counts active lots for each card, as the list filters do', async () => {
    const all = (await list()).items
    const res = await w.viewer.agent.get('/api/v1/lots/summary')
    expect(res.status).toBe(200)
    const count = (flag: string) => all.filter(expected[flag]).length
    expect(res.body).toEqual({
      overdue: count('overdue'),
      dueSoon: count('dueSoon'),
      onTrack: count('onTrack'),
      blocked: count('blocked'),
      approval: count('approval'),
      followUp: count('followUp'),
      rm: count('rm'),
    })
  })
})

describe('GET /lots/export.csv', () => {
  it('FR-2.5 exports the filtered rows with the demo columns', async () => {
    const res = await w.viewer.agent.get('/api/v1/lots/export.csv?q=follow-up')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    expect(res.headers['content-disposition']).toBe('attachment; filename="active-lots-2026-10-15.csv"')
    const lines = res.text.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      '"Product","Variant","Segment","Lot","Status","StatusSummary","Category","EMS","POC","Stage","Mode","LotQty","Produced","Rework","GRN","Balance","RMReadyPercent","PlannedDate","CurrentETA","Blocker","FollowUp","FullGRNDate","DaysVsPlan","RMToGRNDays"',
    )
    expect(lines).toHaveLength(3)
  })
  it('neutralises formulas in exported text', async () => {
    await lot('=HYPERLINK("http://evil")')
    const res = await w.viewer.agent.get('/api/v1/lots/export.csv?q=HYPERLINK')
    expect(res.text).toContain('"\'=HYPERLINK(""http://evil"")"')
  })
})
```

- [ ] **Step 5: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/lots-list.int.test.ts`
Expected: FAIL. `GET /api/v1/lots` and `/lots/summary` reach `/:id`, which answers 404.

- [ ] **Step 6: Implement the SQL filters**

Create `apps/api/src/modules/lots/lot-list.ts`:

```ts
import { dayOffset } from '@boat/domain/calculations'
import type { Db } from '../../core/prisma'
import { Prisma } from '../../generated/prisma/client'

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

const filterColumns = {
  segmentId: 'p.segment_id',
  categoryId: 'l.category_id',
  emsId: 'l.ems_id',
  pocId: 'l.poc_id',
  statusId: 'l.status_id',
  stageId: 'l.stage_id',
  logisticsId: 'l.logistics_id',
  blockerId: 'l.blocker_id',
} as const
export type LotFilters = { view: 'active' | 'completed'; q: string; flags: LotFlag[]; sort: LotSort } & {
  [K in keyof typeof filterColumns]?: string
}

// Lots with what the filters read. Lots of a deleted product never show.
const from = Prisma.sql`
  lots l
  JOIN products p ON p.id = l.product_id AND p.deleted_at IS NULL
  JOIN lookup_values st ON st.id = l.status_id
  JOIN lookup_values cat ON cat.id = l.category_id
  LEFT JOIN lookup_values bl ON bl.id = l.blocker_id`

// rmMetrics(...).complete: "all received" mode compares the ready quantity; component mode needs
// at least one required component (the kit doesn't count) and every one fully received.
const kit = 'Kit (All Together)'
const required = Prisma.sql`
  FROM lot_components lc JOIN lookup_values c ON c.id = lc.component_id
  WHERE lc.lot_id = l.id AND lc.deleted_at IS NULL AND c.value::text <> ${kit}`
const rmComplete = Prisma.sql`(CASE
  WHEN l.rm_mode = 'all' THEN l.lot_qty > 0 AND l.ready_qty >= l.lot_qty
  ELSE l.lot_qty > 0
    AND EXISTS (SELECT 1 ${required})
    AND NOT EXISTS (
      SELECT 1 ${required}
      AND COALESCE((
        SELECT SUM(b.received_qty) FROM rm_batches b
        WHERE b.lot_id = l.id AND b.component_id = lc.component_id AND b.deleted_at IS NULL
      ), 0) < l.lot_qty)
  END)`

// lotFlags (packages/domain) plus the demo's quick filters, as SQL that is never NULL.
// System values are matched by system_key. lots-list.int.test.ts checks each against the domain.
function flagSql(flag: LotFlag, today: string): Prisma.Sql {
  const eta = Prisma.sql`COALESCE(l.revised_eta, l.planned_date)`
  const open = Prisma.sql`l.completed_on IS NULL`
  let sql: Prisma.Sql
  switch (flag) {
    case 'overdue':
      sql = Prisma.sql`${open} AND ${eta} < ${today}::date`
      break
    case 'dueSoon':
      sql = Prisma.sql`${open} AND ${eta} >= ${today}::date AND ${eta} <= ${dayOffset(today, 3)}::date`
      break
    case 'followUp':
      sql = Prisma.sql`${open} AND l.follow_up_date <= ${today}::date`
      break
    case 'blocked':
      sql = Prisma.sql`${open} AND (st.system_key IN ('delayed', 'hold')
        OR (l.blocker_id IS NOT NULL AND bl.system_key IS DISTINCT FROM 'none'))`
      break
    case 'approval':
      sql = Prisma.sql`${open} AND bl.system_key = 'approval_blocker'`
      break
    case 'rm':
      sql = Prisma.sql`NOT ${rmComplete}`
      break
    case 'npi':
      sql = Prisma.sql`cat.system_key IS DISTINCT FROM 'bau'`
      break
    case 'onTrack':
      sql = Prisma.sql`st.system_key = 'on_track'
        AND NOT ${flagSql('overdue', today)}
        AND NOT ${flagSql('dueSoon', today)}
        AND NOT ${flagSql('blocked', today)}`
      break
  }
  return Prisma.sql`COALESCE((${sql}), false)`
}

// Search text matches literally: % and _ are escaped, so "100%" finds "100%" and not "1000".
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

function whereSql(f: LotFilters, today: string) {
  const parts = [
    Prisma.sql`l.deleted_at IS NULL`,
    f.view === 'completed' ? Prisma.sql`l.completed_on IS NOT NULL` : Prisma.sql`l.completed_on IS NULL`,
  ]
  for (const [key, column] of Object.entries(filterColumns)) {
    const id = f[key as keyof typeof filterColumns]
    if (id) parts.push(Prisma.sql`${Prisma.raw(column)} = ${id}::uuid`)
  }
  const q = f.q.trim()
  if (q)
    parts.push(
      Prisma.sql`(p.name || ' ' || p.variant || ' ' || l.label) ILIKE ${likePattern(q)} ESCAPE '\\'`,
    )
  for (const flag of f.flags) parts.push(flagSql(flag, today))
  return Prisma.join(parts, ' AND ')
}

// The demo's sorts. A lot with no ETA sorts as 9999-12-31: last going up, first going down.
const order: Record<LotSort, Prisma.Sql> = {
  'eta-asc': Prisma.sql`COALESCE(l.revised_eta, l.planned_date, DATE '9999-12-31') ASC`,
  'eta-desc': Prisma.sql`COALESCE(l.revised_eta, l.planned_date, DATE '9999-12-31') DESC`,
  'qty-desc': Prisma.sql`l.lot_qty DESC`,
  'balance-desc': Prisma.sql`(l.lot_qty - l.grn_total) DESC`,
  'product-asc': Prisma.sql`p.name ASC`,
  'label-asc': Prisma.sql`l.label ASC`,
}

// Matching lot ids in display order; the id breaks ties so pages never overlap.
export async function findLotIds(
  db: Db,
  f: LotFilters,
  today: string,
  page?: { skip: number; take: number },
) {
  const limit = page ? Prisma.sql`LIMIT ${page.take} OFFSET ${page.skip}` : Prisma.empty
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT l.id FROM ${from} WHERE ${whereSql(f, today)} ORDER BY ${order[f.sort]}, l.id ${limit}`
  return rows.map((r) => r.id)
}

export async function countLots(db: Db, f: LotFilters, today: string) {
  const [row] = await db.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM ${from} WHERE ${whereSql(f, today)}`
  return row.count
}

// The demo's summary cards, over every active lot.
const cards = ['overdue', 'dueSoon', 'onTrack', 'blocked', 'approval', 'followUp', 'rm'] as const
export async function lotCardCounts(db: Db, today: string) {
  const columns = Prisma.join(
    cards.map((c) => Prisma.sql`(COUNT(*) FILTER (WHERE ${flagSql(c, today)}))::int AS ${Prisma.raw(`"${c}"`)}`),
  )
  const [row] = await db.$queryRaw<Record<(typeof cards)[number], number>[]>`
    SELECT ${columns} FROM ${from} WHERE l.deleted_at IS NULL AND l.completed_on IS NULL`
  return row
}
```

- [ ] **Step 7: Add the service functions**

In `apps/api/src/modules/lots/lots.service.ts`, add these imports:

```ts
import { toCsv } from '../../core/csv'
import { type Page, pageArgs, pageOf } from '../../core/pagination'
import { countLots, findLotIds, lotCardCounts, type LotFilters } from './lot-list'
```

Add `loadLotViews` and `type LotView` to the existing `./lot-view` import. Then append:

```ts
export async function listLots({ db, clock }: RecordsDeps, user: SessionUser, filters: LotFilters, page: Page) {
  const date = await clock.today()
  const [ids, total] = await Promise.all([
    findLotIds(db, filters, date, pageArgs(page)),
    countLots(db, filters, date),
  ])
  return pageOf(await loadLotViews(db, ids, date, user), total, page)
}

export async function lotCards({ db, clock }: RecordsDeps) {
  return lotCardCounts(db, await clock.today())
}

// The demo's CSV columns (Production.tsx).
const csvHeaders = [
  'Product',
  'Variant',
  'Segment',
  'Lot',
  'Status',
  'StatusSummary',
  'Category',
  'EMS',
  'POC',
  'Stage',
  'Mode',
  'LotQty',
  'Produced',
  'Rework',
  'GRN',
  'Balance',
  'RMReadyPercent',
  'PlannedDate',
  'CurrentETA',
  'Blocker',
  'FollowUp',
  'FullGRNDate',
  'DaysVsPlan',
  'RMToGRNDays',
]
const csvRow = (v: LotView) => ({
  Product: v.product.name,
  Variant: v.product.variant,
  Segment: v.product.segment.value,
  Lot: v.label,
  Status: v.status.value,
  StatusSummary: v.computed.summary,
  Category: v.category.value,
  EMS: v.ems?.value ?? '',
  POC: v.poc?.value ?? '',
  Stage: v.stage.value,
  Mode: v.logistics?.value ?? '',
  LotQty: v.lotQty,
  Produced: v.freshProductionQty,
  Rework: v.reworkQty,
  GRN: v.computed.grnTotal,
  Balance: v.computed.balance,
  RMReadyPercent: Math.round(v.computed.rm.percent),
  PlannedDate: v.plannedDate ?? '',
  CurrentETA: v.revisedEta ?? v.plannedDate ?? '',
  Blocker: v.blocker?.value ?? '',
  FollowUp: v.followUpDate ?? '',
  FullGRNDate: v.computed.fullGrnDate ?? '',
  DaysVsPlan: v.computed.planDelay ?? '',
  RMToGRNDays: v.computed.leadTime ?? '',
})

// Every matching lot, loaded 500 at a time.
export async function exportLotsCsv({ db, clock }: RecordsDeps, user: SessionUser, filters: LotFilters) {
  const date = await clock.today()
  const ids = await findLotIds(db, filters, date)
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 500)
    for (const view of await loadLotViews(db, ids.slice(i, i + 500), date, user)) rows.push(csvRow(view))
  return { filename: `${filters.view}-lots-${date}.csv`, body: toCsv(csvHeaders, rows) }
}
```

- [ ] **Step 8: Add the routes above `/:id`**

In `apps/api/src/modules/lots/lots.router.ts`, add these imports:

```ts
import { pageQuery } from '../../core/pagination'
import { type LotFilters, lotFlagNames, lotSorts } from './lot-list'
```

Add `exportLotsCsv`, `listLots` and `lotCards` to the `./lots.service` import. Add these schemas below `patchBody`:

```ts
const filterId = z.guid({ error: 'Choose a value from the list.' }).optional()
const listQuery = z.object({
  view: z.enum(['active', 'completed'], { error: 'Choose active or completed.' }).default('active'),
  q: z.string().max(100, { error: 'Keep the search to 100 characters or fewer.' }).default(''),
  segmentId: filterId,
  categoryId: filterId,
  emsId: filterId,
  pocId: filterId,
  statusId: filterId,
  stageId: filterId,
  logisticsId: filterId,
  blockerId: filterId,
  // ?flag=overdue&flag=rm arrives as an array, a single ?flag=overdue as a string.
  flag: z.preprocess(
    (v) => (v === undefined ? [] : [v].flat()),
    z.array(z.enum(lotFlagNames, { error: 'Choose a known quick filter.' })),
  ),
  sort: z.enum(lotSorts, { error: 'Choose a known sort.' }).default('eta-asc'),
})
const toFilters = ({ flag, ...rest }: z.output<typeof listQuery>): LotFilters => ({ ...rest, flags: flag })
```

Replace the comment `// List, summary and CSV routes (Task 6) go above /:id, …` with:

```ts
  router.get('/', requireSignedIn(), async (req, res) => {
    const { page, pageSize, ...query } = parseInput(listQuery.extend(pageQuery.shape), req.query)
    res.json(await listLots(deps, authOf(req).user, toFilters(query), { page, pageSize }))
  })

  router.get('/summary', requireSignedIn(), async (_req, res) => {
    res.json(await lotCards(deps))
  })

  router.get('/export.csv', requireSignedIn(), async (req, res) => {
    const filters = toFilters(parseInput(listQuery, req.query))
    const { filename, body } = await exportLotsCsv(deps, authOf(req).user, filters)
    res.type('text/csv; charset=utf-8').attachment(filename).send(body)
  })
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /lots signedIn',
        'GET /lots/summary signedIn',
        'GET /lots/export.csv signedIn',
```

- [ ] **Step 9: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 10: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add the lot list, summary cards and CSV export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: RM batches

FR-3.1 to FR-3.4. A batch belongs to a lot tracked by component, and only to a component selected on that lot. Adding or editing one needs per-lot access, so a POC can on their own lots. Deleting one needs `deleteEntries` (admins and planners). Each change locks the lot, so a batch can't slip in while a planner is unselecting its component (Task 5's guard).

**Files:**
- Create: `apps/api/src/core/fields.ts` (the quantity and text validators, moved out of `lots.router.ts`)
- Modify: `apps/api/src/modules/lots/lots.router.ts` (import them)
- Create: `apps/api/src/modules/rm-batches/rm-batches.service.ts`, `apps/api/src/modules/rm-batches/rm-batches.router.ts`
- Modify: `apps/api/src/api.ts`, `apps/api/src/api.test.ts`
- Test: `apps/api/test/rm-batches.int.test.ts`

**Interfaces:**
- Consumes: from Task 5, `lockLot`, `lockLotForEdit` and `RecordsDeps`; from Task 4, `batchInclude`, `batchView`, `LotRow` and `getLotDetail`; from Task 3, `recordActivity` and `actorOf`; from Task 2, `renameFields`; `validateBatch` from `@boat/domain/validation`.
- Produces:
  - `quantity(label: string)` and `text(max: number)` (zod schemas, in `core/fields.ts`)
  - `type BatchInput = { componentId; label; plannedQty; plannedDate: string | null; receivedQty; receivedDate: string | null; status; notes }`
  - `createBatch(deps, user, lotId, input)`, `updateBatch(deps, user, id, patch)` (both return the batch view), `deleteBatch(deps, user, id)`
  - `rmBatchRouters(deps)` → `{ underLots, batches }`, mounted at `/lots` and `/rm-batches`
  - Routes: `POST /lots/:id/rm-batches` (`lotAccess`) → 201; `PATCH /rm-batches/:id` (`lotAccess`); `DELETE /rm-batches/:id` (`deleteEntries`) → 204

- [ ] **Step 1: Move the shared validators**

Create `apps/api/src/core/fields.ts`:

```ts
import { z } from 'zod'

// Whole-number and sign rules come from the domain validators; this keeps values inside
// Postgres's integer range, so a huge number is a 422 rather than a 500.
export const quantity = (label: string) =>
  z
    .number({ error: `Enter the ${label} as a number.` })
    .max(1_000_000_000, { error: 'Enter 1,000,000,000 or less.' })

export const text = (max: number) =>
  z.string({ error: 'Enter text.' }).max(max, { error: `Keep this to ${max} characters or fewer.` })
```

In `apps/api/src/modules/lots/lots.router.ts`, delete the local `qty` and `text` helpers, add `import { quantity, text } from '../../core/fields'`, and replace each `qty(` with `quantity(`.

Run: `pnpm --filter @boat/api test:int -- test/lots.int.test.ts`
Expected: PASS (no behaviour change).

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/rm-batches.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, lotBody, makeRecordsWorld, type RecordsWorld, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
})
afterAll(() => close())

type Signed = RecordsWorld['planner']
// A lot tracked by PCB and Enclosure, owned by the world's POC unless told otherwise.
const componentLot = async (overrides: Record<string, unknown> = {}) =>
  (
    await w.planner.send(
      'post',
      '/api/v1/lots',
      lotBody(w, {
        rmMode: 'components',
        componentIds: [w.lookups.pcb.id, w.lookups.enclosure.id],
        pocId: w.lookups.pocA.id,
        ...overrides,
      }),
    )
  ).body as { id: string; version: number }
const addBatch = (user: Signed, lotId: string, body: Record<string, unknown>) =>
  user.send('post', `/api/v1/lots/${lotId}/rm-batches`, {
    componentId: w.lookups.pcb.id,
    label: 'B1',
    ...body,
  })
const detail = async (id: string) => (await w.admin.agent.get(`/api/v1/lots/${id}`)).body
const history = async (lotId: string) =>
  (await db.activityLog.findMany({ where: { entityId: lotId, kind: 'material' }, orderBy: { createdAt: 'asc' } })).map(
    (h) => h.message,
  )

describe('adding batches', () => {
  it('FR-3.2 records component, label, planned and received quantities and dates, status and notes', async () => {
    const lot = await componentLot()
    const res = await addBatch(w.planner, lot.id, {
      label: ' B1 ',
      plannedQty: 100,
      plannedDate: '2026-10-10',
      receivedQty: 70,
      receivedDate: '2026-10-12',
      status: 'Partial',
      notes: 'Short shipped',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      lotId: lot.id,
      component: { id: w.lookups.pcb.id, value: 'PCB' },
      label: 'B1',
      plannedQty: 100,
      plannedDate: '2026-10-10',
      receivedQty: 70,
      receivedDate: '2026-10-12',
      status: 'Partial',
      notes: 'Short shipped',
    })
    expect((await detail(lot.id)).rmBatches).toHaveLength(1)
    expect(await history(lot.id)).toEqual(['Added PCB batch B1 (70 received)'])
  })
  it('FR-3.2 refuses a received date in the future, and a blank label', async () => {
    const lot = await componentLot()
    // The test clock says 15 Oct 2026.
    const future = await addBatch(w.planner, lot.id, { receivedQty: 5, receivedDate: '2026-10-16' })
    expect(future.status).toBe(422)
    expect(future.body.fields).toEqual({ receivedDate: 'Received date cannot be in the future.' })
    const blank = await addBatch(w.planner, lot.id, { label: ' ' })
    expect(blank.body.fields).toEqual({ label: 'Enter a batch label.' })
    expect((await addBatch(w.planner, lot.id, { receivedDate: '2026-10-15' })).status).toBe(201)
  })
  it('FR-3.1 takes batches only on lots tracked by component', async () => {
    const lot = await componentLot({ rmMode: 'all', componentIds: [] })
    const res = await addBatch(w.planner, lot.id, {})
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ form: 'Switch the lot to Track by Component before adding batches.' })
  })
  it("FR-3.3 needs the batch's component to be selected on the lot", async () => {
    const lot = await componentLot({ componentIds: [w.lookups.enclosure.id] })
    const res = await addBatch(w.planner, lot.id, { componentId: w.lookups.pcb.id })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ componentId: 'Select this component on the lot first.' })
  })
  it('lets a POC add batches on their own lots only, and viewers never', async () => {
    const own = await componentLot()
    expect((await addBatch(w.poc, own.id, {})).status).toBe(201)
    const theirs = await componentLot({ pocId: w.lookups.pocB.id })
    const res = await addBatch(w.poc, theirs.id, {})
    expect(res.status).toBe(403)
    expect(res.body.message).toBe("POC profiles can't edit lots owned by Rohit Mehta. Ask an admin.")
    expect((await addBatch(w.viewer, own.id, {})).status).toBe(403)
  })
})

describe('RM readiness', () => {
  it('FR-3.4 producible is the smallest received total across components, capped at lot quantity', async () => {
    const lot = await componentLot({ lotQty: 100 })
    await addBatch(w.planner, lot.id, { componentId: w.lookups.pcb.id, receivedQty: 70 })
    await addBatch(w.planner, lot.id, { componentId: w.lookups.pcb.id, label: 'B2', receivedQty: 50 })
    await addBatch(w.planner, lot.id, { componentId: w.lookups.enclosure.id, receivedQty: 80 })
    expect((await detail(lot.id)).computed.rm).toEqual({
      producible: 80,
      bottleneck: 'Enclosure',
      percent: 80,
      complete: false,
    })
    await addBatch(w.planner, lot.id, { componentId: w.lookups.enclosure.id, label: 'B3', receivedQty: 40 })
    expect((await detail(lot.id)).computed.rm).toEqual({
      producible: 100,
      bottleneck: 'Enclosure',
      percent: 100,
      complete: true,
    })
  })
})

describe('editing and deleting batches', () => {
  it('edits a batch and records the change', async () => {
    const lot = await componentLot()
    const added = await addBatch(w.poc, lot.id, { receivedQty: 70 })
    const res = await w.poc.send('patch', `/api/v1/rm-batches/${added.body.id}`, { receivedQty: 90 })
    expect(res.status).toBe(200)
    expect(res.body.receivedQty).toBe(90)
    expect(await history(lot.id)).toEqual([
      'Added PCB batch B1 (70 received)',
      'Updated PCB batch B1 (90 received)',
    ])
  })
  it('FR-3.3 refuses moving a batch to a component the lot has not selected', async () => {
    const lot = await componentLot({ componentIds: [w.lookups.pcb.id] })
    const added = await addBatch(w.planner, lot.id, {})
    const res = await w.planner.send('patch', `/api/v1/rm-batches/${added.body.id}`, {
      componentId: w.lookups.enclosure.id,
    })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ componentId: 'Select this component on the lot first.' })
  })
  it('needs deleteEntries to delete, then leaves the batch out of the lot', async () => {
    const lot = await componentLot()
    const added = await addBatch(w.poc, lot.id, {})
    expect((await w.poc.send('delete', `/api/v1/rm-batches/${added.body.id}`)).status).toBe(403)
    expect((await w.planner.send('delete', `/api/v1/rm-batches/${added.body.id}`)).status).toBe(204)
    expect((await detail(lot.id)).rmBatches).toEqual([])
    expect(await history(lot.id)).toContain('Deleted PCB batch B1')
    expect((await w.planner.send('patch', `/api/v1/rm-batches/${added.body.id}`, { receivedQty: 1 })).status).toBe(404)
  })
  it('answers 404 for a lot or batch that is gone', async () => {
    const lot = await componentLot()
    await w.admin.send('delete', `/api/v1/lots/${lot.id}`)
    expect((await addBatch(w.planner, lot.id, {})).status).toBe(404)
    const missing = '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90'
    expect((await w.planner.send('patch', `/api/v1/rm-batches/${missing}`, { receivedQty: 1 })).status).toBe(404)
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/rm-batches.int.test.ts`
Expected: FAIL. `POST /api/v1/lots/:id/rm-batches` answers the JSON 404.

- [ ] **Step 4: Implement the service**

Create `apps/api/src/modules/rm-batches/rm-batches.service.ts`:

```ts
import type { RMBatch } from '@boat/domain/models'
import { assertValid, validateBatch, ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf, recordActivity } from '../../core/audit'
import type { RecordsDeps } from '../../core/clock'
import { fromDbDate, toDbDate } from '../../core/dates'
import { NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { renameFields } from '../lookups/resolve'
import { lockLot, lockLotForEdit } from '../lots/lot-lock'
import { batchInclude, batchView, type LotRow } from '../lots/lot-view'

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

// FR-3.1 to FR-3.3: batches belong to lots tracked by component, and only to a component
// selected on the lot. validateBatch refuses received dates after the company's today.
function checkBatch(lot: LotRow, input: BatchInput, date: string): RMBatch {
  if (lot.rmMode !== 'components')
    throw new ValidationError({ form: 'Switch the lot to Track by Component before adding batches.' })
  const component = lot.components.find((c) => c.component.id === input.componentId)?.component
  const batch: RMBatch = {
    id: '',
    createdAt: '',
    updatedAt: '',
    lotId: lot.id,
    component: component?.value ?? '',
    label: input.label.trim(),
    plannedQty: input.plannedQty,
    plannedDate: input.plannedDate ?? '',
    receivedQty: input.receivedQty,
    receivedDate: input.receivedDate ?? '',
    status: input.status.trim(),
    notes: input.notes.trim(),
  }
  assertValid({
    ...renameFields(validateBatch(batch, date), { component: 'componentId' }),
    ...(!component && { componentId: 'Select this component on the lot first.' }),
  })
  return batch
}

const batchData = (input: BatchInput, b: RMBatch) => ({
  componentId: input.componentId,
  label: b.label,
  plannedQty: b.plannedQty,
  plannedDate: toDbDate(input.plannedDate),
  receivedQty: b.receivedQty,
  receivedDate: toDbDate(input.receivedDate),
  status: b.status,
  notes: b.notes,
})

// The demo's history wording.
const material = (verb: string, b: RMBatch) =>
  `${verb} ${b.component} batch ${b.label} (${b.receivedQty} received)`

// The lot of an active batch on an active lot.
async function lotOfBatch(db: Db, id: string) {
  const batch = await db.rmBatch.findFirst({
    where: { id, deletedAt: null, lot: { is: { deletedAt: null } } },
    select: { lotId: true },
  })
  if (!batch) throw new NotFoundError()
  return batch.lotId
}

export async function createBatch(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  lotId: string,
  input: BatchInput,
) {
  const date = await clock.today()
  const row = await db.$transaction(async (tx) => {
    const lot = await lockLotForEdit(tx, user, lotId)
    const b = checkBatch(lot, input, date)
    const created = await tx.rmBatch.create({
      data: { lotId, ...batchData(input, b) },
      include: batchInclude,
    })
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'material',
      message: material('Added', b),
    })
    return created
  })
  return batchView(row)
}

export async function updateBatch(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  id: string,
  patch: Partial<BatchInput>,
) {
  const date = await clock.today()
  const lotId = await lotOfBatch(db, id)
  const row = await db.$transaction(async (tx) => {
    const lot = await lockLotForEdit(tx, user, lotId)
    const current = await tx.rmBatch.findFirst({ where: { id, deletedAt: null } })
    if (!current) throw new NotFoundError()
    const input: BatchInput = {
      componentId: current.componentId,
      label: current.label,
      plannedQty: current.plannedQty,
      plannedDate: fromDbDate(current.plannedDate),
      receivedQty: current.receivedQty,
      receivedDate: fromDbDate(current.receivedDate),
      status: current.status,
      notes: current.notes,
      ...patch,
    }
    const b = checkBatch(lot, input, date)
    const updated = await tx.rmBatch.update({
      where: { id },
      data: batchData(input, b),
      include: batchInclude,
    })
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'material',
      message: material('Updated', b),
    })
    return updated
  })
  return batchView(row)
}

export async function deleteBatch({ db }: RecordsDeps, user: SessionUser, id: string) {
  const lotId = await lotOfBatch(db, id)
  await db.$transaction(async (tx) => {
    await lockLot(tx, lotId)
    const current = await tx.rmBatch.findFirst({ where: { id, deletedAt: null }, include: batchInclude })
    if (!current) throw new NotFoundError()
    await tx.rmBatch.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id } })
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'material',
      message: `Deleted ${current.component.value} batch ${current.label}`,
    })
  })
}
```

- [ ] **Step 5: Implement the routers and mount them**

Create `apps/api/src/modules/rm-batches/rm-batches.router.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requireLotAccess, requirePermission } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { optionalDate } from '../../core/dates'
import { quantity, text } from '../../core/fields'
import { parseId, parseInput } from '../../core/parse'
import { createBatch, deleteBatch, updateBatch } from './rm-batches.service'

const fields = {
  componentId: z.guid({ error: 'Choose a component.' }),
  label: z
    .string({ error: 'Enter a batch label.' })
    .max(60, { error: 'Keep the label to 60 characters or fewer.' }),
  plannedQty: quantity('planned quantity'),
  plannedDate: optionalDate,
  receivedQty: quantity('received quantity'),
  receivedDate: optionalDate,
  status: text(60),
  notes: text(1000),
}
const createBody = z.strictObject({
  ...fields,
  plannedQty: fields.plannedQty.default(0),
  plannedDate: fields.plannedDate.default(null),
  receivedQty: fields.receivedQty.default(0),
  receivedDate: fields.receivedDate.default(null),
  status: fields.status.default(''),
  notes: fields.notes.default(''),
})
const patchBody = z.strictObject(fields).partial()

// Two routers: one adds batches under /lots/:id, the other edits and deletes them by id.
export function rmBatchRouters(deps: RecordsDeps) {
  const underLots = Router()
  underLots.post('/:id/rm-batches', requireLotAccess(), async (req, res) => {
    const input = parseInput(createBody, req.body)
    res.status(201).json(await createBatch(deps, authOf(req).user, parseId(req.params.id), input))
  })

  const batches = Router()
  batches.patch('/:id', requireLotAccess(), async (req, res) => {
    const patch = parseInput(patchBody, req.body)
    res.json(await updateBatch(deps, authOf(req).user, parseId(req.params.id), patch))
  })
  batches.delete('/:id', requirePermission('deleteEntries'), async (req, res) => {
    await deleteBatch(deps, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return { underLots, batches }
}
```

In `apps/api/src/api.ts`, import `rmBatchRouters` from `./modules/rm-batches/rm-batches.router` and mount both routers after `/lots`:

```ts
  const batches = rmBatchRouters(records)
  mount(api, '/lots', batches.underLots)
  mount(api, '/rm-batches', batches.batches)
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'POST /lots/:id/rm-batches lotAccess',
        'PATCH /rm-batches/:id lotAccess',
        'DELETE /rm-batches/:id deleteEntries',
```

- [ ] **Step 6: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 7: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add RM batches with component and access checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: GRN receipts and completion

FR-4.1 to FR-4.4. Each change locks the lot, re-sums its active receipts, checks the new total against the lot quantity, writes, then refreshes `grn_total` and `completed_on`. The lock is what makes the over-receipt guard hold when two people post receipts at the same moment. The `CHECK (grn_total <= lot_qty)` constraint is the backstop.

**Files:**
- Create: `apps/api/src/modules/grn-receipts/grn-receipts.service.ts`, `apps/api/src/modules/grn-receipts/grn-receipts.router.ts`
- Modify: `apps/api/src/api.ts`, `apps/api/src/api.test.ts`
- Test: `apps/api/test/grn-receipts.int.test.ts`

**Interfaces:**
- Consumes: from Task 5, `lockLot`, `lockLotForEdit`, `refreshCompletion` and `RecordsDeps`; from Task 4, `receiptView`; from Task 7, `quantity` and `text`; from Task 3, `recordActivity` and `actorOf`; `validateReceipt` from `@boat/domain/validation`.
- Produces:
  - `type ReceiptInput = { label: string; date: string; quantity: number; note: string }`
  - `createReceipt(deps, user, lotId, input)`, `updateReceipt(deps, user, id, patch)` (both return the receipt view), `deleteReceipt(deps, user, id)`
  - `grnReceiptRouters(deps)` → `{ underLots, receipts }`, mounted at `/lots` and `/grn-receipts`
  - Routes: `POST /lots/:id/grn-receipts` (`lotAccess`) → 201; `PATCH /grn-receipts/:id` (`lotAccess`); `DELETE /grn-receipts/:id` (`deleteEntries`) → 204

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/grn-receipts.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, lotBody, makeRecordsWorld, type RecordsWorld, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
})
afterAll(() => close())

type Signed = RecordsWorld['planner']
const newLot = async (overrides: Record<string, unknown> = {}) =>
  (await w.planner.send('post', '/api/v1/lots', lotBody(w, { pocId: w.lookups.pocA.id, ...overrides })))
    .body as { id: string; version: number }
const receive = (user: Signed, lotId: string, quantity: number, date = '2026-10-10', label = 'GRN 1') =>
  user.send('post', `/api/v1/lots/${lotId}/grn-receipts`, { label, date, quantity })
const detail = async (id: string) => (await w.admin.agent.get(`/api/v1/lots/${id}`)).body

describe('posting receipts', () => {
  it('FR-4.1 takes any number of partial receipts with label, date, quantity and note', async () => {
    const lot = await newLot({ lotQty: 100 })
    const first = await w.planner.send('post', `/api/v1/lots/${lot.id}/grn-receipts`, {
      label: ' GRN 1 ',
      date: '2026-10-05',
      quantity: 30,
      note: 'First truck ',
    })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({
      lotId: lot.id,
      label: 'GRN 1',
      date: '2026-10-05',
      quantity: 30,
      note: 'First truck',
      createdBy: w.planner.me.user.id,
    })
    await receive(w.planner, lot.id, 20, '2026-10-06', 'GRN 2')
    const after = await detail(lot.id)
    expect(after.grnReceipts.map((r: { label: string }) => r.label)).toEqual(['GRN 1', 'GRN 2'])
    expect(after.computed).toMatchObject({ grnTotal: 50, balance: 50, grnPercent: 50, completed: false })
  })
  it('FR-4.1 refuses a future date and a quantity of zero or less', async () => {
    const lot = await newLot()
    // The test clock says 15 Oct 2026.
    const future = await receive(w.planner, lot.id, 10, '2026-10-16')
    expect(future.status).toBe(422)
    expect(future.body.fields).toEqual({ date: 'Receipt date cannot be in the future.' })
    const zero = await receive(w.planner, lot.id, 0)
    expect(zero.body.fields).toEqual({ quantity: 'Quantity must be greater than zero.' })
  })
  it('FR-4.2 never lets total GRN exceed the lot quantity', async () => {
    const lot = await newLot({ lotQty: 100 })
    await receive(w.planner, lot.id, 60)
    const over = await receive(w.planner, lot.id, 41, '2026-10-11', 'GRN 2')
    expect(over.status).toBe(422)
    expect(over.body.fields).toEqual({ quantity: 'Only 40 units are left to receive on this lot.' })
    expect((await detail(lot.id)).computed.balance).toBe(40)
  })
  it('FR-4.2 holds when two receipts arrive at the same moment', async () => {
    const lot = await newLot({ lotQty: 100 })
    const results = await Promise.all([
      receive(w.planner, lot.id, 60, '2026-10-10', 'A'),
      receive(w.poc, lot.id, 60, '2026-10-10', 'B'),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 422])
    const row = await db.lot.findUniqueOrThrow({ where: { id: lot.id } })
    expect(row.grnTotal).toBe(60)
  })
})

describe('completion', () => {
  it('FR-4.3 completes the lot at full GRN and reverses when a receipt is edited or deleted', async () => {
    const lot = await newLot({ lotQty: 100 })
    await receive(w.planner, lot.id, 40, '2026-10-05', 'GRN 1')
    const last = await receive(w.planner, lot.id, 60, '2026-10-12', 'GRN 2')
    expect(await detail(lot.id)).toMatchObject({ completedOn: '2026-10-12', computed: { completed: true } })
    const completed = await w.viewer.agent.get('/api/v1/lots?view=completed&pageSize=200')
    expect(completed.body.items.map((i: { id: string }) => i.id)).toContain(lot.id)

    await w.planner.send('patch', `/api/v1/grn-receipts/${last.body.id}`, { quantity: 50 })
    expect(await detail(lot.id)).toMatchObject({ completedOn: null, computed: { completed: false } })
    await w.planner.send('patch', `/api/v1/grn-receipts/${last.body.id}`, { quantity: 60 })
    expect((await detail(lot.id)).completedOn).toBe('2026-10-12')
    await w.planner.send('delete', `/api/v1/grn-receipts/${last.body.id}`)
    expect(await detail(lot.id)).toMatchObject({ completedOn: null, computed: { grnTotal: 40 } })
  })
  it('FR-4.3 reverses completion when the lot quantity is raised', async () => {
    const lot = await newLot({ lotQty: 50 })
    await receive(w.planner, lot.id, 50)
    expect((await detail(lot.id)).completedOn).toBe('2026-10-10')
    const res = await w.planner.send('patch', `/api/v1/lots/${lot.id}`, { lotQty: 80, version: 1 })
    expect(res.body).toMatchObject({ completedOn: null, computed: { completed: false, balance: 30 } })
  })
  it('FR-4.4 shows the full-GRN date, days against plan and RM-to-GRN lead time', async () => {
    const lot = await newLot({ lotQty: 100, plannedDate: '2026-10-10', rmReadyDate: '2026-10-01' })
    await receive(w.planner, lot.id, 100, '2026-10-12')
    expect((await detail(lot.id)).computed).toMatchObject({
      fullGrnDate: '2026-10-12',
      planDelay: 2,
      leadTime: 11,
    })
  })
})

describe('who may post and delete', () => {
  it('lets a POC post on their own lots only', async () => {
    const own = await newLot()
    expect((await receive(w.poc, own.id, 10)).status).toBe(201)
    const theirs = await newLot({ pocId: w.lookups.pocB.id })
    expect((await receive(w.poc, theirs.id, 10)).status).toBe(403)
    expect((await receive(w.viewer, own.id, 10)).status).toBe(403)
  })
  it('needs deleteEntries to delete a receipt, and records each change', async () => {
    const lot = await newLot()
    const posted = await receive(w.poc, lot.id, 10)
    await w.poc.send('patch', `/api/v1/grn-receipts/${posted.body.id}`, { quantity: 15 })
    expect((await w.poc.send('delete', `/api/v1/grn-receipts/${posted.body.id}`)).status).toBe(403)
    expect((await w.planner.send('delete', `/api/v1/grn-receipts/${posted.body.id}`)).status).toBe(204)
    const history = await db.activityLog.findMany({
      where: { entityId: lot.id, kind: 'receipt' },
      orderBy: { createdAt: 'asc' },
    })
    expect(history.map((h) => [h.message, h.actorName])).toEqual([
      ['Added receipt GRN 1: 10 units', 'Test poc'],
      ['Updated receipt GRN 1: 10 → 15 units', 'Test poc'],
      ['Deleted receipt GRN 1 (15 units)', 'Test planner'],
    ])
  })
  it('answers 404 for a receipt on a deleted lot', async () => {
    const lot = await newLot()
    const posted = await receive(w.planner, lot.id, 10)
    await w.admin.send('delete', `/api/v1/lots/${lot.id}`)
    expect((await w.planner.send('patch', `/api/v1/grn-receipts/${posted.body.id}`, { quantity: 5 })).status).toBe(404)
    expect((await receive(w.planner, lot.id, 5)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/grn-receipts.int.test.ts`
Expected: FAIL. `POST /api/v1/lots/:id/grn-receipts` answers the JSON 404.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/modules/grn-receipts/grn-receipts.service.ts`:

```ts
import type { GRNReceipt } from '@boat/domain/models'
import { assertValid, validateReceipt } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf, recordActivity } from '../../core/audit'
import type { RecordsDeps } from '../../core/clock'
import { fromDbDate, toDbDate } from '../../core/dates'
import { NotFoundError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import { lockLot, lockLotForEdit, refreshCompletion } from '../lots/lot-lock'
import { receiptView } from '../lots/lot-view'

export type ReceiptInput = { label: string; date: string; quantity: number; note: string }

// FR-4.2: units still to receive, from the lot's active receipts other than the one being edited.
// Called with the lot row locked, so no other receipt can land between this sum and the write.
async function available(db: Db, lot: { id: string; lotQty: number }, excluding?: string) {
  const { _sum } = await db.grnReceipt.aggregate({
    where: { lotId: lot.id, deletedAt: null, ...(excluding && { id: { not: excluding } }) },
    _sum: { quantity: true },
  })
  return lot.lotQty - (_sum.quantity ?? 0)
}

// FR-4.1 and FR-4.2 through the shared validateReceipt, with the company's today.
function checkReceipt(lotId: string, input: ReceiptInput, left: number, date: string): GRNReceipt {
  const receipt: GRNReceipt = {
    id: '',
    createdAt: '',
    updatedAt: '',
    lotId,
    label: input.label.trim(),
    date: input.date,
    quantity: input.quantity,
    note: input.note.trim(),
  }
  assertValid(validateReceipt(receipt, left, date))
  return receipt
}

async function lotOfReceipt(db: Db, id: string) {
  const receipt = await db.grnReceipt.findFirst({
    where: { id, deletedAt: null, lot: { is: { deletedAt: null } } },
    select: { lotId: true },
  })
  if (!receipt) throw new NotFoundError()
  return receipt.lotId
}

export async function createReceipt(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  lotId: string,
  input: ReceiptInput,
) {
  const date = await clock.today()
  const row = await db.$transaction(async (tx) => {
    const lot = await lockLotForEdit(tx, user, lotId)
    const r = checkReceipt(lotId, input, await available(tx, lot), date)
    const created = await tx.grnReceipt.create({
      data: { lotId, label: r.label, date: toDbDate(r.date)!, quantity: r.quantity, note: r.note, createdBy: user.id },
    })
    await refreshCompletion(tx, lotId)
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'receipt',
      message: `Added receipt ${r.label}: ${r.quantity} units`,
    })
    return created
  })
  return receiptView(row)
}

export async function updateReceipt(
  { db, clock }: RecordsDeps,
  user: SessionUser,
  id: string,
  patch: Partial<ReceiptInput>,
) {
  const date = await clock.today()
  const lotId = await lotOfReceipt(db, id)
  const row = await db.$transaction(async (tx) => {
    const lot = await lockLotForEdit(tx, user, lotId)
    const current = await tx.grnReceipt.findFirst({ where: { id, deletedAt: null } })
    if (!current) throw new NotFoundError()
    const input: ReceiptInput = {
      label: current.label,
      date: fromDbDate(current.date)!,
      quantity: current.quantity,
      note: current.note,
      ...patch,
    }
    const r = checkReceipt(lotId, input, await available(tx, lot, id), date)
    const updated = await tx.grnReceipt.update({
      where: { id },
      data: { label: r.label, date: toDbDate(r.date)!, quantity: r.quantity, note: r.note },
    })
    await refreshCompletion(tx, lotId)
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'receipt',
      message: `Updated receipt ${r.label}: ${current.quantity} → ${r.quantity} units`,
    })
    return updated
  })
  return receiptView(row)
}

export async function deleteReceipt({ db }: RecordsDeps, user: SessionUser, id: string) {
  const lotId = await lotOfReceipt(db, id)
  await db.$transaction(async (tx) => {
    await lockLot(tx, lotId)
    const current = await tx.grnReceipt.findFirst({ where: { id, deletedAt: null } })
    if (!current) throw new NotFoundError()
    await tx.grnReceipt.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id } })
    await refreshCompletion(tx, lotId)
    await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'receipt',
      message: `Deleted receipt ${current.label} (${current.quantity} units)`,
    })
  })
}
```

- [ ] **Step 4: Implement the routers and mount them**

Create `apps/api/src/modules/grn-receipts/grn-receipts.router.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requireLotAccess, requirePermission } from '../../core/access'
import type { RecordsDeps } from '../../core/clock'
import { isoDate } from '../../core/dates'
import { quantity, text } from '../../core/fields'
import { parseId, parseInput } from '../../core/parse'
import { createReceipt, deleteReceipt, updateReceipt } from './grn-receipts.service'

const fields = {
  label: z
    .string({ error: 'Enter a receipt label.' })
    .max(60, { error: 'Keep the label to 60 characters or fewer.' }),
  date: isoDate,
  quantity: quantity('quantity'),
  note: text(1000),
}
const createBody = z.strictObject({ ...fields, note: fields.note.default('') })
const patchBody = z.strictObject(fields).partial()

// Two routers: one posts receipts under /lots/:id, the other edits and deletes them by id.
export function grnReceiptRouters(deps: RecordsDeps) {
  const underLots = Router()
  underLots.post('/:id/grn-receipts', requireLotAccess(), async (req, res) => {
    const input = parseInput(createBody, req.body)
    res.status(201).json(await createReceipt(deps, authOf(req).user, parseId(req.params.id), input))
  })

  const receipts = Router()
  receipts.patch('/:id', requireLotAccess(), async (req, res) => {
    const patch = parseInput(patchBody, req.body)
    res.json(await updateReceipt(deps, authOf(req).user, parseId(req.params.id), patch))
  })
  receipts.delete('/:id', requirePermission('deleteEntries'), async (req, res) => {
    await deleteReceipt(deps, authOf(req).user, parseId(req.params.id))
    res.status(204).end()
  })

  return { underLots, receipts }
}
```

In `apps/api/src/api.ts`, import `grnReceiptRouters` from `./modules/grn-receipts/grn-receipts.router` and mount both after the batch routers:

```ts
  const receipts = grnReceiptRouters(records)
  mount(api, '/lots', receipts.underLots)
  mount(api, '/grn-receipts', receipts.receipts)
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'POST /lots/:id/grn-receipts lotAccess',
        'PATCH /grn-receipts/:id lotAccess',
        'DELETE /grn-receipts/:id deleteEntries',
```

- [ ] **Step 5: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS. Run the concurrent test a few times to make sure it is stable: `for i in 1 2 3 4 5; do pnpm --filter @boat/api test:int -- test/grn-receipts.int.test.ts -t "same moment"; done`

- [ ] **Step 6: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add GRN receipts with the over-receipt guard and completion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Lot history and notes

FR-7.1 and FR-7.2. Earlier tasks already write the history entries; this task serves them and adds notes. The FR-7.1 test walks one lot through every kind of change and checks the history names each user.

**Files:**
- Create: `apps/api/src/modules/activity/activity.service.ts`, `apps/api/src/modules/activity/activity.router.ts`
- Modify: `apps/api/src/api.ts`, `apps/api/src/api.test.ts`
- Test: `apps/api/test/activity.int.test.ts`

**Interfaces:**
- Consumes: from Task 5, `lockLotForEdit`; from Task 3, `recordActivity` and `actorOf`; from Phase 2, `pageQuery`, `pageArgs`, `pageOf`, `NotFoundError` and `ValidationError`.
- Produces:
  - `lotActivity(db, lotId, page)` → `{ items: { id, kind, message, changes, actorId, actorName, createdAt }[], total, page, pageSize }`, newest first (404 for a missing or deleted lot)
  - `addLotNote(db, user, lotId, message)` → the new entry
  - `activityRouter(db)`, mounted at `/lots`
  - Routes: `GET /lots/:id/activity` (signedIn); `POST /lots/:id/notes` (`lotAccess`) → 201

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/activity.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, lotBody, makeRecordsWorld, type RecordsWorld, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
})
afterAll(() => close())

const newLot = async (overrides: Record<string, unknown> = {}) =>
  (
    await w.planner.send(
      'post',
      '/api/v1/lots',
      lotBody(w, {
        label: 'Lot 1',
        pocId: w.lookups.pocA.id,
        rmMode: 'components',
        componentIds: [w.lookups.pcb.id],
        ...overrides,
      }),
    )
  ).body as { id: string; version: number }
const activity = async (lotId: string, query = '') =>
  (await w.viewer.agent.get(`/api/v1/lots/${lotId}/activity${query}`)).body

describe('history', () => {
  it('FR-7.1 records every create, field change, batch, receipt and note with the user', async () => {
    const lot = await newLot()
    await w.planner.send('patch', `/api/v1/lots/${lot.id}`, { plannedDate: '2026-10-20', version: 1 })
    const batch = await w.poc.send('post', `/api/v1/lots/${lot.id}/rm-batches`, {
      componentId: w.lookups.pcb.id,
      label: 'B1',
      receivedQty: 40,
    })
    await w.poc.send('post', `/api/v1/lots/${lot.id}/grn-receipts`, {
      label: 'GRN 1',
      date: '2026-10-12',
      quantity: 25,
    })
    await w.planner.send('delete', `/api/v1/rm-batches/${batch.body.id}`)
    await w.poc.send('post', `/api/v1/lots/${lot.id}/notes`, { message: 'Supplier confirmed Friday' })

    const res = await activity(lot.id)
    expect(res.total).toBe(6)
    expect(res.items.map((e: { kind: string; message: string; actorName: string }) => [e.kind, e.message, e.actorName])).toEqual([
      ['note', 'Supplier confirmed Friday', 'Test poc'],
      ['material', 'Deleted PCB batch B1', 'Test planner'],
      ['receipt', 'Added receipt GRN 1: 25 units', 'Test poc'],
      ['material', 'Added PCB batch B1 (40 received)', 'Test poc'],
      ['updated', 'Updated planned date', 'Test planner'],
      ['created', 'Lot Lot 1 created', 'Test planner'],
    ])
  })
  it('FR-7.1 records a delete, and the deleted lot then reads as 404', async () => {
    const lot = await newLot({ label: 'Lot 2' })
    await w.admin.send('delete', `/api/v1/lots/${lot.id}`)
    const entries = await db.activityLog.findMany({ where: { entityId: lot.id, kind: 'deleted' } })
    expect(entries.map((e) => [e.message, e.actorName])).toEqual([['Lot Lot 2 deleted', 'Test admin']])
    expect((await w.viewer.agent.get(`/api/v1/lots/${lot.id}/activity`)).status).toBe(404)
  })
  it('FR-7.1 keeps history out of reach of edits and deletes, even for the app role', async () => {
    const lot = await newLot({ label: 'Lot 3' })
    await expect(
      db.$executeRaw`UPDATE activity_logs SET message = 'changed' WHERE entity_id = ${lot.id}::uuid`,
    ).rejects.toThrow()
    await expect(db.$executeRaw`DELETE FROM activity_logs WHERE entity_id = ${lot.id}::uuid`).rejects.toThrow()
  })
  it('keeps the name a user had at the time on their entries', async () => {
    const lot = await newLot({ label: 'Lot 4' })
    await db.user.update({ where: { id: w.planner.me.user.id }, data: { name: 'Renamed Later' } })
    const [created] = (await activity(lot.id)).items
    expect(created.actorName).toBe('Test planner')
    await db.user.update({ where: { id: w.planner.me.user.id }, data: { name: 'Test planner' } })
  })
  it('pages newest first', async () => {
    const lot = await newLot({ label: 'Lot 5' })
    for (const message of ['one', 'two', 'three'])
      await w.planner.send('post', `/api/v1/lots/${lot.id}/notes`, { message })
    const page = await activity(lot.id, '?pageSize=2&page=1')
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 2 })
    expect(page.items.map((e: { message: string }) => e.message)).toEqual(['three', 'two'])
  })
})

describe('notes', () => {
  it('FR-7.2 lets users with edit rights add a note', async () => {
    const own = await newLot({ label: 'Lot 6' })
    const res = await w.poc.send('post', `/api/v1/lots/${own.id}/notes`, { message: '  Called the factory ' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'note', message: 'Called the factory', actorName: 'Test poc' })
  })
  it('FR-7.2 refuses viewers, POCs on other lots, and empty or very long notes', async () => {
    const theirs = await newLot({ label: 'Lot 7', pocId: w.lookups.pocB.id })
    expect((await w.poc.send('post', `/api/v1/lots/${theirs.id}/notes`, { message: 'x' })).status).toBe(403)
    expect((await w.viewer.send('post', `/api/v1/lots/${theirs.id}/notes`, { message: 'x' })).status).toBe(403)
    const blank = await w.planner.send('post', `/api/v1/lots/${theirs.id}/notes`, { message: '   ' })
    expect(blank.status).toBe(422)
    expect(blank.body.fields).toEqual({ message: 'Write a note first.' })
    const long = await w.planner.send('post', `/api/v1/lots/${theirs.id}/notes`, { message: 'x'.repeat(2001) })
    expect(long.status).toBe(422)
  })
})
```

The name test renames the user rather than deleting them, because later tests still sign in as the world's planner. A rename shows the snapshot just as well.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/activity.int.test.ts`
Expected: FAIL. `GET /api/v1/lots/:id/activity` and `POST /api/v1/lots/:id/notes` answer the JSON 404.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/modules/activity/activity.service.ts`:

```ts
import { ValidationError } from '@boat/domain/validation'
import type { SessionUser } from '../../core/access'
import { actorOf, recordActivity } from '../../core/audit'
import { NotFoundError } from '../../core/errors'
import { type Page, pageArgs, pageOf } from '../../core/pagination'
import type { PrismaClient } from '../../generated/prisma/client'
import { lockLotForEdit } from '../lots/lot-lock'

const entrySelect = {
  id: true,
  kind: true,
  message: true,
  changes: true,
  actorId: true,
  actorName: true,
  createdAt: true,
} as const

export async function lotActivity(db: PrismaClient, lotId: string, page: Page) {
  const lot = await db.lot.findFirst({ where: { id: lotId, deletedAt: null }, select: { id: true } })
  if (!lot) throw new NotFoundError()
  const where = { entityType: 'lot' as const, entityId: lotId }
  const [items, total] = await Promise.all([
    db.activityLog.findMany({
      where,
      select: entrySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(page),
    }),
    db.activityLog.count({ where }),
  ])
  return pageOf(items, total, page)
}

// FR-7.2: users who can edit the lot (full or progress access) may add a note.
export async function addLotNote(db: PrismaClient, user: SessionUser, lotId: string, message: string) {
  const text = message.trim()
  if (!text) throw new ValidationError({ message: 'Write a note first.' })
  return db.$transaction(async (tx) => {
    await lockLotForEdit(tx, user, lotId)
    const entry = await recordActivity(tx, actorOf(user), {
      entityType: 'lot',
      entityId: lotId,
      kind: 'note',
      message: text,
    })
    return {
      id: entry.id,
      kind: entry.kind,
      message: entry.message,
      changes: entry.changes,
      actorId: entry.actorId,
      actorName: entry.actorName,
      createdAt: entry.createdAt,
    }
  })
}
```

- [ ] **Step 4: Implement the router and mount it**

Create `apps/api/src/modules/activity/activity.router.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requireLotAccess, requireSignedIn } from '../../core/access'
import { pageQuery } from '../../core/pagination'
import { parseId, parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import { addLotNote, lotActivity } from './activity.service'

const noteBody = z.strictObject({
  message: z
    .string({ error: 'Write a note first.' })
    .max(2000, { error: 'Keep the note to 2,000 characters or fewer.' }),
})

export function activityRouter(db: PrismaClient) {
  const router = Router()

  router.get('/:id/activity', requireSignedIn(), async (req, res) => {
    res.json(await lotActivity(db, parseId(req.params.id), parseInput(pageQuery, req.query)))
  })

  router.post('/:id/notes', requireLotAccess(), async (req, res) => {
    const { message } = parseInput(noteBody, req.body)
    res.status(201).json(await addLotNote(db, authOf(req).user, parseId(req.params.id), message))
  })

  return router
}
```

In `apps/api/src/api.ts`, import `activityRouter` from `./modules/activity/activity.router` and mount it after the receipt routers:

```ts
  mount(api, '/lots', activityRouter(deps.db))
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /lots/:id/activity signedIn',
        'POST /lots/:id/notes lotAccess',
```

- [ ] **Step 5: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 6: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add lot history and notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The FR coverage check, the 20,000-lot measurement, docs and finishing

This task makes the Phase 3 gate checkable by a machine. It measures the PRD's performance target once, and updates the docs.

**Files:**
- Create: `apps/api/src/fr-coverage.test.ts`
- Create: `apps/api/test/perf.int.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: every integration test file in `apps/api/test/`; `makeRecordsWorld` and `testApp` from the fixtures.
- Produces: a unit test that fails when an FR id in FR-1 to FR-4, FR-7 or FR-8 has no integration test titled with it.

- [ ] **Step 1: Write the coverage test**

Create `apps/api/src/fr-coverage.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Phase 3 gate: every rule in FR-1 to FR-4, FR-7 and FR-8 has an integration test whose title
// carries its id. Phase 4 adds FR-5, FR-6 and FR-9 to this list.
const required = [
  'FR-1.1',
  'FR-1.2',
  'FR-2.1',
  'FR-2.2',
  'FR-2.3',
  'FR-2.4',
  'FR-2.5',
  'FR-2.6',
  'FR-2.7',
  'FR-3.1',
  'FR-3.2',
  'FR-3.3',
  'FR-3.4',
  'FR-4.1',
  'FR-4.2',
  'FR-4.3',
  'FR-4.4',
  'FR-7.1',
  'FR-7.2',
  'FR-8.1',
  'FR-8.2',
  'FR-8.3',
]

const testDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test')

function testTitles() {
  return readdirSync(testDir)
    .filter((file) => file.endsWith('.int.test.ts'))
    .flatMap((file) => {
      const source = readFileSync(path.join(testDir, file), 'utf8')
      return [...source.matchAll(/\bit\(\s*(['"`])(.+?)\1/g)].map((m) => m[2])
    })
}

describe('functional requirements', () => {
  it('each have an integration test titled with their id', () => {
    const covered = new Set(testTitles().flatMap((title) => title.match(/FR-\d+\.\d+/g) ?? []))
    expect(required.filter((id) => !covered.has(id))).toEqual([])
  })
})
```

- [ ] **Step 2: Check that it can fail**

Temporarily rename `it('FR-2.6 counts active lots …'` in `apps/api/test/lots-list.int.test.ts` to `it('counts active lots …'`.

Run: `pnpm --filter @boat/api test -- src/fr-coverage.test.ts`
Expected: FAIL, listing `['FR-2.6']`.

Put the title back. Run the same command.
Expected: PASS.

- [ ] **Step 3: Write the 20,000-lot measurement**

Create `apps/api/test/perf.int.test.ts`:

```ts
import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { fixedNow, makeRecordsWorld, type RecordsWorld, testApp } from './support/fixtures'

// PRD: list and summary endpoints answer in under 300 ms at p95 for 20,000 lots. Setting up
// 20,000 lots is slow, so this runs only on request:
//   PERF=1 pnpm --filter @boat/api test:int -- test/perf.int.test.ts
describe.runIf(process.env.PERF === '1')('20,000 lots', () => {
  let db: PrismaClient
  let close: () => Promise<void>
  let w: RecordsWorld

  beforeAll(async () => {
    ;({ db, close } = await createTestDatabase())
    w = await makeRecordsWorld(db, testApp(db, { now: fixedNow }))
    const L = w.lookups
    await db.$executeRaw`
      INSERT INTO lots (id, product_id, label, category_id, status_id, stage_id, blocker_id,
                        lot_qty, planned_date, follow_up_date, updated_at)
      SELECT gen_random_uuid(), ${w.product.id}::uuid, 'Lot ' || g, ${L.bau.id}::uuid,
             CASE WHEN g % 5 = 0 THEN ${L.delayed.id}::uuid ELSE ${L.onTrack.id}::uuid END,
             ${L.stage.id}::uuid,
             CASE WHEN g % 11 = 0 THEN ${L.rmBlocker.id}::uuid END,
             100, DATE '2026-09-01' + (g % 90),
             CASE WHEN g % 7 = 0 THEN DATE '2026-10-01' + (g % 30) END, now()
      FROM generate_series(1, 20000) g`
  }, 300_000)
  afterAll(() => close())

  const p95 = async (url: string) => {
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      const res = await w.viewer.agent.get(url)
      times.push(performance.now() - start)
      expect(res.status).toBe(200)
    }
    return times.sort((a, b) => a - b)[18]
  }

  it.each([
    '/api/v1/lots?pageSize=50',
    '/api/v1/lots?flag=overdue&pageSize=50',
    '/api/v1/lots?q=Lot%201999&sort=balance-desc',
    '/api/v1/lots/summary',
  ])('answers %s within 300 ms at p95', async (url) => {
    const ms = await p95(url)
    console.log(`${url}: p95 ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(300)
  })
})
```

- [ ] **Step 4: Run it once and record the numbers**

Run: `PERF=1 pnpm --filter @boat/api test:int -- test/perf.int.test.ts`
Expected: PASS, printing four p95 timings under 300 ms. Note the timings for the pull request. If one fails, note the query and its `EXPLAIN ANALYZE` instead of changing the test. The roadmap's departure 2 depends on this result.

Then run `pnpm --filter @boat/api test:int` without `PERF` and check the four cases show as skipped.

- [ ] **Step 5: Update AGENTS.md**

In `AGENTS.md`, append to the `apps/api` paragraph of "Project Structure & Module Organization":

```markdown
Record modules (`lookups`, `products`, `lots`, `rm-batches`, `grn-receipts`, `activity`) lock the lot row before any change to a lot or its entries (`modules/lots/lot-lock.ts`), resolve dropdown ids with `resolveLookups`, run the shared `@boat/domain` validators, and write history with `recordActivity` in the same transaction. Lot reads map rows to the domain's shapes in `modules/lots/lot-view.ts`, so computed fields come from the same functions as the browser. An integration test that pins a functional requirement starts its title with the id (`FR-4.2 …`); `src/fr-coverage.test.ts` checks every one is covered.
```

- [ ] **Step 6: Run the full verification**

```bash
pnpm format:check && pnpm typecheck && pnpm test \
  && pnpm --filter @boat/domain test:coverage \
  && pnpm --filter @boat/api test:int && pnpm build
```

Expected: everything passes. `git diff dev --stat -- apps/web` is empty.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Check FR coverage, measure 20,000 lots and document the record modules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then finish the branch as agreed (merge into `dev` locally, or push `phase-3-core-records` and open a pull request into `dev`). Include the p95 timings from Step 4.

---

## Phase 3 gate

- [ ] `src/fr-coverage.test.ts` passes: every FR-1 to FR-4, FR-7 and FR-8 rule has a passing integration test.
- [ ] The full verification in Task 10, Step 6 passes.
- [ ] `api.test.ts` shows every route with an access check, and the permission table matches.
- [ ] The 20,000-lot measurement is recorded.
- [ ] `apps/web` is unchanged.
