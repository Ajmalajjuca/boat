-- Local Docker database only. On Neon, create the role once by hand with a strong password:
--   CREATE ROLE boat_app LOGIN PASSWORD '<generated>';
-- Use SQL, not the Neon console: console roles join neon_superuser and may inherit DELETE.
CREATE ROLE boat_app LOGIN PASSWORD 'boat_app';
