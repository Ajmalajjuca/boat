# Phase 5: Frontend Switch — Design

**Roadmap:** [2026-10-14-fullstack-roadmap.md](../plans/2026-10-14-fullstack-roadmap.md), Phase 5
**PRD:** [Supply Chain App — Backend PRD & Architecture](https://claude.ai/code/artifact/313da010-aa6a-4a87-be4b-2c401635a8cd) (rev 56)
**Branch:** `phase-5-frontend-switch`, merged into `dev` locally when the gate passes.

## Outcome

The web app reads and writes through the API instead of IndexedDB, so every user works on one shared dataset. Email-and-password sign-in replaces the PIN profiles. The phase is done when a Playwright suite covering every flow in AGENTS.md passes against the real API, on desktop Chromium and a 390 px viewport, locally and in CI.

## Constraints carried in

- TanStack Query for caching and refetch (PRD, Backend architecture).
- `409` version conflicts are shown as "someone else changed this" (PRD, Migration plan).
- `/invite#token=…` and `/reset-password#token=…` pages are built here (Phase 2, departure 9).
- Nothing polls `GET /auth/me`, because every request with a session moves the idle timer (roadmap, notes for Phase 5).
- The `models`, `calculations` and `validation` shims in `apps/web/src` are removed (Phase 1, departure 6).
- One Render service runs the API and serves the built web app, so the browser and API share an origin.
- Offline use is out of scope. The client's existing browser data comes over in Phase 6 through a JSON backup, so this build has no IndexedDB migration.

## 1. Architecture and data layer

### API client

`apps/web/src/api/client.ts` is a thin `fetch` wrapper:

- Sends `credentials: 'same-origin'` and JSON bodies; adds `X-CSRF-Token` (from the auth context) to every non-GET request.
- Maps error replies to typed errors: `ValidationError` (422, with the `fields` map the forms already use), `ConflictError` (409, with `message` and the server's `current` record when present), `ForbiddenError` (403), `NotFoundError` (404), `UnauthenticatedError` (401), `RateLimitedError` (429, with the server's message), and `ServerError` for 5xx and network failures.
- A 401 on any request other than sign-in clears the auth context, which shows the sign-in screen.
- File downloads (CSV and JSON export) go through the same wrapper, so errors on them are shown the same way.

### Queries and mutations

`apps/web/src/api/queries.ts` holds one hook per endpoint, with stable query keys:

| Hook | Endpoint | Used by |
| --- | --- | --- |
| `useProducts()` | `GET /products` | every screen (reference data) |
| `useLookups()` | `GET /lookups` | every screen (reference data) |
| `useSettings()` | `GET /settings` | Settings, date rules |
| `useLotSummary()` | `GET /lots/summary` | Production cards |
| `useLotGroups(filters)` | `GET /lots/groups` (new) | Production, grouped view |
| `useLots(filters, page)` | `GET /lots` | Production flat view, Completed, a product's expanded lots |
| `useLot(id)` | `GET /lots/:id` | Lot drawer |
| `useActivity(entity, id)` | `GET /lots/:id/activity`, `GET /shipments/:id/activity` | History and notes in both drawers |
| `useShipments(filters)` / `useShipmentSummary()` / `useShipment(id)` | `GET /shipments…` | Finished Goods, shipment drawer |
| `useMonthEnd(month)` | `GET /reports/month-end` | Month-end |
| `useUsers()` | `GET /users` | Settings (admins) |

Writes use `useMutation`. Each mutation invalidates the keys its change affects: a GRN receipt invalidates that lot, the lot lists, groups and summary, and month-end; a product edit invalidates products and the lot lists; and so on. These hooks replace `useLiveQuery(getData)` and the `DataSet` prop that every screen receives today.

Products, lookups and settings are unpaged and small, so they load once per session and are shared by every screen.

### Production

- **Cards** come from `GET /lots/summary`.
- **Grouped view** (the default) uses a new `GET /lots/groups`. It takes the same filter query as `GET /lots` and returns the products in display order, each with its segment, lot count and totals (lot quantity, fresh production, GRN, balance). In active mode with no filter other than segment and search, products with no active lots are included, as the demo does. Expanding a product fetches `GET /lots?productId=…` with the same filters. The totals are computed with the domain's functions on the lots chosen in SQL, as the lot list does, so they match the demo by construction.
- **Flat view** pages on the server with Previous/Next and a "1–50 of 312" count.
- **Searching or filtering** still expands every matching product.

### CSV

The CSV buttons download the server's `export.csv` endpoints (lots, shipments, month-end) with the current filters. The browser no longer builds CSVs, and `toCsv` is removed. `downloadFile` remains for the JSON backup.

### Types

The web imports response and request types, as types only, from a new `apps/api/src/contract.ts`, which re-exports `LotView`, `ShipmentView`, `ProductView`, the month-end and group shapes, the user view, and the request inputs, each wrapped in a `Jsonify<…>` helper so that `Date` becomes `string`. If the client and server drift apart, `pnpm typecheck` fails. `import type` keeps the API out of the browser bundle. `@boat/api` becomes a dev dependency of `@boat/web` for this.

### Removed

- `apps/web/src/db.ts`, `repository.ts` and `demo.ts`; `dexie` and `dexie-react-hooks`.
- The PIN, salt, recovery-key and stored-session helpers in `access.ts`.
- The shims `models.ts`, `calculations.ts` and `validation.ts`; screens import `@boat/domain` directly.

### Local development

Vite proxies `/api` to the API (`http://localhost:3000` by default), so cookies stay same-origin, as on Render. AGENTS.md documents running `docker compose up -d db`, the API and `pnpm dev` together.

## 2. Sign-in, sessions and users

### Start-up and access

The app calls `GET /auth/me` once on load. A 401 shows the sign-in screen. A success stores `user`, `allowedActions`, `csrfToken` and `idleTimeoutMinutes` in an `AuthContext`, which replaces today's `AccessContext`. `can(action)` reads `allowedActions`. The POC lot-edit rule uses `@boat/domain/permissions` with the signed-in user, so the browser hides exactly what the server refuses. Lot views also carry the server's `access` field, which the lot drawer uses for its edit controls.

### Public screens

Chosen by `location.pathname`, without a router library, which matches the app's screen-state navigation:

- `/` signed out: email and password. A failed sign-in shows the server's message, including the 429 lock-out message. A "Forgot password?" link opens the request form, which always answers "If that address has an account, we've emailed a reset link" (the API returns 202 either way).
- `/reset-password#token=…`: new password and confirmation (at least 12 characters). On success, the server starts a session and the app opens signed in.
- `/invite#token=…`: password and confirmation (the API has no endpoint to look up an invite, so the page names no one). On success, the app opens signed in.
- Both token pages read the token from the fragment, then clear it with `history.replaceState`, so it does not stay in the address bar. Expired or used links show the server's message with a way back to sign-in.

### Idle sign-out

A browser timer set to `idleTimeoutMinutes` and reset by pointer, key, wheel and touch activity, as today's idle lock is, calls `POST /auth/logout` and shows "Signed out after N minutes without activity." The server also expires the session, so a request after expiry returns 401 and shows sign-in with the same message. Nothing polls `/auth/me`.

### Profile menu

The menu keeps "Sign out" and changes "Change PIN" to "Change password" (`PATCH /auth/me/password`: current password, new password, confirmation). The server revokes the user's other sessions and keeps the current one.

### User administration

In Settings, for admins only, the user list replaces the roles card. It shows name, email, role, status (invited, active, disabled), POC link and last sign-in. Admins can:

- Invite a user (name, email, role; a POC value for POC users).
- Edit the name, role and POC link.
- Resend an invite (`POST /users/:id/invite`).
- Disable, re-enable and delete a user.

The server's refusals, such as removing or demoting the last admin, are shown as messages. If the invite email fails to send, the user is still created; the UI says so and offers "Resend invite".

### Removed

PINs, recovery keys, "Turn off roles", and the first-run setup screen, which `pnpm api create-admin` replaces. `Profiles.tsx` shrinks to the public screens and the user list, and may be renamed `Auth.tsx` and `Users.tsx`.

## 3. Editing, conflicts and errors

- **Dropdowns.** Lookups arrive as `{ id, value }`. Forms keep ids and send `categoryId`, `pocId` and the other id fields the API expects.
- **Validation.** Forms still run the domain validators before saving. A 422 from the server maps onto the same field errors.
- **Version conflicts.** Each editor keeps the record's `version` from when it was opened and sends it with the save. On a 409 version conflict, the drawer stays open with the user's edits and shows a banner: "Someone else changed this lot while you were editing. Reload to see their version — your unsaved changes will be lost." **Reload** replaces the form with the server's `current` record. **Keep editing** dismisses the banner, but the next save needs a reload first, because the version is stale. The banner names the record type (lot, product, shipment).
- **Other 409s** (value in use, last admin, over-receipt and the like) show the server's message, as today.
- **403** shows "You don't have permission to do that." It only happens if a role changed during a session.
- **404** on an open record closes its drawer with "This lot was deleted" (or product, shipment).
- **5xx and network failures** show "Couldn't reach the server — try again" and keep the form open.
- **Saving state.** `run()` and the saving/saved/failed indicator stay, driven by the mutation's state. The repeat-click guard stays.
- **Loading.** The first load of a screen shows a skeleton. A refetch keeps the current data on screen (`placeholderData: keepPreviousData`), so filtering doesn't flicker. Queries refetch on window focus, so another tab's or user's changes appear without polling.
- **Data management.** Export downloads `GET /data/export`. Import still previews the file with `@boat/domain/backup` in the browser, then uploads it to `POST /data/import` in merge or replace mode and shows the server's counts. Reset calls `POST /data/reset` after the user types `RESET ALL DATA`.

## 4. Testing and the gate

### Playwright

A new workspace package, `e2e/` (`@boat/e2e`), holds the suite, since it covers the API and the web app together.

**Global setup:**

1. Start Postgres 17 with Testcontainers, migrate it and apply `grants.sql`, reusing the API's integration-test setup.
2. Start the built API (`node apps/api/dist/server.js`) with `webDist` pointing at the built web app, so the browser and API share one origin as on Render. No `RESEND_API_KEY` is set, so the log mailer writes every email, link included, to the API's log.
3. Seed users through the real flows: run `create-admin`, read the invite link from its log, and accept it; then, as the admin, invite a planner, a POC user (linked to a POC value) and a viewer, read their links from the API log, and accept them. Production code needs no test hooks.
4. Save a signed-in browser state for each role.

**Isolation.** Each spec starts with `POST /data/reset` as the admin, which soft-deletes the business records and keeps users, dropdowns and settings. A spec that changes settings or users puts them back. Specs run one at a time (`workers: 1`), because a replace import would wipe the data of specs running alongside it. The suite signs in with saved state rather than the form, except in the sign-in specs, so the failed-attempt limits (5 per 15 minutes) are never reached.

**Projects.** Every spec runs on desktop Chromium and on Chromium at 390 × 844.

**Specs (one per flow):**

| Spec | Covers |
| --- | --- |
| `products-and-lots` | Create, edit and delete a product and a lot; validation messages |
| `rm-batches` | Add, edit and delete RM batches; component checks; RM ready quantity |
| `grn` | Partial and full GRN; over-receipt refused; the lot moves to Completed |
| `completion-reversal` | Deleting a receipt reopens a completed lot |
| `month-end` | Month-end figures for a known set of lots; the CSV downloads |
| `shipments` | Create, edit and delete shipments with product lines |
| `eta-history` | Revising an ETA records history with its reason |
| `filters` | Lot filters, quick cards, grouped and flat views, paging, CSV with filters |
| `backup` | Export, import in merge and in replace mode, reset |
| `roles` | What each role sees and can do; POC limits on lots; the viewer has no write controls |
| `auth` | Sign-in, wrong password, sign-out, forgot and reset password, accepting an invite, changing your own password |
| `users` | Invite, edit role and POC link, resend, disable and re-enable, delete; the last admin is protected |
| `idle` | Idle sign-out, with `page.clock` fast-forwarding the timer |
| `conflict` | Two browser contexts edit the same lot; the second sees the banner and can reload |
| `persistence` | A refresh, and another user's browser, see the same data |
| `mobile` | At 390 px: no horizontal page scroll; the menu, drawers and forms are usable |

### Other tests

- **API:** integration tests for `GET /lots/groups` (filters, ordering, empty products, totals checked against the domain's functions, deleted products and lots excluded), and its row in the `api.test.ts` route table.
- **Web:** Vitest is added to `@boat/web` for `api/client.ts` (error mapping, CSRF header, 401 handling).
- **Domain:** line coverage stays at 95% or above.

### CI and docs

- CI adds `pnpm --filter @boat/e2e exec playwright install --with-deps chromium` and `pnpm --filter @boat/e2e test` after `pnpm build`.
- AGENTS.md replaces the "until the web app switches to the API" manual checklist with the Playwright command, describes the new web files (`api/`, the auth screens, the user list), and adds the `e2e` package.

### Gate

- Every Playwright spec passes on both projects, locally and in CI.
- `pnpm format:check && pnpm typecheck && pnpm test && pnpm --filter @boat/domain test:coverage && pnpm --filter @boat/api test:int && pnpm build` passes.
- `apps/web` no longer depends on Dexie, and `grep -r "repository\|from './db'" apps/web/src` finds nothing.

## Where Phase 5 departs from the PRD

These go into the roadmap's departures list when the plan is written.

1. **`GET /lots/groups` is added.** The PRD's endpoint table has no grouped view, but the demo's default Production view groups lots by product with totals, and grouping a paged flat list would split products across pages.
2. **Demo-only features are dropped:** "Load demo data" on first run, PINs, recovery keys, "Turn off roles" and the in-app setup screen. `create-admin` replaces the setup screen; the sample backup can be imported for demos.
3. **CSVs come from the server.** The browser's CSV builder is removed, so the three exports have one implementation each.
4. **The web app imports the API's response types** from `apps/api/src/contract.ts`, types only, so a change in a response shape fails typecheck.
5. **Playwright seeds users through the real invite flow,** reading links from the log mailer's output, rather than writing users to the database directly.

## Out of scope

- Offline use and IndexedDB migration (Phase 6 imports the client's backup).
- Staging, Neon, the OWASP review and cut-over (Phase 6).
- Restyling screens beyond what the new data flow, sign-in and user list need.
- Google or Microsoft sign-in.
