-- Privileges for boat_app, the role the running app connects as. Re-run after every migration
-- (pnpm --filter @boat/api db:migrate does both). Fails if boat_app does not exist.
-- The app may read, insert and update; it may never delete, and history is insert-only.
GRANT USAGE ON SCHEMA public TO boat_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM boat_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO boat_app;
REVOKE ALL ON TABLE _prisma_migrations FROM boat_app;
REVOKE UPDATE ON TABLE activity_logs, eta_revisions FROM boat_app;

-- A role membership (for example pg_write_all_data via Neon's neon_superuser) would quietly
-- restore DELETE. Refuse to finish rather than deploy without the soft-delete guarantee.
DO $$
BEGIN
  IF has_table_privilege('boat_app', 'products', 'DELETE')
     OR has_table_privilege('boat_app', 'activity_logs', 'UPDATE') THEN
    RAISE EXCEPTION 'boat_app can still delete rows or rewrite history; check its role memberships';
  END IF;
END $$;
