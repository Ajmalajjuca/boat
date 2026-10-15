-- system_lookups skipped a value whose text already existed but never gave that row its key.
-- Code finds system values by key, so fill it in, unless another active row already has it.
UPDATE lookup_values l
SET system_key = v.system_key
FROM (VALUES
  ('status', 'On Track', 'on_track'),
  ('status', 'Delayed', 'delayed'),
  ('status', 'Hold', 'hold'),
  ('blocker', 'None', 'none'),
  ('blocker', 'Approval Blocker', 'approval_blocker'),
  ('category', 'BAU', 'bau')
) AS v(kind, value, system_key)
WHERE l.kind = v.kind::"LookupKind"
  AND lower(l.value::text) = lower(v.value)
  AND l.system_key IS NULL
  AND l.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM lookup_values k
    WHERE k.kind = l.kind AND k.system_key = v.system_key AND k.deleted_at IS NULL
  );
