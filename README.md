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
- Fresh production and GRN are not capped by each other or by Lot Qty; the client's data has production above Lot Qty and GRN with no production entered.
- Completed lots show the full GRN date (latest receipt), days late or early against the planned date, and RM-to-GRN lead time. In component mode a blank RM ready date is derived from the batch that last brought a required component up to Lot Qty.
- Each lot shows a one-line status in the client's format, e.g. `Delayed, 1d left — RM Blocker (Factory Production)`, counted from the current ETA.
- Month-end Summary compares the Lot Qty of lots whose original planned date falls in a month with the GRN received for those lots by the last day of that month, by product and by lot. Revised ETAs do not move a lot out of the month it was planned for. "All GRN in month" separately counts every receipt dated that month.
- Shipment status reads `Overdue Nd` from the current ETA, or `Arrived Nd late/early` against the original planned ETA.
- Completion requires positive lot quantity and full GRN. Dates use date-only comparisons in the user's local calendar.
- Shipment arrival means actual warehouse arrival. A stage label alone does not mark a shipment arrived.
- Quantities are whole units. GRN receipt dates and actual warehouse arrival cannot be in the future, and shipment ETAs and arrival cannot be before ETD.
- Lot labels are unique within a product, shipment invoice numbers are unique, and a product appears once per shipment.
- Every form checks required fields and rules before saving and shows the message under the field; the same rules are enforced again when records are written. Drawers offer **Save** (stay open) and **Save & close**.
- Saved records must use values that exist in Settings, so every JSON export can be imported again. The values `On Track`, `Delayed`, `Hold`, `None`, `Approval Blocker`, and `BAU` drive the summary cards and cannot be renamed or deleted.

The full implementation plan is in `docs/superpowers/plans/2026-10-05-supply-chain-control-tower.md`.
