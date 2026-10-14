# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single Vite app into a pnpm monorepo. Move the business rules into a tested `@boat/domain` package. Stand up an Express API skeleton with health checks, plus the Prisma schema and migrations with database-enforced soft delete, local Postgres, CI and a Render blueprint. The web app's behaviour does not change.

**Architecture:** `apps/web` is today's React app, unchanged except that its domain imports now come from `packages/domain` through thin re-export shims. `packages/domain` holds models, calculations, validation and permissions as pure TypeScript, consumed as source by Vite, Vitest, tsx and tsup. `apps/api` is an Express 5 app built by a `createApp(options)` factory. A bundled `server.ts` serves `/api/v1/*` and the built web app from one origin. The app connects to Postgres as `boat_app`, a role that cannot DELETE.

**Tech Stack:** Node 24 LTS, pnpm 10.33.2 workspaces, TypeScript 7, Vite 8, Vitest 5, Express 5.3, Prisma 7.10 with `@prisma/adapter-pg`, PostgreSQL 17, Testcontainers 12, Supertest 7, pino 10, zod 4, tsup 8, GitHub Actions, Render.

**Spec:** [Supply Chain App — Backend PRD & Architecture](https://claude.ai/code/artifact/313da010-aa6a-4a87-be4b-2c401635a8cd), sections "Backend architecture and stack", "Backend modules and folder structure", "Domain models and database schema", "Testing strategy" and "Migration and rollout phases" (phase 1). Read the roadmap's "Where Phase 1 departs from the PRD" first: [2026-10-14-fullstack-roadmap.md](2026-10-14-fullstack-roadmap.md).

## Global Constraints

- Node `24` (pinned in `.nvmrc` and in `engines`). pnpm `10.33.2` (pinned in `packageManager`).
- TypeScript `^7.0.2`, strict, with today's flags: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`, `moduleResolution: "Bundler"`.
- Prettier settings come from the existing `.prettierrc.json`: single quotes, no semicolons, trailing commas, print width 100.
- Exact versions: `prisma`, `@prisma/client` and `@prisma/adapter-pg` `7.10.0`; `express` `5.3.0`; `vitest` and `@vitest/coverage-v8` `5.0.4`; `zod` `4.6.7`; `pino` `10.4.0`; `pino-http` `11.0.0`; `supertest` `7.3.1`; `@testcontainers/postgresql` `12.2.1`; `pg` `8.23.1`; `tsup` `8.5.1`; `tsx` `4.23.15`; `dotenv` `18.0.7`. npm's `latest` tag for the `prisma` CLI points at an 8.0 release candidate, so never install it unpinned.
- PostgreSQL `17` in Docker Compose and Testcontainers (`postgres:17`), and the Neon project must match.
- Business dates are ISO `YYYY-MM-DD` strings. The company time zone defaults to `Asia/Kolkata`.
- Quantities are whole, non-negative integers.
- Soft delete only. The app's database role `boat_app` has no DELETE privilege on any table, and `activity_logs` and `eta_revisions` are insert-only.
- Render: region `singapore`, plan `starter`.
- The web app must look and behave exactly as before. Phase 1 changes no screen.
- Commits: short imperative subject (AGENTS.md), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **"Today" near midnight in the company time zone.** At 20:00 UTC it is already tomorrow in Asia/Kolkata. The server's no-future-date rules must use the company date, not UTC. Pinned by the `today` tests in Task 2.
2. **Unknown `/api` paths while the web app is served.** A typo such as `GET /api/v1/lotz` must return JSON 404, never `index.html` with 200, or the Phase 5 client will try to parse HTML. Pinned in Task 5.
3. **The app role deleting through a membership.** On Neon, a role made in the console joins `neon_superuser` and can inherit `pg_write_all_data`, which grants DELETE regardless of our REVOKE. `grants.sql` must fail loudly. Pinned in Task 6.
4. **Render build with `NODE_ENV=production`.** pnpm skips devDependencies under `NODE_ENV=production`, so Vite, tsup and the Prisma CLI would be missing. The build command uses `--prod=false`, and Task 7 verifies a production-mode install and build.
5. **Existing browser data after the move.** IndexedDB is stored per origin. The dev server must still run on `localhost:5173`, so the demo data in the user's browser stays visible. A manual check in Task 1. Moving the app also changes where the Vercel demo builds from, which Task 1 calls out.

---

## File Structure

```
boat/
├─ .nvmrc                          # 24
├─ .prettierignore
├─ package.json                    # workspace root: scripts, prettier
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml                  # replaces package-lock.json
├─ docker-compose.yml              # local Postgres 17
├─ render.yaml                     # Render blueprint
├─ .github/workflows/ci.yml
├─ apps/
│  ├─ web/                         # moved from the root, unchanged except the shims below
│  │  ├─ package.json              # @boat/web
│  │  ├─ index.html, vite.config.ts, tsconfig.json, components.json
│  │  └─ src/
│  │     ├─ models.ts              # re-exports @boat/domain/models + browser-only UserProfile, LocalSetting
│  │     ├─ calculations.ts        # re-exports @boat/domain/calculations
│  │     ├─ validation.ts          # re-exports @boat/domain/validation + browser-only validateUser
│  │     └─ access.ts              # React context, PIN and session helpers; rules from @boat/domain/permissions
│  └─ api/
│     ├─ package.json              # @boat/api
│     ├─ tsconfig.json, tsup.config.ts, vitest.config.ts, vitest.int.config.ts
│     ├─ prisma.config.ts          # CLI config: schema path, migrations path, DIRECT_URL
│     ├─ .env.example
│     ├─ prisma/
│     │  ├─ schema.prisma
│     │  ├─ migrations/            # <ts>_init, <ts>_constraints
│     │  ├─ grants.sql             # boat_app privileges; run after every migration
│     │  └─ init-local.sql         # creates boat_app in the Docker database only
│     ├─ src/
│     │  ├─ app.ts                 # createApp({ logger, webDist?, checkDatabase })
│     │  ├─ app.test.ts
│     │  ├─ config.ts              # loadConfig(env) with zod
│     │  ├─ config.test.ts
│     │  ├─ server.ts              # entry: config, logger, Prisma, listen, shutdown
│     │  ├─ core/
│     │  │  ├─ errors.ts           # errorHandler
│     │  │  └─ prisma.ts           # createPrisma(url), databaseCheck(db)
│     │  ├─ modules/health/health.router.ts
│     │  └─ generated/prisma/      # generated by `prisma generate`; gitignored
│     └─ test/database.int.test.ts # Testcontainers: migrations, grants, constraints, readiness
└─ packages/
   └─ domain/
      ├─ package.json              # @boat/domain, exports ./models ./calculations ./validation ./permissions
      ├─ tsconfig.json, vitest.config.ts
      └─ src/
         ├─ models.ts, calculations.ts, validation.ts, permissions.ts
         ├─ test-factories.ts
         └─ models.test.ts, calculations.test.ts, validation.test.ts, permissions.test.ts
```

---

### Task 1: Convert to a pnpm workspace with the web app in `apps/web`

**Files:**
- Create: `.nvmrc`, `pnpm-workspace.yaml`, `.prettierignore`, `package.json` (new root)
- Move: `src/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `components.json`, `package.json` → `apps/web/`
- Modify: `apps/web/package.json`, `.gitignore`
- Delete: `package-lock.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the root scripts `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm format`, `pnpm format:check`. Workspace globs `apps/*` and `packages/*`. Package name `@boat/web`.

- [ ] **Step 1: Switch to Node 24 and pnpm 10.33.2**

```bash
cd /home/ajmal/p/boat
git checkout -b phase-1-foundation
nvm install 24 && nvm use 24
echo 24 > .nvmrc
corepack enable
corepack prepare pnpm@10.33.2 --activate
node -v && pnpm -v
```

Expected: `v24.x.x` and `10.33.2`.

- [ ] **Step 2: Move the web app**

```bash
mkdir -p apps/web
git mv src index.html vite.config.ts tsconfig.json components.json package.json apps/web/
git rm -q package-lock.json
rm -rf node_modules dist
```

- [ ] **Step 3: Rename the web package and drop its format scripts**

Edit `apps/web/package.json`. Change `"name"` and replace the `scripts` block. Leave the dependencies as they are:

```json
  "name": "@boat/web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "preview": "vite preview --host 0.0.0.0"
  },
```

Also delete `"prettier"` from its `devDependencies`. It moves to the root.

- [ ] **Step 4: Create the workspace root files**

`package.json`:

```json
{
  "name": "boat",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.2",
  "engines": {
    "node": ">=24 <25"
  },
  "scripts": {
    "dev": "pnpm --filter @boat/web dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "prettier": "^3.9.9"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*

# pnpm 10 runs dependency install scripts only for packages listed here.
onlyBuiltDependencies:
  - esbuild
  - prisma
  - '@prisma/engines'
```

`.prettierignore`:

```
node_modules
dist
coverage
graft
docs
*.md
pnpm-lock.yaml
apps/api/src/generated
apps/api/prisma/migrations
10_2_2026-Meeting.*
```

Append to `.gitignore`:

```
coverage/
.env
apps/api/src/generated/
```

- [ ] **Step 5: Install, then check types, build and formatting**

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm format:check
```

Expected: install finishes. If it prints `Ignored build scripts: <name>` for anything other than the three packages in `onlyBuiltDependencies`, leave it ignored. Typecheck exits 0. Build writes `apps/web/dist/index.html`. If `format:check` flags root config files (`package.json`, `pnpm-workspace.yaml`), run `pnpm format` and check again. It must not flag any file under `apps/web/src`, because those were already formatted.

- [ ] **Step 6: Manually check that the app and its data survive the move**

Run `pnpm dev`, open `http://localhost:5173`, and confirm that the existing demo workspace appears with its lots and shipments (IndexedDB is per origin, and the origin is unchanged). Open one lot drawer and the Month-end tab. Stop the server.

If port 5173 was taken and Vite picked another port, the data will look empty. Free the port and retry. Never "fix" this by loading demo data again.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move web app into a pnpm workspace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Note for the human partner: if the demo is deployed on Vercel, set the Vercel project's Root Directory to `apps/web` before the next deploy, or that deploy will fail.

---

### Task 2: Create `@boat/domain` with models and calculations

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`, `packages/domain/src/test-factories.ts`, `packages/domain/src/models.test.ts`, `packages/domain/src/calculations.test.ts`
- Move: `apps/web/src/models.ts` → `packages/domain/src/models.ts`; `apps/web/src/calculations.ts` → `packages/domain/src/calculations.ts`
- Create (shims): `apps/web/src/models.ts`, `apps/web/src/calculations.ts`
- Modify: `apps/web/package.json` (add the dependency)

**Interfaces:**
- Consumes: the workspace from Task 1.
- Produces:
  - Package `@boat/domain` with exports `./models` and `./calculations`, consumed as TypeScript source.
  - `today(timeZone?: string, at?: Date): string`. With a time zone it returns the date in that zone, and without one the device's local date (today's behaviour).
  - `dateLabel(value: string): string`, now independent of the device time zone.
  - Every other export of `models.ts` and `calculations.ts` is unchanged, except that `UserProfile` and `LocalSetting` stay in `apps/web/src/models.ts`.
  - Test factories: `makeProduct`, `makeLot`, `makeReceipt`, `makeBatch`, `makeShipment`, `makeItem`, each `(overrides?: Partial<T>) => T`.

- [ ] **Step 1: Scaffold the package**

`packages/domain/package.json`:

```json
{
  "name": "@boat/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./models": "./src/models.ts",
    "./calculations": "./src/calculations.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

```bash
pnpm --filter @boat/domain add -D vitest@5.0.4 @vitest/coverage-v8@5.0.4 typescript@^7.0.2 @types/node@^24
pnpm --filter @boat/web add @boat/domain@workspace:*
```

`packages/domain/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

`packages/domain/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-factories.ts'],
      thresholds: { lines: 95 },
    },
  },
})
```

- [ ] **Step 2: Move the files and leave shims in the web app**

```bash
git mv apps/web/src/models.ts packages/domain/src/models.ts
git mv apps/web/src/calculations.ts packages/domain/src/calculations.ts
```

In `packages/domain/src/models.ts`, delete the `UserProfile` interface (with its comment) and the `LocalSetting` interface. Keep everything else, including `Role`.

Create `apps/web/src/models.ts`:

```ts
import type { RecordBase, Role } from '@boat/domain/models'

export * from '@boat/domain/models'

// Profiles stay in this browser only: they are never exported, imported, or cleared by a reset.
export interface UserProfile extends RecordBase {
  name: string
  role: Role
  // The point-of-contact value a POC profile owns; empty for other roles.
  poc: string
  pinHash: string
  pinSalt: string
}
export interface LocalSetting {
  key: string
  value: string
}
```

Create `apps/web/src/calculations.ts`:

```ts
export * from '@boat/domain/calculations'
```

Run: `pnpm --filter @boat/web typecheck`
Expected: exit 0.

- [ ] **Step 3: Write the test factories**

`packages/domain/src/test-factories.ts`:

```ts
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
```

- [ ] **Step 4: Write the failing tests for the two changed functions**

Create `packages/domain/src/calculations.test.ts` with only this block for now:

```ts
import { describe, expect, it } from 'vitest'
import { dateLabel, today } from './calculations'

describe('today', () => {
  it('uses the company time zone when given one', () => {
    const at = new Date('2026-10-14T20:00:00Z')
    expect(today('Asia/Kolkata', at)).toBe('2026-10-15')
    expect(today('UTC', at)).toBe('2026-10-14')
    expect(today('America/Los_Angeles', new Date('2026-10-15T03:00:00Z'))).toBe('2026-10-14')
  })
  it('falls back to the device time zone', () => {
    expect(today(undefined, new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('dateLabel', () => {
  it('labels dates and blanks', () => {
    expect(dateLabel('')).toBe('Not set')
    expect(dateLabel('2026-10-05')).toBe('05 Oct 2026')
  })
  it('gives the same label in a time zone west of UTC', () => {
    const tz = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      expect(dateLabel('2026-10-05')).toBe('05 Oct 2026')
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
})
```

Run: `pnpm --filter @boat/domain test`
Expected: FAIL. `today('Asia/Kolkata', at)` returns the machine's local date instead of `2026-10-15`, and the Los Angeles `dateLabel` returns `05 Sep 2026`.

- [ ] **Step 5: Implement both changes**

In `packages/domain/src/calculations.ts`, replace `today`:

```ts
// "Today" as YYYY-MM-DD. The server passes the company time zone; the browser omits it and gets
// the device's local date, as before.
export function today(timeZone?: string, at = new Date()): string {
  if (timeZone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    )
    return `${parts.year}-${parts.month}-${parts.day}`
  }
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}
```

In `dateLabel`, change the `toLocaleString` call to pass the time zone:

```ts
  return `${d} ${new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${y}`
```

Run: `pnpm --filter @boat/domain test`
Expected: PASS (4 tests).

- [ ] **Step 6: Add characterization tests for the rest of `calculations.ts`**

These pin today's behaviour before the server starts relying on it. Append to `packages/domain/src/calculations.test.ts`, and extend the import at the top to:

```ts
import {
  arrivalDelay,
  balance,
  clampPercent,
  completed,
  dayDiff,
  dayOffset,
  effectiveRmReadyDate,
  etaSlip,
  fullGrnDate,
  grnProgress,
  leadTime,
  lotFlags,
  lotSummary,
  monthEnd,
  monthLabel,
  monthOf,
  monthSummary,
  planDelay,
  quantity,
  rmMetrics,
  shipmentFlags,
  shipmentQuantity,
  shipmentStatus,
  signedDays,
  sum,
  totalGrn,
} from './calculations'
import { makeBatch, makeItem, makeLot, makeReceipt, makeShipment } from './test-factories'
```

Keep `dateLabel` and `today` in that import list as well. Then append:

```ts
const TODAY = '2026-10-14'

describe('date helpers', () => {
  it('offsets and diffs calendar days across month and year ends', () => {
    expect(dayOffset('2026-02-27', 2)).toBe('2026-03-01')
    expect(dayOffset('2026-01-01', -1)).toBe('2025-12-31')
    expect(dayDiff('2026-03-01', '2026-02-27')).toBe(2)
    expect(dayDiff('', '2026-01-01')).toBe(0)
  })
  it('finds month boundaries and labels', () => {
    expect(monthOf('2026-10-14')).toBe('2026-10')
    expect(monthEnd('2026-02')).toBe('2026-02-28')
    expect(monthEnd('2028-02')).toBe('2028-02-29')
    expect(monthLabel('2026-10')).toBe('October 2026')
  })
  it('formats numbers and day counts', () => {
    expect(sum([1, 2, 3])).toBe(6)
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(42)).toBe(42)
    expect(quantity(1234567)).toBe('12,34,567')
    expect(quantity(Number.NaN)).toBe('0')
    expect(signedDays(null)).toBe('—')
    expect(signedDays(0)).toBe('On time')
    expect(signedDays(3)).toBe('3d late')
    expect(signedDays(-11)).toBe('11d early')
  })
})

describe('GRN and completion', () => {
  const lot = makeLot({ lotQty: 100, plannedDate: '2026-10-20' })
  const first = makeReceipt({ date: '2026-10-05', quantity: 40 })
  const second = makeReceipt({ date: '2026-10-09', quantity: 60 })

  it('tracks a partial receipt', () => {
    expect(totalGrn([first])).toBe(40)
    expect(balance(lot, [first])).toBe(60)
    expect(completed(lot, [first])).toBe(false)
    expect(grnProgress(lot, [first])).toBe(40)
    expect(fullGrnDate(lot, [first])).toBe('')
    expect(planDelay(lot, [first])).toBeNull()
  })
  it('completes at full GRN and dates it by the latest receipt', () => {
    expect(balance(lot, [second, first])).toBe(0)
    expect(completed(lot, [second, first])).toBe(true)
    expect(grnProgress(lot, [second, first])).toBe(100)
    expect(fullGrnDate(lot, [first, second])).toBe('2026-10-09')
    expect(planDelay(lot, [first, second])).toBe(-11)
  })
  it('never completes a zero-quantity lot', () => {
    const empty = makeLot({ lotQty: 0 })
    expect(completed(empty, [])).toBe(false)
    expect(grnProgress(empty, [])).toBe(0)
  })
})

describe('RM readiness', () => {
  const components = makeLot({ rmMode: 'components', rmComponents: ['PCB', 'Enclosure'], lotQty: 100 })
  const batches = [
    makeBatch({ component: 'PCB', receivedQty: 60, receivedDate: '2026-10-02' }),
    makeBatch({ component: 'PCB', receivedQty: 50, receivedDate: '2026-10-04' }),
    makeBatch({ component: 'Enclosure', receivedQty: 90, receivedDate: '2026-10-03' }),
  ]

  it('prefers a manual RM ready date', () => {
    expect(effectiveRmReadyDate(makeLot({ rmReadyDate: '2026-10-01' }), [])).toBe('2026-10-01')
    expect(effectiveRmReadyDate(makeLot({ rmMode: 'all' }), [])).toBe('')
    expect(effectiveRmReadyDate({ ...components, lotQty: 0 }, batches)).toBe('')
  })
  it('dates component readiness by the last component to cover the lot', () => {
    expect(effectiveRmReadyDate(components, batches)).toBe('')
    const covered = [
      ...batches,
      makeBatch({ component: 'Enclosure', receivedQty: 10, receivedDate: '2026-10-03' }),
    ]
    expect(effectiveRmReadyDate(components, covered)).toBe('2026-10-04')
    const undated = [makeBatch({ component: 'PCB', receivedQty: 100, receivedDate: '' })]
    expect(effectiveRmReadyDate({ ...components, rmComponents: ['PCB'] }, undated)).toBe('')
  })
  it('measures RM-to-GRN lead time', () => {
    const covered = [
      ...batches,
      makeBatch({ component: 'Enclosure', receivedQty: 10, receivedDate: '2026-10-03' }),
    ]
    const receipts = [
      makeReceipt({ date: '2026-10-05', quantity: 40 }),
      makeReceipt({ date: '2026-10-09', quantity: 60 }),
    ]
    expect(leadTime(components, receipts, covered)).toBe(5)
    expect(leadTime(components, receipts)).toBeNull()
  })
  it('reports a kit in all-received mode', () => {
    expect(rmMetrics(makeLot({ lotQty: 100, readyQty: 80 }), [])).toEqual({
      target: 100,
      bottleneck: 'Kit (All Together)',
      producible: 80,
      percent: 80,
      complete: false,
    })
    expect(rmMetrics(makeLot({ lotQty: 100, readyQty: 120 }), [])).toMatchObject({
      producible: 100,
      percent: 100,
      complete: true,
    })
    expect(rmMetrics(makeLot({ lotQty: 0, readyQty: 0 }), [])).toMatchObject({
      percent: 0,
      complete: false,
    })
  })
  it('names the smallest component as the bottleneck', () => {
    expect(rmMetrics(components, batches)).toEqual({
      target: 100,
      bottleneck: 'Enclosure',
      producible: 90,
      percent: 90,
      complete: false,
    })
    expect(rmMetrics({ ...components, rmComponents: [] }, batches)).toEqual({
      target: 100,
      bottleneck: 'No components selected',
      producible: 0,
      percent: 0,
      complete: false,
    })
  })
})

describe('lot flags and summary', () => {
  it('flags overdue, due soon and follow-up from the effective ETA', () => {
    expect(lotFlags(makeLot({ plannedDate: '2026-10-10' }), [], TODAY)).toMatchObject({
      overdue: true,
      dueSoon: false,
    })
    expect(lotFlags(makeLot({ plannedDate: '2026-10-17' }), [], TODAY).dueSoon).toBe(true)
    expect(lotFlags(makeLot({ plannedDate: '2026-10-18' }), [], TODAY).dueSoon).toBe(false)
    expect(
      lotFlags(makeLot({ plannedDate: '2026-10-10', revisedEta: '2026-10-16' }), [], TODAY),
    ).toMatchObject({ overdue: false, dueSoon: true })
    expect(lotFlags(makeLot({ followUpDate: TODAY }), [], TODAY).followUp).toBe(true)
  })
  it('flags blocked and approval-blocked lots', () => {
    expect(lotFlags(makeLot({ status: 'Delayed' }), [], TODAY).blocked).toBe(true)
    expect(lotFlags(makeLot({ status: 'Hold' }), [], TODAY).blocked).toBe(true)
    expect(lotFlags(makeLot({ blockerCategory: 'Approval Blocker' }), [], TODAY)).toMatchObject({
      blocked: true,
      approval: true,
    })
    expect(lotFlags(makeLot(), [], TODAY).blocked).toBe(false)
  })
  it('clears every flag once the lot is complete', () => {
    const lot = makeLot({ lotQty: 100, plannedDate: '2026-10-01', status: 'Delayed' })
    expect(lotFlags(lot, [makeReceipt({ quantity: 100 })], TODAY)).toEqual({
      done: true,
      overdue: false,
      dueSoon: false,
      followUp: false,
      blocked: false,
      approval: false,
    })
  })
  it('writes the one-line status in the client format', () => {
    const delayed = makeLot({
      status: 'Delayed',
      revisedEta: '2026-10-15',
      blockerCategory: 'RM Blocker',
      stage: 'Factory Production',
    })
    expect(lotSummary(delayed, [], TODAY)).toBe(
      'Delayed, 1d left — RM Blocker (Factory Production)',
    )
    expect(lotSummary(makeLot({ plannedDate: '2026-10-11', stage: '' }), [], TODAY)).toBe(
      'On Track, 3d overdue',
    )
    expect(lotSummary(makeLot({ plannedDate: TODAY }), [], TODAY)).toBe(
      'On Track, due today (Factory Production)',
    )
    expect(lotSummary(makeLot({ plannedDate: '', status: '' }), [], TODAY)).toBe(
      'No status, no ETA (Factory Production)',
    )
    expect(lotSummary(makeLot({ lotQty: 10 }), [makeReceipt({ quantity: 10 })], TODAY)).toBe(
      'Completed (Factory Production)',
    )
  })
})

describe('shipments', () => {
  it('flags an open shipment past its ETA as overdue', () => {
    const late = makeShipment({ plannedEta: '2026-10-10' })
    expect(shipmentFlags(late, TODAY)).toEqual({
      open: true,
      overdue: true,
      soon: false,
      revised: false,
      arrived: false,
    })
    expect(shipmentStatus(late, TODAY)).toBe('Overdue 4d')
  })
  it('uses a revised ETA and falls back to the stage', () => {
    const revised = makeShipment({ plannedEta: '2026-10-10', revisedEta: '2026-10-16' })
    expect(shipmentFlags(revised, TODAY)).toMatchObject({ overdue: false, soon: true, revised: true })
    expect(etaSlip(revised)).toBe(6)
    expect(shipmentStatus(revised, TODAY)).toBe('In Transit')
    expect(shipmentStatus({ ...revised, stage: '' }, TODAY)).toBe('In transit')
    expect(etaSlip(makeShipment({ plannedEta: '' }))).toBeNull()
  })
  it('reports arrival against the planned ETA', () => {
    const base = { plannedEta: '2026-10-10' }
    expect(shipmentStatus(makeShipment({ ...base, actualArrival: '2026-10-12' }), TODAY)).toBe(
      'Arrived 2d late',
    )
    expect(shipmentStatus(makeShipment({ ...base, actualArrival: '2026-10-08' }), TODAY)).toBe(
      'Arrived 2d early',
    )
    expect(shipmentStatus(makeShipment({ ...base, actualArrival: '2026-10-10' }), TODAY)).toBe(
      'Arrived on time',
    )
    expect(
      shipmentStatus(makeShipment({ plannedEta: '', actualArrival: '2026-10-10' }), TODAY),
    ).toBe('Arrived')
    expect(arrivalDelay(makeShipment({ ...base, actualArrival: '2026-10-12' }))).toBe(2)
    expect(arrivalDelay(makeShipment(base))).toBeNull()
  })
  it('sums line quantities', () => {
    expect(shipmentQuantity([makeItem({ quantity: 5 }), makeItem({ quantity: 7 })])).toBe(12)
  })
})

describe('monthSummary', () => {
  const a = makeLot({ id: 'a', productId: 'p1', lotQty: 100, plannedDate: '2026-10-05' })
  const b = makeLot({
    id: 'b',
    productId: 'p1',
    lotQty: 50,
    plannedDate: '2026-10-28',
    revisedEta: '2026-11-05',
  })
  const c = makeLot({ id: 'c', productId: 'p2', lotQty: 30, plannedDate: '2026-11-02' })
  const receipts = [
    makeReceipt({ lotId: 'a', date: '2026-10-10', quantity: 60 }),
    makeReceipt({ lotId: 'a', date: '2026-11-01', quantity: 40 }),
    makeReceipt({ lotId: 'b', date: '2026-10-30', quantity: 50 }),
    makeReceipt({ lotId: 'c', date: '2026-10-31', quantity: 30 }),
  ]

  it('compares lots by original planned month with GRN up to month end', () => {
    const s = monthSummary([a, b, c], receipts, '2026-10')
    expect(s.lots.map((r) => [r.lot.id, r.planned, r.received, r.shortfall])).toEqual([
      ['a', 100, 60, 40],
      ['b', 50, 50, 0],
    ])
    expect(s.products).toEqual([
      { productId: 'p1', lots: 2, planned: 150, received: 110, shortfall: 40 },
    ])
    expect(s).toMatchObject({ planned: 150, received: 110, shortfall: 40, grnInMonth: 140 })
    expect(s.percent).toBeCloseTo(73.33, 2)
  })
  it('counts receipts dated before the planned month', () => {
    const s = monthSummary([a, b, c], receipts, '2026-11')
    expect(s.lots.map((r) => [r.lot.id, r.received, r.shortfall])).toEqual([['c', 30, 0]])
    expect(s.grnInMonth).toBe(40)
  })
  it('returns zeros for an empty month', () => {
    expect(monthSummary([a, b, c], receipts, '2026-12')).toMatchObject({
      planned: 0,
      received: 0,
      percent: 0,
      grnInMonth: 0,
    })
  })
})
```

Run: `pnpm --filter @boat/domain test`
Expected: PASS. These tests describe existing code, so any failure means the test's expectation is wrong. Re-derive the expected value from the function body, fix the test, and note the correction in the commit message. Never change `calculations.ts` to fit a characterization test.

- [ ] **Step 7: Add model tests**

`packages/domain/src/models.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isSystemLookup, productChoices, stamp } from './models'
import { makeProduct } from './test-factories'

describe('models', () => {
  it('protects the system lookup values', () => {
    expect(isSystemLookup('status', 'Delayed')).toBe(true)
    expect(isSystemLookup('blocker', 'Approval Blocker')).toBe(true)
    expect(isSystemLookup('status', 'Custom')).toBe(false)
    expect(isSystemLookup('ems', 'BAU')).toBe(false)
  })
  it('stamps new records with an id and timestamps', () => {
    const record = stamp({ name: 'x' })
    expect(record.name).toBe('x')
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
  it('labels product choices and disambiguates repeated names', () => {
    const choices = productChoices([
      makeProduct({ id: 'aaaaaa-1', segment: 'Solar' }),
      makeProduct({ id: 'bbbbbb-2', segment: 'UPS' }),
      makeProduct({ id: 'cccccc-3', name: 'Battery', variant: '' }),
    ])
    expect(choices.map((c) => c.label)).toEqual([
      'Inverter · 5 kW · Solar · aaaaaa',
      'Inverter · 5 kW · UPS · bbbbbb',
      'Battery',
    ])
    expect(choices[0].value).toBe('aaaaaa-1')
  })
})
```

Run: `pnpm --filter @boat/domain test`
Expected: PASS.

- [ ] **Step 8: Verify the web app still builds and works**

```bash
pnpm typecheck
pnpm --filter @boat/web build
```

Expected: both exit 0. Run `pnpm dev`, open a lot and the Month-end tab, and confirm the dates read like `05 Oct 2026` as before.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Move models and calculations into the domain package

today() takes the company time zone; dateLabel no longer shifts
months west of UTC.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Move validation into `@boat/domain` with an injectable date

**Files:**
- Create: `packages/domain/src/validation.ts`, `packages/domain/src/validation.test.ts`
- Modify: `packages/domain/package.json` (exports), `apps/web/src/validation.ts` (becomes shim + `validateUser`)

**Interfaces:**
- Consumes: `today()` from Task 2. Types from `./models`.
- Produces (`@boat/domain/validation`):
  - `type FieldErrors = Record<string, string>`
  - `class ValidationError extends Error { fields: FieldErrors }`
  - `fieldErrors(e: unknown): FieldErrors`, `assertValid(errors: FieldErrors): void`
  - `lineField(id: string, field: 'productId' | 'quantity'): string`
  - `collect(entries: [string, string | false | undefined][]): FieldErrors`
  - `validateProduct(p: Product)`, `validateLot(l: Lot)`, `validateLookupValue(value: string)`
  - `validateBatch(b: RMBatch, date?: string)`, `validateReceipt(r: GRNReceipt, available?: number, date?: string)`, `validateShipment(s: Shipment, lines: ShipmentItem[], date?: string)`. `date` defaults to `today()`, and the server will pass the company date.
- `validateUser` stays in `apps/web/src/validation.ts`, because PIN profiles are browser-only and retire in Phase 5.

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { makeBatch, makeItem, makeLot, makeProduct, makeReceipt, makeShipment } from './test-factories'
import {
  assertValid,
  fieldErrors,
  lineField,
  validateBatch,
  validateLookupValue,
  validateLot,
  validateProduct,
  validateReceipt,
  validateShipment,
  ValidationError,
} from './validation'

const TODAY = '2026-10-14'

describe('ValidationError helpers', () => {
  it('summarises one or several field errors', () => {
    expect(new ValidationError({ a: 'Enter A.' }).message).toBe('Enter A.')
    expect(new ValidationError({ a: 'x', b: 'y' }).message).toBe('Check 2 highlighted fields.')
  })
  it('maps any thrown value to a field map', () => {
    expect(fieldErrors(new ValidationError({ a: 'x' }))).toEqual({ a: 'x' })
    expect(fieldErrors(new Error('boom'))).toEqual({ form: 'boom' })
    expect(fieldErrors('nope')).toEqual({ form: 'Save failed.' })
  })
  it('throws only when there are errors', () => {
    expect(() => assertValid({})).not.toThrow()
    expect(() => assertValid({ a: 'x' })).toThrow(ValidationError)
  })
  it('names shipment line fields', () => {
    expect(lineField('l1', 'quantity')).toBe('line:l1:quantity')
  })
})

describe('validateProduct and validateLookupValue', () => {
  it('requires a name, a segment and a value', () => {
    expect(validateProduct(makeProduct())).toEqual({})
    expect(validateProduct(makeProduct({ name: ' ', segment: '' }))).toEqual({
      name: 'Enter the product name.',
      segment: 'Choose a segment.',
    })
    expect(validateLookupValue('  ')).toEqual({ value: 'Enter a value.' })
  })
})

describe('validateLot', () => {
  it('accepts a complete lot', () => {
    expect(validateLot(makeLot())).toEqual({})
  })
  it('requires whole, non-negative quantities', () => {
    expect(validateLot(makeLot({ lotQty: 1.5 })).lotQty).toBe(
      'Lot quantity must be a whole number, zero or more.',
    )
    expect(validateLot(makeLot({ reworkQty: -1 })).reworkQty).toBe(
      'Rework quantity must be a whole number, zero or more.',
    )
  })
  it('keeps rework within fresh production', () => {
    expect(validateLot(makeLot({ freshProductionQty: 3, reworkQty: 5 })).reworkQty).toBe(
      'Rework is part of fresh production, so it cannot be larger.',
    )
  })
  it('checks ready quantity only in all-received mode', () => {
    expect(validateLot(makeLot({ rmMode: 'all', readyQty: -1 })).readyQty).toBe(
      'Ready quantity must be a whole number, zero or more.',
    )
    expect(validateLot(makeLot({ rmMode: 'components', readyQty: -1 })).readyQty).toBeUndefined()
  })
  it('refuses the kit as a tracked component', () => {
    expect(
      validateLot(makeLot({ rmMode: 'components', rmComponents: ['Kit (All Together)'] }))
        .rmComponents,
    ).toBe('Kit is an alternative to individual components. Use All RM Received mode for a kit.')
  })
  it('requires the plan fields', () => {
    expect(
      Object.keys(
        validateLot(makeLot({ productId: '', label: '', category: '', status: '', stage: '' })),
      ),
    ).toEqual(['productId', 'label', 'category', 'status', 'stage'])
  })
})

describe('validateBatch', () => {
  it('refuses a received date after the given day', () => {
    expect(validateBatch(makeBatch({ receivedDate: '2026-10-15' }), TODAY)).toEqual({
      receivedDate: 'Received date cannot be in the future.',
    })
    expect(validateBatch(makeBatch({ receivedDate: TODAY }), TODAY)).toEqual({})
  })
  it('requires a component, a label and whole quantities', () => {
    expect(validateBatch(makeBatch({ component: '', label: '', receivedQty: 2.5 }), TODAY)).toEqual(
      {
        component: 'Choose a component.',
        label: 'Enter a batch label.',
        receivedQty: 'Received quantity must be a whole number, zero or more.',
      },
    )
  })
})

describe('validateReceipt', () => {
  it('requires a dated, positive receipt', () => {
    expect(validateReceipt(makeReceipt(), undefined, TODAY)).toEqual({})
    expect(validateReceipt(makeReceipt({ date: '' }), undefined, TODAY).date).toBe(
      'Choose the receipt date.',
    )
    expect(validateReceipt(makeReceipt({ quantity: 0 }), undefined, TODAY).quantity).toBe(
      'Quantity must be greater than zero.',
    )
  })
  it('refuses future dates, by the given day or by the real today', () => {
    expect(validateReceipt(makeReceipt({ date: '2026-10-15' }), undefined, TODAY).date).toBe(
      'Receipt date cannot be in the future.',
    )
    expect(validateReceipt(makeReceipt({ date: '2999-01-01' })).date).toBe(
      'Receipt date cannot be in the future.',
    )
  })
  it('refuses more than the lot has left to receive', () => {
    expect(validateReceipt(makeReceipt({ quantity: 50 }), 40, TODAY).quantity).toBe(
      'Only 40 units are left to receive on this lot.',
    )
  })
})

describe('validateShipment', () => {
  it('accepts a shipment with one line', () => {
    expect(validateShipment(makeShipment(), [makeItem()], TODAY)).toEqual({})
  })
  it('requires a number, a carrier and at least one line', () => {
    expect(validateShipment(makeShipment({ number: '', vessel: ' ' }), [], TODAY)).toEqual({
      number: 'Enter the shipment or invoice number.',
      vessel: 'Enter the vessel, flight, or carrier.',
      lines: 'Add at least one product line.',
    })
  })
  it('keeps ETAs and arrival on or after ETD, and arrival not in the future', () => {
    const s = makeShipment({
      etd: '2026-10-05',
      plannedEta: '2026-10-01',
      revisedEta: '2026-10-02',
      actualArrival: '2026-10-03',
    })
    expect(validateShipment(s, [makeItem()], TODAY)).toEqual({
      plannedEta: 'Planned ETA cannot be before ETD.',
      revisedEta: 'Revised ETA cannot be before ETD.',
      actualArrival: 'Arrival cannot be before ETD.',
    })
    expect(
      validateShipment(makeShipment({ actualArrival: '2026-10-15' }), [makeItem()], TODAY)
        .actualArrival,
    ).toBe('Arrival cannot be in the future.')
  })
  it('flags duplicate products and bad line quantities', () => {
    const lines = [
      makeItem({ id: 'l1', productId: 'p' }),
      makeItem({ id: 'l2', productId: 'p', quantity: 0 }),
      makeItem({ id: 'l3', productId: '', quantity: 1.5 }),
    ]
    expect(validateShipment(makeShipment(), lines, TODAY)).toEqual({
      'line:l1:productId': 'This product is already on another line. Combine the quantities.',
      'line:l2:productId': 'This product is already on another line. Combine the quantities.',
      'line:l2:quantity': 'Must be more than zero.',
      'line:l3:productId': 'Choose a product.',
      'line:l3:quantity': 'Quantity must be a whole number, zero or more.',
    })
  })
})
```

Run: `pnpm --filter @boat/domain test`
Expected: FAIL with `Failed to resolve import "./validation"`.

- [ ] **Step 2: Create the domain validation module**

`packages/domain/src/validation.ts`:

```ts
import { today } from './calculations'
import type { GRNReceipt, Lot, Product, RMBatch, Shipment, ShipmentItem } from './models'

// Field name → message. Forms show each message under its field; the server returns the same map
// in a 422 response, so a save that slips past the form is still rejected with field detail.
export type FieldErrors = Record<string, string>
export class ValidationError extends Error {
  fields: FieldErrors
  constructor(fields: FieldErrors) {
    const messages = Object.values(fields)
    super(messages.length === 1 ? messages[0] : `Check ${messages.length} highlighted fields.`)
    this.name = 'ValidationError'
    this.fields = fields
  }
}
export const fieldErrors = (e: unknown): FieldErrors =>
  e instanceof ValidationError
    ? e.fields
    : { form: e instanceof Error ? e.message : 'Save failed.' }
export function assertValid(errors: FieldErrors) {
  if (Object.keys(errors).length) throw new ValidationError(errors)
}
export const lineField = (id: string, field: 'productId' | 'quantity') => `line:${id}:${field}`

const blank = (s: string) => !s.trim()
// Quantities are whole units; fractions would make exact GRN completion checks unreliable.
const wholeNumber = (n: number, name: string) =>
  Number.isInteger(n) && n >= 0 ? '' : `${name} must be a whole number, zero or more.`
// Keeps the first message per field, so the most basic problem is the one shown.
export function collect(entries: [string, string | false | undefined][]) {
  const errors: FieldErrors = {}
  for (const [field, message] of entries) if (message && !errors[field]) errors[field] = message
  return errors
}

export const validateProduct = (p: Product) =>
  collect([
    ['name', blank(p.name) && 'Enter the product name.'],
    ['segment', blank(p.segment) && 'Choose a segment.'],
  ])

export const validateLot = (l: Lot) =>
  collect([
    ['productId', blank(l.productId) && 'Choose a product.'],
    ['label', blank(l.label) && 'Enter a lot label, e.g. Lot 1.'],
    ['category', blank(l.category) && 'Choose a product category.'],
    ['status', blank(l.status) && 'Choose an overall status.'],
    ['stage', blank(l.stage) && 'Choose the current stage.'],
    ['lotQty', wholeNumber(l.lotQty, 'Lot quantity')],
    ['freshProductionQty', wholeNumber(l.freshProductionQty, 'Fresh production quantity')],
    ['reworkQty', wholeNumber(l.reworkQty, 'Rework quantity')],
    [
      'reworkQty',
      l.reworkQty > l.freshProductionQty &&
        'Rework is part of fresh production, so it cannot be larger.',
    ],
    ['readyQty', l.rmMode === 'all' && wholeNumber(l.readyQty, 'Ready quantity')],
    [
      'rmComponents',
      l.rmMode === 'components' &&
        l.rmComponents.includes('Kit (All Together)') &&
        'Kit is an alternative to individual components. Use All RM Received mode for a kit.',
    ],
  ])

// date is "today" for the no-future-date rules; the server passes the company date.
export const validateBatch = (b: RMBatch, date = today()) =>
  collect([
    ['component', blank(b.component) && 'Choose a component.'],
    ['label', blank(b.label) && 'Enter a batch label.'],
    ['plannedQty', wholeNumber(b.plannedQty, 'Planned quantity')],
    ['receivedQty', wholeNumber(b.receivedQty, 'Received quantity')],
    ['receivedDate', b.receivedDate > date && 'Received date cannot be in the future.'],
  ])

export const validateReceipt = (r: GRNReceipt, available?: number, date = today()) =>
  collect([
    ['label', blank(r.label) && 'Enter a receipt label.'],
    ['date', !r.date && 'Choose the receipt date.'],
    ['date', r.date > date && 'Receipt date cannot be in the future.'],
    ['quantity', wholeNumber(r.quantity, 'Quantity')],
    ['quantity', r.quantity <= 0 && 'Quantity must be greater than zero.'],
    [
      'quantity',
      available !== undefined &&
        r.quantity > available &&
        `Only ${available} units are left to receive on this lot.`,
    ],
  ])

export function validateShipment(s: Shipment, lines: ShipmentItem[], date = today()) {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line.productId, (counts.get(line.productId) || 0) + 1)
  const beforeEtd = (value: string) => !!s.etd && !!value && value < s.etd
  return collect([
    ['number', blank(s.number) && 'Enter the shipment or invoice number.'],
    ['vessel', blank(s.vessel) && 'Enter the vessel, flight, or carrier.'],
    ['plannedEta', beforeEtd(s.plannedEta) && 'Planned ETA cannot be before ETD.'],
    ['revisedEta', beforeEtd(s.revisedEta) && 'Revised ETA cannot be before ETD.'],
    ['actualArrival', beforeEtd(s.actualArrival) && 'Arrival cannot be before ETD.'],
    ['actualArrival', s.actualArrival > date && 'Arrival cannot be in the future.'],
    ['lines', !lines.length && 'Add at least one product line.'],
    ...lines.flatMap((line): [string, string | false][] => [
      [lineField(line.id, 'productId'), !line.productId && 'Choose a product.'],
      [
        lineField(line.id, 'productId'),
        !!line.productId &&
          (counts.get(line.productId) || 0) > 1 &&
          'This product is already on another line. Combine the quantities.',
      ],
      [lineField(line.id, 'quantity'), wholeNumber(line.quantity, 'Quantity')],
      [lineField(line.id, 'quantity'), line.quantity <= 0 && 'Must be more than zero.'],
    ]),
  ])
}

export const validateLookupValue = (value: string) =>
  collect([['value', blank(value) && 'Enter a value.']])
```

Add the export to `packages/domain/package.json`:

```json
    "./validation": "./src/validation.ts"
```

Run: `pnpm --filter @boat/domain test`
Expected: PASS.

- [ ] **Step 3: Replace the web validation module with a shim plus `validateUser`**

Overwrite `apps/web/src/validation.ts`:

```ts
import { collect } from '@boat/domain/validation'
import { roles, validatePin } from './access'
import type { UserProfile } from './models'

export * from '@boat/domain/validation'

const blank = (s: string) => !s.trim()

// pin and confirm are blank when an existing PIN is kept. Viewers may have no PIN at all.
export function validateUser(u: UserProfile, pin: string, confirm: string) {
  const changingPin = !!(pin || confirm)
  return collect([
    ['name', blank(u.name) && 'Enter a name.'],
    ['name', u.name.trim().length > 40 && 'Keep the name to 40 characters or fewer.'],
    ['role', !roles.includes(u.role) && 'Choose a role.'],
    ['poc', u.role === 'poc' && blank(u.poc) && 'Choose the point of contact this profile owns.'],
    ['pin', changingPin && validatePin(pin)],
    ['confirm', changingPin && !validatePin(pin) && validatePin(pin, confirm)],
    ['pin', !changingPin && u.role !== 'viewer' && !u.pinHash && 'Set a PIN of 4 to 8 digits.'],
  ])
}
```

Run: `pnpm typecheck && pnpm --filter @boat/web build`
Expected: both exit 0.

- [ ] **Step 4: Manually check the forms**

Run `pnpm dev`. In a lot drawer, enter rework above fresh production and save: the same message appears under Rework. Add a GRN receipt dated tomorrow: "Receipt date cannot be in the future." appears. In Settings → profiles, save a POC profile with no POC chosen: the POC message appears.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Move validation into the domain package

Date rules take an optional 'today' so the server can pass the
company date. validateUser stays in the web app with the PIN
profiles.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Move role permissions into `@boat/domain`

**Files:**
- Create: `packages/domain/src/permissions.ts`, `packages/domain/src/permissions.test.ts`
- Modify: `packages/domain/package.json` (exports), `apps/web/src/access.ts`

**Interfaces:**
- Consumes: `Lot` and `Role` from `./models`.
- Produces (`@boat/domain/permissions`):
  - `roleInfo: Record<Role, { label: string; description: string }>`, `roles: Role[]`
  - `type Action` (the 10 actions), `actionVerbs: Record<Action, string>`
  - `planFields: (keyof Lot)[]`
  - `type Actor = { role: Role; poc: string }`. `UserProfile` already satisfies it, and Phase 2's session user will too.
  - `roleCan(role: Role, action: Action): boolean`
  - `type LotAccess = 'full' | 'progress' | 'none'`, `actorLotAccess(actor: Actor | null, lot: Pick<Lot, 'poc'>): LotAccess`
  - `changedPlanFields(lot: Lot, next: Lot): (keyof Lot)[]`
  - `lotEditDenial(actor: Actor | null, lot: Lot, next?: Lot): string | undefined` returns the "what you can't do" phrase, or `undefined` when the edit is allowed.
  - `deniedMessage(role: Role | null, what: string): string`
  - `class PermissionError extends Error`
- `apps/web/src/access.ts` keeps its public API (`can`, `lotAccess`, `requireAction`, `requireLotEdit`, `setAccess`, `actorName`, `AccessContext`, `useAccess`, PIN and session helpers) and re-exports `roleInfo`, `roles`, `planFields`, `PermissionError`, `actionVerbs`, `Action` and `LotAccess`.

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Role } from './models'
import {
  actionVerbs,
  actorLotAccess,
  changedPlanFields,
  deniedMessage,
  lotEditDenial,
  roleCan,
  roleInfo,
  roles,
  type Action,
} from './permissions'
import { makeLot } from './test-factories'

// The PRD's role table, written out independently of the implementation.
const allowed: Record<Role, Action[]> = {
  admin: [
    'manageSettings',
    'manageData',
    'exportBackup',
    'editProducts',
    'deleteProducts',
    'createLots',
    'deleteLots',
    'editShipments',
    'deleteShipments',
    'deleteEntries',
  ],
  planner: ['exportBackup', 'editProducts', 'createLots', 'editShipments', 'deleteEntries'],
  poc: [],
  viewer: [],
}
const actions = Object.keys(actionVerbs) as Action[]

describe('roleCan', () => {
  it('knows all ten actions and four roles', () => {
    expect(actions).toHaveLength(10)
    expect(roles).toEqual(['admin', 'planner', 'poc', 'viewer'])
    expect(roleInfo.poc.label).toBe('POC')
  })
  it.each(roles.flatMap((role) => actions.map((action) => [role, action] as const)))(
    '%s → %s matches the role table',
    (role, action) => {
      expect(roleCan(role, action)).toBe(allowed[role].includes(action))
    },
  )
})

describe('actorLotAccess', () => {
  const owned = { poc: 'Ravi' }
  it('gives admins and planners full access', () => {
    expect(actorLotAccess({ role: 'admin', poc: '' }, owned)).toBe('full')
    expect(actorLotAccess({ role: 'planner', poc: '' }, owned)).toBe('full')
  })
  it('gives a POC progress access to their own lots only', () => {
    expect(actorLotAccess({ role: 'poc', poc: 'Ravi' }, owned)).toBe('progress')
    expect(actorLotAccess({ role: 'poc', poc: 'Asha' }, owned)).toBe('none')
    expect(actorLotAccess({ role: 'poc', poc: '' }, { poc: '' })).toBe('none')
  })
  it('gives viewers and signed-out users no access', () => {
    expect(actorLotAccess({ role: 'viewer', poc: '' }, owned)).toBe('none')
    expect(actorLotAccess(null, owned)).toBe('none')
  })
})

describe('lot edit rules', () => {
  const lot = makeLot({ poc: 'Ravi', lotQty: 100, plannedDate: '2026-10-20' })
  const ravi = { role: 'poc' as const, poc: 'Ravi' }

  it('lists changed plan fields in plan order', () => {
    expect(changedPlanFields(lot, { ...lot, plannedDate: '2026-10-25', lotQty: 120 })).toEqual([
      'lotQty',
      'plannedDate',
    ])
    expect(changedPlanFields(lot, { ...lot, status: 'Delayed' })).toEqual([])
    expect(changedPlanFields(lot, { ...lot, rmComponents: ['PCB'] })).toEqual(['rmComponents'])
  })
  it('lets a POC change progress but not the plan', () => {
    expect(lotEditDenial(ravi, lot, { ...lot, status: 'Delayed', reworkQty: 0 })).toBeUndefined()
    expect(lotEditDenial(ravi, lot)).toBeUndefined()
    expect(lotEditDenial(ravi, lot, { ...lot, lotQty: 120 })).toBe(
      'change plan fields such as product, lot quantity, planned date, or POC',
    )
  })
  it('names the owner when access is refused', () => {
    expect(lotEditDenial({ role: 'viewer', poc: '' }, lot)).toBe('edit lots owned by Ravi')
    expect(lotEditDenial({ role: 'poc', poc: 'Asha' }, makeLot({ poc: '' }))).toBe(
      'edit lots without a POC',
    )
  })
  it('lets planners change the plan', () => {
    expect(lotEditDenial({ role: 'planner', poc: '' }, lot, { ...lot, lotQty: 120 })).toBeUndefined()
  })
  it('words the refusal by role', () => {
    expect(deniedMessage('planner', 'delete lots')).toBe(
      "Planner profiles can't delete lots. Ask an admin.",
    )
    expect(deniedMessage(null, 'delete lots')).toBe('Sign in to make changes.')
  })
})
```

Run: `pnpm --filter @boat/domain test`
Expected: FAIL with `Failed to resolve import "./permissions"`.

- [ ] **Step 2: Create the domain permissions module**

`packages/domain/src/permissions.ts`:

```ts
import type { Lot, Role } from './models'

export const roleInfo: Record<Role, { label: string; description: string }> = {
  admin: {
    label: 'Admin',
    description: 'Everything, including Settings, profiles, import, restore, reset, and deletes.',
  },
  planner: {
    label: 'Planner',
    description:
      'Adds and edits products, lots, and shipments, and corrects RM batches and GRN receipts. No Settings, restore, reset, or record deletes.',
  },
  poc: {
    label: 'POC',
    description:
      'Updates progress on lots assigned to them: status, quantities, ETAs, blockers, RM batches, GRN receipts, and notes.',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only. Can browse every screen and download CSV files.',
  },
}
export const roles = Object.keys(roleInfo) as Role[]

export type Action =
  | 'manageSettings'
  | 'manageData'
  | 'exportBackup'
  | 'editProducts'
  | 'deleteProducts'
  | 'createLots'
  | 'deleteLots'
  | 'editShipments'
  | 'deleteShipments'
  | 'deleteEntries'
export const actionVerbs: Record<Action, string> = {
  manageSettings: 'change Settings or profiles',
  manageData: 'import, restore, or reset data',
  exportBackup: 'export a JSON backup',
  editProducts: 'add or edit products',
  deleteProducts: 'delete products',
  createLots: 'create lots',
  deleteLots: 'delete lots',
  editShipments: 'add or edit shipments',
  deleteShipments: 'delete shipments',
  deleteEntries: 'delete RM batches or GRN receipts',
}
const grants: Record<Role, Action[]> = {
  admin: Object.keys(actionVerbs) as Action[],
  planner: ['exportBackup', 'editProducts', 'createLots', 'editShipments', 'deleteEntries'],
  poc: [],
  viewer: [],
}
// Lot fields that set the plan. A POC can update progress on their lots but not these.
export const planFields: (keyof Lot)[] = [
  'productId',
  'label',
  'category',
  'directFg',
  'ems',
  'poc',
  'rmMode',
  'rmComponents',
  'lotQty',
  'plannedDate',
]

// Who is acting: a browser profile today, the signed-in user on the server.
export type Actor = { role: Role; poc: string }

export const roleCan = (role: Role, action: Action) => grants[role].includes(action)

// full: every field. progress: everything except plan fields. none: read-only.
export type LotAccess = 'full' | 'progress' | 'none'
export function actorLotAccess(actor: Actor | null, lot: Pick<Lot, 'poc'>): LotAccess {
  if (!actor) return 'none'
  if (actor.role === 'admin' || actor.role === 'planner') return 'full'
  return actor.role === 'poc' && !!actor.poc && lot.poc === actor.poc ? 'progress' : 'none'
}

export const changedPlanFields = (lot: Lot, next: Lot) =>
  planFields.filter((k) => JSON.stringify(lot[k]) !== JSON.stringify(next[k]))

// The phrase for "<Role> profiles can't …", or undefined when the edit is allowed.
export function lotEditDenial(actor: Actor | null, lot: Lot, next?: Lot) {
  const level = actorLotAccess(actor, lot)
  if (level === 'none') return lot.poc ? `edit lots owned by ${lot.poc}` : 'edit lots without a POC'
  if (level === 'progress' && next && changedPlanFields(lot, next).length)
    return 'change plan fields such as product, lot quantity, planned date, or POC'
}

export class PermissionError extends Error {}
export const deniedMessage = (role: Role | null, what: string) =>
  role ? `${roleInfo[role].label} profiles can't ${what}. Ask an admin.` : 'Sign in to make changes.'
```

Add the export to `packages/domain/package.json`:

```json
    "./permissions": "./src/permissions.ts"
```

Run: `pnpm --filter @boat/domain test`
Expected: PASS.

- [ ] **Step 3: Make the web access module delegate to the domain**

In `apps/web/src/access.ts`, replace everything from the first line down to (but not including) the line `export const AccessContext = createContext<AccessState>(openAccess)` with:

```ts
import { createContext, useContext } from 'react'
import {
  actionVerbs,
  actorLotAccess,
  deniedMessage,
  lotEditDenial,
  PermissionError,
  roleCan,
  type Action,
  type LotAccess,
} from '@boat/domain/permissions'
import type { Lot, UserProfile } from './models'

export {
  actionVerbs,
  planFields,
  PermissionError,
  roleInfo,
  roles,
  type Action,
  type LotAccess,
} from '@boat/domain/permissions'

// UI role modes. They prevent accidental changes on a shared browser; they are not a security
// boundary, because anyone with developer tools can edit IndexedDB directly.

// enabled is false until the first profile is created; the app then works as before.
export type AccessState = { enabled: boolean; user: UserProfile | null }
const openAccess: AccessState = { enabled: false, user: null }
let current = openAccess
// The repository checks this state, so a hidden button is never the only guard.
export const setAccess = (state: AccessState) => {
  current = state
}
export const actorName = () => (current.enabled ? current.user?.name : undefined)

export function can(action: Action, state = current) {
  if (!state.enabled) return true
  return !!state.user && roleCan(state.user.role, action)
}
export function lotAccess(lot: Pick<Lot, 'poc'>, state = current): LotAccess {
  return state.enabled ? actorLotAccess(state.user, lot) : 'full'
}

const denied = (what: string) => new PermissionError(deniedMessage(current.user?.role ?? null, what))
export function requireAction(action: Action) {
  if (!can(action)) throw denied(actionVerbs[action])
}
export function requireLotEdit(lot: Lot, next?: Lot) {
  const what = current.enabled ? lotEditDenial(current.user, lot, next) : undefined
  if (what) throw denied(what)
}

```

Leave `AccessContext`, `useAccess`, `validatePin`, `hex`, `newSalt`, `hashSecret`, the recovery-key helpers and the session helpers below it unchanged.

Run: `pnpm typecheck && pnpm --filter @boat/web build && pnpm format:check`
Expected: all exit 0. If `format:check` flags files you touched, run `pnpm format`.

- [ ] **Step 4: Manually check the roles**

Run `pnpm dev`. Sign in as a Planner profile: the delete button for a lot is hidden, and Settings is locked. Sign in as a POC: the plan fields on a lot owned by another POC are read-only, and on their own lot only progress fields are editable. Sign in as a Viewer: everything is read-only and CSV download works.

- [ ] **Step 5: Check the domain coverage gate**

Run: `pnpm --filter @boat/domain test:coverage`
Expected: PASS with line coverage ≥ 95%. If it is lower, the report names the uncovered lines. Add a characterization test for each in the matching `*.test.ts` file, and do not lower the threshold.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Move role permissions into the domain package

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Express app skeleton with health checks and web serving

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/src/app.ts`, `apps/api/src/core/errors.ts`, `apps/api/src/modules/health/health.router.ts`, `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: nothing from the domain yet. The workspace dependency is added now so later phases can import it.
- Produces:
  - `type ReadinessCheck = () => Promise<void>` (throws when not ready), in `modules/health/health.router.ts`
  - `healthRouter(checkDatabase: ReadinessCheck): Router`
  - `type AppOptions = { logger: Logger; webDist?: string; checkDatabase: ReadinessCheck }`
  - `createApp(options: AppOptions): Express`, which mounts `/api/v1/health/live` and `/api/v1/health/ready`, answers other `/api/*` paths with JSON 404, and serves `webDist` with SPA fallback when `webDist/index.html` exists.
  - `errorHandler: ErrorRequestHandler`: malformed JSON → 400 `{ error: 'bad_request', message }`, body too large → 413 `{ error: 'payload_too_large' }`, anything else → 500 `{ error: 'internal' }`.
  - Every response carries an `x-request-id` header, echoing the request's header when present and a new UUID otherwise.

- [ ] **Step 1: Scaffold the package**

`apps/api/package.json`:

```json
{
  "name": "@boat/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

```bash
pnpm --filter @boat/api add express@5.3.0 pino@10.4.0 pino-http@11.0.0 @boat/domain@workspace:*
pnpm --filter @boat/api add -D @types/express@5.0.6 @types/node@^24 supertest@7.3.1 @types/supertest@7.2.1 typescript@^7.0.2 vitest@5.0.4
```

`apps/api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "test", "*.config.ts"]
}
```

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/app.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pino } from 'pino'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'

const logger = pino({ level: 'silent' })
const ready = async () => {}
const app = (webDist?: string, checkDatabase = ready) =>
  createApp({ logger, webDist, checkDatabase })

function fakeWebBuild() {
  const dir = mkdtempSync(path.join(tmpdir(), 'boat-web-'))
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Boat</title>')
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)')
  return dir
}

describe('health', () => {
  it('reports live', async () => {
    const res = await request(app()).get('/api/v1/health/live')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
  it('reports ready when the database answers', async () => {
    const res = await request(app()).get('/api/v1/health/ready')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
  it('returns 503 when the database check fails', async () => {
    const down = async () => {
      throw new Error('connection refused')
    }
    const res = await request(app(undefined, down)).get('/api/v1/health/ready')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'unavailable' })
  })
})

describe('request ids', () => {
  it('echoes an incoming x-request-id', async () => {
    const res = await request(app()).get('/api/v1/health/live').set('x-request-id', 'abc-123')
    expect(res.headers['x-request-id']).toBe('abc-123')
  })
  it('creates one when the request has none', async () => {
    const res = await request(app()).get('/api/v1/health/live')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('errors', () => {
  it('answers malformed JSON with 400', async () => {
    const res = await request(app())
      .post('/api/v1/health/live')
      .set('content-type', 'application/json')
      .send('{bad')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'bad_request', message: 'The request body is not valid JSON.' })
  })
  it('answers bodies over 1 MB with 413', async () => {
    const res = await request(app())
      .post('/api/v1/health/live')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1_100_000) }))
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'payload_too_large' })
  })
  it('answers unknown API paths with JSON 404 even when the web app is served', async () => {
    const server = app(fakeWebBuild())
    for (const url of ['/api/v1/lotz', '/api/other']) {
      const res = await request(server).get(url)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'not_found' })
    }
  })
})

describe('web app', () => {
  it('serves index.html for client-side routes', async () => {
    const res = await request(app(fakeWebBuild())).get('/shipments')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<title>Boat</title>')
  })
  it('serves static assets', async () => {
    const res = await request(app(fakeWebBuild())).get('/assets/app.js')
    expect(res.status).toBe(200)
    expect(res.text).toBe('console.log(1)')
  })
  it('serves only the API when there is no web build', async () => {
    const res = await request(app(path.join(tmpdir(), 'no-such-build'))).get('/')
    expect(res.status).toBe(404)
  })
})
```

Run: `pnpm --filter @boat/api test`
Expected: FAIL with `Failed to resolve import "./app"`.

- [ ] **Step 3: Implement the health router, the error handler and the app**

`apps/api/src/modules/health/health.router.ts`:

```ts
import { Router } from 'express'

// Throws when a dependency is not ready.
export type ReadinessCheck = () => Promise<void>

// Public routes: Render's health check calls /ready, uptime monitors call /live.
export function healthRouter(checkDatabase: ReadinessCheck) {
  const router = Router()
  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' })
  })
  router.get('/ready', async (req, res) => {
    try {
      await checkDatabase()
      res.json({ status: 'ok' })
    } catch (err) {
      req.log.warn({ err }, 'readiness check failed')
      res.status(503).json({ status: 'unavailable' })
    }
  })
  return router
}
```

`apps/api/src/core/errors.ts`:

```ts
import type { ErrorRequestHandler } from 'express'

// Body-parser errors carry a type; everything else is an unexpected failure.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_request', message: 'The request body is not valid JSON.' })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'payload_too_large' })
    return
  }
  req.log.error({ err }, 'unhandled error')
  res.status(500).json({ error: 'internal' })
}
```

`apps/api/src/app.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import { errorHandler } from './core/errors'
import { healthRouter, type ReadinessCheck } from './modules/health/health.router'

export type AppOptions = {
  logger: Logger
  // Built React app (apps/web/dist). Skipped when it has no index.html, e.g. in API tests.
  webDist?: string
  checkDatabase: ReadinessCheck
}

export function createApp({ logger, webDist, checkDatabase }: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) || randomUUID()
        res.setHeader('x-request-id', id)
        return id
      },
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  const api = express.Router()
  api.use('/health', healthRouter(checkDatabase))
  app.use('/api/v1', api)
  // Unknown API paths stay JSON so the browser client never receives index.html by mistake.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false }))
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
```

Run: `pnpm --filter @boat/api test`
Expected: PASS (11 tests).

- [ ] **Step 4: Typecheck and format**

Run: `pnpm typecheck && pnpm format:check`
Expected: exit 0. If `req.log` is reported as unknown on `Request`, add `import type {} from 'pino-http'` at the top of `health.router.ts` and `errors.ts`, which loads pino-http's type augmentation of `IncomingMessage`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add Express app skeleton with health checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Prisma schema, migrations, database grants and the server entry point

**Files:**
- Create: `docker-compose.yml`, `apps/api/.env.example`, `apps/api/prisma.config.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/init-local.sql`, `apps/api/prisma/grants.sql`, `apps/api/prisma/migrations/<timestamp>_init/migration.sql` (generated, then edited), `apps/api/prisma/migrations/<timestamp>_constraints/migration.sql`, `apps/api/src/config.ts`, `apps/api/src/config.test.ts`, `apps/api/src/core/prisma.ts`, `apps/api/src/server.ts`, `apps/api/tsup.config.ts`, `apps/api/vitest.int.config.ts`, `apps/api/test/database.int.test.ts`
- Modify: `apps/api/package.json` (scripts and dependencies)

**Interfaces:**
- Consumes: `createApp` and `ReadinessCheck` from Task 5.
- Produces:
  - Environment: `DATABASE_URL` is the app connection as `boat_app` (on Neon, the pooled URL). `DIRECT_URL` is the owner connection, used only by the Prisma CLI (on Neon, the direct URL). Optional: `PORT` (default 3000), `LOG_LEVEL` (default `info`), `NODE_ENV`.
  - `loadConfig(env: Record<string, string | undefined>): Config` throws `Invalid environment: <key>: <message>; …`
  - `createPrisma(connectionString: string): PrismaClient` and `databaseCheck(db: PrismaClient): ReadinessCheck` in `core/prisma.ts`
  - The Prisma client is generated to `apps/api/src/generated/prisma` and imported from `../generated/prisma/client`.
  - Scripts on `@boat/api`: `generate`, `dev`, `build`, `start`, `db:migrate` (migrate deploy, then grants), `test:int`.
  - Tables and columns exactly as the PRD's schema, with the changes listed in Step 3.

- [ ] **Step 1: Add dependencies and scripts**

```bash
pnpm --filter @boat/api add @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 zod@4.6.7 dotenv@18.0.7
pnpm --filter @boat/api add -D prisma@7.10.0 tsup@8.5.1 tsx@4.23.15 @testcontainers/postgresql@12.2.1 pg@8.23.1 @types/pg@8.23.1
```

Set the `scripts` block of `apps/api/package.json` to:

```json
  "scripts": {
    "postinstall": "prisma generate",
    "generate": "prisma generate",
    "dev": "tsx watch src/server.ts",
    "build": "prisma generate && tsup",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:int": "vitest run --config vitest.int.config.ts",
    "db:migrate": "prisma migrate deploy && prisma db execute --file prisma/grants.sql"
  }
```

- [ ] **Step 2: Local database and environment files**

`docker-compose.yml` (repository root):

```yaml
# Local Postgres for development. Tests start their own throwaway container.
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: boat
      POSTGRES_PASSWORD: boat
      POSTGRES_DB: boat
    ports:
      - '5432:5432'
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./apps/api/prisma/init-local.sql:/docker-entrypoint-initdb.d/init-local.sql:ro
volumes:
  db-data:
```

`apps/api/prisma/init-local.sql`:

```sql
-- Local Docker database only. On Neon, create the role once by hand with a strong password:
--   CREATE ROLE boat_app LOGIN PASSWORD '<generated>';
-- Use SQL, not the Neon console: console roles join neon_superuser and may inherit DELETE.
CREATE ROLE boat_app LOGIN PASSWORD 'boat_app';
```

`apps/api/.env.example`:

```bash
# Owner connection. Only the Prisma CLI uses it (migrations, grants). On Neon: the direct URL.
DIRECT_URL=postgresql://boat:boat@localhost:5432/boat
# App connection as boat_app, which cannot DELETE. On Neon: the pooled URL.
DATABASE_URL=postgresql://boat_app:boat_app@localhost:5432/boat
PORT=3000
LOG_LEVEL=info
```

`apps/api/prisma.config.ts`:

```ts
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations need the owner role on a direct, non-pooled connection. process.env (not env())
  // keeps `prisma generate` working in CI, where no database URL is set.
  datasource: { url: process.env.DIRECT_URL ?? '' },
})
```

```bash
cp apps/api/.env.example apps/api/.env
docker compose up -d db
```

If port 5432 is already in use, change the left side of the port mapping (for example `'5433:5432'`) and the two URLs in `apps/api/.env` to match.

- [ ] **Step 3: Write `schema.prisma`**

This is the PRD's schema with five changes:
- The Prisma 7 generator and datasource.
- Enums one value per line, as Prisma requires.
- `@db.Timestamptz(3)` on audit times, following the PRD's own timestamptz convention.
- `citext` on the case-insensitive columns.
- Partial unique indexes in place of the PRD's raw `lower(...)` indexes.

`apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider        = "prisma-client"
  output          = "../src/generated/prisma"
  previewFeatures = ["partialIndexes"]
}

// Connection URLs live in prisma.config.ts (CLI, owner role) and src/core/prisma.ts (app role).
datasource db {
  provider = "postgresql"
}

enum Role {
  admin
  planner
  poc
  viewer
}
enum UserStatus {
  invited
  active
  disabled
}
enum TokenPurpose {
  invite
  password_reset
}
enum RmMode {
  all
  components
}
enum EntityType {
  lot
  shipment
}
enum EtaKind {
  planned
  current
}
enum LookupKind {
  segment
  category
  ems
  poc
  status
  stage
  blocker
  logistics
  component
  shipmentStage
}

// Every business model carries deletedAt + deletedBy. Unique rules are partial indexes that ignore
// soft-deleted rows; citext columns make them case-insensitive. CHECK constraints are in the
// constraints migration, because Prisma cannot express them.

model User {
  id           String       @id @default(uuid()) @db.Uuid
  email        String @db.Citext                            // case-insensitive
  name         String       @db.VarChar(40)
  role         Role
  pocId        String?      @map("poc_id") @db.Uuid
  poc          LookupValue? @relation("UserPoc", fields: [pocId], references: [id])
  passwordHash String?      @map("password_hash")  // Argon2id; null until invite accepted
  status       UserStatus   @default(invited)
  lastLoginAt  DateTime?    @map("last_login_at") @db.Timestamptz(3)
  createdAt    DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt    DateTime?    @map("deleted_at") @db.Timestamptz(3)
  deletedBy    String?      @map("deleted_by") @db.Uuid
  sessions     Session[]
  tokens       AuthToken[]
  @@unique([email], map: "users_email_active_key", where: raw("deleted_at IS NULL"))
  @@map("users")
}

model Session {
  id         String    @id                      // SHA-256 of the cookie token
  userId     String    @map("user_id") @db.Uuid
  user       User      @relation(fields: [userId], references: [id])
  lastSeenAt DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz(3)
  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt  DateTime? @map("revoked_at") @db.Timestamptz(3)   // sign-out ends a session without deleting it
  userAgent  String?   @map("user_agent")
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([userId])
  @@map("sessions")
}

model AuthToken {
  id        String       @id @default(uuid()) @db.Uuid
  userId    String       @map("user_id") @db.Uuid
  user      User         @relation(fields: [userId], references: [id])
  purpose   TokenPurpose
  tokenHash String       @unique @map("token_hash")
  expiresAt DateTime     @map("expires_at") @db.Timestamptz(3)
  usedAt    DateTime?    @map("used_at") @db.Timestamptz(3)
  createdAt DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  @@map("auth_tokens")
}

model LookupValue {
  id        String     @id @default(uuid()) @db.Uuid
  kind      LookupKind
  value     String @db.Citext
  systemKey String?    @map("system_key")   // on_track, delayed, hold, none, approval_blocker, bau
  sort      Int        @default(0)
  createdAt DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime   @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt DateTime?  @map("deleted_at") @db.Timestamptz(3)
  deletedBy String?    @map("deleted_by") @db.Uuid
  products       Product[]      @relation("ProductSegment")
  lotCategories  Lot[]          @relation("LotCategory")
  lotEms         Lot[]          @relation("LotEms")
  lotPocs        Lot[]          @relation("LotPoc")
  lotStatuses    Lot[]          @relation("LotStatus")
  lotStages      Lot[]          @relation("LotStage")
  lotBlockers    Lot[]          @relation("LotBlocker")
  lotLogistics   Lot[]          @relation("LotLogistics")
  lotComponents  LotComponent[]
  rmBatches      RmBatch[]
  shipments      Shipment[]
  users          User[]         @relation("UserPoc")
  @@index([kind])
  @@unique([kind, value], map: "lookup_values_kind_value_active_key", where: raw("deleted_at IS NULL"))
  @@unique([kind, systemKey], map: "lookup_values_kind_system_key_active_key", where: raw("deleted_at IS NULL"))
  @@map("lookup_values")
}

model Product {
  id        String      @id @default(uuid()) @db.Uuid
  name      String @db.Citext
  variant   String      @default("") @db.Citext
  segmentId String      @map("segment_id") @db.Uuid
  segment   LookupValue @relation("ProductSegment", fields: [segmentId], references: [id])
  version   Int         @default(1)
  createdAt DateTime    @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime    @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt DateTime?   @map("deleted_at") @db.Timestamptz(3)
  deletedBy String?     @map("deleted_by") @db.Uuid
  lots          Lot[]
  shipmentItems ShipmentItem[]
  @@index([segmentId])
  @@unique([name, variant], map: "products_name_variant_active_key", where: raw("deleted_at IS NULL"))
  @@map("products")
}

model Lot {
  id                 String       @id @default(uuid()) @db.Uuid
  productId          String       @map("product_id") @db.Uuid
  product            Product      @relation(fields: [productId], references: [id])
  label              String @db.Citext
  categoryId         String       @map("category_id") @db.Uuid
  category           LookupValue  @relation("LotCategory", fields: [categoryId], references: [id])
  directFg           Boolean      @default(false) @map("direct_fg")
  emsId              String?      @map("ems_id") @db.Uuid
  ems                LookupValue? @relation("LotEms", fields: [emsId], references: [id])
  pocId              String?      @map("poc_id") @db.Uuid
  poc                LookupValue? @relation("LotPoc", fields: [pocId], references: [id])
  statusId           String       @map("status_id") @db.Uuid
  status             LookupValue  @relation("LotStatus", fields: [statusId], references: [id])
  stageId            String       @map("stage_id") @db.Uuid
  stage              LookupValue  @relation("LotStage", fields: [stageId], references: [id])
  rmMode             RmMode       @default(all) @map("rm_mode")
  readyQty           Int          @default(0) @map("ready_qty")              // FG-equivalent units
  lotQty             Int          @default(0) @map("lot_qty")
  freshProductionQty Int          @default(0) @map("fresh_production_qty")
  reworkQty          Int          @default(0) @map("rework_qty")
  reworkReason       String       @default("") @map("rework_reason")
  rmReadyDate        DateTime?    @map("rm_ready_date") @db.Date
  plannedDate        DateTime?    @map("planned_date") @db.Date
  revisedEta         DateTime?    @map("revised_eta") @db.Date
  actualDate         DateTime?    @map("actual_date") @db.Date
  logisticsId        String?      @map("logistics_id") @db.Uuid
  logistics          LookupValue? @relation("LotLogistics", fields: [logisticsId], references: [id])
  blockerId          String?      @map("blocker_id") @db.Uuid
  blocker            LookupValue? @relation("LotBlocker", fields: [blockerId], references: [id])
  blockerDescription String       @default("") @map("blocker_description")
  followUpDate       DateTime?    @map("follow_up_date") @db.Date
  followUpNote       String       @default("") @map("follow_up_note")
  grnTotal           Int          @default(0) @map("grn_total")      // active receipts only, kept by grn-receipts
  completedOn        DateTime?    @map("completed_on") @db.Date      // full GRN date, or null
  version            Int          @default(1)
  createdAt          DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt          DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt          DateTime?    @map("deleted_at") @db.Timestamptz(3)
  deletedBy          String?      @map("deleted_by") @db.Uuid
  components  LotComponent[]
  rmBatches   RmBatch[]
  grnReceipts GrnReceipt[]
  @@index([productId])
  @@index([statusId])
  @@index([pocId])
  @@index([plannedDate])
  @@index([completedOn])
  @@unique([productId, label], map: "lots_product_label_active_key", where: raw("deleted_at IS NULL"))
  @@map("lots")
}

model LotComponent {
  id          String      @id @default(uuid()) @db.Uuid
  lotId       String      @map("lot_id") @db.Uuid
  lot         Lot         @relation(fields: [lotId], references: [id])
  componentId String      @map("component_id") @db.Uuid
  component   LookupValue @relation(fields: [componentId], references: [id])
  createdAt   DateTime    @default(now()) @map("created_at") @db.Timestamptz(3)
  deletedAt   DateTime?   @map("deleted_at") @db.Timestamptz(3)
  deletedBy   String?     @map("deleted_by") @db.Uuid
  @@index([lotId])
  @@unique([lotId, componentId], map: "lot_components_lot_component_active_key", where: raw("deleted_at IS NULL"))
  @@map("lot_components")
}

model RmBatch {
  id           String      @id @default(uuid()) @db.Uuid
  lotId        String      @map("lot_id") @db.Uuid
  lot          Lot         @relation(fields: [lotId], references: [id])
  componentId  String      @map("component_id") @db.Uuid
  component    LookupValue @relation(fields: [componentId], references: [id])
  label        String
  plannedQty   Int         @default(0) @map("planned_qty")     // FG-equivalent units
  plannedDate  DateTime?   @map("planned_date") @db.Date
  receivedQty  Int         @default(0) @map("received_qty")
  receivedDate DateTime?   @map("received_date") @db.Date
  status       String      @default("")
  notes        String      @default("")
  createdAt    DateTime    @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime    @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt    DateTime?   @map("deleted_at") @db.Timestamptz(3)
  deletedBy    String?     @map("deleted_by") @db.Uuid
  @@index([lotId, componentId])
  @@map("rm_batches")
}

model GrnReceipt {
  id        String    @id @default(uuid()) @db.Uuid
  lotId     String    @map("lot_id") @db.Uuid
  lot       Lot       @relation(fields: [lotId], references: [id])
  label     String
  date      DateTime  @db.Date
  quantity  Int
  note      String    @default("")
  createdBy String?   @map("created_by") @db.Uuid
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(3)
  deletedBy String?   @map("deleted_by") @db.Uuid
  @@index([lotId, date])
  @@index([date])
  @@map("grn_receipts")
}

model Shipment {
  id            String       @id @default(uuid()) @db.Uuid
  number        String @db.Citext
  vessel        String
  etd           DateTime?    @db.Date
  plannedEta    DateTime?    @map("planned_eta") @db.Date
  revisedEta    DateTime?    @map("revised_eta") @db.Date
  actualArrival DateTime?    @map("actual_arrival") @db.Date
  stageId       String?      @map("stage_id") @db.Uuid
  stage         LookupValue? @relation(fields: [stageId], references: [id])
  remarks       String       @default("")
  version       Int          @default(1)
  createdAt     DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt     DateTime?    @map("deleted_at") @db.Timestamptz(3)
  deletedBy     String?      @map("deleted_by") @db.Uuid
  items        ShipmentItem[]
  etaRevisions EtaRevision[]
  @@index([actualArrival])
  @@unique([number], map: "shipments_number_active_key", where: raw("deleted_at IS NULL"))
  @@map("shipments")
}

model ShipmentItem {
  id         String    @id @default(uuid()) @db.Uuid
  shipmentId String    @map("shipment_id") @db.Uuid
  shipment   Shipment  @relation(fields: [shipmentId], references: [id])
  productId  String    @map("product_id") @db.Uuid
  product    Product   @relation(fields: [productId], references: [id])
  quantity   Int
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt  DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt  DateTime? @map("deleted_at") @db.Timestamptz(3)
  deletedBy  String?   @map("deleted_by") @db.Uuid
  @@index([shipmentId])
  @@index([productId])
  @@unique([shipmentId, productId], map: "shipment_items_shipment_product_active_key", where: raw("deleted_at IS NULL"))
  @@map("shipment_items")
}

model EtaRevision {                              // append-only: never updated or deleted
  id           String    @id @default(uuid()) @db.Uuid
  shipmentId   String    @map("shipment_id") @db.Uuid
  shipment     Shipment  @relation(fields: [shipmentId], references: [id])
  kind         EtaKind
  previousDate DateTime? @map("previous_date") @db.Date
  newDate      DateTime? @map("new_date") @db.Date
  reason       String    @default("")
  createdBy    String?   @map("created_by") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([shipmentId, createdAt])
  @@map("eta_revisions")
}

model ActivityLog {                              // append-only: never updated or deleted
  id         String     @id @default(uuid()) @db.Uuid
  entityType EntityType @map("entity_type")
  entityId   String     @map("entity_id") @db.Uuid
  kind       String     // created, updated, material, receipt, eta, lines, note, deleted, restored
  message    String
  changes    Json?      // { field: [before, after] }
  actorId    String?    @map("actor_id") @db.Uuid
  actorName  String?    @map("actor_name")   // snapshot of the name at the time
  createdAt  DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([entityType, entityId, createdAt])
  @@map("activity_logs")
}

model AppSetting {
  key       String   @id
  value     Json
  updatedBy String?  @map("updated_by") @db.Uuid
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  @@map("app_settings")
}

```

Run:

```bash
pnpm --filter @boat/api exec prisma format
pnpm --filter @boat/api exec prisma validate
pnpm --filter @boat/api generate
```

Expected: `format` realigns the columns, `validate` prints "The schema at prisma/schema.prisma is valid", and `generate` prints "Generated Prisma Client (7.10.0) to ./src/generated/prisma". If `validate` rejects the `where:` argument, compare it with the v7 indexes doc (https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes) and fix the syntax. Keep the indexes in the schema, and never fall back to raw SQL for them (see the roadmap, departure 2).

- [ ] **Step 4: Create the two migrations**

```bash
cd apps/api
pnpm exec prisma migrate dev --name init --create-only
```

Open the generated `prisma/migrations/<timestamp>_init/migration.sql` and add this as its first line:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

Apply the migration, then create an empty one for the CHECK constraints:

```bash
pnpm exec prisma migrate dev
pnpm exec prisma migrate dev --name constraints --create-only
```

Write `prisma/migrations/<timestamp>_constraints/migration.sql`:

```sql
-- Business rules Prisma cannot express. Prisma Migrate leaves CHECK constraints alone.
ALTER TABLE lots ADD CONSTRAINT lots_quantities_check
  CHECK (lot_qty >= 0 AND fresh_production_qty >= 0 AND rework_qty >= 0 AND ready_qty >= 0 AND grn_total >= 0);
ALTER TABLE lots ADD CONSTRAINT lots_rework_check CHECK (rework_qty <= fresh_production_qty);
ALTER TABLE lots ADD CONSTRAINT lots_grn_total_check CHECK (grn_total <= lot_qty);
ALTER TABLE grn_receipts ADD CONSTRAINT grn_receipts_quantity_check CHECK (quantity > 0);
ALTER TABLE rm_batches ADD CONSTRAINT rm_batches_quantities_check CHECK (planned_qty >= 0 AND received_qty >= 0);
ALTER TABLE shipments ADD CONSTRAINT shipments_dates_check CHECK (
  etd IS NULL OR (
    (planned_eta IS NULL OR planned_eta >= etd) AND
    (revised_eta IS NULL OR revised_eta >= etd) AND
    (actual_arrival IS NULL OR actual_arrival >= etd)
  )
);
ALTER TABLE shipment_items ADD CONSTRAINT shipment_items_quantity_check CHECK (quantity > 0);
```

```bash
pnpm exec prisma migrate dev
cd ../..
```

Expected: both migrations applied, and "Already in sync" on a second `prisma migrate dev`. If instead Prisma proposes a migration that drops and recreates the partial unique indexes, Postgres has stored the predicate in its normalized form. Change every `raw("deleted_at IS NULL")` in the schema to `raw("(deleted_at IS NULL)")`, delete the proposed migration folder, and run `prisma migrate dev` again until it reports "Already in sync".

- [ ] **Step 5: Write `grants.sql`**

`apps/api/prisma/grants.sql`:

```sql
-- Privileges for boat_app, the role the running app connects as. Re-run after every migration
-- (pnpm --filter @boat/api db:migrate does both). Fails if boat_app does not exist.
-- The app may read, insert and update; it may never delete, and history is insert-only.
GRANT USAGE ON SCHEMA public TO boat_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM boat_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO boat_app;
REVOKE ALL ON TABLE _prisma_migrations FROM boat_app;
REVOKE UPDATE ON TABLE activity_logs, eta_revisions FROM boat_app;

-- A role membership (for example pg_write_all_data via Neon's neon_superuser) would quietly
-- restore DELETE. Refuse to finish rather than deploy without the soft-delete guarantee.
DO $$
BEGIN
  IF has_table_privilege('boat_app', 'products', 'DELETE')
     OR has_table_privilege('boat_app', 'activity_logs', 'UPDATE') THEN
    RAISE EXCEPTION 'boat_app can still delete rows or rewrite history; check its role memberships';
  END IF;
END $$;
```

Run: `pnpm --filter @boat/api exec prisma db execute --file prisma/grants.sql`
Expected: "Script executed successfully."

- [ ] **Step 6: Write the failing config test**

`apps/api/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const DATABASE_URL = 'postgresql://boat_app:x@localhost:5432/boat'

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL,
    })
  })
  it('reads PORT as a number', () => {
    expect(loadConfig({ DATABASE_URL, PORT: '8080' }).PORT).toBe(8080)
  })
  it('names each missing or invalid variable', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ DATABASE_URL, PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ DATABASE_URL, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
  })
})
```

Run: `pnpm --filter @boat/api test`
Expected: FAIL with `Failed to resolve import "./config"`.

- [ ] **Step 7: Implement config, the Prisma client and the server**

`apps/api/src/config.ts`:

```ts
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Connection as boat_app. On Neon this is the pooled URL.
  DATABASE_URL: z.string().min(1),
})
export type Config = z.infer<typeof schema>

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success)
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  return parsed.data
}
```

`apps/api/src/core/prisma.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import type { ReadinessCheck } from '../modules/health/health.router'

export function createPrisma(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

export const databaseCheck =
  (db: PrismaClient): ReadinessCheck =>
  async () => {
    await db.$queryRaw`SELECT 1`
  }
```

`apps/api/src/server.ts`:

```ts
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pino } from 'pino'
import { createApp } from './app'
import { loadConfig } from './config'
import { createPrisma, databaseCheck } from './core/prisma'

const config = loadConfig(process.env)
const logger = pino({ level: config.LOG_LEVEL })
const prisma = createPrisma(config.DATABASE_URL)
// Same relative path from src/ (tsx) and dist/ (bundle): apps/web/dist.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')

const app = createApp({ logger, webDist, checkDatabase: databaseCheck(prisma) })
const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'listening'))

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0))
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
```

`apps/api/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The domain package ships TypeScript source, so it must be bundled, not imported at runtime.
  noExternal: ['@boat/domain'],
})
```

Run: `pnpm --filter @boat/api test && pnpm typecheck`
Expected: PASS and exit 0.

- [ ] **Step 8: Run the server in dev and as the bundle**

Run the bundle from `apps/api`, so that `dotenv` finds `apps/api/.env`:

```bash
pnpm --filter @boat/web build
pnpm --filter @boat/api build
cd apps/api
node dist/server.js &
SERVER=$!
sleep 2
curl -s localhost:3000/api/v1/health/ready
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/shipments
curl -s localhost:3000/api/v1/nope
kill $SERVER
cd ../..
```

Expected: `{"status":"ok"}`, then `200`, then `{"error":"not_found"}`. This proves that the bundle includes the generated Prisma client and the domain package, and that it connects as `boat_app`. If the bundle fails to start because it cannot find a Prisma runtime or WASM file, add `'@prisma/client'` to tsup's `external` list and re-check. Then run `pnpm --filter @boat/api dev` once and repeat the first curl to confirm the tsx dev server also works.

- [ ] **Step 9: Write the database integration tests**

`apps/api/vitest.int.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
```

`apps/api/test/database.int.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { pino } from 'pino'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { createPrisma, databaseCheck } from '../src/core/prisma'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const suffix = () => randomUUID().slice(0, 8)

let container: StartedPostgreSqlContainer
let ownerUrl: string
let appUrl: string
let owner: Client
let app: Client

// Runs the Prisma CLI against the container as the owner, like the Render pre-deploy step.
function prismaCli(args: string[]) {
  return execFileSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: apiRoot,
    env: { ...process.env, DIRECT_URL: ownerUrl },
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

async function lookup(kind: string, value = `${kind} ${suffix()}`) {
  const { rows } = await app.query<{ id: string }>(
    'INSERT INTO lookup_values (id, kind, value, updated_at) VALUES (gen_random_uuid(), $1, $2, now()) RETURNING id',
    [kind, value],
  )
  return rows[0].id
}

async function product(name: string, variant: string, segmentId: string) {
  const { rows } = await app.query<{ id: string }>(
    'INSERT INTO products (id, name, variant, segment_id, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, now()) RETURNING id',
    [name, variant, segmentId],
  )
  return rows[0].id
}

async function lot(fields: { lotQty: number; grnTotal?: number; fresh?: number; rework?: number }) {
  const productId = await product(`Product ${suffix()}`, '', await lookup('segment'))
  const { rows } = await app.query<{ id: string }>(
    `INSERT INTO lots (id, product_id, label, category_id, status_id, stage_id,
       lot_qty, grn_total, fresh_production_qty, rework_qty, updated_at)
     VALUES (gen_random_uuid(), $1, 'Lot 1', $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
    [
      productId,
      await lookup('category'),
      await lookup('status'),
      await lookup('stage'),
      fields.lotQty,
      fields.grnTotal ?? 0,
      fields.fresh ?? 0,
      fields.rework ?? 0,
    ],
  )
  return rows[0].id
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17').start()
  ownerUrl = container.getConnectionUri()
  owner = new Client({ connectionString: ownerUrl })
  await owner.connect()
  await owner.query("CREATE ROLE boat_app LOGIN PASSWORD 'boat_app'")
  prismaCli(['migrate', 'deploy'])
  prismaCli(['db', 'execute', '--file', 'prisma/grants.sql'])
  const url = new URL(ownerUrl)
  url.username = 'boat_app'
  url.password = 'boat_app'
  appUrl = url.toString()
  app = new Client({ connectionString: appUrl })
  await app.connect()
})

afterAll(async () => {
  await app?.end()
  await owner?.end()
  await container?.stop()
})

describe('migrations', () => {
  it('match schema.prisma exactly', () => {
    expect(() =>
      prismaCli([
        'migrate',
        'diff',
        '--exit-code',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
      ]),
    ).not.toThrow()
  })
})

describe('app role privileges', () => {
  it('can insert and update but never delete', async () => {
    const id = await lookup('segment')
    await expect(app.query('UPDATE lookup_values SET sort = 1 WHERE id = $1', [id])).resolves.toBeDefined()
    await expect(app.query('DELETE FROM lookup_values WHERE id = $1', [id])).rejects.toMatchObject({
      code: '42501',
    })
  })
  it('can add history but not rewrite it', async () => {
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO activity_logs (id, entity_type, entity_id, kind, message)
       VALUES (gen_random_uuid(), 'lot', gen_random_uuid(), 'note', 'hello') RETURNING id`,
    )
    await expect(
      app.query('UPDATE activity_logs SET message = $2 WHERE id = $1', [rows[0].id, 'edited']),
    ).rejects.toMatchObject({ code: '42501' })
  })
  it('cannot read migration bookkeeping', async () => {
    await expect(app.query('SELECT * FROM _prisma_migrations')).rejects.toMatchObject({
      code: '42501',
    })
  })
})

describe('constraints', () => {
  it('keeps product name and variant unique among active rows, ignoring case', async () => {
    const segment = await lookup('segment')
    const name = `Inverter ${suffix()}`
    const first = await product(name, '5 kW', segment)
    await expect(product(name.toUpperCase(), '5 KW', segment)).rejects.toMatchObject({
      code: '23505',
    })
    await app.query('UPDATE products SET deleted_at = now() WHERE id = $1', [first])
    await expect(product(name, '5 kW', segment)).resolves.toBeTruthy()
  })
  it('refuses a lot that has received more than its quantity', async () => {
    await expect(lot({ lotQty: 10, grnTotal: 11 })).rejects.toMatchObject({ code: '23514' })
  })
  it('refuses rework above fresh production', async () => {
    await expect(lot({ lotQty: 10, fresh: 3, rework: 5 })).rejects.toMatchObject({ code: '23514' })
  })
  it('refuses a receipt with zero quantity', async () => {
    const lotId = await lot({ lotQty: 10 })
    await expect(
      app.query(
        `INSERT INTO grn_receipts (id, lot_id, label, date, quantity, updated_at)
         VALUES (gen_random_uuid(), $1, 'GRN 1', '2026-10-01', 0, now())`,
        [lotId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
  it('refuses a shipment ETA before ETD', async () => {
    await expect(
      app.query(
        `INSERT INTO shipments (id, number, vessel, etd, planned_eta, updated_at)
         VALUES (gen_random_uuid(), $1, 'MSC Aurora', '2026-10-10', '2026-10-01', now())`,
        [`INV-${suffix()}`],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('readiness', () => {
  it('reports ready when connected as the app role', async () => {
    const db = createPrisma(appUrl)
    try {
      const server = createApp({ logger: pino({ level: 'silent' }), checkDatabase: databaseCheck(db) })
      const res = await request(server).get('/api/v1/health/ready')
      expect(res.status).toBe(200)
    } finally {
      await db.$disconnect()
    }
  })
})

describe('grants.sql', () => {
  it('refuses to finish when a membership gives the app role DELETE', async () => {
    await owner.query('GRANT pg_write_all_data TO boat_app')
    try {
      expect(() => prismaCli(['db', 'execute', '--file', 'prisma/grants.sql'])).toThrow()
    } finally {
      await owner.query('REVOKE pg_write_all_data FROM boat_app')
    }
  })
})
```

Run: `pnpm --filter @boat/api test:int`
Expected: PASS (11 tests). The first run pulls `postgres:17`, which takes longer. If the drift test fails, its output is Prisma's diff: the schema and the migrations disagree. If the diff shows only the partial unique indexes, apply the normalized-predicate fix from Step 4. Otherwise, fix whichever side departs from Step 3. Never delete the test.

- [ ] **Step 10: Format, typecheck and commit**

```bash
pnpm format:check && pnpm typecheck && pnpm test
git add -A
git commit -m "Add Prisma schema, migrations and database grants

The app connects as boat_app, which cannot delete rows or rewrite
history; grants.sql fails if a role membership would allow it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CI, Render blueprint and docs

**Files:**
- Create: `.github/workflows/ci.yml`, `render.yaml`
- Modify: `AGENTS.md`, `README.md`

**Interfaces:**
- Consumes: the root scripts (Task 1), `test:coverage` (Task 2), `test:int`, `build`, `start` and `db:migrate` (Task 6).
- Produces: CI on every pull request and on pushes to `main`. A Render blueprint that deploys `main` only after checks pass.

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter @boat/domain test:coverage
      # Testcontainers uses the runner's Docker daemon.
      - run: pnpm --filter @boat/api test:int
      - run: pnpm build
```

- [ ] **Step 2: Write the Render blueprint**

`render.yaml`:

```yaml
services:
  - type: web
    name: boat
    runtime: node
    region: singapore
    plan: starter
    branch: main
    # Deploy only after GitHub checks (the CI workflow) pass.
    autoDeployTrigger: checksPass
    # --prod=false: NODE_ENV=production would otherwise skip Vite, tsup and the Prisma CLI.
    buildCommand: corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build
    # Same as `db:migrate`, called through the local binary so it doesn't depend on pnpm being on PATH.
    preDeployCommand: cd apps/api && ./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma db execute --file prisma/grants.sql
    startCommand: node apps/api/dist/server.js
    healthCheckPath: /api/v1/health/ready
    envVars:
      - key: NODE_ENV
        value: production
      # Neon pooled URL, connecting as boat_app.
      - key: DATABASE_URL
        sync: false
      # Neon direct URL, connecting as the owner role; used only by the pre-deploy migration.
      - key: DIRECT_URL
        sync: false
```

Render reads the Node version from `.nvmrc`.

- [ ] **Step 3: Commit**

The clean-clone check in the next step only sees committed files.

```bash
git add -A
git commit -m "Add CI workflow and Render blueprint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Verify a production-mode install and build from a clean clone**

```bash
rm -rf /tmp/boat-prod-check
git clone --quiet . /tmp/boat-prod-check
cd /tmp/boat-prod-check
NODE_ENV=production pnpm install --frozen-lockfile --prod=false
NODE_ENV=production pnpm build
ls apps/api/dist/server.js apps/web/dist/index.html
cd - && rm -rf /tmp/boat-prod-check
```

Expected: both files are listed. This catches a missing lockfile entry, a script that depends on files that aren't committed, and the devDependency problem from Review Focus item 4.

- [ ] **Step 5: Update the docs**

In `README.md`, replace the setup commands and the paragraph after them with:

````markdown
```bash
nvm use            # Node 24, from .nvmrc
corepack enable    # pnpm 10.33.2, from package.json
pnpm install
pnpm dev
```

Open the URL shown by Vite. On first use, choose fictional demo data or an empty workspace. `pnpm typecheck` checks TypeScript in every package, `pnpm test` runs the unit tests, `pnpm format:check` checks formatting, and `pnpm build` builds the web app and the API.

The API is being built alongside the demo; the web app does not use it yet. To run it locally:

```bash
docker compose up -d db
cp apps/api/.env.example apps/api/.env
pnpm --filter @boat/api db:migrate
pnpm --filter @boat/api dev      # http://localhost:3000/api/v1/health/ready
pnpm --filter @boat/api test:int # needs Docker
```
````

In `AGENTS.md`, replace the three sections below with this text:

```markdown
## Project Structure & Module Organization

This is a pnpm monorepo. `apps/web` is the React application: `src/App.tsx` owns navigation and global data actions, and `src/Production.tsx`, `src/LotDrawer.tsx`, `src/MonthEnd.tsx`, `src/Shipments.tsx` and `src/Settings.tsx` contain the operational views and editors. Sign-in and profile screens are in `src/Profiles.tsx`, IndexedDB writes and import validation in `src/repository.ts`, the Dexie schema in `src/db.ts`, demo records in `src/demo.ts`, shared primitives in `src/ui.tsx`, and global styles in `src/index.css`.

`packages/domain` holds the rules shared by the browser and the server: domain types in `src/models.ts`, date and quantity rules in `src/calculations.ts`, field validation in `src/validation.ts`, and role permissions in `src/permissions.ts`. The web app's `models.ts`, `calculations.ts` and `validation.ts` re-export it, and `access.ts` keeps the browser-only PIN, session and React context helpers.

`apps/api` is the Express API. `src/app.ts` builds the app, `src/server.ts` starts it, `src/core/` holds shared middleware and the Prisma client, and `src/modules/<area>/` holds one folder per business area. `prisma/schema.prisma` and `prisma/migrations/` define the PostgreSQL schema, and `prisma/grants.sql` sets the app role's privileges after every migration.

## Build and Development Commands

Use Node 24 (`nvm use`) and pnpm (`corepack enable`). Run `pnpm install` once, then `pnpm dev` for the web app. `pnpm typecheck`, `pnpm test`, `pnpm format:check` and `pnpm build` run across all packages. For the API, `docker compose up -d db` starts Postgres, `pnpm --filter @boat/api db:migrate` applies migrations and grants, `pnpm --filter @boat/api dev` starts the server, and `pnpm --filter @boat/api test:int` runs the database tests (Docker required). Copy `apps/api/.env.example` to `apps/api/.env` first.

## Verification Guidelines

Business rules are unit-tested in `packages/domain` (`pnpm --filter @boat/domain test:coverage` must stay at or above 95% line coverage). API behaviour is tested with Supertest, and the database with Testcontainers. CI runs all of them. Until the web app switches to the API, also manually exercise product and lot creation, RM batches, partial and full GRN, completion reversal, month-end summary, shipments, ETA history, filters, JSON backup and restore, roles (setup, each role's limits, sign-in, recovery key, idle lock), and mobile layouts, and check that data survives refresh in the same browser profile.
```

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "Document the monorepo, API and database commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin phase-1-foundation
```

Open a pull request, and confirm that the CI workflow passes on it. The Render service itself is created in Phase 6. Until then, `render.yaml` is checked only by the clean-clone build in Step 3.

---

## Phase 1 gate

All of the following hold on the `phase-1-foundation` pull request:

- [ ] CI is green: format, typecheck, unit tests, domain coverage ≥ 95%, database integration tests, and the build.
- [ ] `pnpm dev` shows the existing demo data, and the manual checks in Tasks 1–4 pass.
- [ ] `node apps/api/dist/server.js` serves `/api/v1/health/ready` → 200 and the web app from one origin (Task 6, Step 8).
