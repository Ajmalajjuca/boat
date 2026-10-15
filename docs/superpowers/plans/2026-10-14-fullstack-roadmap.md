# Full-Stack Build Roadmap

**Spec:** [Supply Chain App — Backend PRD & Architecture](https://claude.ai/code/artifact/313da010-aa6a-4a87-be4b-2c401635a8cd) (rev 56, 13 Oct 2026)

The build runs in the PRD's six phases. Each phase ends in something that can be demonstrated, gets its own task-level plan, and merges to `dev` before the next plan is written. `dev` is merged into `main` (which Render deploys) when a release is ready. Later plans are written against the code the earlier phases actually produced, not against guesses.

| # | Phase | Delivers | Gate (done when) | Plan |
| - | ----- | -------- | ---------------- | ---- |
| 1 | Foundation | pnpm monorepo; `packages/domain` with unit tests; Express API skeleton with health checks; Prisma schema, migrations and database grants; Docker Compose Postgres; CI; `render.yaml` | Web app builds from the shared package; domain coverage ≥ 95%; schema integration tests and CI green | [2026-10-14-phase-1-foundation.md](2026-10-14-phase-1-foundation.md) |
| 2 | Auth and users | Sign-in, server sessions, invites and password reset via Resend, `requirePermission` middleware with the route-walk test, CSRF, `create-admin` CLI, users and settings modules | Each role can sign in, and `/auth/me` returns the right allowed actions | [2026-10-15-phase-2-auth-and-users.md](2026-10-15-phase-2-auth-and-users.md) |
| 3 | Core records | Soft-delete Prisma extension, audit service, version conflicts; lookups, products, lots, RM batches, GRN receipts, activity and notes | Every FR-1 to FR-4, FR-7 and FR-8 rule has a passing integration or API test | Written after Phase 2 merges |
| 4 | Shipments and reports | Shipments with items and ETA revisions, month-end report, CSV export, JSON export, import (merge/replace), reset | `docs/sample-test-backup.json` imports, and its month-end figures match the demo app's | Written after Phase 3 merges |
| 5 | Frontend switch | API client with TanStack Query replaces `repository.ts` and `db.ts`; sign-in replaces PIN profiles; 409 shown as "someone else changed this"; Playwright suite | Every Playwright flow passes against the API, on desktop Chromium and a 390 px viewport | Written after Phase 4 merges |
| 6 | Launch | Render staging on a Neon branch, backup and restore drill, OWASP review, client data import, production cut-over | Client signs off on staging with their own data | Written after Phase 5 merges |

## Dependencies between phases

- Phases 2–4 each add API modules on the Phase 1 skeleton, and none of them changes the browser. The demo app keeps working from IndexedDB until Phase 5.
- Phase 3 needs Phase 2's `requirePermission`, the session user and the audit actor. Phase 4's import needs Phase 3's services, because import reuses the same rules.
- Phase 5 is the only phase that changes what users see. It can start on read-only screens once Phase 3 merges, but its gate needs Phase 4.

## Where Phase 1 departs from the PRD

These follow from the versions available on 14 Oct 2026 or close gaps the PRD leaves open. The PRD should be updated to match.

1. **Prisma 7 configuration.** Prisma 7 removed `url` and `directUrl` from `schema.prisma`, and it now requires the `prisma-client` generator with an `output` path. The CLI reads the direct (owner) URL from `prisma.config.ts`. The running app passes the pooled URL to the `@prisma/adapter-pg` driver adapter.
2. **Case-insensitive uniqueness.** Email, product name and variant, lot label, lookup value and shipment number use `citext` columns with partial unique indexes (`WHERE deleted_at IS NULL`) declared in the schema. Hand-written `lower()` indexes would look like drift to Prisma, and a later migration would drop them.
3. **Postgres 17** for local development and tests, matching Neon's current default. The PRD's testing table says 16.
4. **Node 24 LTS.** Node 20 has passed end of life, and Vitest 5 needs Node 22.12 or later.
5. **ESLint is deferred.** The PRD lists lint in CI. Phase 1 relies on strict `tsc` and Prettier, and adding ESLint can be a small follow-up.
6. **Web shims.** `apps/web/src/models.ts`, `calculations.ts` and `validation.ts` become thin re-exports of `@boat/domain`, so the 18 screen files keep their imports. Phase 5 removes the shims.
7. **App database role.** The PRD revokes DELETE from the app's role but doesn't say how the role is created. Phase 1 adds `prisma/grants.sql`, which runs after every migration and refuses to finish if `boat_app` can still delete or rewrite history through any role membership. On Neon, create `boat_app` with SQL rather than in the console, because console roles join `neon_superuser`.

8. **Fixes to the PRD's schema block.** Enums are written one value per line, because Prisma rejects `enum Role { admin planner poc viewer }`. Audit times get `@db.Timestamptz(3)`, following the PRD's own "audit times use timestamptz" convention. Without it, Prisma's default is `timestamp` with no time zone.

## Where Phase 2 departs from the PRD

1. **CSRF token.** The token is an HMAC of the session id, signed with `SESSION_SECRET`. The sign-in and `/auth/me` replies carry it, and writes echo it in `X-CSRF-Token`. This is stronger than the PRD's double-submit cookie and needs no extra cookie. Public routes (sign-in, invite, reset) have no session; they accept only JSON bodies and rely on `SameSite=Lax`.
2. **Request validation.** Handlers call `parseInput(schema, value)` instead of a `validate(schema)` middleware, because Express 5 makes `req.query` read-only. The 422 field map is the same.
3. **No repository files.** Each module has a router and a service that calls Prisma directly. Prisma is already the data-access layer, and a pass-through repository would add a file per module with nothing to test. Revisit if a module's queries grow complex or shared.
4. **Resending invites.** `POST /users/:id/invite` sends a fresh link, because invites expire after 72 hours. The PRD's endpoint table has no way to recover an expired invite.
5. **Status codes the PRD's table doesn't list.** `429 rate_limited` for too many attempts, and `202` from forgot-password, which answers the same way whether or not the account exists.
6. **Emails stored in lowercase.** Sign-in normalises the address the same way, so it never relies on how Postgres compares `citext` with a text parameter. The `citext` unique index stays as a backstop.
7. **Idle timeout range.** 5 to 720 minutes. The demo's "Never" is dropped, because server sessions must expire; the 12-hour cap applies anyway.
8. **`create-admin` sends an invite.** It doesn't take a password, so no password lands in shell history. It refuses once an active admin exists.
9. **Tokens in the URL fragment.** Emailed links are `/invite#token=…` and `/reset-password#token=…`, so tokens stay out of server and proxy logs. Phase 5 builds the two pages.
10. **No audit trail for user changes yet.** `activity_logs.entity_type` covers lots and shipments only (FR-7.1). Phase 2 logs user changes through pino. If an audit of user administration is wanted, it needs a schema change.
11. **Rate-limit counts in memory.** Enough for one Render instance; a restart clears them.

## Still open in the PRD (no effect on Phases 1–4)

- Will GRN receipts or shipments later come from an ERP?
- Do factory POCs need to enter data offline?
- Is 5 failed sign-ins per 15 minutes per IP too strict for a factory where everyone shares one public IP? The per-account limit already stops password guessing, so the per-IP limit could be higher (for example 30) with little risk.
