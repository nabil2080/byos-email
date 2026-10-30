# Active BYOS Calendar Data Recovery Plan (Milestone 7)

## Executive Summary
This document defines the formal, safe, and non-destructive recovery plan for the three existing legacy calendar records in the active PostgreSQL database `byos`. These records currently store plaintext JSON payloads rather than zero-knowledge AES-256-GCM wire envelopes. 

In accordance with BYOS Engineering Rules and frozen Section 12 specifications, this migration requires:
1. A verified full database backup taken prior to any operation.
2. Idempotent schema upgrades (`060_calendar_event_migrations.sql`, `061_mailbox_key_reactivations.sql`, `062_calendar_recurrence_exceptions.sql`, `063_calendar_sharing.sql`).
3. Non-destructive client-side encryption and staging with client WASM read-back verification and authoritative ETag checks.
4. Explicit user approval prior to mutating any table in active database `byos`.

---

## 1. Verified Backup Provenance
Prior to any schema changes or record modifications, a full binary PostgreSQL archive was captured and verified.

- **Backup File:** `backups/byos_pre_legacy_recovery_20261025.dump`
- **File Size:** `515,076 bytes`
- **SHA-256 Digest:** `154797E0C661563F9AFAACCA81346C98AE2DD11535A90B9D748C86F63EB7D68A`
- **Verification Status:** Verified via `docker exec -i byos-postgres pg_restore -l` (confirmed 44 tables, indexes, constraints, and triggers intact).

---

## 2. Active Legacy Record Inventory
Read-only forensic inspection confirmed exactly 3 records exist in `byos.calendar_events`:

| Record ID | Mailbox ID | Payload Size | SHA-256 Digest of Plaintext | Summary / Title |
|-----------|------------|--------------|-----------------------------|-----------------|
| `74b8ea49-47f1-4ed0-abfb-5fc563fbe04f` | `c0000000-0000-0000-0000-000000000001` | 188 B | `a49165a967dbe0a638aaeea865e5e0a2607cf075982290c26f468ef4290550ba` | "BYOS Architecture Review" |
| `6c75afcb-5d70-4f5c-b4ca-41bb010405ec` | `c0000000-0000-0000-0000-000000000001` | 281 B | `1c48edf470158700fa5633ae519911b25958d68f6ef9ae2a214faad47d40cf47` | "Phase 5 Architecture Sync" |
| `a4196298-d4e1-4921-8b26-0a2d470636f3` | `c0000000-0000-0000-0000-000000000001` | 281 B | `1934146a517682725fe1bf4fb264f50234003aa555fed908bb74575c92e77202` | "Phase 5 Architecture Sync" |

- **Account Owner:** `alice@byos.local`
- **Mailbox Public Key (`mailbox_pk`):** `4216486b88ff3cb1586c3dbf2150a44d415f287b64f6e941ccb26499c48b2355`
- **Payload Format:** Plaintext UTF-8 JSON starting with byte `0x7b` (`{`), lacking encryption envelope headers and nonce.

---

## 3. Idempotent Schema Migration Requirements
To enable the staged zero-knowledge recovery protocol and downstream calendar capabilities, the following migration files must be applied to `byos`:

1. `infra/postgres/init/060_calendar_event_migrations.sql`:
   - Creates `calendar_event_migrations` table to provide transactional staging, authoritative ETag tracking, 15-minute TTL expiration, and automatic rollback auditing.
   - Enforces `ON DELETE RESTRICT` on active migrations to prevent concurrent mailbox or event deletion during in-flight recovery.
2. `infra/postgres/init/061_mailbox_key_reactivations.sql`:
   - Creates `mailbox_key_reactivations` table for staged historical key recovery.
3. `infra/postgres/init/062_calendar_recurrence_exceptions.sql`:
   - Creates `calendar_event_exceptions` table for detached recurrence exceptions.
4. `infra/postgres/init/063_calendar_sharing.sql`:
   - Creates `calendar_shares` table for encrypted key sharing and permissions.

---

## 4. Four-Phase Zero-Knowledge Recovery Protocol

The recovery executes client-side using `apps/webmail/src/calendar_recovery.ts` and Go backend endpoints in `services/api/calendar.go`:

```
+--------------------------------------------------------------------------------------------------+
| Phase 1: Key Provenance Validation                                                               |
|   - Authenticate Alice and unwrap mailbox secret key using authentic password                    |
|   - Validate key provenance: Pair secret key with mailboxes.mailbox_pk via ECDH / public derivation |
+--------------------------------------------------------------------------------------------------+
                                                │
                                                ▼
+--------------------------------------------------------------------------------------------------+
| Phase 2: Client Encryption & Server Staging                                                      |
|   - Compute ETag on current database event state                                                 |
|   - Encrypt plaintext JSON into Section 12 AES-256-GCM wire envelope:                            |
|       Envelope = 0x01 || Nonce (12B) || Ciphertext || AuthTag (16B)                              |
|       AAD = "byos-calendar-event-v1" || UUID_Bytes(mailbox_id)                                  |
|   - Issue POST /v1/mailboxes/{id}/calendar-events/{id}/stage-migration with If-Match: ETag       |
|   - Server verifies ETag, preserves legacy_payload in audit table, records staged_payload        |
+--------------------------------------------------------------------------------------------------+
                                                │
                                                ▼
+--------------------------------------------------------------------------------------------------+
| Phase 3: Read-Back Decryption & Strict Field-by-Field Verification                               |
|   - Client fetches staged event details                                                          |
|   - Client WASM decrypts the staged ciphertext                                                   |
|   - Assert identical title, description, location, meetingUrl, timezone, uid, sequence, etc.    |
|   - If any discrepancy occurs, trigger POST .../rollback-migration immediately                   |
+--------------------------------------------------------------------------------------------------+
                                                │
                                                ▼
+--------------------------------------------------------------------------------------------------+
| Phase 4: Atomic Finalization & Plaintext Purge                                                   |
|   - Issue POST /v1/mailboxes/{id}/calendar-events/{id}/finalize-migration                        |
|   - Server atomically updates calendar_events.encrypted_payload with staged ciphertext           |
|   - Server sets calendar_event_migrations.legacy_payload = NULL and status = 'finalized'        |
|   - All unencrypted plaintext copies are purged from disk and memory                             |
+--------------------------------------------------------------------------------------------------+
```

---

## 5. Rollback & Failsafe Guarantees
- **ETag Precondition Guarantees:** Any concurrent modification between staging and finalization returns `412 Precondition Failed` and aborts without corrupting data.
- **Rollback API:** If read-back verification fails, `POST .../rollback-migration` atomically restores the event to its pre-staged state.
- **Expiration Janitor Worker:** If a migration is abandoned midway, the background cleaner restores the legacy payload after 15 minutes.
- **Full Database Restoration Command:**
  ```powershell
  docker exec -i byos-postgres pg_restore -U byos -d byos --clean --if-exists < backups/byos_pre_legacy_recovery_20261025.dump
  ```

---

## 6. Post-Recovery Acceptance Invariants
Upon completion of the recovery on `byos`:
1. `SELECT count(*) FROM calendar_events;` must remain exactly 3.
2. `SELECT count(*) FROM calendar_events WHERE encode(substr(encrypted_payload, 1, 1), 'hex') = '01';` must equal 3.
3. `SELECT count(*) FROM calendar_events WHERE encode(substr(encrypted_payload, 1, 1), 'escape') = '{';` must equal 0.
4. `SELECT count(*) FROM calendar_event_migrations WHERE status = 'finalized' AND legacy_payload IS NULL;` must equal 3.
5. All 3 events decrypt cleanly in Webmail with zero unencrypted warnings.
