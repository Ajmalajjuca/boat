# Supply Chain Control Tower: guided demo

Use [sample-test-backup.json](./sample-test-backup.json) with this guide. The backup was generated for **6 October 2026** in the Asia/Kolkata time zone. Due-soon and overdue cards change as the calendar moves forward.

## 1. Load the sample workspace

1. Run `npm run dev` and open the local URL Vite prints.
2. On first launch, choose **Start with an empty workspace**. If the app is already initialized, keep the existing workspace and use **Merge** in the next step.
3. Select **Import JSON** in the header, choose `docs/sample-test-backup.json`, leave **Merge** selected, and select **Import records**.

The import adds four fictional products, four lots, six RM batches, four GRN receipts, three shipments, one ETA revision, and two activity notes. Importing into a workspace that already contains records adds these sample records; it does not clear existing records.

In a fresh workspace, the starting values are:

| Area | Expected value |
| --- | ---: |
| Active production lots | 3 |
| Completed lots | 1 |
| Overdue production lots | 1 |
| Due-soon production lots | 1 |
| Blocked production lots | 1 |
| RM-incomplete production lots | 1 |
| Open shipments | 2 |
| Arrived shipments | 1 |
| Units in transit | 1,050 |

## 2. Understand the Production Tracker

The list is grouped by product. Expand **Test EchoPods Lite**, or search for a lot label. Cards can be selected to filter the list; the conditions overlap.

| Lot | What to inspect |
| --- | --- |
| `TEST-EP-001` | 1,000 lot units; delayed, blocked by battery supply, and due soon. |
| `TEST-WB-001` | 750 lot units; overdue. |
| `TEST-SD-001` | 400 lot units; required RM components are fully received. |
| `TEST-EP-002` | Absent from active production because its actual date is set. |

GRN receipts in the backup are kept but hidden while `FEATURE_GRN` is off (the default).

Open `TEST-EP-001`. In **Overview**, inspect ownership, quantities, dates, blocker, and follow-up. In **Updates & History**, see the supplier follow-up note.

## 3. Exercise raw-material readiness

Open `TEST-EP-001` → **RM Readiness**. It requires Plastic, PCBA, and Battery. Their received totals are 1,000, 800, and 600, so the current producible quantity is **600** and readiness is **60%**.

1. Edit batch `TEST-BT-01` and change **Received quantity** from 600 to 1,000. Save it. PCBA becomes the bottleneck at **800**, so readiness becomes **80%**.
2. Edit `TEST-PC-01` and change **Received quantity** from 800 to 1,000. Save it. Readiness becomes **100%**.

This demonstrates that material readiness is calculated separately from production quantity.

## 4. Complete a lot by its actual date

In `TEST-EP-001` → **Overview**, set **Actual date** to today and save. The lot moves to **Completed**. A date in the future is refused; actual dates record what has happened.

Open **Completed** and inspect `TEST-EP-002`. Its actual date is **5 October 2026**; **Actual against planned date** and **RM ready to actual date** are measured from it.

To see completion reverse, clear the actual date on `TEST-EP-002` and save. It returns to Production Tracker. Completion depends on the actual date, not the manually selected status or stage.

## 5. Track finished-goods shipments

Open **Finished Goods**. The shipment list is separate from production lots.

| Shipment | Starting state |
| --- | --- |
| `TEST-SEA-001` | Two product lines totaling 450 units; original ETA 4 Oct, revised ETA 9 Oct; 5-day ETA slip; not arrived. |
| `TEST-AIR-002` | 100 units; actual warehouse arrival recorded. |
| `TEST-SEA-003` | 600 units; ETA 2 Oct; overdue and not arrived. |

Open `TEST-SEA-001` → **ETA revisions & history** to see the recorded port-congestion change. Return to **Shipment details**, set **Current revised ETA** to **10 October 2026**, enter `Customs inspection` as the reason, and save. The history gains another revision and the ETA slip becomes **6 days**. Set **Actual warehouse arrival** to **6 October 2026** and save; it now counts as arrived. Arrival is determined by this date, independently of the stage label.

## 6. Create a product lot from scratch

Back in **Production Tracker**, find **Test PartyPulse 500**. It has no active lot but still has an **Add lot** action.

1. Select **Add lot** and enter label `TEST-PP-001`, lot quantity **250**, All RM Received ready quantity **250**, and a planned date of today or later.
2. Switch **RM Readiness** to **Track by Component** and tick **Battery**. **Add batch** is available at once; it saves the lot first and opens the batch form.
3. Set the lot's **Actual date** to today and save. The lot moves to **Completed**.

## 7. Check settings, export, and persistence

In **Settings**, inspect the dropdown categories. Add an EMS value such as `Nimbus Assembly`; it becomes available in lot forms. A value assigned to a lot cannot be deleted until that lot is reassigned.

Use **Export JSON** for a full backup. The **CSV** button exports the currently filtered lot or shipment view. Refresh the browser page and confirm the imported records and your edits remain. **Reset all application data** clears the current browser workspace and returns to the first-launch choice, so export a JSON backup before using it.

> The sample is fictional. It is intended for a local demo and should not be mixed with production records unless the resulting merged workspace is acceptable.
