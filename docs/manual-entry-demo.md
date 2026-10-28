# Manual-entry test data and walkthrough

This walkthrough tests the full-stack app (API + PostgreSQL) by hand. Everything is entered through the screens; no JSON import is needed until section 8.

Dates are set for **17 October 2026** in the default time zone (Asia/Kolkata). If you test on another day, the date-based cards (overdue, follow-ups due) will differ.

## 0. Start the app

```bash
nvm use && corepack enable && pnpm install
cp apps/api/.env.example apps/api/.env        # skip if it already exists
docker compose up -d db
pnpm --filter @boat/api db:migrate
pnpm api create-admin --email admin@example.test --name "Test Admin"
```

`create-admin` prints the backup admin's password once; keep it. Then run these two side by side:

```bash
pnpm --filter @boat/api dev    # API on :3000
pnpm dev                       # web on http://localhost:5173
```

Open the web app, choose **Admin password sign-in**, and sign in with that email and password.

To start again from empty later: **Settings → Reset all application data** as admin (it keeps users, dropdowns and settings), or `docker compose down -v` and repeat the steps above.

## 1. Set up the dropdowns (Settings)

A new database contains only the six system values: **On Track, Delayed, Hold** (lot statuses), **None, Approval Blocker** (blocker categories) and **BAU** (product categories). Add the rest under **Settings**:

| Settings list | Values to add |
| --- | --- |
| Segments | PA / TWS, Headphones & Neckbands, BT Speakers, Soundbars, Party Speakers |
| Product categories | NPI |
| Manufacturing partners | Orion EMS, Aster Manufacturing, Delta Assembly |
| Points of contact | Maya Shah, Rohit Mehta, Anika Rao |
| Production stages | RM Sourcing, Factory Production, Ready at Factory, PDI/QC, In Transit to WH |
| Blocker categories | RM Blocker, Quality-PDI Blocker, Manpower Constraint, Logistics-Customs Blocker, Other |
| Logistics modes | Road, Air, Sea, Rail |
| RM components | Kit (All Together), Plastic, PCBA, Battery, Shell, Packaging, EVA, Other |
| Shipment stages | In Transit, Reached Port, CFS Movement Awaited, Arrived at Warehouse |

These are the same values as in `docs/sample-test-backup.json`, so importing that file later with **merge** adds no duplicates. The walkthrough below uses only some of them.

**Check:** try to rename or delete **On Track** or **BAU**. The app should refuse, because calculations depend on them. Add **PCBA** a second time in another case (`pcba`). The app should refuse the duplicate.

## 2. Add two products

Select **Add Product** and save each one.

| Product name | Variant | Segment |
| --- | --- | --- |
| Demo EchoPods Lite | Slate Black | PA / TWS |
| Demo WaveBand Flex | Ocean Blue | Headphones & Neckbands |

## 3. Add a lot with a material shortage

Select **Add lot** for **Demo EchoPods Lite**. Fill in these fields in **Overview** and leave the rest blank or at their defaults.

| Field | Value |
| --- | --- |
| Lot label | `DEMO-TWS-001` |
| Product category | NPI |
| Manufacturing partner (EMS) | Orion EMS |
| Point of contact | Maya Shah |
| Overall status | Delayed |
| Current stage | Factory Production |
| Lot quantity | `100` |
| Fresh production quantity | `45` |
| Rework quantity | `5` |
| Rework reason | Charging pin alignment |
| RM readiness mode | Track by Component |
| Planned completion / WH receipt | `2026-10-16` |
| Current revised ETA | `2026-10-19` |
| Logistics mode | Road |
| Blocker category | RM Blocker |
| Blocker description | Battery batch pending |
| Follow-up date | `2026-10-17` |
| Follow-up note | Confirm battery dispatch |

Open **RM Readiness**, select **Plastic**, **PCBA** and **Battery**, then select **Save lot**. Add these batches one at a time:

| Component | Batch label | Planned qty | Received qty | Planned date | Received date | Status |
| --- | --- | ---: | ---: | --- | --- | --- |
| Plastic | `DEMO-PL-01` | 100 | 100 | `2026-10-12` | `2026-10-14` | Received |
| PCBA | `DEMO-PC-01` | 100 | 80 | `2026-10-12` | `2026-10-14` | Partial |
| Battery | `DEMO-BT-01` | 100 | 60 | `2026-10-12` | `2026-10-14` | Partial |

**Check:** RM readiness is **60%**, and **Battery** is the bottleneck. The lot appears among today's follow-ups.

Open **GRN Receipts** and add:

| Receipt label | Receipt date | Quantity | Note |
| --- | --- | ---: | --- |
| `DEMO-GRN-001` | `2026-10-16` | 20 | First cartons received |

**Check:** total GRN is **20**, the balance is **80**, and the lot stays in **Production Tracker**.

## 4. Add and complete a second lot

Select **Add lot** for **Demo WaveBand Flex**.

| Field | Value |
| --- | --- |
| Lot label | `DEMO-NB-001` |
| Product category | BAU |
| Manufacturing partner (EMS) | Aster Manufacturing |
| Point of contact | Rohit Mehta |
| Direct FG | Checked |
| Overall status | On Track |
| Current stage | In Transit to WH |
| Lot quantity | `50` |
| Fresh production quantity | `50` |
| RM readiness mode | All RM Received |
| Ready quantity | `50` |
| RM ready date at factory | `2026-10-06` |
| Planned completion / WH receipt | `2026-10-14` |
| Actual date | `2026-10-16` |
| Logistics mode | Road |

Save the lot, then add two GRN receipts:

| Receipt label | Receipt date | Quantity |
| --- | --- | ---: |
| `DEMO-GRN-002` | `2026-10-15` | 20 |
| `DEMO-GRN-003` | `2026-10-16` | 30 |

**Check:** the 50-unit lot moves to **Completed**. Its full-GRN date is **16 October 2026**, and its RM-to-GRN lead time is **10 days**.

## 5. Add a finished-goods shipment

Open **Finished Goods → Add Shipment**. Enter the shipment details and leave revised ETA and arrival blank for now.

| Field | Value |
| --- | --- |
| Shipment / invoice number | `DEMO-INV-001` |
| Vessel / flight | MV Practice Star |
| ETD | `2026-10-09` |
| Original planned ETA | `2026-10-15` |
| Current stage | In Transit |
| Remarks | Practice shipment for manual testing |

Add two product lines with **Add product line**:

| Product | Quantity |
| --- | ---: |
| Demo EchoPods Lite | 30 |
| Demo WaveBand Flex | 20 |

Save the shipment. **Check:** it shows **50 units** and is overdue as of 17 October.

Reopen it, set **Current revised ETA** to `2026-10-20`, enter `Port congestion` as the **ETA change reason**, and save. Open **ETA revisions & history**. **Check:** it lists one revision, and the ETA slip is **5 days**.

Finally, set **Actual warehouse arrival** to `2026-10-17`, change the stage to **Arrived at Warehouse**, and save. **Check:** the shipment now counts as arrived.

## 6. Test the important reversals

1. On `DEMO-TWS-001`, change Battery's received quantity from **60 to 100**. Readiness becomes **80%**, because PCBA is now the bottleneck. Change PCBA from **80 to 100**. Readiness becomes **100%**.
2. Add another GRN receipt of **80 units** to `DEMO-TWS-001`. The lot moves to **Completed**. Edit that receipt down to **70**. The lot returns to Production Tracker with a balance of **10**.
3. On `DEMO-NB-001`, reduce its 30-unit receipt to **20**. The lot leaves Completed. Put the receipt back to **30**.
4. Refresh the page, and also open the app in a different browser. Every product, lot, batch, receipt, shipment change and history entry is still there, because the data now lives on the server.

## 7. Roles and sign-in

This section needs Google sign-in set up (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_ALLOWED_DOMAINS` in `apps/api/.env`, as `.env.example` describes) and three Google accounts on the company domain. As admin, open **Settings → Users → Add user** and add them with these names and roles; replace the example addresses with theirs. Each access email is printed in the API log.

| Name | Email | Role | Point of contact |
| --- | --- | --- | --- |
| Test Planner | planner@example.test | Planner | — |
| Maya Shah | maya@example.test | POC | Maya Shah |
| Test Viewer | viewer@example.test | Viewer | — |

Sign in as each with **Sign in with Google** in a private window, or in another browser so the admin stays signed in, then check:

| Signed in as | Should be able to | Should not be able to |
| --- | --- | --- |
| Planner | Add or edit products, lots and shipments; delete RM batches and GRN receipts; export JSON | Open Settings or Users; import, restore or reset; delete lots, products or shipments |
| POC (Maya Shah) | Update status, quantities, ETAs, blockers, batches, receipts and notes on `DEMO-TWS-001` | Edit plan fields (lot label, EMS, POC, lot quantity, planned date); edit `DEMO-NB-001`, which belongs to Rohit Mehta; add lots |
| Viewer | Browse every screen; download CSVs | Change anything |

Then check sign-in itself:

1. **Not added:** sign in with a Google account nobody added. Sign-in shows **"This Google account hasn't been given access. Ask your admin to add you."**
2. **Wrong password:** under **Admin password sign-in**, each failed attempt shows an error. After 5 failures within 15 minutes, sign-in shows **"Too many failed attempts. Wait 15 minutes and try again."** The limit also applies per IP address, so do this test last, or locally it will block every account for 15 minutes (restarting the API clears it).
3. **Lost backup password:** run `create-admin` again with the same email. It prints a new password and ends that account's sessions.
4. **Disable a user:** as admin, disable the viewer while they are signed in. Their next action shows **"Your session ended. Sign in again."**
5. **Idle sign-out:** set **Idle sign-out (minutes)** in Settings to a small value, wait, and confirm the app signs you out.

## 8. Conflicts, reports and data

1. **Edit conflict:** open `DEMO-TWS-001` in two tabs. Save a change in the first tab, then save a different change in the second. The second tab shows **"Someone else changed this … while you were editing"** and doesn't overwrite the first change.
2. **Month-end Summary:** open it for October 2026 and confirm the completed lot and the arrived shipment appear.
3. **CSV exports:** download the lots, shipments and month-end CSVs and open them in a spreadsheet.
4. **Backup round trip:** as admin, use **Export JSON**, then **Settings → Reset all application data**, then **Import JSON** with **replace**. Everything from sections 2–6 returns.
5. **Sample backup:** **Import JSON** with `docs/sample-test-backup.json` (merge or replace) and browse the larger data set.
