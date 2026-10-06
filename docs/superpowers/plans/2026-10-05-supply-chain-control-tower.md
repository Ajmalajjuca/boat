# Supply Chain Control Tower Implementation Plan

**Goal:** Deliver a complete browser-only control tower for production lots and incoming finished goods.

**Architecture:** React views use typed domain records and centralized calculations. Dexie owns versioned IndexedDB persistence; repository functions validate and transact related changes. Shared UI primitives and feature-specific editors keep the table compact.

**Stack:** React, TypeScript, Vite, Tailwind CSS, shadcn-style UI primitives, Lucide, Dexie.

**Constraints:** No backend, authentication, integrations, deployment, test files, or test framework. Verify manually and run TypeScript and production build.

**Reference review:** `10_2_2026-Meeting.txt` and selected frames from `10_2_2026-Meeting.mp4` became available during implementation. They confirm the compact product-grouped table, full-GRN completion, partial receipts, status summaries, ETA change history, and preference for low-friction manual entry. The explicit user requirements govern business rules and scope where the meeting is informal or ambiguous.

## Screens and flows

1. **Production Tracker:** Cards expose overlapping lot conditions. Search, filters, sorting, grouping, visible columns, and expand controls narrow the active list. Product form adds a product; each product can add lots; lot rows open a detail drawer.
2. **Completed:** The same list and drawer show lots whose receipt sum equals a positive lot quantity. Editing receipts can move a lot between views.
3. **Finished Goods:** Shipment summaries and a searchable/filterable table lead to a form with multiple product lines, ETA changes, and arrival. Editing an ETA creates an immutable revision.
4. **Settings:** Manage lookup values with in-use deletion protection; show assumptions; export/import/reset data and first-use demo choice.

## Data and calculations

- Tables: products, lots, rmBatches, grnReceipts, shipments, shipmentItems, etaRevisions, activityLogs, lookupValues, settings. All records have stable IDs and timestamps; relationship fields are indexed.
- Lot completion, balance, full GRN date, lead time, status card counts, RM bottleneck, shipment slip, delay, and effective ETA live in one calculation module. Dates remain ISO date-only strings and compare without timezone conversion.
- Kit RM mode is exclusive of individual components. Component received totals are finished-product-equivalent units. Producible quantity is the smallest required component total, capped at lot quantity. Rework is a subset of fresh production.
- Save forms on explicit commit, show saving/saved/error state, confirm dirty drawer closure, and log meaningful committed field and receipt changes. Related records are saved and deleted in Dexie transactions.

## Implementation phases

1. Scaffold the app, styling, models, calculations, schema, lookup seed, and relative-date demo data.
2. Build application shell, shared inputs, Production and Completed tables, product/lot editors, RM batches, receipts, and history.
3. Build Finished Goods table, shipment editor, multiple lines, ETA revision history, and summaries.
4. Build Settings, JSON merge/replace validation and backups, CSV exports, preferences, responsive polish, loading/empty/error states.
5. Run `npm run typecheck` and `npm run build`; manually exercise all requested workflows in a browser and fix issues.

## Provisional decisions

- Shipment arrival is actual warehouse arrival; an arrived shipment may retain its manually chosen logistics stage.
- Merge import updates records with matching IDs and inserts otherwise; relationships must resolve in the combined result. Replace validates the entire payload before the transaction begins.
- Deleting a product cascades to its lots, material batches, receipts, and lot activity only after confirmation describing the impact; lookup values in use cannot be deleted.
- Initial records are seeded only after a deliberate Demo or Start empty choice. Reset returns to this choice; existing data is never automatically reseeded.
