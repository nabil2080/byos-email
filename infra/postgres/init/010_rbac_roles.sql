-- Section 15: Organization RBAC roles
-- Adds role column to users table and identifies the organization owner.

DO $$
BEGIN
    -- Add role column to users table if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'role'
    ) THEN
        ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'member';
    END IF;

    -- Ensure role values are valid
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('owner', 'admin', 'member'));
    END IF;
END $$;

-- The organization owner is the user who created the organization.
-- This is tracked by the application logic: the first user to register an organization
-- becomes the owner. The org_id in the users table links users to organizations.
-- No additional column needed in organizations table; ownership is determined by
-- the application: the user who created the org is the owner.

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_org_role ON users(org_id, role);