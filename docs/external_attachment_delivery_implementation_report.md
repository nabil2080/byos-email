# External Attachment Delivery (Release B) Implementation & Blocker Report

**Status:** **BLOCKED — Stopped at Phase 0 Critical Architectural Decision (no application code or database schema modified)**

## What was built / investigated

No source code, test files, or database migrations were modified. During Phase 0 architectural tracing across the frontend composer (`apps/webmail/src/`), Go API (`services/api/`), storage worker (`services/storage-worker/`), PostgreSQL schemas and role grants (`infra/postgres/init/`), frozen V5.3 specifications (`docs/08-v5.3-final.md`), and the Rust outbound worker (`services/outbound-worker/src/main.rs`), multiple interlocking cryptographic, schema, authorization, and payload-limit blockers were identified that prevent a spec-compliant, non-duplicative implementation of Path B external SMTP attachment delivery without an approved database migration and outbound attachment key-wrapping protocol change. In accordance with `AGENTS.md` ("Never invent cryptographic protocols", "Section: When to stop and ask"), `.agents/skills/02-spec-compliance/SKILL.md`, `.agents/skills/04-crypto-boundary/SKILL.md`, and the task directive requiring us to document exact blockers/schema requirements and stop before applying unauthorized migrations or insecure workarounds, execution stopped cleanly after completing the full trace.

## Files edited

| File | Reason |
| --- | --- |
| `docs/external_attachment_delivery_implementation_report.md` | Documented Phase 0 end-to-end trace, exact cryptographic/schema/RBAC/size blockers, rejected insecure alternatives, and required migration/protocol prerequisite |

*(All previously modified and untracked repository files from prior tasks were left untouched, and the active `byos` PostgreSQL database was never mutated.)*

---

## Critical Architectural Decision & Root Blockers

### Blocker 1 — Zero-Knowledge Key Ownership Conflict (`mailbox_sk` vs. `OUTBOUND_DELIVERY_SK`)

Attachments uploaded by the composer (`apps/webmail/src/api.ts:uploadEncryptedAttachment`) are encrypted client-side solely under **`mailboxKey` (`mailbox_sk`)** (`apps/webmail/src/attachment_crypto.ts:encryptAttachmentBytes` -> `wasm_aes_gcm_encrypt`, empty AAD). Customer object storage (`mailboxes/<mailbox_id>/attachments/<att_id>/payload.bin`) stores only that `mailbox_sk` ciphertext.

However, under frozen specification `docs/08-v5.3-final.md` (§11 and §13.5), `mailbox_sk` is a customer-only key that must NEVER leave the client or be exposed to `outbound-worker`; `outbound-worker` holds only `OUTBOUND_DELIVERY_SK` and `BYOS_DKIM_DEK`. Passing `mailbox_sk` to `outbound-worker` inside `encrypted_message` (even HPKE-sealed) would grant the operational SMTP worker permanent decryption capability over every stored email, draft, and attachment in the mailbox. Conversely, with `OUTBOUND_DELIVERY_SK` alone, `outbound-worker` cryptographically cannot decrypt `mailboxes/<mailbox_id>/attachments/<att_id>/payload.bin`.

**Raw evidence (`docs/08-v5.3-final.md:100-109, 210-217`):**
```markdown
| Customer Crypto Keys (NEVER server-unwrapped) | Server Operational Keys |
|-----------------------------------------------|------------------------|
| root_secret | outbound_delivery_sk |
| mailbox_sk | DKIM signing key |
| device_sk | TLS certificates |
| org_recovery_sk | DEK (database encryption key) |
| mnemonic | JWT signing secret |
| content_key | |
| send_token | |
| search_key | |
...
### 13.5 Outbound Worker Boundary (Option A)

* `outbound_delivery_sk` lives **only** inside `outbound-worker` via Docker secret `/run/secrets/outbound_delivery_sk` (`OUTBOUND_DELIVERY_SK_B64` never in image, git, `.env.example`, API, crypto-worker, mail-router, PostgreSQL, Redis, MinIO, host FS, frontend/WASM). `outbound-worker` is Rust binary linking `byos-crypto-core` natively.
* `outbound-worker` must NOT receive `mailbox_sk`, `root_secret`, `mnemonic`, or inbound `content_key` wrappers.
* `outbound-worker` only decrypts rows from `outbound_queue`/`scheduled_messages`; plaintext exists only transiently for DKIM + `smtp.Dial(postfix:587)` submission.
* `crypto-worker` does **not** hold `outbound_delivery_sk` and exposes **no** outbound decrypt endpoint.
* `mail-router` does **not** hold `outbound_delivery_sk`.
```

**Raw evidence (`apps/webmail/src/api.ts:902-942`):**
```ts
export async function uploadEncryptedAttachment(
  mailboxId: string,
  file: File,
  mailboxKey: Uint8Array,
  messageId?: string,
  token?: string,
  signal?: AbortSignal,
): Promise<AttachmentItem> {
  const arrayBuffer = await file.arrayBuffer();
  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }
  const plaintextBytes = new Uint8Array(arrayBuffer);

  // Encrypt client-side using Section 12 WASM primitive before network transit
  const ciphertextBytes = encryptAttachmentBytes(plaintextBytes, mailboxKey);
```

---

### Blocker 2 — Missing Key-Wrapping Schema on `attachments` & `outbound_queue`

Path A (internal BYOS-to-BYOS delivery) solved multi-party attachment decryption cleanly via Migrations `045_attachment_envelopes.sql` and `047_scheduled_attachments.sql` (`attachment_envelopes` and `sender_attachment_envelopes` JSONB columns storing per-attachment X-Wing-wrapped keys alongside chunk references).

By contrast, `attachments` (`infra/postgres/init/020_attachments.sql`) and `outbound_queue` (`infra/postgres/init/001_init.sql` + `002_outbound_reservations.sql`) have **no wrapped-key columns, no key-version metadata, and no outbound envelope/manifest columns**. While `outboundSendHandler` (`services/api/outbound.go:520`) and `outboundScheduleHandler` (`services/api/outbound.go:841`) link `attachments.message_id = deliveryID`, the database schema gives neither the client nor `outbound-worker` a valid place to persist per-attachment keys wrapped both for `mailbox_sk` (for Drafts, Scheduled Sent copies, EML export, and `downloadAndDecryptAttachment`) and for `outbound_delivery_pk` (for `outbound-worker`).

**Raw evidence (`infra/postgres/init/020_attachments.sql:1-21`):**
```sql
-- Section 20: Attachment System
-- Tracks encrypted attachments associated with mailboxes / messages.
-- V1 limit: total message size budget 40 MB.

CREATE TABLE IF NOT EXISTS attachments (
    id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    mailbox_id    uuid        NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    message_id    text        NULL,  -- optional reference to message / draft
    filename      text        NOT NULL,
    content_type  text        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes    bigint      NOT NULL,
    storage_key   text        NOT NULL, -- object key in customer storage
    encrypted     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
```

**Raw evidence (`apps/webmail/src/api.ts:971-986`):**
```ts
export async function downloadAndDecryptAttachment(
  mailboxId: string,
  attachmentId: string,
  mailboxKey: Uint8Array,
  token?: string,
): Promise<Blob> {
  const encryptedBlob = await downloadAttachment(mailboxId, attachmentId, token);
  const encryptedBytes = new Uint8Array(await encryptedBlob.arrayBuffer());

  // Decrypt client-side using Section 12 WASM primitive.
  // slice() copies into an exact-size ArrayBuffer-backed view so the Blob
  // can never alias bytes outside the decrypted range.
  const decryptedBytes = decryptAttachmentBytes(encryptedBytes, mailboxKey);

  return new Blob([decryptedBytes.slice().buffer as ArrayBuffer], { type: encryptedBlob.type });
}
```

---

### Blocker 3 — 4 MB Request/Queue Cap vs. 40 MB Attachment Budget

`POST /v1/outbound/send` (`services/api/outbound.go:328`) and `POST /v1/outbound/schedule` (`services/api/outbound.go:647`) both enforce `r.Body = http.MaxBytesReader(w, r.Body, 4<<20)` (4 MB JSON body cap). Meanwhile, `MaxAttachmentSize` in `services/api/attachments.go:18` is **40 MB**. Embedding base64-encoded attachment MIME parts inside `buildMimeString` / `encrypted_message` fails HTTP body validation for payloads above ~2.9 MB raw and violates the architectural rule against transferring large plaintext attachment contents inside outbound queue JSON.

**Raw evidence (`services/api/outbound.go:328` and `services/api/attachments.go:18`):**
```go
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
```
```go
const MaxAttachmentSize = 40 * 1024 * 1024 // 40 MB V1 budget
```

---

### Blocker 4 — `outbound_worker` Database & Storage Isolation

`outbound_worker` runs under PostgreSQL role `outbound_worker_login` (`infra/postgres/init/002_outbound_reservations.sql:44-69`, `006_storage_enhancements.sql:48-49`), which has **no `SELECT` privilege on `attachments`** and explicit `REVOKE ALL` on `storage_connections` and `mailbox_storage`. Moreover, the `outbound-worker` container (`infra/docker-compose.yml:319-355`) has neither `STORAGE_WORKER_URL` nor `STORAGE_WORKER_INTERNAL_KEY_FILE` (only `BYOS_API_ADDR: "api:8080"` and `INTERNAL_API_KEY_FILE`). No `/v1/internal/...` attachment retrieval API exists in `services/api/main.go`. (This authorization boundary *can* be bridged cleanly without breaking DB/storage isolation via an `INTERNAL_API_KEY`-authenticated Go API endpoint backed by active `outbound_queue` delivery validation and `storage-worker /api/retrieve`, **once** Blockers 1 & 2 are resolved.)

**Raw evidence (`infra/postgres/init/002_outbound_reservations.sql:56-69` & `infra/postgres/init/006_storage_enhancements.sql:48-49`):**
```sql
GRANT USAGE ON SEQUENCE outbound_message_seq, mailbox_message_seq TO outbound_worker;
GRANT SELECT, INSERT, UPDATE ON outbound_queue TO outbound_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_reservations TO outbound_worker;
GRANT SELECT, INSERT ON delivery_log TO outbound_worker;
-- Narrow domain access: only columns needed for routing/DKIM (no verification_token, dkim_public_key if not needed)
GRANT SELECT (id, org_id, name, dkim_selector, dkim_private_key_enc) ON TABLE domains TO outbound_worker;
-- Only non-secret columns on mailboxes (no mailbox_sk_wrapped, mailbox_pk, root_secret_id)
GRANT SELECT (id, org_id, user_id, domain_id, local_part, mode, mailbox_sk_version, is_active, created_at, updated_at) ON TABLE mailboxes TO outbound_worker;
-- Explicitly deny access to sensitive tables/columns
REVOKE ALL ON TABLE root_secrets FROM outbound_worker;
REVOKE ALL ON TABLE message_metadata FROM outbound_worker;
REVOKE ALL ON TABLE device_mailbox_access FROM outbound_worker;
REVOKE ALL ON TABLE org_recovery_principals FROM outbound_worker;
REVOKE ALL ON TABLE storage_connections FROM outbound_worker;
```
```sql
REVOKE ALL ON TABLE storage_connections FROM outbound_worker;
REVOKE ALL ON TABLE mailbox_storage FROM outbound_worker;
```

**Raw evidence (`infra/docker-compose.yml:332-350`):**
```yaml
    environment:
      DATABASE_URL: "postgres://outbound_worker_login:byos_outbound_worker_dev@postgres:5432/byos"
      REDIS_ADDR: "redis:6379"
      OUTBOUND_DELIVERY_SK_FILE: /run/secrets/outbound_delivery_sk
      OUTBOUND_WORKER_DB_PASSWORD_FILE: /run/secrets/outbound_worker_db_password
      POSTFIX_ADDR: "postfix:25"
      OUTBOUND_WORKER_ADDR: ":8086"
      POLL_INTERVAL_MS: "5000"
      RUST_LOG: info
      BYOS_DKIM_DEK_FILE: /run/secrets/byos_dkim_dek
      CRYPTO_WORKER_INTERNAL_KEY_FILE: /run/secrets/crypto_worker_internal_key
      INTERNAL_API_KEY_FILE: /run/secrets/internal_api_key
      BYOS_API_ADDR: "api:8080"
    secrets:
      - outbound_delivery_sk
      - outbound_worker_db_password
      - byos_dkim_dek
      - crypto_worker_internal_key
      - internal_api_key
```

---

## Secondary Findings Observed During Phase 0 Trace

1. **Offline Send Queue Omits `attachment_ids` (`apps/webmail/src/App.tsx:3186-3201, 6624-6639`):**
   Even though `QueuedSendItem["payload"]` in `apps/webmail/src/offline_cache.ts:34` defines `attachment_ids?: string[]`, `enqueueSend` and `replayQueue` -> `sendOutbound` do not include `attachment_ids`.
2. **Draft Auto-Save Omits Attachments (`apps/webmail/src/App.tsx:7272-7277`):**
   `performAutoSaveDraft` serializes only `{ subject, recipient, to, body }` in `draftPayload` without attachment metadata/keys.
3. **`buildMimeString` Accepts No Attachments (`apps/webmail/src/App.tsx:338-409`):**
   `buildMimeString` emits only `text/plain` or `multipart/alternative` and has no attachment MIME representation; `services/outbound-worker/src/main.rs:1070-1234` signs and transmits `strip_bcc_headers(&plaintext)` verbatim with no attachment retrieval or `multipart/mixed` assembly.

---

## Why Schema-Free Workarounds Were Rejected

| Alternative Considered | Why Rejected Under Repo Rules & Frozen Specs |
| --- | --- |
| Include `mailboxKey` (`mailbox_sk`) in `encrypted_message` | Directly violates `docs/08-v5.3-final.md` §11 & §13.5 ("outbound-worker must NOT receive `mailbox_sk`") and `04-crypto-boundary` by exposing permanent mailbox-wide decryption authority to `outbound-worker`. |
| Embed attachments in `encrypted_message` MIME | Fails `4<<20` (4 MB) `MaxBytesReader` cap in `services/api/outbound.go:328, 647` vs. 40 MB `MaxAttachmentSize` (`services/api/attachments.go:18`) and violates the prohibition against placing large attachments into outbound queue JSON. |
| Encrypt `payload.bin` with random `att_key` without DB key column | Breaks `downloadAndDecryptAttachment(boxId, attId, mailboxKey)` (`apps/webmail/src/api.ts:971`, `App.tsx:5228, 6704, 6907`) and Draft/Scheduled/cross-device downloads because `020_attachments.sql` has no column to store `wrap(mailbox_sk, att_key)`. |
| Re-upload a duplicate copy via `/attachments/chunks` using an un-specced JSON wrapper inside `encrypted_message` | Invents an unapproved cryptographic/wire protocol in `encrypted_message` (violates `docs/08-v5.3-final.md` §13.3–13.4, `AGENTS.md` Rule 4, and `04-crypto-boundary`), creates a duplicate upload pipeline at send-time, bypasses `attachments.storage_key`, leaves untracked orphan blobs in customer storage, and still fails for standard RFC 5322 `encrypted_message` + `attachment_ids` API requests. |

---

## Exact Required Schema & Protocol Prerequisite to Unblock Release B

To implement Release B cleanly while preserving zero-knowledge `mailbox_sk` isolation, single-pipeline storage up to 40 MB, Draft/Sent decryptability, and V5.3 canonical AAD/HPKE invariants:

1. **Approved Database Schema Migration (e.g., `059_outbound_attachment_keys.sql`):**
   - Add per-attachment key-wrapping columns to `attachments` (or a dedicated join table `outbound_attachment_keys(delivery_id, attachment_id, mailbox_id, wrapped_key_outbound bytea, encryption_version, aad_version, sha256 bytea, plain_size_bytes bigint)`):
     - On `attachments`: `encryption_mode` / `encryption_version`, plus `wrapped_key_mailbox bytea` (`AES-GCM(mailbox_sk, att_key, aad)`) so existing Drafts, Sent copies, Path A conversions, and `downloadAndDecryptAttachment` remain functional without leaking `mailbox_sk` (legacy rows where `wrapped_key_mailbox IS NULL` fall back to direct `mailbox_sk` decryption).
     - On `outbound_attachment_keys` (or `attachments` + grant/internal API): `wrapped_key_outbound bytea NOT NULL` = `HPKE-Seal(outbound_delivery_pk, att_key, outbound_aad)` (reusing canonical 29-byte `canonical_aad(mailbox_id, outbox_seq, encryption_version, aad_version)` and `0x01 || enc(32) || ct`), binding each wrapped attachment key strictly to `(mailbox_id, outbox_seq, delivery_id)` without ever exposing `mailbox_sk` or adding a duplicate object upload.
2. **Approved Protocol & Upload Contract Update (`apps/webmail` + `crypto-core` + `services/api`):**
   - Composer `uploadEncryptedAttachment` encrypts once with a fresh 32-byte CSPRNG `att_key` (`0x01 || nonce(12) || ct+tag`) and sends `wrapped_key_mailbox` alongside the upload; `GET /v1/mailboxes/{mailbox_id}/attachments/{id}` returns `wrapped_key_mailbox` when present so client downloads unwrap `att_key` locally with `mailboxKey`.
   - At Path B send/schedule time (`POST /v1/outbound/send`, `POST /v1/outbound/schedule`, and `replayQueue`), the client wraps `att_key` to `outbound_delivery_pk` using the reserved `outbox_seq` canonical AAD and sends `{ attachment_id, wrapped_key_outbound, sha256 }` metadata (~100 bytes/attachment) without re-uploading attachment blobs.
   - `services/api` exposes an `INTERNAL_API_KEY`-authenticated endpoint (e.g., `GET /v1/internal/outbound/{delivery_id}/attachments?mailbox_id=...`) that validates an active `outbound_queue` row for `(delivery_id, mailbox_id)`, queries linked `attachments` + `wrapped_key_outbound`, streams ciphertexts via `storage-worker /api/retrieve`, and returns metadata + ciphertext + `wrapped_key_outbound` to `outbound-worker` (retaining `outbound_worker` SQL and `storage_connections` least-privilege isolation).
3. **Rust `outbound-worker` Assembly (`services/outbound-worker/src/main.rs`):**
   - For each `outbound_queue` item, calls `decrypt_outbound`, fetches linked attachments from the internal API with strict count/size/timeout bounds (<= 40 MB budget), HPKE-opens `wrapped_key_outbound` with `OUTBOUND_DELIVERY_SK` + canonical outbound AAD, AES-256-GCM decrypts and SHA-256 verifies each attachment transiently in memory, constructs `multipart/mixed` wrapping the original `text/plain` or `multipart/alternative` body + RFC 2045/2231/5322 encoded attachment parts with CRLF line endings, and then invokes `strip_bcc_headers` -> `dkim_sign` -> `assemble_final_message` -> `deliver_raw_to_smtp`.

---

## Raw Evidence (Session Verification Outputs)

**Repository state check (`git rev-parse HEAD ; git status --short`):**
```text
67a9d4a77415e06322e695b18ffbd4d0e57667ba
 M apps/webmail/src/components/Sidebar.tsx
 M apps/webmail/src/components/calendar/CalendarSidebar.tsx
 M apps/webmail/src/components/notes/NotesEditor.tsx
 M apps/webmail/src/components/notes/NotesListItem.tsx
 M apps/webmail/src/components/notes/NotesSidebar.tsx
 M apps/webmail/src/components/notes/NotesView.tsx
 M apps/webmail/src/utils/documentExport.test.ts
 M apps/webmail/src/utils/documentExport.ts
 M services/outbound-worker/legacy/main.go
 M services/outbound-worker/src/main.rs
?? docs/notes_ui_consistency_refinement_report.md
?? docs/notes_word_style_image_editing_completion_report.md
?? docs/outbound_bcc_recipient_fix_report.md
?? docs/webmail_critical_verification_report.md
?? services/outbound-worker/legacy/main_test.go
?? tests/browser/test_notes_word_style_image_editing.mjs
?? tests/browser/verify_critical_delivery_and_workflows.mjs
?? tests/browser/verify_notes_image_persistence_and_export.mjs
?? tests/browser/verify_notes_pdf_and_docx_interoperability.mjs
?? tests/browser/verify_notes_ui_consistency.mjs
?? tests/browser/verify_webmail_critical_ui.mjs
```

**Outbound send/schedule attachment linking (`services/api/outbound.go:520-530` & `841-851`):**
```go
		linkRes, linkErr := tx.Exec(ctx, `UPDATE attachments SET message_id = $1 WHERE id = ANY($2) AND mailbox_id = $3 AND message_id IS NULL`, deliveryID, uniqueIDs, req.MailboxID)
		if linkErr != nil {
			_ = tx.Rollback(ctx)
			http.Error(w, "failed to link attachments", http.StatusInternalServerError)
			return
		}
		if linkRes.RowsAffected() != int64(len(uniqueIDs)) {
			_ = tx.Rollback(ctx)
			http.Error(w, "attachment not found, already linked, or not in this mailbox", http.StatusBadRequest)
			return
		}
```

**Active Rust outbound worker pipeline (`services/outbound-worker/src/main.rs:1070-1078, 1184-1190, 1232-1234`):**
```rust
        let plaintext = match decrypt_outbound(sk, &wrapped, &mailbox_bytes, outbox_seq as u64, &encrypted_message) {
            Ok(p) => p,
            Err(e) => {
                warn!("decrypt failed {}: {}", delivery_id, e);
...
        let sanitized_plaintext = strip_bcc_headers(&plaintext);

        // Sign the sanitized RFC5322 plaintext so DKIM signatures verify against delivered DATA
        let signed = match dkim_sign(&dkim_pem, &dkim_selector, &domain_name, &sanitized_plaintext) {
...
        let final_message = assemble_final_message(&domain_name, &dkim_selector, &signed);

        let delivery_result = deliver_raw_to_smtp(postfix_addr, &envelope, &final_message);
```

---

## Manual Browser Verification

**UNTESTED** — Implementation intentionally stopped at Phase 0 architectural decision prior to any code, migration, or live-runtime edits because no spec-compliant, non-duplicative key-wrapping mechanism currently exists to allow `outbound-worker` to decrypt customer-uploaded attachments without either exposing `mailbox_sk` or applying an unapproved DB migration.

Once the prerequisite schema migration (`attachments` / `outbound_attachment_keys` per-attachment DEK wrapping) and crypto contract update are approved and implemented:
1. Build and start the updated `api`, `outbound-worker`, and `webmail` services against an isolated disposable PostgreSQL + MinIO + mock SMTP capture environment.
2. Log in via the real webmail login flow, open Compose, attach small/binary/Unicode-named/multi-file attachments (including inline images if applicable), and send to an external domain (`Path B`) as well as scheduled Path B.
3. Capture the SMTP `DATA` payload at the mock SMTP listener and assert valid `multipart/mixed` + `multipart/alternative` structure, valid `Content-Disposition` / RFC 2231 / RFC 2047 filenames, intact base64 bytes matching SHA-256 of originals, `DKIM-Signature` verification over the assembled MIME body, and zero `Bcc:` header exposure.
4. Capture browser DevTools network/console/storage state confirming `mailbox_sk` never leaves the client and save screenshots under `tests/browser/artifacts/`.

---

## Release B1: Architecture and Schema Design

A design-only architecture and schema extension package has been authored to unblock Release B2 (Path B external SMTP attachment delivery) while preserving strict zero-knowledge key boundaries (`outbound-worker` never receives `mailbox_sk` or `storage_connections`, and browser/`services/api` never receive `OUTBOUND_DELIVERY_SK`):

### Deliverables Produced

| Artifact | Purpose & Scope |
|---|---|
| `docs/attachment_encryption_protocol_v2.md` | Protocol v2 specification: fresh per-attachment 256-bit `CEK` + `AES-256-GCM` (`0x01 \|\| nonce \|\| ct \|\| tag`) using `byos_crypto_core::aes_gcm_encrypt` with 53-byte binary `blob_aad`; upload-time `cek_owner_wrapped` (`HPKE-X25519-AES256GCM-v1` / optional PQ X-Wing) bound by 53-byte `owner_wrap_aad`; send/schedule-time `cek_outbound_wrapped` bound by 101-byte `outbound_wrap_aad` including `outbox_seq`, `(outbound_key_id, outbound_key_epoch)`, and `metadata_sha256`; epoch-based `OUTBOUND_DELIVERY_SK` rotation protocol; client-side lazy upgrade for legacy `v=1` attachments. |
| `docs/attachment_delivery_schema_migration_proposal.md` | Proposed idempotent migration `infra/postgres/init/070_attachment_encryption_v2_and_delivery.sql` (NOT applied; ordered after `069_outbound_queue_lease_and_outcomes.sql`): additive `attachments` columns (`crypto_version`, `aad_version`, `cek_owner_wrapped`, `owner_wrap_alg`, `owner_key_version`, `plaintext_sha256`, `ciphertext_size_bytes`); normalized `outbound_delivery_attachments` and `draft_attachments` join tables; public-only `outbound_delivery_keys` registry; `attachment_count` and `send_token_key_epoch`/`send_token_key_id` on `outbound_queue` and `scheduled_messages`; `outbound_worker` RBAC revokes preserving `verify_least_privilege`. |
| `docs/attachment_delivery_internal_api_spec.md` | Internal HTTP service contract (`GET /v1/internal/outbound/{delivery_id}/attachments` + `/blob`) guarded by dedicated scoped `X-Internal-Key` (`verifyInternalServiceAuth`), delivery-status gating, transient (`429`/`5xx`) vs permanent (`404`/`422`/crypto) disposition mapping, sequential zeroizing decryption, `multipart/mixed` / `multipart/related` MIME assembly with post-assembly DKIM signing and Release A `strip_bcc_headers`, plus Phase F integration across standard, scheduled/cancel, draft autosave, offline replay, and multi-recipient sends. |

### Key Design Decisions & Open Sign-Off Points Before Release B2

1. **Send-Time Delivery Wrapping (`cek_outbound_wrapped`):** Minting `cek_outbound_wrapped` at `/v1/outbound/send` and `/v1/outbound/schedule` (rather than draft upload time) eliminates stale-epoch wrap failures for long-lived drafts, binds `outbox_seq` and `metadata_sha256` against cross-delivery splicing or MIME/filename tampering, and avoids exposing draft-only attachments to `OUTBOUND_DELIVERY_SK`.
2. **`OUTBOUND_DELIVERY_SK` Keyring Rollout:** `services/outbound-worker` moves from single-key `load_outbound_sk` (`services/outbound-worker/src/main.rs:585-604`) to `/run/secrets/outbound_delivery_keyring.json` keyed by `(key_epoch, key_id)` with single-key `epoch = 1` fallback; `GET /v1/outbound/pubkey` remains backward-compatible with top-level `outbound_delivery_pk` (`apps/webmail/src/api.ts:159`, `services/api/bridge.go:538`) while adding `key_id`, `key_epoch`, `algorithm`, `valid_until`, and `min_accepted_epoch`.
3. **Storage Streaming Improvement:** `services/storage-worker/main.go:683-687` currently marshals `RetrieveResponse.Data` via JSON base64 (`~1.33x` RAM overhead for 40 MiB blobs); Release B2 should decide between adding a raw binary `POST /api/retrieve-stream` handler vs accepting sequential buffered `/api/retrieve` inside memory-capped worker containers.
4. **Migration & Runtime Scope:** Active PostgreSQL `byos` schema, existing application code, Docker secrets, and preserved worktree changes remain unmodified; implementation awaits explicit approval of the `069` (queue leases/outcomes) + `070` (attachment encryption v2) migration sequence and key-rotation operational runbook.

---

## Release B1.1: Independent Architecture Review

> **Decision Recommendation:** **`APPROVED WITH SPECIFIED CONDITIONS`** (approved as the design blueprint for Release B2 **ONLY** upon satisfying every mandatory prerequisite in §§ `Findings` and `Mandatory Release B2 Preconditions` below; active code, migrations, tests, and the `byos` database remain untouched).

### Review Scope & Methodology

An independent, adversarial design audit inspected all three Release B1 design documents (`docs/attachment_encryption_protocol_v2.md`, `docs/attachment_delivery_schema_migration_proposal.md`, `docs/attachment_delivery_internal_api_spec.md`) and `docs/external_attachment_delivery_implementation_report.md` directly against the live repository implementation across:
- Cryptography & WASM bindings (`packages/crypto-core/src/lib.rs`, `packages/crypto-core/src/xwing_hpke.rs`, `packages/crypto-core/Cargo.toml`)
- Frontend compose, key unlock, offline queue & draft autosave (`apps/webmail/src/App.tsx`, `apps/webmail/src/message_crypto.ts`, `apps/webmail/src/routes/setup-account.tsx`, `apps/webmail/src/historical_crypto_roundtrip.ts`, `apps/webmail/src/send_queue.ts`)
- Go API handlers & auth (`services/api/attachments.go`, `services/api/outbound.go`, `services/api/recovery_flow.go`, `services/api/scheduled_completion.go`, `services/api/mailboxes.go`, `services/api/auth.go`, `services/api/main.go`)
- Storage worker, outbound worker & infrastructure (`services/storage-worker/main.go`, `services/outbound-worker/src/main.rs`, `infra/docker-compose.yml`, `infra/postfix/init/10-byos-routing.sh`, `infra/postgres/init/001_init.sql`, `002_outbound_reservations.sql`, `068_draft_folders.sql`)
- Programmatic synthetic test-vector & RFC 2045 Base64 / Postfix / worker-memory calculations executed via Node.js `crypto` (zero real customer or runtime keys used).

### Adversarial Review Findings Table

| Finding | Severity | Evidence | Required action | Status |
|---|---|---|---|---|
| **B1.1-01:** Unsigned `GET /v1/outbound/pubkey` & non-authenticating `key_id` | **CRITICAL** | `services/api/outbound.go:133-145` returns raw `outbound_delivery_pk` with no signature; `key_id = SHA-256("byos-outbound-pk-v1" \|\| pk)[0..8]` acts only as an index and provides zero provenance if `services/api` is compromised; `services/api` also constructs internal manifests and recipient envelopes (`infra/docker-compose.yml:137, 166`). | Explicitly bound V1 security to TLS + host/container TCB isolation; prohibit claiming trustless key provenance; add optional V2+ offline Ed25519 key-authority certificate (`signature_b64` pinned in `apps/webmail`). | **UNRESOLVED IN V1 TCB MODEL**; explicitly bounded & documented in `protocol_v2.md` §3.5 & §4.0 and `internal_api_spec.md` §1. |
| **B1.1-02:** Missing `plaintext_size_bytes` / `ciphertext_sha256` columns & metadata sanitization divergence | **HIGH** | `attachments.size_bytes` (`services/api/attachments.go:263`) stores SEC-005 ciphertext bytes checked at `attachments.go:113`; `sanitizeFilename` (`attachments.go:210, 364-383`) & empty MIME defaulting (`213`) mutate raw metadata after browser `metadata_sha256` calculation. | Keep `attachments.size_bytes` as ciphertext byte length for SEC-005; add `plaintext_size_bytes`, `ciphertext_sha256`, `owner_pk_sha256`, and `trg_attachments_v2_immutable` in `070`; enforce identical canonical UTF-8 NFC filename + parsed lowercase MIME pre-normalization in client & server (`400` on drift). | Remediated in `protocol_v2.md` §3.1–3.3 & `schema_migration_proposal.md` §1.2, §2 (`070` SQL); implementation deferred to Release B2. |
| **B1.1-03:** Server overwrites client UUID & `POST /attachments` storage race / boundary overflow | **HIGH** | `services/api/attachments.go:217` discards any client UUID via `attID := uuid.New()`, uploads to `storage-worker /api/store` (`231`) before PostgreSQL `INSERT` (`263`), and sets `http.MaxBytesReader(..., MaxAttachmentSize)` (`171`) with zero headroom above `40 MiB` (`188`) for multipart boundary headers. | Accept client-supplied UUIDv4 `attachment_id`; insert `upload_status = 'uploading'` DB reservation (`409 Conflict` on duplicate PK) BEFORE `/api/store`; raise `MaxBytesReader` multipart cap to `40 MiB + 64 KiB`. | Remediated in `protocol_v2.md` §3.1–3.2, `schema_migration_proposal.md` §2–3.1, and `internal_api_spec.md` §3.1–3.2; code changes deferred to Release B2. |
| **B1.1-04:** X-Wing raw-AAD WASM gap & `recovery_flow.go` `mailbox_sk_version` non-increment bug | **HIGH** | `packages/crypto-core/src/xwing_hpke.rs:91-141` is Rust-only (`wasm_seal_xwing_envelope` hardcodes JSON `CryptoEnvelope` + ignores raw caller AAD) and uses `mailbox_xwing_pk` (1216B), whereas frozen §13 restricts outbound transport to 32B X25519; PLUS `services/api/recovery_flow.go:383-418, 1077-1098, 1428-1445` updates `mailbox_pk` WITHOUT incrementing `mailbox_sk_version`! | Restrict Protocol v2 strictly to `HPKE-X25519-AES256GCM-v1` over existing `wasm_hpke_seal` / `wasm_hpke_open` (`lib.rs:1889-1940`); mark X-Wing owner wrap deferred/unimplemented; store `owner_pk_sha256`; gate Release B2 on adding atomic `mailbox_sk_version` increment in `recovery_flow.go`. | Specs remediated (`protocol_v2.md` §2, §3.3; `schema_migration_proposal.md` §2; `internal_api_spec.md` §6.1, §7); **`recovery_flow.go` repair required in B2**. |
| **B1.1-05:** Size mismatch, Postfix default 10 MB limit, 30s timeout & `dkim_sign` 3x–4x RAM / UTF-8 hazard | **HIGH** | Node calculations prove `8 MiB` (`8,388,608 B`) plaintext expands to `11,479,150 B` Base64 CRLF (`> 10,240,000 B` upstream Postfix default, as `infra/docker-compose.yml:58-74` and `10-byos-routing.sh` omit `POSTFIX_message_size_limit`); `40 MiB` expands to `57,395,742 B` MIME (`54.74 MiB`, exceeding SES 40 MB) & `55,924,120 B` JSON; `services/api/attachments.go:98, 244` time out at `30s`; `dkim_sign` (`lib.rs:1253-1336`) calls `String::from_utf8_lossy` (corrupting raw `8BITMIME` octets) and holds `~3x` MIME (~`140-190 MiB` peak RSS alongside caller buffers for 25 MiB plaintext). | Split `40 MiB` ciphertext upload cap from **`25 MiB` (`26,214,400 B`)** Path B outbound aggregate plaintext limit (`35,872,340 B` Base64 CRLF); mandate `POSTFIX_message_size_limit: "52428800"`; add binary `POST /api/retrieve-stream` + `>= 120s` timeout; enforce `Semaphore(1)` sequential decrypt, buffer `drop()`/`Zeroizing`, and mandatory 7-bit ASCII `Content-Transfer-Encoding: base64`. | Remediated across `protocol_v2.md` §3.2 and `internal_api_spec.md` §3.1–3.2, §5.2, §7; implementation deferred to Release B2. |
| **B1.1-06:** `outboundScheduledCancelHandler`, `mailboxScheduledUpdateHandler`, `scheduled_completion.go` & offline Path B gaps | **HIGH** | `outboundScheduledCancelHandler` (`services/api/outbound.go:876-937`) omits draft restore & attachment unlink unlike `mailboxScheduledCancelHandler` (`1224-1374`); `mailboxScheduledUpdateHandler` (`1375-1536`) ignores `attachment_ids` / payload edits; `completeScheduledDeliveryTx` (`scheduled_completion.go:109-120, 165-180`) inserts new `sentMsgID != delivery_id` / `draftID != delivery_id`; offline Path B `replayQueue` (`App.tsx:3174-3202`, `send_queue.ts`) skips `prepare` (`outbox_seq`) & `attachment_ids`. | Cover BOTH cancel handlers (`draft_attachments` restore / `message_id = NULL` + `outbound_delivery_attachments` delete); define atomic reschedule vs `409` conflict rule; reconcile `sentMsgID` / `draftID` attachment links; mandate fail-closed offline Path B gating until upgraded to re-mint `cek_outbound_wrapped` with unlocked `mailbox_sk`. | Remediated in `schema_migration_proposal.md` §3.2 and `internal_api_spec.md` §6.2, §6.4, §7; implementation deferred to Release B2. |
| **B1.1-07:** Pre-existing `outbound-worker` autocommit lock loss, false-bounce logging & reaper gap | **MEDIUM-HIGH** | `services/outbound-worker/src/main.rs:695-701` (`poll_scheduled`) and `1025-1030` (`poll_once`) run `SELECT ... FOR UPDATE SKIP LOCKED` under autocommit (`client.query`), releasing locks before I/O; `1070-1076` writes `'bounced'` into `delivery_log` even when retries remain (`status='pending'`); rows past `expires_at` remain stuck `'pending'`. | Require TX-held / leased row claim before fetching attachments, log non-terminal errors as `'retry'` instead of `'bounced'`, and sweep `expires_at <= now()` rows to `'expired'`. | Documented as Release B2 worker preconditions in `internal_api_spec.md` §5.1, §7. |
| **B1.1-08:** Keyring rollback overlap, `accepted_by_mta` window & `404` error code aliasing | **MEDIUM** | `internal_api_spec.md` B1 §2.2 permitted internal blob fetches during `'accepted_by_mta'`, lacked worker keyring startup PK/`key_id` validation + rollback retention guidance, and aliased unknown `delivery_id` with `"attachment_object_missing"` (`404`). | Tighten §2.2 strictly to `status = 'pending' AND expires_at > now()`; mandate machine error codes on `404`; require startup X25519 PK/`key_id` validation and dual-epoch overlap for safe rollback. | Remediated in `internal_api_spec.md` §2.2, §4, §5.2 and `protocol_v2.md` §4.2–4.3. |
| **B1.1-09:** Stale `storage-worker` line citation, migration numbering & missing deterministic vector check | **LOW** | B1 report/API spec cited `services/storage-worker/main.go:683-687` (`RetrieveResponse` struct is line `683`; `retrieveHandler` with `io.ReadAll` JSON marshal is `977-1026`); latest baseline observed as `068_draft_folders.sql`. | Correct `storage-worker/main.go` citations (`683`, `977-1026`, `933`); compute deterministic synthetic SHA-256 / AAD / AES-256-GCM test vectors via Node `crypto`. | Remediated in `protocol_v2.md` §3.6, `schema_migration_proposal.md`, and `internal_api_spec.md` §1, §3.2. |

### Proven Compatibility vs. Unimplemented / Untested Matrix

| Area | Classification | Direct Evidence Observed |
|---|---|---|
| `aes_gcm_encrypt` / `decrypt` & `hpke_seal` / `open` (Rust + WASM raw AAD) | **Proven in existing code** | `packages/crypto-core/src/lib.rs:399-458, 553-635, 1889-1940` (`Zeroize` in `Cargo.toml:67`); X25519 mailbox keys generated on setup (`apps/webmail/src/routes/setup-account.tsx`). |
| `outbound_worker` SQL isolation & `verifyInternalServiceAuth` separation | **Proven in existing code** | `services/outbound-worker/src/main.rs:660-688`, `002_outbound_reservations.sql`, `006_storage_enhancements.sql`, `007_fix_storage_hardening.sql`, `services/api/auth.go:1173-1218` (`subtle.ConstantTimeCompare`). |
| `dkim_sign` UTF-8 & heap behavior; Postfix unset limit; `storage-worker` `RetrieveResponse`; `recovery_flow` & `main.rs` defects | **Proven in existing code** | `lib.rs:1253-1336`, `infra/docker-compose.yml:58-74`, `infra/postfix/init/10-byos-routing.sh`, `services/storage-worker/main.go:175-189, 296-305, 683, 933, 977-1026`, `services/api/recovery_flow.go:383-418`, `services/outbound-worker/src/main.rs:695-701, 1025-1030, 1070-1076`. |
| Deterministic synthetic test vectors & 8 / 25 / 40 MiB Base64 CRLF expansion | **Programmatically computed (non-secret Node.js run)** | Pasted verbatim below (`node` exit code `0`): `53B` `blob_aad` / `owner_wrap_aad`, `101B` `outbound_wrap_aad`, `59B` `blob_ciphertext`, and `11,479,150 B` / `35,872,340 B` / `57,395,742 B` Base64 CRLF bytes. |
| SQL migration `070` (ordered after `069`), trigger `trg_attachments_v2_immutable`, `/api/retrieve-stream`, internal `/v1/internal/outbound/*` endpoints | **UNIMPLEMENTED / UNTESTED** | Design SQL and contracts exist solely in Markdown proposals; zero DDL executed against PostgreSQL. |
| Cross-language `wasm_hpke_seal` <-> Rust `hpke_open`, MIME assembly, Postfix `50 MiB` relay, key rotation & browser E2E flows | **UNIMPLEMENTED / UNTESTED** | Requires Release B2 implementation and live disposable integration test execution (`05-test-verification`). |

### Mandatory Release B2 Entry Conditions

Before merging or deploying any Release B2 code:
1. Repair `services/api/recovery_flow.go` (`383-418, 1077-1098, 1428-1445`) so all `mailbox_pk` mutations atomically increment `mailbox_sk_version`.
2. Fix `services/outbound-worker/src/main.rs` autocommit `FOR UPDATE SKIP LOCKED` lock loss, `'retry'` vs `'bounced'` `delivery_log` writes, and expired-row reaper.
3. Configure `POSTFIX_message_size_limit: "52428800"` in `infra/docker-compose.yml`, enforce the **`25 MiB` (`26,214,400 B`)** Path B external SMTP plaintext budget in Webmail + Go API + Worker, keep `MaxAttachmentSize = 40 MiB` + `64 KiB` multipart headroom in `attachments.go`, and raise storage-worker client timeouts to `>= 120s` alongside `/api/retrieve-stream`.
4. Enforce `HPKE-X25519-AES256GCM-v1` only for V2, mandatory `Content-Transfer-Encoding: base64` prior to `dkim_sign`, sequential `Semaphore(1)` blob decryption with buffer zeroization/dropping, fail-closed offline Path B gating until `replayQueue` supports `prepare` + `cek_outbound_wrapped`, and attachment handling across both scheduled cancel handlers, `mailboxScheduledUpdateHandler`, and `scheduled_completion.go`.
5. Accept & explicitly document the **V1 TCB limitation** on `/v1/outbound/pubkey` origin authenticity (`protocol_v2.md` §4.0).

### Release B1 / B1.1 Updated Documentation Deliverables

| Artifact | Purpose & B1.1 Revisions Applied |
|---|---|
| `docs/attachment_encryption_protocol_v2.md` | Restricted V2 to `HPKE-X25519-AES256GCM-v1` over `wasm_hpke_seal`/`open` (X-Wing deferred), mandated client UUIDv4 pre-allocation & canonical filename/MIME normalization, split 40 MiB ciphertext vs 25 MiB SMTP plaintext budgets, added `owner_pk_sha256` & `recovery_flow.go` prerequisite, embedded programmatic SHA-256/AAD/AES-GCM test vectors, and added §4.0 V1 TCB limitation analysis. |
| `docs/attachment_delivery_schema_migration_proposal.md` | Added `upload_status`, `owner_pk_sha256`, `plaintext_size_bytes`, `ciphertext_sha256`, strict `= 81B` / `= 'HPKE-X25519-AES256GCM-v1'` constraints, `trg_attachments_v2_immutable` trigger, `068_draft_folders.sql` baseline accuracy, and scheduled cancel/update/completion reconciliation rules (`outboundScheduledCancelHandler`, `mailboxScheduledUpdateHandler`, `scheduled_completion.go`). |
| `docs/attachment_delivery_internal_api_spec.md` | Tightened internal access to `status = 'pending' AND expires_at > now()`, separated 25 MiB SMTP cap & `POSTFIX_message_size_limit: "52428800"`, corrected `storage-worker/main.go` lines & required `/api/retrieve-stream` + `>= 120s` timeout, specified `main.rs` TX/retry/reaper/Base64/`dkim_sign` RAM constraints, and covered both cancel handlers + offline fail-closed gating. |
| `docs/external_attachment_delivery_implementation_report.md` | Added this `## Release B1.1: Independent Architecture Review` findings table, Proven vs. Unimplemented/Untested matrix, conditions, decision recommendation (`APPROVED WITH SPECIFIED CONDITIONS`), and verbatim Node vector/sizing output; subsequently updated with Release A.2 queue-reliability status referencing `docs/outbound_queue_claim_reliability_report.md`. |
| `docs/outbound_queue_claim_reliability_report.md` | Release A.2 implementation report covering `outbound-worker` atomic PostgreSQL queue claiming, lease fencing, heartbeat renewal, reaper, retry/bounce/`outcome_unknown` separation, unapplied migration `069`, internal API spec reconciliation, and isolated test output. |

### Raw Evidence — Synthetic Test Vectors & MIME / Storage Size Calculations

Command executed:
```powershell
node -e "/* SHA-256 / AAD / AES-256-GCM vector & 8/25/40 MiB Base64 CRLF calculator */"
```
Verbatim stdout (`exit code 0`):
```json
{
  "outbound_key_id": "2f85927d7d6955b4",
  "outbound_key_id_full": "2f85927d7d6955b4d59137a44ba8f81075ecf62f5be7e6354f78627e88245062",
  "owner_pk_sha256": "9f72ea0cf49536e3c66c787f705186df9a4378083753ae9536d65b3ad7fcddc4",
  "plaintext_sha256": "10f0d751402a8f3724af9323e7b6afed3b232effea92b90e9eeb383080a47a74",
  "meta_preimage_len": 104,
  "metadata_sha256": "771f01f61c58580ad77d09bc09aacf651f2c6e69d9cc0f317f53bc467eaa4a8d",
  "blob_aad_len": 53,
  "blob_aad": "62796f732d6174742d626c6f622d7632550e8400e29b41d4a716446655440000f47ac10b58cc4372a5670e02b2c3d4790000000202",
  "owner_wrap_aad_len": 53,
  "owner_wrap_aad": "62796f732d6174742d6f776e722d7632550e8400e29b41d4a716446655440000f47ac10b58cc4372a5670e02b2c3d4790000000102",
  "outbound_wrap_aad_len": 101,
  "outbound_wrap_aad": "62796f732d6174742d6f7574622d7632550e8400e29b41d4a716446655440000000000000000002af47ac10b58cc4372a5670e02b2c3d4792f85927d7d6955b40000000202771f01f61c58580ad77d09bc09aacf651f2c6e69d9cc0f317f53bc467eaa4a8d",
  "blob_ciphertext_len": 59,
  "blob_ciphertext": "0144444444444444444444444472c88bc1e750bd46e1d6f0d3b5d5873454d83cde258ceb66b30b912751b3530ad6a119598a971fcdb28dd31d2233",
  "ciphertext_sha256": "c31d9319d755565ae8d3a1be2c116f0389bee1e2a6b17ddf1937f451537a11e7",
  "sizes": [
    {
      "mib": 8,
      "raw": 8388608,
      "ct": 8388637,
      "b64Crlf": 11479150,
      "b64Crlf_mib": 10.95,
      "jsonRetrieve": 11184880
    },
    {
      "mib": 25,
      "raw": 26214400,
      "ct": 26214429,
      "b64Crlf": 35872340,
      "b64Crlf_mib": 34.21,
      "jsonRetrieve": 34952600
    },
    {
      "mib": 40,
      "raw": 41943040,
      "ct": 41943069,
      "b64Crlf": 57395742,
      "b64Crlf_mib": 54.74,
      "jsonRetrieve": 55924120
    }
  ]
}
```

---

## Release A.2 & A.2.1 Update — Outbound Queue Claiming & SMTP Protocol Correction Status

Release B1.1 precondition #2 (`B1.1-07`: `services/outbound-worker/src/main.rs` autocommit `FOR UPDATE SKIP LOCKED` lock loss, `'retry'` vs `'bounced'` `delivery_log` writes, expired-row reaper, and lease fencing for Release B2 internal attachment fetches) was implemented in Release A.2 (`docs/outbound_queue_claim_reliability_report.md`) and refined in Release A.2.1 (`docs/outbound_queue_claim_reliability_a2_1_report.md`) alongside unapplied migration proposal `infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql` and reconciled into `docs/attachment_delivery_internal_api_spec.md` (`status = 'processing' AND lease_token = <X-Lease-Token> AND lease_expires_at > now() AND expires_at > now()`). Release A.2.1 replaced `lettre`'s `AsyncSmtpConnection` in the phased relay path with a Tokio RFC 5321 wire client that never emits `RSET`/`QUIT` in `DATA` mode, closes the socket directly without `<CRLF>.<CRLF>` on pre-terminator lease loss, and splits `smtp_phase` into `'claimed'`, `'pre_data'`, `'data_streaming'`, `'terminator_in_flight'`, and `'accepted_by_mta'`. Release B2 remains unimplemented and still requires promoting `069` followed by `070`, repairing `recovery_flow.go`, configuring `POSTFIX_message_size_limit`, and implementing `25 MiB` plaintext / streaming attachment endpoints.

---

## What did not work or is UNTESTED

- **End-to-end Path B external SMTP attachment delivery:** **BLOCKED / UNTESTED** pending user approval of the required database schema migration, Release B1.1 mandatory preconditions (`recovery_flow.go` key-version increment, `main.rs` queue/retry fixes, `POSTFIX_message_size_limit`, `25 MiB` outbound plaintext budget), and Release B2 implementation.
- **Offline queue Path B attachment forwarding (`apps/webmail/src/App.tsx:3186-3201, 6624-6639`) and Draft autosave attachment persistence (`App.tsx:7272-7277`):** **UNTESTED**; also requires propagation once the attachment key-wrapping contract is approved.

---

## Test suite output

**UNTESTED** — No Go (`go test`), Rust (`cargo test`), or Webmail/browser test suites were executed after this read-only architectural review because no application source files, migrations, or test suites were altered (active `byos` PostgreSQL database and prior repository changes were left untouched).
