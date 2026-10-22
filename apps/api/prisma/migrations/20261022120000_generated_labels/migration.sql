-- References are allocated by PostgreSQL, including across concurrent app instances.
-- Sequences deliberately do not reset when records are deleted or a transaction rolls back.
CREATE SEQUENCE lot_label_seq;
CREATE SEQUENCE rm_batch_label_seq;
CREATE SEQUENCE grn_receipt_label_seq;

-- Continue beyond references already present in an existing installation, including deleted rows.
SELECT setval('lot_label_seq', COALESCE(MAX(substring(label from '[0-9]+$')::bigint), 0) + 1, false)
FROM lots WHERE label ~* '^LOT-[0-9]{1,18}$';
SELECT setval('rm_batch_label_seq', COALESCE(MAX(substring(label from '[0-9]+$')::bigint), 0) + 1, false)
FROM rm_batches WHERE label ~* '^RM-[0-9]{1,18}$';
SELECT setval('grn_receipt_label_seq', COALESCE(MAX(substring(label from '[0-9]+$')::bigint), 0) + 1, false)
FROM grn_receipts WHERE label ~* '^GRN-[0-9]{1,18}$';
