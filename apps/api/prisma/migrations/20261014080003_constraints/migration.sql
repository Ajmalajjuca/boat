-- Business rules Prisma cannot express. Prisma Migrate leaves CHECK constraints alone.
ALTER TABLE lots ADD CONSTRAINT lots_quantities_check
  CHECK (lot_qty >= 0 AND fresh_production_qty >= 0 AND rework_qty >= 0 AND ready_qty >= 0 AND grn_total >= 0);
ALTER TABLE lots ADD CONSTRAINT lots_rework_check CHECK (rework_qty <= fresh_production_qty);
ALTER TABLE lots ADD CONSTRAINT lots_grn_total_check CHECK (grn_total <= lot_qty);
ALTER TABLE grn_receipts ADD CONSTRAINT grn_receipts_quantity_check CHECK (quantity > 0);
ALTER TABLE rm_batches ADD CONSTRAINT rm_batches_quantities_check CHECK (planned_qty >= 0 AND received_qty >= 0);
ALTER TABLE shipments ADD CONSTRAINT shipments_dates_check CHECK (
  etd IS NULL OR (
    (planned_eta IS NULL OR planned_eta >= etd) AND
    (revised_eta IS NULL OR revised_eta >= etd) AND
    (actual_arrival IS NULL OR actual_arrival >= etd)
  )
);
ALTER TABLE shipment_items ADD CONSTRAINT shipment_items_quantity_check CHECK (quantity > 0);
