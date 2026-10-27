-- FR-11.6: staff sign in with Google. One backup admin keeps a password so the app stays
-- reachable if Google sign-in fails: the earliest active admin who has one. Every other
-- password is cleared. The create-admin command can pick another backup admin later.
UPDATE users SET password_login = true
WHERE id = (
  SELECT id FROM users
  WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL AND password_hash IS NOT NULL
  ORDER BY created_at
  LIMIT 1
);

UPDATE users SET password_hash = NULL WHERE password_login = false;
