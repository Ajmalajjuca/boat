-- A lot is complete once its actual date is set (FR-11.3), no longer at full GRN. Lots that
-- finished through GRN keep their completion date as their actual date, with a history entry.
INSERT INTO activity_logs (id, entity_type, entity_id, kind, message, actor_id, actor_name, created_at)
SELECT gen_random_uuid(), 'lot', id, 'updated', 'Actual date set from the full GRN date', NULL, NULL, now()
FROM lots
WHERE completed_on IS NOT NULL AND actual_date IS NULL AND deleted_at IS NULL;

UPDATE lots SET actual_date = completed_on
WHERE completed_on IS NOT NULL AND actual_date IS NULL AND deleted_at IS NULL;

-- completed_on now mirrors actual_date on every lot write.
UPDATE lots SET completed_on = actual_date WHERE completed_on IS DISTINCT FROM actual_date;
