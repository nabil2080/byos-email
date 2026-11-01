-- Migration 067: Grant account suspension privileges to role_support_agent
-- Preserves Zero-Knowledge isolation: grants ONLY status/is_active/updated_at.
-- Strictly NO access to password_hash, recovery_auth_pk, totp_secret, or mailbox private keys.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_support_agent') THEN
    -- Users table: Allow support staff to inspect status and update suspension status
    GRANT SELECT (status) ON users TO role_support_agent;
    GRANT UPDATE (status, is_active, updated_at) ON users TO role_support_agent;

    -- Mailboxes table: Allow support staff to inspect status and cascade suspension status
    GRANT SELECT (status) ON mailboxes TO role_support_agent;
    GRANT UPDATE (status, is_active, updated_at) ON mailboxes TO role_support_agent;

    -- Sessions table: Allow support staff to inspect user_id and terminate sessions when suspending an account
    GRANT SELECT (id, user_id) ON sessions TO role_support_agent;
    GRANT DELETE ON sessions TO role_support_agent;
  END IF;
END $$;
