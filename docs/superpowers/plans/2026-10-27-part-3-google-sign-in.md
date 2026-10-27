# Part 3: Google Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff sign in with their company Google Workspace account. Only emails an admin has added, on the allowed domains, get in. One backup admin keeps a password.

**Architecture:** A server-side OpenID Connect authorization-code flow (PKCE, state, nonce) built on `openid-client` v6 ends in the app's existing session cookie. The issuer is configurable, so integration and end-to-end tests run against a small local OIDC stub, a private workspace package, while production uses `https://accounts.google.com`. Password sign-in is limited to a `password_login` user flag that only the `create-admin` CLI sets. Invite tokens and password resets go away.

**Tech Stack:** Express 5, Prisma 7, `openid-client` 6.x, `jose` 6.x (stub only), Zod config, Vitest + Supertest, React, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-client-feedback-sso-and-simpler-inputs-design.md`, section 1.

## Global Constraints

- Sign-in succeeds only when all of these hold: the ID token has `email_verified === true`; the `hd` claim (fall back to the email's domain only if `hd` is absent) is in `GOOGLE_ALLOWED_DOMAINS`; a non-deleted user with that email exists; and its status isn't `disabled`. Nothing is ever auto-created.
- First successful Google sign-in moves `invited` to `active`.
- Only users with `password_login = true` can use `POST /auth/login`. The same "Email or password is incorrect." message applies to everyone else.
- New env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_DOMAINS` (comma-separated, lower-cased), and `GOOGLE_ISSUER` (default `https://accounts.google.com`, overridden only by tests). The redirect URI is `${APP_URL}/api/v1/auth/google/callback`. Production requires the three Google vars, and an `https` issuer.
- Pin new dependencies to exact versions, as the repo does: `pnpm --filter @boat/api add openid-client@6`, then replace the caret with the installed version.
- Every new route uses `publicRoute()` and gets a row in the route table in `apps/api/src/api.test.ts`.
- New integration test ids: `FR-10.5` (Google sign-in rules) and `FR-10.6` (backup admin is the only password account). Add both to `required` in `fr-coverage.test.ts`.
- The access email (exact copy): subject `You've been given access to BOAT`, body `Hi {name},\n\nYou've been given access to BOAT. Sign in with your company Google account at {APP_URL}.\n`
- Sign-in error copy, keyed by the `?error=` code: `not_added` → "This Google account hasn't been given access. Ask your admin to add you." · `domain` → "Sign in with your company Google account." · `unverified` → "Google hasn't verified this email address." · `disabled` → "This account is disabled. Ask your admin." · `failed` → "Google sign-in didn't complete. Try again."
- Work on a branch, e.g. `client-feedback-part-3`. Run `pnpm format` before each commit.

## Review Focus

- **A replayed or tampered callback** (wrong `state`, missing or expired state cookie, reused code) redirects with `error=failed` and creates no session. Pinned in Task 1.
- **Email case** (`Jash@Company.com` from Google, `jash@company.com` stored) matches, because `email` is citext and `normalizeEmail` is applied. Pinned in Task 1.
- **A personal Gmail added by mistake** is refused with `domain`, because the `hd` check runs even when the user exists. Pinned in Task 1.
- **Disabling a user** still ends their existing sessions and blocks the next Google sign-in. Pinned in Task 1 (`disabled`) alongside the existing session tests.
- **The live database after migration**: exactly one backup admin keeps a usable password, and every other `password_hash` is NULL. Pinned in Task 3's migration test.

---

### Task 1: Google sign-in on the server, with a local OIDC stub

**Files:**
- Create: `packages/oidc-stub/package.json` (`"name": "@boat/oidc-stub"`, private, `"type": "module"`, dependencies `express`, `jose` pinned) and `packages/oidc-stub/src/index.ts`
- Create: `apps/api/src/modules/auth/google.ts`
- Modify: `apps/api/package.json` (`openid-client` dependency; `@boat/oidc-stub: workspace:*` devDependency), `apps/api/src/config.ts`, `apps/api/src/api.ts` (`ApiDeps.google: GoogleSignIn | null`), `apps/api/src/server.ts`, `apps/api/src/test-deps.ts`, `apps/api/test/support/fixtures.ts` (`testApp` accepts `google`)
- Modify: `apps/api/src/modules/auth/auth.service.ts` (add `signInWithGoogle`), `auth.router.ts` (three routes), `sessions.ts` (`authContext` selects `passwordLogin` into `auth.user`)
- Modify: `apps/api/prisma/schema.prisma` (`User.passwordLogin Boolean @default(false) @map("password_login")`), plus a new migration `20261027010000_password_login/migration.sql` that only adds the column (Task 3 adds the data change)
- Modify: `apps/api/src/api.test.ts` (route rows), `apps/api/src/fr-coverage.test.ts` (`'FR-10.5'`)
- Test: `apps/api/test/google-sign-in.int.test.ts`, `apps/api/src/config.test.ts`

**Interfaces:**
- Produces, in `@boat/oidc-stub`: `startOidcStub(opts: { clientId: string; clientSecret: string }): Promise<{ issuer: string; close(): Promise<void> }>`. It serves `/.well-known/openid-configuration`, `/jwks`, `/token`, and `/authorize`. `/authorize` takes the standard parameters plus `email`, and optionally `hd` and `email_verified=false`. With `email` it redirects straight to `redirect_uri?code&state`. Without it, it renders an HTML form with one `email` input and a "Continue" button, for Playwright. It signs RS256 ID tokens carrying `iss`, `aud`, `sub`, `nonce`, `email`, `email_verified`, and `hd` (default: the email's domain).
- Produces, in `google.ts`:
  - `type GoogleIdentity = { email: string; emailVerified: boolean; hd: string | null }`
  - `type OidcState = { state: string; nonce: string; verifier: string }`
  - `createGoogleSignIn(o: { issuer: string; clientId: string; clientSecret: string; redirectUri: string; allowedDomains: string[] }): GoogleSignIn`
  - `GoogleSignIn = { allowedDomains: string[]; start(): Promise<{ url: string; state: OidcState }>; finish(currentUrl: URL, state: OidcState): Promise<GoogleIdentity> }`. It discovers once and caches. It passes `allowInsecureRequests` only when the issuer starts with `http://`. It sends `scope: 'openid email profile'`, `code_challenge_method: 'S256'`, `prompt: 'select_account'`, and `hd` when there is exactly one allowed domain.
- Produces, in `auth.service.ts`: `signInWithGoogle(db: Db, identity: GoogleIdentity, allowedDomains: string[], userAgent?: string): Promise<{ token: string; id: string; userId: string }>`. It throws `GoogleSignInError` with `code: 'unverified' | 'domain' | 'not_added' | 'disabled'`, checked in that order.
- Produces routes:
  - `GET /api/v1/auth/options` returns `{ google: boolean }`.
  - `GET /api/v1/auth/google/start` returns a 302 to Google and sets the `boat_oidc` cookie: the signed JSON `OidcState`, HMAC-SHA256 with `sessionSecret`, httpOnly, `SameSite=Lax`, `secure` per deps, `maxAge` 10 minutes, path `/api/v1/auth/google`. It uses `requestLimiters()`.
  - `GET /api/v1/auth/google/callback` verifies the cookie, calls `finish` and then `signInWithGoogle`, sets the session cookie, clears `boat_oidc`, and returns a 302 to `${appUrl}/`. On any failure it returns a 302 to `${appUrl}/sign-in?error=<code>`, with `failed` for anything that isn't a `GoogleSignInError`.
  - Both Google routes answer 404 when `deps.google` is null.

- [ ] **Step 1: Write the failing tests.** Start the stub in `beforeAll`, and build the app with `google: createGoogleSignIn({ issuer: stub.issuer, clientId: 'test', clientSecret: 'secret', redirectUri: 'http://127.0.0.1/api/v1/auth/google/callback', allowedDomains: ['company.test'] })`. Write a helper `googleSignIn(agent, email, extra = '')`: GET `/api/v1/auth/google/start`, `fetch` the `location` plus `&email=…${extra}` with `redirect: 'manual'`, then `agent.get` the callback's path and query. It returns the final response.

```ts
it('FR-10.5 signs in an added user on the allowed domain and activates them', async () => {
  const user = await makeUser(db, { email: 'jash@company.test', status: 'invited', passwordHash: null })
  const agent = request.agent(app)
  const res = await googleSignIn(agent, 'Jash@Company.test')
  expect(res.status).toBe(302)
  expect(res.headers.location).toBe(`${appUrl}/`)
  expect((await agent.get('/api/v1/auth/me')).body.user.email).toBe('jash@company.test')
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('active')
})
it.each([
  ['not_added', 'nobody@company.test', ''],
  ['domain', 'jash@gmail.com', ''],
  ['unverified', 'jash@company.test', '&email_verified=false'],
])('FR-10.5 refuses with %s', async (code, email, extra) => {
  const res = await googleSignIn(request.agent(app), email, extra)
  expect(res.headers.location).toBe(`${appUrl}/sign-in?error=${code}`)
})
it('FR-10.5 refuses a disabled user', async () => { /* makeUser status 'disabled' → error=disabled */ })
it('FR-10.5 refuses a personal address even when an admin added it', async () => {
  await makeUser(db, { email: 'someone@gmail.com' })
  expect((await googleSignIn(request.agent(app), 'someone@gmail.com')).headers.location).toBe(
    `${appUrl}/sign-in?error=domain`,
  )
})
it('FR-10.5 refuses a callback whose state does not match', async () => {
  // start, then call the callback with the stub's code but state=forged → error=failed; /auth/me is 401
})
it('reports whether Google sign-in is configured', async () => {
  expect((await request(app).get('/api/v1/auth/options')).body).toEqual({ google: true })
  expect((await request(testApp(db)).get('/api/v1/auth/options')).body).toEqual({ google: false })
})
```

In `config.test.ts`: the Google vars are all-or-none; `GOOGLE_ALLOWED_DOMAINS: ' Company.test, other.test '` parses to `['company.test', 'other.test']`; production without them, or with an `http://` issuer, throws.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm install && pnpm --filter @boat/api test -- config && pnpm --filter @boat/api test:int -- google-sign-in`
Expected: FAIL. The modules and routes don't exist yet.

- [ ] **Step 3: Implement** the stub, `google.ts`, the config, the service, the routes, the column migration and the deps wiring, as specified under Interfaces. In `server.ts`, build `google` only when the Google vars are set.

- [ ] **Step 4: Run the API suites**

Run: `pnpm --filter @boat/api test && pnpm --filter @boat/api test:int`
Expected: PASS, including the route table and `fr-coverage.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/oidc-stub apps/api pnpm-lock.yaml
git commit -m "Add Google sign-in with a local OIDC stub for tests"
```

### Task 2: Adding users sends an access email, company domains only

**Files:**
- Modify: `apps/api/src/modules/users/users.service.ts` (`UsersDeps` gains `allowedDomains: string[]`; `createUser` L98-114 creates `status: 'invited'` with no token; `sendInvite` L90-96 becomes `sendAccessEmail(deps, user, log): Promise<boolean>`; `resendInvite` L118-135 resends the access email and refuses unless the status is `invited`)
- Modify: `apps/api/src/modules/auth/emails.ts`: add `accessEmail(appUrl: string, name: string)`, using the copy in Global Constraints
- Modify: `apps/api/src/modules/users/users.router.ts` and `api.ts` (pass `allowedDomains` from `deps.google?.allowedDomains ?? []`); `packages/domain/src/api.ts` (the create-user response shape)
- Test: `apps/api/test/users.int.test.ts` (or wherever the `/users` tests live; find them with `grep -l "/api/v1/users" apps/api/test`)

**Interfaces:**
- Produces: `createUser(deps: UsersDeps, input: NewUser, log: Logger): Promise<{ user: UserView; accessEmailSent: boolean }>`. When `allowedDomains` is non-empty, an email outside it fails with `ValidationError({ email: 'Use a company email address (company.test).' })`, listing the domains joined with `, `.
- `POST /users/:id/invite` keeps its path and permission, and answers `{ accessEmailSent: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('FR-10.5 adding a user sends the access email with no link token', async () => {
  const res = await w.admin.send('post', '/api/v1/users', { email: 'new@company.test', name: 'New', role: 'viewer', pocId: null })
  expect(res.status).toBe(201)
  expect(res.body).toMatchObject({ accessEmailSent: true })
  const mail = sent.at(-1)! // the test mailer's captured messages
  expect(mail.subject).toBe("You've been given access to BOAT")
  expect(mail.text).not.toMatch(/token=|invite\?/)
})
it('FR-10.5 refuses an email outside the company domains', async () => {
  const res = await w.admin.send('post', '/api/v1/users', { email: 'x@gmail.com', name: 'X', role: 'viewer', pocId: null })
  expect(res.body.fields).toEqual({ email: 'Use a company email address (company.test).' })
})
```

Build this suite's app with a `google` sign-in whose `allowedDomains` is `['company.test']`. Read captured mail the way the existing user tests do.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boat/api test:int -- users`
Expected: FAIL. The invite email and token are still sent.

- [ ] **Step 3: Implement** the changes listed under Files.

- [ ] **Step 4: Run the API suites**

Run: `pnpm --filter @boat/api test:int`
Expected: PASS once existing invite-acceptance tests are rewritten or removed. Tests that only need a signed-in user should use `makeUser` + `signIn` with `passwordLogin: true`, or the Task 1 `googleSignIn` helper.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/domain/src/api.ts
git commit -m "Send an access email instead of an invite link"
```

### Task 3: One backup admin password; remove invites and resets

**Files:**
- Create: `apps/api/prisma/migrations/20261027020000_backup_admin/migration.sql`
- Modify: `apps/api/src/modules/auth/auth.service.ts`: `signInWithPassword` also requires `passwordLogin`; delete `acceptInvite`, `requestPasswordReset`, `resetPassword`; `changePassword` throws `PermissionError` unless `passwordLogin`
- Modify: `apps/api/src/modules/auth/auth.router.ts`: delete `/invites/accept`, `/password/forgot`, `/password/reset` and their limiters and bodies; `emails.ts` drops `inviteEmail`, `resetEmail`, `linkFor`; `tokens.ts`/`auth-tokens.ts` delete code that no longer has callers (the `auth_tokens` table stays)
- Modify: `apps/api/src/modules/users/users.service.ts`: replace `inviteFirstAdmin` L204-226 with `setBackupAdmin`
- Modify: `apps/api/src/cli/create-admin.ts`
- Modify: `apps/api/src/api.test.ts` (remove rows), `apps/api/src/fr-coverage.test.ts` (`'FR-10.6'`), `apps/api/test/support/fixtures.ts` (`makeUser` accepts `passwordLogin`; `makeRecordsWorld` users that sign in with a password get `passwordLogin: true`)
- Modify the e2e setup: `e2e/support/global-setup.ts` starts `@boat/oidc-stub` before the API and passes `GOOGLE_ISSUER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_ALLOWED_DOMAINS` (the domain of `users.*.email` in `e2e/support/env.ts`). The admin signs in with the password that `create-admin` prints, through `POST /auth/login`. Planner, POC and viewer are added through `POST /users`, then signed in by a Playwright `APIRequestContext` that requests `${appUrl}/api/v1/auth/google/start`, follows the redirects with `&email=<their email>` appended to the stub's authorize URL, and saves `storageState`. `e2e/support/api.ts` drops `acceptInvite`; `e2e/support/mail.ts` drops `tokenIn`. Add `@boat/oidc-stub` to `e2e/package.json`.
- Test: `apps/api/test/auth.int.test.ts` (or the existing password sign-in suite), `apps/api/test/backup-admin.int.test.ts`

**Interfaces:**
- Produces: `setBackupAdmin(db: PrismaClient, input: { email: string; name: string }): Promise<{ user: UserView; password: string }>`.
  - If no user has `password_login`, it creates the user, or promotes an existing admin with that email: role `admin`, status `active`, `password_login = true`.
  - If that email already is the backup admin, it sets a new password, which is how the backup admin's password gets reset.
  - If another user is the backup admin, it throws `ConflictError('<that email> is already the backup admin.')`.
  - It refuses an existing non-admin with the existing `"<email> already belongs to a <role> user."` message.
  - The password is `randomBytes(18).toString('base64url')`, hashed with `hashPassword`.
  - It skips the company-domain check, since the backup admin may be outside it.
  - It revokes the user's existing sessions when it resets the password.
- CLI output: `Backup admin: <email>` and `Password (shown once): <password>`.

- [ ] **Step 1: Write the failing tests**

```ts
it('FR-10.6 only the backup admin can sign in with a password', async () => {
  await makeUser(db, { email: 'planner@company.test', role: 'planner', passwordLogin: false }) // with a password hash
  const refused = await request(app).post('/api/v1/auth/login').send({ email: 'planner@company.test', password })
  expect(refused.status).toBe(401)
  expect(refused.body.error).toBe('Email or password is incorrect.')
  const { password: pw } = await setBackupAdmin(db, { email: 'ops@gmail.com', name: 'Ops' })
  expect((await request(app).post('/api/v1/auth/login').send({ email: 'ops@gmail.com', password: pw })).status).toBe(200)
})
it('FR-10.6 keeps a single backup admin', async () => {
  await expect(setBackupAdmin(db, { email: 'other@company.test', name: 'Other' })).rejects.toThrow(
    'ops@gmail.com is already the backup admin.',
  )
})
it('FR-10.6 the migration keeps one password: the earliest active admin with one', async () => {
  // seed: admin A (2026-01-01, hash), admin B (2026-02-01, hash), planner C (hash), invited D (null)
  // run the migration SQL; expect A.password_login true with its hash kept; B, C, D password_hash NULL and password_login false
})
```

Also assert that the deleted routes answer 404: `POST /api/v1/auth/password/forgot` and `POST /api/v1/auth/invites/accept`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boat/api test:int -- auth backup-admin`
Expected: FAIL. The planner can still sign in, and `setBackupAdmin` doesn't exist.

- [ ] **Step 3: Write the migration, then implement**

```sql
UPDATE users SET password_login = true
WHERE id = (SELECT id FROM users
            WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL AND password_hash IS NOT NULL
            ORDER BY created_at LIMIT 1);
UPDATE users SET password_hash = NULL WHERE password_login = false;
```

Then implement the service, router, CLI and e2e setup changes listed under Files.

- [ ] **Step 4: Run all suites, including e2e**

Run: `pnpm typecheck && pnpm test && pnpm --filter @boat/api test:int && pnpm build && pnpm e2e`
Expected: all PASS, except specs that drive the removed invite or reset pages (`auth.spec.ts`, `users.spec.ts`), which Task 4 rewrites. List any other failures and fix them here.

- [ ] **Step 5: Commit**

```bash
git add apps/api e2e pnpm-lock.yaml
git commit -m "Keep one backup admin password and drop invite links"
```

### Task 4: Sign-in screen, Users screen, docs

**Files:**
- Modify: `apps/web/src/auth/SignIn.tsx`: on load, GET `/auth/options`. When `google` is true, show a primary "Sign in with Google" link (`href="/api/v1/auth/google/start"`, a full-page navigation) and, under it, a small "Admin password sign-in" button that reveals the existing email and password form. When `google` is false, show only the form. Map `?error=` to the copy in Global Constraints.
- Delete: `apps/web/src/auth/TokenPages.tsx` and its routes in `App.tsx` or the router (invite and reset-password pages); the forgot-password link
- Modify: `apps/web/src/auth/ProfileCard.tsx` / `ChangePassword.tsx`: show change-password only when `user.passwordLogin`
- Modify: `apps/web/src/Users.tsx`: no invite link to copy. After adding a user, show "Access email sent." or "The access email could not be sent. Ask them to sign in at {APP_URL} with their company Google account." The resend action is labelled "Resend access email" and shown only for `invited` users.
- Modify: `apps/web/src/api/` (client and mapper for `/auth/options`, `accessEmailSent`, `passwordLogin`), with mapper tests
- Modify: `apps/api/.env.example` (Google vars with a short Google Cloud setup note: OAuth client type "Web application", consent screen "Internal", the redirect URI; mail is now a courtesy only), `AGENTS.md` (the auth description, how e2e signs in through `@boat/oidc-stub`, `create-admin` prints the backup admin password), `docs/roles-and-permissions.md`, `docs/demo-walkthrough.md`
- Test: rewrite `e2e/tests/auth.spec.ts` and `e2e/tests/users.spec.ts`; update `apps/web/src/api/*.test.ts`

**Interfaces:**
- Consumes: `GET /auth/options` (Task 1), `MePayload.user.passwordLogin` (Task 1), `{ accessEmailSent }` (Task 2).

- [ ] **Step 1: Write the failing e2e tests.** Use a fresh context with no storage state for sign-in, and `newUser()` for any user the test signs out or disables, per `AGENTS.md`.

```ts
test('a user the admin added signs in with Google', async ({ browser }) => {
  // as admin via API: add newUser() on the allowed domain
  const page = await (await browser.newContext()).newPage()
  await page.goto('/sign-in')
  await page.getByRole('link', { name: 'Sign in with Google' }).click()
  await page.getByLabel('Email').fill(email) // the stub's form
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
})
test('someone not added sees why they cannot get in', async ({ browser }) => {
  // as above with an email on the domain that no one added
  await expect(page.getByText("This Google account hasn't been given access. Ask your admin to add you.")).toBeVisible()
})
test('the backup admin signs in with a password', async ({ browser }) => {
  // click 'Admin password sign-in', fill the e2e admin's email and the password from global setup
})
test('adding a user reports the access email', async ({ page }) => {
  // Users screen: add newUser(); expect 'Access email sent.'; no invite link is shown
})
```

Use the tracker's real heading, and read the admin password from wherever Task 3's global setup stores it (e.g. `seeded.json`).

- [ ] **Step 2: Build and run them to verify they fail**

Run: `pnpm build && pnpm e2e -- tests/auth.spec.ts tests/users.spec.ts`
Expected: FAIL. There's no Google link on the sign-in page.

- [ ] **Step 3: Implement** the screens, API client changes and docs listed under Files.

- [ ] **Step 4: Run everything**

Run: `pnpm typecheck && pnpm test && pnpm format:check && pnpm --filter @boat/api test:int && pnpm build && pnpm e2e`
Expected: all PASS on both viewports.

- [ ] **Step 5: Commit**

```bash
git add -A apps packages e2e docs AGENTS.md
git commit -m "Sign in with Google on the web app"
```

## Before deploying (not code)

1. Ask the client's Workspace admin to create the OAuth client: type "Web application", consent screen "Internal", redirect URI `https://<render host>/api/v1/auth/google/callback`. Set the three Google vars on Render.
2. Check the live Users list. Anyone whose email isn't on `GOOGLE_ALLOWED_DOMAINS` loses access, except the backup admin.
3. After the deploy, run `node apps/api/dist/create-admin.js --email <backup admin> --name <name>` in the Render Shell if the migration didn't pick the intended account, and store the printed password somewhere safe.
