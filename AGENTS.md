# Repository Guidelines

## Project Structure & Module Organization

This is a frontend-only React application. `src/App.tsx` owns navigation and global data actions. `src/Production.tsx`, `src/LotDrawer.tsx`, `src/MonthEnd.tsx`, `src/Shipments.tsx`, and `src/Settings.tsx` contain the operational views and editors. Keep domain types in `src/models.ts`, date and quantity rules in `src/calculations.ts`, field validation rules shared by forms and saves in `src/validation.ts`, role permissions and PIN helpers in `src/access.ts` (sign-in and profile screens are in `src/Profiles.tsx`), and IndexedDB writes and import validation in `src/repository.ts`. `src/db.ts` defines the versioned Dexie schema; `src/demo.ts` holds first-use lookup values and fictional records. Shared shadcn-style primitives live in `src/ui.tsx`; global Tailwind and component styles are in `src/index.css`.

## Build and Development Commands

Run `npm install` once, then `npm run dev` for the local Vite server. `npm run typecheck` checks TypeScript without emitting files. `npm run format:check` checks Prettier formatting. `npm run build` runs the type check and creates a production bundle in `dist/`; `npm run preview` serves it locally. The application has no backend or environment variables.

## Coding Style & Naming Conventions

Use strict TypeScript and functional React components. Keep storage, calculations, and presentation separate. Use PascalCase for components and model interfaces, camelCase for functions and fields, and descriptive feature names for files. Preserve ISO `YYYY-MM-DD` strings for date-only business rules. Run `npm run format` for Prettier's two-space, single-quote, no-semicolon style. Tailwind utility classes and the reusable primitives in `ui.tsx` provide consistent controls and focus states.

## Verification Guidelines

This initial scope deliberately has no test framework or test files. Before review, run `npm run typecheck` and `npm run build`, then manually exercise product and lot creation, RM batches, partial and full GRN, completion reversal, month-end summary, shipments, ETA history, filters, JSON backup and restore, roles (setup, each role's limits, sign-in, recovery key, idle lock), and mobile layouts. Check that data survives refresh in the same browser profile.

## Commits and Pull Requests

The workspace has no usable Git history, so no established commit pattern can be inferred. Use short imperative subjects such as `Add shipment ETA history`. Pull requests should summarize affected flows, list manual verification, link relevant issues, and include screenshots for visual changes. Do not include generated `dist/` or `node_modules/` files.
