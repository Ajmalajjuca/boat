# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm monorepo. `apps/web` is the React application: `src/App.tsx` owns navigation and global data actions, and `src/Production.tsx`, `src/LotDrawer.tsx`, `src/MonthEnd.tsx`, `src/Shipments.tsx` and `src/Settings.tsx` contain the operational views and editors. Sign-in and profile screens are in `src/Profiles.tsx`, IndexedDB writes and import validation in `src/repository.ts`, the Dexie schema in `src/db.ts`, demo records in `src/demo.ts`, shared primitives in `src/ui.tsx`, and global styles in `src/index.css`.

`packages/domain` holds the rules shared by the browser and the server: domain types in `src/models.ts`, date and quantity rules in `src/calculations.ts`, field validation in `src/validation.ts`, and role permissions in `src/permissions.ts`. The web app's `models.ts`, `calculations.ts` and `validation.ts` re-export it, and `access.ts` keeps the browser-only PIN, session and React context helpers.

`apps/api` is the Express API. `src/app.ts` builds the app, `src/server.ts` starts it, `src/core/` holds shared middleware and the Prisma client, and `src/modules/<area>/` holds one folder per business area. `prisma/schema.prisma` and `prisma/migrations/` define the PostgreSQL schema, and `prisma/grants.sql` sets the app role's privileges after every migration. Every API route starts with `publicRoute()`, `requireSignedIn()` or `requirePermission(action)` from `src/core/access.ts`. `src/api.test.ts` fails for a route without one, and holds the table of every route and its permission, so add a row with each new route. Integration tests use `createTestDatabase()` and the fixtures in `test/support/`. Record modules (`lookups`, `products`, `lots`, `rm-batches`, `grn-receipts`, `activity`) lock the lot row before any change to a lot or its entries (`modules/lots/lot-lock.ts`), resolve dropdown ids with `resolveLookups`, run the shared `@boat/domain` validators, and write history with `recordActivity` in the same transaction. Lot reads map rows to the domain's shapes in `modules/lots/lot-view.ts`, so computed fields come from the same functions as the browser. An integration test that pins a functional requirement starts its title with the id (`FR-4.2 …`); `src/fr-coverage.test.ts` checks every one is covered.

## Build and Development Commands

Use Node 24 (`nvm use`) and pnpm (`corepack enable`). Run `pnpm install` once, then `pnpm dev` for the web app. `pnpm typecheck`, `pnpm test`, `pnpm format:check` and `pnpm build` run across all packages. For the API, `docker compose up -d db` starts Postgres, `pnpm --filter @boat/api db:migrate` applies migrations and grants, `pnpm --filter @boat/api dev` starts the server, and `pnpm --filter @boat/api test:int` runs the database tests (Docker required). Copy `apps/api/.env.example` to `apps/api/.env` first. `pnpm api create-admin --email <address> --name <name>` invites the first admin of a new database.

## Coding Style & Naming Conventions

Use strict TypeScript and functional React components. Keep storage, calculations, and presentation separate. Use PascalCase for components and model interfaces, camelCase for functions and fields, and descriptive feature names for files. Preserve ISO `YYYY-MM-DD` strings for date-only business rules. Run `pnpm format` for Prettier's two-space, single-quote, no-semicolon style. Tailwind utility classes and the reusable primitives in `ui.tsx` provide consistent controls and focus states.

## Verification Guidelines

Business rules are unit-tested in `packages/domain` (`pnpm --filter @boat/domain test:coverage` must stay at or above 95% line coverage). API behaviour is tested with Supertest, and the database with Testcontainers. CI runs all of them. Until the web app switches to the API, also manually exercise product and lot creation, RM batches, partial and full GRN, completion reversal, month-end summary, shipments, ETA history, filters, JSON backup and restore, roles (setup, each role's limits, sign-in, recovery key, idle lock), and mobile layouts, and check that data survives refresh in the same browser profile.

## Commits and Pull Requests

The workspace has no usable Git history, so no established commit pattern can be inferred. Use short imperative subjects such as `Add shipment ETA history`. Pull requests should summarize affected flows, list manual verification, link relevant issues, and include screenshots for visual changes. Do not include generated `dist/` or `node_modules/` files.
