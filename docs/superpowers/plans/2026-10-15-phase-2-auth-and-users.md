# Phase 2: Auth and Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People sign in to the API with email and password and get a server session. Admins invite, edit, disable and delete users, and change the time zone and idle timeout. Every route declares who may call it, and a test fails if one doesn't. The web app does not change.

**Architecture:** Three new modules join `health` under `apps/api/src/modules/`: `auth` (sessions, sign-in, invites, password reset), `users` and `settings`. A `loadSession` middleware turns the `boat_session` cookie into `req.auth`. Each route then starts with `publicRoute()`, `requireSignedIn()` or `requirePermission(action)` from `src/core/access.ts`; the last two also check the CSRF header on writes. Emails go through a small `Mailer` interface: Resend in production, the log in development, memory in tests. Integration tests share one Postgres container and give each test file its own copy of a migrated template database.

**Tech Stack:** Phase 1's stack (Node 24, Express 5.3, Prisma 7.10, zod 4, pino 10, Vitest 5, Testcontainers 12, Supertest 7), plus `@node-rs/argon2` 2.2.1, `express-rate-limit` 8.7.0, `cookie-parser` 1.4.7 and Resend's HTTP API (called with `fetch`, no SDK).

**Spec:** [Supply Chain App — Backend PRD & Architecture](https://claude.ai/code/artifact/313da010-aa6a-4a87-be4b-2c401635a8cd) (rev 56). The sections this plan implements are "Users, roles and permissions", FR-8 (settings part), FR-10, "Backend modules and folder structure" (shared core), "REST API design" (conventions, error shape, and the `/auth`, `/users` and `/settings` endpoints), "Authentication and security" and "Testing strategy". Read the roadmap first, including "Where Phase 2 departs from the PRD": [2026-10-14-fullstack-roadmap.md](2026-10-14-fullstack-roadmap.md).

## Global Constraints

- Everything in Phase 1's Global Constraints still holds: Node `24`, pnpm `10.33.2`, TypeScript `^7.0.2` strict, Prettier (single quotes, no semicolons, trailing commas, width 100), and the exact versions pinned there.
- New exact versions: `@node-rs/argon2` `2.2.1`, `express-rate-limit` `8.7.0`, `cookie-parser` `1.4.7`, `@types/cookie-parser` `1.4.10`. The newest releases (`2.2.2`, `8.7.1`) are under two weeks old on 15 Oct 2026, so don't take them.
- Session cookie `boat_session`: `httpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production. It carries 256 random bits, and the database stores only the SHA-256 of the token.
- Sessions end after the idle timeout (default 15 minutes, setting `idleTimeoutMinutes`) or 12 hours after sign-in, whichever comes first. Changing a user's password, role or status revokes all of that user's sessions.
- Passwords: Argon2id, 12 to 128 characters.
- Invite links are valid for 72 hours and reset links for 1 hour. Both are single use, and issuing a new one cancels the older ones.
- Failed sign-ins: 5 per 15 minutes per account and 5 per 15 minutes per IP address. Successful sign-ins don't count.
- The last active admin cannot be demoted, disabled or deleted.
- Error bodies follow the PRD table: `401 unauthenticated`, `403 forbidden` (with `message`), `404 not_found`, `409 conflict` (with `message`), `422 validation` (with `fields`). This phase adds `429 rate_limited` (with `message`).
- Soft delete only. A deleted user keeps the row, with `deleted_at` and `deleted_by` set.
- Default company time zone `Asia/Kolkata`.
- No change to `apps/web`. The demo keeps its PIN profiles until Phase 5.
- Branch `phase-2-auth` from `dev`; the pull request goes into `dev`.
- Commits: short imperative subject (AGENTS.md), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Rate limits behind Render's proxy.** Without `trust proxy`, every request appears to come from the proxy's IP. Five typos anywhere would then lock out the whole company for 15 minutes. If the setting is too permissive instead, anyone can dodge the limit with a forged `X-Forwarded-For`. `TRUST_PROXY` is set to `1` on Render. Task 5 tests that the per-IP limit keys on the forwarded address when `trustProxy` is 1. Phase 6 then confirms on staging that logged IPs are real client addresses.
2. **Session and CSRF tokens in logs.** pino-http logs request headers, so every request line would carry a working session cookie. The logger must redact `cookie`, `x-csrf-token` and `set-cookie`. Pinned in Task 2.
3. **Ids that aren't UUIDs.** `PATCH /api/v1/users/abc` would reach Postgres, which rejects the value as an invalid `uuid`, and the API would answer 500. It must answer 404. Pinned in Task 6.
4. **Two admins demoting each other at once.** Each request alone passes the "another admin exists" check, so together they could leave no admin. The check locks the admin rows. Pinned by a concurrent test in Task 6.
5. **A route that ships without an access check, or with the check after the handler.** The route-walk test requires every route's first handler to be an access check. It also compares every route against a written permission table, so a walk that silently finds nothing fails. Pinned in Task 3, and each later task adds its rows to the table.

Also covered: email case on sign-in (Task 5), two people using one invite link at the same moment (Task 7), and the same reply to forgot-password whether or not the email exists (Task 7).

---

## File Structure

```
apps/api/
├─ package.json                      # + argon2, rate limit, cookie-parser; create-admin script
├─ tsup.config.ts                    # + src/cli/create-admin.ts entry
├─ vitest.int.config.ts              # + globalSetup
├─ .env.example                      # + SESSION_SECRET, APP_URL, RESEND_API_KEY, MAIL_FROM, TRUST_PROXY
├─ src/
│  ├─ app.ts                         # createApp({ logger, webDist?, trustProxy?, hsts?, api })
│  ├─ api.ts                         # ApiDeps, buildApiRouter(deps), mount() + mountPathOf()
│  ├─ api.test.ts                    # route walk + permission table
│  ├─ test-deps.ts                   # testDeps(): ApiDeps for unit tests (no database)
│  ├─ config.ts                      # + auth and mail variables, production rules
│  ├─ server.ts                      # wires config, logger, Prisma, mailer
│  ├─ cli/create-admin.ts            # first admin invite
│  ├─ core/
│  │  ├─ access.ts                   # req.auth type, publicRoute/requireSignedIn/requirePermission, authOf
│  │  ├─ errors.ts                   # + UnauthenticatedError, NotFoundError, ConflictError mapping
│  │  ├─ logger.ts                   # createLogger with redaction
│  │  ├─ mailer.ts                   # Mailer, resendMailer, logMailer, memoryMailer, sendOrLog
│  │  ├─ pagination.ts               # pageQuery, pageArgs, pageOf
│  │  ├─ parse.ts                    # parseInput(schema, value), parseId(value)
│  │  └─ prisma.ts                   # + Db type
│  └─ modules/
│     ├─ auth/
│     │  ├─ auth.router.ts           # /auth/*
│     │  ├─ auth.service.ts          # sign-in, /me payload, invite accept, reset, change password
│     │  ├─ auth-tokens.ts           # issueToken, consumeToken (invite and reset links)
│     │  ├─ emails.ts                # invite and reset email text
│     │  ├─ password.ts              # hashPassword, verifyPassword
│     │  ├─ rate-limit.ts            # failedAttemptLimiters, requestLimiters, ipFailureLimiter
│     │  ├─ sessions.ts              # create, revoke, cookie, loadSession, authContext
│     │  └─ tokens.ts                # newToken, hashToken, csrfTokenFor
│     ├─ users/
│     │  ├─ users.router.ts          # /users/*
│     │  └─ users.service.ts         # list, create (invite), resend, update, delete, first admin
│     └─ settings/
│        ├─ settings.router.ts       # /settings
│        └─ settings.service.ts      # cached get, update
└─ test/
   ├─ support/
   │  ├─ global-setup.ts             # one container, migrated template database
   │  ├─ urls.ts                     # templateDb, withDatabase()
   │  ├─ db.ts                       # createTestDatabase(): a copy of the template per file
   │  └─ fixtures.ts                 # makeUser, makePoc, testApp, signIn
   ├─ sessions.int.test.ts
   ├─ auth.int.test.ts
   ├─ users.int.test.ts
   ├─ invites-and-passwords.int.test.ts
   ├─ settings.int.test.ts
   └─ create-admin.int.test.ts
packages/domain/src/
├─ permissions.ts                    # + actions, allowedActions(role)
└─ validation.ts                     # + normalizeEmail, validatePassword, validateAccount
```

Each module has a router (HTTP, request shape) and a service (rules, transactions, Prisma calls). Phase 2 doesn't add separate repository files; the roadmap explains why.

---

### Task 1: Domain rules for accounts, passwords and allowed actions

The browser will use these in Phase 5 too, so they belong in `@boat/domain`. They're pure functions with unit tests.

**Files:**
- Modify: `packages/domain/src/permissions.ts`
- Modify: `packages/domain/src/validation.ts`
- Test: `packages/domain/src/permissions.test.ts`, `packages/domain/src/validation.test.ts`

**Interfaces:**
- Consumes: `roleCan`, `actionVerbs`, `roles`, `Action` from `permissions.ts`; `collect`, `FieldErrors` from `validation.ts`; `Role` from `models.ts`.
- Produces:
  - `actions: Action[]` (every action, in `actionVerbs` order)
  - `allowedActions(role: Role): Action[]`
  - `normalizeEmail(email: string): string` (trimmed, lowercase)
  - `validatePassword(password: string, field = 'password'): FieldErrors`
  - `type Account = { email: string; name: string; role: string; pocId: string | null }`
  - `validateAccount(a: Account): FieldErrors`. Field keys: `email`, `name`, `role`, `pocId`.

- [ ] **Step 1: Create the branch**

```bash
git switch dev && git pull --ff-only
git switch -c phase-2-auth
```

- [ ] **Step 2: Write the failing tests**

In `packages/domain/src/permissions.test.ts`, add `allowedActions` to the import from `./permissions`. Then append:

```ts
describe('allowedActions', () => {
  // Written out by hand rather than derived from roleCan, so a changed grant shows up here.
  it('lists exactly what each role may do', () => {
    expect(allowedActions('admin')).toEqual([
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
    ])
    expect(allowedActions('planner')).toEqual([
      'exportBackup',
      'editProducts',
      'createLots',
      'editShipments',
      'deleteEntries',
    ])
    expect(allowedActions('poc')).toEqual([])
    expect(allowedActions('viewer')).toEqual([])
  })
})
```

In `packages/domain/src/validation.test.ts`, add `normalizeEmail`, `validateAccount` and `validatePassword` to the import from `./validation`. Then append:

```ts
describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Asha.Rao@Example.COM ')).toBe('asha.rao@example.com')
  })
})

describe('validatePassword', () => {
  it('needs at least 12 characters', () => {
    expect(validatePassword('a'.repeat(11))).toEqual({ password: 'Use at least 12 characters.' })
    expect(validatePassword('a'.repeat(12))).toEqual({})
  })
  it('caps the length at 128 characters', () => {
    expect(validatePassword('a'.repeat(128))).toEqual({})
    expect(validatePassword('a'.repeat(129))).toEqual({
      password: 'Keep the password to 128 characters or fewer.',
    })
  })
  it('reports under the field it is given', () => {
    expect(validatePassword('short', 'newPassword')).toEqual({
      newPassword: 'Use at least 12 characters.',
    })
  })
})

describe('validateAccount', () => {
  const ok = { email: 'asha@example.com', name: 'Asha', role: 'planner', pocId: null }
  it('accepts a complete account', () => {
    expect(validateAccount(ok)).toEqual({})
  })
  it('needs a valid email address', () => {
    expect(validateAccount({ ...ok, email: ' ' })).toEqual({ email: 'Enter an email address.' })
    expect(validateAccount({ ...ok, email: 'asha@example' })).toEqual({
      email: 'Enter a valid email address.',
    })
    expect(validateAccount({ ...ok, email: `${'a'.repeat(250)}@x.io` })).toEqual({
      email: 'Enter a valid email address.',
    })
  })
  it('needs a name of 40 characters or fewer', () => {
    expect(validateAccount({ ...ok, name: '  ' })).toEqual({ name: 'Enter a name.' })
    expect(validateAccount({ ...ok, name: 'a'.repeat(41) })).toEqual({
      name: 'Keep the name to 40 characters or fewer.',
    })
  })
  it('needs a known role', () => {
    expect(validateAccount({ ...ok, role: 'owner' })).toEqual({ role: 'Choose a role.' })
  })
  it('needs a point of contact for POC users only', () => {
    expect(validateAccount({ ...ok, role: 'poc' })).toEqual({
      pocId: 'Choose the point of contact this user owns.',
    })
    expect(validateAccount({ ...ok, role: 'poc', pocId: 'p1' })).toEqual({})
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm --filter @boat/domain test`
Expected: FAIL. `allowedActions`, `normalizeEmail`, `validatePassword` and `validateAccount` are not exported.

- [ ] **Step 4: Implement**

In `packages/domain/src/permissions.ts`, replace the `grants` declaration's first line and add `actions` above it:

```ts
export const actions = Object.keys(actionVerbs) as Action[]
const grants: Record<Role, Action[]> = {
  admin: actions,
```

(The `planner`, `poc` and `viewer` lines stay as they are.) Below `roleCan`, add:

```ts
// What a role may do, in actionVerbs order. /auth/me returns it so the browser can hide controls.
export const allowedActions = (role: Role) => actions.filter((a) => roleCan(role, a))
```

In `packages/domain/src/validation.ts`, change the models import to also bring in `Role`, and import `roles`:

```ts
import type { GRNReceipt, Lot, Product, RMBatch, Role, Shipment, ShipmentItem } from './models'
import { roles } from './permissions'
```

Append to the end of the file:

```ts
// Emails are stored and compared in lowercase, so sign-in ignores how the address was typed.
export const normalizeEmail = (email: string) => email.trim().toLowerCase()

// At least 12 characters (PRD). The upper limit keeps hashing time bounded.
export const validatePassword = (password: string, field = 'password') =>
  collect([
    [field, password.length < 12 && 'Use at least 12 characters.'],
    [field, password.length > 128 && 'Keep the password to 128 characters or fewer.'],
  ])

export type Account = { email: string; name: string; role: string; pocId: string | null }
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const validateAccount = (a: Account) =>
  collect([
    ['email', blank(a.email) && 'Enter an email address.'],
    [
      'email',
      (!emailPattern.test(a.email.trim()) || a.email.trim().length > 254) &&
        'Enter a valid email address.',
    ],
    ['name', blank(a.name) && 'Enter a name.'],
    ['name', a.name.trim().length > 40 && 'Keep the name to 40 characters or fewer.'],
    ['role', !roles.includes(a.role as Role) && 'Choose a role.'],
    ['pocId', a.role === 'poc' && !a.pocId && 'Choose the point of contact this user owns.'],
  ])
```

- [ ] **Step 5: Run the tests and the coverage gate**

Run: `pnpm --filter @boat/domain test && pnpm --filter @boat/domain test:coverage`
Expected: PASS, with line coverage at 95% or more.

- [ ] **Step 6: Typecheck the web app, which re-exports the domain**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain
git commit -m "Add account, password and allowed-action rules to the domain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Configuration, log redaction, error mapping and input parsing

These are the shared pieces every module needs: the new environment variables, a logger that never writes tokens, HTTP errors for 401, 404 and 409, and a single way to turn a bad request body into a 422 field map.

**Files:**
- Modify: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`
- Create: `apps/api/src/core/logger.ts`, `apps/api/src/core/logger.test.ts`
- Modify: `apps/api/src/core/errors.ts`
- Create: `apps/api/src/core/errors.test.ts`
- Create: `apps/api/src/core/parse.ts`, `apps/api/src/core/parse.test.ts`
- Create: `apps/api/src/core/pagination.ts`, `apps/api/src/core/pagination.test.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/.env.example`, `render.yaml`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `ValidationError` from `@boat/domain/validation`; `PermissionError` from `@boat/domain/permissions`.
- Produces:
  - `Config` with these new fields: `SESSION_SECRET: string`, `APP_URL: string`, `RESEND_API_KEY?: string`, `MAIL_FROM?: string`, `TRUST_PROXY: number`
  - `createLogger(level: string, destination?: DestinationStream): Logger`
  - `class UnauthenticatedError extends Error`, `class NotFoundError extends Error`, `class ConflictError extends Error { current?: unknown }`
  - `errorHandler`, now also mapping `ValidationError` → 422, `PermissionError` → 403 and the three classes above
  - `parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T>`, which throws `ValidationError`
  - `parseId(value: unknown): string`, which throws `NotFoundError`
  - `pageQuery` (zod schema), `type Page = { page: number; pageSize: number }`, `pageArgs(page: Page): { skip: number; take: number }`, `pageOf<T>(items: T[], total: number, page: Page): { items: T[]; total: number; page: number; pageSize: number }`

- [ ] **Step 1: Write the failing config tests**

Replace `apps/api/src/config.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const DATABASE_URL = 'postgresql://boat_app:x@localhost:5432/boat'
const SESSION_SECRET = 's'.repeat(32)
const base = { DATABASE_URL, SESSION_SECRET }
const production = {
  ...base,
  NODE_ENV: 'production',
  APP_URL: 'https://boat.onrender.com',
  RESEND_API_KEY: 're_123',
  MAIL_FROM: 'BOAT <noreply@example.com>',
}

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL,
      SESSION_SECRET,
      APP_URL: 'http://localhost:5173',
      TRUST_PROXY: 0,
    })
  })
  it('reads PORT and TRUST_PROXY as numbers', () => {
    expect(loadConfig({ ...base, PORT: '8080', TRUST_PROXY: '1' })).toMatchObject({
      PORT: 8080,
      TRUST_PROXY: 1,
    })
  })
  it('names each missing or invalid variable', () => {
    expect(() => loadConfig({ SESSION_SECRET })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...base, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
    expect(() => loadConfig({ ...base, APP_URL: 'not a url' })).toThrow(/APP_URL/)
  })
  it('needs a session secret of at least 32 characters', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/SESSION_SECRET/)
    expect(() => loadConfig({ DATABASE_URL, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
  })
  it('needs a sender address whenever a Resend key is set', () => {
    expect(() => loadConfig({ ...base, RESEND_API_KEY: 're_123' })).toThrow(/MAIL_FROM/)
  })
  it('accepts a complete production config', () => {
    expect(loadConfig(production).NODE_ENV).toBe('production')
  })
  it('requires email sending and an https APP_URL in production', () => {
    expect(() => loadConfig({ ...production, RESEND_API_KEY: undefined })).toThrow(
      /RESEND_API_KEY/,
    )
    expect(() => loadConfig({ ...production, APP_URL: 'http://boat.onrender.com' })).toThrow(
      /APP_URL/,
    )
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test -- src/config.test.ts`
Expected: FAIL. The new keys are missing from the parsed config.

- [ ] **Step 3: Implement the config**

Replace `apps/api/src/config.ts` with:

```ts
import { z } from 'zod'

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // Connection as boat_app. On Neon this is the pooled URL.
    DATABASE_URL: z.string().min(1),
    // Signs CSRF tokens. Generate with: openssl rand -base64 48
    SESSION_SECRET: z.string().min(32),
    // The web app's address. Invite and password-reset links point here.
    APP_URL: z.url().default('http://localhost:5173'),
    // Unset in development: emails go to the log instead.
    RESEND_API_KEY: z.string().min(1).optional(),
    // A sender on the domain verified in Resend, e.g. "BOAT <noreply@example.com>".
    MAIL_FROM: z.string().min(1).optional(),
    // Proxy hops in front of the app (Render: 1). Rate limits key on the client IP behind them.
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    if (c.RESEND_API_KEY && !c.MAIL_FROM) issue('MAIL_FROM', 'required when RESEND_API_KEY is set')
    if (c.NODE_ENV !== 'production') return
    if (!c.RESEND_API_KEY) issue('RESEND_API_KEY', 'required in production')
    if (!c.APP_URL.startsWith('https://')) issue('APP_URL', 'must use https in production')
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

- [ ] **Step 4: Run the config tests**

Run: `pnpm --filter @boat/api test -- src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing logger, error, parse and pagination tests**

Create `apps/api/src/core/logger.test.ts`:

```ts
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLogger } from './logger'

function capture() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString())
      done()
    },
  })
  return { lines, stream }
}

describe('createLogger', () => {
  // The same shape pino-http logs for every request.
  it('redacts session cookies and CSRF tokens', () => {
    const { lines, stream } = capture()
    createLogger('info', stream).info(
      {
        req: {
          headers: {
            cookie: 'boat_session=secret-token',
            'x-csrf-token': 'csrf-secret',
            'user-agent': 'test-agent',
          },
        },
        res: { headers: { 'set-cookie': 'boat_session=new-secret' } },
      },
      'request completed',
    )
    const out = lines.join('')
    expect(out).not.toMatch(/secret/)
    expect(out).toContain('test-agent')
  })
})
```

Create `apps/api/src/core/errors.test.ts`:

```ts
import { PermissionError } from '@boat/domain/permissions'
import { ValidationError } from '@boat/domain/validation'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { ConflictError, errorHandler, NotFoundError, UnauthenticatedError } from './errors'

function throwing(err: Error) {
  const app = express()
  app.get('/', () => {
    throw err
  })
  app.use(errorHandler)
  return app
}

describe('errorHandler', () => {
  it.each([
    {
      name: 'validation',
      err: new ValidationError({ quantity: 'Must be more than zero.' }),
      status: 422,
      body: { error: 'validation', fields: { quantity: 'Must be more than zero.' } },
    },
    {
      name: 'permission',
      err: new PermissionError("Viewer profiles can't delete lots. Ask an admin."),
      status: 403,
      body: { error: 'forbidden', message: "Viewer profiles can't delete lots. Ask an admin." },
    },
    {
      name: 'no session',
      err: new UnauthenticatedError(),
      status: 401,
      body: { error: 'unauthenticated' },
    },
    {
      name: 'failed sign-in',
      err: new UnauthenticatedError('Email or password is incorrect.'),
      status: 401,
      body: { error: 'unauthenticated', message: 'Email or password is incorrect.' },
    },
    { name: 'not found', err: new NotFoundError(), status: 404, body: { error: 'not_found' } },
    {
      name: 'conflict with the current record',
      err: new ConflictError('Someone else changed this.', { id: 'x' }),
      status: 409,
      body: { error: 'conflict', message: 'Someone else changed this.', current: { id: 'x' } },
    },
    {
      name: 'conflict without a record',
      err: new ConflictError('Still in use.'),
      status: 409,
      body: { error: 'conflict', message: 'Still in use.' },
    },
  ])('answers $name with $status', async ({ err, status, body }) => {
    const res = await request(throwing(err)).get('/')
    expect(res.status).toBe(status)
    expect(res.body).toEqual(body)
  })
})
```

Create `apps/api/src/core/parse.test.ts`:

```ts
import { ValidationError } from '@boat/domain/validation'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { NotFoundError } from './errors'
import { parseId, parseInput } from './parse'

function fieldsOf(fn: () => unknown) {
  try {
    fn()
  } catch (e) {
    if (e instanceof ValidationError) return e.fields
    throw e
  }
  throw new Error('expected a ValidationError')
}

const schema = z.object({
  name: z.string({ error: 'Enter a name.' }),
  qty: z.number({ error: 'Enter a quantity.' }),
})

describe('parseInput', () => {
  it('returns the parsed value', () => {
    expect(parseInput(schema, { name: 'a', qty: 1 })).toEqual({ name: 'a', qty: 1 })
  })
  it('turns problems into a field map', () => {
    expect(fieldsOf(() => parseInput(schema, { qty: 'x' }))).toEqual({
      name: 'Enter a name.',
      qty: 'Enter a quantity.',
    })
  })
  it('treats a missing body as an empty object', () => {
    expect(fieldsOf(() => parseInput(schema, undefined))).toEqual({
      name: 'Enter a name.',
      qty: 'Enter a quantity.',
    })
  })
  it('files problems with the whole body under "form"', () => {
    expect(Object.keys(fieldsOf(() => parseInput(z.strictObject({}), { extra: 1 })))).toEqual([
      'form',
    ])
  })
})

describe('parseId', () => {
  it('accepts any UUID Postgres accepts', () => {
    expect(parseId('6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90')).toBe(
      '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90',
    )
    expect(parseId('00000000-0000-0000-0000-000000000000')).toBe(
      '00000000-0000-0000-0000-000000000000',
    )
  })
  it('answers anything else as not found', () => {
    for (const bad of ['abc', '', 42, undefined]) expect(() => parseId(bad)).toThrow(NotFoundError)
  })
})
```

Create `apps/api/src/core/pagination.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pageArgs, pageOf, pageQuery } from './pagination'
import { parseInput } from './parse'

describe('pageQuery', () => {
  it('defaults to the first page of 50', () => {
    expect(parseInput(pageQuery, {})).toEqual({ page: 1, pageSize: 50 })
  })
  it('reads query-string numbers', () => {
    expect(parseInput(pageQuery, { page: '3', pageSize: '20' })).toEqual({ page: 3, pageSize: 20 })
  })
  it('refuses pages below 1 and sizes above 200', () => {
    expect(() => parseInput(pageQuery, { page: '0' })).toThrow()
    expect(() => parseInput(pageQuery, { pageSize: '500' })).toThrow()
  })
})

describe('pageArgs and pageOf', () => {
  it('turn a page into skip/take and wrap the result', () => {
    expect(pageArgs({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 })
    expect(pageOf(['a'], 41, { page: 3, pageSize: 20 })).toEqual({
      items: ['a'],
      total: 41,
      page: 3,
      pageSize: 20,
    })
  })
})
```

- [ ] **Step 6: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test`
Expected: FAIL. `./logger`, `./parse` and `./pagination` don't exist, and `errors.ts` doesn't export the new classes.

- [ ] **Step 7: Implement the logger**

Create `apps/api/src/core/logger.ts`:

```ts
import { type DestinationStream, pino } from 'pino'

// Anyone reading the logs could act as the user with a session cookie or CSRF token.
const redact = {
  paths: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
  censor: '[redacted]',
}

export function createLogger(level: string, destination?: DestinationStream) {
  return destination ? pino({ level, redact }, destination) : pino({ level, redact })
}
```

In `apps/api/src/server.ts`, replace `import { pino } from 'pino'` with `import { createLogger } from './core/logger'`, and replace `const logger = pino({ level: config.LOG_LEVEL })` with:

```ts
const logger = createLogger(config.LOG_LEVEL)
```

- [ ] **Step 8: Implement the error classes and mapping**

Replace `apps/api/src/core/errors.ts` with:

```ts
import { PermissionError } from '@boat/domain/permissions'
import { ValidationError } from '@boat/domain/validation'
import type { ErrorRequestHandler } from 'express'

// 401: no session, an expired one, or a failed sign-in (which carries a message).
export class UnauthenticatedError extends Error {}
// 404: missing, soft-deleted, or an id that cannot exist.
export class NotFoundError extends Error {}
// 409: refused because of other records (last admin, version conflict, value in use).
export class ConflictError extends Error {
  current?: unknown
  constructor(message: string, current?: unknown) {
    super(message)
    this.current = current
  }
}

const clientErrors: Record<number, string> = {
  400: 'bad_request',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
}

// Our own errors map to the PRD's error shapes. Errors from Express and body-parser carry a 4xx
// status: the client's fault, answered as such. Everything else is an unexpected failure.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  if (err instanceof ValidationError) {
    res.status(422).json({ error: 'validation', fields: err.fields })
    return
  }
  if (err instanceof PermissionError) {
    res.status(403).json({ error: 'forbidden', message: err.message })
    return
  }
  if (err instanceof UnauthenticatedError) {
    res
      .status(401)
      .json(err.message ? { error: 'unauthenticated', message: err.message } : { error: 'unauthenticated' })
    return
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  if (err instanceof ConflictError) {
    res.status(409).json({
      error: 'conflict',
      message: err.message,
      ...(err.current === undefined ? {} : { current: err.current }),
    })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_request', message: 'The request body is not valid JSON.' })
    return
  }
  const status = err?.status ?? err?.statusCode
  if (typeof status === 'number' && status >= 400 && status < 500) {
    req.log.warn({ err }, 'client error')
    res.status(status).json({ error: clientErrors[status] ?? 'bad_request' })
    return
  }
  req.log.error({ err }, 'unhandled error')
  res.status(500).json({ error: 'internal' })
}
```

- [ ] **Step 9: Implement parsing and pagination**

Create `apps/api/src/core/parse.ts`:

```ts
import { type FieldErrors, ValidationError } from '@boat/domain/validation'
import { z } from 'zod'
import { NotFoundError } from './errors'

// Checks a request's shape. Zod messages become the field map the forms already show; business
// rules run afterwards in the service, through the domain validators.
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value ?? {})
  if (result.success) return result.data
  const fields: FieldErrors = {}
  for (const issue of result.error.issues) fields[issue.path.join('.') || 'form'] ??= issue.message
  throw new ValidationError(fields)
}

// Route ids are UUIDs. Anything else cannot exist, and Postgres would reject it with a 500.
// z.guid() accepts every 8-4-4-4-12 hex id, as Postgres does; z.uuid() would also check the
// version bits and refuse some ids in old browser backups.
export function parseId(value: unknown): string {
  const result = z.guid().safeParse(value)
  if (!result.success) throw new NotFoundError()
  return result.data
}
```

Create `apps/api/src/core/pagination.ts`:

```ts
import { z } from 'zod'

// PRD: lists take ?page=&pageSize= (default 50, max 200) and return { items, total, page, pageSize }.
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
export type Page = z.infer<typeof pageQuery>

export const pageArgs = ({ page, pageSize }: Page) => ({ skip: (page - 1) * pageSize, take: pageSize })
export const pageOf = <T>(items: T[], total: number, { page, pageSize }: Page) => ({
  items,
  total,
  page,
  pageSize,
})
```

- [ ] **Step 10: Run the unit tests**

Run: `pnpm --filter @boat/api test`
Expected: PASS.

- [ ] **Step 11: Update the environment files, the Render blueprint and CI**

Append to `apps/api/.env.example`:

```bash
# Signs CSRF tokens. Any random string of 32 or more characters: openssl rand -base64 48
SESSION_SECRET=dev-only-secret-change-me-0123456789abcdef
# The web app's address. Invite and password-reset links point here.
APP_URL=http://localhost:5173
# Leave unset in development: emails are written to the log instead of sent.
# RESEND_API_KEY=
# MAIL_FROM="BOAT <noreply@your-domain>"
# Proxy hops in front of the app. 0 locally; Render sets 1.
TRUST_PROXY=0
```

Add the same `SESSION_SECRET` and `APP_URL` lines to your own `apps/api/.env`. It isn't committed, and the server won't start without the secret.

In `render.yaml`, append to `envVars`:

```yaml
      # Signs CSRF tokens. Render generates a random value once.
      - key: SESSION_SECRET
        generateValue: true
      # This service's public https URL. Invite and reset links point here.
      - key: APP_URL
        sync: false
      - key: RESEND_API_KEY
        sync: false
      # A sender on the domain verified in Resend, e.g. "BOAT <noreply@example.com>".
      - key: MAIL_FROM
        sync: false
      # Render's proxy sits in front of the app. Rate limits need the client IP behind it.
      - key: TRUST_PROXY
        value: '1'
```

In `.github/workflows/ci.yml`, run CI on pushes to `dev` as well as `main`:

```yaml
  push:
    branches: [main, dev]
```

- [ ] **Step 12: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck && pnpm test
git add -A
git commit -m "Add auth config, log redaction, error mapping and input parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Access checks, the API router and the route-walk test

Every route will start with one of three tagged handlers. The route-walk test reads the tag on each route's first handler. `createApp` now takes the API's dependencies in a single `api` object, built for production in `server.ts` and by `testDeps()` in tests.

**Files:**
- Create: `apps/api/src/core/access.ts`, `apps/api/src/core/access.test.ts`
- Create: `apps/api/src/api.ts`, `apps/api/src/api.test.ts`, `apps/api/src/test-deps.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/server.ts`
- Modify: `apps/api/src/modules/health/health.router.ts`
- Modify: `apps/api/test/database.int.test.ts` (the readiness test)
- Modify: `apps/api/package.json` (cookie-parser)

**Interfaces:**
- Consumes: `UnauthenticatedError` from Task 2; `roleCan`, `deniedMessage`, `actionVerbs`, `PermissionError`, `Action` from `@boat/domain/permissions`; `Role` from `@boat/domain/models`.
- Produces:
  - `type SessionUser = { id: string; email: string; name: string; role: Role; pocId: string | null; poc: { id: string; value: string } | null }`
  - `type AuthContext = { user: SessionUser; sessionId: string; csrfToken: string }`, and `req.auth?: AuthContext` on every Express request
  - `type Access = 'public' | 'signedIn' | Action`
  - `publicRoute(): RequestHandler`, `requireSignedIn(): RequestHandler`, `requirePermission(action: Action): RequestHandler`
  - `accessOf(handler: unknown): Access | undefined`
  - `authOf(req: Request): AuthContext`, which throws `UnauthenticatedError`
  - `type ApiDeps = { db: PrismaClient; checkDatabase: ReadinessCheck; sessionSecret: string; appUrl: string; secureCookies: boolean }` (Task 6 adds `mailer`)
  - `buildApiRouter(deps: ApiDeps): Router`, `mountPathOf(router: object): string | undefined`
  - `testDeps(overrides?: Partial<ApiDeps>): ApiDeps`
  - `createApp({ logger, webDist?, trustProxy?, hsts?, api }: AppOptions)`

- [ ] **Step 1: Add cookie-parser**

```bash
pnpm --filter @boat/api add cookie-parser@1.4.7
pnpm --filter @boat/api add -D @types/cookie-parser@1.4.10
```

- [ ] **Step 2: Write the failing access tests**

Create `apps/api/src/core/access.test.ts`:

```ts
import type { Role } from '@boat/domain/models'
import express, { type RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import {
  accessOf,
  type AuthContext,
  publicRoute,
  requirePermission,
  requireSignedIn,
} from './access'
import { errorHandler } from './errors'

const signedInAs = (role: Role): AuthContext => ({
  user: { id: 'u1', email: 'a@example.com', name: 'A', role, pocId: null, poc: null },
  sessionId: 's1',
  csrfToken: 'csrf-1',
})

function appWith(auth: AuthContext | undefined, guard: RequestHandler) {
  const app = express()
  app.use((req, _res, next) => {
    req.auth = auth
    next()
  })
  app.all('/', guard, (_req, res) => {
    res.json({ ok: true })
  })
  app.use(errorHandler)
  return app
}

describe('requireSignedIn', () => {
  it('answers 401 without a session', async () => {
    const res = await request(appWith(undefined, requireSignedIn())).get('/')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'unauthenticated' })
  })
  it('lets any signed-in role read', async () => {
    expect((await request(appWith(signedInAs('viewer'), requireSignedIn())).get('/')).status).toBe(200)
  })
  it('refuses a write without the matching CSRF token', async () => {
    const app = appWith(signedInAs('viewer'), requireSignedIn())
    for (const token of [undefined, 'csrf-2']) {
      const req = request(app).post('/')
      const res = await (token ? req.set('x-csrf-token', token) : req)
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('forbidden')
    }
  })
  it('accepts a write with the session CSRF token', async () => {
    const res = await request(appWith(signedInAs('viewer'), requireSignedIn()))
      .patch('/')
      .set('x-csrf-token', 'csrf-1')
    expect(res.status).toBe(200)
  })
})

describe('requirePermission', () => {
  it('answers 401 without a session', async () => {
    const res = await request(appWith(undefined, requirePermission('manageSettings'))).get('/')
    expect(res.status).toBe(401)
  })
  it("refuses roles that lack the action, saying what they can't do", async () => {
    const res = await request(appWith(signedInAs('planner'), requirePermission('manageSettings'))).get('/')
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      error: 'forbidden',
      message: "Planner profiles can't change Settings or profiles. Ask an admin.",
    })
  })
  it('allows roles that have the action', async () => {
    const res = await request(appWith(signedInAs('admin'), requirePermission('manageSettings'))).get('/')
    expect(res.status).toBe(200)
  })
  it('still checks the CSRF token on writes', async () => {
    const res = await request(appWith(signedInAs('admin'), requirePermission('manageSettings'))).delete('/')
    expect(res.status).toBe(403)
  })
})

describe('publicRoute', () => {
  it('lets anyone through, writes included', async () => {
    expect((await request(appWith(undefined, publicRoute())).post('/')).status).toBe(200)
  })
})

describe('accessOf', () => {
  it('reads the tag each guard carries', () => {
    expect(accessOf(publicRoute())).toBe('public')
    expect(accessOf(requireSignedIn())).toBe('signedIn')
    expect(accessOf(requirePermission('deleteLots'))).toBe('deleteLots')
    expect(accessOf(() => {})).toBeUndefined()
    expect(accessOf(undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test -- src/core/access.test.ts`
Expected: FAIL. `./access` doesn't exist.

- [ ] **Step 4: Implement the access checks**

Create `apps/api/src/core/access.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'
import type { Role } from '@boat/domain/models'
import {
  type Action,
  actionVerbs,
  deniedMessage,
  PermissionError,
  roleCan,
} from '@boat/domain/permissions'
import type { Request, RequestHandler } from 'express'
import { UnauthenticatedError } from './errors'

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  pocId: string | null
  poc: { id: string; value: string } | null
}
export type AuthContext = { user: SessionUser; sessionId: string; csrfToken: string }

declare global {
  namespace Express {
    interface Request {
      // Set by loadSession when the cookie names a live session.
      auth?: AuthContext
    }
  }
}

// Every API route starts with one of the guards below. Each carries this tag, and the route-walk
// test in api.test.ts fails for a route whose first handler has none.
const accessTag = Symbol('access')
export type Access = 'public' | 'signedIn' | Action
const tagged = (access: Access, handler: RequestHandler) =>
  Object.assign(handler, { [accessTag]: access })
export const accessOf = (handler: unknown): Access | undefined =>
  typeof handler === 'function'
    ? (handler as { [accessTag]?: Access })[accessTag]
    : undefined

const writes = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// Every write by a signed-in user must echo the session's CSRF token in X-CSRF-Token. Another site
// can make the browser send the cookie, but it cannot read the token.
function signedIn(req: Request) {
  if (!req.auth) throw new UnauthenticatedError()
  if (writes.has(req.method) && !sameToken(req.get('x-csrf-token') ?? '', req.auth.csrfToken))
    throw new PermissionError(
      'Your session token is missing or out of date. Reload the page and try again.',
    )
  return req.auth
}

// Public routes (sign-in, invite, reset) have no session to check. They read only JSON bodies,
// which a cross-site form cannot send.
export const publicRoute = () => tagged('public', (_req, _res, next) => next())

export const requireSignedIn = () =>
  tagged('signedIn', (req, _res, next) => {
    signedIn(req)
    next()
  })

export const requirePermission = (action: Action) =>
  tagged(action, (req, _res, next) => {
    const { user } = signedIn(req)
    if (!roleCan(user.role, action))
      throw new PermissionError(deniedMessage(user.role, actionVerbs[action]))
    next()
  })

// The signed-in user, for handlers behind requireSignedIn or requirePermission.
export function authOf(req: Request) {
  if (!req.auth) throw new UnauthenticatedError()
  return req.auth
}
```

- [ ] **Step 5: Run the access tests**

Run: `pnpm --filter @boat/api test -- src/core/access.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing route-walk test**

Create `apps/api/src/test-deps.ts`:

```ts
import type { ApiDeps } from './api'
import type { PrismaClient } from './generated/prisma/client'

// Dependencies for unit tests that never reach the database. Integration tests pass a real
// Prisma client (test/support/fixtures.ts).
export const testDeps = (overrides: Partial<ApiDeps> = {}): ApiDeps => ({
  db: {} as PrismaClient,
  checkDatabase: async () => {},
  sessionSecret: 'test-session-secret-0123456789abcdef',
  appUrl: 'http://localhost:5173',
  secureCookies: false,
  ...overrides,
})
```

Create `apps/api/src/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildApiRouter, mountPathOf } from './api'
import { accessOf } from './core/access'
import { testDeps } from './test-deps'

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] }
  handle: { stack?: Layer[] }
}

// Walks Express 5's router stack (router@2 internals) and lists "METHOD /path access" for each
// route, where access is the tag on the route's first handler. The permission table test below
// also fails if a future Express changes this shape and the walk finds nothing.
function routesOf(router: { stack?: Layer[] }, prefix = ''): string[] {
  const found: string[] = []
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const access = accessOf(layer.route.stack[0]?.handle) ?? 'NONE'
      for (const method of Object.keys(layer.route.methods))
        found.push(`${method.toUpperCase()} ${prefix}${layer.route.path} ${access}`)
    } else if (layer.handle.stack) {
      const mountPath = mountPathOf(layer.handle) ?? '/(mounted without mount())'
      found.push(...routesOf(layer.handle, prefix + mountPath))
    }
  }
  return found
}

const routes = routesOf(buildApiRouter(testDeps()) as unknown as { stack: Layer[] })

describe('API routes', () => {
  it('each start with an access check', () => {
    expect(routes.filter((r) => r.endsWith(' NONE'))).toEqual([])
  })
  // Every route and who may call it. Add a row with each new route, so a reviewer sees the
  // permission next to the path.
  it('match the permission table', () => {
    expect([...routes].sort()).toEqual(
      ['GET /health/live public', 'GET /health/ready public'].sort(),
    )
  })
})
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `pnpm --filter @boat/api test -- src/api.test.ts`
Expected: FAIL. `./api` doesn't exist.

- [ ] **Step 8: Implement the API router and tag the health routes**

Create `apps/api/src/api.ts`:

```ts
import { Router } from 'express'
import type { PrismaClient } from './generated/prisma/client'
import { healthRouter, type ReadinessCheck } from './modules/health/health.router'

export type ApiDeps = {
  db: PrismaClient
  checkDatabase: ReadinessCheck
  // Signs CSRF tokens.
  sessionSecret: string
  // The web app's address, for links in emails.
  appUrl: string
  // Secure cookies need HTTPS: true in production.
  secureCookies: boolean
}

const mountPaths = new WeakMap<object, string>()
// Express 5 does not keep a mounted router's path where a test can read it, so mount() records it
// for the route walk in api.test.ts.
function mount(api: Router, path: string, router: Router) {
  mountPaths.set(router, path)
  api.use(path, router)
}
export const mountPathOf = (router: object) => mountPaths.get(router)

export function buildApiRouter(deps: ApiDeps) {
  const api = Router()
  mount(api, '/health', healthRouter(deps.checkDatabase))
  return api
}
```

In `apps/api/src/modules/health/health.router.ts`, import the guard and put it first on both routes:

```ts
import { Router } from 'express'
import { publicRoute } from '../../core/access'
```

```ts
  router.get('/live', publicRoute(), (_req, res) => {
```

```ts
  router.get('/ready', publicRoute(), async (req, res) => {
```

- [ ] **Step 9: Run the route-walk test**

Run: `pnpm --filter @boat/api test -- src/api.test.ts`
Expected: PASS.

- [ ] **Step 10: Wire the router into the app**

Replace `apps/api/src/app.ts` with:

```ts
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import express from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import { type ApiDeps, buildApiRouter } from './api'
import { errorHandler } from './core/errors'

export type AppOptions = {
  logger: Logger
  // Built React app (apps/web/dist). Skipped when it has no index.html, e.g. in API tests.
  webDist?: string
  // Proxy hops in front of the app. Behind Render's proxy, req.ip must be the client's address,
  // or the per-IP sign-in limit would count every user together.
  trustProxy?: number
  // Strict-Transport-Security, for production behind HTTPS.
  hsts?: boolean
  api: ApiDeps
}

export function createApp({ logger, webDist, trustProxy = 0, hsts = false, api: deps }: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy || false)
  if (hsts)
    app.use((_req, res, next) => {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000')
      next()
    })
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
  app.use(cookieParser())

  app.use('/api/v1', buildApiRouter(deps))
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

In `apps/api/src/app.test.ts`, import the test dependencies and change the `app` helper:

```ts
import { testDeps } from './test-deps'
```

```ts
const app = (webDist?: string, checkDatabase = ready) =>
  createApp({ logger, webDist, api: testDeps({ checkDatabase }) })
```

Append to `apps/api/src/app.test.ts`:

```ts
describe('HSTS', () => {
  it('is sent when enabled', async () => {
    const res = await request(createApp({ logger, hsts: true, api: testDeps() })).get(
      '/api/v1/health/live',
    )
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000')
  })
  it('is off by default, for local HTTP', async () => {
    const res = await request(app()).get('/api/v1/health/live')
    expect(res.headers['strict-transport-security']).toBeUndefined()
  })
})
```

In `apps/api/src/server.ts`, replace the `createApp(...)` call with:

```ts
const app = createApp({
  logger,
  webDist,
  trustProxy: config.TRUST_PROXY,
  hsts: config.NODE_ENV === 'production',
  api: {
    db: prisma,
    checkDatabase: databaseCheck(prisma),
    sessionSecret: config.SESSION_SECRET,
    appUrl: config.APP_URL,
    secureCookies: config.NODE_ENV === 'production',
  },
})
```

In `apps/api/test/database.int.test.ts`, add `import { testDeps } from '../src/test-deps'`, then change the readiness test's `createApp` call to:

```ts
      const server = createApp({
        logger: pino({ level: 'silent' }),
        api: testDeps({ db, checkDatabase: databaseCheck(db) }),
      })
```

- [ ] **Step 11: Run every API test, the database tests included**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 12: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add access checks, the API router and the route-walk test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sessions, password hashing and the integration-test harness

This task turns a cookie into `req.auth`. Session rules (idle timeout, 12-hour cap, revocation, disabled and deleted users) need real Postgres, so it also builds the shared harness. One container starts per run, and migrations run once into a template database. Each test file copies that template, so files run in parallel without seeing each other's rows.

**Files:**
- Create: `apps/api/src/modules/auth/tokens.ts`, `apps/api/src/modules/auth/tokens.test.ts`
- Create: `apps/api/src/modules/auth/password.ts`, `apps/api/src/modules/auth/password.test.ts`
- Create: `apps/api/src/modules/settings/settings.service.ts`
- Create: `apps/api/src/modules/auth/sessions.ts`
- Modify: `apps/api/src/core/prisma.ts` (the `Db` type), `apps/api/src/api.ts` (mount `loadSession`)
- Modify: `apps/api/vitest.int.config.ts`, `apps/api/package.json` (argon2)
- Create: `apps/api/test/support/urls.ts`, `apps/api/test/support/global-setup.ts`, `apps/api/test/support/db.ts`, `apps/api/test/support/fixtures.ts`
- Test: `apps/api/test/sessions.int.test.ts`

**Interfaces:**
- Consumes: `AuthContext`, `SessionUser` from Task 3; `ApiDeps` and `buildApiRouter` from Task 3.
- Produces:
  - `newToken(): string`, `hashToken(token: string): string` (hex SHA-256), `csrfTokenFor(sessionId: string, secret: string): string`
  - `hashPassword(password: string): Promise<string>`, `verifyPassword(stored: string | null | undefined, password: string): Promise<boolean>`
  - `type Db = PrismaClient | Prisma.TransactionClient` (from `core/prisma.ts`)
  - `type Settings = { timeZone: string; idleTimeoutMinutes: number }`, `defaultSettings: Settings`
  - `createSettingsService(db: PrismaClient, ttlMs = 60_000): { get(): Promise<Settings> }`, `type SettingsService` (Task 8 adds `update`)
  - `sessionCookie = 'boat_session'`, `maxSessionMs` (12 h)
  - `sessionUserSelect`: the Prisma select that yields a `SessionUser`
  - `createSession(db: Db, userId: string, userAgent?: string): Promise<{ token: string; id: string; userId: string }>`
  - `revokeSession(db: Db, id: string)`, `revokeUserSessions(db: Db, userId: string)`
  - `setSessionCookie(res, token, secure)`, `clearSessionCookie(res, secure)`
  - `loadSession({ db, settings, sessionSecret }): RequestHandler`
  - `authContext(db: Db, sessionSecret: string, session: { id: string; userId: string }): Promise<AuthContext>`
  - Test support: `createTestDatabase(): Promise<{ db: PrismaClient; url: string; close(): Promise<void> }>` (`url` connects as `boat_app`), `makeUser(db, fields?)`, `makePoc(db, value?)`, `unique(prefix)`, `password` (the fixtures' default password)

- [ ] **Step 1: Add argon2**

```bash
pnpm --filter @boat/api add @node-rs/argon2@2.2.1
```

It ships prebuilt binaries as optional platform packages, so nothing compiles and pnpm's `onlyBuiltDependencies` list doesn't change.

- [ ] **Step 2: Write the failing token and password tests**

Create `apps/api/src/modules/auth/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { csrfTokenFor, hashToken, newToken } from './tokens'

describe('newToken', () => {
  it('makes 256 random bits as URL-safe text', () => {
    const a = newToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newToken()).not.toBe(a)
  })
})

describe('hashToken', () => {
  it('is a stable SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('csrfTokenFor', () => {
  it('is stable for one session and differs across sessions and secrets', () => {
    const secret = 's'.repeat(32)
    expect(csrfTokenFor('a', secret)).toBe(csrfTokenFor('a', secret))
    expect(csrfTokenFor('b', secret)).not.toBe(csrfTokenFor('a', secret))
    expect(csrfTokenFor('a', 't'.repeat(32))).not.toBe(csrfTokenFor('a', secret))
  })
})
```

Create `apps/api/src/modules/auth/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('passwords', () => {
  it('hash with Argon2id', async () => {
    expect(await hashPassword('correct horse battery')).toMatch(/^\$argon2id\$/)
  })
  it('verify the right password only', async () => {
    const stored = await hashPassword('correct horse battery')
    expect(await verifyPassword(stored, 'correct horse battery')).toBe(true)
    expect(await verifyPassword(stored, 'wrong horse battery')).toBe(false)
  })
  it('refuse when there is no stored hash', async () => {
    expect(await verifyPassword(null, 'anything at all')).toBe(false)
    expect(await verifyPassword(undefined, 'anything at all')).toBe(false)
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test -- src/modules/auth`
Expected: FAIL. `./tokens` and `./password` don't exist.

- [ ] **Step 4: Implement tokens and passwords**

Create `apps/api/src/modules/auth/tokens.ts`:

```ts
import { createHash, createHmac, randomBytes } from 'node:crypto'

// 256 random bits, URL-safe. Cookies and emailed links carry the token; the database keeps only
// its hash, so a leaked database cannot be used to sign in.
export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// Bound to one session and signed with the secret: it can't be guessed, or reused from another session.
export const csrfTokenFor = (sessionId: string, secret: string) =>
  createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('base64url')
```

Create `apps/api/src/modules/auth/password.ts`:

```ts
import { hash, verify } from '@node-rs/argon2'

// @node-rs/argon2 defaults to Argon2id with 19 MiB of memory and 2 passes: OWASP's minimum.
export const hashPassword = (password: string) => hash(password)

let dummyHash: Promise<string> | undefined
// With no stored hash (unknown email, invite not accepted) this still spends the time of one
// verification, so the response time doesn't reveal which emails have accounts.
export async function verifyPassword(stored: string | null | undefined, password: string) {
  if (!stored) {
    dummyHash ??= hash('placeholder password for timing')
    await verify(await dummyHash, password)
    return false
  }
  return verify(stored, password)
}
```

- [ ] **Step 5: Run the unit tests**

Run: `pnpm --filter @boat/api test -- src/modules/auth`
Expected: PASS.

- [ ] **Step 6: Build the integration harness**

In `apps/api/vitest.int.config.ts`, add the global setup:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
```

Create `apps/api/test/support/urls.ts`:

```ts
export const templateDb = 'boat_template'

export function withDatabase(url: string, database: string, user?: { name: string; password: string }) {
  const u = new URL(url)
  u.pathname = `/${database}`
  if (user) {
    u.username = user.name
    u.password = user.password
  }
  return u.toString()
}
```

Create `apps/api/test/support/global-setup.ts`:

```ts
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import type { TestProject } from 'vitest/node'
import { templateDb, withDatabase } from './urls'

declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string
  }
}

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// One Postgres for the whole run, migrated once into a template database that each test file
// copies (db.ts). database.int.test.ts still starts its own container, because it tests the
// migrations themselves.
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17').start()
  const url = container.getConnectionUri()
  const admin = new Client({ connectionString: url })
  await admin.connect()
  await admin.query("CREATE ROLE boat_app LOGIN PASSWORD 'boat_app'")
  await admin.query(`CREATE DATABASE ${templateDb}`)
  await admin.end()
  const env = { ...process.env, DIRECT_URL: withDatabase(url, templateDb) }
  for (const args of [
    ['migrate', 'deploy'],
    ['db', 'execute', '--file', 'prisma/grants.sql'],
  ])
    execFileSync('pnpm', ['exec', 'prisma', ...args], { cwd: apiRoot, env, stdio: 'pipe' })
  project.provide('postgresUrl', url)
  return async () => {
    await container.stop()
  }
}
```

Create `apps/api/test/support/db.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { inject } from 'vitest'
import { createPrisma } from '../../src/core/prisma'
import { templateDb, withDatabase } from './urls'

// A fresh copy of the migrated template for one test file, connected as the app role boat_app,
// as in production. Table grants live in each database, so the copy has them too.
export async function createTestDatabase() {
  const postgresUrl = inject('postgresUrl')
  const name = `t_${randomUUID().replaceAll('-', '')}`
  const admin = new Client({ connectionString: postgresUrl })
  await admin.connect()
  try {
    // Copies from one template run one at a time, so parallel files never collide.
    await admin.query('SELECT pg_advisory_lock(42)')
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${templateDb}`)
    await admin.query('SELECT pg_advisory_unlock(42)')
  } finally {
    await admin.end()
  }
  const url = withDatabase(postgresUrl, name, { name: 'boat_app', password: 'boat_app' })
  const db = createPrisma(url)
  return { db, url, close: () => db.$disconnect() }
}
```

Create `apps/api/test/support/fixtures.ts`:

```ts
import type { Role } from '@boat/domain/models'
import type { PrismaClient } from '../../src/generated/prisma/client'
import { hashPassword } from '../../src/modules/auth/password'

export const password = 'correct horse battery staple'

let counter = 0
export const unique = (prefix: string) => `${prefix} ${++counter}-${Date.now().toString(36)}`

export const makePoc = (db: PrismaClient, value = unique('POC')) =>
  db.lookupValue.create({ data: { kind: 'poc', value } })

type UserFields = {
  role?: Role
  status?: 'invited' | 'active' | 'disabled'
  pocId?: string | null
  email?: string
  name?: string
  // null: no password yet, like a user who hasn't accepted their invite.
  password?: string | null
}
export async function makeUser(db: PrismaClient, fields: UserFields = {}) {
  const pw = fields.password === undefined ? password : fields.password
  return db.user.create({
    data: {
      email: fields.email ?? `${unique('user').replace(/\W/g, '')}@example.com`,
      name: fields.name ?? 'Test User',
      role: fields.role ?? 'planner',
      status: fields.status ?? 'active',
      pocId: fields.pocId ?? null,
      passwordHash: pw ? await hashPassword(pw) : null,
    },
  })
}
```

- [ ] **Step 7: Write the failing session tests**

Create `apps/api/test/sessions.int.test.ts`:

```ts
import cookieParser from 'cookie-parser'
import express from 'express'
import { pino } from 'pino'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import {
  createSession,
  loadSession,
  revokeSession,
  sessionCookie,
} from '../src/modules/auth/sessions'
import { csrfTokenFor, hashToken } from '../src/modules/auth/tokens'
import { createSettingsService } from '../src/modules/settings/settings.service'
import { createTestDatabase } from './support/db'
import { makePoc, makeUser } from './support/fixtures'

const secret = 'session-test-secret-0123456789abcdef'
let db: PrismaClient
let close: () => Promise<void>
const probe = express()

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  probe.use(cookieParser())
  probe.use((req, _res, next) => {
    req.log = pino({ level: 'silent' })
    next()
  })
  // ttl 0: settings are read on every request, so a test's settings change applies at once.
  probe.use(loadSession({ db, settings: createSettingsService(db, 0), sessionSecret: secret }))
  probe.get('/probe', (req, res) => {
    res.json(req.auth ?? null)
  })
})
afterAll(() => close())

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)
const probeWith = (token: string) =>
  request(probe).get('/probe').set('cookie', `${sessionCookie}=${token}`)

async function sessionFor(fields: Parameters<typeof makeUser>[1] = {}) {
  const user = await makeUser(db, fields)
  return { user, ...(await createSession(db, user.id)) }
}

describe('loadSession', () => {
  it('leaves a request without a cookie signed out', async () => {
    expect((await request(probe).get('/probe')).body).toBeNull()
  })
  it('ignores a token that matches no session', async () => {
    expect((await probeWith('not-a-real-token')).body).toBeNull()
  })
  it('signs in a live session with the user, role, POC and CSRF token', async () => {
    const poc = await makePoc(db)
    const { user, token, id } = await sessionFor({ role: 'poc', pocId: poc.id })
    expect((await probeWith(token)).body).toEqual({
      sessionId: id,
      csrfToken: csrfTokenFor(id, secret),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: 'poc',
        pocId: poc.id,
        poc: { id: poc.id, value: poc.value },
      },
    })
  })
  it('stores only the SHA-256 of the cookie token', async () => {
    const { token, id } = await sessionFor()
    expect(id).toBe(hashToken(token))
    expect(await db.session.findUnique({ where: { id: token } })).toBeNull()
  })
  it('ends a session idle for longer than the timeout (15 minutes by default)', async () => {
    const { token, id } = await sessionFor()
    await db.session.update({ where: { id }, data: { lastSeenAt: minutesAgo(16) } })
    expect((await probeWith(token)).body).toBeNull()
  })
  it('keeps a session within the timeout and records the activity', async () => {
    const { token, id } = await sessionFor()
    await db.session.update({ where: { id }, data: { lastSeenAt: minutesAgo(14) } })
    expect((await probeWith(token)).body).not.toBeNull()
    const { lastSeenAt } = await db.session.findUniqueOrThrow({ where: { id } })
    expect(Date.now() - lastSeenAt.getTime()).toBeLessThan(5_000)
  })
  it('uses the idle timeout from settings', async () => {
    const { token, id } = await sessionFor()
    await db.session.update({ where: { id }, data: { lastSeenAt: minutesAgo(20) } })
    await db.appSetting.create({ data: { key: 'idleTimeoutMinutes', value: 30 } })
    try {
      expect((await probeWith(token)).body).not.toBeNull()
    } finally {
      // The app role cannot delete rows, so the test puts the default back.
      await db.appSetting.update({ where: { key: 'idleTimeoutMinutes' }, data: { value: 15 } })
    }
  })
  it('ends a session 12 hours after sign-in, however active', async () => {
    const { token, id } = await sessionFor()
    await db.session.update({ where: { id }, data: { expiresAt: minutesAgo(1) } })
    expect((await probeWith(token)).body).toBeNull()
  })
  it('ends a revoked session', async () => {
    const { token, id } = await sessionFor()
    await revokeSession(db, id)
    expect((await probeWith(token)).body).toBeNull()
  })
  it('signs out users who are disabled or deleted', async () => {
    const disabled = await sessionFor({ status: 'disabled' })
    expect((await probeWith(disabled.token)).body).toBeNull()
    const deleted = await sessionFor()
    await db.user.update({ where: { id: deleted.user.id }, data: { deletedAt: new Date() } })
    expect((await probeWith(deleted.token)).body).toBeNull()
  })
})
```

- [ ] **Step 8: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/sessions.int.test.ts`
Expected: FAIL. `sessions.ts` and `settings.service.ts` don't exist.

- [ ] **Step 9: Implement the settings reader, the `Db` type and sessions**

Append to `apps/api/src/core/prisma.ts`, and add `Prisma` to its import from `../generated/prisma/client`:

```ts
// Either the client or the client inside $transaction, so helpers work in both.
export type Db = PrismaClient | Prisma.TransactionClient
```

Create `apps/api/src/modules/settings/settings.service.ts`:

```ts
import type { PrismaClient } from '../../generated/prisma/client'

export type Settings = { timeZone: string; idleTimeoutMinutes: number }
export const defaultSettings: Settings = { timeZone: 'Asia/Kolkata', idleTimeoutMinutes: 15 }
const keys = Object.keys(defaultSettings)

export type SettingsService = ReturnType<typeof createSettingsService>

// Every signed-in request needs the idle timeout, so settings are cached in the process: reloaded
// after a change here, and at most a minute after a change made by another instance.
export function createSettingsService(db: PrismaClient, ttlMs = 60_000) {
  let cached: { value: Settings; at: number } | undefined

  async function get(): Promise<Settings> {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value
    const rows = await db.appSetting.findMany({ where: { key: { in: keys } } })
    const value = { ...defaultSettings }
    for (const { key, value: stored } of rows) {
      if (key === 'timeZone' && typeof stored === 'string') value.timeZone = stored
      if (key === 'idleTimeoutMinutes' && typeof stored === 'number')
        value.idleTimeoutMinutes = stored
    }
    cached = { value, at: Date.now() }
    return value
  }

  return { get }
}
```

Create `apps/api/src/modules/auth/sessions.ts`:

```ts
import type { CookieOptions, RequestHandler, Response } from 'express'
import type { AuthContext } from '../../core/access'
import type { Db } from '../../core/prisma'
import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import type { SettingsService } from '../settings/settings.service'
import { csrfTokenFor, hashToken, newToken } from './tokens'

export const sessionCookie = 'boat_session'
export const maxSessionMs = 12 * 60 * 60_000
// lastSeenAt is written at most once a minute, so idle expiry is accurate to about a minute.
const touchAfterMs = 60_000

export const sessionUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  pocId: true,
  poc: { select: { id: true, value: true } },
} satisfies Prisma.UserSelect

export async function createSession(db: Db, userId: string, userAgent?: string) {
  const token = newToken()
  const id = hashToken(token)
  await db.session.create({
    data: {
      id,
      userId,
      userAgent: userAgent?.slice(0, 200),
      expiresAt: new Date(Date.now() + maxSessionMs),
    },
  })
  return { token, id, userId }
}

// Sessions are never deleted (the app role cannot DELETE); revoking stamps revokedAt.
export const revokeSession = (db: Db, id: string) =>
  db.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })
export const revokeUserSessions = (db: Db, userId: string) =>
  db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })

const cookieBase = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'lax',
  path: '/',
})
export const setSessionCookie = (res: Response, token: string, secure: boolean) =>
  res.cookie(sessionCookie, token, { ...cookieBase(secure), maxAge: maxSessionMs })
export const clearSessionCookie = (res: Response, secure: boolean) =>
  res.clearCookie(sessionCookie, cookieBase(secure))

export async function authContext(
  db: Db,
  sessionSecret: string,
  session: { id: string; userId: string },
): Promise<AuthContext> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: sessionUserSelect,
  })
  return { user, sessionId: session.id, csrfToken: csrfTokenFor(session.id, sessionSecret) }
}

// Turns the session cookie into req.auth when the session is live: not revoked, within 12 hours
// of sign-in, active within the idle timeout, and its user active and not deleted. Otherwise the
// request carries on signed out, and the route's guard decides.
export function loadSession(deps: {
  db: PrismaClient
  settings: SettingsService
  sessionSecret: string
}): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[sessionCookie]
    if (typeof token !== 'string' || !token) return next()
    const id = hashToken(token)
    const now = new Date()
    const { idleTimeoutMinutes } = await deps.settings.get()
    const session = await deps.db.session.findFirst({
      where: {
        id,
        revokedAt: null,
        expiresAt: { gt: now },
        lastSeenAt: { gt: new Date(now.getTime() - idleTimeoutMinutes * 60_000) },
        user: { is: { status: 'active', deletedAt: null } },
      },
      select: { lastSeenAt: true, user: { select: sessionUserSelect } },
    })
    if (!session) return next()
    if (now.getTime() - session.lastSeenAt.getTime() > touchAfterMs)
      await deps.db.session.update({ where: { id }, data: { lastSeenAt: now } })
    req.auth = {
      user: session.user,
      sessionId: id,
      csrfToken: csrfTokenFor(id, deps.sessionSecret),
    }
    // PRD observability: the user id on every log line after this point.
    req.log = req.log.child({ userId: session.user.id })
    next()
  }
}
```

In `apps/api/src/api.ts`, load the session for every API request. Add the imports:

```ts
import { loadSession } from './modules/auth/sessions'
import { createSettingsService } from './modules/settings/settings.service'
```

and change `buildApiRouter` to:

```ts
export function buildApiRouter(deps: ApiDeps) {
  const api = Router()
  const settings = createSettingsService(deps.db)
  api.use(loadSession({ db: deps.db, settings, sessionSecret: deps.sessionSecret }))
  mount(api, '/health', healthRouter(deps.checkDatabase))
  return api
}
```

- [ ] **Step 10: Run the session tests and all the others**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS. The unit tests never send a cookie, so `loadSession` never touches their empty `db`.

- [ ] **Step 11: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add server sessions, Argon2id hashing and the integration harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sign-in, sign-out and `/auth/me`, with rate limits

This task meets the Phase 2 gate: each role can sign in, and `/auth/me` returns the right allowed actions.

**Files:**
- Create: `apps/api/src/modules/auth/rate-limit.ts`
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.router.ts`
- Modify: `apps/api/src/api.ts` (mount `/auth`), `apps/api/src/api.test.ts` (table)
- Modify: `apps/api/test/support/fixtures.ts` (`testApp`, `signIn`)
- Modify: `apps/api/package.json` (express-rate-limit)
- Test: `apps/api/test/auth.int.test.ts`

**Interfaces:**
- Consumes: from Task 4, `createSession`, `revokeSession`, `setSessionCookie`, `clearSessionCookie`, `authContext`, `verifyPassword` and `SettingsService`; from Task 3, `publicRoute`, `requireSignedIn`, `authOf` and `AuthContext`; from Task 2, `parseInput` and `UnauthenticatedError`; from Task 1, `allowedActions` and `normalizeEmail`.
- Produces:
  - `failedAttemptLimiters(): RequestHandler[]` (per IP, then per email; only failures count)
  - `signInWithPassword(db: Db, email: string, password: string, userAgent?: string): Promise<{ token: string; id: string; userId: string }>`
  - `type MePayload = { user: SessionUser; allowedActions: Action[]; csrfToken: string; idleTimeoutMinutes: number }`
  - `mePayload(settings: SettingsService, auth: AuthContext): Promise<MePayload>`
  - `type AuthRouterDeps = { db: PrismaClient; settings: SettingsService; sessionSecret: string; secureCookies: boolean }` (Task 7 adds `mailer` and `appUrl`)
  - `authRouter(deps: AuthRouterDeps): Router`
  - Routes: `POST /auth/login` (public) → 200 `MePayload` plus cookie; `POST /auth/logout` (signedIn) → 204; `GET /auth/me` (signedIn) → 200 `MePayload`
  - Test support: `testApp(db, overrides?)`, `signIn(app, email, pw?)` → `{ agent, csrf, me, send(method, url, body?) }`

- [ ] **Step 1: Add express-rate-limit**

```bash
pnpm --filter @boat/api add express-rate-limit@8.7.0
```

- [ ] **Step 2: Add the test helpers**

Append to `apps/api/test/support/fixtures.ts`, and merge these imports into the top of the file:

```ts
import type { Express } from 'express'
import { pino } from 'pino'
import request from 'supertest'
import type { ApiDeps } from '../../src/api'
import { createApp } from '../../src/app'
import { testDeps } from '../../src/test-deps'
```

```ts
// The real app on a test database. Each call has its own rate-limit counters.
export function testApp(
  db: PrismaClient,
  { trustProxy, ...api }: Partial<ApiDeps> & { trustProxy?: number } = {},
) {
  return createApp({
    logger: pino({ level: 'silent' }),
    trustProxy,
    api: testDeps({ db, ...api }),
  })
}

// Signs in through the API. The agent keeps the session cookie; send() adds the CSRF token.
export async function signIn(app: Express, email: string, pw = password) {
  const agent = request.agent(app)
  const res = await agent.post('/api/v1/auth/login').send({ email, password: pw })
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`)
  const csrf: string = res.body.csrfToken
  const send = (method: 'post' | 'patch' | 'delete', url: string, body?: object) => {
    const req = agent[method](url).set('x-csrf-token', csrf)
    return body ? req.send(body) : req
  }
  return { agent, csrf, me: res.body, send }
}
```

- [ ] **Step 3: Write the failing tests**

Create `apps/api/test/auth.int.test.ts`:

```ts
import type { Role } from '@boat/domain/models'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { hashToken } from '../src/modules/auth/tokens'
import { createTestDatabase } from './support/db'
import { makePoc, makeUser, password, signIn, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
})
afterAll(() => close())

const login = (app: ReturnType<typeof testApp>, email: string, pw = password) =>
  request(app).post('/api/v1/auth/login').send({ email, password: pw })
const incorrect = { error: 'unauthenticated', message: 'Email or password is incorrect.' }

// The Phase 2 gate. Expected actions are written out, not derived from the domain.
describe('each role signs in and sees its allowed actions', () => {
  const expected: Record<Role, string[]> = {
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
  for (const role of Object.keys(expected) as Role[]) {
    it(role, async () => {
      const app = testApp(db)
      const poc = role === 'poc' ? await makePoc(db) : null
      const user = await makeUser(db, { role, pocId: poc?.id ?? null })
      const { agent } = await signIn(app, user.email)
      const res = await agent.get('/api/v1/auth/me')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role,
          pocId: poc?.id ?? null,
          poc: poc ? { id: poc.id, value: poc.value } : null,
        },
        allowedActions: expected[role],
        csrfToken: expect.any(String),
        idleTimeoutMinutes: 15,
      })
    })
  }
})

describe('POST /auth/login', () => {
  it('sets an httpOnly, SameSite=Lax cookie whose hash is the session id', async () => {
    const user = await makeUser(db)
    const res = await login(testApp(db), user.email)
    expect(res.status).toBe(200)
    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toMatch(/^boat_session=[\w-]{43};/)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).not.toMatch(/Secure/)
    const token = /^boat_session=([\w-]+)/.exec(cookie)![1]
    const session = await db.session.findUniqueOrThrow({ where: { id: hashToken(token) } })
    expect(session.userId).toBe(user.id)
  })
  it('marks the cookie Secure when the app runs behind HTTPS', async () => {
    const user = await makeUser(db)
    const res = await login(testApp(db, { secureCookies: true }), user.email)
    expect(String(res.headers['set-cookie'])).toMatch(/Secure/)
  })
  it('ignores the case and spaces of the email address', async () => {
    const user = await makeUser(db)
    expect((await login(testApp(db), `  ${user.email.toUpperCase()} `)).status).toBe(200)
  })
  it('records the sign-in time', async () => {
    const user = await makeUser(db)
    await login(testApp(db), user.email)
    const { lastLoginAt } = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(Date.now() - lastLoginAt!.getTime()).toBeLessThan(5_000)
  })
  it('gives one answer for every kind of failure', async () => {
    const app = testApp(db)
    const active = await makeUser(db)
    const invited = await makeUser(db, { status: 'invited', password: null })
    const disabled = await makeUser(db, { status: 'disabled' })
    const deleted = await makeUser(db)
    await db.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
    for (const [email, pw] of [
      [active.email, 'wrong password!!'],
      ['nobody@example.com', password],
      [invited.email, password],
      [disabled.email, password],
      [deleted.email, password],
    ]) {
      const res = await login(app, email, pw)
      expect(res.status).toBe(401)
      expect(res.body).toEqual(incorrect)
    }
  })
  it('answers a request without an email or password with field errors', async () => {
    const res = await request(testApp(db)).post('/api/v1/auth/login').send({})
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    })
  })
})

describe('sign-in rate limits', () => {
  it('locks an account after 5 failures, even for the right password', async () => {
    const app = testApp(db)
    const user = await makeUser(db)
    for (let i = 0; i < 5; i++) expect((await login(app, user.email, 'wrong password!!')).status).toBe(401)
    const res = await login(app, user.email)
    expect(res.status).toBe(429)
    expect(res.body).toEqual({
      error: 'rate_limited',
      message: 'Too many failed attempts. Wait 15 minutes and try again.',
    })
  })
  it('limits each client IP behind the proxy separately', async () => {
    const app = testApp(db, { trustProxy: 1 })
    const from = (ip: string, email: string) =>
      request(app)
        .post('/api/v1/auth/login')
        .set('x-forwarded-for', ip)
        .send({ email, password: 'wrong password!!' })
    for (let i = 0; i < 5; i++) expect((await from('203.0.113.7', `n${i}@example.com`)).status).toBe(401)
    expect((await from('203.0.113.7', 'other@example.com')).status).toBe(429)
    expect((await from('203.0.113.8', 'other@example.com')).status).toBe(401)
  })
  it('does not count successful sign-ins', async () => {
    const app = testApp(db)
    const user = await makeUser(db)
    for (let i = 0; i < 8; i++) expect((await login(app, user.email)).status).toBe(200)
  })
})

describe('GET /auth/me', () => {
  it('answers 401 without a session', async () => {
    const res = await request(testApp(db)).get('/api/v1/auth/me')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'unauthenticated' })
  })
})

describe('POST /auth/logout', () => {
  it('needs the CSRF token', async () => {
    const user = await makeUser(db)
    const { agent } = await signIn(testApp(db), user.email)
    expect((await agent.post('/api/v1/auth/logout')).status).toBe(403)
  })
  it("refuses another session's CSRF token", async () => {
    const app = testApp(db)
    const user = await makeUser(db)
    const first = await signIn(app, user.email)
    const second = await signIn(app, user.email)
    const res = await first.agent.post('/api/v1/auth/logout').set('x-csrf-token', second.csrf)
    expect(res.status).toBe(403)
  })
  it('ends the session and clears the cookie', async () => {
    const app = testApp(db)
    const user = await makeUser(db)
    const { agent, send } = await signIn(app, user.email)
    const res = await send('post', '/api/v1/auth/logout')
    expect(res.status).toBe(204)
    expect(String(res.headers['set-cookie'])).toMatch(/boat_session=;/)
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401)
    const sessions = await db.session.findMany({ where: { userId: user.id } })
    expect(sessions.every((s) => s.revokedAt)).toBe(true)
  })
})
```

- [ ] **Step 4: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/auth.int.test.ts`
Expected: FAIL. `/api/v1/auth/login` answers the JSON 404.

- [ ] **Step 5: Implement the rate limiter**

Create `apps/api/src/modules/auth/rate-limit.ts`:

```ts
import { normalizeEmail } from '@boat/domain/validation'
import type { Request, RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'

const windowMs = 15 * 60_000
const message = 'Too many failed attempts. Wait 15 minutes and try again.'

// The counts live in this process, which is enough for one Render instance; a restart clears
// them. The per-IP key relies on `trust proxy` (createApp's trustProxy) behind Render's proxy.
function limiter({
  countSuccess,
  key,
}: {
  countSuccess: boolean
  key?: (req: Request) => string
}): RequestHandler {
  return rateLimit({
    windowMs,
    limit: 5,
    skipSuccessfulRequests: !countSuccess,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(key && { keyGenerator: key }),
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited', message })
    },
  })
}
const byEmail = (req: Request) => `email:${normalizeEmail(String(req.body?.email ?? ''))}`

// PRD: 5 failed sign-ins per 15 minutes per IP address and per account.
export const failedAttemptLimiters = () => [
  limiter({ countSuccess: false }),
  limiter({ countSuccess: false, key: byEmail }),
]
```

- [ ] **Step 6: Implement the service and router**

Create `apps/api/src/modules/auth/auth.service.ts`:

```ts
import { allowedActions } from '@boat/domain/permissions'
import { normalizeEmail } from '@boat/domain/validation'
import type { AuthContext } from '../../core/access'
import { UnauthenticatedError } from '../../core/errors'
import type { Db } from '../../core/prisma'
import type { SettingsService } from '../settings/settings.service'
import { verifyPassword } from './password'
import { createSession } from './sessions'

// One message for an unknown email, a wrong password, and an account that is invited, disabled or
// deleted, so a failed sign-in reveals nothing about which accounts exist.
const incorrect = 'Email or password is incorrect.'

export async function signInWithPassword(
  db: Db,
  email: string,
  password: string,
  userAgent?: string,
) {
  const user = await db.user.findFirst({
    where: { email: normalizeEmail(email), deletedAt: null },
    select: { id: true, status: true, passwordHash: true },
  })
  const ok = await verifyPassword(user?.passwordHash, password)
  if (!user || !ok || user.status !== 'active') throw new UnauthenticatedError(incorrect)
  const session = await createSession(db, user.id, userAgent)
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  return session
}

// What the browser needs after sign-in and on every page load.
export async function mePayload(settings: SettingsService, auth: AuthContext) {
  const { idleTimeoutMinutes } = await settings.get()
  return {
    user: auth.user,
    allowedActions: allowedActions(auth.user.role),
    csrfToken: auth.csrfToken,
    idleTimeoutMinutes,
  }
}
export type MePayload = Awaited<ReturnType<typeof mePayload>>
```

Create `apps/api/src/modules/auth/auth.router.ts`:

```ts
import { type Response, Router } from 'express'
import { z } from 'zod'
import { authOf, publicRoute, requireSignedIn } from '../../core/access'
import { parseInput } from '../../core/parse'
import type { PrismaClient } from '../../generated/prisma/client'
import type { SettingsService } from '../settings/settings.service'
import { mePayload, signInWithPassword } from './auth.service'
import { failedAttemptLimiters } from './rate-limit'
import { authContext, clearSessionCookie, revokeSession, setSessionCookie } from './sessions'

export type AuthRouterDeps = {
  db: PrismaClient
  settings: SettingsService
  sessionSecret: string
  secureCookies: boolean
}

const loginBody = z.object({
  email: z.string({ error: 'Enter your email address.' }),
  password: z.string({ error: 'Enter your password.' }),
})

export function authRouter(deps: AuthRouterDeps) {
  const router = Router()

  // Sets the cookie for a new session and answers with what /auth/me would return.
  async function startSession(res: Response, session: { token: string; id: string; userId: string }) {
    setSessionCookie(res, session.token, deps.secureCookies)
    res.json(await mePayload(deps.settings, await authContext(deps.db, deps.sessionSecret, session)))
  }

  router.post('/login', publicRoute(), ...failedAttemptLimiters(), async (req, res) => {
    const { email, password } = parseInput(loginBody, req.body)
    await startSession(res, await signInWithPassword(deps.db, email, password, req.get('user-agent')))
  })

  router.post('/logout', requireSignedIn(), async (req, res) => {
    await revokeSession(deps.db, authOf(req).sessionId)
    clearSessionCookie(res, deps.secureCookies)
    res.status(204).end()
  })

  router.get('/me', requireSignedIn(), async (req, res) => {
    res.json(await mePayload(deps.settings, authOf(req)))
  })

  return router
}
```

In `apps/api/src/api.ts`, import `authRouter` from `./modules/auth/auth.router`, and mount it after the health router:

```ts
  mount(api, '/auth', authRouter({ ...deps, settings }))
```

In `apps/api/src/api.test.ts`, replace the table with:

```ts
    expect([...routes].sort()).toEqual(
      [
        'GET /health/live public',
        'GET /health/ready public',
        'POST /auth/login public',
        'POST /auth/logout signedIn',
        'GET /auth/me signedIn',
      ].sort(),
    )
```

- [ ] **Step 7: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 8: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add sign-in, sign-out and /auth/me with rate limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Mailer and user management (invite, list, edit, disable, delete)

Admins manage users. Creating a user sends an invite email. The last active admin is protected, even against two admins changing each other at the same moment.

**Files:**
- Create: `apps/api/src/core/mailer.ts`, `apps/api/src/core/mailer.test.ts`
- Create: `apps/api/src/modules/auth/auth-tokens.ts`, `apps/api/src/modules/auth/emails.ts`
- Create: `apps/api/src/modules/users/users.service.ts`, `apps/api/src/modules/users/users.router.ts`
- Modify: `apps/api/src/api.ts` (`mailer` in `ApiDeps`, mount `/users`), `apps/api/src/api.test.ts` (table)
- Modify: `apps/api/src/test-deps.ts` (`memoryMailer`), `apps/api/src/server.ts` (`createMailer`)
- Test: `apps/api/test/users.int.test.ts`

**Interfaces:**
- Consumes: from Task 4, `revokeUserSessions`, `newToken`, `hashToken` and `Db`; from Task 3, `requirePermission` and `authOf`; from Task 2, `parseInput`, `parseId`, `pageQuery`, `pageArgs`, `pageOf`, `NotFoundError`, `ConflictError` and `Config`; from Task 1, `validateAccount` and `normalizeEmail`.
- Produces:
  - `type Email = { to: string; subject: string; text: string }`, `type Mailer = { send(email: Email): Promise<void> }`
  - `resendMailer({ apiKey, from, fetch? }): Mailer`, `logMailer(logger): Mailer`, `memoryMailer(): Mailer & { sent: Email[] }`, `failingMailer(): Mailer`
  - `createMailer(config: Config, logger: Logger): Mailer`
  - `sendOrLog(mailer, log, email): Promise<boolean>`
  - `issueToken(db: Db, userId: string, purpose: TokenPurpose): Promise<string>`, `consumeToken(db: Db, token: string, purpose: TokenPurpose): Promise<string>` (returns the user id or throws `ValidationError({ token })`)
  - `inviteEmail(appUrl, name, token)` and `resetEmail(appUrl, name, token)`, each returning `{ subject, text }`; `linkFor(appUrl, page, token)`
  - `type UsersDeps = { db: PrismaClient; mailer: Mailer; appUrl: string }`
  - `type UserView`: `{ id, email, name, role, status, lastLoginAt, createdAt, poc: { id, value } | null }`
  - `listUsers(db, page)`, `createUser(deps, input, log)`, `resendInvite(deps, id, log)`, `updateUser(db, id, patch)`, `deleteUser(db, actorId, id)`
  - `createUser` and `resendInvite` return `{ user: UserView; inviteEmailSent: boolean; inviteUrl: string }`. The router answers with `user` and `inviteEmailSent` only.
  - Routes, all `manageSettings`: `GET /users`, `POST /users` → 201, `POST /users/:id/invite`, `PATCH /users/:id`, `DELETE /users/:id` → 204

- [ ] **Step 1: Write the failing mailer tests**

Create `apps/api/src/core/mailer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { memoryMailer, resendMailer } from './mailer'

const email = { to: 'asha@example.com', subject: 'Hi', text: 'Hello' }

describe('resendMailer', () => {
  it("posts the email to Resend's API with the key", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! })
      return new Response('{"id":"1"}', { status: 200 })
    }
    await resendMailer({ apiKey: 're_123', from: 'BOAT <noreply@example.com>', fetch }).send(email)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.resend.com/emails')
    expect(calls[0].init.method).toBe('POST')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer re_123')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: 'BOAT <noreply@example.com>',
      to: ['asha@example.com'],
      subject: 'Hi',
      text: 'Hello',
    })
  })
  it('fails loudly when Resend refuses', async () => {
    const fetch = async () => new Response('{"message":"invalid from"}', { status: 422 })
    await expect(
      resendMailer({ apiKey: 're_123', from: 'x', fetch }).send(email),
    ).rejects.toThrow(/422/)
  })
})

describe('memoryMailer', () => {
  it('keeps what it was asked to send', async () => {
    const mailer = memoryMailer()
    await mailer.send(email)
    expect(mailer.sent).toEqual([email])
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test -- src/core/mailer.test.ts`
Expected: FAIL. `./mailer` doesn't exist.

- [ ] **Step 3: Implement the mailer**

Create `apps/api/src/core/mailer.ts`:

```ts
import type { Logger } from 'pino'
import type { Config } from '../config'

export type Email = { to: string; subject: string; text: string }
export type Mailer = { send(email: Email): Promise<void> }

// Resend's send-email endpoint: https://resend.com/docs/api-reference/emails/send-email
export function resendMailer({
  apiKey,
  from,
  fetch = globalThis.fetch,
}: {
  apiKey: string
  from: string
  fetch?: typeof globalThis.fetch
}): Mailer {
  return {
    async send({ to, subject, text }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${await res.text()}`)
    },
  }
}

// Development without RESEND_API_KEY: the email, link included, is written to the log.
export const logMailer = (logger: Logger): Mailer => ({
  async send(email) {
    logger.info({ email }, 'email not sent: RESEND_API_KEY is not set')
  },
})

// Tests read what would have been sent.
export function memoryMailer() {
  const sent: Email[] = []
  return {
    sent,
    async send(email: Email) {
      sent.push(email)
    },
  }
}
export const failingMailer = (): Mailer => ({
  async send() {
    throw new Error('mail server down')
  },
})

// loadConfig requires a key in production, and a sender whenever a key is set.
export const createMailer = (config: Config, logger: Logger): Mailer =>
  config.RESEND_API_KEY
    ? resendMailer({ apiKey: config.RESEND_API_KEY, from: config.MAIL_FROM! })
    : logMailer(logger)

// A failed email must not undo the change that triggered it (the user still exists, and an admin
// can resend), so it is logged and reported to the caller instead of thrown.
export async function sendOrLog(mailer: Mailer, log: Logger, email: Email) {
  try {
    await mailer.send(email)
    return true
  } catch (err) {
    log.error({ err, to: email.to, subject: email.subject }, 'email failed')
    return false
  }
}
```

In `apps/api/src/api.ts`, import `type Mailer` from `./core/mailer` and add the field to `ApiDeps`:

```ts
  mailer: Mailer
```

In `apps/api/src/test-deps.ts`, import `memoryMailer` from `./core/mailer` and add `mailer: memoryMailer(),` to the defaults.

In `apps/api/src/server.ts`, import `createMailer` from `./core/mailer` and add `mailer: createMailer(config, logger),` to the `api` object.

Run: `pnpm --filter @boat/api test`
Expected: PASS.

- [ ] **Step 4: Write the failing user tests**

Create `apps/api/test/users.int.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ConflictError } from '../src/core/errors'
import { failingMailer, memoryMailer } from '../src/core/mailer'
import type { PrismaClient } from '../src/generated/prisma/client'
import { hashToken } from '../src/modules/auth/tokens'
import { updateUser } from '../src/modules/users/users.service'
import { createTestDatabase } from './support/db'
import { makePoc, makeUser, password, signIn, testApp, unique } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let mailer: ReturnType<typeof memoryMailer>
let app: ReturnType<typeof testApp>
let admin: Awaited<ReturnType<typeof signIn>>

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  mailer = memoryMailer()
  app = testApp(db, { mailer })
  const adminUser = await makeUser(db, { role: 'admin', name: 'First Admin' })
  admin = await signIn(app, adminUser.email)
})
afterAll(() => close())

const newEmail = () => `${unique('new').replace(/\W/g, '')}@example.com`
const tokenIn = (text: string) => /#token=([\w-]+)/.exec(text)?.[1]

describe('who may manage users', () => {
  it('answers 401 when signed out', async () => {
    expect((await request(app).get('/api/v1/users')).status).toBe(401)
  })
  it('refuses planners and viewers', async () => {
    for (const role of ['planner', 'viewer'] as const) {
      const user = await makeUser(db, { role })
      const { agent } = await signIn(app, user.email)
      const res = await agent.get('/api/v1/users')
      expect(res.status).toBe(403)
      expect(res.body.message).toMatch(/can't change Settings or profiles/)
    }
  })
})

describe('GET /users', () => {
  it('lists active, invited and disabled users, paged, without deleted ones', async () => {
    const disabled = await makeUser(db, { status: 'disabled', name: 'Aaron Disabled' })
    const deleted = await makeUser(db, { name: 'Aaron Deleted' })
    await db.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
    const res = await admin.agent.get('/api/v1/users?pageSize=200')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ page: 1, pageSize: 200 })
    const ids = res.body.items.map((u: { id: string }) => u.id)
    expect(ids).toContain(disabled.id)
    expect(ids).not.toContain(deleted.id)
    expect(res.body.total).toBe(res.body.items.length)
    expect(res.body.items[0]).not.toHaveProperty('passwordHash')
  })
})

describe('POST /users', () => {
  it('creates an invited user and emails a 72-hour invite link', async () => {
    const email = newEmail()
    const res = await admin.send('post', '/api/v1/users', {
      email: `  ${email.toUpperCase()} `,
      name: ' Asha Rao ',
      role: 'planner',
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      user: {
        id: expect.any(String),
        email,
        name: 'Asha Rao',
        role: 'planner',
        status: 'invited',
        poc: null,
        lastLoginAt: null,
        createdAt: expect.any(String),
      },
      inviteEmailSent: true,
    })
    const sent = mailer.sent.at(-1)!
    expect(sent.to).toBe(email)
    expect(sent.text).toContain('http://localhost:5173/invite#token=')
    const token = await db.authToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(tokenIn(sent.text)!) },
    })
    expect(token).toMatchObject({ userId: res.body.user.id, purpose: 'invite', usedAt: null })
    const hours = (token.expiresAt.getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(71.9)
    expect(hours).toBeLessThanOrEqual(72)
  })
  it('links a POC user to their point of contact, and nobody else', async () => {
    const poc = await makePoc(db)
    const asPoc = await admin.send('post', '/api/v1/users', {
      email: newEmail(),
      name: 'Factory Lead',
      role: 'poc',
      pocId: poc.id,
    })
    expect(asPoc.body.user.poc).toEqual({ id: poc.id, value: poc.value })
    const asPlanner = await admin.send('post', '/api/v1/users', {
      email: newEmail(),
      name: 'Planner',
      role: 'planner',
      pocId: poc.id,
    })
    expect(asPlanner.body.user.poc).toBeNull()
  })
  it('answers bad input with field errors', async () => {
    const segment = await db.lookupValue.create({ data: { kind: 'segment', value: unique('Seg') } })
    const cases: [object, Record<string, string>][] = [
      [{ email: 'asha@example', name: 'A', role: 'planner' }, { email: 'Enter a valid email address.' }],
      [{ email: newEmail(), name: '', role: 'planner' }, { name: 'Enter a name.' }],
      [{ email: newEmail(), name: 'A', role: 'owner' }, { role: 'Choose a role.' }],
      [
        { email: newEmail(), name: 'A', role: 'poc' },
        { pocId: 'Choose the point of contact this user owns.' },
      ],
      [
        { email: newEmail(), name: 'A', role: 'poc', pocId: 'abc' },
        { pocId: 'Choose a point of contact from the list.' },
      ],
      [
        { email: newEmail(), name: 'A', role: 'poc', pocId: segment.id },
        { pocId: 'Choose a point of contact from the list.' },
      ],
    ]
    for (const [body, fields] of cases) {
      const res = await admin.send('post', '/api/v1/users', body)
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual(fields)
    }
  })
  it('refuses an email that another user already has, in any case', async () => {
    const existing = await makeUser(db)
    const res = await admin.send('post', '/api/v1/users', {
      email: existing.email.toUpperCase(),
      name: 'Twin',
      role: 'viewer',
    })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ email: 'A user with this email already exists.' })
  })
  it('still creates the user when the email fails, and says so', async () => {
    const quiet = await signIn(testApp(db, { mailer: failingMailer() }), admin.me.user.email)
    const res = await quiet.send('post', '/api/v1/users', {
      email: newEmail(),
      name: 'No Mail',
      role: 'viewer',
    })
    expect(res.status).toBe(201)
    expect(res.body.inviteEmailSent).toBe(false)
  })
})

describe('POST /users/:id/invite', () => {
  it('sends a new link and cancels the old one', async () => {
    const created = await admin.send('post', '/api/v1/users', {
      email: newEmail(),
      name: 'Slow Reader',
      role: 'viewer',
    })
    const first = tokenIn(mailer.sent.at(-1)!.text)!
    const res = await admin.send('post', `/api/v1/users/${created.body.user.id}/invite`)
    expect(res.status).toBe(200)
    expect(res.body.inviteEmailSent).toBe(true)
    const second = tokenIn(mailer.sent.at(-1)!.text)!
    expect(second).not.toBe(first)
    const old = await db.authToken.findUniqueOrThrow({ where: { tokenHash: hashToken(first) } })
    expect(old.usedAt).not.toBeNull()
  })
  it('refuses users who already set a password', async () => {
    const user = await makeUser(db)
    const res = await admin.send('post', `/api/v1/users/${user.id}/invite`)
    expect(res.status).toBe(409)
  })
})

describe('PATCH /users/:id', () => {
  it('renames a user', async () => {
    const user = await makeUser(db)
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { name: 'New Name' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('New Name')
  })
  it('signs a user out everywhere when their role changes', async () => {
    const user = await makeUser(db, { role: 'planner' })
    const theirs = await signIn(app, user.email)
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { role: 'viewer' })
    expect(res.body.role).toBe('viewer')
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
  })
  it('drops the POC link when a POC user gets another role', async () => {
    const poc = await makePoc(db)
    const user = await makeUser(db, { role: 'poc', pocId: poc.id })
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { role: 'planner' })
    expect(res.body.poc).toBeNull()
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).pocId).toBeNull()
  })
  it('disables a user, ending their sessions and sign-ins', async () => {
    const user = await makeUser(db)
    const theirs = await signIn(app, user.email)
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { status: 'disabled' })
    expect(res.body.status).toBe('disabled')
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
    const again = await request(app).post('/api/v1/auth/login').send({ email: user.email, password })
    expect(again.status).toBe(401)
  })
  it("won't activate a user who hasn't accepted their invite", async () => {
    const user = await makeUser(db, { status: 'invited', password: null, name: 'Pending' })
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { status: 'active' })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({
      status: "Pending hasn't accepted their invite yet. Resend the invite instead.",
    })
  })
  it('refuses fields it does not change, such as email', async () => {
    const user = await makeUser(db)
    const res = await admin.send('patch', `/api/v1/users/${user.id}`, { email: 'x@example.com' })
    expect(res.status).toBe(422)
  })
  it('answers 404 for an id that is not a UUID, or no user', async () => {
    for (const id of ['abc', '6f1c2a7e-0b5d-4c1e-9a3f-2d8e4b6c1a90']) {
      const res = await admin.send('patch', `/api/v1/users/${id}`, { name: 'X' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'not_found' })
    }
  })
})

describe('DELETE /users/:id', () => {
  it('soft-deletes the user, ends their sessions and frees the email', async () => {
    const user = await makeUser(db)
    const theirs = await signIn(app, user.email)
    expect((await admin.send('delete', `/api/v1/users/${user.id}`)).status).toBe(204)
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.deletedAt).not.toBeNull()
    expect(row.deletedBy).toBe(admin.me.user.id)
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
    expect((await admin.send('patch', `/api/v1/users/${user.id}`, { name: 'X' })).status).toBe(404)
    const again = await admin.send('post', '/api/v1/users', {
      email: user.email,
      name: 'Returning',
      role: 'viewer',
    })
    expect(again.status).toBe(201)
  })
})

// Each test gets its own database, because these depend on how many admins exist.
describe('the last active admin', () => {
  let fresh: Awaited<ReturnType<typeof createTestDatabase>>
  afterEach(() => fresh.close())
  async function world() {
    fresh = await createTestDatabase()
    const freshApp = testApp(fresh.db)
    const only = await makeUser(fresh.db, { role: 'admin', name: 'Only Admin' })
    return { db: fresh.db, app: freshApp, only, session: await signIn(freshApp, only.email) }
  }

  it('cannot be demoted, disabled or deleted', async () => {
    const { only, session } = await world()
    for (const [method, body] of [
      ['patch', { role: 'planner' }],
      ['patch', { status: 'disabled' }],
      ['delete', undefined],
    ] as const) {
      const res = await session.send(method, `/api/v1/users/${only.id}`, body)
      expect(res.status).toBe(409)
      expect(res.body.message).toMatch(/Only Admin is the last active admin/)
    }
  })
  it('does not count invited or disabled admins as another admin', async () => {
    const { db: d, only, session } = await world()
    await makeUser(d, { role: 'admin', status: 'invited', password: null })
    await makeUser(d, { role: 'admin', status: 'disabled' })
    const res = await session.send('patch', `/api/v1/users/${only.id}`, { role: 'planner' })
    expect(res.status).toBe(409)
  })
  it('can step down once another admin is active', async () => {
    const { db: d, only, session } = await world()
    await makeUser(d, { role: 'admin' })
    const res = await session.send('patch', `/api/v1/users/${only.id}`, { role: 'planner' })
    expect(res.status).toBe(200)
  })
  it('survives two admins demoting each other at the same moment', async () => {
    const { db: d, only } = await world()
    const second = await makeUser(d, { role: 'admin' })
    const results = await Promise.allSettled([
      updateUser(d, only.id, { role: 'planner' }),
      updateUser(d, second.id, { role: 'planner' }),
    ])
    const refused = results.filter((r) => r.status === 'rejected')
    expect(refused).toHaveLength(1)
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError)
    expect(
      await d.user.count({ where: { role: 'admin', status: 'active', deletedAt: null } }),
    ).toBe(1)
  })
})
```

- [ ] **Step 5: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/users.int.test.ts`
Expected: FAIL. `users.service.ts` doesn't exist.

- [ ] **Step 6: Implement emailed tokens and email text**

Create `apps/api/src/modules/auth/auth-tokens.ts`:

```ts
import { ValidationError } from '@boat/domain/validation'
import type { Db } from '../../core/prisma'
import type { TokenPurpose } from '../../generated/prisma/client'
import { hashToken, newToken } from './tokens'

const lifetimeMs: Record<TokenPurpose, number> = {
  invite: 72 * 60 * 60_000,
  password_reset: 60 * 60_000,
}
const unusable: Record<TokenPurpose, string> = {
  invite: 'This invite link has expired or was already used. Ask an admin to send a new one.',
  password_reset: 'This reset link has expired or was already used. Request a new one.',
}

// Issues a single-use token for an emailed link. Earlier unused tokens for the same purpose stop
// working, so only the newest email's link is valid.
export async function issueToken(db: Db, userId: string, purpose: TokenPurpose) {
  const now = new Date()
  await db.authToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: now },
  })
  const token = newToken()
  await db.authToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + lifetimeMs[purpose]),
    },
  })
  return token
}

// Marks the token used and returns its user's id. Call it inside the transaction that acts on the
// token. The conditional update means two requests racing with one link cannot both succeed.
export async function consumeToken(db: Db, token: string, purpose: TokenPurpose) {
  const now = new Date()
  const found = await db.authToken.findFirst({
    where: { tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true },
  })
  const { count } = found
    ? await db.authToken.updateMany({
        where: { id: found.id, usedAt: null },
        data: { usedAt: now },
      })
    : { count: 0 }
  if (!found || count !== 1) throw new ValidationError({ token: unusable[purpose] })
  return found.userId
}
```

Create `apps/api/src/modules/auth/emails.ts`:

```ts
// The token rides in the URL fragment, which browsers never send to a server or in a Referer
// header, so it stays out of access logs. Phase 5 builds the /invite and /reset-password pages.
export const linkFor = (appUrl: string, page: 'invite' | 'reset-password', token: string) =>
  `${appUrl.replace(/\/$/, '')}/${page}#token=${token}`

export const inviteEmail = (appUrl: string, name: string, token: string) => ({
  subject: "You're invited to BOAT Supply Chain",
  text: [
    `Hi ${name},`,
    'An admin has invited you to BOAT Supply Chain. Choose your password within 72 hours:',
    linkFor(appUrl, 'invite', token),
    "If you weren't expecting this, you can ignore this email.",
  ].join('\n\n'),
})

export const resetEmail = (appUrl: string, name: string, token: string) => ({
  subject: 'Reset your BOAT Supply Chain password',
  text: [
    `Hi ${name},`,
    'Use this link within 1 hour to choose a new password:',
    linkFor(appUrl, 'reset-password', token),
    "If you didn't ask for this, ignore this email. Your password stays the same.",
  ].join('\n\n'),
})
```

- [ ] **Step 7: Implement the users service**

Create `apps/api/src/modules/users/users.service.ts`:

```ts
import type { Role } from '@boat/domain/models'
import {
  assertValid,
  normalizeEmail,
  validateAccount,
  ValidationError,
} from '@boat/domain/validation'
import type { Logger } from 'pino'
import { ConflictError, NotFoundError } from '../../core/errors'
import { type Mailer, sendOrLog } from '../../core/mailer'
import { type Page, pageArgs, pageOf } from '../../core/pagination'
import type { Db } from '../../core/prisma'
import { Prisma, type PrismaClient } from '../../generated/prisma/client'
import { issueToken } from '../auth/auth-tokens'
import { inviteEmail, linkFor } from '../auth/emails'
import { revokeUserSessions } from '../auth/sessions'

export type UsersDeps = { db: PrismaClient; mailer: Mailer; appUrl: string }

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  poc: { select: { id: true, value: true } },
} satisfies Prisma.UserSelect
export type UserView = Prisma.UserGetPayload<{ select: typeof userSelect }>

export type NewUser = { email: string; name: string; role: Role; pocId: string | null }
export type UserPatch = {
  name?: string
  role?: Role
  pocId?: string | null
  status?: 'active' | 'disabled'
}

const pickPoc = 'Choose a point of contact from the list.'

export async function listUsers(db: PrismaClient, page: Page) {
  const where = { deletedAt: null }
  const [items, total] = await Promise.all([
    db.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      ...pageArgs(page),
    }),
    db.user.count({ where }),
  ])
  return pageOf(items, total, page)
}

async function assertPoc(db: Db, pocId: string | null) {
  if (!pocId) return
  const poc = await db.lookupValue.findFirst({
    where: { id: pocId, kind: 'poc', deletedAt: null },
    select: { id: true },
  })
  if (!poc) throw new ValidationError({ pocId: pickPoc })
}

// The partial unique index on email catches duplicates, including two admins adding one person
// at the same moment.
function rethrowDuplicateEmail(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    throw new ValidationError({ email: 'A user with this email already exists.' })
  throw err
}

// Locks every active admin row, then checks that someone other than userId stays an active
// admin. A second transaction doing the same waits for the first and then sees its result.
async function assertAnotherActiveAdmin(db: Db, userId: string, message: string) {
  const admins = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM users
    WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL
    FOR UPDATE`
  if (!admins.some((a) => a.id !== userId)) throw new ConflictError(message)
}

async function sendInvite(deps: UsersDeps, user: UserView, token: string, log: Logger) {
  const inviteEmailSent = await sendOrLog(deps.mailer, log, {
    to: user.email,
    ...inviteEmail(deps.appUrl, user.name, token),
  })
  return { user, inviteEmailSent, inviteUrl: linkFor(deps.appUrl, 'invite', token) }
}

export async function createUser(deps: UsersDeps, input: NewUser, log: Logger) {
  const account = {
    email: normalizeEmail(input.email),
    name: input.name.trim(),
    role: input.role,
    pocId: input.role === 'poc' ? input.pocId : null,
  }
  assertValid(validateAccount(account))
  await assertPoc(deps.db, account.pocId)
  const { user, token } = await deps.db.$transaction(async (tx) => {
    const user = await tx.user
      .create({ data: { ...account, status: 'invited' }, select: userSelect })
      .catch(rethrowDuplicateEmail)
    return { user, token: await issueToken(tx, user.id, 'invite') }
  })
  return sendInvite(deps, user, token, log)
}

// For an invite that expired or went astray. Allowed until the user sets a password; it also
// brings a disabled, never-signed-in user back to "invited".
export async function resendInvite(deps: UsersDeps, id: string, log: Logger) {
  const { user, token } = await deps.db.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: { name: true, passwordHash: true },
    })
    if (!current) throw new NotFoundError()
    if (current.passwordHash)
      throw new ConflictError(`${current.name} has already set a password.`)
    const user = await tx.user.update({
      where: { id },
      data: { status: 'invited' },
      select: userSelect,
    })
    return { user, token: await issueToken(tx, id, 'invite') }
  })
  return sendInvite(deps, user, token, log)
}

export async function updateUser(db: PrismaClient, id: string, patch: UserPatch) {
  return db.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: { email: true, name: true, role: true, status: true, pocId: true, passwordHash: true },
    })
    if (!current) throw new NotFoundError()
    const role = patch.role ?? current.role
    const next = {
      email: current.email,
      name: (patch.name ?? current.name).trim(),
      role,
      pocId: role === 'poc' ? (patch.pocId === undefined ? current.pocId : patch.pocId) : null,
    }
    assertValid(validateAccount(next))
    if (patch.status === 'active' && !current.passwordHash)
      throw new ValidationError({
        status: `${current.name} hasn't accepted their invite yet. Resend the invite instead.`,
      })
    const status = patch.status ?? current.status
    if (next.pocId !== current.pocId) await assertPoc(tx, next.pocId)
    if (current.role === 'admin' && current.status === 'active' && (role !== 'admin' || status !== 'active'))
      await assertAnotherActiveAdmin(
        tx,
        id,
        `${current.name} is the last active admin. Make someone else an admin first.`,
      )
    const user = await tx.user.update({
      where: { id },
      data: { name: next.name, role, pocId: next.pocId, status },
      select: userSelect,
    })
    // PRD: a role change revokes the user's sessions. Disabling must end them too.
    if (role !== current.role || status !== current.status) await revokeUserSessions(tx, id)
    return user
  })
}

export async function deleteUser(db: PrismaClient, actorId: string, id: string) {
  await db.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: { name: true, role: true, status: true },
    })
    if (!current) throw new NotFoundError()
    if (current.role === 'admin' && current.status === 'active')
      await assertAnotherActiveAdmin(
        tx,
        id,
        `${current.name} is the last active admin. Make someone else an admin first.`,
      )
    const now = new Date()
    await tx.user.update({ where: { id }, data: { deletedAt: now, deletedBy: actorId } })
    await revokeUserSessions(tx, id)
    await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: now } })
  })
}
```

- [ ] **Step 8: Implement the users router and mount it**

Create `apps/api/src/modules/users/users.router.ts`:

```ts
import type { Role } from '@boat/domain/models'
import { roles } from '@boat/domain/permissions'
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission } from '../../core/access'
import { pageQuery } from '../../core/pagination'
import { parseId, parseInput } from '../../core/parse'
import {
  createUser,
  deleteUser,
  listUsers,
  resendInvite,
  updateUser,
  type UsersDeps,
} from './users.service'

// Shape only. The rules (email format, name length, POC for POC users) run in the service
// through validateAccount, so the browser and the server share one set of messages.
const role = z.enum(roles as [Role, ...Role[]], { error: 'Choose a role.' })
const pocId = z.guid({ error: 'Choose a point of contact from the list.' }).nullable()
const createBody = z.object({
  email: z.string({ error: 'Enter an email address.' }),
  name: z.string({ error: 'Enter a name.' }),
  role,
  pocId: pocId.default(null),
})
// Email cannot be changed. Unknown keys are refused rather than silently ignored.
const patchBody = z.strictObject({
  name: z.string({ error: 'Enter a name.' }).optional(),
  role: role.optional(),
  pocId: pocId.optional(),
  status: z.enum(['active', 'disabled'], { error: 'Choose active or disabled.' }).optional(),
})

export function usersRouter(deps: UsersDeps) {
  const router = Router()

  router.get('/', requirePermission('manageSettings'), async (req, res) => {
    res.json(await listUsers(deps.db, parseInput(pageQuery, req.query)))
  })

  router.post('/', requirePermission('manageSettings'), async (req, res) => {
    const { user, inviteEmailSent } = await createUser(deps, parseInput(createBody, req.body), req.log)
    res.status(201).json({ user, inviteEmailSent })
  })

  router.post('/:id/invite', requirePermission('manageSettings'), async (req, res) => {
    const { user, inviteEmailSent } = await resendInvite(deps, parseId(req.params.id), req.log)
    res.json({ user, inviteEmailSent })
  })

  router.patch('/:id', requirePermission('manageSettings'), async (req, res) => {
    res.json(await updateUser(deps.db, parseId(req.params.id), parseInput(patchBody, req.body)))
  })

  router.delete('/:id', requirePermission('manageSettings'), async (req, res) => {
    await deleteUser(deps.db, authOf(req).user.id, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
```

In `apps/api/src/api.ts`, import `usersRouter` from `./modules/users/users.router` and mount it after `/auth`:

```ts
  mount(api, '/users', usersRouter(deps))
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /users manageSettings',
        'POST /users manageSettings',
        'POST /users/:id/invite manageSettings',
        'PATCH /users/:id manageSettings',
        'DELETE /users/:id manageSettings',
```

- [ ] **Step 9: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 10: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add user management with invites and last-admin protection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Accepting invites, password reset and changing your own password

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.router.ts`, `apps/api/src/modules/auth/rate-limit.ts`
- Modify: `apps/api/src/api.test.ts` (table)
- Test: `apps/api/test/invites-and-passwords.int.test.ts`

**Interfaces:**
- Consumes: from Task 6, `issueToken`, `consumeToken`, `resetEmail`, `sendOrLog` and `Mailer`; from Task 4, `createSession`, `revokeUserSessions`, `hashPassword` and `verifyPassword`; from Task 1, `validatePassword` and `normalizeEmail`.
- Produces:
  - `acceptInvite(db, token, password, userAgent?): Promise<{ token; id; userId }>`
  - `requestPasswordReset({ db, mailer, appUrl }, email, log): Promise<void>`
  - `resetPassword(db, token, password): Promise<void>`
  - `changePassword(db, userId, current, next, userAgent?): Promise<{ token; id; userId }>`
  - `requestLimiters(): RequestHandler[]` (counts every request) and `ipFailureLimiter(): RequestHandler`
  - `AuthRouterDeps` gains `mailer: Mailer` and `appUrl: string`
  - Routes: `POST /auth/invites/accept` (public) → 200 `MePayload` plus cookie; `POST /auth/password/forgot` (public) → 202; `POST /auth/password/reset` (public) → 204; `PATCH /auth/me/password` (signedIn) → 200 `MePayload` plus a new cookie

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/invites-and-passwords.int.test.ts`:

```ts
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { memoryMailer } from '../src/core/mailer'
import type { PrismaClient } from '../src/generated/prisma/client'
import { issueToken } from '../src/modules/auth/auth-tokens'
import { hashToken } from '../src/modules/auth/tokens'
import { createTestDatabase } from './support/db'
import { makeUser, password, signIn, testApp } from './support/fixtures'

let db: PrismaClient
let close: () => Promise<void>
let mailer: ReturnType<typeof memoryMailer>
let app: ReturnType<typeof testApp>

beforeAll(async () => {
  ;({ db, close } = await createTestDatabase())
  mailer = memoryMailer()
  app = testApp(db, { mailer })
})
afterAll(() => close())

const newPassword = 'a brand new passphrase'
const tokenIn = (text: string) => /#token=([\w-]+)/.exec(text)![1]
const post = (url: string, body: object) => request(app).post(`/api/v1${url}`).send(body)
const accept = (token: string, pw = newPassword) =>
  post('/auth/invites/accept', { token, password: pw })
const expiredInvite =
  'This invite link has expired or was already used. Ask an admin to send a new one.'
const expiredReset = 'This reset link has expired or was already used. Request a new one.'

async function invited() {
  const user = await makeUser(db, { status: 'invited', password: null })
  return { user, token: await issueToken(db, user.id, 'invite') }
}

describe('POST /auth/invites/accept', () => {
  it('sets the password, activates the user and signs them in', async () => {
    const { user, token } = await invited()
    const agent = request.agent(app)
    const res = await agent.post('/api/v1/auth/invites/accept').send({ token, password: newPassword })
    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe(user.id)
    expect(String(res.headers['set-cookie'])).toMatch(/^boat_session=/)
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200)
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('active')
    expect((await post('/auth/login', { email: user.email, password: newPassword })).status).toBe(200)
  })
  it('keeps the link usable when the password is too short', async () => {
    const { token } = await invited()
    const res = await accept(token, 'short')
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ password: 'Use at least 12 characters.' })
    expect((await accept(token)).status).toBe(200)
  })
  it('works once', async () => {
    const { token } = await invited()
    expect((await accept(token)).status).toBe(200)
    const again = await accept(token)
    expect(again.status).toBe(422)
    expect(again.body.fields).toEqual({ token: expiredInvite })
  })
  it('lets only one of two simultaneous uses through', async () => {
    const { token } = await invited()
    const statuses = (await Promise.all([accept(token), accept(token)])).map((r) => r.status)
    expect(statuses.sort()).toEqual([200, 422])
  })
  it('refuses an expired link, a reset link, and a link for a deleted user', async () => {
    const expired = await invited()
    await db.authToken.update({
      where: { tokenHash: hashToken(expired.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const reset = await makeUser(db)
    const resetToken = await issueToken(db, reset.id, 'password_reset')
    const deleted = await invited()
    await db.user.update({ where: { id: deleted.user.id }, data: { deletedAt: new Date() } })
    for (const token of [expired.token, resetToken, deleted.token, 'made-up']) {
      const res = await accept(token)
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual({ token: expiredInvite })
    }
  })
})

describe('POST /auth/password/forgot', () => {
  const reply = {
    message: 'If that email belongs to an active account, a reset link is on its way.',
  }
  it('emails an active user a 1-hour reset link', async () => {
    const user = await makeUser(db)
    const before = mailer.sent.length
    const res = await post('/auth/password/forgot', { email: user.email.toUpperCase() })
    expect(res.status).toBe(202)
    expect(res.body).toEqual(reply)
    await vi.waitFor(() => expect(mailer.sent.length).toBe(before + 1))
    const sent = mailer.sent.at(-1)!
    expect(sent.to).toBe(user.email)
    expect(sent.text).toContain('http://localhost:5173/reset-password#token=')
    const token = await db.authToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(tokenIn(sent.text)) },
    })
    const minutes = (token.expiresAt.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(59)
    expect(minutes).toBeLessThanOrEqual(60)
  })
  it('gives the same answer, and sends nothing, for unknown, invited and disabled users', async () => {
    const invitedUser = await makeUser(db, { status: 'invited', password: null })
    const disabled = await makeUser(db, { status: 'disabled' })
    const before = mailer.sent.length
    for (const email of ['nobody@example.com', invitedUser.email, disabled.email]) {
      const res = await post('/auth/password/forgot', { email })
      expect(res.status).toBe(202)
      expect(res.body).toEqual(reply)
    }
    await new Promise((r) => setTimeout(r, 200))
    expect(mailer.sent.length).toBe(before)
  })
  it('stops after 5 requests from one address in 15 minutes', async () => {
    const limited = testApp(db, { mailer: memoryMailer() })
    const ask = () =>
      request(limited).post('/api/v1/auth/password/forgot').send({ email: 'x@example.com' })
    for (let i = 0; i < 5; i++) expect((await ask()).status).toBe(202)
    expect((await ask()).status).toBe(429)
  })
})

describe('POST /auth/password/reset', () => {
  it('sets the new password and signs the user out everywhere', async () => {
    const user = await makeUser(db)
    const theirs = await signIn(app, user.email)
    const token = await issueToken(db, user.id, 'password_reset')
    expect((await post('/auth/password/reset', { token, password: newPassword })).status).toBe(204)
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
    expect((await post('/auth/login', { email: user.email, password })).status).toBe(401)
    expect((await post('/auth/login', { email: user.email, password: newPassword })).status).toBe(200)
  })
  it('works once and refuses expired links, invite links and disabled users', async () => {
    const user = await makeUser(db)
    const used = await issueToken(db, user.id, 'password_reset')
    await post('/auth/password/reset', { token: used, password: newPassword })
    const expiredUser = await makeUser(db)
    const expired = await issueToken(db, expiredUser.id, 'password_reset')
    await db.authToken.update({
      where: { tokenHash: hashToken(expired) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const { token: inviteToken } = await invited()
    const disabled = await makeUser(db)
    const disabledToken = await issueToken(db, disabled.id, 'password_reset')
    await db.user.update({ where: { id: disabled.id }, data: { status: 'disabled' } })
    for (const token of [used, expired, inviteToken, disabledToken]) {
      const res = await post('/auth/password/reset', { token, password: newPassword })
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual({ token: expiredReset })
    }
  })
  it('refuses a short password without using up the link', async () => {
    const user = await makeUser(db)
    const token = await issueToken(db, user.id, 'password_reset')
    const res = await post('/auth/password/reset', { token, password: 'short' })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ password: 'Use at least 12 characters.' })
    expect((await post('/auth/password/reset', { token, password: newPassword })).status).toBe(204)
  })
})

describe('PATCH /auth/me/password', () => {
  it('needs the current password', async () => {
    const user = await makeUser(db)
    const { send } = await signIn(app, user.email)
    const res = await send('patch', '/api/v1/auth/me/password', {
      currentPassword: 'not my password',
      newPassword,
    })
    expect(res.status).toBe(422)
    expect(res.body.fields).toEqual({ currentPassword: 'That is not your current password.' })
  })
  it('checks the new password', async () => {
    const user = await makeUser(db)
    const { send } = await signIn(app, user.email)
    for (const [next, message] of [
      ['short', 'Use at least 12 characters.'],
      [password, 'Choose a password different from your current one.'],
    ]) {
      const res = await send('patch', '/api/v1/auth/me/password', {
        currentPassword: password,
        newPassword: next,
      })
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual({ newPassword: message })
    }
  })
  it('ends every other session and moves this one to a new session', async () => {
    const user = await makeUser(db)
    const other = await signIn(app, user.email)
    const here = await signIn(app, user.email)
    const res = await here.send('patch', '/api/v1/auth/me/password', {
      currentPassword: password,
      newPassword,
    })
    expect(res.status).toBe(200)
    expect(res.body.csrfToken).not.toBe(here.csrf)
    expect((await other.agent.get('/api/v1/auth/me')).status).toBe(401)
    expect((await here.agent.get('/api/v1/auth/me')).status).toBe(200)
    // The old CSRF token belonged to the old session.
    const stale = await here.agent.post('/api/v1/auth/logout').set('x-csrf-token', here.csrf)
    expect(stale.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/invites-and-passwords.int.test.ts`
Expected: FAIL. The routes answer the JSON 404.

- [ ] **Step 3: Add the limiters**

Append to `apps/api/src/modules/auth/rate-limit.ts`:

```ts
// Forgot-password always succeeds, so every request counts: 5 per 15 minutes per IP and per
// email, which stops anyone flooding an inbox with reset emails.
export const requestLimiters = () => [
  limiter({ countSuccess: true }),
  limiter({ countSuccess: true, key: byEmail }),
]

// Changing a password needs a session, but a stolen session must not be able to guess the
// current password at full speed.
export const ipFailureLimiter = () => limiter({ countSuccess: false })
```

- [ ] **Step 4: Implement the service functions**

In `apps/api/src/modules/auth/auth.service.ts`, add these imports:

```ts
import { assertValid, validatePassword, ValidationError } from '@boat/domain/validation'
import type { Logger } from 'pino'
import { type Mailer, sendOrLog } from '../../core/mailer'
import { consumeToken, issueToken } from './auth-tokens'
import { resetEmail } from './emails'
import { hashPassword } from './password'
import { revokeUserSessions } from './sessions'
```

`normalizeEmail` is already imported from `@boat/domain/validation`, so merge the two imports. Add `revokeUserSessions` to the existing `./sessions` import. Then append:

```ts
const expiredInvite =
  'This invite link has expired or was already used. Ask an admin to send a new one.'
const expiredReset = 'This reset link has expired or was already used. Request a new one.'

// The password is checked and hashed before the transaction: a short password leaves the link
// usable, and the slow hash doesn't hold row locks.
export async function acceptInvite(
  db: PrismaClient,
  token: string,
  password: string,
  userAgent?: string,
) {
  assertValid(validatePassword(password))
  const passwordHash = await hashPassword(password)
  return db.$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, 'invite')
    const { count } = await tx.user.updateMany({
      where: { id: userId, status: 'invited', deletedAt: null },
      data: { passwordHash, status: 'active', lastLoginAt: new Date() },
    })
    if (count !== 1) throw new ValidationError({ token: expiredInvite })
    return createSession(tx, userId, userAgent)
  })
}

// Sends a reset link to an active user. The caller answers the same way whatever happens here,
// so the reply never reveals whether an account exists.
export async function requestPasswordReset(
  deps: { db: PrismaClient; mailer: Mailer; appUrl: string },
  email: string,
  log: Logger,
) {
  const user = await deps.db.user.findFirst({
    where: { email: normalizeEmail(email), status: 'active', deletedAt: null },
    select: { id: true, name: true, email: true },
  })
  if (!user) return
  const token = await issueToken(deps.db, user.id, 'password_reset')
  await sendOrLog(deps.mailer, log, { to: user.email, ...resetEmail(deps.appUrl, user.name, token) })
}

export async function resetPassword(db: PrismaClient, token: string, password: string) {
  assertValid(validatePassword(password))
  const passwordHash = await hashPassword(password)
  await db.$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, 'password_reset')
    const { count } = await tx.user.updateMany({
      where: { id: userId, status: 'active', deletedAt: null },
      data: { passwordHash },
    })
    if (count !== 1) throw new ValidationError({ token: expiredReset })
    await revokeUserSessions(tx, userId)
    await tx.authToken.updateMany({
      where: { userId, purpose: 'password_reset', usedAt: null },
      data: { usedAt: new Date() },
    })
  })
}

// PRD: changing a password revokes all of the user's sessions. The request that made the change
// moves to a fresh session so the person stays signed in here.
export async function changePassword(
  db: PrismaClient,
  userId: string,
  current: string,
  next: string,
  userAgent?: string,
) {
  const { passwordHash } = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  })
  if (!(await verifyPassword(passwordHash, current)))
    throw new ValidationError({ currentPassword: 'That is not your current password.' })
  assertValid(validatePassword(next, 'newPassword'))
  if (next === current)
    throw new ValidationError({ newPassword: 'Choose a password different from your current one.' })
  const newHash = await hashPassword(next)
  return db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: newHash } })
    await revokeUserSessions(tx, userId)
    return createSession(tx, userId, userAgent)
  })
}
```

Also add `import type { PrismaClient } from '../../generated/prisma/client'` at the top of the file.

- [ ] **Step 5: Add the routes**

In `apps/api/src/modules/auth/auth.router.ts`, extend the imports:

```ts
import type { Mailer } from '../../core/mailer'
import {
  acceptInvite,
  changePassword,
  mePayload,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
} from './auth.service'
import { failedAttemptLimiters, ipFailureLimiter, requestLimiters } from './rate-limit'
```

Add the two fields to `AuthRouterDeps`:

```ts
  mailer: Mailer
  appUrl: string
```

Add these schemas below `loginBody`:

```ts
const acceptBody = z.object({
  token: z.string({ error: 'This link is incomplete. Open it again from the email.' }),
  password: z.string({ error: 'Choose a password.' }),
})
const forgotBody = z.object({ email: z.string({ error: 'Enter your email address.' }) })
const changeBody = z.object({
  currentPassword: z.string({ error: 'Enter your current password.' }),
  newPassword: z.string({ error: 'Choose a new password.' }),
})
```

And these routes before `return router`:

```ts
  router.post('/invites/accept', publicRoute(), async (req, res) => {
    const { token, password } = parseInput(acceptBody, req.body)
    await startSession(res, await acceptInvite(deps.db, token, password, req.get('user-agent')))
  })

  router.post('/password/forgot', publicRoute(), ...requestLimiters(), (req, res) => {
    const { email } = parseInput(forgotBody, req.body)
    // Answered before the lookup finishes, so response time doesn't reveal whether the account
    // exists. A failure is logged instead.
    requestPasswordReset(deps, email, req.log).catch((err: unknown) =>
      req.log.error({ err }, 'password reset request failed'),
    )
    res.status(202).json({
      message: 'If that email belongs to an active account, a reset link is on its way.',
    })
  })

  router.post('/password/reset', publicRoute(), async (req, res) => {
    const { token, password } = parseInput(acceptBody, req.body)
    await resetPassword(deps.db, token, password)
    res.status(204).end()
  })

  router.patch('/me/password', requireSignedIn(), ipFailureLimiter(), async (req, res) => {
    const { currentPassword, newPassword } = parseInput(changeBody, req.body)
    const session = await changePassword(
      deps.db,
      authOf(req).user.id,
      currentPassword,
      newPassword,
      req.get('user-agent'),
    )
    await startSession(res, session)
  })
```

`authRouter({ ...deps, settings })` in `api.ts` already passes `mailer` and `appUrl`, because they are in `ApiDeps`.

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'POST /auth/invites/accept public',
        'POST /auth/password/forgot public',
        'POST /auth/password/reset public',
        'PATCH /auth/me/password signedIn',
```

- [ ] **Step 6: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 7: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add invite acceptance, password reset and password change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Settings: time zone and idle timeout

**Files:**
- Modify: `apps/api/src/modules/settings/settings.service.ts` (`update`)
- Create: `apps/api/src/modules/settings/settings.router.ts`
- Modify: `apps/api/src/api.ts` (mount `/settings`), `apps/api/src/api.test.ts` (table)
- Test: `apps/api/test/settings.int.test.ts`

**Interfaces:**
- Consumes: from Task 4, `createSettingsService`, `Settings` and `defaultSettings`; from Task 3, `requireSignedIn`, `requirePermission` and `authOf`; from Task 2, `parseInput`.
- Produces:
  - `SettingsService.update(patch: Partial<Settings>, actorId: string): Promise<Settings>`
  - `settingsRouter(settings: SettingsService): Router`
  - Routes: `GET /settings` (signedIn) → `Settings`; `PATCH /settings` (`manageSettings`) → `Settings`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/settings.int.test.ts`:

```ts
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../src/generated/prisma/client'
import { createTestDatabase } from './support/db'
import { makeUser, signIn, testApp } from './support/fixtures'

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

describe('GET /settings', () => {
  it('gives every signed-in role the defaults', async () => {
    const viewer = await signIn(app, (await makeUser(db, { role: 'viewer' })).email)
    const res = await viewer.agent.get('/api/v1/settings')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ timeZone: 'Asia/Kolkata', idleTimeoutMinutes: 15 })
  })
  it('answers 401 when signed out', async () => {
    expect((await request(app).get('/api/v1/settings')).status).toBe(401)
  })
})

describe('PATCH /settings', () => {
  it('saves a change for admins, recording who made it', async () => {
    const res = await admin.send('patch', '/api/v1/settings', { timeZone: 'Asia/Dubai' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ timeZone: 'Asia/Dubai', idleTimeoutMinutes: 15 })
    const row = await db.appSetting.findUniqueOrThrow({ where: { key: 'timeZone' } })
    expect(row).toMatchObject({ value: 'Asia/Dubai', updatedBy: admin.me.user.id })
    // A new app instance has an empty cache, so this read comes from the database.
    const fresh = await signIn(testApp(db), admin.me.user.email)
    expect((await fresh.agent.get('/api/v1/settings')).body.timeZone).toBe('Asia/Dubai')
    await admin.send('patch', '/api/v1/settings', { timeZone: 'Asia/Kolkata' })
  })
  it('refuses planners and viewers', async () => {
    for (const role of ['planner', 'viewer'] as const) {
      const user = await signIn(app, (await makeUser(db, { role })).email)
      const res = await user.send('patch', '/api/v1/settings', { idleTimeoutMinutes: 30 })
      expect(res.status).toBe(403)
    }
  })
  it('needs the CSRF token', async () => {
    const res = await admin.agent.patch('/api/v1/settings').send({ idleTimeoutMinutes: 30 })
    expect(res.status).toBe(403)
  })
  it('answers bad values with field errors', async () => {
    const cases: [object, string][] = [
      [{ timeZone: 'Mars/Olympus' }, 'timeZone'],
      [{ timeZone: 42 }, 'timeZone'],
      [{ idleTimeoutMinutes: 4 }, 'idleTimeoutMinutes'],
      [{ idleTimeoutMinutes: 721 }, 'idleTimeoutMinutes'],
      [{ idleTimeoutMinutes: 7.5 }, 'idleTimeoutMinutes'],
      [{ idleTimeoutMinutes: '30' }, 'idleTimeoutMinutes'],
      [{ theme: 'dark' }, 'form'],
    ]
    for (const [body, field] of cases) {
      const res = await admin.send('patch', '/api/v1/settings', body)
      expect(res.status).toBe(422)
      expect(Object.keys(res.body.fields)).toEqual([field])
    }
  })
  it('applies a new idle timeout to existing sessions at once', async () => {
    const user = await makeUser(db, { role: 'viewer' })
    const theirs = await signIn(app, user.email)
    await db.session.updateMany({
      where: { userId: user.id },
      data: { lastSeenAt: new Date(Date.now() - 6 * 60_000) },
    })
    expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(200)
    await admin.send('patch', '/api/v1/settings', { idleTimeoutMinutes: 5 })
    try {
      await db.session.updateMany({
        where: { userId: user.id },
        data: { lastSeenAt: new Date(Date.now() - 6 * 60_000) },
      })
      expect((await theirs.agent.get('/api/v1/auth/me')).status).toBe(401)
    } finally {
      await admin.send('patch', '/api/v1/settings', { idleTimeoutMinutes: 15 })
    }
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/settings.int.test.ts`
Expected: FAIL. `/api/v1/settings` answers the JSON 404.

- [ ] **Step 3: Add `update` to the service**

In `apps/api/src/modules/settings/settings.service.ts`, add `update` inside `createSettingsService`, below `get`, and return both:

```ts
  async function update(patch: Partial<Settings>, actorId: string) {
    const changed = Object.entries(patch).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    )
    await db.$transaction(
      changed.map(([key, value]) =>
        db.appSetting.upsert({
          where: { key },
          create: { key, value, updatedBy: actorId },
          update: { value, updatedBy: actorId },
        }),
      ),
    )
    cached = undefined
    return get()
  }

  return { get, update }
```

- [ ] **Step 4: Add the router and mount it**

Create `apps/api/src/modules/settings/settings.router.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission, requireSignedIn } from '../../core/access'
import { parseInput } from '../../core/parse'
import type { SettingsService } from './settings.service'

// Any IANA name the runtime knows ("Asia/Kolkata", "UTC"). Intl refuses unknown zones, and it is
// what today() uses, so whatever passes here works there.
const knownTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Sessions also end 12 hours after sign-in, so a longer idle timeout would have no effect.
const patchBody = z.strictObject({
  timeZone: z
    .string({ error: 'Choose a time zone from the list.' })
    .refine(knownTimeZone, { error: 'Choose a time zone from the list.' })
    .optional(),
  idleTimeoutMinutes: z
    .number({ error: 'Enter a number of minutes.' })
    .int({ error: 'Enter whole minutes.' })
    .min(5, { error: 'Use 5 minutes or more.' })
    .max(720, { error: 'Use 720 minutes (12 hours) or fewer.' })
    .optional(),
})

export function settingsRouter(settings: SettingsService) {
  const router = Router()

  router.get('/', requireSignedIn(), async (_req, res) => {
    res.json(await settings.get())
  })

  router.patch('/', requirePermission('manageSettings'), async (req, res) => {
    res.json(await settings.update(parseInput(patchBody, req.body), authOf(req).user.id))
  })

  return router
}
```

In `apps/api/src/api.ts`, import `settingsRouter` from `./modules/settings/settings.router`, and mount it after `/users`. Pass the same `settings` instance that `loadSession` uses, so a change resets the cache that sessions read:

```ts
  mount(api, '/settings', settingsRouter(settings))
```

In `apps/api/src/api.test.ts`, add these rows to the table:

```ts
        'GET /settings signedIn',
        'PATCH /settings manageSettings',
```

- [ ] **Step 5: Run every test**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS.

- [ ] **Step 6: Format, typecheck and commit**

```bash
pnpm format && pnpm typecheck
git add -A
git commit -m "Add time zone and idle timeout settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The `create-admin` command, docs and the pull request

A new deployment has no one who can sign in. The command invites the first admin, emails the link when Resend is configured, and always prints it.

**Files:**
- Modify: `apps/api/src/modules/users/users.service.ts` (`inviteFirstAdmin`)
- Create: `apps/api/src/cli/create-admin.ts`
- Modify: `apps/api/tsup.config.ts`, `apps/api/package.json`, `package.json` (root `api` script)
- Modify: `README.md`, `AGENTS.md`
- Test: `apps/api/test/create-admin.int.test.ts`

**Interfaces:**
- Consumes: `createUser`, `resendInvite` and `UsersDeps` from Task 6; `createMailer` from Task 6; `createLogger` and `loadConfig` from Task 2; `createPrisma` from Phase 1.
- Produces:
  - `inviteFirstAdmin(deps: UsersDeps, input: { email: string; name: string }, log: Logger): Promise<{ user: UserView; inviteEmailSent: boolean; inviteUrl: string }>`
  - `pnpm api create-admin --email <address> --name <name>` (development) and `node apps/api/dist/create-admin.js --email … --name …` (production)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/create-admin.int.test.ts`:

```ts
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConflictError } from '../src/core/errors'
import { memoryMailer } from '../src/core/mailer'
import type { PrismaClient } from '../src/generated/prisma/client'
import { hashToken } from '../src/modules/auth/tokens'
import { inviteFirstAdmin } from '../src/modules/users/users.service'
import { createTestDatabase } from './support/db'
import { makeUser } from './support/fixtures'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const log = pino({ level: 'silent' })
let db: PrismaClient
let url: string
let close: () => Promise<void>
beforeAll(async () => {
  ;({ db, url, close } = await createTestDatabase())
})
afterAll(() => close())

const deps = () => ({ db, mailer: memoryMailer(), appUrl: 'https://boat.example.com' })
const tokenIn = (link: string) => /#token=([\w-]+)/.exec(link)![1]

// These run in order on one database: no admin, a pending admin, then an active one.
describe('inviteFirstAdmin', () => {
  it('invites the first admin and returns the link', async () => {
    const mailer = memoryMailer()
    const result = await inviteFirstAdmin(
      { ...deps(), mailer },
      { email: 'Owner@Example.com', name: 'Owner' },
      log,
    )
    expect(result.user).toMatchObject({ email: 'owner@example.com', role: 'admin', status: 'invited' })
    expect(result.inviteUrl).toMatch(/^https:\/\/boat\.example\.com\/invite#token=/)
    expect(result.inviteEmailSent).toBe(true)
    expect(mailer.sent[0].text).toContain(result.inviteUrl)
  })
  it('sends a fresh link when run again for the pending admin', async () => {
    const first = await db.authToken.findFirstOrThrow({ where: { usedAt: null } })
    const again = await inviteFirstAdmin(deps(), { email: 'owner@example.com', name: 'Owner' }, log)
    expect(hashToken(tokenIn(again.inviteUrl))).not.toBe(first.tokenHash)
    expect((await db.authToken.findUniqueOrThrow({ where: { id: first.id } })).usedAt).not.toBeNull()
  })
  it('refuses an email that belongs to a non-admin', async () => {
    const planner = await makeUser(db, { role: 'planner' })
    await expect(
      inviteFirstAdmin(deps(), { email: planner.email, name: 'X' }, log),
    ).rejects.toBeInstanceOf(ConflictError)
  })
  it('refuses once an active admin exists', async () => {
    await makeUser(db, { role: 'admin' })
    await expect(
      inviteFirstAdmin(deps(), { email: 'someone@example.com', name: 'X' }, log),
    ).rejects.toThrow(/An active admin already exists/)
  })
})

describe('the create-admin command', () => {
  const env = () => ({
    ...process.env,
    // Skip the developer's apps/api/.env, which could hold a real Resend key.
    DOTENV_CONFIG_PATH: path.join(apiRoot, 'no-such.env'),
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: url,
    SESSION_SECRET: 'cli-test-secret-0123456789abcdef',
    APP_URL: 'http://localhost:5173',
  })
  const tsx = ['exec', 'tsx', 'src/cli/create-admin.ts']

  it('prints usage and exits 2 without --email and --name', () => {
    const run = spawnSync('pnpm', tsx, { cwd: apiRoot, env: env(), encoding: 'utf8' })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('Usage: create-admin --email <address> --name <name>')
  })
  it('reports a refusal and exits 1', () => {
    // An active admin exists from the tests above.
    const run = spawnSync('pnpm', [...tsx, '--email', 'late@example.com', '--name', 'Late'], {
      cwd: apiRoot,
      env: env(),
      encoding: 'utf8',
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('An active admin already exists')
  })
  it('prints the invite link on a fresh database', async () => {
    const fresh = await createTestDatabase()
    try {
      const out = execFileSync(
        'pnpm',
        [...tsx, '--email', 'first@example.com', '--name', 'First Admin'],
        { cwd: apiRoot, env: { ...env(), DATABASE_URL: fresh.url }, encoding: 'utf8' },
      )
      expect(out).toContain('Invited first@example.com as admin.')
      expect(out).toMatch(/http:\/\/localhost:5173\/invite#token=[\w-]{43}/)
    } finally {
      await fresh.close()
    }
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boat/api test:int -- test/create-admin.int.test.ts`
Expected: FAIL. `inviteFirstAdmin` is not exported.

- [ ] **Step 3: Implement `inviteFirstAdmin`**

Append to `apps/api/src/modules/users/users.service.ts`:

```ts
// A new deployment has no one to sign in as. This refuses once an active admin exists, so the
// command cannot quietly add admins later. Run again for a first admin who hasn't accepted yet,
// it sends a fresh invite.
export async function inviteFirstAdmin(
  deps: UsersDeps,
  input: { email: string; name: string },
  log: Logger,
) {
  const active = await deps.db.user.findFirst({
    where: { role: 'admin', status: 'active', deletedAt: null },
    select: { id: true },
  })
  if (active)
    throw new ConflictError(
      'An active admin already exists. Sign in as that admin to invite more people.',
    )
  const email = normalizeEmail(input.email)
  const existing = await deps.db.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, role: true },
  })
  if (!existing) return createUser(deps, { ...input, role: 'admin', pocId: null }, log)
  if (existing.role !== 'admin')
    throw new ConflictError(`${email} already belongs to a ${existing.role} user.`)
  return resendInvite(deps, existing.id, log)
}
```

- [ ] **Step 4: Write the command**

Create `apps/api/src/cli/create-admin.ts`:

```ts
import 'dotenv/config'
import { parseArgs } from 'node:util'
import { ValidationError } from '@boat/domain/validation'
import { loadConfig } from '../config'
import { createLogger } from '../core/logger'
import { createMailer } from '../core/mailer'
import { createPrisma } from '../core/prisma'
import { inviteFirstAdmin } from '../modules/users/users.service'

// Invites the first admin of a new deployment:
//   pnpm api create-admin --email you@example.com --name "Your Name"
//   node apps/api/dist/create-admin.js --email you@example.com --name "Your Name"   (Render Shell)
const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } })
if (!values.email || !values.name) {
  console.error('Usage: create-admin --email <address> --name <name>')
  process.exit(2)
}

const config = loadConfig(process.env)
const logger = createLogger(config.LOG_LEVEL)
const db = createPrisma(config.DATABASE_URL)
try {
  const { user, inviteEmailSent, inviteUrl } = await inviteFirstAdmin(
    { db, mailer: createMailer(config, logger), appUrl: config.APP_URL },
    { email: values.email, name: values.name },
    logger,
  )
  console.log(`Invited ${user.email} as admin.`)
  console.log(inviteEmailSent ? 'The invite email is on its way.' : 'The invite email was not sent.')
  console.log(`Invite link (valid for 72 hours): ${inviteUrl}`)
} catch (err) {
  const messages =
    err instanceof ValidationError
      ? Object.values(err.fields)
      : [err instanceof Error ? err.message : String(err)]
  for (const message of messages) console.error(message)
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
```

Without `RESEND_API_KEY`, the log mailer writes the email to the log at `info` level. The printed link is the same either way.

- [ ] **Step 5: Bundle it and add the scripts**

Replace the `entry` line in `apps/api/tsup.config.ts`. The object form names each output file; with an array, esbuild would keep the `cli/` folder in `dist`:

```ts
  entry: { server: 'src/server.ts', 'create-admin': 'src/cli/create-admin.ts' },
```

In `apps/api/package.json`, add to `scripts`:

```json
    "create-admin": "tsx src/cli/create-admin.ts",
```

In the root `package.json`, add to `scripts`:

```json
    "api": "pnpm --filter @boat/api",
```

- [ ] **Step 6: Run every test and the build**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int && pnpm build && ls apps/api/dist/server.js apps/api/dist/create-admin.js`
Expected: PASS, and both files are listed.

- [ ] **Step 7: Check the whole flow by hand against local Postgres**

Phase 2 adds no migration, so the database from Phase 1 is fine.

```bash
docker compose up -d db
pnpm --filter @boat/api db:migrate
pnpm --filter @boat/api dev            # terminal 1; leave it running
pnpm api create-admin --email you@example.com --name "Your Name"   # terminal 2
```

Copy the token from the printed link (the part after `#token=`), then:

```bash
TOKEN=<paste>
curl -s -c /tmp/boat.jar -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"password\":\"a long enough password\"}" \
  localhost:3000/api/v1/auth/invites/accept
curl -s -b /tmp/boat.jar localhost:3000/api/v1/auth/me
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/auth/me
rm /tmp/boat.jar
```

Expected: both JSON replies show the admin with all 10 allowed actions. The last line prints `401`. In terminal 1, the request log lines show `"cookie":"[redacted]"` and never a token. Stop the server afterwards.

- [ ] **Step 8: Update the docs**

In `README.md`, add after the API commands block:

````markdown
The first admin is invited from the command line. The link is printed, and also emailed when `RESEND_API_KEY` is set:

```bash
pnpm api create-admin --email you@example.com --name "Your Name"
```

On Render, run `node apps/api/dist/create-admin.js --email … --name …` from the service's Shell.
````

In `AGENTS.md`, append to the third paragraph of "Project Structure & Module Organization" (the one about `apps/api`):

```markdown
Every API route starts with `publicRoute()`, `requireSignedIn()` or `requirePermission(action)` from `src/core/access.ts`. `src/api.test.ts` fails for a route without one, and holds the table of every route and its permission, so add a row with each new route. Integration tests use `createTestDatabase()` and the fixtures in `test/support/`.
```

Append to "Build and Development Commands":

```markdown
`pnpm api create-admin --email <address> --name <name>` invites the first admin of a new database.
```

- [ ] **Step 9: Run the full verification**

```bash
pnpm format:check && pnpm typecheck && pnpm test \
  && pnpm --filter @boat/domain test:coverage \
  && pnpm --filter @boat/api test:int && pnpm build
```

Then repeat Phase 1's clean-clone production build (Phase 1 plan, Task 7, Step 4), and check that `apps/api/dist/create-admin.js` exists too.

Expected: everything passes.

- [ ] **Step 10: Commit, push and open the pull request into `dev`**

```bash
git add -A
git commit -m "Add the create-admin command and document auth

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin phase-2-auth
```

Open a pull request from `phase-2-auth` into `dev`: https://github.com/Ajmalajjuca/boat/compare/dev...phase-2-auth. The description should list the new endpoints, the departures from the PRD (roadmap) and the manual check from Step 7. Confirm that CI passes on it.

---

## Phase 2 gate

All of the following hold on the `phase-2-auth` pull request:

- [ ] CI is green: format, typecheck, unit tests, domain coverage ≥ 95%, integration tests and the build.
- [ ] `auth.int.test.ts` passes "each role signs in and sees its allowed actions" for admin, planner, POC and viewer.
- [ ] `api.test.ts` shows every route with an access check, and the permission table matches.
- [ ] The manual flow in Task 9, Step 7 works: create-admin, then accept, `/auth/me`, and 401 without the cookie.
- [ ] `apps/web` is unchanged: `git diff dev --stat -- apps/web` is empty.
