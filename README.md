# Supply Chain Control Tower

A frontend-only operational dashboard for production lots, material readiness, partial GRN receipts, completed lots, and incoming finished-goods shipments. Data is stored locally in IndexedDB through Dexie; there is no account, server, or cross-device sync.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown by Vite. On first use, choose fictional demo data or an empty workspace. Use `npm run typecheck` for TypeScript checks, `npm run format:check` for formatting, and `npm run build` for the production bundle. `npm run preview` serves that bundle locally.

## Data and backups

Settings lets you manage dropdown values, export all records as JSON, merge or replace from a validated JSON backup, and reset local data. Merge updates records by ID and keeps one copy of matching dropdown values and setting keys. The header also exports the current filtered production or shipment table as CSV. Browser storage can be cleared, so keep JSON exports as backups.

## Business assumptions

- Lot quantities and RM component quantities are provisionally finished-product-equivalent units. `Balance + total GRN = Lot Qty`.
- Rework quantity is a subset of fresh production, not additional output.
- In component mode, producible quantity is the smallest received total among required components, capped at lot quantity. All RM Received mode handles a kit as a single readiness quantity.
- Completion requires positive lot quantity and full GRN. Dates use date-only comparisons in the user's local calendar.
- Shipment arrival means actual warehouse arrival. A stage label alone does not mark a shipment arrived.

The full implementation plan is in `docs/superpowers/plans/2026-10-05-supply-chain-control-tower.md`.
