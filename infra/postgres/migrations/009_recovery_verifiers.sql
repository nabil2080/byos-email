-- Section 15: Recovery authentication verifiers
-- Adds recovery_auth_pk and recovery_auth_version to users table.
-- recovery_auth_pk is NULL until enrollment; never backfilled server-side.
-- recovery_auth_version checks that enrollment is version 1 or NULL.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'recovery_auth_pk'
    ) THEN
        ALTER TABLE users ADD COLUMN recovery_auth_pk bytea NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'recovery_auth_version'
    ) THEN
        ALTER TABLE users ADD COLUMN recovery_auth_version smallint NULL;
    END IF;

    -- Apply the CHECK constraint only if it doesn't already exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_recovery_auth_version_check'
    ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_recovery_auth_version_check
        CHECK (recovery_auth_version IS NULL OR recovery_auth_version = 1);
    END IF;

    -- Create unique index on recovery_auth_pk where not NULL
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_recovery_auth_pk'
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_recovery_auth_pk
        ON users (recovery_auth_pk)
        WHERE recovery_auth_pk IS NOT NULL;
    END IF;
END $$;