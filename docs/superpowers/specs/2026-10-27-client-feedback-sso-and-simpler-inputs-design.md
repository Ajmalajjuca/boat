# Client feedback: Google sign-in, fewer inputs, date rules

Date: 2026-10-27. Source: the client review call (Jash Sheth, Rakesh Sangolli, Ajmal) and the
decisions Ajmal made with the client afterwards.

## Why

The client likes the tracker but says it asks for too much. Their team updates it daily in a
factory, and every extra field is a reason to stop using it and a place for wrong entries that are
hard to trace back. Their seniors want the first phase to track one thing well: how much raw
material is in the factory, per product and model, per component and as a full kit. If the team
adopts it over 15–20 days, GRN tracking comes back.

They also want access limited to their own staff, signed in with company email, and dates that
people can't keep pushing into the past.

Success: the factory team can keep a lot current with the fewest possible fields, dates can't be
back-filled, and only the client's staff can get in.

## Goals

1. Staff sign in with Google using their company Google Workspace account. No passwords for them.
2. Hide GRN, rework, and fresh production from the product.
3. A lot is finished when its actual date is entered.
4. Validate the lot and batch dates with the agreed rules.
5. In track-by-component mode, "Add batch" is available as soon as a component is ticked.

## Non-goals

- Deleting GRN. It is hidden and must be easy to switch back on.
- Shipments, follow-up dates, and other screens not named here.
- Deciding how completion works once GRN returns. That is a later decision.
- A new invite or onboarding flow beyond what sign-in needs.

## Anti-goals (failure even if it technically works)

- Anyone outside the client's company can sign in.
- Nobody can sign in when Google sign-in is broken or misconfigured.
- Editing an old lot is blocked because a date on it has since passed.
- Lots that already finished through GRN drop back into Active after the switch.
- Hiding GRN loses existing receipts, rework values, or fresh production values.

## 1. Google sign-in

### Behaviour (decided with the client)

- An admin adds a person's company email under Users, with a role, as today.
- That person opens the app and chooses "Sign in with Google". If the Google account's email
  matches a user the admin added, and that user isn't disabled, they're signed in with that user's
  role. Otherwise they're refused with a clear message, e.g. "This account hasn't been given access.
  Ask your admin." Nothing is created automatically.
- Roles and permissions don't change.
- **One backup admin keeps a password** so the app stays reachable if Google sign-in fails. Every
  other account signs in only with Google.

### Calls made in the design (Ajmal didn't object; confirm while reading)

- **Domain restriction.** Besides matching an added user, the Google account must belong to the
  client's Workspace domain. Configure this with an env var, e.g. `GOOGLE_ALLOWED_DOMAINS`
  (comma-separated). Check the ID token's `hd` claim and `email_verified`, not just the email text.
  Adding a user whose email is outside the allowed domains is rejected with a field error.
- **Protocol.** Google's OpenID Connect authorization-code flow, done on the server (with PKCE and a
  `state`/`nonce` check), ending in the app's existing session cookie. The web app never handles
  Google tokens. New env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_DOMAINS`.
  The redirect URI is `${APP_URL}/api/v1/auth/google/callback` (served same-origin through the Vite
  proxy locally, as on Render). The new routes need `publicRoute()` and rows in the route table in
  `src/api.test.ts`.
- **Backup admin.** The account created with `pnpm api create-admin` is the backup admin and is the
  only account whose password sign-in works. It can also sign in with Google if its email is on an
  allowed domain. In the hosted database this is Ajmal's existing admin account. The builder chooses
  the mechanism (e.g. a flag on the user). The migration clears `password_hash` for every other
  user. The CLI can reset the backup admin's password; there is no emailed reset.
- **Removed:** invite-token acceptance, forgot-password and reset-password pages and routes.
  Change-password stays only for the backup admin, on its profile.
- **Invite email.** When an admin adds a user, send a short "You've been given access to BOAT, sign
  in with your company Google account at <APP_URL>" email with no token in it. It's a courtesy:
  delivery failures are logged and never block access. This removes the spam problem as a blocker.
- **User status.** `invited` until the first successful Google sign-in, then `active`. `disabled`
  is refused at sign-in and ends existing sessions, as today.
- **Sign-in screen.** One primary "Sign in with Google" button. A small, low-key "Admin password
  sign-in" link opens the existing email-and-password form.

### Setup the client must do (outside the code)

Create an OAuth client of type "Web application" in a Google Cloud project owned by the client's
Workspace, with consent screen user type **Internal** (only their domain can use it) and the
redirect URI above. Their IT admin may need to do this. Put the client ID and secret in Render's
env.

### Rollout note

Existing users whose email isn't on the client's domain (for example a personal Gmail used for
testing) can't sign in after the switch, except through the backup admin. Check the hosted Users
list before deploying.

## 2. Hide GRN, rework, and fresh production

### Decided

- Hide GRN receipts entirely: the GRN Receipts tab in the lot drawer, GRN totals, balance and
  progress columns and filters, the month-end GRN figure, and GRN mentions in role descriptions and
  on screens.
- Remove from forms, screens, CSV exports, and validation: **rework quantity**, **rework reason**,
  **fresh production quantity**.
- Keep: lot quantity, ready quantity, RM readiness, RM batches.
- Lot label: unchanged. Blank means auto-numbered; a typed value is kept. This already works.

### Calls made in the design

- **Hidden, not deleted.** Database tables, columns, and existing values stay as they are. The JSON
  backup keeps carrying them, so the backup format and `@boat/domain/backup` don't change and old
  backups still import. GRN API routes are switched off with one server-side switch (off by
  default, e.g. a settings flag or env var, builder's choice) and the web app hides GRN from the
  same switch. Switching it back on later restores the screens and routes. It does not restore the
  GRN completion rule (see non-goals).
- Rework and fresh production are always hidden, with no switch.
- Validation for rework and fresh production (including "rework can't exceed fresh production")
  is removed. API writes ignore those fields and leave stored values unchanged.

## 3. Completion = actual date

### Decided

A lot is finished once its actual date is filled in. Clearing the actual date reopens it.

### What changes

- `completed_on` is set to `actual_date` on every lot write, replacing the GRN calculation in
  `modules/lots/lot-lock.ts` (`grn_total` stops driving it). The Active/Completed views, filters,
  and the products-with-open-lots check keep reading `completed_on`, so they follow automatically.
- Domain calculations in `packages/domain/src/calculations.ts`, used by both browser and server:
  - `completed` / `lotFlags.done`: true when `actualDate` is set. Overdue, due-soon, follow-up,
    blocked, and approval flags turn off once done, as today.
  - `lotSummary`: "Completed (stage)" once done.
  - `planDelay`: actual date minus planned completion. Positive means late.
  - `leadTime`: actual date minus the effective RM ready date.
  - Drop `totalGrn`, `balance`, `grnProgress`, `fullGrnDate` from lot views, or leave them unused
    for when GRN returns. Builder's choice, but keep domain coverage at or above 95%.
- **Migration backfill (design call):** for lots that are complete today through GRN
  (`completed_on` set) and have no actual date, set `actual_date = completed_on`. They stay in
  Completed, and the history shows a system entry. Lots with an actual date but no full GRN become
  complete. That's intended.

### Month-end page (agreed)

- **Planned:** lots whose planned completion falls in the month, with their lot quantity.
  Unchanged.
- **Completed:** planned lots whose actual date is on or before the last day of the month. The
  full lot quantity counts.
- **Shortfall:** lot quantity of planned lots not completed by month-end.
- **Removed:** the "GRN received in month" figure.
- No partial progress: a lot that's 90% done counts as 0 until its actual date is entered. The
  client accepted this.

Per-product and per-lot rows keep their shape, with "received" becoming "completed". Update
`monthSummary`, `modules/reports/month-end.service.ts`, the API contract, `MonthEnd.tsx`, and the
month-end CSV.

## 4. Date rules

"Today" is the company date from the server clock (`core/clock.ts`), as the existing rules use.
Every date stays optional; the rules only apply when a value is present.

### Lot dates

| Field (UI name) | Model field | Rule |
|---|---|---|
| RM ready at factory (a forecast) | `rmReadyDate` | Today or later |
| Planned completion | `plannedDate` | Today or later; not before RM ready |
| Current received ETA | `revisedEta` | Today or later; not before RM ready |
| Actual date | `actualDate` | Today or earlier |

### Batch dates ("Add batch")

| Field | Rule |
|---|---|
| Planned date | Today or later |
| Received date | Today or earlier (existing rule) |

### When the rules run (agreed)

- "Today or later" is checked only when the date is new or changed compared with the stored
  record. A lot whose planned date has since passed can still be edited and saved as long as that
  date isn't touched. New records count every filled-in date as new.
- "Today or earlier" is always checked. A past value never becomes invalid.
- "Not before RM ready" is checked when either date in the pair is new or changed. If RM ready is
  empty, the check uses the effective RM ready date only if the builder finds that unambiguous;
  otherwise skip it (builder's call, note it in the tests).

Rules live in `packages/domain/src/validation.ts`. The validators take the previous record (or
null for new) plus the company date, so the browser shows the same errors before saving and the
API enforces them. Error messages name the field and say what's allowed, e.g. "Planned completion
can't be before today." / "Actual date can't be in the future."

Imports from a JSON backup are exempt from "today or later". A restore must accept historical data.

## 5. "Add batch" in track-by-component mode

### Today

In `LotDrawer.tsx` the button is disabled until the lot is saved and has no unsaved changes, with
the hint "Save lot changes before adding a material batch." Ticking Plastic, PCB, Battery, or
Packing gives no visible next step.

### Decided

- Once at least one component is ticked, "Add batch" is visible, enabled, and shown as the primary
  (highlighted) action in the RM section.
- It opens the existing material batch form, which has the planned-date and received-date rules
  from section 4.

### Call made in the design

- If the lot is new or has unsaved changes, clicking "Add batch" saves the lot first, using the
  normal validation and conflict handling, and opens the batch form only if the save succeeds. If
  the save fails, the lot errors show as they do for Save, and the batch form doesn't open. Remove
  the "save first" hint.
- The batch form preselects the component ticked most recently. Today it preselects the first;
  the builder may keep that if tracking "most recent" is awkward.

## Tests and docs to update

- Domain unit tests for the new completion rule, month summary, and date rules (change-only
  behaviour, cross-field checks, import exemption). Keep `test:coverage` at or above 95%.
- API integration tests: Google callback (allowed domain, unknown email, disabled user, wrong
  domain, unverified email); backup-admin password sign-in works and other password sign-in is
  refused; GRN routes off; completion follows actual date; backfill migration; month-end numbers.
  FR-4.x currently pins GRN behaviour. Retire or rewrite those ids and update
  `src/fr-coverage.test.ts`.
- Playwright: global setup currently creates users through the invite-link flow. It needs a test
  path for Google sign-in, e.g. a test-only OIDC stub that's never enabled in production, or
  seeding sessions directly. Replace `grn.spec.ts` and `completion-reversal.spec.ts`; update
  `month-end.spec.ts`, `mobile.spec.ts`, `filters.spec.ts`, `generated-labels.spec.ts`, and
  `support/seed.ts`; add specs for the date errors and for "Add batch" on an unsaved lot. Run on
  both viewports.
- Docs: `apps/api/.env.example` (Google vars; mail is now optional courtesy only),
  `docs/roles-and-permissions.md` and `roleInfo` text (no GRN, no rework), `AGENTS.md` (auth
  description, `grn-receipts` hidden), `docs/demo-walkthrough.md`.

## Suggested order

These ship independently. Order: 4 (dates) and 5 (Add batch), which are small and visible; then 2
and 3 together (hide GRN plus completion by actual date, one migration); then 1 (Google sign-in),
which needs the client's Google Cloud setup and can wait on it.

## Left to the builder

The mechanism for the GRN switch and the backup-admin flag; exact error wording; whether unused
GRN calculations are deleted or parked; the Playwright approach to Google sign-in; and the details
marked as builder's call above.
