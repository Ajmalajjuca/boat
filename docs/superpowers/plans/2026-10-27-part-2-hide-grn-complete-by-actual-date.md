# Part 2: Hide GRN, Complete by Actual Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide GRN behind a server switch, remove rework and fresh production from the product, and make a lot finished once its actual date is entered, including on the Month-end page.

**Architecture:** One config flag, `FEATURE_GRN`, decides whether the GRN routers mount, and reaches the browser through `/auth/me`. Completion moves from receipts to `actual_date`. `completed_on` mirrors `actual_date` on every write, and one migration backfills lots that finished through GRN. The domain calculations drop their receipts parameter, so browser and server agree.

**Tech Stack:** TypeScript, Zod config, Express + Prisma migrations, Vitest, React, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-client-feedback-sso-and-simpler-inputs-design.md`, sections 2 and 3.

## Global Constraints

- **Hidden, not deleted.** No GRN, rework or fresh production table or column is dropped. Stored values never change. The JSON backup format and `@boat/domain/backup` stay as they are.
- `FEATURE_GRN` defaults to off. When off, `/api/v1/grn-receipts/*` and `/api/v1/lots/:id/grn-receipts*` answer 404 (not mounted).
- Turning GRN back on restores its screens and routes, but **not** GRN-based completion.
- A lot is complete exactly when `actualDate` is non-empty.
- Month-end: Planned = lots whose original planned date is in the month. Completed = those with `actualDate <= monthEnd(month)`, counting the full `lotQty`. Shortfall = `lotQty` of planned lots not completed by month-end. No `grnInMonth`.
- New integration test ids: `FR-10.3` (completion follows actual date) and `FR-10.4` (GRN switch). `FR-4.3` (GRN completion) leaves `required` in `apps/api/src/fr-coverage.test.ts`. `FR-4.1`, `FR-4.2`, `FR-4.4` and `FR-2.4` stay, with their tests run against an app built with GRN on.
- Work on a branch, e.g. `client-feedback-part-2`. Run `pnpm format` before each commit.

## Review Focus

- **Clearing the actual date** reopens the lot: it moves back to Active and its flags return. Pinned in Task 3.
- **A lot that finished through GRN before the migration** stays in Completed with an actual date and a history entry. Pinned in Task 3's migration test.
- **Lowering lot quantity below old GRN receipts while GRN is off** is allowed, because the user can't see those receipts. With GRN on it is still refused (`FR-2.4`). Pinned in Task 3.
- **A planned lot with a past actual date in an earlier month** counts as completed in its planned month. A lot completed after month-end counts as shortfall. Pinned in Task 1 (`monthSummary`).
- **Restoring an old backup** still imports receipts, rework and fresh production values, and the restored lots' completion follows their actual dates. Pinned in Task 3 (`data-import.int.test.ts`).

---

### Task 1: Domain calculations without receipts

**Files:**
- Modify: `packages/domain/src/calculations.ts` (`completed` L42, `fullGrnDate` L48, `leadTime` L72, `planDelay` L78, `lotFlags` L87, `lotSummary` L182). `monthSummary` changes in Task 4.
- Modify: `packages/domain/src/validation.ts` (`validateLot`: delete the `freshProductionQty`, `reworkQty` and "rework within fresh production" entries)
- Modify the callers' arguments only, so the workspace typechecks: `apps/api/src/modules/lots/lot-view.ts` `computeLot` L107-119, `apps/api/src/modules/reports/month-end.service.ts` L71 (`lotSummary(r.lot, date)`), and `apps/web/src/LotDrawer.tsx` L644-656 (`planDelay(draft)`, `leadTime(draft, bs)`)
- Test: `packages/domain/src/calculations.test.ts`, `packages/domain/src/validation.test.ts` (delete the rework assertions in `requires whole, non-negative quantities` and the `keeps rework within fresh production` test), `apps/api/src/modules/lots/lot-view.test.ts` (completion now comes from `actualDate`)

**Interfaces:**
- Produces:
  - `isCompleted(lot: Lot): boolean`, which is `!!lot.actualDate`
  - `lotFlags(lot: Lot, date = today())`
  - `lotSummary(lot: Lot, date = today())`
  - `planDelay(lot: Lot): number | null`, which is `dayDiff(actualDate, plannedDate)`
  - `leadTime(lot: Lot, batches: RMBatch[] = []): number | null`, which is `dayDiff(actualDate, effectiveRmReadyDate)`
- Kept, for when GRN returns: `totalGrn`, `balance`, `grnProgress`, `fullGrnDate`. Rename the old `completed(lot, receipts)` to the private `grnComplete(lot, receipts)`, still used by `fullGrnDate`.

- [ ] **Step 1: Write the failing tests** in `calculations.test.ts`. Replace the receipt-based cases for these functions:

```ts
it('FR-10.3 a lot is complete once its actual date is set', () => {
  expect(isCompleted(makeLot({ actualDate: '' }))).toBe(false)
  expect(isCompleted(makeLot({ actualDate: '2026-10-10' }))).toBe(true)
  expect(lotFlags(makeLot({ actualDate: '2026-10-10', plannedDate: '2026-10-01' }), '2026-10-14').overdue).toBe(false)
  expect(lotSummary(makeLot({ actualDate: '2026-10-10', stage: 'Dispatch' }), '2026-10-14')).toBe('Completed (Dispatch)')
})
it('measures delay and lead time from the actual date', () => {
  const lot = makeLot({ plannedDate: '2026-10-10', rmReadyDate: '2026-10-01', actualDate: '2026-10-12' })
  expect(planDelay(lot)).toBe(2)
  expect(leadTime(lot)).toBe(11)
  expect(planDelay(makeLot({ actualDate: '' }))).toBeNull()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boat/domain test -- calculations`
Expected: FAIL. `isCompleted` is not exported, and the arity doesn't match.

- [ ] **Step 3: Implement the signatures** listed under Interfaces, keeping the existing flag and summary logic apart from the source of `done`. Then update the caller arguments listed under Files.

- [ ] **Step 4: Run domain tests with coverage, typecheck, and the unit suites**

Run: `pnpm --filter @boat/domain test:coverage && pnpm typecheck && pnpm test`
Expected: all PASS, with domain line coverage at or above 95%.

- [ ] **Step 5: Commit**

```bash
git add packages/domain apps/api/src/modules apps/web/src/LotDrawer.tsx
git commit -m "Complete lots by actual date in the domain"
```

### Task 2: The GRN switch

**Files:**
- Modify: `apps/api/src/config.ts`, adding `FEATURE_GRN: z.stringbool().default(false)` (Zod 4 `stringbool` accepts on/off/true/false/1/0)
- Modify: `apps/api/src/api.ts`, adding `features: { grn: boolean }` to `ApiDeps` and mounting both `grnReceiptRouters` paths only when `deps.features.grn`
- Modify: `apps/api/src/server.ts` (pass `features: { grn: config.FEATURE_GRN }`), `apps/api/src/test-deps.ts` (default `features: { grn: false }`)
- Modify: `apps/api/src/modules/auth/auth.service.ts` (`mePayload` gains `features`), `auth.router.ts` (`AuthRouterDeps.features`)
- Modify: `packages/domain/src/api.ts` (the `/auth/me` shape) and `apps/api/src/contract.ts` if it lists the me payload
- Modify: `apps/api/src/api.test.ts` L31, building the route table with `testDeps({ features: { grn: true } })` so the GRN rows stay checked
- Modify: every integration test that exercises GRN (`grn-receipts.int.test.ts`, `month-end.int.test.ts` only where it seeds receipts via the API, `completion`-related cases in `lots.int.test.ts`, `activity.int.test.ts`, `data-*.int.test.ts` if they POST receipts), passing `testApp(db, { now: fixedNow, features: { grn: true } })`
- Modify: `apps/api/.env.example`, adding `# FEATURE_GRN=off   # on brings back GRN receipts`
- Test: `apps/api/test/grn-receipts.int.test.ts`, `apps/api/src/config.test.ts`

**Interfaces:**
- Produces: `ApiDeps.features: { grn: boolean }`; `MePayload.features: { grn: boolean }`; `Config.FEATURE_GRN: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// grn-receipts.int.test.ts, a second app built with the default deps
it('FR-10.4 GRN routes are off unless FEATURE_GRN is on', async () => {
  const off = testApp(db, { now: fixedNow })
  const admin = await signIn(off, w.adminEmail) // use the world's admin sign-in helper as other tests do
  expect((await admin.agent.get(`/api/v1/lots/${lotId}/grn-receipts`)).status).toBe(404)
  expect((await admin.agent.get('/api/v1/auth/me')).body.features).toEqual({ grn: false })
})
// config.test.ts
it('reads FEATURE_GRN as a boolean, off by default', () => {
  expect(loadConfig(base).FEATURE_GRN).toBe(false)
  expect(loadConfig({ ...base, FEATURE_GRN: 'on' }).FEATURE_GRN).toBe(true)
})
```

Use the sign-in helper and the lot set-up already used at the top of `grn-receipts.int.test.ts`, and the `base` env used in `config.test.ts`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boat/api test -- config && pnpm --filter @boat/api test:int -- grn-receipts`
Expected: FAIL. The route answers 200, and `features` and `FEATURE_GRN` are undefined.

- [ ] **Step 3: Implement** the switch as described under Files. `FR-10.4` goes into `required` in `fr-coverage.test.ts`.

- [ ] **Step 4: Run all API tests**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/domain/src/api.ts
git commit -m "Put GRN receipts behind FEATURE_GRN, off by default"
```

### Task 3: Completion follows the actual date

**Files:**
- Create: `apps/api/prisma/migrations/20261027000000_complete_by_actual_date/migration.sql`
- Modify: `apps/api/src/modules/lots/lot-lock.ts`, where `refreshCompletion` keeps updating `grn_total` from receipts and sets `completed_on = l.actual_date`. Update its comment.
- Modify: `apps/api/src/modules/lots/lot-view.ts` (`computeLot` L106-125 calls the Task 1 signatures, and keeps `grnTotal`, `balance`, `grnPercent`, `fullGrnDate` computed from receipts so the JSON shape is unchanged)
- Modify: `apps/api/src/modules/lots/lots.service.ts`: the `lotQty < grnTotal` guard (L305) runs only when `features.grn`. `RecordsDeps` in `core/clock.ts` gains `features: { grn: boolean }`, set where `records` is built in `api.ts`; `lotData`/`inputOf`/`LotInput` stop reading and writing `freshProductionQty`, `reworkQty`, `reworkReason`; in `lots.router.ts` those three keys stay in the strict body schemas as `.optional()` and are ignored until Task 5 removes them; `csvRow` drops `Produced`, `Rework`, `GRN`, `Balance`, `FullGRNDate`, and renames `RMToGRNDays` to `RMToActualDays`
- Modify: `apps/api/src/fr-coverage.test.ts` (remove `'FR-4.3'`, add `'FR-10.3'`)
- Test: `apps/api/test/lots.int.test.ts`, `apps/api/test/lots-list.int.test.ts`, `apps/api/test/database.int.test.ts` (migration), `apps/api/test/data-import.int.test.ts`. Delete or retitle the existing `FR-4.3` tests and the GRN-completion case in `completion`-related tests.

**Interfaces:**
- Consumes: Task 1 domain functions; Task 2 `features.grn`.
- Produces: `completed_on` always equals `actual_date` for active lots.

- [ ] **Step 1: Write the failing tests**

```ts
it('FR-10.3 setting the actual date completes the lot and clearing it reopens it', async () => {
  const id = (await create({})).body.id
  let res = await w.planner.send('patch', `/api/v1/lots/${id}`, { version: 1, actualDate: '2026-10-15' })
  expect(res.body).toMatchObject({ completedOn: '2026-10-15', computed: { completed: true } })
  const listed = await w.admin.agent.get('/api/v1/lots?view=completed')
  expect(listed.body.items.map((l: { id: string }) => l.id)).toContain(id)
  res = await w.planner.send('patch', `/api/v1/lots/${id}`, { version: 2, actualDate: null })
  expect(res.body).toMatchObject({ completedOn: null, computed: { completed: false } })
})
it('allows lowering lot quantity below old receipts while GRN is off', async () => {
  // seed a lot with a 50-unit receipt directly in the DB; patch lotQty to 10 through the default (GRN off) app
  // expect 200
})
```

For the migration, in `database.int.test.ts` (or a new `complete-by-actual-date.int.test.ts`), run the migration SQL file against seeded rows and assert:

```ts
it('FR-10.3 backfills the actual date of lots that finished through GRN', async () => {
  // before: lot A completed_on '2026-09-30', actual_date NULL; lot B actual_date '2026-10-01', completed_on NULL
  // after:  A.actual_date '2026-09-30', A.completed_on '2026-09-30'; B.completed_on '2026-10-01'
  // and one activity_logs row for A: kind 'updated', message 'Actual date set from the full GRN date', actor_id NULL
})
```

Use whatever this suite already does to run SQL against a fresh database (see `test/support/db.ts`). If migrations are only applied at template creation, seed the rows in a copied database and execute the file's SQL with `db.$executeRawUnsafe`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boat/api test:int -- lots database`
Expected: FAIL. `completedOn` stays null after setting the actual date.

- [ ] **Step 3: Write the migration**

```sql
-- Lots that finished through GRN keep their completion date as their actual date.
INSERT INTO activity_logs (id, entity_type, entity_id, kind, message, actor_id, actor_name, created_at)
SELECT gen_random_uuid(), 'lot', id, 'updated', 'Actual date set from the full GRN date', NULL, NULL, now()
FROM lots WHERE completed_on IS NOT NULL AND actual_date IS NULL AND deleted_at IS NULL;
UPDATE lots SET actual_date = completed_on WHERE completed_on IS NOT NULL AND actual_date IS NULL AND deleted_at IS NULL;
UPDATE lots SET completed_on = actual_date;
```

Use the enum literal that `EntityType` maps to in the init migration. Then implement the code changes listed under Files.

- [ ] **Step 4: Run all API tests**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS, including `lot-view.test.ts` updated for the new `computeLot` semantics, and `fr-coverage.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/domain
git commit -m "Complete lots by actual date and backfill finished lots"
```

### Task 4: Month-end report by actual date

**Files:**
- Modify: `packages/domain/src/calculations.ts` (`monthSummary` L213-250)
- Modify: `apps/api/src/modules/reports/month-end.service.ts` (L19-79: drop both receipt queries, call `monthSummary(rows.map(toDomainLot), month)`, rename `received` to `completed` at every level, remove `grnInMonth`). Update the month-end CSV in the same module or router to match.
- Modify: `packages/domain/src/api.ts` (`MonthEndReport` L212+: same renames, no `grnInMonth`), `apps/api/src/contract.ts` if it needs touching
- Modify: `apps/web/src/MonthEnd.tsx`, renaming field reads only so the workspace typechecks (Task 5 does the copy)
- Test: `packages/domain/src/calculations.test.ts`, `apps/api/test/month-end.int.test.ts`. Rewrite the `FR-5.1`/`FR-5.2` cases to use actual dates.

**Interfaces:**
- Produces: `monthSummary(lots: Lot[], month: string)`, returning `{ lots: { lot: Lot; planned: number; completed: number; shortfall: number }[]; products: { productId: string; lots: number; planned: number; completed: number; shortfall: number }[]; planned: number; completed: number; shortfall: number; percent: number }`. Sort orders are unchanged.
- Produces: `MonthEndReport` with `completed` in place of `received`, and no `grnInMonth`.

- [ ] **Step 1: Write the failing tests.** In `calculations.test.ts`:

```ts
it('monthSummary counts planned lots completed by month end at full quantity', () => {
  const lots = [
    makeLot({ id: 'a', productId: 'p', lotQty: 100, plannedDate: '2026-10-05', actualDate: '2026-09-30' }),
    makeLot({ id: 'b', productId: 'p', lotQty: 40, plannedDate: '2026-10-20', actualDate: '2026-11-02' }),
    makeLot({ id: 'c', productId: 'p', lotQty: 60, plannedDate: '2026-10-25', actualDate: '' }),
    makeLot({ id: 'd', productId: 'p', lotQty: 999, plannedDate: '2026-11-01', actualDate: '2026-10-31' }),
  ]
  const s = monthSummary(lots, '2026-10')
  expect(s).toMatchObject({ planned: 200, completed: 100, shortfall: 100, percent: 50 })
  expect(s.products).toEqual([{ productId: 'p', lots: 3, planned: 200, completed: 100, shortfall: 100 }])
  expect(s.lots.map((r) => r.lot.id)).toEqual(['c', 'b', 'a'])
})
```

Then seed the same four lots in `month-end.int.test.ts` through `makeLot`:

```ts
it('FR-5.1 counts planned lots completed by month end at full quantity', async () => {
  const res = await w.viewer.agent.get('/api/v1/reports/month-end?month=2026-10')
  expect(res.body).toMatchObject({ planned: 200, completed: 100, shortfall: 100, percent: 50 })
  expect(res.body).not.toHaveProperty('grnInMonth')
})
it('FR-5.2 lists each planned lot with its shortfall and status today', async () => {
  // expect lots[0] to be the unfinished 60-unit lot with shortfall 60 and statusToday like '..., 10d left ...'
})
```

Use the query string the report router actually takes (see `reports.router.ts`).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boat/domain test -- calculations && pnpm --filter @boat/api test:int -- month-end`
Expected: FAIL. `monthSummary` still takes receipts, and `completed` is undefined.

- [ ] **Step 3: Implement** the domain, service, type, CSV and field-read changes listed under Files.

- [ ] **Step 4: Run typecheck and the test suites**

Run: `pnpm typecheck && pnpm --filter @boat/domain test:coverage && pnpm --filter @boat/api test:int`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/domain apps/web/src/MonthEnd.tsx
git commit -m "Base the month-end report on actual dates"
```

### Task 5: Hide GRN, rework and fresh production in the web app

**Files:**
- Modify: `apps/web/src/LotDrawer.tsx`: the GRN tab, stats and progress bar (L300-305, L386), the "Full GRN date / vs plan / RM→GRN" block (L640-656, which becomes "Days vs plan" and "RM ready → actual"), the GRN metrics (L893-897), the receipt sheet (L1140-1180), and the fresh production and rework fields (L534-560). Remove `freshProductionQty`/`reworkQty` from `overviewFields`. Change the Actual date help to "Entering the actual date marks the lot as completed." Show the GRN tab and sheet only when `features.grn`.
- Modify: `apps/web/src/Production.tsx`: the `grn`, `balance`, `fullGrn`, `fresh` columns and group totals (L39-98, L266-268, L646-650, L806-827). The card copy at L428 becomes "Completion is based on the actual date", and L580 becomes "A lot appears here once its actual date is entered."
- Modify: `apps/web/src/MonthEnd.tsx`: "Received" becomes "Completed", the `grnInMonth` card goes, and the help text at L47 reads "Lots from that plan whose actual date is on or before the last day of the month."
- Modify: `apps/web/src/App.tsx` L80, L84, L265 copy (no GRN mentions); `apps/web/src/Settings.tsx` L223-240 glossary (drop GRN, rework and balance entries); `apps/web/src/drafts.ts` (drop the three fields from new-lot defaults only if the `Lot` type allows, otherwise keep them as 0/''); `apps/web/src/api/mappers.ts` (`lotInput` stops sending the three fields); the `features` read from the me payload in `src/auth/AuthProvider.tsx` and exposed via a `useFeatures()` hook beside `useAccess` in `src/access.ts`
- Modify: `apps/api/src/modules/lots/lots.router.ts`, removing the three optional ignored keys from the strict body schemas now that the web no longer sends them
- Modify: `packages/domain/src/permissions.ts` `roleInfo` descriptions and `docs/roles-and-permissions.md` (no GRN or rework); `AGENTS.md` (mention `FEATURE_GRN`; `grn-receipts` is switched off by default); `docs/demo-walkthrough.md` GRN steps
- Test: `apps/web/src/api/mappers.test.ts`. e2e: delete `e2e/tests/grn.spec.ts` and `e2e/tests/completion-reversal.spec.ts`; update `month-end.spec.ts`, `mobile.spec.ts`, `filters.spec.ts`, `generated-labels.spec.ts`, and `e2e/support/seed.ts` (drop `receipt()` or leave it unused); add `e2e/tests/completion.spec.ts`

**Interfaces:**
- Consumes: `MePayload.features` (Task 2), `MonthEndReport.completed` (Task 4), domain functions (Task 1).
- Produces: `useFeatures(): { grn: boolean }`.

- [ ] **Step 1: Write the failing e2e test** `e2e/tests/completion.spec.ts`, using the admin storage state and `seeder()` as other specs do:

```ts
test('entering the actual date moves the lot to Completed, clearing it brings it back', async ({ page }) => {
  // seed product 'Mike' with lot 'M-1'; open it; set Actual date to today; Save
  await goTo(page, 'Completed')
  await expect(page.getByRole('group', { name: 'Mike' })).toBeVisible()
  // open M-1, clear Actual date, Save; goTo 'Production Tracker'; expect group 'Mike' to contain '1 lots'
})
test('shows no GRN, rework or fresh production anywhere on a lot', async ({ page }) => {
  // open a seeded lot
  await expect(drawer.getByRole('tab', { name: 'GRN Receipts' })).toHaveCount(0)
  await expect(drawer.getByText(/rework|fresh production|GRN/i)).toHaveCount(0)
})
```

In `mappers.test.ts`, assert that `lotInput(...)` has no `freshProductionQty`, `reworkQty` or `reworkReason` keys.

- [ ] **Step 2: Build and run them to verify they fail**

Run: `pnpm --filter @boat/web test && pnpm build && pnpm e2e -- tests/completion.spec.ts`
Expected: FAIL. The GRN tab is present and the lot stays Active.

- [ ] **Step 3: Implement** the changes listed under Files.

- [ ] **Step 4: Run everything**

Run: `pnpm typecheck && pnpm test && pnpm format:check && pnpm --filter @boat/api test:int && pnpm build && pnpm e2e`
Expected: all PASS on both viewports.

- [ ] **Step 5: Commit**

```bash
git add -A apps packages e2e docs AGENTS.md
git commit -m "Hide GRN, rework and fresh production in the web app"
```
