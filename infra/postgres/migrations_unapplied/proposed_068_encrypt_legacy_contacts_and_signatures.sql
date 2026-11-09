-- ==============================================================================
-- PROPOSED MIGRATION 068: Encrypt Legacy Contacts and Signatures (UNAPPLIED)
-- ==============================================================================
--
-- STATUS: PROPOSED / UNAPPLIED
-- NOTICE: DO NOT EXECUTE DIRECTLY ON ACTIVE 'byos' POSTGRESQL PRODUCTION DATABASE.
--
-- Context:
--   Remediates FINDING-04 (Plaintext Contacts in PostgreSQL) and FINDING-05
--   (Plaintext Email Signatures in PostgreSQL) identified during the BYOS
--   Customer-Owned Storage & Mailbox Data Encryption Security Audit.
--
-- Cryptographic & Zero-Knowledge Constraints:
--   Under the BYOS zero-knowledge trust model, the server NEVER possesses the
--   client's private mailbox encryption key (mailbox_sk). Because the server
--   cannot derive or decrypt ciphertext, the server CANNOT independently encrypt
--   pre-existing plaintext contacts or signatures via an automated database trigger
--   or server-side SQL migration.
--
-- Multi-Phase Migration Strategy:
--   Phase 1 (Application Layer - COMPLETED):
--     - Webmail client encrypts contacts into `encrypted_envelope` (AAD: byos-contact-v1).
--     - API server (`services/api/contacts.go`) nullifies legacy plaintext columns
--       (name, email, notes, group_name) whenever `encrypted_envelope` is submitted.
--     - Webmail client encrypts signatures into `enc:v1:<base64>` (AAD: byos-signature-v1).
--     - API server (`services/api/settings.go`) validates structural integrity of
--       `enc:v1:` signature envelopes on write.
--
--   Phase 2 (Client-Side Backfill - IN PROGRESS):
--     - When a user logs in and unlocks their mailbox (loading mailbox_sk into memory),
--       the webmail client detects any unencrypted contacts or legacy plaintext signatures.
--     - The client re-encrypts the records using mailbox_sk and writes them back.
--
--   Phase 3 (Database Schema Hardening & Deprecation - THIS SCRIPT):
--     - Executed only after the client backfill grace period has elapsed.
--     - Wipes any residual plaintext fields from `contacts` and `mailbox_settings`.
--     - Enforces CHECK constraints requiring valid encrypted envelopes.
--     - Formally deprecates legacy plaintext columns.
--
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Scrub Residual Plaintext from Contacts (FINDING-04)
-- ------------------------------------------------------------------------------

-- Nullify legacy plaintext columns for all rows that already have an encrypted envelope.
UPDATE contacts
SET
    name = NULL,
    email = NULL,
    notes = NULL,
    group_name = NULL
WHERE encrypted_envelope IS NOT NULL
  AND (name IS NOT NULL OR email IS NOT NULL OR notes IS NOT NULL OR group_name IS NOT NULL);

-- Drop the case-insensitive plaintext email index since email is no longer stored in plaintext
DROP INDEX IF EXISTS idx_contacts_mailbox_email_lower;
DROP INDEX IF EXISTS idx_contacts_mailbox_group_name;

-- Require that all contacts have an encrypted envelope (zero plaintext rows permitted)
-- For rows that never migrated during Phase 2, mark as tombstoned or reject:
ALTER TABLE contacts
    ADD CONSTRAINT chk_contacts_encrypted_envelope_not_null
    CHECK (encrypted_envelope IS NOT NULL AND octet_length(encrypted_envelope) >= 29);

-- ------------------------------------------------------------------------------
-- 2. Scrub Residual Plaintext from Mailbox Settings (FINDING-05)
-- ------------------------------------------------------------------------------

-- For any signatures that were not migrated to enc:v1:<base64>, nullify them to prevent
-- permanent plaintext exposure on disk:
UPDATE mailbox_settings
SET signature_plain = NULL
WHERE signature_plain IS NOT NULL
  AND signature_plain NOT LIKE 'enc:v1:%';

UPDATE mailbox_settings
SET signature_html = NULL
WHERE signature_html IS NOT NULL
  AND signature_html NOT LIKE 'enc:v1:%';

-- Enforce that future signature writes must be NULL or a valid enc:v1: envelope
ALTER TABLE mailbox_settings
    ADD CONSTRAINT chk_mailbox_settings_signature_plain_encrypted
    CHECK (signature_plain IS NULL OR (signature_plain LIKE 'enc:v1:%' AND length(signature_plain) >= 46));

ALTER TABLE mailbox_settings
    ADD CONSTRAINT chk_mailbox_settings_signature_html_encrypted
    CHECK (signature_html IS NULL OR (signature_html LIKE 'enc:v1:%' AND length(signature_html) >= 46));

-- ------------------------------------------------------------------------------
-- 3. Optional Final Step: Drop Deprecated Plaintext Columns (Phase 4)
-- ------------------------------------------------------------------------------
-- The following DDL can be executed once all legacy API client versions are retired:
--
-- ALTER TABLE contacts DROP COLUMN IF EXISTS name;
-- ALTER TABLE contacts DROP COLUMN IF EXISTS email;
-- ALTER TABLE contacts DROP COLUMN IF EXISTS notes;
-- ALTER TABLE contacts DROP COLUMN IF EXISTS group_name;

COMMIT;

-- ==============================================================================
-- ROLLBACK SCRIPT (DOWN MIGRATION)
-- ==============================================================================
--
-- BEGIN;
--
-- -- Remove constraints enforcing encryption
-- ALTER TABLE contacts DROP CONSTRAINT IF EXISTS chk_contacts_encrypted_envelope_not_null;
-- ALTER TABLE mailbox_settings DROP CONSTRAINT IF EXISTS chk_mailbox_settings_signature_plain_encrypted;
-- ALTER TABLE mailbox_settings DROP CONSTRAINT IF EXISTS chk_mailbox_settings_signature_html_encrypted;
--
-- -- Re-create plaintext metadata indexes if needed
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_mailbox_email_lower
--   ON contacts(mailbox_id, LOWER(email)) WHERE email IS NOT NULL;
-- CREATE INDEX IF NOT EXISTS idx_contacts_mailbox_group_name
--   ON contacts(mailbox_id, group_name);
--
-- COMMIT;
-- ==============================================================================
