-- Migration 058: Remove Legacy Organization-Managed Mailbox Subsystem
-- Enforces 100% Private Zero-Knowledge Mailboxes across BYOS
--
-- PREFLIGHT CHECKS:
-- Aborts immediately if any legacy org_managed mailboxes, invitations, or escrow keys exist.
-- Historical migrations are immutable; this script must only run after all mailboxes and invitations
-- are established to be in sovereign private mode with no institutional recovery material.

DO $$
DECLARE
    invalid_mb_count integer;
    escrow_mb_count integer;
    invalid_inv_count integer;
    escrow_inv_count integer;
BEGIN
    -- Condition 1: Any mailbox has mode IS DISTINCT FROM 'private' (NULL-safe)
    SELECT count(*) INTO invalid_mb_count FROM mailboxes WHERE mode IS DISTINCT FROM 'private';
    IF invalid_mb_count > 0 THEN
        RAISE EXCEPTION 'Preflight check failed: % mailboxes found with mode != private or NULL. All mailboxes must be private before applying migration 058.', invalid_mb_count;
    END IF;

    -- Condition 2: Any mailbox has wrapped_sk_org IS NOT NULL (even if mode = 'private')
    SELECT count(*) INTO escrow_mb_count FROM mailboxes WHERE wrapped_sk_org IS NOT NULL;
    IF escrow_mb_count > 0 THEN
        RAISE EXCEPTION 'Preflight check failed: % mailboxes found with wrapped_sk_org IS NOT NULL. Org escrow keys must be cleared before applying migration 058.', escrow_mb_count;
    END IF;

    -- Condition 3: Any invitation has privacy_mode IS DISTINCT FROM 'private' (NULL-safe)
    SELECT count(*) INTO invalid_inv_count FROM account_invitations WHERE privacy_mode IS DISTINCT FROM 'private';
    IF invalid_inv_count > 0 THEN
        RAISE EXCEPTION 'Preflight check failed: % invitations found with privacy_mode != private or NULL. All invitations must be private before applying migration 058.', invalid_inv_count;
    END IF;

    -- Condition 4: Any invitation has wrapped_sk_org IS NOT NULL or temp_wrapped_sk IS NOT NULL (even if expired or consumed)
    SELECT count(*) INTO escrow_inv_count FROM account_invitations WHERE wrapped_sk_org IS NOT NULL OR temp_wrapped_sk IS NOT NULL;
    IF escrow_inv_count > 0 THEN
        RAISE EXCEPTION 'Preflight check failed: % invitations found with wrapped_sk_org or temp_wrapped_sk IS NOT NULL. All invitation escrow keys must be removed before applying migration 058.', escrow_inv_count;
    END IF;
END $$;

BEGIN;

-- 1. Ensure any existing mailboxes are migrated to 'private' (safety no-op after preflights)
UPDATE mailboxes 
SET mode = 'private', 
    wrapped_sk_org = NULL 
WHERE mode IS DISTINCT FROM 'private' OR wrapped_sk_org IS NOT NULL;

-- 2. Drop the legacy check constraint and enforce strictly 'private'
ALTER TABLE mailboxes DROP CONSTRAINT IF EXISTS mailboxes_mode_check;
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_mode_check CHECK (mode = 'private');
ALTER TABLE mailboxes ALTER COLUMN mode SET DEFAULT 'private';

-- 3. Drop legacy columns from mailboxes
ALTER TABLE mailboxes DROP COLUMN IF EXISTS wrapped_sk_org;

-- 4. Clean up account_invitations
ALTER TABLE account_invitations DROP CONSTRAINT IF EXISTS account_invitations_privacy_mode_check;
ALTER TABLE account_invitations ADD CONSTRAINT account_invitations_privacy_mode_check CHECK (privacy_mode = 'private');
ALTER TABLE account_invitations ALTER COLUMN privacy_mode SET DEFAULT 'private';
ALTER TABLE account_invitations DROP COLUMN IF EXISTS wrapped_sk_org;
ALTER TABLE account_invitations DROP COLUMN IF EXISTS temp_wrapped_sk;

-- 5. Drop legacy org_recovery_principals table
DROP TABLE IF EXISTS org_recovery_principals CASCADE;

-- 6. Make organizations.org_recovery_pk nullable (to be phased out completely)
ALTER TABLE organizations ALTER COLUMN org_recovery_pk DROP NOT NULL;

-- 7. Update storage_mode check constraint on organizations if present
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_storage_mode_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_storage_mode_check CHECK (storage_mode = ANY (ARRAY['individual'::text, 'hybrid'::text, 'org_managed'::text]));

COMMIT;
