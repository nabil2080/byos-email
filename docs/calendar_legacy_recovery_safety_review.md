# BYOS Calendar: Legacy Recovery Design Correction and Data-Safety Specification

## Executive Summary
This document provides the final, implementation-ready security and data-safety specification for recovering and upgrading legacy calendar events in BYOS. It amends and supersedes the preliminary design in `docs/calendar_legacy_plaintext_recovery_design.md`.

This specification addresses two fundamental vulnerabilities identified in prior proposals:
1. **Mailbox-Key Provenance Vulnerability:** A local encrypt-then-decrypt round-trip is strictly an environment diagnostic; in symmetric encryption, an arbitrary key can encrypt and decrypt its own ciphertext. The specification establishes mandatory dual-layer provenance: the key must originate from the authenticated Argon2id/recovery unseal pipeline, and its derived public key must match the mailbox registration.
2. **Destructive Overwrite Vulnerability:** Updating records in place via `PATCH` before client verification risks permanent data loss if a crash, timeout, or decryption error occurs. The specification defines a non-destructive four-phase state machine with server-side atomic preservation, strict strong ETags, and automated rollback.

---

## 1. Mailbox-Key Authenticity and Provenance Specification

### 1.1 Cryptographic Analysis of Local Round-Trip Fallacy
Under AES-256-GCM, any valid 32-byte candidate key $K_{rand}$ used to encrypt a plaintext $P$ under nonce $N$ and AAD $A$ will decrypt $(C, T)$ back to $P$ with 100% mathematical certainty when the identical $K_{rand}$ is supplied to the decryptor:
$$\text{Decrypt}(K_{rand}, \text{Encrypt}(K_{rand}, P, N, A), N, A) = P$$

Therefore, a local round-trip test evaluates only that the WebAssembly AES-GCM engine is operational. It provides zero mathematical proof that $K_{rand}$ is the authoritative secret key belonging to the owner of the mailbox ($K_{mailbox}$). If an arbitrary, stale, or cross-mailbox key were used, the event would be re-encrypted under the wrong key, rendering it permanently unreadable to the legitimate mailbox owner.

### 1.2 Webmail Key Custody and Unlock Provenance Trace
Inspection of `apps/webmail/src/App.tsx`, `apps/webmail/src/session_isolation.ts`, `apps/webmail/src/message_crypto.ts`, and `packages/crypto-core/src/lib.rs` establishes how the authentic `mailbox_sk` is derived and maintained in custody:

```
[User Login / Unlock Request]
           │
           ├──────────────────────────────────────────────┐
           ▼                                              ▼
[Password Unlock Flow]                         [Recovery Phrase Flow]
  • Source: session_isolation.ts:268             • Source: message_crypto.ts:177
    unsealAccountKeys(id, password, wrapped)       unwrapMailboxKeyWithRecoveryPhrase(...)
  • Calls autoUnwrapKeys() in                     • wasm_recover_root_secret(mnemonic)
    message_crypto.ts:87                           └── BIP39 24 words → entropy → root_secret
  • wasm_passphrase_unwrap_key(pass, salt, env)  • wasm_unwrap_mailbox_key(root, env, boxId)
  • derive_recovery_principal_key(pass, salt)      └── AES-256-GCM decrypt with
    └── Argon2id (t=3, m=64MB, p=4)                    AAD: mailbox_id || "mailbox-sk-v1"
  • AES-256-GCM decrypt with                       • GHASH tag check fails closed on
    AAD: RECOVERY_PRINCIPAL_AAD                      wrong mnemonic or mismatched boxId
  • GHASH tag check fails closed on                           │
    wrong password or tampered salt                           │
           │                                                  │
           └───────────────────────┬──────────────────────────┘
                                   ▼
                    [Authoritative 32-byte mailbox_sk]
                                   │
                                   ├─► sessionStorage: "byos_mailbox_sk_" + boxId
                                   ├─► App.tsx: setMailboxKey(skBytes)
                                   ├─► App.tsx: setUnlockedBoxId(boxId)
                                   │
                                   ▼
                 [Component Distribution via App.tsx]
                   <CalendarView
                     mailboxId={selectedMailbox()?.id}
                     mailboxKey={mailboxKey()}
                   />
```

#### Exact Pipeline Mechanics and Source Trace:
1. **Password-Based Key Unwrapping (`unsealAccountKeys` / `autoUnwrapKeys`):**
   - In `apps/webmail/src/session_isolation.ts` (lines 268–285), `unsealAccountKeys` accepts `accountId`, `password`, and `wrappedSkUser`.
   - In `apps/webmail/src/message_crypto.ts` (lines 87–128), `autoUnwrapKeys` parses the salt (16 bytes) and envelope, then calls `wasm.wasm_passphrase_unwrap_key(password, saltHex, envelopeHex)`.
   - In `packages/crypto-core/src/lib.rs` (lines 301–338), `derive_recovery_principal_key` executes Argon2id with parameters $t=3$, $m=65536\text{ KiB}$ (64 MB), $p=4$, producing a 256-bit Key Encryption Key (KEK).
   - The Rust engine then executes `aes_gcm_decrypt(&key, envelope, RECOVERY_PRINCIPAL_AAD)` where `RECOVERY_PRINCIPAL_AAD = b"byos-recovery-principal-v1"`.
   - **Fail-Closed Boundary:** If the password is incorrect or salt is tampered with, the 16-byte GHASH authentication tag check fails, and the function throws an error without returning key bytes.
2. **Recovery-Phrase Key Unwrapping (`unwrapMailboxKeyWithRecoveryPhrase`):**
   - In `apps/webmail/src/message_crypto.ts` (lines 177–207), user provides their 24-word BIP39 mnemonic phrase.
   - `wasm.wasm_recover_root_secret(mnemonic)` maps the mnemonic to 32 bytes of entropy and derives `root_secret` (lines 365–368 of `lib.rs`).
   - `wasm.wasm_unwrap_mailbox_key(root_secret, wrapped_hex, mailbox_id)` executes `aes_gcm_decrypt(root_secret, wrapped, AAD)` where AAD is `mailbox_id || "mailbox-sk-v1"` (lines 868–883 of `lib.rs`).
   - **Fail-Closed Boundary:** If the mnemonic is incorrect or the `mailbox_id` does not match the envelope AAD, GHASH tag verification fails, aborting key derivation.
3. **Session Key Isolation and Identity Association:**
   - In `apps/webmail/src/session_isolation.ts`, the unsealed private key is stored in `sessionStorage` strictly namespaced: `byos_mailbox_sk_<mailbox_id>`. It is never written to `localStorage`.
   - In `apps/webmail/src/App.tsx`, custody is bound to two coordinated signals:
     - `mailboxKey`: The `Uint8Array(32)` secret key.
     - `unlockedBoxId`: The string UUID of the mailbox for which `mailboxKey` was unlocked.
   - Calling `lockMailbox()` clears both signals (`setMailboxKey(null)` and `setUnlockedBoxId(null)`).
4. **Public-Key Derivation and Consistency Invariant:**
   - In PostgreSQL, the `mailboxes` table stores `mailbox_pk` (`bytea`, 32 bytes) for each mailbox.
   - Per Section 12 specifications, `mailbox_sk` is the X25519 private key, and `mailbox_pk` is the corresponding X25519 public key derived via base-point scalar multiplication:
     $$\text{mailbox\_pk} = \text{X25519\_Base}(\text{mailbox\_sk})$$
   - In Rust `packages/crypto-core/src/lib.rs` (line 1033):
     `let pk = PublicKey::from(&StaticSecret::from(sk));`
   - In the local repository tree, native Rust implements this in `X25519KeyPair::from_secret_key`, but `wasm_x25519_public_key` is not yet exported to TypeScript via `#[wasm_bindgen]`. For future implementation, exposing this function in `lib.rs` is required to allow the client to derive `derivedPk = wasm.wasm_x25519_public_key(mailboxKey)`.

### 1.3 Trustworthiness and Cryptographic Limitations of Stored `mailbox_pk`
It is essential to specify what establishes the trustworthiness of the stored `mailbox_pk`:
1. **Provenance of Stored Public Key:**
   - During user registration or invitation acceptance (`POST /v1/invitations/{token}/claim` or `POST /v1/mailboxes`), the client generates the X25519 keypair in browser memory and submits `mailbox_pk` over TLS to the server.
   - The server stores `mailbox_pk` in `mailboxes.mailbox_pk` as raw `bytea`.
   - When the user logs in, `GET /v1/users/me/mailboxes` returns `mailbox_pk` as authenticated metadata.
2. **Cryptographic Limitation:**
   - The stored `mailbox_pk` in PostgreSQL has no external PKI certificate, digital signature from an offline root, or append-only ledger proof.
   - Therefore, comparing `X25519_Base(mailboxKey) === mailbox.mailbox_pk` represents a **consistency invariant** between the in-memory secret key and the database registration. It proves that the candidate key corresponds to the identity currently registered in the database.
   - It does **NOT** provide independent cryptographic proof of ownership if the server database itself is assumed to be maliciously compromised (e.g. an attacker replacing both `mailbox_pk` and `mailbox_sk_wrapped`).
   - The primary trust anchor remains the user's secret passphrase or recovery mnemonic, which successfully authenticates the Argon2id/AES-GCM unwrap pipeline.

### 1.4 Mandatory Controller Pre-Conditions
The migration controller must reject keys from arbitrary parameters, stale sessions, another mailbox, or unverified sources. Migration may proceed IF AND ONLY IF:
1. `mailboxKey` is a valid 32-byte `Uint8Array` originating directly from `unsealAccountKeys` or `unwrapMailboxKeyWithRecoveryPhrase`.
2. `unlockedBoxId()` strictly matches the event's `mailbox_id`.
3. The derived public key evaluates byte-for-byte identical to `selectedMailbox.mailbox_pk`.
4. The local round-trip encrypt/decrypt test is treated solely as a runtime environment diagnostic, NOT as evidence of key ownership.

---

## 2. Plaintext Retention, Storage Architecture, and Erasure Realities

### 2.1 The Myth of Physical In-Place Erasure in Relational Databases
Prior drafts claimed that writing `\x00` to a PostgreSQL `bytea` field guaranteed physical erasure of legacy plaintext. In enterprise database engines, this claim is architecturally false.

The distinction between logical and physical remediation must be strictly observed:
1. **Active Logical Record:**
   - When Phase 2 executes, `calendar_events.encrypted_payload` is updated to the Section 12 AES-GCM ciphertext. Plaintext is eliminated from standard application queries.
2. **Staging Table Rows (`calendar_event_migrations`):**
   - During the staged window, `legacy_payload` resides in the staging table to permit rollback.
   - Upon Phase 4 finalization, the staging row has `legacy_payload` set to `NULL` (or overwritten).
3. **PostgreSQL MVCC (Multi-Version Concurrency Control) Remnants:**
   - In PostgreSQL, an `UPDATE` does not overwrite disk sectors in place. It marks the existing heap tuple as dead (`t_xmax` set) and writes a new tuple to an available page slot.
   - The dead tuple containing the original plaintext bytes remains physically present on disk until reclaimed by `VACUUM`. Even after vacuuming, operating system disk blocks are not cryptographically wiped.
4. **Write-Ahead Logging (WAL):**
   - Every `INSERT` and `UPDATE` records tuple images in WAL segments (`pg_wal`).
   - Plaintext bytes written during event creation or staging persist in WAL segments until the segments are recycled (governed by `checkpoint_completion_target`, `max_wal_size`, and archive retention).
5. **Replicas, Snapshots, and Database Backups:**
   - Physical streaming replicas receive all WAL records.
   - Storage-level snapshots (e.g. EBS snapshots, ZFS snapshots) and historical `pg_dump` backups captured while plaintext existed retain those records until the snapshot retention horizon expires.
6. **Application Logs and Diagnostics:**
   - BYOS operational policy forbids logging event payloads. No plaintext calendar bytes may be written to application log streams, stdout, or temporary scratch files.

### 2.2 Realistic Plaintext Retention and Remediation Policy
- **Preservation Window:** The legacy payload must be preserved in `calendar_event_migrations` until successful client read-back verification and finalization. It must never be deleted before client confirmation.
- **Logical Remediation:** Upon finalization, the API transaction executes:
  `UPDATE calendar_event_migrations SET legacy_payload = NULL, finalized_at = now() WHERE id = $1;`
- **Physical Lifecycle Remediation:** Elimination of residual plaintext from storage layers requires:
  - Setting short retention on staging rows (e.g. purge staging rows 30 days post-finalization).
  - Normal PostgreSQL WAL recycling cycles.
  - Routine database autovacuum cycles.
  - Aging out historical backups according to the organizational backup retention schedule.

---

## 3. Two-Phase Recoverable State Machine and Reliable Expiration

### 3.1 State Machine Architecture
To prevent destructive overwrites, calendar event migration is structured as a non-destructive state machine with four operational states:

```mermaid
stateDiagram-v2
    [*] --> UNMIGRATED: Legacy Plaintext (Byte 0 = 0x7B)
    
    UNMIGRATED --> PREPARING: User Triggers Migration & Provenance Verified
    
    PREPARING --> STAGED: POST /stage-migration\n(Atomic Backup in Staging Table + Staged Envelope Installed)
    PREPARING --> UNMIGRATED: Validation Fails / Mismatch
    
    STAGED --> CLIENT_VERIFYING: GET /calendar-events/{id}\n(Fetch Staged Envelope for Decryption)
    
    CLIENT_VERIFYING --> FINALIZED: Decryption Matches Plaintext\nPOST /finalize-migration\n(Clear Staging Payload)
    
    CLIENT_VERIFYING --> ROLLED_BACK: Decryption Fails / Mismatch\nPOST /rollback-migration\n(Atomic Restore of Legacy Payload)
    
    STAGED --> ROLLED_BACK: TTL Expiration (Opportunistic or Sweeper)\n(Atomic Restore of Legacy Payload)
    
    FINALIZED --> [*]: Fully Encrypted Section 12 Ciphertext
    ROLLED_BACK --> UNMIGRATED: Restored to Original State
```

### 3.2 Dual-Path Expiration and Reliable Rollback Mechanism
A timestamp column `expires_at` alone does not execute a rollback. If a client crashes or abandons a migration, an active mechanism must restore the legacy payload.

The state machine implements **Dual-Path Expiration**:

#### Path A: Opportunistic Synchronous Recovery (On-Demand)
On ANY incoming HTTP request targeting the event (`GET /v1/.../calendar-events/{event_id}`, `POST /stage-migration`, or `GET /migration-status`), the handler checks for an active staged migration where `expires_at < now()`.
If found, the request handler executes the rollback transaction inline before servicing the request. This guarantees that an expired migration is recovered immediately upon the next user interaction, even if background workers are offline.

#### Path B: Background Sweeper Worker (Asynchronous)
A periodic background task runs every 60 seconds:
```sql
SELECT id, event_id, mailbox_id 
FROM calendar_event_migrations 
WHERE status = 'staged' AND expires_at < now()
ORDER BY created_at ASC
LIMIT 50;
```
For each expired record, the sweeper executes the rollback transaction.

### 3.3 Safe Row Locking Order to Prevent Deadlocks
To prevent database deadlocks between concurrent API requests and the sweeper worker, all operations touching both `calendar_events` and `calendar_event_migrations` MUST acquire row-level locks in the exact same hierarchical order:
1. **Parent Table First:** Lock the row in `calendar_events`:
   ```sql
   SELECT id FROM calendar_events WHERE id = $event_id FOR UPDATE;
   ```
2. **Child Table Second:** Lock the row in `calendar_event_migrations`:
   ```sql
   SELECT id, status, expires_at, legacy_payload 
   FROM calendar_event_migrations 
   WHERE event_id = $event_id AND status = 'staged' 
   FOR UPDATE;
   ```

Because every execution path (staging, finalization, rollback, opportunistic check, and sweeper) locks `calendar_events` before `calendar_event_migrations`, circular lock dependencies cannot occur.

### 3.4 Finalization vs Expiration Race Resolution
If a client attempts finalization at the exact moment the 15-minute TTL expires:
1. Both the finalization handler and the sweeper attempt to acquire the lock on `calendar_events` for `$event_id`.
2. Whichever transaction acquires the lock first evaluates the status:
   - **Case 1 (Client wins lock):** Finalization checks `status = 'staged'`. Status is updated to `'finalized'`, `finalized_at = now()`, and `legacy_payload = NULL`. Transaction commits. When the sweeper subsequently acquires the lock, it observes `status = 'finalized'` and takes zero action.
   - **Case 2 (Sweeper wins lock):** Sweeper checks `expires_at < now()`. It restores `calendar_events.encrypted_payload = legacy_payload`, updates status to `'rolled_back'`, and commits. When the client's finalization handler subsequently acquires the lock, it finds `status = 'rolled_back'`. The API rejects the request with `HTTP 409 Conflict ("Migration expired and was rolled back")`.
3. In all race conditions, **the state machine never discards the preserved legacy payload**. Timeout triggers rollback, never deletion.

### 3.5 Sweeper Crash and Database Outage Resilience
If the sweeper crashes, terminates unexpectedly, or loses database connectivity:
- The staged record and its preserved `legacy_payload` remain intact in PostgreSQL.
- No data is lost or pruned.
- When service is restored, the next client interaction triggers Path A (opportunistic recovery), or the restarted sweeper resumes Path B.

### 3.6 Canonical Database Row-Lock Ordering Specification
To prevent database deadlocks across high-concurrency workloads, all operations touching calendar events and migrations must adhere to a strict, global lock ordering:
1. **Primary Resource (Parent):** `calendar_events` row lock MUST always be acquired first via:
   `SELECT ... FROM calendar_events WHERE id = $event_id FOR UPDATE`
2. **Secondary Resource (Child):** `calendar_event_migrations` row lock MUST always be acquired second via:
   `SELECT ... FROM calendar_event_migrations WHERE event_id = $event_id AND status = 'staged' FOR UPDATE`
3. **Universal Application:** This strict lock hierarchy applies across:
   - Staging (`POST /stage-migration`)
   - Finalization (`POST /finalize-migration`)
   - Rollback (`POST /rollback-migration`)
   - Opportunistic Expiration Sweeper (invoked during `GET`, `PATCH`, `DELETE`)
   - Ordinary Event Mutation and Deletion (`PATCH /calendar-events/{id}`, `DELETE /calendar-events/{id}`)
4. **Deadlock Invariant:** Because every transaction attempts resource acquisition in the identical parent-then-child sequence ($L(\text{parent}) \to L(\text{child})$), Coffman's circular wait condition cannot occur.

### 3.7 Backup Restoration Reconciliation Procedure (`ReconcileRestoredMigrations`)
When a database is restored from a backup snapshot, active migrations that were staged prior to the snapshot may be left in an indeterminate or expired state:
1. **Startup / Pre-Service Reconciliation:** Before normal calendar writes resume, the system executes `ReconcileRestoredMigrations(ctx, conn)`.
2. **Reconciliation Logic:**
   - Traverses all rows in `calendar_event_migrations` where `status = 'staged'`.
   - Acquires row locks using the canonical order (parent `calendar_events` first, child `calendar_event_migrations` second).
   - If `expires_at < now()`, or if the restored event payload requires reconciliation:
     - Restores `calendar_events.encrypted_payload = legacy_payload`.
     - Updates `calendar_event_migrations` status to `'rolled_back'`.
     - Sets `rollback_reason = 'backup_restoration_reconciliation'`.
     - Records `rolled_back_at = now()`.
3. **Safety Guarantee:** Cold restores and disaster-recovery events will never leave calendar events in an unfinalized or corrupted state; any legacy record that was midway through recovery during backup capture is cleanly restored to its original legacy payload.

---

## 4. Strong ETag and Concurrency Semantics

### 4.1 Strong ETag Generation
Concurrency control during migration requires a genuinely strong ETag. Weak ETags (prefixed with `W/`) are strictly prohibited.

The strong ETag is computed exclusively from authoritative database columns via `computeCalendarEventETag`:
$$\text{Digest} = \text{SHA256}( \text{id} \parallel \text{mailbox\_id} \parallel \text{calendar\_id} \parallel \text{start\_time\_rfc3339nano} \parallel \text{end\_time\_rfc3339nano} \parallel \text{is\_all\_day} \parallel \text{coalesce(rrule, '')} \parallel \text{status} \parallel \text{encrypted\_payload} \parallel \text{updated\_at\_rfc3339nano} )$$
$$\text{ETag} = \text{"\""} \parallel \text{hex}(\text{Digest}) \parallel \text{"\""}$$

Because the hash covers every metadata column, the stored payload bytes, and the authoritative nanosecond timestamp, ANY modification to the event produces an entirely different ETag. Syntactic validation enforces RFC 9110 format, rejecting any `If-Match` header not conforming to `^"[0-9a-f]{64}"$`.

### 4.2 Mandatory `If-Match` Enforcement on Staging
The `POST /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}/stage-migration` endpoint requires the `If-Match` HTTP header. Unconditional writes are prohibited.

Validation rules:
1. **Missing Header:** If `If-Match` is absent, the API rejects the request with **`HTTP 428 Precondition Required`**.
2. **Weak ETag Supplied:** If `If-Match` begins with `W/`, the API rejects the request with **`HTTP 400 Bad Request ("Weak ETags are not permitted for migration staging")`**.
3. **Malformed ETag:** If `If-Match` is not a 64-character hex string enclosed in double quotes, the API rejects with **`HTTP 400 Bad Request ("Malformed ETag")`**.
4. **Stale / Mismatched ETag:** If the supplied ETag does not match the computed ETag of the current database record, the API rejects with **`HTTP 412 Precondition Failed`**.
5. **Active Migration In Progress:** If an active staged migration already exists for the event, the API rejects with **`HTTP 409 Conflict ("Migration already in progress")`**.

---

## 5. Staging-Table Lifecycle and Deletion Constraints

### 5.1 Foreign Key Constraints and Accidental Deletion Protection
In prior drafts, the staging table specified `ON DELETE CASCADE`. This created a critical data-loss risk: if an event or mailbox were deleted during the 15-minute staging window, the cascading delete would erase the only preserved copy of the legacy payload.

#### Corrected Schema Definition:
```sql
CREATE TABLE IF NOT EXISTS calendar_event_migrations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id           uuid NOT NULL REFERENCES calendar_events(id) ON DELETE RESTRICT,
    mailbox_id         uuid NOT NULL REFERENCES mailboxes(id) ON DELETE RESTRICT,
    legacy_payload     bytea,
    staged_payload     bytea NOT NULL,
    status             text NOT NULL CHECK (status IN ('staged', 'finalized', 'rolled_back')),
    etag               text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
    finalized_at       timestamptz,
    rolled_back_at     timestamptz,
    rollback_reason    text
);

-- Guarantee at most one active staged migration per event
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_event_active_migration
    ON calendar_event_migrations(event_id)
    WHERE status = 'staged';
```

### 5.2 Deletion Behavior Rules
1. **Event Deletion Blocked During Active Staging:**
   - In `DELETE /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}`, the handler queries for active staged migrations.
   - If an active migration exists (`status = 'staged'`), the endpoint returns **`HTTP 409 Conflict ("Cannot delete event: migration is actively staged")`**.
   - In addition, the `ON DELETE RESTRICT` foreign key constraint causes PostgreSQL to abort the deletion at the database engine level if the API check were bypassed.
2. **Mailbox Deletion Blocked During Active Staging:**
   - Administrative deletion of a mailbox is blocked with **`HTTP 409 Conflict`** if any event belonging to that mailbox has an active staged migration.
3. **Preservation Record Survival Post-Finalization:**
   - When an event is subsequently deleted *after* finalization or rollback, the foreign key constraint can transition: finalized records may either cascade delete (since the legacy payload has already been cleared) or retain audit metadata.
4. **No Destructive Automated Cleanup:**
   - Staging table records must never be automatically purged while in `staged` status.
   - Abandoned records transition strictly to `rolled_back`, ensuring that the original data is restored to `calendar_events` before staging rows are closed.

---

## 6. Implementation Acceptance Matrix

The following matrix defines the required state, HTTP behavior, preservation guarantee, and retry policy for all nineteen operational and error conditions:

| # | Scenario | Expected State | HTTP Behavior | Preservation Guarantee | Retry Behavior |
|---|----------|----------------|---------------|------------------------|----------------|
| **1** | **Correct key and mailbox** | State advances: `UNMIGRATED` $\rightarrow$ `STAGED` $\rightarrow$ `FINALIZED`. | Stage returns `200 OK`; Read-back returns `200 OK`; Finalize returns `200 OK`. | Legacy payload preserved in staging table during verification; purged only upon finalization. | Migration completes; no retry required. |
| **2** | **Wrong mailbox key** | Pre-flight rejection; remains `UNMIGRATED`. | Local rejection; zero HTTP network calls. | Database completely untouched. | User prompted for correct password / key. |
| **3** | **Unauthenticated or stale key** | Pre-flight rejection; remains `UNMIGRATED`. | Local rejection; zero HTTP network calls. | Database completely untouched. | Client prompts for re-authentication. |
| **4** | **Public-key mismatch** | Pre-flight rejection; remains `UNMIGRATED`. | Local rejection; zero HTTP network calls. | Database completely untouched. | Migration aborted; alert flagged for audit. |
| **5** | **Invalid legacy JSON** | Pre-flight parse failure; remains `UNMIGRATED`. | Local rejection; zero HTTP network calls. | Database completely untouched. Legacy record isolated in UI. | Marked unrecoverable; left for admin inspection. |
| **6** | **Staging transaction failure** | Transaction rolls back; remains `UNMIGRATED`. | Stage returns `HTTP 500 Internal Server Error`. | Atomic DB rollback (`BEGIN...ROLLBACK`). Zero mutations persist. | Client retries stage with exponential backoff. |
| **7** | **Lost stage response** | Event is `STAGED` on server; client state ambiguous. | Network timeout on client. | Legacy payload preserved in staging table with active 15-min TTL. | Client calls `GET /migration-status`; if staged, proceeds to read-back. |
| **8** | **Successful read-back** | State advances to `CLIENT_VERIFYING`. | `GET /calendar-events/{id}` returns `200 OK` with staged envelope. | Legacy payload remains preserved in staging table. | Client proceeds to dispatch finalization. |
| **9** | **Failed read-back (mismatch)** | State transitions to `ROLLED_BACK`, then `UNMIGRATED`. | Client calls `POST /rollback-migration`; returns `200 OK`. | Atomic rollback restores original legacy payload to `calendar_events`. | Migration aborted; record returned to quarantine. |
| **10** | **Browser crash during verification** | Event remains `STAGED` until TTL expires, then rolls back. | Client disconnected. | Legacy payload preserved in staging table; restored upon rollback. | Next client launch or sweeper recovers event. |
| **11** | **TTL expiration (15 minutes)** | State transitions to `ROLLED_BACK`, then `UNMIGRATED`. | Opportunistic or sweeper rollback executes. | Legacy payload restored to `calendar_events.encrypted_payload`. | Client re-initiates migration from start. |
| **12** | **Sweeper unavailable / crash** | Event remains `STAGED` until next client request. | Background worker offline. | Staged record and legacy payload remain frozen in DB. | Opportunistic recovery on next API call restores data. |
| **13** | **Concurrent event update** | Event updated by concurrent actor; migration rejected. | Stage returns `HTTP 412 Precondition Failed` or `HTTP 409 Conflict`. | Legacy payload not staged; concurrent write preserved. | Client re-fetches event and re-evaluates. |
| **14** | **Concurrent migration request** | Second request rejected; first request continues. | Second request returns `HTTP 409 Conflict`. | Staging row protected by partial unique index. | Second caller waits or ignores conflict. |
| **15** | **Finalization response lost** | Event finalized on server; client unconfirmed. | Network timeout on client. | Event encrypted in `calendar_events`; staging payload purged. | Client retries finalization; handler is idempotent (`200 OK`). |
| **16** | **Rollback response lost** | Event rolled back on server; client unconfirmed. | Network timeout on client. | Original legacy payload restored to `calendar_events`. | Client retries rollback; handler is idempotent (`200 OK`). |
| **17** | **Mailbox deletion during staging** | Deletion blocked; migration remains `STAGED`. | Delete mailbox returns `HTTP 409 Conflict`. | Preserved legacy payload protected by `RESTRICT` constraint. | Admin must finalize or rollback migration first. |
| **18** | **Event deletion during staging** | Deletion blocked; migration remains `STAGED`. | Delete event returns `HTTP 409 Conflict`. | Preserved legacy payload protected by `RESTRICT` constraint. | User must finalize or rollback migration first. |
| **19** | **Backup restoration during active migration** | Restored to pre-backup snapshot state. | Dependent on backup point-in-time. | Restores database to consistent state of snapshot. | Client detects state and resumes or re-stages. |

---

## 7. Proposed API Endpoints and Data Contracts

### 7.1 `POST /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}/stage-migration`
- **Headers:**
  - `Authorization: Bearer <session_token>`
  - `If-Match: "<strong_sha256_etag>"` (Mandatory)
  - `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "staged_encrypted_payload": "<Base64 Section 12 AES-GCM envelope>"
  }
  ```
- **Responses:**
  - `200 OK`:
    ```json
    {
      "migration_id": "7b82e210-9b34-4b88-a3f2-1d5798991201",
      "event_id": "74b8ea49-47f1-4ed0-abfb-5fc563fbe04f",
      "status": "staged",
      "expires_at": "2026-10-24T19:15:00Z",
      "updated_at": "2026-10-24T19:00:00Z",
      "etag": "\"a9f14b2c89...\""
    }
    ```
  - `400 Bad Request`: Staged envelope fails structural checks (length $< 29$, version $\ne 0x01$), or `If-Match` is weak/malformed.
  - `403 Forbidden`: Authenticated session does not own `mailbox_id`.
  - `404 Not Found`: Mailbox or event not found.
  - `409 Conflict`: Active migration already in progress for this event.
  - `412 Precondition Failed`: `If-Match` ETag does not match stored event record.
  - `428 Precondition Required`: `If-Match` header is missing.

### 7.2 `POST /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}/finalize-migration`
- **Headers:**
  - `Authorization: Bearer <session_token>`
  - `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "migration_id": "7b82e210-9b34-4b88-a3f2-1d5798991201"
  }
  ```
- **Responses:**
  - `200 OK`:
    ```json
    {
      "migration_id": "7b82e210-9b34-4b88-a3f2-1d5798991201",
      "event_id": "74b8ea49-47f1-4ed0-abfb-5fc563fbe04f",
      "status": "finalized",
      "finalized_at": "2026-10-24T19:00:05Z"
    }
    ```
  - `400 Bad Request`: Missing `migration_id`.
  - `403 Forbidden`: Mailbox mismatch.
  - `404 Not Found`: No staged migration record matching `migration_id`.
  - `409 Conflict`: Migration already rolled back or expired.

### 7.3 `POST /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}/rollback-migration`
- **Headers:**
  - `Authorization: Bearer <session_token>`
  - `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "migration_id": "7b82e210-9b34-4b88-a3f2-1d5798991201",
    "reason": "verification_failed"
  }
  ```
- **Responses:**
  - `200 OK`:
    ```json
    {
      "migration_id": "7b82e210-9b34-4b88-a3f2-1d5798991201",
      "event_id": "74b8ea49-47f1-4ed0-abfb-5fc563fbe04f",
      "status": "rolled_back",
      "restored_at": "2026-10-24T19:00:03Z"
    }
    ```
  - `400 Bad Request`: Missing `migration_id` or invalid reason.
  - `404 Not Found`: Migration record not found.
  - `409 Conflict`: Migration already finalized (cannot roll back finalized encrypted state).

### 7.4 `GET /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}/migration-status`
- **Headers:**
  - `Authorization: Bearer <session_token>`
- **Responses:**
  - `200 OK`:
    ```json
    {
      "event_id": "74b8ea49-47f1-4ed0-abfb-5fc563fbe04f",
      "has_active_migration": true,
      "migration_id": "7b82e210-9b34-4b88-a3f2-1d5798991201",
      "status": "staged",
      "expires_at": "2026-10-24T19:15:00Z"
    }
    ```

---

## 8. Operational File Accounting

| File | Reason |
|------|--------|
| `docs/calendar_legacy_recovery_safety_review.md` | Final, implementation-ready security and data-safety specification for legacy calendar recovery. |
| `scratch/check_forbidden_words.js` | Operational verification tool ensuring strict compliance with AGENTS.md evidence rules (gitignored). |

---

## 9. Raw Evidence Section

### 9.1 Active Database Legacy Calendar Records (Read-Only Inspection)
Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT id, mailbox_id, calendar_id, length(encrypted_payload) as payload_len, encode(substring(encrypted_payload from 1 for 10), 'hex') as prefix_hex, encode(substring(encrypted_payload from 1 for 10), 'escape') as prefix_ascii, updated_at FROM calendar_events ORDER BY created_at ASC;"`
```
                  id                  |              mailbox_id              |             calendar_id              | payload_len |      prefix_hex      | prefix_ascii |          updated_at           
--------------------------------------+--------------------------------------+--------------------------------------+-------------+----------------------+--------------+-------------------------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | c0000000-0000-0000-0000-000000000001 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         188 | 7b227469746c65223a22 | {"title":"   | 2026-10-20 08:23:53.880289+00
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | c0000000-0000-0000-0000-000000000001 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         281 | 7b227469746c65223a22 | {"title":"   | 2026-10-20 09:18:50.034662+00
 a4196298-d4e1-4921-8b26-0a2d470636f3 | c0000000-0000-0000-0000-000000000001 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         281 | 7b227469746c65223a22 | {"title":"   | 2026-10-20 09:21:30.891065+00
(3 rows)
```

### 9.2 Mailbox Ownership and Public Key Inspection (Read-Only)
Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT id, user_id, local_part, length(mailbox_pk) as pk_len, encode(mailbox_pk, 'hex') as pk_hex, length(mailbox_sk_wrapped) as wrapped_len FROM mailboxes WHERE id = 'c0000000-0000-0000-0000-000000000001';"`
```
                  id                  |               user_id                | local_part | pk_len |                              pk_hex                              | wrapped_len 
--------------------------------------+--------------------------------------+------------+--------+------------------------------------------------------------------+-------------
 c0000000-0000-0000-0000-000000000001 | cccccccc-0000-0000-0000-000000000002 | alice      |     32 | cf8f6db922a20c734f5726c07c2ab56b87d1aa95cbbf72794a369a1822c17e46 |          61
(1 row)
```

### 9.3 Go API Calendar Security Integration Test Output
Command: `$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 ./services/api -run TestCalendar`
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:57: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarLifecycleAndIsolation (0.58s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:199: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.86s)
PASS
ok  	byos.email/services/api	2.895s
```

### 9.4 Webmail Test Suite Output
Command: `cd apps/webmail; npm.cmd test`
```
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed
TOTP TESTS: 5 passed, 0 failed
DATE TIME TESTS: 10 passed, 0 failed
FILE TYPE TESTS: 10 passed, 0 failed
MULTI-ACCOUNT & STORAGE SYNC TESTS: 46 passed, 0 failed
MIME & ENVELOPE TESTS: 20 passed, 0 failed
MESSAGE ENCRYPTION TESTS: 12 passed, 0 failed
REWRAP VALIDATION TESTS: 20 passed, 0 failed
STORAGE QUOTA TESTS: 21 passed, 0 failed
CALENDAR RRULE TESTS: 18 passed, 0 failed
CALENDAR ICS TESTS: 28 passed, 0 failed
CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed
OVERALL: 346 passed, 0 failed
```

---

## 10. Concluding Review Verdict

**Final Specification Verdict:**

1. **Design Status:** **READY FOR IMPLEMENTATION**
   The specification establishes mathematical and architectural safeguards eliminating both key-provenance vulnerabilities and destructive overwrite data-loss windows. The contract is finalized and ready for code implementation in the upcoming development phase.
2. **Implementation Status:** **NOT IMPLEMENTED (DESIGN-ONLY TASK)**
   No migration endpoints, staging tables, or client-side recovery tools have been implemented in the codebase during this task.
3. **Database State:** **UNTOUCHED AND PRESERVED**
   The three existing legacy calendar records in the active PostgreSQL database (`byos`) remain in their original quarantined state. Zero database migrations or mutations were executed.
4. **Operational & Storage Realities:**
   Physical elimination of plaintext from database storage is governed by PostgreSQL MVCC dead-tuple vacuuming, WAL segment recycling, and organizational backup retention horizons. Logical elimination from the application tier occurs immediately upon Phase 4 finalization.
