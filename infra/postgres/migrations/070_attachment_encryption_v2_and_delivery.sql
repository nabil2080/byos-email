-- Unapplied Migration Proposal 070: Release B2 Attachment Encryption v2 & Outbound Delivery
-- Ordered strictly after proposed_069_outbound_queue_lease_and_outcomes.sql.
-- Design authority:
--   - docs/attachment_encryption_protocol_v2.md
--   - docs/attachment_delivery_schema_migration_proposal.md
--   - docs/attachment_delivery_internal_api_spec.md
-- Safe & idempotent: uses IF NOT EXISTS / guarded DO $$ blocks. Does NOT mutate legacy v1 rows.

BEGIN;

-- 1. Extend attachments with Protocol v2 per-attachment CEK wrapping & integrity columns.
ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS crypto_version        smallint NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS cek_owner_wrapped     bytea NULL,
    ADD COLUMN IF NOT EXISTS owner_wrap_alg        text NULL,
    ADD COLUMN IF NOT EXISTS owner_key_version     integer NULL,
    ADD COLUMN IF NOT EXISTS owner_pk_sha256       bytea NULL,
    ADD COLUMN IF NOT EXISTS blob_aad_version      smallint NULL,
    ADD COLUMN IF NOT EXISTS plaintext_sha256      bytea NULL,
    ADD COLUMN IF NOT EXISTS ciphertext_sha256     bytea NULL,
    ADD COLUMN IF NOT EXISTS ciphertext_size_bytes bigint NULL,
    ADD COLUMN IF NOT EXISTS upload_state          text NOT NULL DEFAULT 'committed';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_attachments_upload_state'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT chk_attachments_upload_state
            CHECK (upload_state IN ('pending', 'committed', 'aborted'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_attachments_crypto_version_invariants'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT chk_attachments_crypto_version_invariants
            CHECK (
                (crypto_version = 1)
                OR (
                    crypto_version = 2
                    AND size_bytes >= 0
                    AND cek_owner_wrapped IS NOT NULL
                    AND octet_length(cek_owner_wrapped) >= 81
                    AND owner_wrap_alg IN ('HPKE-X25519-AES256GCM-v1')
                    AND owner_key_version IS NOT NULL
                    AND owner_key_version >= 1
                    AND owner_pk_sha256 IS NOT NULL
                    AND octet_length(owner_pk_sha256) = 32
                    AND blob_aad_version = 2
                    AND plaintext_sha256 IS NOT NULL
                    AND octet_length(plaintext_sha256) = 32
                    AND ciphertext_sha256 IS NOT NULL
                    AND octet_length(ciphertext_sha256) = 32
                    AND ciphertext_size_bytes = size_bytes + 29
                )
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attachments_mailbox_crypto_ver
    ON attachments(mailbox_id, crypto_version);

-- Immutability guard for committed v2 attachment metadata & crypto descriptors.
-- Allows message_id linking (NULL -> delivery_id) while blocking any mutation of sealed metadata.
CREATE OR REPLACE FUNCTION enforce_attachments_v2_immutable()
RETURNS trigger AS $$
BEGIN
    IF OLD.crypto_version = 2 AND OLD.upload_state = 'committed' THEN
        IF NEW.mailbox_id IS DISTINCT FROM OLD.mailbox_id
           OR NEW.crypto_version IS DISTINCT FROM OLD.crypto_version
           OR NEW.filename IS DISTINCT FROM OLD.filename
           OR NEW.content_type IS DISTINCT FROM OLD.content_type
           OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
           OR NEW.ciphertext_size_bytes IS DISTINCT FROM OLD.ciphertext_size_bytes
           OR NEW.plaintext_sha256 IS DISTINCT FROM OLD.plaintext_sha256
           OR NEW.ciphertext_sha256 IS DISTINCT FROM OLD.ciphertext_sha256
           OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
           OR NEW.blob_aad_version IS DISTINCT FROM OLD.blob_aad_version
           OR NEW.owner_pk_sha256 IS DISTINCT FROM OLD.owner_pk_sha256
           OR NEW.owner_key_version IS DISTINCT FROM OLD.owner_key_version
           OR NEW.cek_owner_wrapped IS DISTINCT FROM OLD.cek_owner_wrapped THEN
            RAISE EXCEPTION 'committed v2 attachment metadata is immutable';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attachments_v2_immutable ON attachments;
CREATE TRIGGER trg_attachments_v2_immutable
    BEFORE UPDATE ON attachments
    FOR EACH ROW
    EXECUTE FUNCTION enforce_attachments_v2_immutable();

-- 2. Public-key-only epoch registry for OUTBOUND_DELIVERY_PK rotation.
-- NEVER stores any private key material.
CREATE TABLE IF NOT EXISTS outbound_delivery_keys (
    key_epoch   integer PRIMARY KEY CHECK (key_epoch >= 1),
    key_id      text NOT NULL UNIQUE CHECK (char_length(key_id) = 16),
    public_key  bytea NOT NULL CHECK (octet_length(public_key) = 32),
    algorithm   text NOT NULL DEFAULT 'HPKE-X25519-AES256GCM-v1'
                    CHECK (algorithm = 'HPKE-X25519-AES256GCM-v1'),
    status      text NOT NULL CHECK (status IN ('pending', 'active', 'decrypt_only', 'retired')),
    valid_until timestamptz NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    retired_at  timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_delivery_keys_single_active
    ON outbound_delivery_keys(status) WHERE status = 'active';

-- 3. Per-delivery outbound attachment grants (one row per attached file per Path B delivery).
CREATE TABLE IF NOT EXISTS outbound_delivery_attachments (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id          uuid NOT NULL,
    mailbox_id           uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    attachment_id        uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    outbox_seq           bigint NOT NULL,
    position             integer NOT NULL CHECK (position >= 0),
    disposition          text NOT NULL DEFAULT 'attachment'
                             CHECK (disposition IN ('attachment', 'inline')),
    content_id           text NULL,
    wrap_alg             text NOT NULL DEFAULT 'HPKE-X25519-AES256GCM-v1'
                             CHECK (wrap_alg = 'HPKE-X25519-AES256GCM-v1'),
    outbound_key_id      text NOT NULL,
    outbound_key_epoch   integer NOT NULL CHECK (outbound_key_epoch >= 1),
    cek_outbound_wrapped bytea NOT NULL CHECK (octet_length(cek_outbound_wrapped) = 81),
    metadata_sha256      bytea NOT NULL CHECK (octet_length(metadata_sha256) = 32),
    created_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (delivery_id, attachment_id),
    UNIQUE (delivery_id, position)
);

CREATE INDEX IF NOT EXISTS idx_outbound_delivery_attachments_delivery
    ON outbound_delivery_attachments(delivery_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_outbound_delivery_attachments_epoch
    ON outbound_delivery_attachments(outbound_key_epoch, outbound_key_id);

-- 4. Draft attachment join table for multi-device draft sync & deletion protection.
CREATE TABLE IF NOT EXISTS draft_attachments (
    draft_id      uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    mailbox_id    uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    position      integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    disposition   text NOT NULL DEFAULT 'attachment'
                      CHECK (disposition IN ('attachment', 'inline')),
    content_id    text NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (draft_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_draft_attachments_attachment
    ON draft_attachments(attachment_id);

-- 5. Additive queue / scheduled columns for key epoch routing & manifest completeness check.
ALTER TABLE outbound_queue
    ADD COLUMN IF NOT EXISTS send_token_key_epoch integer NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS send_token_key_id    text NULL,
    ADD COLUMN IF NOT EXISTS attachment_count     integer NOT NULL DEFAULT 0;

ALTER TABLE scheduled_messages
    ADD COLUMN IF NOT EXISTS send_token_key_epoch integer NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS send_token_key_id    text NULL,
    ADD COLUMN IF NOT EXISTS attachment_count     integer NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_outbound_queue_attachment_count'
    ) THEN
        ALTER TABLE outbound_queue
            ADD CONSTRAINT chk_outbound_queue_attachment_count
            CHECK (attachment_count >= 0 AND attachment_count <= 100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_scheduled_messages_attachment_count'
    ) THEN
        ALTER TABLE scheduled_messages
            ADD CONSTRAINT chk_scheduled_messages_attachment_count
            CHECK (attachment_count >= 0 AND attachment_count <= 100);
    END IF;
END $$;

-- 6. Strict Least-Privilege Isolation for outbound_worker:
-- outbound-worker accesses attachments strictly via services/api internal lease-fenced HTTP API.
DO $$
DECLARE
    tbl TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'outbound_worker') THEN
        FOREACH tbl IN ARRAY ARRAY[
            'attachments',
            'outbound_delivery_keys',
            'outbound_delivery_attachments',
            'draft_attachments',
            'root_secrets',
            'message_metadata',
            'device_mailbox_access',
            'org_recovery_principals',
            'storage_connections',
            'mailbox_storage'
        ] LOOP
            IF to_regclass('public.' || tbl) IS NOT NULL THEN
                EXECUTE format('REVOKE ALL ON TABLE %I FROM outbound_worker', tbl);
            END IF;
        END LOOP;
    END IF;
END $$;

COMMIT;
