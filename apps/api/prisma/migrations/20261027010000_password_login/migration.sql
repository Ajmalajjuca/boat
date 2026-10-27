-- The backup admin is the only account that signs in with a password (FR-11.6); everyone else
-- uses Google. The data change that picks the backup admin is a later migration.
ALTER TABLE "users" ADD COLUMN "password_login" BOOLEAN NOT NULL DEFAULT false;
