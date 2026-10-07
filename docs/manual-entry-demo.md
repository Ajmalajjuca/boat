# Manual-entry demo data and walkthrough

Start with **Start with an empty workspace**. Enter every record through the application forms; no JSON import is needed.

These dates are set for **6 October 2026**. Date-based cards will change if you test later.

## 1. Add two products

Select **Add Product** and save each product.

| Product name | Variant | Segment |
| --- | --- | --- |
| Demo EchoPods Lite | Slate Black | PA / TWS |
| Demo WaveBand Flex | Ocean Blue | Headphones & Neckbands |

## 2. Add a lot with a material shortage

Select **Add lot** for **Demo EchoPods Lite**. Enter these values in **Overview**; leave fields not listed blank or at their default.

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
| Planned completion / WH receipt | `2026-10-05` |
| Current revised ETA | `2026-10-08` |
| Logistics mode | Road |
| Blocker category | RM Blocker |
| Blocker description | Battery batch pending |
| Follow-up date | `2026-10-06` |
| Follow-up note | Confirm battery dispatch |

Open **RM Readiness**, select **Plastic**, **PCBA**, and **Battery**, then select **Save lot**. Add these batches one at a time:

| Component | Batch label | Planned qty | Received qty | Planned date | Received date | Status |
| --- | --- | ---: | ---: | --- | --- | --- |
| Plastic | `DEMO-PL-01` | 100 | 100 | `2026-10-01` | `2026-10-03` | Received |
| PCBA | `DEMO-PC-01` | 100 | 80 | `2026-10-01` | `2026-10-03` | Partial |
| Battery | `DEMO-BT-01` | 100 | 60 | `2026-10-01` | `2026-10-03` | Partial |

**Check:** RM readiness is **60%**, with **Battery** as the bottleneck.

Open **GRN Receipts** and add:

| Receipt label | Date | Quantity | Note |
| --- | --- | ---: | --- |
| `DEMO-GRN-001` | `2026-10-05` | 20 | First cartons received |

**Check:** total GRN is **20**, balance is **80**, and the lot remains in Production Tracker.

## 3. Add and complete a second lot

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
| RM ready date at factory | `2026-09-25` |
| Planned completion / WH receipt | `2026-10-03` |
| Actual date | `2026-10-05` |
| Logistics mode | Road |

Save the lot, then add two GRN receipts:

| Receipt label | Date | Quantity |
| --- | --- | ---: |
| `DEMO-GRN-002` | `2026-10-04` | 20 |
| `DEMO-GRN-003` | `2026-10-05` | 30 |

**Check:** the 50-unit lot moves to **Completed**. Its full GRN date is **5 October 2026**, and RM-to-GRN lead time is **10 days**.

## 4. Add a finished-goods shipment

Open **Finished Goods → Add Shipment**. Enter the shipment details, leaving revised ETA and arrival blank initially.

| Field | Value |
| --- | --- |
| Shipment / invoice number | `DEMO-INV-001` |
| Vessel / flight | MV Practice Star |
| ETD | `2026-09-28` |
| Original planned ETA | `2026-10-04` |
| Current stage | In Transit |
| Remarks | Practice shipment for manual testing |

Add two product lines:

| Product | Quantity |
| --- | ---: |
| Demo EchoPods Lite | 30 |
| Demo WaveBand Flex | 20 |

Save the shipment. **Check:** it has **50 units** and is overdue as of 6 October.

Reopen it, set **Current revised ETA** to `2026-10-09`, enter **ETA change reason** `Port congestion`, and save. Open **ETA revisions & history**: there is a revision, and ETA slip is **5 days**.

Finally, set **Actual warehouse arrival** to `2026-10-06`, change the stage to **Arrived at Warehouse**, and save. **Check:** it now counts as arrived.

## 5. Test the important reversals

1. On `DEMO-TWS-001`, change Battery received quantity from **60 to 100**. Readiness becomes **80%** because PCBA is now the bottleneck. Change PCBA from **80 to 100**; readiness becomes **100%**.
2. Add another GRN receipt to `DEMO-TWS-001` for **80 units**. It moves to **Completed**. Edit that receipt down to **70**; it returns to Production Tracker with a balance of **10**.
3. On `DEMO-NB-001`, reduce its 30-unit receipt to **20**. It leaves Completed. Restore the receipt to **30**.
4. Refresh the page. All saved products, lots, batches, receipts, shipment changes, and history remain present.

This covers the full manual journey: **product → lot → RM batches → partial GRN → completed lot → completion reversal**, plus **multi-product shipment → ETA revision → warehouse arrival**.
