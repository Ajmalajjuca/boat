-- The six values the calculations depend on (FR-8.2). Code finds them by system_key, never by
-- display text. Skipped when a database already has them, by key or by text.
INSERT INTO lookup_values (id, kind, value, system_key, sort, updated_at)
SELECT gen_random_uuid(), v.kind::"LookupKind", v.value, v.system_key, v.sort, now()
FROM (VALUES
  ('status', 'On Track', 'on_track', 0),
  ('status', 'Delayed', 'delayed', 1),
  ('status', 'Hold', 'hold', 2),
  ('blocker', 'None', 'none', 0),
  ('blocker', 'Approval Blocker', 'approval_blocker', 1),
  ('category', 'BAU', 'bau', 0)
) AS v(kind, value, system_key, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM lookup_values l
  WHERE l.kind = v.kind::"LookupKind"
    AND l.deleted_at IS NULL
    AND (l.system_key = v.system_key OR lower(l.value::text) = lower(v.value))
);
