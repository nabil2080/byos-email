-- Phase 1: Infrastructure Isolation & Database Guardrails for Support CRM
-- This migration initializes the support agent role, enforces zero-knowledge constraints,
-- and creates the immutable audit ledger.

-- 1. Create the dedicated restricted database role
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_catalog.pg_roles
        WHERE rolname = 'role_support_agent'
    ) THEN
        CREATE ROLE role_support_agent LOGIN PASSWORD 'support_crm_password';
    END IF;
END $$;

-- 2. Grant basic connection and USAGE privileges
GRANT CONNECT ON DATABASE byos TO role_support_agent;
GRANT USAGE ON SCHEMA public TO role_support_agent;

-- Grant SELECT on all tables by default, but we will selectively revoke sensitive columns
GRANT SELECT ON ALL TABLES IN SCHEMA public TO role_support_agent;

-- 3. Revoke sensitive columns from role_support_agent
REVOKE SELECT (password_hash, recovery_auth_pk) ON users FROM role_support_agent;
REVOKE SELECT (mailbox_sk_wrapped) ON mailboxes FROM role_support_agent;
REVOKE SELECT (root_secret_wrapped) ON root_secrets FROM role_support_agent;
REVOKE SELECT (content_key_hpke_wrapped, encryption_iv) ON message_metadata FROM role_support_agent;
REVOKE SELECT (encrypted_envelope) ON drafts FROM role_support_agent;
REVOKE SELECT (dkim_private_key_enc) ON domains FROM role_support_agent;

DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'bridge_credentials' AND column_name = 'password_hash'
    ) THEN
        EXECUTE 'REVOKE SELECT (password_hash) ON bridge_credentials FROM role_support_agent';
    END IF;
END $$;

-- 4. Create the Immutable Audit Ledger
CREATE TABLE IF NOT EXISTS support_audit_logs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_uuid          uuid NOT NULL,
    action_type         text NOT NULL,
    target_mailbox_uuid uuid,
    metadata            jsonb,
    timestamp           timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON support_audit_logs TO role_support_agent;

CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS trigger AS $func$
BEGIN
    RAISE EXCEPTION 'support_audit_logs is an append-only table';
END;
$func$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_audit_log_modification'
    ) THEN
        CREATE TRIGGER trg_prevent_audit_log_modification
        BEFORE UPDATE OR DELETE ON support_audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();
    END IF;
END $$;
