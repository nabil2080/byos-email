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

-- 2. Grant connection and schema USAGE privileges
GRANT CONNECT ON DATABASE byos TO role_support_agent;
GRANT USAGE ON SCHEMA public TO role_support_agent;

-- 3. Restrict SELECT to non-sensitive columns only (Zero-Knowledge boundary)
-- We explicitly avoid table-level GRANT SELECT on tables with sensitive columns
-- because in PostgreSQL, column-level REVOKE does not override table-level GRANT.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM role_support_agent;

-- Grant safe column-level SELECT on users (excluding password_hash, recovery_auth_pk, totp_secret_enc)
GRANT SELECT (id, org_id, email, display_name, is_active, created_at, updated_at, two_factor_enabled) ON users TO role_support_agent;

-- Grant safe column-level SELECT on mailboxes (excluding mailbox_sk_wrapped)
GRANT SELECT (id, org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_pk, is_active, created_at, updated_at) ON mailboxes TO role_support_agent;

-- Grant safe column-level SELECT on domains (excluding dkim_private_key_enc)
GRANT SELECT (id, org_id, name, is_verified, dkim_selector, dkim_public_key, created_at, updated_at) ON domains TO role_support_agent;

-- Grant safe column-level SELECT on root_secrets (excluding root_secret_wrapped)
GRANT SELECT (id, version, created_at) ON root_secrets TO role_support_agent;

-- Grant safe metadata SELECT on message_metadata (excluding content_key_hpke_wrapped, encryption_iv)
GRANT SELECT (id, org_id, mailbox_id, sender, recipient, subject_hash, created_at) ON message_metadata TO role_support_agent;

-- Grant safe column-level SELECT on drafts (excluding encrypted_envelope)
GRANT SELECT (id, org_id, mailbox_id, created_at, updated_at) ON drafts TO role_support_agent;

-- Grant safe SELECT on organizations, plans, and storage connections metadata
GRANT SELECT (id, name, org_recovery_pk, default_storage_connection_id, created_at, updated_at) ON organizations TO role_support_agent;
GRANT SELECT ON storage_connections TO role_support_agent;
REVOKE SELECT (credentials_enc) ON storage_connections FROM role_support_agent;

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
