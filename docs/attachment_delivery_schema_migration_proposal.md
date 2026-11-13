# BYOS Attachment Delivery Schema Migration Proposal (Release B1)

> **Status:** Release B1.1 Reviewed Design & Migration Proposal ONLY (NOT applied to any PostgreSQL database)  
> **Target Migration Filename (Proposed):** `infra/postgres/init/070_attachment_encryption_v2_and_delivery.sql`  
> **Latest Observed Migration Baseline:** `infra/postgres/init/068_draft_folders.sql` (live), with `infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql` ordered immediately ahead of `070`  
> **Scope:** Schema extensions enabling Protocol v2 per-attachment keys, canonical `plaintext_size_bytes`/`ciphertext_sha256`/`owner_pk_sha256` storage, epoch-aware outbound key rotation, normalized Path B delivery grants, draft attachment persistence, and scheduled cancel/completion linkage without exposing storage credentials or `mailbox_sk` to `outbound-worker`.

---

## 1. Design Principles & Baseline Inventory

### 1.1 Existing Tables Touched or Referenced

1. **`attachments` (`infra/postgres/init/020_attachments.sql`, `services/api/attachments.go`):**
   Currently tracks uploaded attachment metadata and encrypted object pointer (`id`, `mailbox_id`, `message_id`, `storage_key`, plus filename/content-type/size/iv/bundle hashes). Today, rows are encrypted solely under `mailbox_sk` (`v=1`) with no `CEK` wrapping columns.
2. **`outbound_reservations` (`infra/postgres/init/002_outbound_reservations.sql:4-16`):**
   Reserves monotonic per-mailbox `outbox_seq` (`DEFAULT nextval('outbound_message_seq')`), `encryption_version`, `aad_version`, and maps 1:1 to `delivery_id` when consumed.
3. **`outbound_queue` (`infra/postgres/init/001_init.sql:211-229`, `002_outbound_reservations.sql:23-35`):**
   Holds Path B pending/delivered/bounced external deliveries (`id`, `delivery_id`, `mailbox_id`, `domain_id`, `recipient`, `encrypted_message`, `send_token_hpke_wrapped`, `outbox_seq`, `encryption_version`, `aad_version`, `encryption_iv`, `reservation_id`, `status`, `attempts`, `max_attempts`, `next_attempt_at`, `expires_at`).
4. **`scheduled_messages` (`infra/postgres/init/001_init.sql:193-208`, `041_scheduled_path_a.sql`, `042_scheduled_draft_ref.sql`, `047_scheduled_attachments.sql`):**
   Stores delayed Path A and Path B sends (`delivery_id`, `is_path_a`, `outbox_seq`, `reservation_id`, `draft_storage_ref`, `sender_attachment_envelopes`, etc.). When `poll_scheduled` (`services/outbound-worker/src/main.rs:812-817`) promotes a Path B row into `outbound_queue`, **`delivery_id`, `outbox_seq`, `mailbox_id`, and `reservation_id` are copied verbatim**.
5. **`drafts` (`infra/postgres/init/001_init.sql:248-255`, `011_drafts_metadata.sql`, `068_draft_folders.sql`):**
   Stores encrypted draft envelopes (`id`, `mailbox_id`, `version`, `send_failed`, `folder`, `folder_id`), currently lacking a normalized relation to draft `attachments`.
6. **Least-Privilege DB Role (`outbound_worker` / `outbound_worker_login`):**
   `verify_least_privilege` (`services/outbound-worker/src/main.rs:660-688`) explicitly asserts `permission denied` on `root_secrets`, `message_metadata`, `device_mailbox_access`, and `storage_connections` (`002_outbound_reservations.sql:65-69`, `006_storage_enhancements.sql:45-49`, `007_fix_storage_hardening.sql:13-14`).

### 1.2 Normalization Decisions

- **No `cek_outbound_wrapped` column on `attachments`:** An attachment may remain draft-only (0 outbound wraps), be scheduled and cancelled then re-sent, or re-wrapped after an `OUTBOUND_DELIVERY_SK` rotation. Storing outbound wraps in a normalized per-delivery table (`outbound_delivery_attachments`) keeps `attachments` clean and prevents multi-delivery overwrite races.
- **No duplicated `filename` / `content_type` / `storage_key` on `outbound_delivery_attachments`:** Those remain canonical in `attachments` (`filename`, `content_type`, `plaintext_size_bytes`, `plaintext_sha256`, `ciphertext_sha256`, plus SEC-005 ciphertext byte column `size_bytes`), locked immutable once committed (`upload_status = 'ready'`), while `outbound_delivery_attachments.metadata_sha256` binds `(filename, content_type, plaintext_size_bytes, plaintext_sha256, disposition, content_id)` cryptographically into `outbound_wrap_aad`.
- **Overwrite-Safe Client UUIDv4 Upload Reservation (`upload_status`):** Pre-inserting `(id, mailbox_id, upload_status = 'uploading')` BEFORE streaming to `storage-worker /api/store` eliminates storage overwrite races on duplicate client-supplied `attachment_id`s (`409 Conflict` via `PRIMARY KEY (id)` before writing object bytes).
- **Single-identity continuity across Scheduled -> Queue promotion:** Linking `outbound_delivery_attachments` by **`delivery_id`** (generated at send/schedule time and shared verbatim with `outbound_queue.delivery_id` on `poll_scheduled`) avoids duplicating attachment wrap rows during worker promotion, while decoupling Sent/Draft UI lookups from overloading `attachments.message_id`.
- **No secrets in PostgreSQL:** `outbound_delivery_keys` holds **public keys and epoch metadata only**; secret keys never enter SQL tables.

---

## 2. Proposed SQL Migration (`infra/postgres/init/070_attachment_encryption_v2_and_delivery.sql`)

> **Note:** Follows `AGENTS.md` idempotency rules (`IF NOT EXISTS` and guarded `DO $$ ... END $$` constraint blocks), ordered strictly after Release A.2/A.2.1 `069_outbound_queue_lease_and_outcomes.sql`. **Not executed in this task.**

```sql
-- ============================================================================
-- Migration 070 (PROPOSAL — NOT APPLIED; follows 069_outbound_queue_lease_and_outcomes.sql):
-- Release B1: Protocol v2 Per-Attachment Encryption, Outbound Key Epochs,
--             Path B Delivery Grants, and Draft Attachment Persistence
-- ============================================================================

-- 1. Extend attachments table for Protocol v2 (additive, legacy v=1 safe)
-- Note: existing `attachments.size_bytes` stores SEC-005 ciphertext byte length
-- checked in `services/api/attachments.go:113`; keep `size_bytes` as ciphertext size
-- and store `plaintext_size_bytes` explicitly alongside `ciphertext_size_bytes`.
ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS crypto_version        SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS aad_version           SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS upload_status         TEXT NOT NULL DEFAULT 'ready',
    ADD COLUMN IF NOT EXISTS cek_owner_wrapped     BYTEA NULL,
    ADD COLUMN IF NOT EXISTS owner_wrap_alg        TEXT NULL,
    ADD COLUMN IF NOT EXISTS owner_key_version     INTEGER NULL,
    ADD COLUMN IF NOT EXISTS owner_pk_sha256       BYTEA NULL,
    ADD COLUMN IF NOT EXISTS plaintext_size_bytes  BIGINT NULL,
    ADD COLUMN IF NOT EXISTS plaintext_sha256      BYTEA NULL,
    ADD COLUMN IF NOT EXISTS ciphertext_size_bytes BIGINT NULL,
    ADD COLUMN IF NOT EXISTS ciphertext_sha256     BYTEA NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachments_crypto_version_check'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT attachments_crypto_version_check
            CHECK (crypto_version IN (1, 2));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachments_upload_status_check'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT attachments_upload_status_check
            CHECK (upload_status IN ('uploading', 'ready'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachments_plaintext_sha256_len_check'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT attachments_plaintext_sha256_len_check
            CHECK (plaintext_sha256 IS NULL OR octet_length(plaintext_sha256) = 32);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachments_ciphertext_sha256_len_check'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT attachments_ciphertext_sha256_len_check
            CHECK (ciphertext_sha256 IS NULL OR octet_length(ciphertext_sha256) = 32);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachments_owner_pk_sha256_len_check'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT attachments_owner_pk_sha256_len_check
            CHECK (owner_pk_sha256 IS NULL OR octet_length(owner_pk_sha256) = 32);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachments_plaintext_size_check'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT attachments_plaintext_size_check
            CHECK (plaintext_size_bytes IS NULL OR plaintext_size_bytes >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachments_ciphertext_size_check'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT attachments_ciphertext_size_check
            CHECK (ciphertext_size_bytes IS NULL OR ciphertext_size_bytes >= 29);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachments_v2_owner_wrap_check'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT attachments_v2_owner_wrap_check
            CHECK (
                crypto_version = 1
                OR (
                    crypto_version = 2
                    AND aad_version >= 2
                    AND cek_owner_wrapped IS NOT NULL
                    AND octet_length(cek_owner_wrapped) = 81
                    AND owner_wrap_alg = 'HPKE-X25519-AES256GCM-v1'
                    AND owner_key_version IS NOT NULL
                    AND owner_key_version >= 1
                    AND owner_pk_sha256 IS NOT NULL
                    AND plaintext_size_bytes IS NOT NULL
                    AND plaintext_sha256 IS NOT NULL
                    AND ciphertext_size_bytes = plaintext_size_bytes + 29
                    AND ciphertext_size_bytes = size_bytes
                    AND ciphertext_sha256 IS NOT NULL
                )
            );
    END IF;
END $$;

-- Protect committed v2 AAD-bound attachment metadata against post-upload mutation
CREATE OR REPLACE FUNCTION prevent_v2_attachment_metadata_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.crypto_version = 2 AND OLD.upload_status = 'ready' THEN
        IF NEW.filename IS DISTINCT FROM OLD.filename
           OR NEW.content_type IS DISTINCT FROM OLD.content_type
           OR NEW.plaintext_size_bytes IS DISTINCT FROM OLD.plaintext_size_bytes
           OR NEW.ciphertext_size_bytes IS DISTINCT FROM OLD.ciphertext_size_bytes
           OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
           OR NEW.plaintext_sha256 IS DISTINCT FROM OLD.plaintext_sha256
           OR NEW.ciphertext_sha256 IS DISTINCT FROM OLD.ciphertext_sha256
           OR NEW.storage_key IS DISTINCT FROM OLD.storage_key THEN
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
    EXECUTE FUNCTION prevent_v2_attachment_metadata_mutation();

CREATE INDEX IF NOT EXISTS idx_attachments_mailbox_crypto_ver
    ON attachments(mailbox_id, crypto_version)
    WHERE message_id IS NULL;

-- 2. Public Outbound Delivery Key Epoch Registry (PUBLIC KEYS ONLY — ZERO SECRETS)
CREATE TABLE IF NOT EXISTS outbound_delivery_keys (
    key_epoch      INTEGER PRIMARY KEY CHECK (key_epoch >= 1),
    key_id         BYTEA NOT NULL UNIQUE CHECK (octet_length(key_id) = 8),
    algorithm      TEXT NOT NULL DEFAULT 'HPKE-X25519-AES256GCM-v1'
                   CHECK (algorithm = 'HPKE-X25519-AES256GCM-v1'),
    public_key_b64 TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('pending', 'active', 'decrypt_only', 'retired')),
    activated_at   TIMESTAMPTZ NULL,
    valid_until    TIMESTAMPTZ NULL,
    retired_at     TIMESTAMPTZ NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one active public encryption key epoch at any instant
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_delivery_keys_single_active
    ON outbound_delivery_keys ((status = 'active'))
    WHERE status = 'active';

-- 3. Path B Outbound Delivery Attachment Grants (covers both immediate & scheduled sends)
CREATE TABLE IF NOT EXISTS outbound_delivery_attachments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id            UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    reservation_id        UUID NULL REFERENCES outbound_reservations(reservation_id) ON DELETE SET NULL,
    delivery_id           UUID NOT NULL,
    attachment_id         UUID NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
    position              SMALLINT NOT NULL CHECK (position >= 0),
    disposition           TEXT NOT NULL DEFAULT 'attachment' CHECK (disposition IN ('attachment', 'inline')),
    content_id            TEXT NULL,
    crypto_version        SMALLINT NOT NULL DEFAULT 2 CHECK (crypto_version = 2),
    wrap_alg              TEXT NOT NULL DEFAULT 'HPKE-X25519-AES256GCM-v1'
                          CHECK (wrap_alg = 'HPKE-X25519-AES256GCM-v1'),
    outbound_key_id       BYTEA NOT NULL CHECK (octet_length(outbound_key_id) = 8),
    outbound_key_epoch    INTEGER NOT NULL CHECK (outbound_key_epoch >= 1),
    cek_outbound_wrapped  BYTEA NOT NULL CHECK (octet_length(cek_outbound_wrapped) = 81),
    metadata_sha256       BYTEA NOT NULL CHECK (octet_length(metadata_sha256) = 32),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (delivery_id, attachment_id),
    UNIQUE (delivery_id, position)
);

CREATE INDEX IF NOT EXISTS idx_outbound_delivery_att_delivery
    ON outbound_delivery_attachments(delivery_id, position);

CREATE INDEX IF NOT EXISTS idx_outbound_delivery_att_attachment
    ON outbound_delivery_attachments(attachment_id);

CREATE INDEX IF NOT EXISTS idx_outbound_delivery_att_epoch
    ON outbound_delivery_attachments(outbound_key_epoch, delivery_id);

-- 4. Draft Attachment Linkage (multi-device draft persistence + scheduled-cancel restore)
CREATE TABLE IF NOT EXISTS draft_attachments (
    draft_id       UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    attachment_id  UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    mailbox_id     UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    position       SMALLINT NOT NULL DEFAULT 0 CHECK (position >= 0),
    disposition    TEXT NOT NULL DEFAULT 'attachment' CHECK (disposition IN ('attachment', 'inline')),
    content_id     TEXT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (draft_id, attachment_id),
    UNIQUE (draft_id, position)
);

CREATE INDEX IF NOT EXISTS idx_draft_attachments_mailbox_att
    ON draft_attachments(mailbox_id, attachment_id);

-- 5. Fast-Path Attachment Flag & Body Key-Epoch Tracking on Outbound Tables
ALTER TABLE outbound_queue
    ADD COLUMN IF NOT EXISTS attachment_count     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS send_token_key_epoch INTEGER NULL,
    ADD COLUMN IF NOT EXISTS send_token_key_id    BYTEA NULL;

ALTER TABLE scheduled_messages
    ADD COLUMN IF NOT EXISTS attachment_count     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS send_token_key_epoch INTEGER NULL,
    ADD COLUMN IF NOT EXISTS send_token_key_id    BYTEA NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'outbound_queue_attachment_count_check'
    ) THEN
        ALTER TABLE outbound_queue
            ADD CONSTRAINT outbound_queue_attachment_count_check
            CHECK (attachment_count >= 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'outbound_queue_key_id_len_check'
    ) THEN
        ALTER TABLE outbound_queue
            ADD CONSTRAINT outbound_queue_key_id_len_check
            CHECK (send_token_key_id IS NULL OR octet_length(send_token_key_id) = 8);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_messages_attachment_count_check'
    ) THEN
        ALTER TABLE scheduled_messages
            ADD CONSTRAINT scheduled_messages_attachment_count_check
            CHECK (attachment_count >= 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_messages_key_id_len_check'
    ) THEN
        ALTER TABLE scheduled_messages
            ADD CONSTRAINT scheduled_messages_key_id_len_check
            CHECK (send_token_key_id IS NULL OR octet_length(send_token_key_id) = 8);
    END IF;
END $$;

-- 6. Least-Privilege RBAC Preservation for outbound_worker
-- outbound_worker retrieves decrypted attachment manifests/blobs exclusively via
-- services/api internal HTTP endpoints, preserving full isolation from
-- attachments, drafts, storage_connections, and mailbox_storage.
REVOKE ALL ON TABLE attachments FROM outbound_worker;
REVOKE ALL ON TABLE drafts FROM outbound_worker;
REVOKE ALL ON TABLE draft_attachments FROM outbound_worker;
REVOKE ALL ON TABLE outbound_delivery_attachments FROM outbound_worker;
REVOKE ALL ON TABLE storage_connections FROM outbound_worker;
REVOKE ALL ON TABLE mailbox_storage FROM outbound_worker;
GRANT SELECT (key_epoch, key_id, algorithm, status, valid_until)
    ON TABLE outbound_delivery_keys TO outbound_worker;
```

---

## 3. Foreign Keys, Deletion Semantics & Lifecycle Rules

### 3.1 Protection Against Premature Blob Deletion & Orphan Uploads

- Today (`services/api/attachments.go:304-345`), `DELETE /v1/mailboxes/{mailbox_id}/attachments/{attachment_id}` blocks deletion only when `attachments.message_id IS NOT NULL`.
- With `draft_attachments`, `outbound_delivery_attachments`, and `upload_status` added:
  1. `outbound_delivery_attachments.attachment_id` carries **`ON DELETE RESTRICT`**: PostgreSQL enforces that an attachment queued for delivery or scheduled send cannot be deleted out from under `outbound-worker`.
  2. Application delete handler (`attachments.go`) MUST additionally verify the attachment is NOT referenced by any row in `outbound_delivery_attachments` joined to non-terminal `outbound_queue` (`status IN ('pending', 'accepted_by_mta')`) or pending `scheduled_messages`, returning `409 Conflict` cleanly (before calling `storage-worker /api/delete`).
  3. When removed from an open draft in Compose, removing the `(draft_id, attachment_id)` link in `draft_attachments` precedes deleting the `attachments` row + object ONLY IF no sent message (`message_id IS NULL`), no other `draft_attachments` row, and no active delivery grant references it.
  4. Failed partial uploads stuck in `upload_status = 'uploading'` older than 1 hour may be reaped safely after calling `storage-worker /api/delete`.

### 3.2 Scheduled Cancellation, Reschedule, Completion IDs & Draft Restoration

- **Both cancel handlers must revoke grants & unlink/restore:**
  1. `mailboxScheduledCancelHandler` (`services/api/outbound.go:1224-1374`) creates a new `drafts` row (`draftID`) from `draft_storage_ref`, marks `scheduled_messages.status = 'cancelled'`, and expires `outbound_reservation`. Inside the same transaction:
     - Insert links into `draft_attachments(draft_id, attachment_id, mailbox_id, position, disposition, content_id)` selecting from `outbound_delivery_attachments WHERE delivery_id = <sched.delivery_id>`.
     - Execute `DELETE FROM outbound_delivery_attachments WHERE delivery_id = <sched.delivery_id>` so unused `cek_outbound_wrapped` grants are revoked immediately upon cancellation, and clear `attachments.message_id = NULL` (only if `message_id = sched.delivery_id`) so attachments belong cleanly to `draft_attachments` (`draftID`).
  2. **`outboundScheduledCancelHandler` (`services/api/outbound.go:876-937`, `POST /v1/outbound/scheduled/cancel`) Defect:** Today it updates `scheduled_messages.status = 'cancelled'` without restoring a draft or unlinking attachments. Release B2 MUST update this handler too to run `DELETE FROM outbound_delivery_attachments WHERE delivery_id = $1` and clear orphaned `attachments.message_id = NULL` inside the cancel transaction.
- **Reschedule / Scheduled Edit Consistency (`mailboxScheduledUpdateHandler`, `services/api/outbound.go:1375-1536`):** Updating a pending scheduled message currently updates only `draft_storage_ref`, `subject`, and `scheduled_at`. If the compose UI allows editing body or adding/removing attachments on a scheduled message, `mailboxScheduledUpdateHandler` MUST either reject attachment list changes while scheduled (`409` requiring cancel-and-recreate) OR require fresh `(reservation_id, outbox_seq, encrypted_message, send_token_wrapped, attachment_ids, outbound_delivery_attachments)` replacement atomically inside its transaction.
- **Scheduled Completion (`scheduled_completion.go:109-120, 165-180`) ID Synchronization:** Today `completeScheduledDeliveryTx` inserts a new Sent `message_metadata.id` (`sentMsgID`) on `"delivered"` or a new failed `drafts.id` (`draftID`) on `"failed"`, leaving `attachments.message_id` pointing at `scheduled_messages.delivery_id`. In Release B2:
  - On `"delivered"`: update/associate Sent message attachment visibility (`attachments.message_id = sentMsgID` where `message_id = sched.delivery_id`, or resolve via Sent `delivery_id`/join table) while keeping `outbound_delivery_attachments` immutable/eligible for retention cleanup.
  - On `"failed"`: insert `draft_attachments` rows for `draftID`, delete `outbound_delivery_attachments` grants for `delivery_id`, and reset `attachments.message_id = NULL`.

### 3.3 Post-Delivery / Terminal Retention & Orphan Garbage Collection

- Once an `outbound_queue` row reaches terminal state (`delivered`, `bounced`, `expired`), or `scheduled_messages` reaches `cancelled`/`failed`/`expired`, its `outbound_delivery_attachments.cek_outbound_wrapped` rows are no longer needed for SMTP transport (note: sender Sent-folder copies still rely on `attachments.message_id` + `attachments.cek_owner_wrapped`!).
- A safe periodic retention sweep can:
  - Delete `outbound_delivery_attachments` rows whose `delivery_id` is older than retention (e.g., 7 days post-terminal `delivered_at`/`failed_at`) without disturbing `attachments` rows referenced by Sent `messages`.
  - Clean up orphan unlinked draft uploads (`attachments WHERE message_id IS NULL AND created_at < now() - interval '7 days' AND NOT EXISTS draft_attachments AND NOT EXISTS outbound_delivery_attachments`).

---

## 4. Backward Compatibility, Rollout, and Rollback Strategy

### 4.1 Zero-Downtime Forward Migration (No Table Rewrites / No Data Loss)

- Every new column on `attachments`, `outbound_queue`, and `scheduled_messages` is either nullable (`NULL`) or has constant `DEFAULT` (`0` or `1`) which executes as an instant metadata-only operation in PostgreSQL without locking or rewriting historical rows.
- Existing `attachments` rows default to `crypto_version = 1, aad_version = 1` and satisfy `attachments_v2_owner_wrap_check` automatically without backfill.
- Existing `services/api/bridge.go:602-609` inserts into `outbound_queue` without specifying attachments -> columns default cleanly to `attachment_count = 0`, `send_token_key_epoch = NULL`, `send_token_key_id = NULL`.
- `services/outbound-worker` `poll_once` (`attachment_count = 0`) skips attachment manifest API calls completely, keeping existing text/HTML external send latency unchanged.

### 4.2 Safe Rollback Analysis

1. **Before Release B2 traffic writes `v=2` rows (schema-only rollback):**
   If rollback is needed immediately after applying `070`, dropping the new tables (`outbound_delivery_attachments`, `draft_attachments`, `outbound_delivery_keys`) and dropping the new columns is instantaneous and lossless (while leaving `069` outbound queue lease/outcome columns intact).
2. **After Release B2 traffic creates live `v=2` attachments (data-preserving rollback):**
   - **DO NOT** run destructive `DROP COLUMN cek_owner_wrapped` / `crypto_version` if customer `v=2` attachments have been uploaded — dropping `cek_owner_wrapped` would permanently strand those attachments' `CEK`s!
   - Instead, roll back **application binaries/feature flags** to reject new `v=2` outbound sends (`422` / feature toggle), while preserving columns so webmail continues decrypting previously stored `v=2` attachments using `cek_owner_wrapped`.
