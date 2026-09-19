-- Migration 031: Org Cascading Deletions and Mandatory 2FA Defaults

-- 1. Ensure 2-Step Verification defaults to enabled for new accounts,
-- but do NOT force-enable on existing accounts that lack an enrolled factor.
ALTER TABLE users ALTER COLUMN two_factor_enabled SET DEFAULT true;

-- Only enable for existing users who already have an enrolled factor (safe backfill)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'totp_secret_enc'
    ) THEN
        UPDATE users SET two_factor_enabled = true 
        WHERE two_factor_enabled = false 
          AND (totp_secret_enc IS NOT NULL OR recovery_auth_pk IS NOT NULL);
    END IF;
END $$;

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
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org_recovery_principals') THEN
        ALTER TABLE org_recovery_principals DROP CONSTRAINT IF EXISTS org_recovery_principals_org_id_fkey;
        ALTER TABLE org_recovery_principals ADD CONSTRAINT org_recovery_principals_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;

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

-- 3. Users -> Child Tables Cascading Deletions
DO $$
BEGIN
    -- devices (user_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'devices_user_id_fkey') THEN
        ALTER TABLE devices DROP CONSTRAINT devices_user_id_fkey;
        ALTER TABLE devices ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;

    -- root_secrets (user_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'root_secrets_user_id_fkey') THEN
        ALTER TABLE root_secrets DROP CONSTRAINT root_secrets_user_id_fkey;
        ALTER TABLE root_secrets ADD CONSTRAINT root_secrets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 4. Mailboxes -> Child Tables Cascading Deletions
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

    -- message_metadata (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'message_metadata_mailbox_id_fkey') THEN
        ALTER TABLE message_metadata DROP CONSTRAINT message_metadata_mailbox_id_fkey;
        ALTER TABLE message_metadata ADD CONSTRAINT message_metadata_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;

    -- drafts (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'drafts_mailbox_id_fkey') THEN
        ALTER TABLE drafts DROP CONSTRAINT drafts_mailbox_id_fkey;
        ALTER TABLE drafts ADD CONSTRAINT drafts_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;

    -- outbound_queue (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'outbound_queue_mailbox_id_fkey') THEN
        ALTER TABLE outbound_queue DROP CONSTRAINT outbound_queue_mailbox_id_fkey;
        ALTER TABLE outbound_queue ADD CONSTRAINT outbound_queue_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;

    -- sent_messages (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sent_messages_mailbox_id_fkey') THEN
        ALTER TABLE sent_messages DROP CONSTRAINT sent_messages_mailbox_id_fkey;
        ALTER TABLE sent_messages ADD CONSTRAINT sent_messages_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;

    -- mailbox_recovery_shares (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'mailbox_recovery_shares_mailbox_id_fkey') THEN
        ALTER TABLE mailbox_recovery_shares DROP CONSTRAINT mailbox_recovery_shares_mailbox_id_fkey;
        ALTER TABLE mailbox_recovery_shares ADD CONSTRAINT mailbox_recovery_shares_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;

    -- device_mailbox_authorizations (mailbox_id)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'device_mailbox_authorizations_mailbox_id_fkey') THEN
        ALTER TABLE device_mailbox_authorizations DROP CONSTRAINT device_mailbox_authorizations_mailbox_id_fkey;
        ALTER TABLE device_mailbox_authorizations ADD CONSTRAINT device_mailbox_authorizations_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE;
    END IF;
END $$;
