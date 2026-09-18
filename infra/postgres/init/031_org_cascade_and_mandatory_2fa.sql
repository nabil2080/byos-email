-- Migration 031: Org Cascading Deletions and Mandatory 2FA Defaults

-- 1. Ensure 2-Step Verification is enabled by default for all users
ALTER TABLE users ALTER COLUMN two_factor_enabled SET DEFAULT true;
UPDATE users SET two_factor_enabled = true WHERE two_factor_enabled = false;

-- 2. Organizations -> Child Tables Cascading Deletions
DO $$
BEGIN
    -- users (org_id)
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_org_id_fkey;
    ALTER TABLE users ADD CONSTRAINT users_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

    -- domains (org_id)
    ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_org_id_fkey;
    ALTER TABLE domains ADD CONSTRAINT domains_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

    -- mailboxes (org_id)
    ALTER TABLE mailboxes DROP CONSTRAINT IF EXISTS mailboxes_org_id_fkey;
    ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

    -- storage_connections (org_id)
    ALTER TABLE storage_connections DROP CONSTRAINT IF EXISTS storage_connections_org_id_fkey;
    ALTER TABLE storage_connections ADD CONSTRAINT storage_connections_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

    -- org_recovery_principals (org_id)
    ALTER TABLE org_recovery_principals DROP CONSTRAINT IF EXISTS org_recovery_principals_org_id_fkey;
    ALTER TABLE org_recovery_principals ADD CONSTRAINT org_recovery_principals_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

    -- storage_migrations (org_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'storage_migrations_org_id_fkey') THEN
        ALTER TABLE storage_migrations DROP CONSTRAINT storage_migrations_org_id_fkey;
        ALTER TABLE storage_migrations ADD CONSTRAINT storage_migrations_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;

    -- audit_log (org_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'audit_log_org_id_fkey') THEN
        ALTER TABLE audit_log DROP CONSTRAINT audit_log_org_id_fkey;
        ALTER TABLE audit_log ADD CONSTRAINT audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 3. Mailboxes -> Child Tables Cascading Deletions
DO $$
BEGIN
    -- mailbox_storage (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'mailbox_storage_mailbox_id_fkey') THEN
        ALTER TABLE mailbox_storage DROP CONSTRAINT mailbox_storage_mailbox_id_fkey;
        ALTER TABLE mailbox_storage ADD CONSTRAINT mailbox_storage_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;

    -- aliases (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'aliases_mailbox_id_fkey') THEN
        ALTER TABLE aliases DROP CONSTRAINT aliases_mailbox_id_fkey;
        ALTER TABLE aliases ADD CONSTRAINT aliases_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;

    -- contacts (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'contacts_mailbox_id_fkey') THEN
        ALTER TABLE contacts DROP CONSTRAINT contacts_mailbox_id_fkey;
        ALTER TABLE contacts ADD CONSTRAINT contacts_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;

    -- mailbox_settings (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'mailbox_settings_mailbox_id_fkey') THEN
        ALTER TABLE mailbox_settings DROP CONSTRAINT mailbox_settings_mailbox_id_fkey;
        ALTER TABLE mailbox_settings ADD CONSTRAINT mailbox_settings_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;
END $$;
