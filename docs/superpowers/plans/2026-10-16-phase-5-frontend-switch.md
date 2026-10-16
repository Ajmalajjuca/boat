# Phase 5: Frontend Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web app reads and writes through the API instead of IndexedDB, so every user works on one shared dataset. Email-and-password sign-in replaces the PIN profiles, and a Playwright suite covering every flow in AGENTS.md passes against the real API, on desktop Chromium and a 390 px viewport, locally and in CI.

**Architecture:** A thin `fetch` client (`apps/web/src/api/client.ts`) sends the CSRF token, maps error replies to typed errors, and returns to sign-in on a 401. TanStack Query hooks (`api/queries.ts`) read each screen's endpoint, and writes are plain functions (`api/*.ts`) run through the app's existing `run()`, which refreshes the affected queries afterwards. Screens keep working on the domain's shapes (`Lot`, `RMBatch`, `Shipment`…, dropdowns as text, empty dates as `''`), so the domain's calculations and validators still apply in the browser. Only `api/mappers.ts` knows the API's shapes (ids, `{ id, value }`, `null` dates). Response types live in `@boat/domain/api`, and `apps/api/src/contract.ts` checks at compile time that the server's views produce exactly those shapes. A new `e2e/` package starts Postgres, the built API serving the built web app, and seeds one user per role through the real invite flow.

**Tech Stack:** As in Phase 4, plus `@tanstack/react-query` 5.104.0 in the web app, Vitest 5.0.4 for the web app's unit tests, and `@playwright/test` 1.63.0 in `e2e/`.

**Spec:** [docs/superpowers/specs/2026-10-16-phase-5-frontend-switch-design.md](../specs/2026-10-16-phase-5-frontend-switch-design.md). Read it first, then the roadmap's departures lists: [2026-10-14-fullstack-roadmap.md](2026-10-14-fullstack-roadmap.md). The demo's behaviour is the reference where the spec is silent: `apps/web/src/App.tsx`, `Production.tsx`, `LotDrawer.tsx`, `Shipments.tsx`, `MonthEnd.tsx`, `Settings.tsx` and `repository.ts` as they are at the start of this branch.

## Where this plan departs from the spec

Record these in the roadmap's "Where Phase 5 departs from the PRD" in Task 12.

1. **Response types live in `@boat/domain/api`, not in `apps/api/src/contract.ts`.** `import type` from API source would make the web's `tsc` type-check the API itself, including `node:` imports and the generated Prisma client, under the web's compiler options. Instead the shapes are written once in the domain package, which both apps already use, and `apps/api/src/contract.ts` asserts that each server view is assignable both ways to its shared type. A changed response still fails `pnpm typecheck`.
2. **Writes don't use `useMutation`.** They are plain async functions run through the existing `run()`, which already drives the saving indicator and the repeat-click guard, and they invalidate the affected queries after success.
3. **`GET /lots/groups` totals are SQL sums** of the stored `grn_total` (kept by `refreshCompletion`). Building 20,000 lot views to add them up would defeat the endpoint. The integration test checks every total against the domain-computed values the lot list returns.
4. **Five small API additions the spec didn't name:** the NPI card in `GET /lots/summary` (the demo has eight cards; the API returned seven), `GET /reports/months` for the month picker, `vessels` in `GET /shipments/summary` for the vessel filter, a `productId` filter on `GET /lots` for a product's expanded lots, and each lot's current `eta` in `GET /reports/month-end` for the month-end lot table (Task 8).
5. **A password reset ends at sign-in.** `POST /auth/password/reset` answers 204 without starting a session, so the reset page sends the user to sign-in with "Password changed. Sign in with your new password."
6. **A session the server ended shows "Your session ended. Sign in again."** The idle message ("Signed out after N minutes without activity.") is kept for the browser's own idle timer, which is the only case where the app knows the reason.

## Global Constraints

- Everything in the Phase 1–4 Global Constraints still holds for API code: `YYYY-MM-DD` dates, `<field>Id` in and `{ id, value }` out, versions on `PATCH`, soft delete, history in the same transaction, `FR-x.y` test titles, and a row in `api.test.ts` for every new route.
- New dependencies, at exactly these versions and no others: `@tanstack/react-query@5.104.0` (web); `vitest@5.0.4` (web, dev); `@playwright/test@1.63.0`, `@testcontainers/postgresql@12.2.1`, `pg@8.23.1`, `@types/pg@8.23.1`, `@types/node@^24.19.2`, `typescript@^7.0.2` (e2e, dev).
- Screens use the domain's shapes. Only `apps/web/src/api/` reads or builds the API's JSON.
- Every request goes through `api/client.ts`. Writes carry `X-CSRF-Token`. Nothing polls `GET /auth/me`.
- No router library. `/invite` and `/reset-password` are chosen by `location.pathname`.
- Copy, exactly:
  - Version conflict: "Someone else changed this {lot|product|shipment} while you were editing. Reload to see their version — your unsaved changes will be lost."
  - 403: "You don't have permission to do that."
  - Network failure or 5xx: "Couldn't reach the server — try again."
  - 404 on an open record: "This {lot|shipment} was deleted."
  - Idle sign-out: "Signed out after {N} minutes without activity."
  - Server-ended session: "Your session ended. Sign in again."
- Playwright: `workers: 1`; every test starts with a data reset; every spec runs in the `desktop` and `mobile` (390 × 844) projects.
- Specs never sign out, change the password of, or disable the four seeded users (`admin`, `planner`, `poc`, `viewer`). A test that needs to do that creates its own user with `newUser()`.
- Until Task 11 removes it, screens not yet switched still read IndexedDB. In the e2e browser that database is empty, so those screens show nothing; that is expected mid-branch.
- Branch `phase-5-frontend-switch` from `dev` (already created, with the spec committed); it merges back into `dev`.

## Review Focus

1. **Saving a record someone else changed.** A stale `version` must show the conflict banner, keep the user's edits, and replace the form only on **Reload**. Pinned in Task 7 (`conflict.spec.ts`) and Task 9 (shipments).
2. **Server field errors on renamed fields.** A rule only the server checks (a duplicate lot label for the product, a product deleted while a shipment was being edited) must land under the right form field (`category`, `line:<id>:productId`), not as a generic toast. Pinned in Task 3 (`mappers.test.ts`), Task 7 (duplicate label), Task 8 (a component dropped mid-edit, a receipt over the remaining quantity) and Task 9 (a product deleted mid-edit).
3. **A session that ends mid-use.** A revoked or expired session must return to the sign-in screen with a message, not a blank screen or an endless spinner. Pinned in Task 6 (`auth.spec.ts`, "returns to sign-in when the session ends").
4. **A POC opening another POC's lot.** The drawer is view-only with the reason shown, and the server refuses a forced save. Pinned in Task 11 (`roles.spec.ts`).
5. **Changing a filter while on a later page.** The list must return to page 1 rather than show an empty page 3. Pinned in Task 6 (`filters.spec.ts`).

Also covered: an invite link that was already used (Task 5), a CSV of an empty view (Task 6), and a backup that fails validation before upload (Task 10).

---

## File Structure

```
packages/domain/src/
└─ api.ts                                  # the API's JSON shapes, flag and sort names
apps/api/src/
├─ contract.ts                             # compile-time checks: server views ≡ @boat/domain/api
└─ modules/
   ├─ lots/lot-list.ts, lots.service.ts, lots.router.ts   # /lots/groups, npi card, productId filter
   ├─ reports/month-end.service.ts, reports.router.ts     # /reports/months
   └─ shipments/shipments.service.ts                      # vessels in /shipments/summary
apps/web/
├─ vite.config.ts                          # /api proxy for development; Vitest
└─ src/
   ├─ api/
   │  ├─ client.ts                         # fetch wrapper, typed errors, CSRF, downloads
   │  ├─ mappers.ts                        # API JSON ⇄ domain shapes, field renames
   │  ├─ queryClient.ts                    # the QueryClient and invalidation helpers
   │  ├─ queries.ts                        # one hook per read endpoint
   │  ├─ auth.ts, lookups.ts, products.ts, lots.ts, entries.ts, activity.ts,
   │  │  shipments.ts, reports.ts, admin.ts   # reads and writes per area
   │  └─ *.test.ts
   ├─ auth/
   │  ├─ AuthProvider.tsx                  # /auth/me at start-up, sign-in state, session end
   │  ├─ SignIn.tsx                        # sign-in and forgot password
   │  ├─ TokenPages.tsx                    # /invite and /reset-password
   │  ├─ ProfileCard.tsx                   # signed-in user, sign out, change password
   │  └─ ChangePassword.tsx
   ├─ drafts.ts                            # blank lot and shipment drafts with default dropdowns
   ├─ Users.tsx                            # admin user list (Settings)
   ├─ access.ts                            # signed-in user and allowed actions for the screens
   ├─ App.tsx, Production.tsx, LotDrawer.tsx, MonthEnd.tsx, Shipments.tsx, Settings.tsx, ui.tsx
   └─ (deleted in Task 11) db.ts, repository.ts, demo.ts, models.ts, calculations.ts, validation.ts, Profiles.tsx
e2e/
├─ package.json, tsconfig.json, playwright.config.ts
├─ support/
│  ├─ env.ts                               # ports, paths, seeded users
│  ├─ global-setup.ts                      # Postgres, migrations, API, seeded users
│  ├─ mail.ts                              # emails from the API log
│  ├─ api.ts                               # signed-in API contexts, reset, newUser
│  ├─ seed.ts                              # products, lots, receipts, shipments through the API
│  └─ test.ts, ui.ts                       # test with auto-reset; UI helpers
└─ tests/*.spec.ts
```

---

### Task 1: `GET /lots/groups`, the NPI card and a product filter

The grouped Production view needs products in display order with their totals, which a paged flat list can't give. The demo also has an NPI card that `/lots/summary` lacks, and expanding a product needs `GET /lots?productId=…`.

**Files:**
- Modify: `apps/api/src/modules/lots/lot-list.ts`
- Modify: `apps/api/src/modules/lots/lots.service.ts`
- Modify: `apps/api/src/modules/lots/lots.router.ts`
- Modify: `apps/api/src/api.test.ts`
- Modify: `apps/api/test/lots-list.int.test.ts`
- Create: `apps/api/test/lot-groups.int.test.ts`

**Interfaces:**
- Consumes: `findLotIds`, `whereSql`, `order`, `from` and `flagSql` in `lot-list.ts`; `lotInclude` in `lot-view.ts`; `RecordsDeps`.
- Produces:
  - `GET /api/v1/lots/groups` takes the query of `GET /lots` without paging and returns `{ items: LotGroup[] }`, where `LotGroup = { product: { id, name, variant, segment: { id, value } }, lots, delayed, lotQty, produced, grnTotal, balance }` (all numbers). Products with matching lots come first, in the order of their first lot under `sort`. Then, only when `view=active`, there are no flags and no filter other than `segmentId` and `q`, come the products with no active lots, by name then variant, with every number 0. Those are narrowed by `segmentId` and by `q` against `"<name> <variant>"`, ignoring case.
  - `GET /api/v1/lots` and `/lots/groups` and `/lots/export.csv` accept `productId`.
  - `GET /api/v1/lots/summary` gains `npi`: active lots whose category is not BAU.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/lots-list.int.test.ts`, add `npi` to the summary test's expectation:

```ts
    expect(res.body).toEqual({
      overdue: count('overdue'),
      dueSoon: count('dueSoon'),
      onTrack: count('onTrack'),
      blocked: count('blocked'),
      approval: count('approval'),
      followUp: count('followUp'),
      rm: count('rm'),
      npi: count('npi'),
    })
```

In `apps/api/src/api.test.ts`, add the row next to `'GET /lots/summary signedIn'`:

```ts
        'GET /lots/groups signedIn',
```

Create `apps/api/test/lot-groups.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client'
import { refreshCompletion } from '../src/modules/lots/lot-lock'
import { createTestDatabase } from './support/db'
import {
  day,
  fixedNow,
  makeLookup,
  makeLot,
  makeProduct,
  makeRecordsWorld,
  type RecordsWorld,
  testApp,
} from './support/fixtures'

type Group = {
  product: { id: string; name: string; segment: { value: string } }
  lots: number
  delayed: number
  lotQty: number
  produced: number
  grnTotal: number
  balance: number
}
type Item = {
  product: { id: string }
  lotQty: number
  freshProductionQty: number
  status: { value: string }
  computed: { grnTotal: number; balance: number }
}

let db: PrismaClient
let close: () => Promise<void>
let app: ReturnType<typeof testApp>
let w: RecordsWorld
let headphonesId: string
const ids: Record<string, string> = {}

const product = async (name: string, segmentId: string) =>
  (ids[name] = (await makeProduct(db, { name, segmentId })).id)
const lot = (productName: string, fields: Partial<Prisma.LotUncheckedCreateInput>) =>
  makeLot(db, { productId: ids[productName], stageId: w.lookups.stage.id, ...fields })
const receive = async (lotId: string, quantity: number) => {
  await db.grnReceipt.create({ data: { lotId, label: 'G', date: day('2026-10-10'), quantity } })
  await refreshCompletion(db, lotId)
}

// Alpha and Bravo have active lots; Charlie and Delta have none. The test clock says 15 Oct 2026.
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  app = testApp(db, { now: fixedNow })
  w = await makeRecordsWorld(db, app)
  const L = w.lookups
  headphonesId = (await makeLookup(db, 'segment', 'Headphones')).id
  await product('Alpha', L.segment.id)
  await product('Bravo', L.segment.id)
  await product('Charlie', L.segment.id)
  await product('Delta', headphonesId)
  await lot('Alpha', {
    label: 'a1',
    plannedDate: day('2026-10-20'),
    lotQty: 100,
    freshProductionQty: 40,
  })
  await lot('Alpha', {
    label: 'a2',
    plannedDate: day('2026-10-25'),
    lotQty: 50,
    statusId: L.delayed.id,
  })
  const b1 = await lot('Bravo', { label: 'b1', plannedDate: day('2026-10-18'), lotQty: 200 })
  await receive(b1.id, 80)
  const b2 = await lot('Bravo', { label: 'b2', plannedDate: day('2026-10-01'), lotQty: 30 })
  await receive(b2.id, 30)
  const gone = await lot('Charlie', { label: 'deleted lot' })
  await db.lot.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
  await product('Echo', L.segment.id)
  await lot('Echo', { label: 'lot of a deleted product' })
  await db.product.update({ where: { id: ids.Echo }, data: { deletedAt: new Date() } })
})
afterAll(() => close())

const groups = async (query = '') => {
  const res = await w.viewer.agent.get(`/api/v1/lots/groups?${query}`)
  expect(res.status).toBe(200)
  return res.body.items as Group[]
}
const names = (items: Group[]) => items.map((g) => g.product.name)

describe('GET /lots/groups', () => {
  it('FR-2.5 lists products in the order of their first lot, then products without active lots', async () => {
    // Soundbar is the world's product, which has no lots.
    expect(names(await groups())).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta', 'Soundbar'])
    expect(names(await groups('sort=qty-desc')).slice(0, 2)).toEqual(['Bravo', 'Alpha'])
  })

  it('FR-2.5 totals the matching lots as the lot list computes them', async () => {
    const list = await w.viewer.agent.get('/api/v1/lots?pageSize=200')
    const items = list.body.items as Item[]
    for (const group of await groups()) {
      const mine = items.filter((i) => i.product.id === group.product.id)
      expect(group, group.product.name).toEqual({
        product: expect.objectContaining({ id: group.product.id }),
        lots: mine.length,
        delayed: mine.filter((i) => i.status.value === 'Delayed').length,
        lotQty: mine.reduce((n, i) => n + i.lotQty, 0),
        produced: mine.reduce((n, i) => n + i.freshProductionQty, 0),
        grnTotal: mine.reduce((n, i) => n + i.computed.grnTotal, 0),
        balance: mine.reduce((n, i) => n + i.computed.balance, 0),
      })
    }
    const [bravo, alpha] = await groups()
    expect(bravo).toMatchObject({ lots: 1, lotQty: 200, grnTotal: 80, balance: 120 })
    expect(alpha).toMatchObject({ lots: 2, delayed: 1, lotQty: 150, produced: 40, balance: 150 })
  })

  it('FR-2.5 shows completed lots without empty products', async () => {
    const done = await groups('view=completed')
    expect(names(done)).toEqual(['Bravo'])
    expect(done[0]).toMatchObject({ lots: 1, lotQty: 30, grnTotal: 30, balance: 0 })
  })

  it('FR-2.5 leaves out empty products once a filter other than segment or search is set', async () => {
    expect(names(await groups(`statusId=${w.lookups.delayed.id}`))).toEqual(['Alpha'])
    expect(names(await groups('flag=overdue'))).toEqual([])
  })

  it('FR-2.5 narrows empty products by segment and search', async () => {
    expect(names(await groups(`segmentId=${headphonesId}`))).toEqual(['Delta'])
    expect(names(await groups('q=CHAR'))).toEqual(['Charlie'])
  })

  it('FR-2.5 narrows the lot list and the groups to one product', async () => {
    const res = await w.viewer.agent.get(`/api/v1/lots?productId=${ids.Alpha}`)
    expect(res.status).toBe(200)
    expect(res.body.items.map((i: { label: string }) => i.label).sort()).toEqual(['a1', 'a2'])
    expect(names(await groups(`productId=${ids.Alpha}`))).toEqual(['Alpha'])
  })

  it('never shows deleted lots or deleted products', async () => {
    const all = await groups()
    expect(names(all)).not.toContain('Echo')
    expect(all.find((g) => g.product.name === 'Charlie')).toMatchObject({ lots: 0 })
  })

  it('answers an unknown sort with a field error', async () => {
    const res = await w.viewer.agent.get('/api/v1/lots/groups?sort=random')
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ sort: 'Choose a known sort.' })
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test -- src/api.test.ts` then `pnpm --filter @boat/api test:int -- test/lot-groups.int.test.ts test/lots-list.int.test.ts`
Expected: `api.test.ts` fails on the missing `GET /lots/groups` row; the group tests fail with 404s (the request falls through to `/:id`, and `groups` is not a valid id); the summary test fails on `npi`; the product filter test fails because `productId` is ignored.

- [ ] **Step 3: Add the product filter, the NPI card and the group query**

In `apps/api/src/modules/lots/lot-list.ts`, add `productId` to `filterColumns`:

```ts
const filterColumns = {
  productId: 'l.product_id',
  segmentId: 'p.segment_id',
```

Add `'npi'` to the cards:

```ts
const cards = ['overdue', 'dueSoon', 'onTrack', 'blocked', 'approval', 'followUp', 'rm', 'npi'] as const
```

Append the group query:

```ts
export type LotGroupRow = {
  productId: string
  lots: number
  delayed: number
  lotQty: number
  produced: number
  grnTotal: number
  balance: number
}

// The matching lots per product, products in the order of their first lot. grn_total is kept by
// refreshCompletion, so balance is the domain's lotQty - totalGrn. Sums are float8 so that large
// totals arrive as numbers rather than BigInts.
export async function lotGroupRows(db: Db, f: LotFilters, today: string) {
  return db.$queryRaw<LotGroupRow[]>`
    WITH matching AS (
      SELECT l.id, l.product_id, ROW_NUMBER() OVER (ORDER BY ${order[f.sort]}, l.id) AS pos
      FROM ${from} WHERE ${whereSql(f, today)})
    SELECT m.product_id AS "productId",
      COUNT(*)::int AS lots,
      (COUNT(*) FILTER (WHERE s.system_key = 'delayed'))::int AS delayed,
      SUM(x.lot_qty)::float8 AS "lotQty",
      SUM(x.fresh_production_qty)::float8 AS produced,
      SUM(x.grn_total)::float8 AS "grnTotal",
      SUM(x.lot_qty - x.grn_total)::float8 AS balance
    FROM matching m
    JOIN lots x ON x.id = m.id
    JOIN lookup_values s ON s.id = x.status_id
    GROUP BY m.product_id
    ORDER BY MIN(m.pos)`
}
```

- [ ] **Step 4: Add the service function**

In `apps/api/src/modules/lots/lots.service.ts`, import `lotGroupRows` from `./lot-list` and `lotInclude` from `./lot-view` (add both to the existing import lists), then append:

```ts
// Filters that hide products without active lots, as the demo's Production view does.
const narrowing = [
  'productId',
  'categoryId',
  'emsId',
  'pocId',
  'statusId',
  'stageId',
  'logisticsId',
  'blockerId',
] as const

// The grouped Production view: products in the order of their first matching lot with their
// totals, then, on the unfiltered active view, products that have no active lots.
export async function lotGroups({ db, clock }: RecordsDeps, filters: LotFilters) {
  const rows = await lotGroupRows(db, filters, await clock.today())
  const select = lotInclude.product.select
  const products = await db.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    select,
  })
  const byId = new Map(products.map((p) => [p.id, p]))
  const showEmpty =
    filters.view === 'active' && !filters.flags.length && !narrowing.some((k) => filters[k])
  const term = filters.q.trim().toLowerCase()
  const empty = showEmpty
    ? (
        await db.product.findMany({
          where: {
            deletedAt: null,
            ...(filters.segmentId && { segmentId: filters.segmentId }),
            lots: { none: { deletedAt: null, completedOn: null } },
          },
          select,
          orderBy: [{ name: 'asc' }, { variant: 'asc' }],
        })
      ).filter((p) => `${p.name} ${p.variant}`.toLowerCase().includes(term))
    : []
  const zero = { lots: 0, delayed: 0, lotQty: 0, produced: 0, grnTotal: 0, balance: 0 }
  return {
    items: [
      ...rows.map(({ productId, ...totals }) => ({ product: byId.get(productId)!, ...totals })),
      ...empty.map((product) => ({ product, ...zero })),
    ],
  }
}
```

- [ ] **Step 5: Add the route and the filter**

In `apps/api/src/modules/lots/lots.router.ts`, add `productId` to `listQuery`:

```ts
const listQuery = z.object({
  view: z.enum(['active', 'completed'], { error: 'Choose active or completed.' }).default('active'),
  q: z.string().max(100, { error: 'Keep the search to 100 characters or fewer.' }).default(''),
  productId: filterId,
  segmentId: filterId,
```

Import `lotGroups` from `./lots.service`, and add the route directly after `/summary`, so it is matched before `/:id`:

```ts
  router.get('/groups', requireSignedIn(), async (req, res) => {
    res.json(await lotGroups(deps, toFilters(parseInput(listQuery, req.query))))
  })
```

- [ ] **Step 6: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: all pass.

- [ ] **Step 7: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add apps/api
git commit -m "Add lot groups, the NPI card and a product filter to the lot list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The month list, the vessel list and the shared response types

The month picker and the vessel filter were built from every record in the browser; the server now lists them. The API's JSON shapes move into `@boat/domain/api` for the web app to read, and the API checks at compile time that its views still produce them.

**Files:**
- Create: `packages/domain/src/api.ts`
- Modify: `packages/domain/package.json`, `packages/domain/vitest.config.ts`
- Create: `apps/api/src/contract.ts`
- Modify: `apps/api/src/modules/lots/lot-list.ts`, `apps/api/src/modules/shipments/shipments.service.ts` (flag and sort names now come from the domain)
- Modify: `apps/api/src/modules/reports/month-end.service.ts`, `apps/api/src/modules/reports/reports.router.ts`
- Modify: `apps/api/src/api.test.ts`
- Modify: `apps/api/test/month-end.int.test.ts`, `apps/api/test/shipments-list.int.test.ts`

**Interfaces:**
- Consumes: the view functions and input types of every module (named in `contract.ts` below).
- Produces:
  - `GET /api/v1/reports/months` returns `{ items: string[] }`: `YYYY-MM` months, newest first, from the planned dates of active lots and the dates of their active receipts, always including the company's current month.
  - `GET /api/v1/shipments/summary` gains `vessels: string[]`, the distinct vessels of active shipments sorted with `Array.prototype.sort()`.
  - `@boat/domain/api` exports `lotFlagNames`, `LotFlag`, `lotSorts`, `LotSort`, `shipmentFlagNames`, `ShipmentFlag`, `shipmentSorts`, `ShipmentSort`, and the types `Ref`, `Page<T>`, `SessionUser`, `MePayload`, `Settings`, `LookupItem`, `ProductItem`, `LotProduct`, `LotComputed`, `LotItem`, `BatchItem`, `ReceiptItem`, `LotDetail`, `LotCards`, `LotGroup`, `ActivityEntry`, `ShipmentLine`, `ShipmentComputed`, `ShipmentListItem`, `EtaRevisionItem`, `ShipmentDetail`, `ShipmentCards`, `MonthEndReport`, `UserItem`, `InviteResult`, `ImportResult`, and the request types `LotInput`, `LotPatch`, `BatchInput`, `ReceiptInput`, `ProductInput`, `ProductPatch`, `ShipmentInput`, `ShipmentPatch`, `NewUser`, `UserPatch`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/api.test.ts`, add the row next to `'GET /reports/month-end signedIn'`:

```ts
        'GET /reports/months signedIn',
```

Append to `apps/api/test/month-end.int.test.ts`, inside its outermost `describe` (or at the end of the file if it has none). It uses the file's existing `db`, `w` and lot helpers; if the file's helper for creating a lot has another name, use that:

```ts
describe('GET /reports/months', () => {
  it('FR-5.1 lists planned and receipt months, newest first, with the current month', async () => {
    const product = await makeProduct(db)
    const lot = await makeLot(db, { productId: product.id, plannedDate: day('2025-03-14') })
    await db.grnReceipt.create({
      data: { lotId: lot.id, label: 'G', date: day('2025-05-02'), quantity: 1 },
    })
    const gone = await makeLot(db, { productId: product.id, plannedDate: day('2024-01-10') })
    await db.lot.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
    const res = await w.viewer.agent.get('/api/v1/reports/months')
    expect(res.status).toBe(200)
    const months: string[] = res.body.items
    expect(months[0]).toBe('2026-10')
    expect(months).toContain('2025-05')
    expect(months).toContain('2025-03')
    expect(months).not.toContain('2024-01')
    expect(months).toEqual([...months].sort().reverse())
    expect(new Set(months).size).toBe(months.length)
  })
})
```

Add `makeLot`, `makeProduct` and `day` to the file's import from `./support/fixtures` if they are not already there. The test clock (`fixedNow`) says 15 Oct 2026, so the current month is `2026-10`; if this file's app doesn't use `fixedNow`, replace `'2026-10'` with the month its clock gives.

In `apps/api/test/shipments-list.int.test.ts`, find the test of `GET /shipments/summary` and add to its expectations:

```ts
    expect(res.body.vessels).toEqual(
      [...new Set(all.map((s: { vessel: string }) => s.vessel))].sort(),
    )
```

where `all` is the full list that test already reads (if it reads none, add `const all = (await w.viewer.agent.get('/api/v1/shipments?pageSize=200')).body.items`). If the test compares the whole body with `toEqual`, add `vessels: expect.any(Array)` to that object as well.

Create `apps/api/src/contract.ts`:

```ts
// Compile-time checks that the server's JSON matches @boat/domain/api, which the web app reads.
// `pnpm typecheck` fails on the line of any view or input that changed. Update the shared type,
// then the web app's use of it.
import type * as Api from '@boat/domain/api'
import type { entryView } from './modules/activity/activity.service'
import type { MePayload } from './modules/auth/auth.service'
import type { importBackup } from './modules/data-transfer/import.service'
import type { ReceiptInput } from './modules/grn-receipts/grn-receipts.service'
import type { LookupView } from './modules/lookups/lookups.service'
import type { getLotDetail, LotView } from './modules/lots/lot-view'
import type { LotInput, LotPatch, lotCards, lotGroups } from './modules/lots/lots.service'
import type { ProductInput, ProductPatch, ProductView } from './modules/products/products.service'
import type { monthEndReport, monthList } from './modules/reports/month-end.service'
import type { BatchInput } from './modules/rm-batches/rm-batches.service'
import type { Settings } from './modules/settings/settings.service'
import type { getShipmentDetail, ShipmentView } from './modules/shipments/shipment-view'
import type {
  ShipmentInput,
  ShipmentPatch,
  shipmentCards,
} from './modules/shipments/shipments.service'
import type { NewUser, UserPatch, UserView } from './modules/users/users.service'

// What JSON.stringify makes of a value: Dates become strings.
type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T
type Reply<F extends (...args: never[]) => unknown> = Json<Awaited<ReturnType<F>>>
// Each assignable to the other: a field added, removed, made optional or retyped on either side
// fails the check.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Expect<T extends true> = T

export type ContractChecks = [
  Expect<Same<Json<MePayload>, Api.MePayload>>,
  Expect<Same<Settings, Api.Settings>>,
  Expect<Same<LookupView, Api.LookupItem>>,
  Expect<Same<Json<ProductView>, Api.ProductItem>>,
  Expect<Same<Json<LotView>, Api.LotItem>>,
  Expect<Same<Reply<typeof getLotDetail>, Api.LotDetail>>,
  Expect<Same<Reply<typeof lotCards>, Api.LotCards>>,
  Expect<Same<Reply<typeof lotGroups>, { items: Api.LotGroup[] }>>,
  Expect<Same<Json<ReturnType<typeof entryView>>, Api.ActivityEntry>>,
  Expect<Same<Json<ShipmentView>, Api.ShipmentListItem>>,
  Expect<Same<Reply<typeof getShipmentDetail>, Api.ShipmentDetail>>,
  Expect<Same<Reply<typeof shipmentCards>, Api.ShipmentCards>>,
  Expect<Same<Reply<typeof monthEndReport>, Api.MonthEndReport>>,
  Expect<Same<Reply<typeof monthList>, { items: string[] }>>,
  Expect<Same<Json<UserView>, Api.UserItem>>,
  Expect<Same<Reply<typeof importBackup>, Api.ImportResult>>,
  Expect<Same<LotInput, Api.LotInput>>,
  Expect<Same<LotPatch, Api.LotPatch>>,
  Expect<Same<BatchInput, Api.BatchInput>>,
  Expect<Same<ReceiptInput, Api.ReceiptInput>>,
  Expect<Same<ProductInput, Api.ProductInput>>,
  Expect<Same<ProductPatch, Api.ProductPatch>>,
  Expect<Same<ShipmentInput, Api.ShipmentInput>>,
  Expect<Same<ShipmentPatch, Api.ShipmentPatch>>,
  Expect<Same<NewUser, Api.NewUser>>,
  Expect<Same<UserPatch, Api.UserPatch>>,
]
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api typecheck`
Expected: FAIL: `@boat/domain/api` cannot be found, and `monthList` is not exported.

Run: `pnpm --filter @boat/api test -- src/api.test.ts` and `pnpm --filter @boat/api test:int -- test/month-end.int.test.ts test/shipments-list.int.test.ts`
Expected: the route table misses `GET /reports/months`; the months test gets a 404; the summary has no `vessels`.

- [ ] **Step 3: Write the shared types**

Create `packages/domain/src/api.ts`:

```ts
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

export type LookupItem = { id: string; kind: LookupKind; value: string; sort: number; system: boolean }
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
  flags: { overdue: boolean; dueSoon: boolean; followUp: boolean; blocked: boolean; approval: boolean }
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
```

In `packages/domain/package.json`, add the export:

```json
    "./backup": "./src/backup.ts",
    "./api": "./src/api.ts"
```

In `packages/domain/vitest.config.ts`, leave `api.ts` out of coverage, since it holds types and lists of names:

```ts
      exclude: ['src/**/*.test.ts', 'src/test-factories.ts', 'src/api.ts'],
```

In `apps/api/src/modules/lots/lot-list.ts`, replace the local `lotFlagNames`, `LotFlag`, `lotSorts` and `LotSort` declarations with a re-export, so the router's imports keep working:

```ts
import { type LotFlag, lotFlagNames, type LotSort, lotSorts } from '@boat/domain/api'

export { type LotFlag, lotFlagNames, type LotSort, lotSorts }
```

In `apps/api/src/modules/shipments/shipments.service.ts`, do the same for `shipmentFlagNames`, `ShipmentFlag`, `shipmentSorts` and `ShipmentSort`.

- [ ] **Step 4: Add the month list and the vessels**

In `apps/api/src/modules/reports/month-end.service.ts`, import `monthOf` from `@boat/domain/calculations` (add it to the existing import) and add:

```ts
// The month picker: months with planned lots or receipts, newest first, and always this month,
// as the demo builds it. Lots and receipts of deleted products don't count.
export async function monthList({ db, clock }: RecordsDeps) {
  const current = monthOf(await clock.today())
  const rows = await db.$queryRaw<{ month: string }[]>`
    SELECT to_char(l.planned_date, 'YYYY-MM') AS month
    FROM lots l JOIN products p ON p.id = l.product_id AND p.deleted_at IS NULL
    WHERE l.deleted_at IS NULL AND l.planned_date IS NOT NULL
    UNION
    SELECT to_char(g.date, 'YYYY-MM')
    FROM grn_receipts g
    JOIN lots l ON l.id = g.lot_id AND l.deleted_at IS NULL
    JOIN products p ON p.id = l.product_id AND p.deleted_at IS NULL
    WHERE g.deleted_at IS NULL`
  return { items: [...new Set([current, ...rows.map((r) => r.month)])].sort().reverse() }
}
```

In `apps/api/src/modules/reports/reports.router.ts`, import `monthList` and add:

```ts
  router.get('/months', requireSignedIn(), async (_req, res) => {
    res.json(await monthList(deps))
  })
```

In `apps/api/src/modules/shipments/shipments.service.ts`, add `vessels` to `shipmentCards`' return value:

```ts
    openUnits: all
      .filter((v) => v.computed.flags.open)
      .reduce((n, v) => n + v.computed.totalQty, 0),
    vessels: [...new Set(all.map((v) => v.vessel))].sort(),
  }
```

- [ ] **Step 5: Make the contract hold**

Run: `pnpm --filter @boat/api typecheck`
Expected: PASS. If a `ContractChecks` line fails, the server is the reference: compare the two shapes field by field and correct `packages/domain/src/api.ts`, never the server, unless the server's shape is a bug you can name.

- [ ] **Step 6: Run every test**

Run: `pnpm typecheck && pnpm test && pnpm --filter @boat/domain test:coverage && pnpm --filter @boat/api test:int`
Expected: all pass, domain coverage at or above 95%.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add packages/domain apps/api
git commit -m "Share the API's response types and list months and vessels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The web app's API client and mappers

Every request goes through one client that sends the CSRF token and turns error replies into errors the forms already understand. The mappers convert between the API's JSON and the domain shapes the screens use, including the field names in a 422.

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`
- Create: `apps/web/src/api/client.ts`, `apps/web/src/api/client.test.ts`
- Create: `apps/web/src/api/mappers.ts`, `apps/web/src/api/mappers.test.ts`

**Interfaces:**
- Consumes: `ValidationError`, `FieldErrors` and `lineField` from `@boat/domain/validation`; the types in `@boat/domain/api` and `@boat/domain/models`.
- Produces:
  - `client.ts`:
    - `ApiError(status: number, message: string)`; `ConflictError(message, current?: unknown)` with status 409; `UnauthenticatedError(message?)` with status 401; `NotFoundError()` with status 404.
    - `forbiddenMessage` and `unreachableMessage`, the copy from Global Constraints.
    - `setCsrfToken(token: string)` and `whenSessionEnds(handler: () => void)`.
    - `type CallOptions = { fields?: (name: string) => string; public?: boolean }`.
    - `api.get<T>(path, options?)`, `api.post<T>(path, body?, options?)`, `api.patch<T>(path, body, options?)` and `api.delete(path, options?)`, with paths relative to `/api/v1`.
    - `queryString(params: Record<string, string | number | boolean | string[] | undefined>): string`, which returns `''` or `?a=1&flag=x&flag=y`.
    - `download(path: string): Promise<void>`, which saves the file the server names in `Content-Disposition`.
  - `mappers.ts`:
    - `type LotRecord = Lot & { version: number; product: LotProduct; computed: LotComputed; access: LotAccess; completedOn: string }`.
    - `toLot(item: LotItem): LotRecord`, `toBatch(item: BatchItem): RMBatch` and `toReceipt(item: ReceiptItem): GRNReceipt`.
    - `type ProductRecord = Product & { version: number }` and `toProduct(item: ProductItem): ProductRecord`.
    - `type ShipmentRecord = Shipment & { version: number; computed: ShipmentComputed; lines: ShipmentLine[] }`, `toShipment(item: ShipmentListItem): ShipmentRecord` and `toLines(item: ShipmentListItem): ShipmentItem[]`.
    - `lookupId(lookups: LookupItem[], kind: LookupKind, value: string): string | null`.
    - `lotInput(lot: Lot, lookups): LotInput`, `batchInput(batch: RMBatch, lookups): BatchInput`, `receiptInput(receipt: GRNReceipt): ReceiptInput`, `productInput(product: Product, lookups): ProductInput` and `shipmentInput(shipment: Shipment, lines: ShipmentItem[], lookups): ShipmentInput`.
    - `lotField`, `productField` and `batchField` of type `(name: string) => string`, and `shipmentField(lines: ShipmentItem[]): (name: string) => string`.
    - `values(lookups: LookupItem[], kind: LookupKind): string[]`, the values of one kind in their sort order.

- [ ] **Step 1: Add the dependencies, the test runner and the development proxy**

In `apps/web/package.json`, add to `dependencies`:

```json
    "@tanstack/react-query": "5.104.0",
```

add to `devDependencies`:

```json
    "vitest": "5.0.4",
```

and add a script:

```json
    "test": "vitest run",
```

Replace `apps/web/vite.config.ts` with:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the API runs on its own port (apps/api/.env, PORT=3000); the proxy keeps requests
// same-origin, as on Render, so the session cookie and CSRF rules behave the same.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: { include: ['src/**/*.test.ts'] },
})
```

Run: `pnpm install`
Expected: the lockfile updates; no other package changes.

- [ ] **Step 2: Write the failing client tests**

Create `apps/web/src/api/client.test.ts`:

```ts
import { ValidationError } from '@boat/domain/validation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  api,
  ApiError,
  ConflictError,
  forbiddenMessage,
  NotFoundError,
  queryString,
  setCsrfToken,
  UnauthenticatedError,
  unreachableMessage,
  whenSessionEnds,
} from './client'

const fetchMock = vi.fn<typeof fetch>()
const reply = (status: number, body?: unknown) =>
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
const sent = () => fetchMock.mock.calls.at(-1)!
const headers = () => new Headers(sent()[1]!.headers)

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  setCsrfToken('csrf-1')
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  whenSessionEnds(() => {})
})

describe('requests', () => {
  it('sends the CSRF token on writes only, under /api/v1', async () => {
    reply(200, { items: [] })
    expect(await api.get('/lots')).toEqual({ items: [] })
    expect(sent()[0]).toBe('/api/v1/lots')
    expect(headers().get('x-csrf-token')).toBeNull()
    reply(201, { id: 'x' })
    await api.post('/lots', { label: 'L1' })
    expect(headers().get('x-csrf-token')).toBe('csrf-1')
    expect(headers().get('content-type')).toBe('application/json')
    expect(sent()[1]!.body).toBe('{"label":"L1"}')
  })
  it('answers 204 with undefined', async () => {
    reply(204)
    expect(await api.delete('/lots/1')).toBeUndefined()
  })
  it('builds query strings with repeated flags and no empty values', () => {
    expect(queryString({})).toBe('')
    expect(queryString({ q: 'a b', view: 'active', flag: ['rm', 'npi'], stageId: undefined })).toBe(
      '?q=a+b&view=active&flag=rm&flag=npi',
    )
    expect(queryString({ q: '', page: 2 })).toBe('?page=2')
  })
})

describe('errors', () => {
  it('turns a 422 into the domain ValidationError, renaming fields for the form', async () => {
    reply(422, { error: 'validation', fields: { categoryId: 'Choose a category.', label: 'Bad.' } })
    const err = await api
      .post('/lots', {}, { fields: (n) => (n === 'categoryId' ? 'category' : n) })
      .catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.fields).toEqual({ category: 'Choose a category.', label: 'Bad.' })
  })
  it('keeps the server record on a 409', async () => {
    reply(409, { error: 'conflict', message: 'Someone else changed this lot.', current: { id: 1 } })
    const err = await api.patch('/lots/1', { version: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toBe('Someone else changed this lot.')
    expect(err.current).toEqual({ id: 1 })
  })
  it('reports an ended session on a 401, except on public calls', async () => {
    const ended = vi.fn()
    whenSessionEnds(ended)
    reply(401, { error: 'unauthenticated' })
    expect(await api.get('/lots').catch((e) => e)).toBeInstanceOf(UnauthenticatedError)
    expect(ended).toHaveBeenCalledTimes(1)
    reply(401, { error: 'unauthenticated', message: 'Email or password is incorrect.' })
    const err = await api.post('/auth/login', {}, { public: true }).catch((e) => e)
    expect(err.message).toBe('Email or password is incorrect.')
    expect(ended).toHaveBeenCalledTimes(1)
  })
  it('uses fixed copy for 403, 404, 5xx and network failures', async () => {
    reply(403, { error: 'forbidden', message: "Viewer profiles can't create lots." })
    expect((await api.post('/lots').catch((e) => e)).message).toBe(forbiddenMessage)
    reply(404, { error: 'not_found' })
    expect(await api.get('/lots/1').catch((e) => e)).toBeInstanceOf(NotFoundError)
    reply(500, { error: 'internal' })
    const failed = await api.get('/lots').catch((e) => e)
    expect(failed).toBeInstanceOf(ApiError)
    expect(failed.message).toBe(unreachableMessage)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await api.get('/lots').catch((e) => e)).message).toBe(unreachableMessage)
  })
  it("passes the server's message on a 429", async () => {
    reply(429, { error: 'rate_limited', message: 'Too many failed attempts.' })
    expect((await api.post('/auth/login', {}, { public: true }).catch((e) => e)).message).toBe(
      'Too many failed attempts.',
    )
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @boat/web test`
Expected: FAIL: `./client` cannot be found.

- [ ] **Step 4: Write the client**

Create `apps/web/src/api/client.ts`:

```ts
import { type FieldErrors, ValidationError } from '@boat/domain/validation'

// Errors the API answers with (PRD "Error shape"). A 422 becomes the domain's ValidationError, so
// forms read it with fieldErrors as they did before the API.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
// 409: a stale version (with the server's current record) or a rule about other records.
export class ConflictError extends ApiError {
  constructor(
    message: string,
    readonly current?: unknown,
  ) {
    super(409, message)
    this.name = 'ConflictError'
  }
}
export class UnauthenticatedError extends ApiError {
  constructor(message = 'Your session ended. Sign in again.') {
    super(401, message)
    this.name = 'UnauthenticatedError'
  }
}
export class NotFoundError extends ApiError {
  constructor() {
    super(404, 'This record no longer exists.')
    this.name = 'NotFoundError'
  }
}
export const forbiddenMessage = "You don't have permission to do that."
export const unreachableMessage = "Couldn't reach the server — try again."

export type CallOptions = {
  // Renames the server's field names to the form's before the ValidationError is thrown.
  fields?: (name: string) => string
  // A 401 here is an answer (a wrong password, no session yet), not a session that ended.
  public?: boolean
}

let csrfToken = ''
let sessionEnded: () => void = () => {}
export const setCsrfToken = (token: string) => {
  csrfToken = token
}
// The auth provider registers this, so any request that finds the session gone signs out.
export const whenSessionEnds = (handler: () => void) => {
  sessionEnded = handler
}

const base = '/api/v1'

async function send(method: string, path: string, body: unknown) {
  try {
    return await fetch(`${base}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(method !== 'GET' && csrfToken && { 'x-csrf-token': csrfToken }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, unreachableMessage)
  }
}

type ErrorBody = { message?: unknown; current?: unknown; fields?: Record<string, unknown> }

function toError(status: number, data: ErrorBody | undefined, options: CallOptions): Error {
  const message = typeof data?.message === 'string' ? data.message : undefined
  switch (status) {
    case 401:
      if (!options.public) sessionEnded()
      return new UnauthenticatedError(message)
    case 403:
      return new ApiError(403, forbiddenMessage)
    case 404:
      return new NotFoundError()
    case 409:
      return new ConflictError(message ?? 'Someone else changed this record.', data?.current)
    case 422: {
      const fields: FieldErrors = {}
      for (const [name, text] of Object.entries(data?.fields ?? {}))
        fields[options.fields ? options.fields(name) : name] ??= String(text)
      return new ValidationError(fields)
    }
    case 429:
      return new ApiError(429, message ?? 'Too many attempts. Wait a few minutes and try again.')
    default:
      return new ApiError(status, status >= 500 || !message ? unreachableMessage : message)
  }
}

async function call<T>(method: string, path: string, body: unknown, options: CallOptions = {}) {
  const res = await send(method, path, body)
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => undefined)
  if (!res.ok) throw toError(res.status, data, options)
  return data as T
}

export const api = {
  get: <T>(path: string, options?: CallOptions) => call<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: CallOptions) =>
    call<T>('POST', path, body ?? {}, options),
  patch: <T>(path: string, body: unknown, options?: CallOptions) =>
    call<T>('PATCH', path, body, options),
  delete: (path: string, options?: CallOptions) => call<void>('DELETE', path, undefined, options),
}

export function queryString(
  params: Record<string, string | number | boolean | string[] | undefined>,
) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

// Saves a file the server builds (CSV, JSON backup) under the name it gives.
export async function download(path: string) {
  const res = await send('GET', path, undefined)
  if (!res.ok) throw toError(res.status, await res.json().catch(() => undefined), {})
  const name =
    /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download'
  const url = URL.createObjectURL(await res.blob())
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
```

- [ ] **Step 5: Run the client tests**

Run: `pnpm --filter @boat/web test`
Expected: PASS.

- [ ] **Step 6: Write the failing mapper tests**

Create `apps/web/src/api/mappers.test.ts`:

```ts
import type { BatchItem, LookupItem, LotItem, ReceiptItem, ShipmentListItem } from '@boat/domain/api'
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
    expect(toBatch(batch)).toMatchObject({ component: 'PCB', plannedDate: '', receivedDate: '2026-10-03' })
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
```

- [ ] **Step 7: Run them and confirm they fail**

Run: `pnpm --filter @boat/web test`
Expected: FAIL: `./mappers` cannot be found.

- [ ] **Step 8: Write the mappers**

Create `apps/web/src/api/mappers.ts`:

```ts
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
```

- [ ] **Step 9: Run every test**

Run: `pnpm --filter @boat/web test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Format and commit**

```bash
pnpm format
git add apps/web pnpm-lock.yaml
git commit -m "Add the web app's API client and mappers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Playwright harness

One Postgres, the built API serving the built web app on one origin as on Render, and one user per role created through the real invite flow. Later tasks write their specs against it before changing a screen.

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json`, `.gitignore`, `.prettierignore`
- Create: `e2e/package.json`, `e2e/tsconfig.json`, `e2e/playwright.config.ts`
- Create: `e2e/support/env.ts`, `e2e/support/mail.ts`, `e2e/support/api.ts`, `e2e/support/global-setup.ts`, `e2e/support/test.ts`
- Test: `e2e/tests/smoke.spec.ts`

**Interfaces:**
- Consumes: the built `apps/web/dist` and `apps/api/dist/{server,create-admin}.js`; the API's log mailer, which writes each email as a JSON log line with an `email: { to, subject, text }` field when `RESEND_API_KEY` is unset.
- Produces:
  - `env.ts`: `appUrl`, `password`, `type RoleName = 'admin' | 'planner' | 'poc' | 'viewer'`, `roleNames`, `users: Record<RoleName, { email: string; name: string }>`, `pocValue` (`'Maya Shah'`, the POC value the seeded POC user owns) and `authFile(role)`, the saved sign-in state.
  - `mail.ts`: `emailsTo(address): Email[]`, `nextEmail(address, seen): Promise<Email>`, `linkIn(text)` and `tokenIn(text)`.
  - `api.ts`: `type Api = { me: MePayload; get; post; patch; delete; dispose }`; `apiAs(role): Promise<Api>`; `signInApi(email, password): Promise<Api>`; `acceptInvite(token, password?)`; `newUser(role, pocId?): Promise<{ email; name; password }>`; `resetData()`.
  - `test.ts`: `test`, which resets data before every test, and `expect`.

- [ ] **Step 1: Add the package**

In `pnpm-workspace.yaml`, add the package:

```yaml
packages:
  - apps/*
  - packages/*
  - e2e
```

In the root `package.json`, add a script:

```json
    "e2e": "pnpm --filter @boat/e2e e2e",
```

Append to both `.gitignore` and `.prettierignore`:

```
e2e/.run
e2e/test-results
e2e/playwright-report
```

Create `e2e/package.json`:

```json
{
  "name": "@boat/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@boat/domain": "workspace:*",
    "@playwright/test": "1.63.0",
    "@testcontainers/postgresql": "12.2.1",
    "@types/node": "^24.19.2",
    "@types/pg": "8.23.1",
    "pg": "8.23.1",
    "typescript": "^7.0.2"
  }
}
```

The script is `e2e`, not `test`, so the root `pnpm test` stays fast and needs neither Docker nor a build.

Create `e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["**/*.ts"],
  "exclude": ["test-results", "playwright-report"]
}
```

Run: `pnpm install && pnpm --filter @boat/e2e exec playwright install chromium`
Expected: the lockfile updates and Chromium downloads.

- [ ] **Step 2: Write the configuration and environment**

Create `e2e/support/env.ts`:

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const apiDir = path.join(repo, 'apps/api')
export const runDir = path.join(repo, 'e2e/.run')
export const logFile = path.join(runDir, 'api.log')
export const port = Number(process.env.E2E_PORT ?? 3100)
export const appUrl = `http://localhost:${port}`
export const sessionSecret = 'e2e-only-session-secret-0123456789abcdef'
export const password = 'correct horse battery staple'

export type RoleName = 'admin' | 'planner' | 'poc' | 'viewer'
export const roleNames: RoleName[] = ['admin', 'planner', 'poc', 'viewer']
export const users: Record<RoleName, { email: string; name: string }> = {
  admin: { email: 'admin@e2e.test', name: 'Ada Admin' },
  planner: { email: 'planner@e2e.test', name: 'Pat Planner' },
  poc: { email: 'poc@e2e.test', name: 'Maya Shah' },
  viewer: { email: 'viewer@e2e.test', name: 'Vic Viewer' },
}
// The point-of-contact value the seeded POC user owns.
export const pocValue = 'Maya Shah'
// Each seeded user's signed-in browser state, written by global setup.
export const authFile = (role: RoleName) => path.join(runDir, `${role}.json`)
```

Create `e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'
import { appUrl } from './support/env'

export default defineConfig({
  testDir: './tests',
  globalSetup: './support/global-setup.ts',
  // The tests share one database and reset it, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: appUrl,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
})
```

- [ ] **Step 3: Write the mail and API helpers**

Create `e2e/support/mail.ts`:

```ts
import { readFileSync } from 'node:fs'
import { logFile } from './env'

export type Email = { to: string; subject: string; text: string }

// Without RESEND_API_KEY the API writes each email to its log instead of sending it (mailer.ts).
export function emailsTo(address: string): Email[] {
  let log = ''
  try {
    log = readFileSync(logFile, 'utf8')
  } catch {
    return []
  }
  return log.split('\n').flatMap((line) => {
    try {
      const entry = JSON.parse(line) as { email?: Email }
      return entry.email?.to === address ? [entry.email] : []
    } catch {
      return []
    }
  })
}

// Waits for an email beyond the `seen` earlier ones and returns the newest.
export async function nextEmail(address: string, seen: number, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const all = emailsTo(address)
    if (all.length > seen) return all[all.length - 1]
    if (Date.now() > until) throw new Error(`No new email to ${address}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export function linkIn(text: string) {
  const match = /(https?:\/\/\S+#token=[\w-]+)/.exec(text)
  if (!match) throw new Error(`No link in: ${text}`)
  return match[1]
}
export const tokenIn = (text: string) => new URL(linkIn(text)).hash.slice('#token='.length)
```

Create `e2e/support/api.ts`:

```ts
import type { MePayload, NewUser } from '@boat/domain/api'
import type { Role } from '@boat/domain/models'
import { type APIRequestContext, request } from '@playwright/test'
import { appUrl, authFile, password, type RoleName } from './env'
import { nextEmail, tokenIn } from './mail'

// Test setup and checks go through the API, as a real signed-in user with the CSRF token.
export type Api = {
  me: MePayload
  // Responses default to any to keep setup code short; tests check the fields they rely on.
  get<T = any>(path: string): Promise<T>
  post<T = any>(path: string, data?: unknown): Promise<T>
  patch<T = any>(path: string, data: unknown): Promise<T>
  delete(path: string): Promise<void>
  dispose(): Promise<void>
}

function wrap(ctx: APIRequestContext, me: MePayload): Api {
  const call = async (method: string, path: string, data?: unknown) => {
    const res = await ctx.fetch(`/api/v1${path}`, {
      method,
      data,
      headers: { 'x-csrf-token': me.csrfToken },
    })
    if (!res.ok()) throw new Error(`${method} ${path} answered ${res.status()}: ${await res.text()}`)
    return res.status() === 204 ? undefined : res.json()
  }
  return {
    me,
    get: (path) => call('GET', path),
    post: (path, data) => call('POST', path, data ?? {}),
    patch: (path, data) => call('PATCH', path, data),
    delete: async (path) => {
      await call('DELETE', path)
    },
    dispose: () => ctx.dispose(),
  }
}

// A seeded user's API session, from the sign-in state global setup saved.
export async function apiAs(role: RoleName) {
  const ctx = await request.newContext({ baseURL: appUrl, storageState: authFile(role) })
  const res = await ctx.get('/api/v1/auth/me')
  if (!res.ok()) throw new Error(`The seeded ${role} is no longer signed in (${res.status()}).`)
  return wrap(ctx, await res.json())
}

export async function signInApi(email: string, pw: string) {
  const ctx = await request.newContext({ baseURL: appUrl })
  const res = await ctx.post('/api/v1/auth/login', { data: { email, password: pw } })
  if (!res.ok()) throw new Error(`Sign-in as ${email} answered ${res.status()}`)
  return wrap(ctx, await res.json())
}

// Accepting an invite starts a session; the returned context holds its cookie.
export async function acceptInvite(token: string, pw = password) {
  const ctx = await request.newContext({ baseURL: appUrl })
  const res = await ctx.post('/api/v1/auth/invites/accept', { data: { token, password: pw } })
  if (!res.ok()) throw new Error(`Accepting the invite answered ${res.status()}: ${await res.text()}`)
  return { ctx, me: (await res.json()) as MePayload }
}

let counter = 0
// A user of its own, for tests that sign out, change a password or disable an account: doing
// that to a seeded user would end the saved session the other tests rely on.
export async function newUser(role: Role, pocId: string | null = null) {
  const admin = await apiAs('admin')
  counter += 1
  const email = `user-${Date.now().toString(36)}-${counter}@e2e.test`
  const name = `Test ${role} ${counter}`
  await admin.post('/users', { email, name, role, pocId } satisfies NewUser)
  await admin.dispose()
  const { ctx } = await acceptInvite(tokenIn((await nextEmail(email, 0)).text))
  await ctx.dispose()
  return { email, name, password }
}

export const resetPhrase = 'RESET ALL DATA'
// Soft-deletes every business record. Users, dropdown values and settings stay.
export async function resetData() {
  const admin = await apiAs('admin')
  await admin.post('/data/reset', { confirm: resetPhrase })
  await admin.dispose()
}
```

Create `e2e/support/test.ts`:

```ts
import { test as base } from '@playwright/test'
import { resetData } from './api'

// Every test starts with no records. Users, dropdown values and settings stay.
export const test = base.extend<{ freshData: void }>({
  freshData: [
    async ({}, use) => {
      await resetData()
      await use()
    },
    { auto: true },
  ],
})
export { expect } from '@playwright/test'
```

- [ ] **Step 4: Write the failing smoke test**

Create `e2e/tests/smoke.spec.ts`:

```ts
import { apiAs } from '../support/api'
import { roleNames } from '../support/env'
import { expect, test } from '../support/test'

test('the API serves the web app, and each seeded user is signed in', async ({ request }) => {
  const page = await request.get('/')
  expect(page.ok()).toBe(true)
  expect(await page.text()).toContain('<div id="root"></div>')
  for (const role of roleNames) {
    const api = await apiAs(role)
    expect(api.me.user.role).toBe(role)
    await api.dispose()
  }
})
```

Run: `pnpm build && pnpm e2e`
Expected: FAIL: `./support/global-setup.ts` cannot be found.

- [ ] **Step 5: Write global setup**

Create `e2e/support/global-setup.ts`:

```ts
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { acceptInvite, apiAs } from './api'
import {
  apiDir,
  appUrl,
  authFile,
  logFile,
  pocValue,
  port,
  repo,
  runDir,
  sessionSecret,
  users,
} from './env'
import { nextEmail, tokenIn } from './mail'

const built = ['apps/web/dist/index.html', 'apps/api/dist/server.js', 'apps/api/dist/create-admin.js']

const withUser = (url: string, name: string, pw: string) => {
  const u = new URL(url)
  u.username = name
  u.password = pw
  return u.toString()
}

async function waitForReady(server: ReturnType<typeof spawn>) {
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    if (server.exitCode !== null) break
    try {
      if ((await fetch(`${appUrl}/api/v1/health/ready`)).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`The API did not start. Its log:\n${readFileSync(logFile, 'utf8').slice(-4000)}`)
}

// Postgres in Docker, migrated with the app role's grants; the built API serving the built web
// app on one origin; then one user per role, created through the real invite flow.
export default async function globalSetup() {
  for (const file of built)
    if (!existsSync(path.join(repo, file)))
      throw new Error(`${file} is missing. Run pnpm build before the end-to-end tests.`)
  mkdirSync(runDir, { recursive: true })

  const container = await new PostgreSqlContainer('postgres:17').start()
  const ownerUrl = container.getConnectionUri()
  const owner = new Client({ connectionString: ownerUrl })
  await owner.connect()
  await owner.query("CREATE ROLE boat_app LOGIN PASSWORD 'boat_app'")
  await owner.end()
  for (const args of [
    ['migrate', 'deploy'],
    ['db', 'execute', '--file', 'prisma/grants.sql'],
  ])
    execFileSync('pnpm', ['exec', 'prisma', ...args], {
      cwd: apiDir,
      env: { ...process.env, DIRECT_URL: ownerUrl },
      stdio: 'pipe',
    })

  // No RESEND_API_KEY: emails go to the log, where the tests read their links.
  const { RESEND_API_KEY: _key, MAIL_FROM: _from, ...inherited } = process.env
  const env = {
    ...inherited,
    NODE_ENV: 'test',
    PORT: String(port),
    LOG_LEVEL: 'info',
    DATABASE_URL: withUser(ownerUrl, 'boat_app', 'boat_app'),
    SESSION_SECRET: sessionSecret,
    APP_URL: appUrl,
    TRUST_PROXY: '0',
  }
  const log = openSync(logFile, 'w')
  // The repository root has no .env, so nothing overrides this environment.
  const server = spawn(process.execPath, ['apps/api/dist/server.js'], {
    cwd: repo,
    env,
    stdio: ['ignore', log, log],
  })
  await waitForReady(server)

  const created = execFileSync(
    process.execPath,
    ['apps/api/dist/create-admin.js', '--email', users.admin.email, '--name', users.admin.name],
    { cwd: repo, env, encoding: 'utf8' },
  )
  const first = await acceptInvite(tokenIn(created))
  await first.ctx.storageState({ path: authFile('admin') })
  await first.ctx.dispose()

  const admin = await apiAs('admin')
  const poc = await admin.post('/lookups', { kind: 'poc', value: pocValue })
  for (const role of ['planner', 'poc', 'viewer'] as const) {
    const { email, name } = users[role]
    await admin.post('/users', { email, name, role, pocId: role === 'poc' ? poc.id : null })
    const invited = await acceptInvite(tokenIn((await nextEmail(email, 0)).text))
    await invited.ctx.storageState({ path: authFile(role) })
    await invited.ctx.dispose()
  }
  await admin.dispose()
  writeFileSync(path.join(runDir, 'seeded.json'), JSON.stringify({ pocId: poc.id }))

  return async () => {
    server.kill()
    await container.stop()
  }
}
```

`noUnusedLocals` does not report `_key` and `_from` because they sit beside a rest element.

- [ ] **Step 6: Run the smoke test**

Run: `pnpm build && pnpm e2e`
Expected: PASS on `desktop` and `mobile` (2 passed).

- [ ] **Step 7: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add pnpm-workspace.yaml package.json .gitignore .prettierignore e2e pnpm-lock.yaml
git commit -m "Add the Playwright harness with seeded users for each role

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sign-in, invites, password reset and idle sign-out

The app asks `GET /auth/me` once at start-up and shows the sign-in screen without a session. PIN profiles, recovery keys and the first-run setup screen go. The screens themselves still read IndexedDB until later tasks switch them.

**Files:**
- Create: `apps/web/src/api/auth.ts`, `apps/web/src/api/queryClient.ts`
- Create: `apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/auth/SignIn.tsx`, `apps/web/src/auth/TokenPages.tsx`, `apps/web/src/auth/ProfileCard.tsx`, `apps/web/src/auth/ChangePassword.tsx`
- Modify: `apps/web/src/access.ts`, `apps/web/src/App.tsx`, `apps/web/src/Settings.tsx`
- Delete: `apps/web/src/Profiles.tsx`
- Create: `e2e/support/ui.ts`
- Test: `e2e/tests/auth.spec.ts`, `e2e/tests/idle.spec.ts`

**Interfaces:**
- Consumes: `api`, `setCsrfToken`, `whenSessionEnds`, `UnauthenticatedError` and `ApiError` (Task 3); `MePayload` (Task 2); `newUser`, `apiAs`, `signInApi` and the mail helpers (Task 4).
- Produces:
  - `api/auth.ts`: `fetchMe`, `login(email, password)`, `logout()`, `acceptInvite(token, password)`, `forgotPassword(email)`, `resetPassword(token, password)` and `changePassword(current, next)`.
  - `api/queryClient.ts`: `queryClient`.
  - `useAuth(): { me: MePayload | null | undefined; notice: string; signedIn(me): void; signOut(notice?): Promise<void>; showNotice(text): void }`.
  - `access.ts`: `type AccessUser = { id; name; email; role: Role; poc: string }`, `type AccessState = { user: AccessUser | null; actions: Action[] }` and `accessFrom(me: MePayload): AccessState`. `useAccess()` still returns `{ user, actions, can(action), lotAccess(lot) }`.
  - `e2e/support/ui.ts`: `signInWithForm(page, email, password)`, `openMenu(page)`, `goTo(page, screenTitle)`, `choose(scope, label, option)` and `toast(page)`.

- [ ] **Step 1: Write the UI helpers and the failing specs**

Create `e2e/support/ui.ts`:

```ts
import { expect, type Locator, type Page } from '@playwright/test'

export async function signInWithForm(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
}

// Below the lg breakpoint the sidebar, with the profile card, is a slide-out menu.
export async function openMenu(page: Page) {
  const open = page.getByRole('button', { name: 'Open navigation' })
  if (await open.isVisible()) await open.click()
}

export async function goTo(page: Page, screen: string) {
  await openMenu(page)
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: screen })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: screen })).toBeVisible()
}

// Picks an option in a SearchSelect field. Its list renders inside the same dialog.
export async function choose(scope: Page | Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click()
  await scope.getByRole('option', { name: option, exact: true }).click()
}

export const toast = (page: Page) => page.locator('[data-toast]')
```

Create `e2e/tests/auth.spec.ts`:

```ts
import { apiAs, newUser, signInApi } from '../support/api'
import { emailsTo, linkIn, nextEmail } from '../support/mail'
import { expect, test } from '../support/test'
import { openMenu, signInWithForm, toast } from '../support/ui'

test('FR-10.2 signs in with email and password, and out again', async ({ page }) => {
  const user = await newUser('planner')
  await signInWithForm(page, user.email, user.password)
  await openMenu(page)
  await expect(page.getByText(user.name)).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('FR-10.2 shows the server message for a wrong password', async ({ page }) => {
  const user = await newUser('viewer')
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('not the password at all')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible()
})

test('FR-10.1 accepts an invite from the emailed link, once', async ({ page }) => {
  const admin = await apiAs('admin')
  const email = `invitee-${Date.now().toString(36)}@e2e.test`
  await admin.post('/users', { email, name: 'Ivy Invitee', role: 'viewer', pocId: null })
  await admin.dispose()
  const link = linkIn((await nextEmail(email, 0)).text)
  await page.goto(link)
  // The token leaves the address bar as soon as the page has read it.
  await expect(page).toHaveURL(/\/invite$/)
  await page.getByLabel('New password', { exact: true }).fill('a brand new password')
  await page.getByLabel('Confirm password', { exact: true }).fill('a brand new password')
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)

  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill('another new password')
  await page.getByLabel('Confirm password', { exact: true }).fill('another new password')
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(
    page.getByText('This invite link has expired or was already used. Ask an admin to send a new one.'),
  ).toBeVisible()
})

test('FR-10.2 resets a forgotten password from the emailed link', async ({ page }) => {
  const user = await newUser('viewer')
  await page.goto('/')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  const seen = emailsTo(user.email).length
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(
    page.getByText('If that email belongs to an active account, a reset link is on its way.'),
  ).toBeVisible()
  await page.goto(linkIn((await nextEmail(user.email, seen)).text))
  await expect(page).toHaveURL(/\/reset-password$/)
  await page.getByLabel('New password', { exact: true }).fill('a reset password here')
  await page.getByLabel('Confirm password', { exact: true }).fill('a reset password here')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible()
  await signInWithForm(page, user.email, 'a reset password here')
})

test('FR-10.2 changes your own password and keeps you signed in', async ({ page }) => {
  const user = await newUser('planner')
  await signInWithForm(page, user.email, user.password)
  await openMenu(page)
  await page.getByRole('button', { name: 'Change password' }).click()
  const dialog = page.getByRole('dialog', { name: 'Change password' })
  await dialog.getByLabel('Current password', { exact: true }).fill('wrong current password')
  await dialog.getByLabel('New password', { exact: true }).fill('a changed password')
  await dialog.getByLabel('Confirm password', { exact: true }).fill('a changed password')
  await dialog.getByRole('button', { name: 'Save password' }).click()
  await expect(dialog.getByText('That is not your current password.')).toBeVisible()
  await dialog.getByLabel('Current password', { exact: true }).fill(user.password)
  await dialog.getByRole('button', { name: 'Save password' }).click()
  await expect(toast(page)).toContainText('Password changed.')
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
  await (await signInApi(user.email, 'a changed password')).dispose()
})
```

Create `e2e/tests/idle.spec.ts`:

```ts
import { newUser } from '../support/api'
import { expect, test } from '../support/test'
import { signInWithForm } from '../support/ui'

// Each test signs in a user of its own: idle sign-out ends the session it signed in with.
test('FR-10.2 signs out after the idle timeout', async ({ page }) => {
  const user = await newUser('viewer')
  await page.clock.install()
  await signInWithForm(page, user.email, user.password)
  await page.clock.fastForward('16:00')
  await expect(page.getByText('Signed out after 15 minutes without activity.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('FR-10.2 keeps you signed in while you are active', async ({ page }) => {
  const user = await newUser('viewer')
  await page.clock.install()
  await signInWithForm(page, user.email, user.password)
  await page.clock.fastForward('10:00')
  await page.keyboard.press('Shift')
  await page.clock.fastForward('10:00')
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm build && pnpm e2e -- auth.spec.ts idle.spec.ts`
Expected: FAIL: the app shows the IndexedDB start screen ("Your app starts here."), with no Email field.

- [ ] **Step 3: Write the auth endpoints and the query client**

Create `apps/web/src/api/auth.ts`:

```ts
import type { MePayload } from '@boat/domain/api'
import { api } from './client'

// All but changePassword are public: a 401 from them is an answer, not a session that ended.
const open = { public: true }
export const fetchMe = () => api.get<MePayload>('/auth/me', open)
export const login = (email: string, password: string) =>
  api.post<MePayload>('/auth/login', { email, password }, open)
export const logout = () => api.post<void>('/auth/logout', undefined, open)
export const acceptInvite = (token: string, password: string) =>
  api.post<MePayload>('/auth/invites/accept', { token, password }, open)
export const forgotPassword = (email: string) =>
  api.post<{ message: string }>('/auth/password/forgot', { email }, open)
export const resetPassword = (token: string, password: string) =>
  api.post<void>('/auth/password/reset', { token, password }, open)
// Starts a new session (with a new CSRF token) and ends the user's others.
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.patch<MePayload>('/auth/me/password', { currentPassword, newPassword })
```

Create `apps/web/src/api/queryClient.ts`:

```ts
import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'

// A 4xx won't change on retry, so it fails at once; network and server errors retry twice.
// Data refetches when the window regains focus, which shows other users' changes without polling.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})
```

- [ ] **Step 4: Write the auth provider and screens**

Create `apps/web/src/auth/AuthProvider.tsx`:

```tsx
import type { MePayload } from '@boat/domain/api'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { fetchMe, logout } from '../api/auth'
import { setCsrfToken, UnauthenticatedError, whenSessionEnds } from '../api/client'
import { queryClient } from '../api/queryClient'

type Auth = {
  // undefined while the start-up check runs; null when signed out.
  me: MePayload | null | undefined
  // Shown on the sign-in screen: why the user was signed out, or what to do next.
  notice: string
  signedIn(me: MePayload): void
  signOut(notice?: string): Promise<void>
  showNotice(notice: string): void
}
const AuthContext = createContext<Auth | null>(null)
export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth needs an AuthProvider.')
  return auth
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MePayload | null | undefined>(undefined)
  const [notice, setNotice] = useState('')
  const signedIn = useCallback((payload: MePayload) => {
    setCsrfToken(payload.csrfToken)
    setNotice('')
    setMe(payload)
  }, [])
  // Drops everything the last user could see, so the next one starts clean.
  const signedOut = useCallback((message: string) => {
    setCsrfToken('')
    queryClient.clear()
    setNotice(message)
    setMe(null)
  }, [])
  useEffect(() => {
    whenSessionEnds(() => signedOut('Your session ended. Sign in again.'))
    // The app's only /auth/me call. Every request with a session moves its idle timer, so
    // polling this would keep sessions alive forever.
    fetchMe().then(signedIn, (err: unknown) =>
      signedOut(err instanceof UnauthenticatedError || !(err instanceof Error) ? '' : err.message),
    )
  }, [signedIn, signedOut])
  const signOut = useCallback(
    async (message = '') => {
      // A session that already ended is signed out either way.
      await logout().catch(() => undefined)
      signedOut(message)
    },
    [signedOut],
  )
  const value = useMemo(
    () => ({ me, notice, signedIn, signOut, showNotice: setNotice }),
    [me, notice, signedIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
```

Create `apps/web/src/auth/SignIn.tsx`:

```tsx
import { Box } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { forgotPassword, login } from '../api/auth'
import { Button, Card, Field, FormError, Input, useFormErrors } from '../ui'
import { useAuth } from './AuthProvider'

// The frame of every screen a signed-out user sees.
export function AuthCard({
  title,
  intro,
  children,
}: {
  title: string
  intro: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#edf2f1] p-5">
      <Card className="w-full max-w-md overflow-hidden">
        <div className="bg-[#123b3e] p-7 text-white">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#d96d35]">
            <Box size={23} />
          </div>
          <div className="text-xs font-bold uppercase tracking-[.22em] text-teal-200">
            BOAT · Supply chain
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-teal-100">{intro}</p>
        </div>
        <div className="p-6">{children}</div>
      </Card>
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mb-4 rounded-xl bg-teal-50 px-3 py-2.5 text-sm text-teal-800">
      {children}
    </p>
  )
}

export function SignIn() {
  const auth = useAuth()
  const [forgot, setForgot] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [sent, setSent] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (forgot) setSent((await forgotPassword(email)).message)
      else auth.signedIn(await login(email, password))
    } catch (err) {
      form.fail(err)
    } finally {
      setBusy(false)
    }
  }
  const toggle = () => {
    setForgot(!forgot)
    setSent('')
    form.reset()
  }
  return (
    <AuthCard
      title={forgot ? 'Reset your password' : 'Sign in'}
      intro={
        forgot
          ? "Enter your email address and we'll send a link to choose a new password."
          : 'Use the email address your admin invited.'
      }
    >
      {auth.notice && <Notice>{auth.notice}</Notice>}
      {sent ? (
        <div className="space-y-4">
          <Notice>{sent}</Notice>
          <Button variant="secondary" className="w-full" onClick={toggle}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormError message={form.errors.form} />
          <Field label="Email" error={form.errors.email}>
            <Input
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                form.clear('email')
              }}
            />
          </Field>
          {!forgot && (
            <Field label="Password" error={form.errors.password}>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  form.clear('password')
                }}
              />
            </Field>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {forgot ? 'Send reset link' : 'Sign in'}
          </Button>
          <button
            type="button"
            onClick={toggle}
            className="w-full text-center text-xs font-semibold text-teal-800 hover:underline"
          >
            {forgot ? 'Back to sign in' : 'Forgot password?'}
          </button>
        </form>
      )}
    </AuthCard>
  )
}
```

Create `apps/web/src/auth/TokenPages.tsx`:

```tsx
import { fieldErrors, validatePassword } from '@boat/domain/validation'
import { type FormEvent, useEffect, useState } from 'react'
import { acceptInvite, resetPassword } from '../api/auth'
import { Button, Field, FormError, Input, useFormErrors } from '../ui'
import { useAuth } from './AuthProvider'
import { AuthCard } from './SignIn'

// Emailed links carry the token after #, so it never reaches server logs. The page reads it once,
// then clears it from the address bar so it isn't kept in history or shared by copying the URL.
function useFragmentToken() {
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '')
  useEffect(() => {
    history.replaceState(null, '', location.pathname)
  }, [])
  return token
}

function PasswordForm({
  submitLabel,
  onSubmit,
  onBack,
}: {
  submitLabel: string
  onSubmit: (password: string) => Promise<void>
  onBack: () => void
}) {
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found = validatePassword(password)
    if (!found.password && password !== confirm) found.confirm = 'The two passwords do not match.'
    if (!form.check(found) || busy) return
    setBusy(true)
    try {
      await onSubmit(password)
    } catch (err) {
      // An expired or used link comes back as a token error; it belongs above the form.
      const fields = fieldErrors(err)
      form.fail(fields.token ? new Error(fields.token) : err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError message={form.errors.form} />
      <Field label="New password" help="At least 12 characters." error={form.errors.password}>
        <Input
          type="password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            form.clear('password')
          }}
        />
      </Field>
      <Field label="Confirm password" error={form.errors.confirm}>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            form.clear('confirm')
          }}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>
        {submitLabel}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="w-full text-center text-xs font-semibold text-teal-800 hover:underline"
      >
        Back to sign in
      </button>
    </form>
  )
}

function MissingToken({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <FormError message="This link is incomplete. Open it again from the email." />
      <Button variant="secondary" className="w-full" onClick={onBack}>
        Go to sign in
      </Button>
    </div>
  )
}

// Accepting an invite starts a session, so the user lands in the app.
export function AcceptInvite({ onDone }: { onDone: () => void }) {
  const auth = useAuth(),
    token = useFragmentToken()
  return (
    <AuthCard title="Welcome to BOAT" intro="Choose a password to finish setting up your account.">
      {token ? (
        <PasswordForm
          submitLabel="Set password"
          onBack={onDone}
          onSubmit={async (password) => {
            auth.signedIn(await acceptInvite(token, password))
            onDone()
          }}
        />
      ) : (
        <MissingToken onBack={onDone} />
      )}
    </AuthCard>
  )
}

// A reset doesn't start a session; the user signs in with the new password.
export function ResetPassword({ onDone }: { onDone: () => void }) {
  const auth = useAuth(),
    token = useFragmentToken()
  return (
    <AuthCard title="Choose a new password" intro="The link in your email works once, for an hour.">
      {token ? (
        <PasswordForm
          submitLabel="Change password"
          onBack={onDone}
          onSubmit={async (password) => {
            await resetPassword(token, password)
            auth.showNotice('Password changed. Sign in with your new password.')
            onDone()
          }}
        />
      ) : (
        <MissingToken onBack={onDone} />
      )}
    </AuthCard>
  )
}
```

Create `apps/web/src/auth/ProfileCard.tsx`:

```tsx
import { roleInfo } from '@boat/domain/permissions'
import { UserRound } from 'lucide-react'
import { useAuth } from './AuthProvider'

export function ProfileCard({ onChangePassword }: { onChangePassword: () => void }) {
  const auth = useAuth(),
    user = auth.me?.user
  if (!user) return null
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
          <UserRound size={15} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-bold">{user.name}</div>
          <div className="truncate text-[11px] text-teal-100/70">
            {user.role === 'poc'
              ? `POC · ${user.poc?.value ?? 'not linked'}`
              : roleInfo[user.role].label}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void auth.signOut()}
          className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold hover:bg-white/15"
        >
          Sign out
        </button>
        <button
          onClick={onChangePassword}
          className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold hover:bg-white/15"
        >
          Change password
        </button>
      </div>
    </div>
  )
}
```

Create `apps/web/src/auth/ChangePassword.tsx`:

```tsx
import { validatePassword } from '@boat/domain/validation'
import { type FormEvent, useState } from 'react'
import { changePassword } from '../api/auth'
import { Button, Field, FormError, Input, Modal, useFormErrors } from '../ui'
import { useAuth } from './AuthProvider'

export function ChangePassword({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const auth = useAuth()
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  const close = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
    form.reset()
    onClose()
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found = validatePassword(next, 'newPassword')
    if (!current) found.currentPassword = 'Enter your current password.'
    if (!found.newPassword && next !== confirm) found.confirm = 'The two passwords do not match.'
    if (!form.check(found) || busy) return
    setBusy(true)
    try {
      // The server starts a new session with a new CSRF token and ends the user's others.
      auth.signedIn(await changePassword(current, next))
      close()
      onDone()
    } catch (err) {
      form.fail(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onOpenChange={(v) => !v && close()} title="Change password">
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormError message={form.errors.form} />
        <Field label="Current password" error={form.errors.currentPassword}>
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value)
              form.clear('currentPassword')
            }}
          />
        </Field>
        <Field label="New password" help="At least 12 characters." error={form.errors.newPassword}>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value)
              form.clear('newPassword')
            }}
          />
        </Field>
        <Field label="Confirm password" error={form.errors.confirm}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value)
              form.clear('confirm')
            }}
          />
        </Field>
        <p className="text-xs text-slate-500">You stay signed in here; other devices sign out.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save password
          </Button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 5: Point the access helpers at the signed-in user**

In `apps/web/src/access.ts`, replace everything from `// UI role modes.` down to the end of `useAccess()` with:

```ts
// The signed-in user and what their role allows, from GET /auth/me. Hiding controls is a
// convenience: the API checks every request itself.
export type AccessUser = { id: string; name: string; email: string; role: Role; poc: string }
export type AccessState = { user: AccessUser | null; actions: Action[] }
const signedOut: AccessState = { user: null, actions: [] }
export const accessFrom = (me: MePayload): AccessState => ({
  user: {
    id: me.user.id,
    name: me.user.name,
    email: me.user.email,
    role: me.user.role,
    poc: me.user.poc?.value ?? '',
  },
  actions: me.allowedActions,
})

// repository.ts reads this state until Task 11 removes it with IndexedDB.
let current = signedOut
export const setAccess = (state: AccessState) => {
  current = state
}
export const actorName = () => current.user?.name

export function can(action: Action, state = current) {
  return state.actions.includes(action)
}
export function lotAccess(lot: Pick<Lot, 'poc'>, state = current): LotAccess {
  return actorLotAccess(state.user, lot)
}

const denied = (what: string) =>
  new PermissionError(deniedMessage(current.user?.role ?? null, what))
export function requireAction(action: Action) {
  if (!can(action)) throw denied(actionVerbs[action])
}
export function requireLotEdit(lot: Lot, next?: Lot) {
  const what = lotEditDenial(current.user, lot, next)
  if (what) throw denied(what)
}

export const AccessContext = createContext<AccessState>(signedOut)
export function useAccess() {
  const state = useContext(AccessContext)
  return {
    ...state,
    can: (action: Action) => can(action, state),
    lotAccess: (lot: Pick<Lot, 'poc'>) => lotAccess(lot, state),
  }
}
```

Update the imports at the top of the file: drop `roleCan` and `UserProfile`, and add `import type { MePayload } from '@boat/domain/api'` and `Role` to the type import from `./models`. Keep every PIN and session-storage helper below (`validatePin`, `newSalt`, `hashSecret`, `newRecoveryKey`, `normalizeRecoveryKey`, `storedSession`, `storeSession`): `repository.ts` and `validation.ts` still import them until Task 11.

- [ ] **Step 6: Gate the app on a session**

In `apps/web/src/App.tsx`:

1. Replace the imports of `./Profiles` and of `AccessContext, can, setAccess, storedSession, storeSession` from `./access` with:

```tsx
import type { MePayload } from '@boat/domain/api'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './api/queryClient'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ChangePassword } from './auth/ChangePassword'
import { ProfileCard } from './auth/ProfileCard'
import { SignIn } from './auth/SignIn'
import { AcceptInvite, ResetPassword } from './auth/TokenPages'
import { AccessContext, accessFrom, can, setAccess } from './access'
```

Remove `initialize` from the `./repository` import and `Database` from the `lucide-react` import.

2. Add, above `export default function App()`:

```tsx
function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f7f6]">
      <div className="flex items-center gap-3 text-sm font-semibold text-[#173b3d]">
        <Activity className="animate-pulse text-[#d96d35]" /> Loading...
      </div>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </QueryClientProvider>
  )
}

// The invite and reset pages are chosen by path; everything else needs a session.
function Root() {
  const auth = useAuth()
  const [path, setPath] = useState(location.pathname)
  const home = () => {
    history.replaceState(null, '', '/')
    setPath('/')
  }
  if (path === '/invite') return <AcceptInvite onDone={home} />
  if (path === '/reset-password') return <ResetPassword onDone={home} />
  if (auth.me === undefined) return <Loading />
  if (!auth.me) return <SignIn />
  // A new key per user, so nothing from the last user's screens survives.
  return <Workspace key={auth.me.user.id} me={auth.me} />
}
```

3. Rename the old `export default function App()` to `function Workspace({ me }: { me: MePayload })`. At its top, replace the lines from `const users = useLiveQuery(...)` through the end of the idle-lock `useEffect` with:

```tsx
  const auth = useAuth()
  const [passwordOpen, setPasswordOpen] = useState(false)
```

followed by the existing `dbError`, `screen`, `menuOpen`, `selectedLot` … `productForm` state lines unchanged, and then:

```tsx
  const access = useMemo(() => accessFrom(me), [me])
  setAccess(access)
  // Idle sign-out: no pointer or key activity for the workspace's idle timeout ends the session.
  const idleMinutes = me.idleTimeoutMinutes
  useEffect(() => {
    let last = Date.now()
    const touch = () => {
      last = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - last > idleMinutes * 60_000)
        void auth.signOut(`Signed out after ${idleMinutes} minutes without activity.`)
    }, 15_000)
    return () => {
      events.forEach((name) => window.removeEventListener(name, touch))
      clearInterval(timer)
    }
  }, [idleMinutes, auth.signOut])
```

Keep `const data = useLiveQuery(getData, [])` and the `db.open()` effect; the screens still read IndexedDB.

4. Delete the `signIn` and `lock` functions, the `if (!data || !users)` block (replace it with `if (!data) return <Loading />`), the `if (enabled && !user)` block and the whole `if (!initialized)` block, along with `const initialized = …`.

5. Replace the `<ProfileCard … />` element with:

```tsx
              <ProfileCard
                onChangePassword={() => {
                  setPasswordOpen(true)
                  setMenuOpen(false)
                }}
              />
```

6. Replace the `{user && (<ChangePinModal … />)}` block with:

```tsx
        <ChangePassword
          open={passwordOpen}
          onClose={() => setPasswordOpen(false)}
          onDone={() => {
            setSaveState('idle')
            setMessage('Password changed.')
          }}
        />
```

7. Remove the `users`, `lockMinutes` and `onSignIn` props from `<Settings … />`.

In `apps/web/src/Settings.tsx`, remove the `RolesCard` import and its element, the `users`, `lockMinutes` and `onSignIn` props and their types, and `UserProfile` from the `./models` import. Task 10 puts the user list and the idle timeout in their place.

Delete `apps/web/src/Profiles.tsx`.

- [ ] **Step 7: Run the specs and every check**

Run: `pnpm typecheck && pnpm --filter @boat/web test && pnpm build && pnpm e2e`
Expected: all pass, `auth.spec.ts` and `idle.spec.ts` on both projects.

- [ ] **Step 8: Format and commit**

```bash
pnpm format
git add apps/web e2e
git commit -m "Sign in with email and password instead of PIN profiles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Products and the Production list on the API

The product editor, the summary cards, the grouped and flat lot lists, the filters and the lots CSV read and write through the API. The lot drawer still reads IndexedDB until Task 7, so clicking a lot does nothing in between.

**Files:**
- Create: `apps/web/src/api/lookups.ts`, `apps/web/src/api/products.ts`, `apps/web/src/api/lots.ts`, `apps/web/src/api/queries.ts`, `apps/web/src/drafts.ts`
- Modify: `apps/web/src/ui.tsx` (`Pager`, `ConflictBanner`, `CsvExport`)
- Replace: `apps/web/src/Production.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/MonthEnd.tsx`, `apps/web/src/Shipments.tsx` (the `csvRef` type only)
- Create: `e2e/support/seed.ts`
- Test: `e2e/tests/products.spec.ts`, `e2e/tests/filters.spec.ts`; modify `e2e/tests/auth.spec.ts`

**Interfaces:**
- Consumes: `api`, `download`, `queryString`, `ConflictError` (Task 3); the mappers (Task 3); `queryClient` (Task 5); `GET /lots/groups`, `/lots/summary`, `productId` (Task 1).
- Produces:
  - `api/lots.ts`: `type LotQuery = { view: 'active' | 'completed'; q: string; productId?; segmentId?; categoryId?; emsId?; pocId?; statusId?; stageId?; logisticsId?; blockerId?: string; flag: LotFlag[]; sort: LotSort }`, `lotPageSize` (50), `listLots(query, page, pageSize?)` (items mapped with `toLot`), `fetchLotGroups(query)`, `fetchLotSummary()` and `downloadLotsCsv(query)`.
  - `api/products.ts`: `listProducts()`, `saveProduct(product: Product & { version?: number }, lookups)` (POST without a version, PATCH with one) and `deleteProduct(id)`.
  - `api/lookups.ts`: `listLookups()`.
  - `api/queries.ts`: `keys`, `useLookups()`, `useProducts()`, `useLotSummary()`, `useLotGroups(query)`, `useLots(query, page, pageSize?, enabled?)`, `useCompletedCount()`, `refreshLots()`, `refreshProducts()`, `refreshShipments()` and `refreshEverything()`.
  - `drafts.ts`: `defaultValue(lookups, kind, preferred)` and `newProduct(lookups)`.
  - `ui.tsx`: `Pager({ page, pageSize, total, onPage })`, `ConflictBanner({ record, onReload, onDismiss })` and `type CsvExport = () => boolean | Promise<boolean>`.
  - `e2e/support/seed.ts`: `day(offset?)`, the company date (Asia/Kolkata) plus whole days; `seeder()`, which returns `{ lookup, product, lot, receipt, batch, done }`.
  - Each product group in Production has `role="group"` and `aria-label` set to the product name, plus ` <variant>` when it has a variant.

- [ ] **Step 1: Write the seed helper and the failing specs**

Create `e2e/support/seed.ts`:

```ts
import type { LotInput, LookupItem, ProductItem } from '@boat/domain/api'
import type { LookupKind } from '@boat/domain/models'
import { apiAs } from './api'

// The company's date in its default time zone, offset by whole days.
export function day(offset = 0) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

type LotFields = Partial<
  Omit<
    LotInput,
    | 'productId'
    | 'label'
    | 'categoryId'
    | 'statusId'
    | 'stageId'
    | 'pocId'
    | 'emsId'
    | 'blockerId'
    | 'logisticsId'
    | 'componentIds'
  >
> & {
  category?: string
  status?: string
  stage?: string
  poc?: string
  ems?: string
  blocker?: string
  logistics?: string
  components?: string[]
}

// Seeds records through the API as the admin. Dropdown values survive resets, so they are found
// by text or created.
export async function seeder() {
  const api = await apiAs('admin')
  const lookups: LookupItem[] = (await api.get('/lookups')).items
  const lookup = async (kind: LookupKind, value: string) => {
    const found = lookups.find(
      (l) => l.kind === kind && l.value.toLowerCase() === value.toLowerCase(),
    )
    if (found) return found.id
    const created: LookupItem = await api.post('/lookups', { kind, value })
    lookups.push(created)
    return created.id
  }
  const optional = async (kind: LookupKind, value?: string) =>
    value ? lookup(kind, value) : null
  return {
    api,
    lookup,
    product: async (
      name: string,
      fields: { variant?: string; segment?: string } = {},
    ): Promise<ProductItem> =>
      api.post('/products', {
        name,
        variant: fields.variant ?? '',
        segmentId: await lookup('segment', fields.segment ?? 'PA / TWS'),
      }),
    lot: async (productId: string, label: string, fields: LotFields = {}) => {
      const {
        category = 'BAU',
        status = 'On Track',
        stage = 'RM Sourcing',
        poc,
        ems,
        blocker,
        logistics,
        components = [],
        ...rest
      } = fields
      const componentIds: string[] = []
      for (const c of components) componentIds.push(await lookup('component', c))
      return api.post('/lots', {
        productId,
        label,
        lotQty: 100,
        ...rest,
        categoryId: await lookup('category', category),
        statusId: await lookup('status', status),
        stageId: await lookup('stage', stage),
        pocId: await optional('poc', poc),
        emsId: await optional('ems', ems),
        blockerId: await optional('blocker', blocker),
        logisticsId: await optional('logistics', logistics),
        componentIds,
      })
    },
    receipt: (lotId: string, quantity: number, date = day(), label = `GRN ${quantity}`) =>
      api.post(`/lots/${lotId}/grn-receipts`, { label, date, quantity }),
    batch: async (
      lotId: string,
      component: string,
      fields: { label?: string; plannedQty?: number; receivedQty?: number; receivedDate?: string } = {},
    ) =>
      api.post(`/lots/${lotId}/rm-batches`, {
        componentId: await lookup('component', component),
        label: fields.label ?? `${component} batch`,
        plannedQty: fields.plannedQty ?? 0,
        receivedQty: fields.receivedQty ?? 0,
        receivedDate: fields.receivedDate ?? null,
      }),
    done: () => api.dispose(),
  }
}
```

Create `e2e/tests/products.spec.ts`:

```ts
import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { choose, toast } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('FR-1.1 adds, renames and deletes a product', async ({ page }) => {
  const seed = await seeder()
  await seed.lookup('segment', 'Soundbars')
  await seed.done()
  await page.goto('/')
  const list = page.getByRole('main')
  await page.getByRole('button', { name: 'Add Product' }).click()
  const add = page.getByRole('dialog', { name: 'Add product' })
  await add.getByLabel('Product name', { exact: true }).fill('CinemaBar 420')
  await add.getByLabel('Variant', { exact: true }).fill('Matte Black')
  await choose(add, 'Segment', 'Soundbars')
  await add.getByRole('button', { name: 'Save product' }).click()
  await expect(toast(page)).toContainText('Product CinemaBar 420 saved.')
  const group = list.getByRole('group', { name: 'CinemaBar 420 Matte Black' })
  await expect(group).toContainText('Soundbars · 0 lots')

  await group.getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit product' })
  await edit.getByLabel('Product name', { exact: true }).fill('CinemaBar 520')
  await edit.getByRole('button', { name: 'Save product' }).click()
  await expect(list.getByRole('group', { name: 'CinemaBar 520 Matte Black' })).toBeVisible()

  await list.getByRole('group', { name: 'CinemaBar 520 Matte Black' }).getByRole('button', { name: 'Edit' }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete product' }).click()
  await expect(list.getByText('No products yet')).toBeVisible()
})

test('FR-1.1 shows a duplicate product under its name', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Echo', { variant: 'Black' })
  await seed.done()
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Product' }).click()
  const add = page.getByRole('dialog', { name: 'Add product' })
  await add.getByLabel('Product name', { exact: true }).fill('echo')
  await add.getByLabel('Variant', { exact: true }).fill('black')
  await add.getByRole('button', { name: 'Save product' }).click()
  await expect(add.getByRole('alert')).toContainText('already exists. Use a different name or variant.')
})

test('FR-1.1 shows the conflict banner when someone else saved the product first', async ({ page }) => {
  const seed = await seeder()
  const product = await seed.product('Foxtrot')
  await page.goto('/')
  await page.getByRole('group', { name: 'Foxtrot' }).getByRole('button', { name: 'Edit' }).click()
  await seed.api.patch(`/products/${product.id}`, { variant: 'Blue', version: product.version })
  await seed.done()
  const edit = page.getByRole('dialog', { name: 'Edit product' })
  await edit.getByLabel('Product name', { exact: true }).fill('Foxtrot Pro')
  await edit.getByRole('button', { name: 'Save product' }).click()
  await expect(edit.getByRole('alert')).toContainText(
    'Someone else changed this product while you were editing.',
  )
  await edit.getByRole('button', { name: 'Reload' }).click()
  await expect(edit.getByLabel('Product name', { exact: true })).toHaveValue('Foxtrot')
  await expect(edit.getByLabel('Variant', { exact: true })).toHaveValue('Blue')
})
```

Create `e2e/tests/filters.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo } from '../support/ui'

test.use({ storageState: authFile('admin') })

// Lot labels render in a table on desktop and in cards on mobile; only one of them is visible.
const lot = (page: Page, label: string) =>
  page.getByRole('main').getByText(label, { exact: true }).filter({ visible: true })

async function seedThree() {
  const seed = await seeder()
  const alpha = await seed.product('Alpha')
  const bravo = await seed.product('Bravo', { segment: 'Soundbars' })
  await seed.product('Charlie')
  await seed.lot(alpha.id, 'A-overdue', { plannedDate: day(-2) })
  await seed.lot(alpha.id, 'A-delayed', { status: 'Delayed', plannedDate: day(10) })
  const soon = await seed.lot(bravo.id, 'B-soon', { plannedDate: day(1), lotQty: 200 })
  await seed.receipt(soon.id, 50)
  await seed.done()
}

test('FR-2.5 groups lots under their products with totals', async ({ page }) => {
  await seedThree()
  await page.goto('/')
  const alpha = page.getByRole('group', { name: 'Alpha' })
  await expect(alpha).toContainText('2 lots · 1 delayed')
  await expect(page.getByRole('group', { name: 'Bravo' })).toContainText(/Qty\s*200/)
  await expect(page.getByRole('group', { name: 'Bravo' })).toContainText(/GRN\s*50/)
  await expect(page.getByRole('group', { name: 'Bravo' })).toContainText(/Balance\s*150/)
  await expect(page.getByRole('group', { name: 'Charlie' })).toContainText('0 lots')
  await alpha.getByRole('button', { expanded: false }).click()
  await expect(lot(page, 'A-overdue')).toBeVisible()
  await expect(lot(page, 'A-delayed')).toBeVisible()
})

test('FR-2.6 cards count active lots and filter the list', async ({ page }) => {
  await seedThree()
  await page.goto('/')
  const overdue = page.getByRole('button', { name: /^Overdue/ })
  await expect(overdue).toContainText('1')
  await expect(page.getByRole('button', { name: /^Due Soon/ })).toContainText('1')
  await overdue.click()
  await expect(lot(page, 'A-overdue')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Bravo' })).toHaveCount(0)
  await overdue.click()
  await expect(page.getByRole('group', { name: 'Bravo' })).toBeVisible()
})

test('FR-2.5 filters by status, searches, and clears', async ({ page }) => {
  await seedThree()
  await page.goto('/')
  await page.getByRole('button', { name: 'Filters' }).click()
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption({ label: 'Delayed' })
  await expect(lot(page, 'A-delayed')).toBeVisible()
  await expect(lot(page, 'A-overdue')).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Charlie' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear filters' }).first().click()
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill('brav')
  await expect(page.getByRole('group', { name: 'Bravo' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Alpha' })).toHaveCount(0)
})

test('FR-2.5 the flat view pages, and a new filter returns to the first page', async ({ page }) => {
  const seed = await seeder()
  const delta = await seed.product('Delta')
  for (let i = 1; i <= 55; i++)
    await seed.lot(delta.id, `L${String(i).padStart(2, '0')}`, { plannedDate: day(5) })
  await seed.done()
  await page.goto('/')
  await page.getByRole('button', { name: 'Grouped by product' }).click()
  await page.getByRole('combobox', { name: 'Sort lots' }).selectOption('label-asc')
  await expect(page.getByText('1–50 of 55')).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('51–55 of 55')).toBeVisible()
  await expect(lot(page, 'L55')).toBeVisible()
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill('L5')
  await expect(lot(page, 'L50')).toBeVisible()
  await expect(lot(page, 'L05')).toBeVisible()
})

test('FR-2.5 downloads the CSV of the current view, and says when it is empty', async ({ page }) => {
  await seedThree()
  await page.goto('/')
  await page.getByRole('button', { name: 'Filters' }).click()
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption({ label: 'Delayed' })
  await expect(lot(page, 'A-overdue')).toHaveCount(0)
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^active-lots-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = readFileSync(await file.path(), 'utf8')
  expect(csv).toContain('A-delayed')
  expect(csv).not.toContain('B-soon')
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill('nothing like this')
  await expect(page.getByText('No matching lots')).toBeVisible()
  await page.getByRole('button', { name: 'CSV' }).click()
  await expect(page.getByText('Nothing to export: the current view has no rows.')).toBeVisible()
})

test('FR-2.5 lists fully received lots under Completed', async ({ page }) => {
  const seed = await seeder()
  const echo = await seed.product('Echo')
  const done = await seed.lot(echo.id, 'E-done', { lotQty: 30, plannedDate: day(-5) })
  await seed.receipt(done.id, 30)
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Completed')
  await expect(page.getByRole('group', { name: 'Echo' })).toContainText('1 lots · completed')
})
```

Append to `e2e/tests/auth.spec.ts`:

```ts
test('returns to sign-in when the session ends', async ({ page }) => {
  const user = await newUser('viewer')
  await signInWithForm(page, user.email, user.password)
  // Changing the password elsewhere ends the user's other sessions, including this page's.
  const other = await signInApi(user.email, user.password)
  await other.patch('/auth/me/password', {
    currentPassword: user.password,
    newPassword: 'a password set elsewhere',
  })
  await other.dispose()
  await page.getByRole('combobox', { name: 'Sort lots' }).selectOption('qty-desc')
  await expect(page.getByText('Your session ended. Sign in again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm build && pnpm e2e -- products.spec.ts filters.spec.ts auth.spec.ts`
Expected: FAIL: products saved through the API never appear (the list reads IndexedDB), and the session test stays signed in because nothing asks the API.

- [ ] **Step 3: Write the reads and writes**

Create `apps/web/src/api/lookups.ts`:

```ts
import type { LookupItem } from '@boat/domain/api'
import { api } from './client'

export const listLookups = () => api.get<{ items: LookupItem[] }>('/lookups').then((r) => r.items)
```

Create `apps/web/src/api/products.ts`:

```ts
import type { LookupItem, ProductItem } from '@boat/domain/api'
import type { Product } from '@boat/domain/models'
import { api } from './client'
import { productField, productInput, toProduct } from './mappers'

export const listProducts = () =>
  api.get<{ items: ProductItem[] }>('/products').then((r) => r.items.map(toProduct))

// A product without a version is new; with one, it is an edit the server checks for conflicts.
export function saveProduct(product: Product & { version?: number }, lookups: LookupItem[]) {
  const input = productInput(product, lookups)
  const options = { fields: productField }
  return product.version === undefined
    ? api.post<ProductItem>('/products', input, options)
    : api.patch<ProductItem>(
        `/products/${product.id}`,
        { ...input, version: product.version },
        options,
      )
}
export const deleteProduct = (id: string) => api.delete(`/products/${id}`)
```

Create `apps/web/src/api/lots.ts`:

```ts
import type { LotCards, LotFlag, LotGroup, LotItem, LotSort, Page } from '@boat/domain/api'
import { api, download, queryString } from './client'
import { toLot } from './mappers'

// GET /lots, /lots/groups and /lots/export.csv take the same filters.
export type LotQuery = {
  view: 'active' | 'completed'
  q: string
  productId?: string
  segmentId?: string
  categoryId?: string
  emsId?: string
  pocId?: string
  statusId?: string
  stageId?: string
  logisticsId?: string
  blockerId?: string
  flag: LotFlag[]
  sort: LotSort
}
export const lotPageSize = 50

export async function listLots(query: LotQuery, page: number, pageSize = lotPageSize) {
  const res = await api.get<Page<LotItem>>(`/lots${queryString({ ...query, page, pageSize })}`)
  return { ...res, items: res.items.map(toLot) }
}
export const fetchLotGroups = (query: LotQuery) =>
  api.get<{ items: LotGroup[] }>(`/lots/groups${queryString(query)}`).then((r) => r.items)
export const fetchLotSummary = () => api.get<LotCards>('/lots/summary')
export const downloadLotsCsv = (query: LotQuery) => download(`/lots/export.csv${queryString(query)}`)
```

Create `apps/web/src/api/queries.ts`:

```ts
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { listLookups } from './lookups'
import { fetchLotGroups, fetchLotSummary, listLots, type LotQuery, lotPageSize } from './lots'
import { listProducts } from './products'
import { queryClient } from './queryClient'

// Query keys by area. A write invalidates whole areas, so every view of them refetches.
export const keys = {
  lookups: ['lookups'],
  products: ['products'],
  lots: ['lots'],
  monthEnd: ['month-end'],
  shipments: ['shipments'],
  settings: ['settings'],
  users: ['users'],
} as const

// Dropdown values change only in Settings, which refreshes them itself.
export const useLookups = () =>
  useQuery({ queryKey: keys.lookups, queryFn: listLookups, staleTime: 5 * 60_000 })
export const useProducts = () => useQuery({ queryKey: keys.products, queryFn: listProducts })
export const useLotSummary = () =>
  useQuery({ queryKey: [...keys.lots, 'summary'], queryFn: fetchLotSummary })
// Previous results stay on screen while new filters load, so the list doesn't flicker.
export const useLotGroups = (query: LotQuery) =>
  useQuery({
    queryKey: [...keys.lots, 'groups', query],
    queryFn: () => fetchLotGroups(query),
    placeholderData: keepPreviousData,
  })
export const useLots = (query: LotQuery, page: number, pageSize = lotPageSize, enabled = true) =>
  useQuery({
    queryKey: [...keys.lots, 'list', query, page, pageSize],
    queryFn: () => listLots(query, page, pageSize),
    placeholderData: keepPreviousData,
    enabled,
  })
const completed: LotQuery = { view: 'completed', q: '', flag: [], sort: 'eta-asc' }
export const useCompletedCount = () =>
  useQuery({
    queryKey: [...keys.lots, 'completed-count'],
    queryFn: () => listLots(completed, 1, 1).then((r) => r.total),
  })

const refresh = (...areas: (readonly string[])[]) =>
  Promise.all(areas.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
// After a lot, batch or receipt changes: every lot read, and month-end, which sums receipts.
export const refreshLots = () => refresh(keys.lots, keys.monthEnd)
// Products appear in lots, shipments and month-end.
export const refreshProducts = () =>
  refresh(keys.products, keys.lots, keys.monthEnd, keys.shipments)
export const refreshShipments = () => refresh(keys.shipments)
// Dropdown changes, imports and resets touch everything.
export const refreshEverything = () => queryClient.invalidateQueries()
```

Create `apps/web/src/drafts.ts`:

```ts
import type { LookupItem } from '@boat/domain/api'
import { type LookupKind, type Product, stamp } from '@boat/domain/models'
import { values } from './api/mappers'

// The preferred value while Settings still has it, otherwise the first value of its kind.
export function defaultValue(lookups: LookupItem[], kind: LookupKind, preferred: string) {
  const options = values(lookups, kind)
  return options.includes(preferred) ? preferred : (options[0] ?? '')
}

export const newProduct = (lookups: LookupItem[]): Product =>
  stamp({ name: '', variant: '', segment: defaultValue(lookups, 'segment', 'PA / TWS') })
```

- [ ] **Step 4: Add the pager, the conflict banner and the CSV type**

Append to `apps/web/src/ui.tsx`:

```tsx
// A CSV button's action: false when the current view has no rows.
export type CsvExport = () => boolean | Promise<boolean>

// "1–50 of 312" with Previous and Next, for lists the server pages.
export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  if (total <= pageSize) return null
  const first = (page - 1) * pageSize + 1,
    last = Math.min(total, page * pageSize)
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-600 sm:px-5">
      <span>
        {first}–{last} of {total}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={last >= total}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

// Shown when a save meets a newer version. Reload replaces the form with the server's record;
// keeping the edits means the next save is refused again until the user reloads.
export function ConflictBanner({
  record,
  onReload,
  onDismiss,
}: {
  record: 'lot' | 'product' | 'shipment'
  onReload: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="alert"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span>
        Someone else changed this {record} while you were editing. Reload to see their version —
        your unsaved changes will be lost.
      </span>
      <span className="flex gap-2">
        <Button type="button" size="sm" onClick={onReload}>
          Reload
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDismiss}>
          Keep editing
        </Button>
      </span>
    </div>
  )
}
```

In `apps/web/src/MonthEnd.tsx` and `apps/web/src/Shipments.tsx`, change the `csvRef` prop type to `MutableRefObject<CsvExport | null>` and import `CsvExport` from `./ui`. Their synchronous functions still fit the type.

- [ ] **Step 5: Replace the Production screen**

Replace `apps/web/src/Production.tsx` with:

```tsx
import type { LotCards, LotFlag, LotGroup, LotSort } from '@boat/domain/api'
import { dateLabel, effectiveLotEta, quantity, signedDays } from '@boat/domain/calculations'
import type { LookupKind } from '@boat/domain/models'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns3,
  Filter,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { type MutableRefObject, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useAccess } from './access'
import { downloadLotsCsv, type LotQuery, lotPageSize } from './api/lots'
import type { LotRecord, ProductRecord } from './api/mappers'
import { useLookups, useLotGroups, useLots, useLotSummary, useProducts } from './api/queries'
import { Badge, Button, Card, type CsvExport, Empty, Input, Pager, Select } from './ui'

type Props = {
  mode: 'active' | 'completed'
  onOpenLot: (id: string) => void
  onNewLot: (productId: string) => void
  onEditProduct: (product: ProductRecord) => void
  onAddProduct: () => void
  csvRef: MutableRefObject<CsvExport | null>
}
type Column =
  | 'label'
  | 'status'
  | 'category'
  | 'ems'
  | 'stage'
  | 'lotQty'
  | 'produced'
  | 'grn'
  | 'balance'
  | 'plannedDate'
  | 'eta'
  | 'blocker'
  | 'poc'
  | 'mode'
  | 'rm'
  | 'followUp'
  | 'fullGrn'
  | 'planDelay'
  | 'leadTime'
const columnLabels: Record<Column, string> = {
  label: 'Lot',
  status: 'Status',
  category: 'Category',
  ems: 'EMS',
  stage: 'Stage',
  lotQty: 'Lot Qty',
  produced: 'Produced',
  grn: 'GRN',
  balance: 'Balance',
  plannedDate: 'Planned Date',
  eta: 'Current ETA',
  blocker: 'Blocker',
  poc: 'POC',
  mode: 'Mode',
  rm: 'RM Ready',
  followUp: 'Follow-up',
  fullGrn: 'Full GRN Date',
  planDelay: 'Vs Plan',
  leadTime: 'RM→GRN Days',
}
const defaultCols: Column[] = [
  'label',
  'status',
  'category',
  'ems',
  'stage',
  'lotQty',
  'produced',
  'grn',
  'balance',
  'plannedDate',
  'eta',
  'blocker',
]
const completedCols: Column[] = [
  'label',
  'category',
  'ems',
  'lotQty',
  'produced',
  'grn',
  'plannedDate',
  'fullGrn',
  'planDelay',
  'leadTime',
]
const simpleCols: Column[] = ['label', 'status', 'stage', 'lotQty', 'grn', 'balance', 'eta']
const allCols = Object.keys(columnLabels) as Column[]

// Dropdown filters hold lookup ids; the API filters by id.
type Filters = {
  segment: string
  category: string
  ems: string
  poc: string
  status: string
  stage: string
  mode: string
  blocker: string
  rm: boolean
  followUp: boolean
}
const noFilters: Filters = {
  segment: '',
  category: '',
  ems: '',
  poc: '',
  status: '',
  stage: '',
  mode: '',
  blocker: '',
  rm: false,
  followUp: false,
}
const filterKinds: Record<Exclude<keyof Filters, 'rm' | 'followUp'>, LookupKind> = {
  segment: 'segment',
  category: 'category',
  ems: 'ems',
  poc: 'poc',
  status: 'status',
  stage: 'stage',
  mode: 'logistics',
  blocker: 'blocker',
}
const filterPlaceholders: Record<keyof typeof filterKinds, string> = {
  segment: 'All segments',
  category: 'All categories',
  ems: 'All EMS',
  poc: 'All POCs',
  status: 'All statuses',
  stage: 'All stages',
  mode: 'All modes',
  blocker: 'All blockers',
}
const cards: { id: keyof LotCards; label: string; help: string; tone: string }[] = [
  { id: 'overdue', label: 'Overdue', help: 'Incomplete lots with effective ETA before today.', tone: 'red' },
  { id: 'dueSoon', label: 'Due Soon', help: 'Incomplete lots due today through the next 3 days.', tone: 'amber' },
  { id: 'onTrack', label: 'On Track', help: 'Status On Track, not overdue, due soon, or blocked.', tone: 'green' },
  { id: 'blocked', label: 'Delayed / Blocked', help: 'Delayed or Hold status, or an active blocker.', tone: 'red' },
  { id: 'approval', label: 'Approval', help: 'Incomplete lots with an Approval Blocker.', tone: 'amber' },
  { id: 'followUp', label: 'Follow-ups', help: 'Incomplete lots with follow-up date on or before today.', tone: 'blue' },
  { id: 'rm', label: 'RM Incomplete', help: 'Incomplete lots whose material target has not been fully met.', tone: 'amber' },
  { id: 'npi', label: 'NPI', help: 'Incomplete lots in a non-BAU product category.', tone: 'teal' },
]

function toQuery(
  view: LotQuery['view'],
  q: string,
  f: Filters,
  quick: string,
  sort: LotSort,
): LotQuery {
  const flag = new Set<LotFlag>()
  if (f.rm) flag.add('rm')
  if (f.followUp) flag.add('followUp')
  if (quick) flag.add(quick as LotFlag)
  return {
    view,
    q: q.trim(),
    segmentId: f.segment || undefined,
    categoryId: f.category || undefined,
    emsId: f.ems || undefined,
    pocId: f.poc || undefined,
    statusId: f.status || undefined,
    stageId: f.stage || undefined,
    logisticsId: f.mode || undefined,
    blockerId: f.blocker || undefined,
    flag: [...flag],
    sort,
  }
}

// Waits for typing to pause before searching, so each keystroke isn't a request.
function useDebounced<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

const statuses = (lot: LotRecord) => {
  const f = lot.computed.flags
  if (lot.computed.completed) return <Badge tone="green">Completed</Badge>
  if (f.blocked)
    return (
      <Badge tone={lot.status === 'Hold' ? 'amber' : 'red'}>
        {lot.status === 'On Track' ? 'Blocked' : lot.status}
      </Badge>
    )
  if (f.overdue) return <Badge tone="red">Overdue</Badge>
  if (f.dueSoon) return <Badge tone="amber">Due soon</Badge>
  return <Badge tone="green">On track</Badge>
}

function renderCell(l: LotRecord, col: Column): ReactNode {
  const c = l.computed
  switch (col) {
    case 'label':
      return <span className="font-bold text-[#193e40]">{l.label}</span>
    case 'status':
      return (
        <div>
          {statuses(l)}
          <span className="mt-1 block min-w-48 max-w-64 whitespace-normal text-[11px] leading-4 text-slate-500">
            {c.summary}
          </span>
        </div>
      )
    case 'category':
      return <Badge tone={l.category === 'BAU' ? 'slate' : 'blue'}>{l.category}</Badge>
    case 'ems':
      return l.ems || '—'
    case 'stage':
      return l.stage
    case 'lotQty':
      return quantity(l.lotQty)
    case 'produced':
      return quantity(l.freshProductionQty)
    case 'grn':
      return <span className="font-semibold">{quantity(c.grnTotal)}</span>
    case 'balance':
      return <span className="font-bold text-[#bd5e2d]">{quantity(c.balance)}</span>
    case 'plannedDate':
      return dateLabel(l.plannedDate)
    case 'eta':
      return (
        <span className={c.flags.overdue ? 'font-semibold text-rose-700' : ''}>
          {dateLabel(effectiveLotEta(l))}
        </span>
      )
    case 'blocker':
      return !l.blockerCategory || l.blockerCategory === 'None' ? (
        '—'
      ) : (
        <span className="max-w-32 truncate" title={l.blockerDescription}>
          {l.blockerCategory}
        </span>
      )
    case 'poc':
      return l.poc || '—'
    case 'mode':
      return l.logisticsMode || '—'
    case 'rm':
      return `${Math.round(c.rm.percent)}%`
    case 'followUp':
      return dateLabel(l.followUpDate)
    case 'fullGrn':
      return dateLabel(c.fullGrnDate ?? '')
    case 'planDelay':
      return (
        <span className={c.planDelay && c.planDelay > 0 ? 'font-semibold text-rose-700' : ''}>
          {signedDays(c.planDelay)}
        </span>
      )
    case 'leadTime':
      return c.leadTime ?? '—'
  }
}

export default function Production({
  mode,
  onOpenLot,
  onNewLot,
  onEditProduct,
  onAddProduct,
  csvRef,
}: Props) {
  const access = useAccess()
  const lookups = useLookups().data ?? [],
    products = useProducts().data ?? []
  const [search, setSearch] = useState(''),
    [filtersOpen, setFiltersOpen] = useState(false),
    [columnsOpen, setColumnsOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>(noFilters)
  const [sort, setSort] = useState<LotSort>('eta-asc'),
    [group, setGroup] = useState(true),
    [expanded, setExpanded] = useState<string[]>([]),
    [columns, setColumns] = useState<Column[]>(defaultCols),
    [quick, setQuick] = useState('')
  const term = useDebounced(search)
  const query = useMemo(
    () => toQuery(mode, term, filters, quick, sort),
    [mode, term, filters, quick, sort],
  )
  // The page belongs to one query: a new filter or sort starts again from page 1, so the list
  // never opens on an empty later page.
  const queryKey = JSON.stringify(query)
  const [paging, setPaging] = useState({ key: queryKey, page: 1 })
  const page = paging.key === queryKey ? paging.page : 1
  const groupsQuery = useLotGroups(query)
  const groups = groupsQuery.data ?? []
  const flat = useLots(query, page, lotPageSize, !group)
  const summary = useLotSummary().data
  const withLots = groups.filter((g) => g.lots > 0),
    emptyProducts = groups.filter((g) => g.lots === 0),
    total = withLots.reduce((n, g) => n + g.lots, 0)
  const record = (id: string) => products.find((p) => p.id === id)
  const look = (kind: LookupKind) =>
    lookups.filter((v) => v.kind === kind).sort((a, b) => a.sort - b.sort)
  csvRef.current = async () => {
    if (!total) return false
    await downloadLotsCsv(query)
    return true
  }
  const clear = () => {
    setSearch('')
    setFilters(noFilters)
    setQuick('')
  }
  useEffect(() => {
    setExpanded([])
    setQuick('')
    setColumns(mode === 'completed' ? completedCols : defaultCols)
  }, [mode])
  // Searching or filtering expands the matching products so their lots are visible at once.
  const narrowing = !!term.trim() || !!quick || Object.values(filters).some(Boolean)
  const matchingProducts = withLots.map((g) => g.product.id).join(',')
  useEffect(() => {
    if (narrowing) setExpanded(matchingProducts ? matchingProducts.split(',') : [])
  }, [narrowing, matchingProducts])
  const productButtons = (g: LotGroup) => {
    const product = record(g.product.id)
    return (
      <>
        {product && access.can('editProducts') && (
          <Button variant="ghost" size="sm" onClick={() => onEditProduct(product)}>
            Edit
          </Button>
        )}
        {mode === 'active' && access.can('createLots') && (
          <Button variant="secondary" size="sm" onClick={() => onNewLot(g.product.id)}>
            <Plus size={14} /> Add lot
          </Button>
        )}
      </>
    )
  }
  const groupName = (g: LotGroup) =>
    `${g.product.name}${g.product.variant ? ` ${g.product.variant}` : ''}`
  return (
    <div className="space-y-5">
      {mode === 'active' && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {cards.map((card) => (
              <button
                key={card.id}
                title={card.help}
                onClick={() => setQuick(quick === card.id ? '' : card.id)}
                className={`rounded-2xl border bg-white p-4 text-left shadow-[0_2px_14px_rgba(15,23,42,.035)] transition hover:border-orange-300 ${quick === card.id ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-200'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="metric-label">{card.label}</span>
                  <span
                    className={`icon-dot ${card.tone === 'red' ? 'text-rose-500' : card.tone === 'amber' ? 'text-amber-500' : card.tone === 'green' ? 'text-emerald-500' : card.tone === 'blue' ? 'text-sky-500' : 'text-teal-500'}`}
                  />
                </div>
                <div className="mt-2 metric-value">{summary ? summary[card.id] : '—'}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Cards describe overlapping conditions; their counts are not intended to add up to the
            total number of lots. Hover for definitions.
          </p>
        </>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-base font-bold text-[#173b3d]">
              {mode === 'active' ? 'Active production lots' : 'Completed lots'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {total} lots across {groups.length} products · Completion is based on full GRN
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setGroup(!group)
                setExpanded([])
              }}
            >
              {group ? 'Grouped by product' : 'Flat view'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded(groups.map((g) => g.product.id))}
              title="Expand all products"
            >
              <ChevronsUpDown size={14} /> Expand all
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded([])}
              title="Collapse all products"
            >
              <ChevronsDownUp size={14} /> Collapse
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <div className="relative min-w-52 flex-1 sm:max-w-sm">
            <Search size={15} className="absolute left-3 top-3 text-slate-400" />
            <Input
              aria-label="Search product, variant, or lot"
              className="pl-9"
              placeholder="Search product, variant, or lot..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(!filtersOpen)}>
            <Filter size={14} /> Filters{' '}
            {Object.values(filters).filter(Boolean).length > 0 && (
              <Badge tone="amber">{Object.values(filters).filter(Boolean).length}</Badge>
            )}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setColumnsOpen(!columnsOpen)}>
            <Columns3 size={14} /> Columns
          </Button>
          <Select
            aria-label="Sort lots"
            className="max-w-40"
            value={sort}
            onChange={(e) => setSort(e.target.value as LotSort)}
          >
            <option value="eta-asc">ETA: soonest</option>
            <option value="eta-desc">ETA: latest</option>
            <option value="qty-desc">Qty: high to low</option>
            <option value="balance-desc">Balance: high to low</option>
            <option value="product-asc">Product: A–Z</option>
            <option value="label-asc">Lot: A–Z</option>
          </Select>
          <Button variant="ghost" size="sm" onClick={clear}>
            <X size={14} /> Clear filters
          </Button>
        </div>
        {filtersOpen && (
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-4 sm:grid-cols-4 xl:grid-cols-8 sm:px-5">
            {(Object.keys(filterKinds) as (keyof typeof filterKinds)[]).map((key) => (
              <Select
                key={key}
                aria-label={`Filter by ${key}`}
                value={filters[key]}
                onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
              >
                <option value="">{filterPlaceholders[key]}</option>
                {look(filterKinds[key]).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.value}
                  </option>
                ))}
              </Select>
            ))}
            <label className="col-span-1 flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={filters.rm}
                onChange={(e) => setFilters({ ...filters, rm: e.target.checked })}
              />{' '}
              RM incomplete
            </label>
            <label className="col-span-1 flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={filters.followUp}
                onChange={(e) => setFilters({ ...filters, followUp: e.target.checked })}
              />{' '}
              Follow-up due
            </label>
          </div>
        )}
        {columnsOpen && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 sm:px-5">
            <Button variant="ghost" size="sm" onClick={() => setColumns(simpleCols)}>
              Simple View
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setColumns(allCols)}>
              Show All Details
            </Button>
            {allCols.map((c) => (
              <label key={c} className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={columns.includes(c)}
                  onChange={(e) =>
                    setColumns(e.target.checked ? [...columns, c] : columns.filter((x) => x !== c))
                  }
                />
                {columnLabels[c]}
              </label>
            ))}
          </div>
        )}
        {groupsQuery.isPending ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Loading lots…</p>
        ) : groupsQuery.isError ? (
          <div className="p-5">
            <Empty
              title="Couldn't load lots"
              description={groupsQuery.error.message}
              action={
                <Button variant="secondary" onClick={() => groupsQuery.refetch()}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : !groups.length ? (
          <div className="p-5">
            <Empty
              title={
                mode === 'completed'
                  ? 'No completed lots yet'
                  : products.length
                    ? 'No matching lots'
                    : 'No products yet'
              }
              description={
                mode === 'completed'
                  ? 'A lot appears here when its GRN receipts equal its positive lot quantity.'
                  : products.length
                    ? 'Try clearing filters or add a lot to a product.'
                    : access.can('editProducts')
                      ? 'Add your first product, then add production lots to it.'
                      : 'An admin or planner adds products and lots.'
              }
              action={
                mode === 'active' && (search || quick || Object.values(filters).some(Boolean)) ? (
                  <Button variant="secondary" onClick={clear}>
                    Clear filters
                  </Button>
                ) : mode === 'active' && !products.length && access.can('editProducts') ? (
                  <Button onClick={onAddProduct}>
                    <Plus size={16} /> Add Product
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : group ? (
          <div>
            {groups.map((g) => {
              const open = expanded.includes(g.product.id)
              return (
                <div
                  key={g.product.id}
                  role="group"
                  aria-label={groupName(g)}
                  className="border-t border-slate-100 first:border-t-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-slate-50/60 sm:px-5">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() =>
                        setExpanded(
                          open
                            ? expanded.filter((x) => x !== g.product.id)
                            : [...expanded, g.product.id],
                        )
                      }
                      aria-expanded={open}
                    >
                      {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-sm font-extrabold text-teal-700">
                        {g.product.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-[#173b3d]">
                          {g.product.name}{' '}
                          {g.product.variant && (
                            <span className="font-normal text-slate-500">· {g.product.variant}</span>
                          )}
                        </span>
                        <span className="text-xs text-slate-500">
                          {g.product.segment.value} · {g.lots} lots ·{' '}
                          {mode === 'active' ? `${g.delayed} delayed` : 'completed'}
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span title="Total lot quantity">
                        Qty <b>{quantity(g.lotQty)}</b>
                      </span>
                      <span title="Fresh production quantity">
                        Produced <b>{quantity(g.produced)}</b>
                      </span>
                      <span title="Total GRN">
                        GRN <b>{quantity(g.grnTotal)}</b>
                      </span>
                      <span title="Remaining balance">
                        Balance <b className="text-[#c46736]">{quantity(g.balance)}</b>
                      </span>
                      {productButtons(g)}
                    </div>
                  </div>
                  {open &&
                    (g.lots ? (
                      <ProductLots productId={g.product.id} query={query} columns={columns} onOpenLot={onOpenLot} />
                    ) : (
                      <p className="px-5 pb-4 text-xs text-slate-500">
                        No active lots yet.
                        {access.can('createLots') && ' Use Add lot to start tracking this product.'}
                      </p>
                    ))}
                </div>
              )
            })}
          </div>
        ) : (
          <>
            {flat.data && flat.data.items.length > 0 && (
              <>
                <LotTable lots={flat.data.items} columns={columns} onOpenLot={onOpenLot} showProduct />
                <Pager
                  page={page}
                  pageSize={lotPageSize}
                  total={flat.data.total}
                  onPage={(next) => setPaging({ key: queryKey, page: next })}
                />
              </>
            )}
            {emptyProducts.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Products without active lots
                </h3>
                <div className="space-y-2">
                  {emptyProducts.map((g) => (
                    <div
                      key={g.product.id}
                      role="group"
                      aria-label={groupName(g)}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                    >
                      <div>
                        <b className="text-sm text-[#173b3d]">{g.product.name}</b>
                        <span className="ml-2 text-xs text-slate-500">
                          {[g.product.variant, g.product.segment.value].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flex gap-2">{productButtons(g)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

// One product's matching lots in the grouped view. More than 200 is rare; the flat view pages.
function ProductLots({
  productId,
  query,
  columns,
  onOpenLot,
}: {
  productId: string
  query: LotQuery
  columns: Column[]
  onOpenLot: (id: string) => void
}) {
  const lots = useLots({ ...query, productId }, 1, 200)
  if (!lots.data) return <p className="px-5 pb-4 text-xs text-slate-500">Loading lots…</p>
  return (
    <>
      <LotTable lots={lots.data.items} columns={columns} onOpenLot={onOpenLot} />
      {lots.data.total > lots.data.items.length && (
        <p className="px-5 pb-4 text-xs text-slate-500">
          Showing {lots.data.items.length} of {lots.data.total} lots. Use the flat view or filters
          to see the rest.
        </p>
      )}
    </>
  )
}

function LotTable({
  lots,
  columns,
  onOpenLot,
  showProduct = false,
}: {
  lots: LotRecord[]
  columns: Column[]
  onOpenLot: (id: string) => void
  showProduct?: boolean
}) {
  return (
    <>
      <div className="table-wrap hidden md:block">
        <table className="data-table">
          <thead>
            <tr>
              {showProduct && <th>Product</th>}
              {columns.map((c) => (
                <th key={c}>{columnLabels[c]}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id} className="cursor-pointer" onClick={() => onOpenLot(l.id)}>
                {showProduct && <td className="font-semibold">{l.product.name}</td>}
                {columns.map((c) => (
                  <td key={c}>{renderCell(l, c)}</td>
                ))}
                <td>
                  <ChevronRight size={14} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-slate-100 md:hidden">
        {lots.map((l) => (
          <button key={l.id} onClick={() => onOpenLot(l.id)} className="w-full p-4 text-left">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#173b3d]">{l.label}</span>
              {statuses(l)}
            </div>
            <div className="mt-1 text-xs text-slate-500">{l.computed.summary}</div>
            {showProduct && <div className="mt-1 text-xs text-slate-500">{l.product.name}</div>}
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <span>
                Qty <b>{quantity(l.lotQty)}</b>
              </span>
              <span>
                GRN <b>{quantity(l.computed.grnTotal)}</b>
              </span>
              <span>
                Balance <b>{quantity(l.computed.balance)}</b>
              </span>
            </div>
            {l.computed.completed ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-xs text-slate-500">
                <span>Full GRN {dateLabel(l.computed.fullGrnDate ?? '')}</span>
                <span>
                  {signedDays(l.computed.planDelay)} vs plan · RM→GRN {l.computed.leadTime ?? '—'}{' '}
                  days
                </span>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>{l.stage}</span>
                <span>ETA {dateLabel(effectiveLotEta(l))}</span>
              </div>
            )}
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-[#d96d35]" style={{ width: `${l.computed.grnPercent}%` }} />
            </div>
          </button>
        ))}
      </div>
    </>
  )
}
```

Run `pnpm format` afterwards; it rewraps the long lines above.

- [ ] **Step 6: Move the product editor and the header onto the API**

In `apps/web/src/App.tsx`:

1. Import:

```tsx
import type { LookupItem } from '@boat/domain/api'
import { ConflictError } from './api/client'
import { type ProductRecord, toProduct, values } from './api/mappers'
import { deleteProduct, saveProduct } from './api/products'
import { refreshProducts, useCompletedCount, useLookups, useProducts } from './api/queries'
import { newProduct } from './drafts'
import { ConflictBanner, type CsvExport } from './ui'
```

Remove `saveProduct` and `deleteProduct` from the `./repository` import, and delete the `productBlank` function.

2. In `Workspace`, after the `access` lines, add:

```tsx
  const lookups: LookupItem[] = useLookups().data ?? [],
    products = useProducts().data ?? [],
    completedCount = useCompletedCount().data
```

Change the product state to carry an optional version, add the conflict state, and type the CSV ref:

```tsx
  const [product, setProduct] = useState<(Product & { version?: number }) | null>(null),
    [productBase, setProductBase] = useState(''),
    [productConflict, setProductConflict] = useState<ProductRecord | null>(null)
```

```tsx
  const csvRef = useRef<CsvExport | null>(null),
```

3. Replace `openProduct`, `saveProductForm` and `removeProduct` with:

```tsx
  const openProduct = (value?: ProductRecord) => {
    const next = value || newProduct(lookups)
    productForm.reset()
    setProductConflict(null)
    setProduct(next)
    setProductBase(JSON.stringify(next))
  }
  // A 409 that carries the server's record is a stale version; other 409s are rules to explain.
  const productFailed = (e: unknown) => {
    if (e instanceof ConflictError && e.current)
      setProductConflict(toProduct(e.current as Parameters<typeof toProduct>[0]))
    else productForm.fail(e)
  }
  const saveProductForm = async (e: FormEvent) => {
    e.preventDefault()
    if (!product || !productForm.check(validateProduct(product))) return
    const saved = await run(async () => {
      await saveProduct(product, lookups)
      await refreshProducts()
    }, productFailed)
    if (saved) {
      setProduct(null)
      setMessage(`Product ${product.name.trim()} saved.`)
    }
  }
  const removeProduct = async () => {
    if (!product) return
    if (
      !window.confirm(
        `Delete ${product.name} and all its lots, RM batches, GRN receipts, and lot history? Products used in shipment lines cannot be deleted.`,
      )
    )
      return
    const removed = await run(async () => {
      await deleteProduct(product.id)
      await refreshProducts()
    }, productForm.fail)
    if (removed) setProduct(null)
  }
```

4. In the product `Modal`, set the title from the version, show the banner, read segments from the API and show Delete only for a saved product:

```tsx
          title={product?.version === undefined ? 'Add product' : 'Edit product'}
```

```tsx
            <form onSubmit={saveProductForm} noValidate className="space-y-4">
              {productConflict && (
                <ConflictBanner
                  record="product"
                  onReload={() => {
                    setProduct(productConflict)
                    setProductBase(JSON.stringify(productConflict))
                    setProductConflict(null)
                    productForm.reset()
                  }}
                  onDismiss={() => setProductConflict(null)}
                />
              )}
              <FormError message={productForm.errors.form} />
```

```tsx
                <SearchSelect
                  value={product.segment}
                  options={values(lookups, 'segment')}
```

```tsx
                  {product.version !== undefined && can('deleteProducts') && (
```

5. In the header, replace `data.products` with `products` for the Add Lot button, and in the Add Lot modal use `options={productChoices(products)}`. In the navigation, replace the Completed count expression with `{completedCount ?? '…'}`.

6. Replace the CSV button's `onClick` with:

```tsx
                    onClick={async () => {
                      if (!csvRef.current) return
                      try {
                        if (!(await csvRef.current())) {
                          setSaveState('idle')
                          setMessage('Nothing to export: the current view has no rows.')
                        }
                      } catch (e) {
                        setSaveState('failed')
                        setMessage(e instanceof Error ? e.message : 'Export failed.')
                      }
                    }}
```

7. Replace the `<Production … />` element with:

```tsx
              <Production
                mode={screen === 'production' ? 'active' : 'completed'}
                onOpenLot={(id) => setSelectedLot(data.lots.find((l) => l.id === id) ?? null)}
                onNewLot={(productId) => setSelectedLot(newLot(productId, data.lookupValues))}
                onEditProduct={openProduct}
                onAddProduct={() => openProduct()}
                csvRef={csvRef}
              />
```

The `onOpenLot` line keeps compiling until Task 7 replaces the drawer; API lots aren't in IndexedDB, so it opens nothing in between.

- [ ] **Step 7: Run the specs and every check**

Run: `pnpm typecheck && pnpm --filter @boat/web test && pnpm build && pnpm e2e`
Expected: all pass on both projects.

- [ ] **Step 8: Format and commit**

```bash
pnpm format
git add apps/web e2e
git commit -m "Read products and the Production list from the API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The lot drawer on the API

The lot drawer opens a lot by id, reads it with its batches and receipts from `GET /lots/:id`, and saves with the version it opened. A stale version shows the conflict banner, a lot deleted elsewhere closes the drawer, and history and notes come from the activity endpoints. RM batches and GRN receipts are shown from the API but still saved by `repository.ts` until Task 8, so those saves don't show in between.

**Files:**
- Modify: `apps/web/src/api/lots.ts`, `apps/web/src/api/queries.ts`, `apps/web/src/drafts.ts`
- Create: `apps/web/src/api/activity.ts`
- Modify: `apps/web/src/LotDrawer.tsx`, `apps/web/src/App.tsx`
- Modify: `e2e/support/ui.ts`
- Test: `e2e/tests/lots.spec.ts`, `e2e/tests/conflict.spec.ts`

**Interfaces:**
- Consumes: `api`, `ConflictError`, `NotFoundError` (Task 3); `toLot`, `toBatch`, `toReceipt`, `lotInput`, `lotField`, `values`, `LotRecord` (Task 3); `queryClient` (Task 5); `keys`, `refreshLots`, `useLookups`, `useProducts`, `ConflictBanner`, `defaultValue`, `seeder`, `day` (Task 6).
- Produces:
  - `api/lots.ts`: `type LotView = { lot: LotRecord; batches: RMBatch[]; receipts: GRNReceipt[] }`, `toLotView(detail: LotDetail): LotView`, `fetchLot(id: string): Promise<LotView>`, `saveLot(lot: Lot & { version?: number }, lookups: LookupItem[]): Promise<LotView>` (POST without a version, PATCH with one, `fields: lotField`) and `deleteLot(id: string): Promise<void>`.
  - `api/activity.ts`: `type ActivityOwner = 'lots' | 'shipments'`, `listActivity(owner: ActivityOwner, id: string): Promise<ActivityEntry[]>` (newest first, one page of 200) and `addNote(owner: ActivityOwner, id: string, message: string): Promise<void>`.
  - `api/queries.ts`: `lotKey(id: string)`, `activityKey(owner, id)`, `useLot(id: string | undefined)` and `useActivity(owner: ActivityOwner, id: string | undefined)`. `lotKey` sits under `keys.lots` and `activityKey('lots', …)` under `keys.lots`, `activityKey('shipments', …)` under `keys.shipments`, so `refreshLots()` and `refreshShipments()` refresh them.
  - `drafts.ts`: `newLot(productId: string, lookups: LookupItem[]): Lot`.
  - `LotDrawer.tsx`: `type LotTarget = { id: string } | { draft: Lot }` and the default export `LotDrawer({ target, onClose, onOpen, onGone, run }: { target: LotTarget; onClose: () => void; onOpen: (id: string) => void; onGone: () => void; run: Run })`.
  - `e2e/support/ui.ts`: `openLot(page: Page, label: string): Promise<Locator>`, which searches for the lot, opens it and returns its drawer.

- [ ] **Step 1: Write the UI helper and the failing specs**

Append to `e2e/support/ui.ts`:

```ts
// Searching expands the product that holds the lot. Desktop lists lots in a table, mobile in
// cards; only one of them is visible.
export async function openLot(page: Page, label: string) {
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill(label)
  await page.getByRole('main').getByText(label, { exact: true }).filter({ visible: true }).click()
  const drawer = page.getByRole('dialog', { name: label })
  await expect(drawer).toBeVisible()
  return drawer
}
```

Create `e2e/tests/lots.spec.ts`:

```ts
import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('FR-2.1 adds a lot to a product, then edits and deletes it', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Golf')
  await seed.done()
  await page.goto('/')
  const golf = page.getByRole('group', { name: 'Golf' })
  await golf.getByRole('button', { name: 'Add lot' }).click()
  const added = page.getByRole('dialog', { name: 'New production lot' })
  await added.getByLabel('Lot label', { exact: true }).fill('G-100')
  await added.getByLabel('Lot quantity', { exact: true }).fill('250')
  await added.getByRole('button', { name: 'Save lot' }).click()
  // A saved lot reopens by id, so the drawer now carries its label.
  const saved = page.getByRole('dialog', { name: 'G-100' })
  await expect(saved).toBeVisible()
  await saved.getByRole('button', { name: 'Close' }).first().click()
  await expect(golf).toContainText('1 lots')

  const edit = await openLot(page, 'G-100')
  await edit.getByLabel('Lot quantity', { exact: true }).fill('300')
  await edit.getByRole('button', { name: 'Save & close' }).click()
  await expect(edit).toBeHidden()
  await expect(golf).toContainText(/Qty\s*300/)

  const remove = await openLot(page, 'G-100')
  page.once('dialog', (d) => d.accept())
  await remove.getByRole('button', { name: 'Delete lot' }).click()
  await expect(remove).toBeHidden()
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill('')
  await expect(golf).toContainText('0 lots')
})

test('FR-2.3 shows validation messages under their fields', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  await seed.lot(golf.id, 'G-1')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'G-1')
  await drawer.getByLabel('Fresh production quantity', { exact: true }).fill('10')
  await drawer.getByLabel('Rework quantity', { exact: true }).fill('12')
  await drawer.getByRole('button', { name: 'Save lot' }).click()
  await expect(drawer).toContainText('Rework is part of fresh production, so it cannot be larger.')
})

test('FR-2.1 shows a duplicate lot label under the label field', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  await seed.lot(golf.id, 'G-1')
  await seed.done()
  await page.goto('/')
  await page.getByRole('group', { name: 'Golf' }).getByRole('button', { name: 'Add lot' }).click()
  const drawer = page.getByRole('dialog', { name: 'New production lot' })
  await drawer.getByLabel('Lot label', { exact: true }).fill('g-1')
  await drawer.getByLabel('Lot quantity', { exact: true }).fill('10')
  await drawer.getByRole('button', { name: 'Save lot' }).click()
  // Only the server knows the other lots, so this message comes from a 422 on `label`, and it
  // must land in the Lot label field rather than the form-level error.
  await expect(
    drawer.locator('[data-invalid]').filter({ hasText: 'Lot label' }).getByRole('alert'),
  ).toContainText('This product already has a lot labelled')
})

test('FR-7.2 posts a note and lists it in the history', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  await seed.lot(golf.id, 'G-1')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'G-1')
  await drawer.getByRole('tab', { name: 'Updates & History' }).click()
  await drawer.getByLabel('Update note', { exact: true }).fill('EMS confirmed the line slot')
  await drawer.getByRole('button', { name: 'Post update' }).click()
  await expect(drawer.getByText('EMS confirmed the line slot')).toBeVisible()
  await expect(drawer.getByText(/Ada Admin/).first()).toBeVisible()
  await expect(drawer.getByLabel('Update note', { exact: true })).toHaveValue('')
})

test('closes the drawer when someone else deleted the lot', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  const lot = await seed.lot(golf.id, 'G-1')
  await page.goto('/')
  const drawer = await openLot(page, 'G-1')
  await seed.api.delete(`/lots/${lot.id}`)
  await seed.done()
  await drawer.getByLabel('Lot quantity', { exact: true }).fill('120')
  await drawer.getByRole('button', { name: 'Save lot' }).click()
  await expect(drawer).toBeHidden()
  await expect(page.getByText('This lot was deleted.')).toBeVisible()
})
```

Create `e2e/tests/conflict.spec.ts`:

```ts
import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('FR-2.1 a second editor sees the conflict banner, keeps editing, then reloads', async ({
  page,
  browser,
}) => {
  const seed = await seeder()
  const hotel = await seed.product('Hotel')
  const lot = await seed.lot(hotel.id, 'H-1', { lotQty: 100 })
  const other = await browser.newContext({
    storageState: authFile('planner'),
    viewport: page.viewportSize(),
  })
  const second = await other.newPage()
  await page.goto('/')
  await second.goto('/')

  // The first editor has unsaved changes before the second one saves.
  const mine = await openLot(page, 'H-1')
  await mine.getByLabel('Follow-up note', { exact: true }).fill('Call the EMS')
  const theirs = await openLot(second, 'H-1')
  await theirs.getByLabel('Lot quantity', { exact: true }).fill('120')
  await theirs.getByRole('button', { name: 'Save lot' }).click()
  await expect.poll(async () => (await seed.api.get(`/lots/${lot.id}`)).lotQty).toBe(120)

  await mine.getByRole('button', { name: 'Save lot' }).click()
  const banner = mine
    .getByRole('alert')
    .filter({ hasText: 'Someone else changed this lot while you were editing.' })
  await expect(banner).toBeVisible()
  await expect(mine.getByLabel('Follow-up note', { exact: true })).toHaveValue('Call the EMS')

  // Keeping the edits doesn't make the stale version saveable.
  await banner.getByRole('button', { name: 'Keep editing' }).click()
  await expect(banner).toHaveCount(0)
  await mine.getByRole('button', { name: 'Save lot' }).click()
  await expect(banner).toBeVisible()

  await banner.getByRole('button', { name: 'Reload' }).click()
  await expect(mine.getByLabel('Lot quantity', { exact: true })).toHaveValue('120')
  await expect(mine.getByLabel('Follow-up note', { exact: true })).toHaveValue('')
  await mine.getByLabel('Follow-up note', { exact: true }).fill('Call the EMS')
  await mine.getByRole('button', { name: 'Save lot' }).click()
  await expect
    .poll(async () => (await seed.api.get(`/lots/${lot.id}`)).followUpNote)
    .toBe('Call the EMS')
  await other.close()
  await seed.done()
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm build && pnpm e2e -- lots.spec.ts conflict.spec.ts`
Expected: FAIL: clicking a lot opens nothing, because the drawer still looks for it in IndexedDB.

- [ ] **Step 3: Write the reads and writes**

Append to `apps/web/src/api/lots.ts` (add `LotDetail` and `LookupItem` to the type import from `@boat/domain/api`, `GRNReceipt`, `Lot` and `RMBatch` from `@boat/domain/models`, and `lotField`, `lotInput`, `toBatch`, `toReceipt`, `type LotRecord` from `./mappers`):

```ts
// A lot as the drawer edits it, with its batches and receipts in the domain's shapes.
export type LotView = { lot: LotRecord; batches: RMBatch[]; receipts: GRNReceipt[] }
export const toLotView = (d: LotDetail): LotView => ({
  lot: toLot(d),
  batches: d.rmBatches.map(toBatch),
  receipts: d.grnReceipts.map(toReceipt),
})
export const fetchLot = (id: string) => api.get<LotDetail>(`/lots/${id}`).then(toLotView)
```

`saveLot(lot, lookups)` follows `saveProduct` in Task 6: `POST /lots` with `lotInput(lot, lookups)` when `lot.version` is undefined, otherwise `PATCH /lots/:id` with the input plus `version`; both with `{ fields: lotField }`, and both return the server's `LotDetail` through `toLotView`. `deleteLot(id)` is `api.delete(`/lots/${id}`)`.

Create `apps/web/src/api/activity.ts`. `listActivity(owner, id)` gets `/${owner}/${id}/activity?pageSize=200` (a `Page<ActivityEntry>`, newest first) and returns its items; `addNote(owner, id, message)` posts `{ message }` to `/${owner}/${id}/notes`.

In `apps/web/src/api/queries.ts`, add:

```ts
export const lotKey = (id: string) => [...keys.lots, 'detail', id]
// Lot history sits under the lots key and shipment history under the shipments key, so the
// refresh after any write to either also reloads its history.
export const activityKey = (owner: ActivityOwner, id: string) => [
  ...(owner === 'lots' ? keys.lots : keys.shipments),
  'activity',
  id,
]
export const useLot = (id: string | undefined) =>
  useQuery({ queryKey: lotKey(id ?? ''), queryFn: () => fetchLot(id!), enabled: !!id })
export const useActivity = (owner: ActivityOwner, id: string | undefined) =>
  useQuery({
    queryKey: activityKey(owner, id ?? ''),
    queryFn: () => listActivity(owner, id!),
    enabled: !!id,
  })
```

In `apps/web/src/drafts.ts`, add `newLot(productId, lookups)`. It returns the same blank lot as `newLot` in `demo.ts`, with `defaultValue(lookups, kind, preferred)` in place of `defaultLookup` for `category` (`'BAU'`), `status` (`'On Track'`), `stage` (`'RM Sourcing'`) and `blockerCategory` (`'None'`).

- [ ] **Step 4: Load the drawer from the API**

In `apps/web/src/LotDrawer.tsx`:

1. Split the component. A new default export loads the lot and shows a loading sheet until the lot and the dropdown values have arrived; the existing body becomes `LotEditor`, which only mounts with data, so its hooks never run on a half-loaded lot:

```tsx
export type LotTarget = { id: string } | { draft: Lot }
type Props = {
  target: LotTarget
  onClose: () => void
  // A new lot reopens by id after its first save.
  onOpen: (id: string) => void
  // The lot was deleted by someone else.
  onGone: () => void
  run: Run
}

export default function LotDrawer({ target, ...props }: Props) {
  const lookups = useLookups().data
  const detail = useLot('id' in target ? target.id : undefined)
  const gone = detail.error instanceof NotFoundError
  useEffect(() => {
    if (gone) props.onGone()
  }, [gone])
  if (lookups && 'draft' in target)
    return <LotEditor view={null} initial={target.draft} lookups={lookups} {...props} />
  if (lookups && detail.data)
    return <LotEditor view={detail.data} initial={detail.data.lot} lookups={lookups} {...props} />
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title="Lot details"
    >
      {detail.error && !gone ? (
        <FormError message={detail.error.message} />
      ) : (
        <p className="text-sm text-slate-500">Loading lot...</p>
      )}
    </Sheet>
  )
}
```

`LotEditor` takes `{ view: LotView | null; initial: Lot; lookups: LookupItem[] } & Omit<Props, 'target'>`. It reads `products` from `useProducts()`, and `rs` and `bs` from `view?.receipts ?? []` and `view?.batches ?? []`. `lookup(kind)` becomes `values(lookups, kind)`. Replace `stored` with `!!view`.

2. Keep the draft in step with the server while it has no unsaved edits. Query results keep their identity when nothing changed, so this runs only on a real change, such as a refetch on window focus:

```tsx
  const [draft, setDraft] = useState<Lot & { version?: number }>(initial),
    [baseline, setBaseline] = useState(JSON.stringify(initial)),
    [conflict, setConflict] = useState<LotView | null>(null)
  const adopt = (lot: LotRecord) => {
    setDraft(lot)
    setBaseline(JSON.stringify(lot))
  }
  useEffect(() => {
    if (view && !dirty) adopt(view.lot)
  }, [view])
```

Remove the `useEffect` that reset the draft on `lot.id`; the drawer is keyed by id in `App.tsx`.

3. Take the edit level from the server for a saved lot (spec §2: the lot view's `access` drives the drawer's controls):

```tsx
  const level: LotAccess = view ? view.lot.access : access.can('createLots') ? 'full' : 'none'
```

In the view-only notice, change "profiles" to "users" and read the POC from `view?.lot.poc`.

4. Replace `save` and `remove`, and add the conflict and gone handling:

```tsx
  const failed = (e: unknown) => {
    if (e instanceof ConflictError && e.current) return setConflict(toLotView(e.current as LotDetail))
    if (e instanceof NotFoundError) return onGone()
    lotForm.fail(e)
    showTabFor(fieldErrors(e))
  }
  const save = async (closeAfter = false) => {
    const found = validateLot(draft)
    if (!lotForm.check(found)) return showTabFor(found)
    let saved: LotView | undefined
    const ok = await run(async () => {
      saved = await saveLot(draft, lookups)
      queryClient.setQueryData(lotKey(saved.lot.id), saved)
      await refreshLots()
    }, failed)
    if (!ok || !saved) return
    if (closeAfter) return onClose()
    if (!view) return onOpen(saved.lot.id)
    adopt(saved.lot)
  }
```

`remove` keeps its confirm text and calls `deleteLot(draft.id)` then `refreshLots()` inside `run`, with `failed` as the error handler, and closes on success. A lot that was never saved (`!view`) just closes, as now.

5. Show the banner above the form error:

```tsx
        {conflict && (
          <ConflictBanner
            record="lot"
            onReload={() => {
              queryClient.setQueryData(lotKey(conflict.lot.id), conflict)
              adopt(conflict.lot)
              setConflict(null)
              lotForm.reset()
            }}
            onDismiss={() => setConflict(null)}
          />
        )}
```

6. History and notes come from the API. Replace `logs` with `useActivity('lots', view?.lot.id).data ?? []`, show `item.actorName` where `item.actor` was, and post a note with:

```tsx
                      const posted = await run(async () => {
                        await addNote('lots', draft.id, note)
                        await queryClient.invalidateQueries({ queryKey: activityKey('lots', draft.id) })
                      })
                      if (posted) setNote('')
```

7. Remove `saveLot`, `deleteLot` and `addNote` from the `./repository` import, and the `data` prop. Leave `saveBatch`, `deleteBatch`, `saveReceipt` and `deleteReceipt` for Task 8.

- [ ] **Step 5: Open lots by id**

In `apps/web/src/App.tsx`:

1. Replace the `selectedLot` state with `const [lotTarget, setLotTarget] = useState<LotTarget | null>(null)`, and delete `selectedLotLive`. Import `LotDrawer, { type LotTarget }` and `newLot` from `./drafts`; remove `newLot` from the `./demo` import.
2. In `<Production … />`: `onOpenLot={(id) => setLotTarget({ id })}` and `onNewLot={(productId) => setLotTarget({ draft: newLot(productId, lookups) })}`. In the Add Lot modal, open `{ draft: newLot(addLotProductId, lookups) }` the same way. Pass `onOpenLot={(lot) => setLotTarget({ id: lot.id })}` to `<MonthEnd … />` until Task 8 changes its prop. In `reset`, call `setLotTarget(null)`.
3. Replace the `<LotDrawer … />` element with:

```tsx
        {lotTarget && (
          <LotDrawer
            key={'id' in lotTarget ? lotTarget.id : 'new'}
            target={lotTarget}
            onClose={() => setLotTarget(null)}
            onOpen={(id) => setLotTarget({ id })}
            onGone={() => {
              setLotTarget(null)
              setSaveState('idle')
              setMessage('This lot was deleted.')
            }}
            run={run}
          />
        )}
```

- [ ] **Step 6: Run the specs and every check**

Run: `pnpm typecheck && pnpm --filter @boat/web test && pnpm build && pnpm e2e`
Expected: all pass on both projects.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add apps/web e2e
git commit -m "Open, save and delete lots through the API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: RM batches, GRN receipts and month-end on the API

The batch and receipt editors in the lot drawer save through the API, and the Month-end screen reads `GET /reports/month-end` with the month list from `GET /reports/months`. The month-end lot rows need each lot's current ETA, which the report doesn't carry yet, so the API adds it.

**Files:**
- Modify: `packages/domain/src/api.ts`, `apps/api/src/modules/reports/month-end.service.ts`, `apps/api/test/month-end.int.test.ts`
- Create: `apps/web/src/api/entries.ts`, `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/LotDrawer.tsx`, `apps/web/src/MonthEnd.tsx`, `apps/web/src/App.tsx`
- Test: `e2e/tests/rm-batches.spec.ts`, `e2e/tests/grn.spec.ts`, `e2e/tests/completion-reversal.spec.ts`, `e2e/tests/month-end.spec.ts`

**Interfaces:**
- Consumes: `api`, `download`, `queryString`, `NotFoundError` (Task 3); `batchInput`, `batchField`, `receiptInput` (Task 3); `keys`, `refreshLots`, `CsvExport` (Task 6); `LotView`, `LotTarget`, `openLot` (Task 7); `GET /reports/months` (Task 2).
- Produces:
  - `MonthEndReport['lots'][number]['lot']` gains `eta: string | null`, the lot's revised ETA or else its planned date (`effectiveLotEta`).
  - `api/entries.ts`: `saveBatch(lotId: string, batch: RMBatch, lookups: LookupItem[], existing: boolean): Promise<void>`, `deleteBatch(id: string): Promise<void>`, `saveReceipt(lotId: string, receipt: GRNReceipt, existing: boolean): Promise<void>` and `deleteReceipt(id: string): Promise<void>`.
  - `api/reports.ts`: `listMonths(): Promise<string[]>`, `fetchMonthEnd(month: string): Promise<MonthEndReport>` and `downloadMonthEndCsv(month: string): Promise<void>`.
  - `api/queries.ts`: `useMonths()` and `useMonthEnd(month: string)`, both under `keys.monthEnd`.
  - `MonthEnd.tsx`: `MonthEnd({ onOpenLot, csvRef }: { onOpenLot: (id: string) => void; csvRef: MutableRefObject<CsvExport | null> })`.

- [ ] **Step 1: Write the failing API test**

In `apps/api/test/month-end.int.test.ts`, inside `describe('GET /reports/month-end', …)`, add:

```ts
  it('FR-5.2 gives each lot its current ETA', async () => {
    const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-09')
    const eta = Object.fromEntries(
      res.body.lots.map((r: { lot: { label: string; eta: string | null } }) => [
        r.lot.label,
        r.lot.eta,
      ]),
    )
    expect(eta).toEqual({ L1: '2026-09-10', L2: '2026-10-10', L5: '2026-09-05' })
  })
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @boat/api test:int -- month-end`
Expected: FAIL, every `eta` is `undefined`.

- [ ] **Step 3: Add the ETA**

In `apps/api/src/modules/reports/month-end.service.ts`, add `effectiveLotEta` to the `@boat/domain/calculations` import and `eta: effectiveLotEta(r.lot) || null` after `plannedDate` in each lot row. In `packages/domain/src/api.ts`, add `eta: string | null` after `plannedDate` in `MonthEndReport`'s lot. `apps/api/src/contract.ts` then holds again.

Run: `pnpm --filter @boat/api test:int -- month-end && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Write the failing specs**

Create `e2e/tests/rm-batches.spec.ts`:

```ts
import type { Locator } from '@playwright/test'
import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { choose, openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

const metric = (drawer: Locator, label: string) => drawer.getByText(label, { exact: true }).locator('..')

async function addBatch(drawer: Locator, component: string, label: string, received: number) {
  await drawer.getByRole('button', { name: 'Add batch' }).click()
  const modal = drawer.page().getByRole('dialog', { name: 'Add material batch' })
  await choose(modal, 'Component', component)
  await modal.getByLabel('Batch label', { exact: true }).fill(label)
  await modal.getByLabel('Received quantity', { exact: true }).fill(String(received))
  await modal.getByRole('button', { name: 'Save batch' }).click()
  await expect(modal).toBeHidden()
}

test('FR-3.2 adds, edits and deletes batches, and RM readiness follows', async ({ page }) => {
  const seed = await seeder()
  const kilo = await seed.product('Kilo')
  await seed.lot(kilo.id, 'K-1', { rmMode: 'components', components: ['Housing', 'Battery'] })
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'K-1')
  await drawer.getByRole('tab', { name: 'RM Readiness' }).click()
  await addBatch(drawer, 'Housing', 'H-A', 60)
  await addBatch(drawer, 'Battery', 'B-A', 40)
  await expect(metric(drawer, 'Producible now')).toContainText('40')
  await expect(metric(drawer, 'Bottleneck')).toContainText('Battery')

  await drawer.getByRole('row', { name: /B-A/ }).getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit material batch' })
  await edit.getByLabel('Received quantity', { exact: true }).fill('80')
  await edit.getByRole('button', { name: 'Save batch' }).click()
  await expect(metric(drawer, 'Producible now')).toContainText('60')
  await expect(metric(drawer, 'Bottleneck')).toContainText('Housing')

  page.once('dialog', (d) => d.accept())
  await drawer.getByRole('row', { name: /H-A/ }).getByRole('button', { name: 'Delete' }).click()
  await expect(drawer.getByRole('row', { name: /H-A/ })).toHaveCount(0)
  await expect(metric(drawer, 'Producible now')).toContainText('0')
})

test('FR-3.1 adds batches only to lots tracked by component', async ({ page }) => {
  const seed = await seeder()
  const kilo = await seed.product('Kilo')
  await seed.lot(kilo.id, 'K-2')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'K-2')
  await drawer.getByRole('tab', { name: 'RM Readiness' }).click()
  await expect(drawer.getByRole('button', { name: 'Add batch' })).toBeDisabled()
})

test('FR-3.3 shows the server refusing a component the lot no longer tracks', async ({ page }) => {
  const seed = await seeder()
  const kilo = await seed.product('Kilo')
  const lot = await seed.lot(kilo.id, 'K-3', {
    rmMode: 'components',
    components: ['Housing', 'Battery'],
  })
  await page.goto('/')
  const drawer = await openLot(page, 'K-3')
  await drawer.getByRole('tab', { name: 'RM Readiness' }).click()
  await drawer.getByRole('button', { name: 'Add batch' }).click()
  const modal = page.getByRole('dialog', { name: 'Add material batch' })
  await choose(modal, 'Component', 'Housing')
  await modal.getByLabel('Batch label', { exact: true }).fill('H-late')
  // Someone else drops Housing from the lot while this form is open.
  await seed.api.patch(`/lots/${lot.id}`, {
    componentIds: [await seed.lookup('component', 'Battery')],
    version: lot.version,
  })
  await seed.done()
  await modal.getByRole('button', { name: 'Save batch' }).click()
  await expect(
    modal.locator('[data-invalid]').filter({ hasText: 'Component' }).getByRole('alert'),
  ).toContainText('Select this component on the lot first.')
})
```

Create `e2e/tests/grn.spec.ts`:

```ts
import type { Locator } from '@playwright/test'
import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

async function openReceipt(drawer: Locator, label: string, quantity: number) {
  await drawer.getByRole('button', { name: 'Add receipt' }).click()
  const modal = drawer.page().getByRole('dialog', { name: 'Add GRN receipt' })
  await modal.getByLabel('Receipt label', { exact: true }).fill(label)
  await modal.getByLabel('Quantity', { exact: true }).fill(String(quantity))
  return modal
}

test('FR-4.1 takes partial receipts and completes the lot at full GRN', async ({ page }) => {
  const seed = await seeder()
  const lima = await seed.product('Lima')
  await seed.lot(lima.id, 'L-1', { lotQty: 100 })
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'L-1')
  await drawer.getByRole('tab', { name: 'GRN Receipts' }).click()
  await (await openReceipt(drawer, 'GRN 1', 40)).getByRole('button', { name: 'Save receipt' }).click()
  await expect(drawer.getByText('Pending quantity').locator('..')).toContainText('60')
  await (await openReceipt(drawer, 'GRN 2', 60)).getByRole('button', { name: 'Save receipt' }).click()
  await expect(drawer.getByText('Pending quantity').locator('..')).toContainText('0')
  await drawer.getByRole('button', { name: 'Close' }).first().click()
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill('')
  await expect(page.getByRole('group', { name: 'Lima' })).toContainText('0 lots')
  await goTo(page, 'Completed')
  await expect(page.getByRole('group', { name: 'Lima' })).toContainText('1 lots · completed')
})

test('FR-4.2 refuses more than the lot has left, in the form and on the server', async ({
  page,
}) => {
  const seed = await seeder()
  const lima = await seed.product('Lima')
  const lot = await seed.lot(lima.id, 'L-2', { lotQty: 100 })
  await seed.receipt(lot.id, 80)
  await page.goto('/')
  const drawer = await openLot(page, 'L-2')
  await drawer.getByRole('tab', { name: 'GRN Receipts' }).click()
  const modal = await openReceipt(drawer, 'GRN late', 30)
  await modal.getByRole('button', { name: 'Save receipt' }).click()
  await expect(modal).toContainText('Only 20 units are left to receive on this lot.')
  // Another receipt arrives while the form is open; only the server can catch this one.
  await seed.receipt(lot.id, 15)
  await seed.done()
  await modal.getByLabel('Quantity', { exact: true }).fill('20')
  await modal.getByRole('button', { name: 'Save receipt' }).click()
  await expect(
    modal.locator('[data-invalid]').filter({ hasText: 'Quantity' }).getByRole('alert'),
  ).toContainText('Only 5 units are left to receive on this lot.')
})
```

Create `e2e/tests/completion-reversal.spec.ts`:

```ts
import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

async function completedLot() {
  const seed = await seeder()
  const mike = await seed.product('Mike')
  const lot = await seed.lot(mike.id, 'M-1', { lotQty: 50 })
  await seed.receipt(lot.id, 50, undefined, 'GRN full')
  await seed.done()
}

test('FR-4.3 deleting a receipt reopens a completed lot', async ({ page }) => {
  await completedLot()
  await page.goto('/')
  await goTo(page, 'Completed')
  const drawer = await openLot(page, 'M-1')
  await drawer.getByRole('tab', { name: 'GRN Receipts' }).click()
  page.once('dialog', (d) => d.accept())
  await drawer.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(drawer.getByText('No GRN receipts recorded.')).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).first().click()
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: 'Mike' })).toContainText('1 lots')
})

test('FR-4.3 lowering a receipt reopens a completed lot', async ({ page }) => {
  await completedLot()
  await page.goto('/')
  await goTo(page, 'Completed')
  const drawer = await openLot(page, 'M-1')
  await drawer.getByRole('tab', { name: 'GRN Receipts' }).click()
  await drawer.getByRole('button', { name: 'Edit', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Edit GRN receipt' })
  await modal.getByLabel('Quantity', { exact: true }).fill('45')
  await modal.getByRole('button', { name: 'Save receipt' }).click()
  await expect(drawer.getByText('Pending quantity').locator('..')).toContainText('5')
  await drawer.getByRole('button', { name: 'Close' }).first().click()
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: 'Mike' })).toContainText('1 lots')
})
```

Create `e2e/tests/month-end.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { dateLabel } from '@boat/domain/calculations'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo } from '../support/ui'

test.use({ storageState: authFile('admin') })

// Two lots planned for today, so both fall in the current month: 150 planned, 60 received.
async function seedMonth() {
  const seed = await seeder()
  const juliet = await seed.product('Juliet')
  const j1 = await seed.lot(juliet.id, 'J-1', { lotQty: 100, plannedDate: day() })
  await seed.lot(juliet.id, 'J-2', { lotQty: 50, plannedDate: day(), revisedEta: day(20) })
  await seed.receipt(j1.id, 60)
  await seed.done()
}

test('FR-5.1 shows the month-end figures for the lots planned this month', async ({ page }) => {
  await seedMonth()
  await page.goto('/')
  await goTo(page, 'Month-end Summary')
  await expect(page.getByText('Month in progress')).toBeVisible()
  const card = (help: string) => page.getByTitle(help)
  await expect(card('Lot quantity of lots planned for this month.')).toContainText('150')
  await expect(
    card('GRN for those lots dated on or before the last day of the month.'),
  ).toContainText('60')
  await expect(card('Planned units not yet received by month end.')).toContainText('90')
  await expect(card('Received as a share of planned units.')).toContainText('40%')
  await expect(
    card('Every receipt dated this month, including lots planned for other months.'),
  ).toContainText('60')
})

test('FR-5.2 lists short lots with their current ETA and opens them', async ({ page }) => {
  await seedMonth()
  await page.goto('/')
  await goTo(page, 'Month-end Summary')
  const row = page.getByRole('row', { name: /J-2/ })
  await expect(row).toContainText(dateLabel(day(20)))
  await row.click()
  await expect(page.getByRole('dialog', { name: 'J-2' })).toBeVisible()
})

test('FR-5.2 downloads the month-end CSV', async ({ page }) => {
  await seedMonth()
  await page.goto('/')
  await goTo(page, 'Month-end Summary')
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^month-end-\d{4}-\d{2}\.csv$/)
  const csv = readFileSync(await file.path(), 'utf8')
  expect(csv).toContain('J-1')
  expect(csv).toContain('J-2')
})
```

- [ ] **Step 5: Run them and confirm they fail**

Run: `pnpm build && pnpm e2e -- rm-batches.spec.ts grn.spec.ts completion-reversal.spec.ts month-end.spec.ts`
Expected: FAIL: batches and receipts saved in the drawer go to IndexedDB and never appear, and Month-end shows no lots.

- [ ] **Step 6: Write the reads and writes**

Create `apps/web/src/api/entries.ts`. `saveBatch` posts `batchInput(batch, lookups)` to `/lots/${lotId}/rm-batches` when `existing` is false and patches `/rm-batches/${batch.id}` when it is true, with `{ fields: batchField }`. `saveReceipt` does the same with `receiptInput(receipt)` against `/lots/${lotId}/grn-receipts` and `/grn-receipts/${receipt.id}`; a receipt's fields already have the form's names. The deletes call `DELETE /rm-batches/:id` and `DELETE /grn-receipts/:id`. Batches and receipts carry no version: the lot row lock on the server orders them, and the receipt total is checked there.

Create `apps/web/src/api/reports.ts`: `listMonths()` reads `GET /reports/months` and returns its items; `fetchMonthEnd(month)` reads `GET /reports/month-end?month=…`; `downloadMonthEndCsv(month)` downloads `/reports/month-end/export.csv?month=…`. Build the query with `queryString`.

In `apps/web/src/api/queries.ts`, add:

```ts
export const useMonths = () =>
  useQuery({ queryKey: [...keys.monthEnd, 'months'], queryFn: listMonths })
export const useMonthEnd = (month: string) =>
  useQuery({
    queryKey: [...keys.monthEnd, 'report', month],
    queryFn: () => fetchMonthEnd(month),
    placeholderData: keepPreviousData,
  })
```

- [ ] **Step 7: Save batches and receipts through the API**

In `apps/web/src/LotDrawer.tsx`, replace the four repository calls and drop the `./repository` import:

```tsx
  // A batch or receipt someone else deleted answers 404; reload the lot so it disappears.
  const entryFailed = (form: ReturnType<typeof useFormErrors>) => (e: unknown) => {
    form.fail(e)
    if (e instanceof NotFoundError) void refreshLots()
  }
  const saveBatchForm = async (e: FormEvent) => {
    e.preventDefault()
    if (!batch || !batchForm.check(validateBatch(batch))) return
    const existing = bs.some((b) => b.id === batch.id)
    const ok = await run(async () => {
      await saveBatch(draft.id, batch, lookups, existing)
      await refreshLots()
    }, entryFailed(batchForm))
    if (ok) setBatch(null)
  }
```

`saveReceiptForm` is the same with `validateReceipt(receipt, available(receipt))`, `saveReceipt(draft.id, receipt, rs.some((r) => r.id === receipt.id))` and `receiptForm`. The two delete buttons run `deleteBatch(b.id)` or `deleteReceipt(r.id)` followed by `refreshLots()`. The confirm texts stay.

- [ ] **Step 8: Read month-end from the API**

In `apps/web/src/MonthEnd.tsx`:

1. Drop the `data` prop; `onOpenLot` takes the lot id and `csvRef` is `MutableRefObject<CsvExport | null>`.
2. The month list is `useMonths().data ?? [current]`, where `current = monthOf(today())`, and the report is `useMonthEnd(month).data`. Until the first report arrives, render the existing `Empty` with the title "Loading month-end summary...".
3. Every figure comes from the report: the cards from `report.planned`, `received`, `shortfall`, `percent` and `grnInMonth`; "Month in progress" from `report.inProgress`; the product table from `report.products` (name and variant from `row.product`, segment from `row.product.segment.value`); the lot table from `report.lots`, with the planned date `row.lot.plannedDate ?? ''`, the ETA `row.lot.eta ?? ''`, the status from `row.statusToday`, the blocker from `row.lot.blockerDescription || (row.lot.blocker && row.lot.blocker.value !== 'None' && row.lot.blocker.value) || '—'`, and each row opening `onOpenLot(row.lot.id)`. Delete `product`, `productName` and `receiptsFor`, and key the product rows by `row.product.id`.
4. The CSV button downloads the server's file:

```tsx
  csvRef.current = async () => {
    if (!report?.lots.length) return false
    await downloadMonthEndCsv(month)
    return true
  }
```

Remove the `./repository` import and the calculation imports that are no longer used.

In `apps/web/src/App.tsx`, render `<MonthEnd onOpenLot={(id) => setLotTarget({ id })} csvRef={csvRef} />`.

- [ ] **Step 9: Run the specs and every check**

Run: `pnpm typecheck && pnpm test && pnpm --filter @boat/api test:int && pnpm build && pnpm e2e`
Expected: all pass, the e2e specs on both projects.

- [ ] **Step 10: Format and commit**

```bash
pnpm format
git add packages/domain apps/api apps/web e2e
git commit -m "Save batches and receipts, and read month-end, through the API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Finished Goods on the API

The shipment list, its cards and filters, the CSV, and the shipment drawer with its product lines, ETA revisions and notes read and write through the API. The list pages on the server like the lot list, and the drawer handles conflicts and deleted shipments as the lot drawer does.

**Files:**
- Create: `apps/web/src/api/shipments.ts`
- Modify: `apps/web/src/api/queries.ts`, `apps/web/src/drafts.ts`
- Modify: `apps/web/src/Shipments.tsx`, `apps/web/src/App.tsx`
- Modify: `e2e/support/seed.ts`
- Test: `e2e/tests/shipments.spec.ts`, `e2e/tests/eta-history.spec.ts`

**Interfaces:**
- Consumes: `api`, `download`, `queryString`, `ConflictError`, `NotFoundError` (Task 3); `toShipment`, `toLines`, `shipmentInput`, `shipmentField`, `values`, `ShipmentRecord` (Task 3); `keys`, `refreshShipments`, `useLookups`, `useProducts`, `Pager`, `ConflictBanner`, `CsvExport`, `defaultValue` (Task 6); `listActivity`, `addNote`, `activityKey`, `useActivity` (Task 7); `vessels` in `GET /shipments/summary` (Task 2).
- Produces:
  - `api/shipments.ts`: `type ShipmentQuery = { q: string; stageId?: string; vessel?: string; flag?: ShipmentFlag; sort: ShipmentSort }`, `shipmentPageSize` (50), `listShipments(query: ShipmentQuery, page: number): Promise<Page<ShipmentRecord>>`, `fetchShipmentSummary(): Promise<ShipmentCards>`, `type ShipmentView = { shipment: ShipmentRecord; lines: ShipmentItem[]; revisions: EtaRevisionItem[] }`, `toShipmentView(detail: ShipmentDetail): ShipmentView`, `fetchShipment(id: string): Promise<ShipmentView>`, `saveShipment(shipment: Shipment & { version?: number }, lines: ShipmentItem[], reason: string, lookups: LookupItem[]): Promise<ShipmentView>`, `deleteShipment(id: string): Promise<void>` and `downloadShipmentsCsv(query: ShipmentQuery): Promise<void>`.
  - `api/queries.ts`: `shipmentKey(id: string)`, `useShipments(query, page)`, `useShipmentSummary()` and `useShipment(id: string | undefined)`, all under `keys.shipments`.
  - `drafts.ts`: `newShipment(lookups: LookupItem[]): Shipment`.
  - `Shipments.tsx`: the default export `Shipments({ onOpen, csvRef }: { onOpen: (id: string) => void; csvRef: MutableRefObject<CsvExport | null> })`, `type ShipmentTarget = { id: string } | { draft: Shipment }` and `ShipmentDrawer({ target, onClose, onOpen, onGone, run })` with the same props as `LotDrawer`.
  - `e2e/support/seed.ts`: the seeder gains `shipment(number: string, fields: ShipmentFields)`, where `ShipmentFields = { vessel?: string; etd?: string; plannedEta?: string; revisedEta?: string; actualArrival?: string; stage?: string; items: { productId: string; quantity: number }[] }`.
  - `e2e/support/ui.ts`: `openShipment(page: Page, number: string): Promise<Locator>`.

- [ ] **Step 1: Write the helpers and the failing specs**

In `e2e/support/seed.ts`, add the `ShipmentFields` type above `seeder()` and this member to the object `seeder()` returns:

```ts
    shipment: async (number: string, fields: ShipmentFields) => {
      const { vessel = 'MSC Aurora', stage = 'In Transit', items, ...dates } = fields
      return api.post('/shipments', {
        number,
        vessel,
        etd: dates.etd ?? null,
        plannedEta: dates.plannedEta ?? null,
        revisedEta: dates.revisedEta ?? null,
        actualArrival: dates.actualArrival ?? null,
        stageId: await lookup('shipmentStage', stage),
        remarks: '',
        items,
      })
    },
```

Append to `e2e/support/ui.ts`:

```ts
// Shipments show as table rows on desktop and as cards on mobile.
export async function openShipment(page: Page, number: string) {
  await page.getByRole('textbox', { name: 'Search shipments' }).fill(number)
  await page.getByRole('main').getByText(number, { exact: true }).filter({ visible: true }).click()
  const drawer = page.getByRole('dialog', { name: number })
  await expect(drawer).toBeVisible()
  return drawer
}
```

Create `e2e/tests/shipments.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { choose, goTo, openShipment } from '../support/ui'

test.use({ storageState: authFile('admin') })

const shipment = (page: Page, number: string) =>
  page.getByRole('main').getByText(number, { exact: true }).filter({ visible: true })

test('FR-6.1 adds a shipment with two product lines, edits and deletes it', async ({ page }) => {
  const seed = await seeder()
  await seed.product('November')
  await seed.product('Oscar')
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  await page.getByRole('button', { name: 'Add Shipment' }).click()
  const drawer = page.getByRole('dialog', { name: 'New shipment' })
  await drawer.getByLabel('Shipment / invoice number', { exact: true }).fill('INV-1')
  await drawer.getByLabel('Vessel / flight', { exact: true }).fill('MSC Aurora')
  await choose(drawer, 'Product 1', 'November')
  await drawer.getByLabel('Quantity', { exact: true }).first().fill('100')
  await drawer.getByRole('button', { name: 'Add product line' }).click()
  await choose(drawer, 'Product 2', 'Oscar')
  await drawer.getByLabel('Quantity', { exact: true }).nth(1).fill('50')
  await drawer.getByRole('button', { name: 'Save & close' }).click()
  await expect(drawer).toBeHidden()
  await expect(shipment(page, 'INV-1')).toBeVisible()
  await expect(page.getByRole('main')).toContainText('150')

  const edit = await openShipment(page, 'INV-1')
  await expect(edit.getByLabel('Quantity', { exact: true })).toHaveCount(2)
  await edit.getByLabel('Vessel / flight', { exact: true }).fill('Maersk Kobe')
  await edit.getByRole('button', { name: 'Save & close' }).click()
  await expect(page.getByRole('main')).toContainText('Maersk Kobe')

  const remove = await openShipment(page, 'INV-1')
  page.once('dialog', (d) => d.accept())
  await remove.getByRole('button', { name: 'Delete shipment' }).click()
  await expect(remove).toBeHidden()
  await expect(page.getByText('No matching shipments')).toBeVisible()
})

test('FR-6.2 shows a product deleted mid-edit under its line', async ({ page }) => {
  const seed = await seeder()
  const papa = await seed.product('Papa')
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  await page.getByRole('button', { name: 'Add Shipment' }).click()
  const drawer = page.getByRole('dialog', { name: 'New shipment' })
  await drawer.getByLabel('Shipment / invoice number', { exact: true }).fill('INV-2')
  await drawer.getByLabel('Vessel / flight', { exact: true }).fill('MSC Aurora')
  await choose(drawer, 'Product 1', 'Papa')
  await seed.api.delete(`/products/${papa.id}`)
  await seed.done()
  await drawer.getByRole('button', { name: 'Save shipment' }).click()
  await expect(
    drawer.locator('[data-invalid]').filter({ hasText: 'Product 1' }).getByRole('alert'),
  ).toContainText('This product no longer exists.')
})

test('FR-6.1 shows the conflict banner when someone else saved the shipment first', async ({
  page,
}) => {
  const seed = await seeder()
  const quebec = await seed.product('Quebec')
  const saved = await seed.shipment('INV-3', { items: [{ productId: quebec.id, quantity: 10 }] })
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  const drawer = await openShipment(page, 'INV-3')
  await drawer.getByLabel('Remarks', { exact: true }).fill('Customs hold')
  await seed.api.patch(`/shipments/${saved.id}`, { vessel: 'Maersk Kobe', version: saved.version })
  await seed.done()
  await drawer.getByRole('button', { name: 'Save shipment' }).click()
  const banner = drawer
    .getByRole('alert')
    .filter({ hasText: 'Someone else changed this shipment while you were editing.' })
  await expect(banner).toBeVisible()
  await expect(drawer.getByLabel('Remarks', { exact: true })).toHaveValue('Customs hold')
  await banner.getByRole('button', { name: 'Reload' }).click()
  await expect(drawer.getByLabel('Vessel / flight', { exact: true })).toHaveValue('Maersk Kobe')
  await expect(drawer.getByLabel('Remarks', { exact: true })).toHaveValue('')
})

test('FR-6.5 filters by card and downloads the CSV of what is shown', async ({ page }) => {
  const seed = await seeder()
  const romeo = await seed.product('Romeo')
  const items = [{ productId: romeo.id, quantity: 5 }]
  await seed.shipment('INV-OPEN', { etd: day(-3), plannedEta: day(5), items })
  await seed.shipment('INV-DONE', {
    etd: day(-10),
    plannedEta: day(-2),
    actualArrival: day(-1),
    stage: 'Arrived',
    items,
  })
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  await page.getByRole('button', { name: /^Arrived/ }).click()
  await expect(shipment(page, 'INV-DONE')).toBeVisible()
  await expect(shipment(page, 'INV-OPEN')).toHaveCount(0)
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^shipments-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = readFileSync(await file.path(), 'utf8')
  expect(csv).toContain('INV-DONE')
  expect(csv).not.toContain('INV-OPEN')
})
```

Create `e2e/tests/eta-history.spec.ts`:

```ts
import { dateLabel } from '@boat/domain/calculations'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openShipment } from '../support/ui'

test.use({ storageState: authFile('admin') })

async function seedShipment() {
  const seed = await seeder()
  const sierra = await seed.product('Sierra')
  await seed.shipment('INV-ETA', {
    etd: day(-2),
    plannedEta: day(10),
    items: [{ productId: sierra.id, quantity: 40 }],
  })
  await seed.done()
}

test('FR-6.4 revising the ETA records the change with its reason', async ({ page }) => {
  await seedShipment()
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  const drawer = await openShipment(page, 'INV-ETA')
  await drawer.getByLabel('Current revised ETA', { exact: true }).fill(day(14))
  await drawer.getByLabel('ETA change reason', { exact: true }).fill('Port congestion')
  await drawer.getByRole('button', { name: 'Save shipment' }).click()
  await expect(drawer.getByLabel('ETA change reason', { exact: true })).toHaveValue('')
  // Creating the shipment wrote no revision; this change writes exactly one.
  const history = drawer.getByRole('tab', { name: /ETA revisions & history/ })
  await expect(history).toContainText('1')
  await history.click()
  await expect(drawer.getByText(dateLabel(day(10))).first()).toBeVisible()
  await expect(drawer.getByText(dateLabel(day(14))).first()).toBeVisible()
  await expect(drawer.getByText(/Port congestion/).first()).toBeVisible()
})

test('FR-7.2 posts a shipment note and lists it', async ({ page }) => {
  await seedShipment()
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  const drawer = await openShipment(page, 'INV-ETA')
  await drawer.getByRole('tab', { name: /ETA revisions & history/ }).click()
  await drawer.getByLabel('Shipment update note', { exact: true }).fill('Booked the truck')
  await drawer.getByRole('button', { name: 'Post update' }).click()
  await expect(drawer.getByText('Booked the truck')).toBeVisible()
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm build && pnpm e2e -- shipments.spec.ts eta-history.spec.ts`
Expected: FAIL: Finished Goods lists nothing and saves go to IndexedDB.

- [ ] **Step 3: Write the reads and writes**

Create `apps/web/src/api/shipments.ts` on the pattern of `api/lots.ts`:

- `listShipments(query, page)` gets `/shipments${queryString({ ...query, page, pageSize: shipmentPageSize })}` and maps the items with `toShipment`.
- `fetchShipmentSummary()` gets `/shipments/summary`.
- `toShipmentView(d)` is `{ shipment: toShipment(d), lines: toLines(d), revisions: d.etaRevisions }`, and `fetchShipment(id)` gets `/shipments/:id` through it.
- `saveShipment(shipment, lines, reason, lookups)` posts `shipmentInput(shipment, lines, lookups)` to `/shipments` without a version, and otherwise patches `/shipments/:id` with the input, `version`, and `etaChangeReason: reason.trim()` when it isn't empty. Both pass `{ fields: shipmentField(lines) }`, so a server error on `items.1.productId` lands on the second line, and both return the reply through `toShipmentView`.
- `deleteShipment(id)` and `downloadShipmentsCsv(query)` (`/shipments/export.csv` with the query, without paging).

In `apps/web/src/api/queries.ts`, add `shipmentKey(id)` as `[...keys.shipments, 'detail', id]`, and `useShipments(query, page)` (key `[...keys.shipments, 'list', query, page]`, `placeholderData: keepPreviousData`), `useShipmentSummary()` (key `[...keys.shipments, 'summary']`) and `useShipment(id)` (`enabled: !!id`), as the lot hooks are written.

In `apps/web/src/drafts.ts`, add `newShipment(lookups)`: the blank shipment from `Shipments.tsx`'s `newShipment`, with `stage: defaultValue(lookups, 'shipmentStage', 'In Transit')`. Delete `newShipment` from `Shipments.tsx`.

- [ ] **Step 4: Replace the list**

In `apps/web/src/Shipments.tsx`, the list keeps its layout and reads the server:

1. The props are `{ onOpen: (id: string) => void; csvRef }`. Keep `search`, `stage`, `vessel`, `sort` and `quick` as state, plus `page`. Build `const query: ShipmentQuery = { q: search, stageId: lookupId(lookups, 'shipmentStage', stage) ?? undefined, vessel: vessel || undefined, flag: quick ? (quick as ShipmentFlag) : undefined, sort: sort as ShipmentSort }`, and return to page 1 whenever it changes:

```tsx
  const queryText = JSON.stringify(query)
  useEffect(() => setPage(1), [queryText])
```

2. The cards read `useShipmentSummary().data`: In Transit is `open`, Arriving in 3 Days `soon`, then `overdue`, `revised`, `arrived`, and Units in Transit `openUnits`. Clicking a card toggles `quick` as now.
3. The rows are `useShipments(query, page).data?.items ?? []`. Each row shows its product names from `s.lines.map((l) => l.product.name)`, the quantity from `s.computed.totalQty`, the current ETA from `s.computed.currentEta ?? ''`, the status from `s.computed.status`, the slip from `s.computed.etaSlip` and the arrival delay from `s.computed.arrivalDelay`, and opens `onOpen(s.id)`. The count line reads `{list.total} shipments`; drop the "total" badge. The stage filter lists `values(lookups, 'shipmentStage')` and the vessel filter `summary.vessels`. Put `<Pager page={page} pageSize={shipmentPageSize} total={list.total} onPage={setPage} />` under the table and the cards.
4. The CSV:

```tsx
  csvRef.current = async () => {
    if (!list?.total) return false
    await downloadShipmentsCsv(query)
    return true
  }
```

Remove the in-browser filtering, sorting, `items()`, `count()` and the CSV builder, and the calculation imports they used.

- [ ] **Step 5: Replace the drawer's data**

`ShipmentDrawer` follows `LotDrawer` from Task 7:

1. The default-export split: `ShipmentDrawer({ target, ...props })` loads `useShipment(id)` and `useLookups()`, calls `onGone()` on a `NotFoundError`, shows a loading sheet titled "Shipment details" until both arrive, then renders `ShipmentEditor` with `view: ShipmentView | null` (null for a draft) and `initial`. A draft starts with one blank line, as now.
2. `adopt(view)` sets the draft, the lines and the baseline, and runs when `view` changes while nothing is dirty.
3. `save`:

```tsx
  const failed = (e: unknown) => {
    if (e instanceof ConflictError && e.current)
      return setConflict(toShipmentView(e.current as ShipmentDetail))
    if (e instanceof NotFoundError) return onGone()
    form.fail(e)
  }
  const save = async (closeAfter = false) => {
    setTab('details')
    if (!form.check(validateShipment(draft, lines))) return
    let saved: ShipmentView | undefined
    const ok = await run(async () => {
      saved = await saveShipment(draft, lines, reason, lookups)
      queryClient.setQueryData(shipmentKey(saved.shipment.id), saved)
      await refreshShipments()
    }, failed)
    if (!ok || !saved) return
    if (closeAfter) return onClose()
    if (!view) return onOpen(saved.shipment.id)
    adopt(saved)
    setReason('')
  }
```

4. The banner is `<ConflictBanner record="shipment" … />` above the form error; **Reload** puts the conflict's view in the cache, adopts it and clears the form errors.
5. `remove` calls `deleteShipment(draft.id)` and `refreshShipments()` inside `run`, with `failed`.
6. The history tab lists `view?.revisions ?? []` (already newest first; `r.reason` and `r.createdAt` as now) and `useActivity('shipments', view?.shipment.id).data ?? []`, showing `actorName`. Posting a note runs `addNote('shipments', draft.id, note)` and invalidates `activityKey('shipments', draft.id)`.
7. The product options are `productChoices(useProducts().data ?? [])`, the stage options `values(lookups, 'shipmentStage')`, and `stored` becomes `!!view`.

Remove the `./repository` and `./demo` imports from `Shipments.tsx`.

- [ ] **Step 6: Open shipments by id**

In `apps/web/src/App.tsx`, replace the `selectedShipment` state with `const [shipmentTarget, setShipmentTarget] = useState<ShipmentTarget | null>(null)` and delete `selectedShipmentLive`. The Add Shipment button opens `{ draft: newShipment(lookups) }`, `<Shipments onOpen={(id) => setShipmentTarget({ id })} csvRef={csvRef} />` opens by id, `reset` clears it, and the drawer element is:

```tsx
        {shipmentTarget && (
          <ShipmentDrawer
            key={'id' in shipmentTarget ? shipmentTarget.id : 'new'}
            target={shipmentTarget}
            onClose={() => setShipmentTarget(null)}
            onOpen={(id) => setShipmentTarget({ id })}
            onGone={() => {
              setShipmentTarget(null)
              setSaveState('idle')
              setMessage('This shipment was deleted.')
            }}
            run={run}
          />
        )}
```

- [ ] **Step 7: Run the specs and every check**

Run: `pnpm typecheck && pnpm --filter @boat/web test && pnpm build && pnpm e2e`
Expected: all pass on both projects.

- [ ] **Step 8: Format and commit**

```bash
pnpm format
git add apps/web e2e
git commit -m "Read and write shipments through the API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Settings, users and backups on the API

Settings edits dropdown values and the company settings through the API, and admins get the user list in place of the old roles card. Export downloads the server's backup, import previews the file with `@boat/domain/backup` and uploads it, and reset asks for the typed phrase.

**Files:**
- Modify: `packages/domain/src/api.ts`, `apps/api/src/contract.ts` (`ResetResult`)
- Modify: `apps/web/src/api/lookups.ts`, `apps/web/src/api/queries.ts`
- Create: `apps/web/src/api/admin.ts`, `apps/web/src/api/admin.test.ts`
- Create: `apps/web/src/Users.tsx`
- Modify: `apps/web/src/Settings.tsx`, `apps/web/src/App.tsx`
- Test: `e2e/tests/settings.spec.ts`, `e2e/tests/users.spec.ts`, `e2e/tests/backup.spec.ts`

**Interfaces:**
- Consumes: `api`, `download`, `queryString` (Task 3); `lookupId`, `values` (Task 3); `useAuth`, `fetchMe` (Task 5); `keys`, `refreshEverything`, `useLookups` (Task 6); `newUser`, `apiAs`, `signInApi`, `emailsTo`, `nextEmail`, `tokenIn` (Task 4); `parseImport` from `@boat/domain/backup`; `validateAccount`, `validateLookupValue` from `@boat/domain/validation`.
- Produces:
  - `@boat/domain/api`: `type ResetResult = { deleted: Record<'shipmentItems' | 'shipments' | 'grnReceipts' | 'rmBatches' | 'lotComponents' | 'lots' | 'products', number> }`.
  - `api/lookups.ts`: `addLookup(kind: LookupKind, value: string): Promise<void>`, `renameLookup(id: string, value: string): Promise<void>` and `deleteLookup(id: string): Promise<void>`.
  - `api/admin.ts`:
    - `fetchSettings(): Promise<Settings>` and `saveSettings(patch: Partial<Settings>): Promise<Settings>`.
    - `type UserForm = { name: string; email: string; role: Role; poc: string }` (the POC as its dropdown text), `userInput(form: UserForm, lookups: LookupItem[]): NewUser`, `userField(name: string): string` (`pocId` → `poc`).
    - `listUsers(): Promise<UserItem[]>` (one page of 200), `inviteUser(input: NewUser): Promise<InviteResult>`, `resendInvite(id: string): Promise<InviteResult>`, `updateUser(id: string, patch: UserPatch): Promise<UserItem>` and `deleteUser(id: string): Promise<void>`, each write with `{ fields: userField }`.
    - `exportBackup(): Promise<void>`, `importBackup(raw: unknown, mode: 'merge' | 'replace'): Promise<ImportResult>` and `resetAllData(confirm: string): Promise<ResetResult>`.
  - `api/queries.ts`: `useSettings()` (key `keys.settings`) and `useUsers(enabled: boolean)` (key `keys.users`).
  - `Users.tsx`: the default export `Users({ run, onMessage }: { run: Run; onMessage: (text: string) => void })`.
  - `Settings.tsx`: `Settings({ run, onImport, onExport, onReset, onMessage })`; the `data` prop and `performReset` are gone.

- [ ] **Step 1: Write the failing unit test**

Create `apps/web/src/api/admin.test.ts`:

```ts
import type { LookupItem } from '@boat/domain/api'
import { describe, expect, it } from 'vitest'
import { userField, userInput } from './admin'

const lookups: LookupItem[] = [
  { id: 'p1', kind: 'poc', value: 'Maya Shah', sort: 0, system: false },
]

describe('userInput', () => {
  it('sends the POC as its id, only for POC users', () => {
    expect(
      userInput({ name: ' Ravi ', email: ' Ravi@Example.com ', role: 'poc', poc: 'maya shah' }, lookups),
    ).toEqual({ name: 'Ravi', email: 'ravi@example.com', role: 'poc', pocId: 'p1' })
    expect(
      userInput({ name: 'Ravi', email: 'ravi@example.com', role: 'planner', poc: 'Maya Shah' }, lookups),
    ).toEqual({ name: 'Ravi', email: 'ravi@example.com', role: 'planner', pocId: null })
  })
  it('names the POC field as the form does', () => {
    expect(userField('pocId')).toBe('poc')
    expect(userField('email')).toBe('email')
  })
})
```

Run: `pnpm --filter @boat/web test -- admin`
Expected: FAIL, `./admin` doesn't exist.

- [ ] **Step 2: Write the API helpers**

Add `ResetResult` to `packages/domain/src/api.ts`, and in `apps/api/src/contract.ts` check `resetData`'s result against it as the file already checks `importBackup`'s against `ImportResult` (the route wraps it as `{ deleted }`).

In `apps/web/src/api/lookups.ts`, add the three writes: `POST /lookups` with `{ kind, value }`, `PATCH /lookups/:id` with `{ value }` and `DELETE /lookups/:id`.

Create `apps/web/src/api/admin.ts` with the functions in the Interfaces block. `userInput` trims the name, normalizes the email with `normalizeEmail` from `@boat/domain/validation`, and sends `pocId: lookupId(lookups, 'poc', form.poc)` only when `role === 'poc'`, otherwise `null`. `importBackup` posts the parsed file to `/data/import${queryString({ mode })}`; `exportBackup` downloads `/data/export`; `resetAllData(confirm)` posts `{ confirm }` to `/data/reset`.

In `apps/web/src/api/queries.ts`, add `useSettings()` and `useUsers(enabled)`, the latter with `enabled` so only admins ask for the list.

Run: `pnpm --filter @boat/web test -- admin && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Write the failing specs**

Create `e2e/tests/settings.spec.ts`:

```ts
import { authFile } from '../support/env'
import { apiAs } from '../support/api'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, toast } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('FR-8.1 adds, renames and deletes a dropdown value', async ({ page }) => {
  await page.goto('/')
  await goTo(page, 'Settings')
  await page.getByRole('button', { name: 'Logistics modes' }).click()
  await page.getByLabel('New logistics mode', { exact: true }).fill('Hyperloop')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('main').getByText('Hyperloop', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Rename Hyperloop' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename dropdown value' })
  await rename.getByLabel('Value', { exact: true }).fill('Hyperloop Freight')
  await rename.getByRole('button', { name: 'Save value' }).click()
  await expect(page.getByRole('main').getByText('Hyperloop Freight', { exact: true })).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete Hyperloop Freight' }).click()
  await expect(page.getByRole('main').getByText('Hyperloop Freight', { exact: true })).toHaveCount(0)
})

test('FR-8.3 refuses to delete a value in use', async ({ page }) => {
  const seed = await seeder()
  const uniform = await seed.product('Uniform')
  await seed.lot(uniform.id, 'U-1', { logistics: 'Barge' })
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Settings')
  await page.getByRole('button', { name: 'Logistics modes' }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete Barge' }).click()
  await expect(toast(page)).toContainText('Barge is in use. Reassign those records first.')
})

test('saves the idle sign-out time', async ({ page }) => {
  await page.goto('/')
  await goTo(page, 'Settings')
  try {
    await page.getByLabel('Idle sign-out (minutes)', { exact: true }).fill('30')
    await page.getByRole('button', { name: 'Save sign-in settings' }).click()
    await expect(toast(page)).toContainText('Settings saved.')
    const admin = await apiAs('admin')
    expect((await admin.get('/settings')).idleTimeoutMinutes).toBe(30)
    await admin.dispose()
  } finally {
    const admin = await apiAs('admin')
    await admin.patch('/settings', { idleTimeoutMinutes: 15 })
    await admin.dispose()
  }
})
```

Create `e2e/tests/users.spec.ts`:

```ts
import type { Page } from '@playwright/test'
import { acceptInvite, apiAs, newUser, signInApi } from '../support/api'
import { authFile, pocValue, users } from '../support/env'
import { emailsTo, nextEmail, tokenIn } from '../support/mail'
import { expect, test } from '../support/test'
import { choose, goTo, toast } from '../support/ui'

test.use({ storageState: authFile('admin') })

const row = (page: Page, email: string) =>
  page.getByRole('list', { name: 'Users' }).getByRole('listitem').filter({ hasText: email })

async function openUsers(page: Page) {
  await page.goto('/')
  await goTo(page, 'Settings')
}

test('invites a user, who shows as active once they accept', async ({ page }) => {
  const email = `invitee-${Date.now().toString(36)}@e2e.test`
  await openUsers(page)
  await page.getByRole('button', { name: 'Invite user' }).click()
  const form = page.getByRole('dialog', { name: 'Invite user' })
  await form.getByLabel('Name', { exact: true }).fill('Ivy Invitee')
  await form.getByLabel('Email', { exact: true }).fill(email)
  await form.getByLabel('Role', { exact: true }).selectOption('planner')
  await form.getByRole('button', { name: 'Send invite' }).click()
  await expect(toast(page)).toContainText(`Invite sent to ${email}.`)
  await expect(row(page, email)).toContainText('Invited')
  const { ctx } = await acceptInvite(tokenIn((await nextEmail(email, 0)).text))
  await ctx.dispose()
  await page.reload()
  await expect(row(page, email)).toContainText('Active')
})

test('edits a role and POC link', async ({ page }) => {
  const user = await newUser('viewer')
  await openUsers(page)
  await row(page, user.email).getByRole('button', { name: 'Edit' }).click()
  const form = page.getByRole('dialog', { name: 'Edit user' })
  await form.getByLabel('Role', { exact: true }).selectOption('poc')
  await choose(form, 'Point of contact', pocValue)
  await form.getByRole('button', { name: 'Save user' }).click()
  await expect(row(page, user.email)).toContainText('POC')
  await expect(row(page, user.email)).toContainText(pocValue)
})

test('resends an invite', async ({ page }) => {
  const email = `resend-${Date.now().toString(36)}@e2e.test`
  const admin = await apiAs('admin')
  await admin.post('/users', { email, name: 'Rae Resend', role: 'viewer', pocId: null })
  await admin.dispose()
  await nextEmail(email, 0)
  await openUsers(page)
  await row(page, email).getByRole('button', { name: 'Resend invite' }).click()
  await expect(toast(page)).toContainText(`Invite sent to ${email}.`)
  await expect.poll(() => emailsTo(email).length).toBe(2)
})

test('disables, re-enables and deletes a user', async ({ page }) => {
  const user = await newUser('viewer')
  await openUsers(page)
  await row(page, user.email).getByRole('button', { name: 'Disable' }).click()
  await expect(row(page, user.email)).toContainText('Disabled')
  await expect(signInApi(user.email, user.password)).rejects.toThrow()
  await row(page, user.email).getByRole('button', { name: 'Enable' }).click()
  await expect(row(page, user.email)).toContainText('Active')
  await (await signInApi(user.email, user.password)).dispose()
  page.once('dialog', (d) => d.accept())
  await row(page, user.email).getByRole('button', { name: 'Delete' }).click()
  await expect(row(page, user.email)).toHaveCount(0)
})

test('keeps the last admin', async ({ page }) => {
  await openUsers(page)
  await row(page, users.admin.email).getByRole('button', { name: 'Edit' }).click()
  const form = page.getByRole('dialog', { name: 'Edit user' })
  await form.getByLabel('Role', { exact: true }).selectOption('planner')
  await form.getByRole('button', { name: 'Save user' }).click()
  await expect(form).toContainText(
    `${users.admin.name} is the last active admin. Make someone else an admin first.`,
  )
  const admin = await apiAs('admin')
  expect((await admin.get('/auth/me')).user.role).toBe('admin')
  await admin.dispose()
})
```

No spec creates an admin user, so the seeded admin stays the only one and the last-admin rule applies.

Create `e2e/tests/backup.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { authFile, repo } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, toast } from '../support/ui'

test.use({ storageState: authFile('admin') })

const sample = path.join(repo, 'docs/sample-test-backup.json')

async function openImport(page: Page) {
  await page.goto('/')
  await goTo(page, 'Settings')
  await page.getByRole('button', { name: 'Import JSON backup' }).click()
  return page.getByRole('dialog', { name: 'Import JSON backup' })
}

test('FR-9.1 exports every record as a JSON backup', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Victor')
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Settings')
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export all records as JSON' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^boat-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const backup = JSON.parse(readFileSync(await file.path(), 'utf8'))
  expect(backup.data.products.map((p: { name: string }) => p.name)).toContain('Victor')
})

test('FR-9.3 merges the sample backup into the current records', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Whiskey')
  await seed.done()
  const dialog = await openImport(page)
  await dialog.getByLabel('Backup file', { exact: true }).setInputFiles(sample)
  await expect(dialog).toContainText('sample-test-backup.json')
  await dialog.getByRole('button', { name: 'Import records' }).click()
  await expect(toast(page)).toContainText('Merged 4 products, 4 lots, and 3 shipments.')
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: /^Test EchoPods Lite/ })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Whiskey' })).toBeVisible()
})

test('FR-9.3 replaces the current records with the sample backup', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Xray')
  await seed.done()
  const dialog = await openImport(page)
  await dialog.getByLabel('Backup file', { exact: true }).setInputFiles(sample)
  await dialog.getByRole('radio', { name: /^Replace/ }).check()
  page.once('dialog', (d) => d.accept())
  await dialog.getByRole('button', { name: 'Import records' }).click()
  await expect(toast(page)).toContainText('Replaced 4 products, 4 lots, and 3 shipments.')
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: /^Test EchoPods Lite/ })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Xray' })).toHaveCount(0)
})

test('FR-9.3 checks a backup in the browser before uploading it', async ({ page }) => {
  const dialog = await openImport(page)
  await dialog.getByLabel('Backup file', { exact: true }).setInputFiles({
    name: 'not-a-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"app":"Something else"}'),
  })
  await expect(dialog).toContainText('Unsupported JSON backup or schema version.')
  await expect(dialog.getByRole('button', { name: 'Import records' })).toBeDisabled()
})

test('FR-9.2 resets the records after the typed phrase', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Yankee')
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Settings')
  await page.getByRole('button', { name: 'Reset all application data' }).click()
  const dialog = page.getByRole('dialog', { name: 'Reset all data' })
  const confirm = dialog.getByRole('button', { name: 'Reset all data' })
  await dialog.getByLabel('Type RESET ALL DATA to confirm', { exact: true }).fill('reset')
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Type RESET ALL DATA to confirm', { exact: true }).fill('RESET ALL DATA')
  await confirm.click()
  await expect(toast(page)).toContainText('Deleted 1 products, 0 lots and 0 shipments.')
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: 'Yankee' })).toHaveCount(0)
})
```

The sample backup's first product is "Test EchoPods Lite" with a variant, so the group name is matched by its start.

- [ ] **Step 4: Run them and confirm they fail**

Run: `pnpm build && pnpm e2e -- settings.spec.ts users.spec.ts backup.spec.ts`
Expected: FAIL: Settings still reads IndexedDB, there is no user list, and the backup buttons act on the browser's database.

- [ ] **Step 5: Move Settings onto the API**

In `apps/web/src/Settings.tsx`:

1. Drop the `data` prop, `performReset`, and the `./db`, `./repository` and `isSystemLookup` imports. The dropdown list is `useLookups().data` filtered by kind and sorted by `sort`; "Required" and the disabled rename and delete buttons read `item.system`.
2. `add` runs `addLookup(kind, value)`, `rename` runs `renameLookup(editing.id, editValue)`, and the delete button runs `deleteLookup(item.id)`, each followed by `refreshEverything()` inside `run`, since dropdown text appears in every record. The add and rename forms keep `validateLookupValue` and their `fail` handlers; a 409 such as "Barge is in use. Reassign those records first." reaches the toast through `run`.
3. In the right-hand column, for users who can `manageSettings`, put `<Users run={run} onMessage={onMessage} />` first and then a "Sign-in" card: `Field` "Idle sign-out (minutes)" (a number `Input`, 5 to 720) and `Field` "Company time zone" (a `SearchSelect` over `Intl.supportedValuesOf('timeZone')`), both filled from `useSettings().data`, with a "Save sign-in settings" button. Saving runs `saveSettings({ idleTimeoutMinutes, timeZone })`, invalidates `keys.settings`, and calls `auth.signedIn(await fetchMe())` so this browser's idle timer uses the new value at once; the message is "Settings saved." The server's 422 fields (`idleTimeoutMinutes`, `timeZone`) show under the two fields.
4. Change the Data management text to: "Records are stored on the server and shared by every user. Export a JSON backup for a copy you keep." Delete the "Local workspace" card.

- [ ] **Step 6: Write the user list**

Create `apps/web/src/Users.tsx`. It reads `useUsers(true).data` and `useLookups().data`, and renders a `Card` titled "Users" with an "Invite user" button and `<ul aria-label="Users">`, one `<li>` per user showing the name, email, `roleInfo[role].label`, the status as "Invited", "Active" or "Disabled", the POC value (when set), and "Last sign-in" with `new Date(lastLoginAt).toLocaleString()` or "Never". Each row has these buttons:

- **Edit** opens the form titled "Edit user" (name, role and POC; the email isn't editable).
- **Resend invite**, for invited users, runs `resendInvite(id)`.
- **Disable** (active users) and **Enable** (disabled users) run `updateUser(id, { status })`.
- **Delete** asks `Delete ${name}? They will no longer be able to sign in.` and runs `deleteUser(id)`.

The form is a `Modal` titled "Invite user" or "Edit user" with `Field`s "Name", "Email" (invite only), "Role" (a `Select` of `roles` with `roleInfo` labels) and, when the role is `poc`, "Point of contact" (a `SearchSelect` of `values(lookups, 'poc')`). Its submit button is "Send invite" or "Save user". Before saving, it checks `validateAccount(userInput(form, lookups))` with the error keys renamed by `userField` (a POC value that can't be found becomes a missing `pocId`, so "Choose the point of contact this user owns." lands under the POC field), and shows server errors through `useFormErrors().fail`. A 409 such as the last-admin rule shows as the form's error.

Every write runs inside `run` and then invalidates `keys.users`. After an invite or a resend, `onMessage` gets `Invite sent to ${email}.`, or, when `inviteEmailSent` is false, `${email} was invited, but the email didn't send. Use Resend invite to try again.`

- [ ] **Step 7: Move export, import and reset onto the API**

In `apps/web/src/App.tsx`:

1. `exportJson` runs `exportBackup()` and keeps its messages.
2. `readImport` keeps `parseImport(raw)` for the preview and the error. `commitImport` keeps the replace confirm, runs `importBackup(importRaw, importMode)` then `refreshEverything()`, and reports the server's counts:

```tsx
      const { imported } = result
      setMessage(
        `${importMode === 'merge' ? 'Merged' : 'Replaced'} ${imported.products} products, ${imported.lots} lots, and ${imported.shipments} shipments.`,
      )
```

3. Reset opens a `Modal` titled "Reset all data" with a `Field` "Type RESET ALL DATA to confirm" and a danger button "Reset all data", disabled until the input is exactly `RESET ALL DATA`. It runs `resetAllData(phrase)` then `refreshEverything()`, closes the modal, returns to Production, clears the open lot and shipment, and shows `Deleted ${deleted.products} products, ${deleted.lots} lots and ${deleted.shipments} shipments.`
4. Pass `<Settings run={run} onImport={openImport} onExport={exportJson} onReset={() => setResetOpen(true)} onMessage={…} />` without `data`. Remove `exportData`, `importData` and `downloadFile` from the `./repository` import; keep `parseImport`, importing it from `@boat/domain/backup`.

- [ ] **Step 8: Run the specs and every check**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm e2e`
Expected: all pass on both projects.

- [ ] **Step 9: Format and commit**

```bash
pnpm format
git add packages/domain apps/api apps/web e2e
git commit -m "Manage dropdowns, users and backups through the API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Remove IndexedDB, and pin roles, persistence and mobile

Nothing reads the browser database any more, so it goes, with Dexie, the demo data, the PIN helpers and the `models`, `calculations` and `validation` shims (Phase 1, departure 6). Three specs cover what only the finished app can show: each role's limits across every screen, data that survives a refresh and reaches another user, and the 390 px layout.

**Files:**
- Delete: `apps/web/src/db.ts`, `apps/web/src/repository.ts`, `apps/web/src/demo.ts`, `apps/web/src/models.ts`, `apps/web/src/calculations.ts`, `apps/web/src/validation.ts`
- Modify: `apps/web/package.json` (drop `dexie` and `dexie-react-hooks`), `pnpm-lock.yaml`
- Modify: `apps/web/src/access.ts`, `apps/web/src/App.tsx`, and the imports of `LotDrawer.tsx`, `MonthEnd.tsx`, `Production.tsx`, `Settings.tsx`, `Shipments.tsx`, `Users.tsx`, `drafts.ts` and `ui.tsx`
- Test: `e2e/tests/roles.spec.ts`, `e2e/tests/persistence.spec.ts`, `e2e/tests/mobile.spec.ts`

**Interfaces:**
- Consumes: everything the screens use from Tasks 5–10; `seeder()` with `shipment` (Task 9); `openLot`, `openShipment`, `goTo`, `openMenu` (Tasks 5, 7, 9).
- Produces:
  - `access.ts` exports only `AccessUser`, `AccessState`, `accessFrom(me)`, `can(action, state)`, `AccessContext`, `useAccess()` and the re-exports from `@boat/domain/permissions`. `can` takes the state explicitly; `setAccess`, `actorName`, `lotAccess`, `requireAction`, `requireLotEdit` and every PIN, salt, recovery-key and stored-session helper are gone.

- [ ] **Step 1: Write the failing specs**

Create `e2e/tests/roles.spec.ts`:

```ts
import { apiAs } from '../support/api'
import { authFile, pocValue } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openLot, openShipment } from '../support/ui'

async function seedRecords() {
  const seed = await seeder()
  const zulu = await seed.product('Zulu')
  const own = await seed.lot(zulu.id, 'Z-own', { poc: pocValue })
  const other = await seed.lot(zulu.id, 'Z-other', { poc: 'Omar Other' })
  await seed.shipment('INV-Z', { items: [{ productId: zulu.id, quantity: 5 }] })
  await seed.done()
  return { own, other }
}

test.describe('a viewer', () => {
  test.use({ storageState: authFile('viewer') })

  test('browses every screen without write controls', async ({ page }) => {
    await seedRecords()
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Add Product' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add lot' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'CSV' })).toBeVisible()
    const lot = await openLot(page, 'Z-own')
    await expect(lot).toContainText("View only. Viewer users can't change this lot.")
    await expect(lot.getByRole('button', { name: 'Save lot' })).toHaveCount(0)
    await lot.getByRole('button', { name: 'Close' }).first().click()
    await goTo(page, 'Finished Goods')
    await expect(page.getByRole('button', { name: 'Add Shipment' })).toHaveCount(0)
    const shipment = await openShipment(page, 'INV-Z')
    await expect(shipment.getByRole('button', { name: 'Save shipment' })).toHaveCount(0)
    await shipment.getByRole('button', { name: 'Close' }).first().click()
    await goTo(page, 'Settings')
    await expect(page.getByText('Values used in forms and filters. Only admins can change them.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Invite user' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export all records as JSON' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Import JSON backup' })).toHaveCount(0)
  })
})

test.describe('a planner', () => {
  test.use({ storageState: authFile('planner') })

  test('edits records but cannot delete lots or change Settings', async ({ page }) => {
    const { own } = await seedRecords()
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Add Product' })).toBeVisible()
    const lot = await openLot(page, 'Z-own')
    await expect(lot.getByRole('button', { name: 'Save lot' })).toBeVisible()
    await expect(lot.getByRole('button', { name: 'Delete lot' })).toHaveCount(0)
    await lot.getByRole('button', { name: 'Close' }).first().click()
    await goTo(page, 'Settings')
    await expect(page.getByRole('button', { name: 'Export all records as JSON' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import JSON backup' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Invite user' })).toHaveCount(0)
    const planner = await apiAs('planner')
    await expect(planner.delete(`/lots/${own.id}`)).rejects.toThrow(/answered 403/)
    await planner.dispose()
  })
})

test.describe('a POC user', () => {
  test.use({ storageState: authFile('poc') })

  test('updates progress on their own lots only', async ({ page }) => {
    const { own, other } = await seedRecords()
    await page.goto('/')
    const mine = await openLot(page, 'Z-own')
    await expect(mine.getByLabel('Lot quantity', { exact: true })).toBeDisabled()
    await mine.getByLabel('Follow-up note', { exact: true }).fill('Line booked for Monday')
    await mine.getByRole('button', { name: 'Save & close' }).click()
    await expect(mine).toBeHidden()
    const poc = await apiAs('poc')
    expect((await poc.get(`/lots/${own.id}`)).followUpNote).toBe('Line booked for Monday')

    const theirs = await openLot(page, 'Z-other')
    await expect(theirs).toContainText(
      "View only. POC users can't change this lot because its POC is Omar Other.",
    )
    await expect(theirs.getByRole('button', { name: 'Save lot' })).toHaveCount(0)
    // The server refuses the save the screen hides.
    await expect(
      poc.patch(`/lots/${other.id}`, { followUpNote: 'forced', version: other.version }),
    ).rejects.toThrow(/answered 403/)
    await poc.dispose()
  })
})
```

Create `e2e/tests/persistence.spec.ts`:

```ts
import { authFile } from '../support/env'
import { expect, test } from '../support/test'

test.use({ storageState: authFile('admin') })

test('a refresh, and another user, see the same records', async ({ page, browser }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Product' }).click()
  const add = page.getByRole('dialog', { name: 'Add product' })
  await add.getByLabel('Product name', { exact: true }).fill('Kept Product')
  await add.getByRole('button', { name: 'Save product' }).click()
  await expect(page.getByRole('group', { name: 'Kept Product' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('group', { name: 'Kept Product' })).toBeVisible()

  const other = await browser.newContext({
    storageState: authFile('viewer'),
    viewport: page.viewportSize(),
  })
  const viewer = await other.newPage()
  await viewer.goto('/')
  await expect(viewer.getByRole('group', { name: 'Kept Product' })).toBeVisible()
  await other.close()
})
```

Create `e2e/tests/mobile.spec.ts`:

```ts
import type { Page } from '@playwright/test'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openLot, openShipment } from '../support/ui'

test.use({ storageState: authFile('admin') })

const screens = [
  'Production Tracker',
  'Completed',
  'Month-end Summary',
  'Finished Goods',
  'Settings',
]
const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function seedSome() {
  const seed = await seeder()
  const alpha = await seed.product('Alpha Long Product Name', { variant: 'Midnight Black' })
  const lot = await seed.lot(alpha.id, 'A-1', { plannedDate: day(), lotQty: 1200 })
  await seed.receipt(lot.id, 300)
  await seed.shipment('INV-MOBILE-0001', { items: [{ productId: alpha.id, quantity: 900 }] })
  await seed.done()
  return lot
}

test('no screen scrolls sideways', async ({ page }) => {
  await seedSome()
  await page.goto('/')
  for (const screen of screens) {
    await goTo(page, screen)
    expect(await noSideScroll(page), screen).toBe(true)
  }
})

test('the menu, drawers and forms are usable', async ({ page }) => {
  await seedSome()
  await page.goto('/')
  const lot = await openLot(page, 'A-1')
  const width = page.viewportSize()!.width
  expect((await lot.boundingBox())!.width).toBeLessThanOrEqual(width)
  await lot.getByLabel('Follow-up note', { exact: true }).fill('Checked on a phone')
  await lot.getByRole('button', { name: 'Save & close' }).click()
  await expect(lot).toBeHidden()
  await goTo(page, 'Finished Goods')
  const shipment = await openShipment(page, 'INV-MOBILE-0001')
  expect((await shipment.boundingBox())!.width).toBeLessThanOrEqual(width)
  await shipment.getByLabel('Remarks', { exact: true }).fill('Checked on a phone')
  await shipment.getByRole('button', { name: 'Save & close' }).click()
  await expect(shipment).toBeHidden()
  expect(await noSideScroll(page)).toBe(true)
})
```

Both run on the desktop project as well, where the same checks hold.

- [ ] **Step 2: Run them against the switched screens**

Run: `pnpm build && pnpm e2e -- roles.spec.ts persistence.spec.ts mobile.spec.ts`
Expected: PASS, since Tasks 6–10 moved every screen onto the API; this task removes code, and these specs guard what the removal must not break. A failure here is a bug in an earlier task's screen: fix it before Step 3 and say so in the commit message.

- [ ] **Step 3: Remove the browser database and the shims**

1. Delete the six files listed above. In `apps/web/package.json`, remove `dexie` and `dexie-react-hooks`, then run `pnpm install`.
2. Replace every import of `./models`, `./calculations` and `./validation` with `@boat/domain/models`, `@boat/domain/calculations` and `@boat/domain/validation`; `ui.tsx` takes `fieldErrors` from `@boat/domain/validation`.
3. In `apps/web/src/access.ts`, keep the Task 5 block from `AccessUser` to `useAccess()` and the re-exports, minus `current`, `setAccess`, `actorName`, `denied`, `requireAction` and `requireLotEdit`. `can(action: Action, state: AccessState)` reads `state.actions`, and `useAccess()` builds `can` and `lotAccess` from the context state as before. Delete everything below `useAccess()`.
4. In `apps/web/src/App.tsx`, delete `const data = useLiveQuery(getData, [])`, the `db.open()` effect, `dbError` and its "Local database unavailable" screen, `if (!data) return <Loading />`, and `setAccess(access)`. Calls to `can(x)` become `can(x, access)`. Change the "Data stays in this browser profile…" line under the navigation to "Records are shared by everyone signed in to this workspace."

- [ ] **Step 4: Check nothing is left**

Run: `grep -rn "repository\|from './db'\|dexie\|from './\(models\|calculations\|validation\|demo\)'" apps/web/src apps/web/package.json`
Expected: no output.

- [ ] **Step 5: Run the specs and every check**

Run: `pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`
Expected: all pass, every spec on both projects.

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add -A apps/web e2e pnpm-lock.yaml
git commit -m "Remove IndexedDB and the PIN helpers from the web app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: CI, docs and the gate

CI runs the Playwright suite after the build, AGENTS.md describes the switched app and the `e2e` package in place of the manual checklist, and the roadmap records this phase's departures. The task ends with the gate.

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-10-14-fullstack-roadmap.md`

**Interfaces:**
- Consumes: the root `e2e` script and `@boat/e2e` (Task 4); every spec in `e2e/tests` (Tasks 4–11).
- Produces: nothing later tasks use.

- [ ] **Step 1: Run the suite in CI**

In the CI workflow, after `- run: pnpm build`, add:

```yaml
      # Global setup starts Postgres with Testcontainers on the runner's Docker daemon.
      - run: pnpm --filter @boat/e2e exec playwright install --with-deps chromium
      - run: pnpm e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: e2e/playwright-report
```

The package's script is `e2e`, not `test` (Task 4), so the root `pnpm test` stays fast.

- [ ] **Step 2: Update AGENTS.md**

1. Replace the first paragraph of "Project Structure & Module Organization" with:

> This is a pnpm monorepo. `apps/web` is the React application: `src/App.tsx` owns navigation, the session gate and global data actions, and `src/Production.tsx`, `src/LotDrawer.tsx`, `src/MonthEnd.tsx`, `src/Shipments.tsx`, `src/Settings.tsx` and `src/Users.tsx` contain the operational views and editors. `src/api/` is the only code that talks to the server: `client.ts` sends every request (the CSRF header, typed errors, and sign-in again after a 401), `mappers.ts` converts the API's JSON to the domain shapes the screens use, `queries.ts` holds the TanStack Query hooks and their keys, and one file per area holds the writes, each followed by a refresh of the queries it affects. The sign-in, invite and password-reset screens are in `src/auth/`, new-record defaults in `src/drafts.ts`, the signed-in user's permissions in `src/access.ts`, shared primitives in `src/ui.tsx`, and global styles in `src/index.css`.

2. In the second paragraph, replace "The web app's `models.ts`, `calculations.ts` and `validation.ts` re-export it, and `access.ts` keeps the browser-only PIN, session and React context helpers." with:

> `src/api.ts` holds the API's JSON shapes; `apps/api/src/contract.ts` checks at compile time that the server's views produce exactly them, so a changed response fails `pnpm typecheck`. The web app imports the package directly.

3. After the `apps/api` paragraph, add:

> `e2e` is the Playwright suite. Global setup starts Postgres with Testcontainers, runs the built API serving the built web app on one origin, and creates one user per role through the real invite flow, reading the links from the log mailer's output. Every test resets the data first (`support/test.ts`), seeds what it needs through the API (`support/seed.ts`), and runs on desktop Chromium and at 390 × 844. Specs never sign out, disable or change the password of the four seeded users; a test that needs to uses `newUser()`.

4. In "Build and Development Commands", replace from "Run `pnpm install` once" to the end of the paragraph with:

> Run `pnpm install` once. `pnpm typecheck`, `pnpm test`, `pnpm format:check` and `pnpm build` run across all packages. To run the app, copy `apps/api/.env.example` to `apps/api/.env`, start Postgres with `docker compose up -d db`, apply migrations and grants with `pnpm --filter @boat/api db:migrate`, and invite the first admin with `pnpm api create-admin --email <address> --name <name>` (the invite link is in the API's log when `RESEND_API_KEY` is unset). Then run `pnpm --filter @boat/api dev` and `pnpm dev` side by side; Vite proxies `/api` to the API on port 3000, so cookies stay same-origin as on Render. `pnpm --filter @boat/api test:int` runs the database tests and `pnpm e2e` the Playwright suite against the output of `pnpm build` (both need Docker; run `pnpm --filter @boat/e2e exec playwright install chromium` once).

5. In "Verification Guidelines", replace the sentence beginning "Until the web app switches to the API" with:

> The Playwright suite covers every user flow, on both viewports; change or add a spec in `e2e/tests` with each change to a screen. The web app's unit tests (`pnpm --filter @boat/web test`) cover the API client and mappers.

- [ ] **Step 3: Record the phase in the roadmap**

In `docs/superpowers/plans/2026-10-14-fullstack-roadmap.md`:

1. In the phase table, set Phase 5's Plan cell to `[2026-10-16-phase-5-frontend-switch.md](2026-10-16-phase-5-frontend-switch.md)`.
2. After "Where Phase 4 departs from the PRD", add:

```markdown
## Where Phase 5 departs from the PRD

1. **`GET /lots/groups` is added.** The PRD's endpoint table has no grouped view, but the demo's default Production view groups lots by product with totals, and grouping a paged flat list would split products across pages. Its totals are SQL sums of the stored `grn_total`; the integration test checks them against the domain-computed values.
2. **Demo-only features are dropped:** "Load demo data" on first run, PINs, recovery keys, "Turn off roles" and the in-app setup screen. `create-admin` replaces the setup screen; the sample backup can be imported for demos.
3. **CSVs come from the server.** The browser's CSV builder is removed, so the three exports have one implementation each.
4. **Response types live in `@boat/domain/api`.** The web app doesn't import from `apps/api`, which would type-check the server under the browser's compiler options. `apps/api/src/contract.ts` checks that each server view produces exactly the shared shape, so a changed response still fails typecheck.
5. **Small API additions the screens needed:** the NPI card in `GET /lots/summary`, `GET /reports/months`, `vessels` in `GET /shipments/summary`, a `productId` filter on the lot endpoints, and each lot's current `eta` in the month-end report.
6. **Writes are plain functions run through the app's `run()`**, which drives the saving indicator and the repeat-click guard, rather than TanStack `useMutation`. Each refreshes the queries its change affects.
7. **A password reset ends at sign-in**, because `POST /auth/password/reset` doesn't start a session.
8. **A session the server ended shows "Your session ended. Sign in again."** The idle message is kept for the browser's own idle timer, the only case where the app knows the reason.
9. **Playwright seeds users through the real invite flow,** reading links from the log mailer's output, rather than writing users to the database.
```

3. Under "Notes for later phases", add:

```markdown
- **Phase 6:** the e2e suite runs against local Docker in CI. Run it once against the staging service before cut-over, since that is the first time the built web app is served by Render.
```

- [ ] **Step 4: Run the gate**

Run:

```bash
pnpm format:check && pnpm typecheck && pnpm test && pnpm --filter @boat/domain test:coverage && pnpm --filter @boat/api test:int && pnpm build && pnpm e2e
grep -rn "repository\|from './db'" apps/web/src
grep -n dexie apps/web/package.json
```

Expected: every command passes, domain line coverage is at or above 95%, every spec passes on both the `desktop` and `mobile` projects, and both greps print nothing.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add .github AGENTS.md docs/superpowers/plans/2026-10-14-fullstack-roadmap.md
git commit -m "Run the Playwright suite in CI and document the switched app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The gate also needs CI green: once the branch is pushed, confirm the Playwright step passes before merging into `dev`.
