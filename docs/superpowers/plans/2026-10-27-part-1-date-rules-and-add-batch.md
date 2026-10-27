# Part 1: Date Rules and "Add batch" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the four lot dates and the batch planned date with the agreed rules, and let users add a material batch as soon as a component is ticked.

**Architecture:** The rules live in the shared `@boat/domain` validators, which gain a `previous` record so "today or later" applies only to new or changed dates. The API passes the stored record and the company date. The browser passes the loaded lot. The drawer saves an unsaved lot before opening the batch form.

**Tech Stack:** TypeScript, Vitest, Express + Prisma (Supertest, Testcontainers), React, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-client-feedback-sso-and-simpler-inputs-design.md`, sections 4 and 5.

## Global Constraints

- "Today" is the company date: `clock.today()` on the server, `today()` in the browser.
- Every date stays optional. Rules apply only to a non-empty value.
- "Today or later" is checked only when the date is new or differs from the stored record. "Today or earlier" is always checked.
- "Not before RM ready" is checked only when `rmReadyDate` is non-empty and either date in the pair is new or changed. It never uses the effective (batch-derived) RM ready date. This is the builder's call from the spec.
- JSON backup import stays exempt. `import.service.ts` doesn't call `validateLot`/`validateBatch`, so keep it that way.
- Error copy matches the existing "cannot" style, exactly as written in Task 1.
- New integration tests that pin these rules carry ids `FR-10.1` (lot dates) and `FR-10.2` (batch planned date). Add both to `required` in `apps/api/src/fr-coverage.test.ts`.
- Work on a branch, e.g. `git switch -c client-feedback-part-1`. Run `pnpm format` before each commit.

## Review Focus

- **Editing an old lot whose planned date has passed** saves if that date is untouched. Pinned in Task 2 (`updateLot` keeps a past planned date).
- **Clearing a date** (sending `null`/empty) is never an error. Pinned in Task 1 (`allows clearing a forecast date`).
- **Re-sending the same past date in a PATCH** counts as unchanged. Pinned in Task 2, because the API merges the patch over stored values.
- **A brand-new lot saved via "Add batch" with an invalid date** shows the lot errors on the Overview tab and doesn't open the batch form. Pinned in Task 3's e2e step.
- **A POC user** (plan fields locked) can still add a batch to a saved lot. The existing `rm-batches.spec.ts` role test must still pass in Task 3.

---

### Task 1: Date rules in the domain validators

**Files:**
- Modify: `packages/domain/src/validation.ts` (`validateLot` L44-66, `validateBatch` L69-76)
- Test: `packages/domain/src/validation.test.ts`

**Interfaces:**
- Produces: `validateLot(l: Lot, autoLabel = false, previous: Lot | null = null, date = today()): FieldErrors`
- Produces: `validateBatch(b: RMBatch, date = today(), autoLabel = false, previous: RMBatch | null = null): FieldErrors`
- Existing positional parameters keep their order, so current callers compile unchanged.

- [ ] **Step 1: Write the failing tests** in a new `describe('date rules')` block, using the file's `TODAY = '2026-10-14'`:

```ts
const lotOn = (o: Partial<Lot>) => makeLot({ plannedDate: '', ...o })
it('FR-10.1 keeps forecast dates on or after today', () => {
  const e = validateLot(
    lotOn({ rmReadyDate: '2026-10-13', plannedDate: '2026-10-13', revisedEta: '2026-10-13' }),
    false, null, TODAY,
  )
  expect(e.rmReadyDate).toBe('RM ready date at factory cannot be before today.')
  expect(e.plannedDate).toBe('Planned completion cannot be before today.')
  expect(e.revisedEta).toBe('Current revised ETA cannot be before today.')
  expect(validateLot(lotOn({ rmReadyDate: TODAY, plannedDate: TODAY }), false, null, TODAY)).toEqual({})
})
it('FR-10.1 keeps the actual date on or before today', () => {
  expect(validateLot(lotOn({ actualDate: '2026-10-15' }), false, null, TODAY).actualDate).toBe(
    'Actual date cannot be in the future.',
  )
  expect(validateLot(lotOn({ actualDate: '2026-01-02' }), false, null, TODAY)).toEqual({})
})
it('FR-10.1 keeps planned completion and revised ETA on or after RM ready', () => {
  const e = validateLot(
    lotOn({ rmReadyDate: '2026-10-20', plannedDate: '2026-10-18', revisedEta: '2026-10-19' }),
    false, null, TODAY,
  )
  expect(e.plannedDate).toBe('Planned completion cannot be before the RM ready date.')
  expect(e.revisedEta).toBe('Current revised ETA cannot be before the RM ready date.')
})
it('FR-10.1 only checks a forecast date that is new or changed', () => {
  const stored = lotOn({ rmReadyDate: '2026-09-01', plannedDate: '2026-09-10', revisedEta: '2026-09-12' })
  expect(validateLot({ ...stored, status: 'Delayed' }, false, stored, TODAY)).toEqual({})
  expect(validateLot({ ...stored, plannedDate: '2026-09-11' }, false, stored, TODAY).plannedDate).toBe(
    'Planned completion cannot be before today.',
  )
})
it('allows clearing a forecast date', () => {
  const stored = lotOn({ plannedDate: '2026-09-10' })
  expect(validateLot({ ...stored, plannedDate: '' }, false, stored, TODAY)).toEqual({})
})
it('FR-10.2 keeps a new or changed batch planned date on or after today', () => {
  expect(validateBatch(makeBatch({ plannedDate: '2026-10-13' }), TODAY).plannedDate).toBe(
    'Planned date cannot be before today.',
  )
  const stored = makeBatch({ plannedDate: '2026-09-01' })
  expect(validateBatch({ ...stored, notes: 'x' }, TODAY, false, stored)).toEqual({})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boat/domain test -- validation`
Expected: the new `date rules` tests FAIL (no date errors are returned).

- [ ] **Step 3: Implement the rules** in `validateLot` and `validateBatch`, appending entries to each `collect([...])`. Add a private helper in `validation.ts`, `fresh = <T>(next: T, previous: T | null, key: keyof T) => !previous || previous[key] !== next[key]`. Put the "before today" entry for each field before its "before RM ready" entry, so the first error per field wins (`collect` keeps the first). Don't change any other rule.

- [ ] **Step 4: Run the domain tests and coverage**

Run: `pnpm --filter @boat/domain test:coverage`
Expected: all tests PASS and line coverage is at or above 95%.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/validation.ts packages/domain/src/validation.test.ts
git commit -m "Add lot and batch date rules"
```

### Task 2: The API enforces the date rules

**Files:**
- Modify: `apps/api/src/modules/lots/lots.service.ts` (`checkLot` L113-160, `createLot` L255-275, `updateLot` L277-328)
- Modify: `apps/api/src/modules/rm-batches/rm-batches.service.ts` (`checkBatch` L27-52, `updateBatch` L108-148)
- Modify: `apps/api/src/fr-coverage.test.ts` (add `'FR-10.1'`, `'FR-10.2'`)
- Test: `apps/api/test/lots.int.test.ts`, `apps/api/test/rm-batches.int.test.ts`
- Fix existing tests that now break: `lots.int.test.ts` around L72, L95 (`rmReadyDate: '2026-10-01'`) and L191 (`plannedDate: '2026-10-10'`), and `rm-batches.int.test.ts` L54, L66 (`plannedDate: '2026-10-10'`). Move those dates on or after `testToday` (`'2026-10-15'`) unless the test is about a past date.

**Interfaces:**
- Consumes: `validateLot(l, autoLabel, previous, date)`, `validateBatch(b, date, autoLabel, previous)` from Task 1.
- Produces: `checkLot(db: Db, id: string, input: LotInput, previous: Lot | null, date: string): Promise<Lot>` and `checkBatch(lot: LotRow, input: BatchInput, date: string, previous: RMBatch | null): RMBatch`.

- [ ] **Step 1: Write the failing integration tests** in `lots.int.test.ts` under a new `describe('date rules')`. The test clock is `testToday = '2026-10-15'`.

```ts
it('FR-10.1 refuses a forecast date before today and an actual date after it', async () => {
  const res = await create({ plannedDate: '2026-10-14', actualDate: '2026-10-16' })
  expect(res.status).toBe(422)
  expect(res.body.fields).toEqual({
    plannedDate: 'Planned completion cannot be before today.',
    actualDate: 'Actual date cannot be in the future.',
  })
})
it('FR-10.1 keeps a past planned date that the edit does not touch', async () => {
  const lot = await makeLot(db, w.product.id, { plannedDate: day('2026-09-01') }) // seeded directly, bypassing validation
  const res = await w.planner.send('patch', `/api/v1/lots/${lot.id}`, {
    version: lot.version, plannedDate: '2026-09-01', blockerDescription: 'waiting on PCB',
  })
  expect(res.status).toBe(200)
})
```

In `rm-batches.int.test.ts`, add `it('FR-10.2 refuses a new batch planned before today', …)`, which posts a batch with `plannedDate: '2026-10-14'` and expects 422 with `fields.plannedDate === 'Planned date cannot be before today.'`. Match `makeLot`'s actual parameter shape in `test/support/fixtures.ts` (L97).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boat/api test:int -- lots rm-batches`
Expected: the new FR-10.x tests FAIL. The create and batch tests return 201 instead of 422.

- [ ] **Step 3: Thread `previous` and `date` through.** `createLot` calls `checkLot(tx, id, clean, null, await clock.today())`. In `updateLot`, compute `old = toDomainLot(current)` before calling `checkLot(tx, id, input, old, date)`. `checkBatch` passes `previous` to `validateBatch`. `createBatch` passes `null`. `updateBatch` loads `current` with `include: batchInclude` and passes `toDomainBatch(current)`.

- [ ] **Step 4: Fix the existing tests listed under Files, then run the full API suites**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: all PASS, including `fr-coverage.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "Enforce lot and batch date rules in the API"
```

### Task 3: Date errors in the drawer, and "Add batch" on ticking a component

**Files:**
- Modify: `apps/web/src/LotDrawer.tsx`: `LotTarget` L70; `overviewFields` L86-100; `LotEditor` state L130-140; `save` L197-213; `saveBatchForm` L268-279; date fields L592-628; RM picker hint and button L795-813; batch planned-date field L1077
- Modify: `apps/web/src/App.tsx` L591-603 (pass the new `onOpen` options)
- Test: `e2e/tests/rm-batches.spec.ts`, `e2e/tests/lots.spec.ts`

**Interfaces:**
- Consumes: `validateLot(draft, !stored, view?.lot ?? null)` and `validateBatch(batch, undefined, !existing, bs.find((b) => b.id === batch.id) ?? null)` (Task 1).
- Produces: `type LotTarget = { id: string; addBatch?: boolean } | { draft: Lot }`, and `onOpen: (id: string, options?: { addBatch?: boolean }) => void`.

- [ ] **Step 1: Write the failing Playwright tests.** Follow each spec file's existing setup (seeding, `openLot`, `test.use` for the admin storage state).

In `rm-batches.spec.ts`:

```ts
test('adds a batch to a new lot straight after ticking a component', async ({ page }) => {
  // seed a product; open the tracker; start a new lot for it and fill the required plan fields
  // switch to the RM tab, choose Track by Component, tick "PCB"
  const add = drawer.getByRole('button', { name: 'Add batch' })
  await expect(add).toBeEnabled()
  await add.click()
  await expect(page.getByRole('dialog', { name: /material batch/i })).toBeVisible()
  await expect(drawer.getByText('Save lot changes before adding a material batch.')).toHaveCount(0)
})
```

In `lots.spec.ts`:

```ts
test('shows the date errors next to the fields', async ({ page }) => {
  // open a seeded lot; set "Actual date" to tomorrow; Save
  await expect(drawer.getByText('Actual date cannot be in the future.')).toBeVisible()
})
```

Use the dialog's actual accessible name as rendered today. Check the batch sheet's title in `LotDrawer.tsx` around L1040.

- [ ] **Step 2: Build and run the specs to verify they fail**

Run: `pnpm build && pnpm e2e -- tests/rm-batches.spec.ts tests/lots.spec.ts`
Expected: the new tests FAIL. The button is disabled and no field error is shown.

- [ ] **Step 3: Implement**
  - Pass `previous` into both validators as shown under Interfaces. Add `error={lotForm.errors.<field>}` to the RM ready, planned completion, revised ETA and actual date `Field`s, and `error={batchForm.errors.plannedDate}` to the batch planned date. Add `'rmReadyDate', 'plannedDate', 'revisedEta', 'actualDate'` to `overviewFields`.
  - Make `save` return the saved `LotView | undefined`, and accept `options?: { addBatch?: boolean }`, which it forwards to `onOpen(saved.lot.id, options)` for a new lot.
  - Add `addBatch()`. If `!stored || dirty`, it calls `save(false, { addBatch: true })`. A new lot reopens through `onOpen`. For an already-stored lot, call `openBatch()` after a successful save. Otherwise it calls `openBatch()` straight away.
  - In `LotEditor`, when `target.addBatch` is set and `view` has loaded, switch to the RM tab and call `openBatch()` once (a `useRef` guard).
  - Enable the button when `draft.rmMode === 'components' && draft.rmComponents.length > 0` and not `readOnly`. Keep the default (primary) variant and wire its `onClick` to `addBatch`. Delete the amber "Save lot changes before adding a material batch." hint.
  - `openBatch` preselects the component ticked most recently. Track it in `toggleComponent` with a `useRef<string>`, falling back to `draft.rmComponents[0]`.
  - In `App.tsx`, `onOpen={(id, options) => setLotTarget({ id, ...options })}`.

- [ ] **Step 4: Run typecheck, unit tests and the e2e suite**

Run: `pnpm typecheck && pnpm --filter @boat/web test && pnpm build && pnpm e2e`
Expected: all PASS on both projects (desktop Chromium and 390 × 844).

- [ ] **Step 5: Commit**

```bash
git add apps/web e2e
git commit -m "Open Add batch as soon as a component is ticked"
```
