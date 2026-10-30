# BYOS Calendar: Legacy Plaintext Recovery Design

## Executive Summary
This design specification defines the architecture, workflow, safety boundaries, and failure mitigations for recovering and re-encrypting the three legacy plaintext calendar events currently residing in the active `byos` PostgreSQL database. In strict accordance with zero-knowledge constraints, recovery is performed client-side using the user's unlocked mailbox private key (`mailbox_sk`) inside the WebAssembly sandbox. The server never receives, decrypts, or processes plaintext event data.

---

## B1. Legacy Record Inventory and Ownership Assessment

### Active Database Inspection (Read-Only):
Inspection of the `calendar_events` table in the active `byos` database established that exactly three legacy records exist:

| Event ID | Mailbox ID | Calendar ID | Payload Length | Prefix (Hex / ASCII) | Created At (UTC) | Status |
|----------|------------|-------------|----------------|----------------------|------------------|--------|
| `74b8ea49-47f1-4ed0-abfb-5fc563fbe04f` | `c0000000-0000-0000-0000-000000000001` | `6ef9acca-12c6-4af9-85f0-c6cdc1316851` | 188 bytes | `7b22746974` (`{"tit`) | 2026-10-20 08:23:53 | `busy` |
| `6c75afcb-5d70-4f5c-b4ca-41bb010405ec` | `c0000000-0000-0000-0000-000000000001` | `6ef9acca-12c6-4af9-85f0-c6cdc1316851` | 281 bytes | `7b22746974` (`{"tit`) | 2026-10-20 09:18:50 | `busy` |
| `a4196298-d4e1-4921-8b26-0a2d470636f3` | `c0000000-0000-0000-0000-000000000001` | `6ef9acca-12c6-4af9-85f0-c6cdc1316851` | 281 bytes | `7b22746974` (`{"tit`) | 2026-10-20 09:21:30 | `busy` |

### Ownership & Accessibility Findings:
1. **Mailbox Ownership:** All three events belong to mailbox `c0000000-0000-0000-0000-000000000001`, assigned to user `alice@byos.local` (`user_id`: `cccccccc-0000-0000-0000-000000000002`).
2. **Account Status:** Both user `alice@byos.local` and her mailbox are active (`is_active = true`, `status = 'active'`). Alice can authenticate using her password.
3. **Key Accessibility:**
   - In `mailboxes`, `mailbox_sk_wrapped` (61 bytes) and `previous_wrapped_sk_user` are populated.
   - When Alice unlocks her mailbox (via password unwrap or recovery phrase in Settings > Security), the client derives the authoritative 32-byte `mailbox_sk` (`Uint8Array(32)`).
4. **Feasibility of Client-Side Recovery:**
   - Because the legacy payloads are Base64-encoded plaintext JSON (decoding to ASCII string beginning with `{"title":`), the client can decode and parse them in browser memory without requiring server assistance.
5. **Format Discrimination Reliability:**
   - In `apps/webmail/src/calendar_crypto.ts`, `classifyCalendarPayload` inspects decoded byte 0:
     - `0x7B` (`{`) or `0x5B` (`[`): Identifies `legacy-plaintext-json`.
     - `0x01` with length >= 29: Identifies `aes-gcm-envelope`.
     - Any other pattern: Identifies `unknown`.
   - The application currently quarantines `legacy-plaintext-json` records by rendering `(Encrypted Event - Unable to Decrypt)`, preventing plaintext leakage and preventing unauthenticated display.

---

## B2. Proposed Client-Side Migration Architecture

### Core Tenets of Recovery:
1. **User Initiation:** The user explicitly triggers recovery from a dedicated banner or Settings section ("Upgrade Legacy Calendar Events").
2. **Mailbox Unlock Prerequisite:** The process aborts immediately if `props.mailboxKey` is absent, invalid, or length != 32 bytes.
3. **In-Memory Processing:** Plaintext JSON parsing and encryption occur exclusively in browser memory.
4. **Section 12 Envelope Compliance:** The client encrypts using `wasm_aes_gcm_encrypt` with `mailbox_sk` and AAD `byos-calendar-event-v1:<mailbox_id>`.
5. **Zero-Knowledge Transport:** The server receives only the authenticated Base64 ciphertext envelope.
6. **Pre-Flight Local Decryption Test:** Before sending the replacement to the server, the client tests decryption of the generated envelope locally in WASM to guarantee that the ciphertext round-trips byte-for-byte.
7. **Read-Back Post-Flight Verification:** After updating via API, the client fetches the event from the server and decrypts it with `mailbox_sk`, corroborating that the persisted ciphertext is authentic and accessible.
8. **Idempotence & Non-Duplication:** Each record is updated in place via `PATCH` using its existing UUID (`id`). No new rows are created.
9. **Non-Destructive Fail-Closed:** A failed migration leaves the existing record unchanged in database storage.
10. **State Tracking:** UI reflects per-item progress (e.g., "1 of 3 events upgraded").

### Recovery Flow Diagram:

```
[User triggers upgrade in UI]
           │
           ▼
[Check mailboxKey in memory] ──(Missing/Invalid)──► Show Unlock Prompt & Abort
           │ (Valid 32-byte key)
           ▼
[Query calendar_events via GET]
           │
           ▼
[Filter events where classifyCalendarPayload(payload) === 'legacy-plaintext-json']
           │
           ▼
   For each legacy event:
   ┌─────────────────────────────────────────────────────────────┐
   │ 1. Decode Base64 legacy payload to UTF-8 string             │
   │ 2. Parse JSON into CalendarEventPlaintext structure        │
   │ 3. Encrypt via encryptCalendarEventPayload(WASM, key, AAD) │
   │ 4. Pre-flight test: decrypt newly formed envelope in memory │
   │    └── If pre-flight fails: log error, preserve DB, abort   │
   │ 5. Dispatch conditional PATCH with new encrypted_payload    │
   │ 6. Post-flight verify: GET event from API and decrypt       │
   │    └── If verify fails: log error, flag for user inspection │
   │ 7. Mark event as migrated in local UI state                 │
   └─────────────────────────────────────────────────────────────┘
           │
           ▼
[All legacy records upgraded to Section 12 AES-GCM envelopes]
```

---

## Proposed API Enhancement: Conditional Update (Optimistic Concurrency)

### Current API Behavior:
`PATCH /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}` updates `encrypted_payload` unconditionally. If a concurrent update occurs between the time the client reads the legacy record and submits the encrypted replacement, the update could overwrite concurrent changes.

### Minimal API Enhancement:
To guarantee safe version-based replacement without altering existing schemas, enhance the `PATCH` handler in `services/api/calendar.go` to support an optional `If-Match` HTTP header (or an optional `expected_updated_at` field in JSON body):

```go
// Optional optimistic concurrency check:
var expectedUpdatedAt *time.Time
if ifMatch := r.Header.Get("If-Match"); ifMatch != "" {
    t, err := time.Parse(time.RFC3339Nano, strings.Trim(ifMatch, "\""))
    if err == nil {
        expectedUpdatedAt = &t
    }
}

// In SQL query:
UPDATE calendar_events
SET ...
WHERE id=$8 AND mailbox_id=$9
  AND ($10::timestamptz IS NULL OR updated_at = $10::timestamptz)
```

If the record was modified by another session in the interim, the query affects 0 rows, and the API returns `412 Precondition Failed` (or `409 Conflict`), alerting the client to re-fetch before re-attempting encryption.

---

## B3. Comprehensive Edge-Case Handling

| Edge Case | Root Cause | Failure Mode Without Mitigation | Architectural Mitigation |
|-----------|------------|---------------------------------|--------------------------|
| **1. Mailbox locked during migration** | User session expired or key cleared from memory. | Partial write or persistence of garbage. | Client evaluates `mailboxKey instanceof Uint8Array && mailboxKey.length === 32` before processing each record. If locked, pauses migration and prompts for passphrase. |
| **2. Wrong mailbox key provided** | Multi-account mixup or stale key in memory. | Encrypting with wrong key makes event unreadable to genuine owner. | **Pre-flight verification:** Client encrypts, immediately decrypts with `mailboxKey`, and compares resulting object with parsed legacy JSON. If mismatch occurs, aborts immediately without network calls. |
| **3. Invalid or corrupted legacy JSON** | Legacy record has malformed JSON syntax. | JSON parser throws uncaught exception. | `try/catch` around `JSON.parse`. Corrupted record is flagged as `Corrupted Legacy Record` in UI, skipped, and left untouched in database for manual recovery. |
| **4. Partially migrated records** | Process interrupted after upgrading 1 of 3 records. | Inconsistent calendar state. | Migration operates on each event independently. Migrated events are valid AES-GCM; remaining events are legacy. Resuming scans for remaining `legacy-plaintext-json` records and resumes from record 2. |
| **5. Network interruption** | HTTP request drops mid-migration. | Ambiguous record state on client. | Because updates are idempotent and conditional on event ID and timestamp, re-running migration after network recovery queries the database, checks payload format, and skips already-upgraded events. |
| **6. Duplicate retry** | User clicks "Upgrade" button multiple times. | Redundant encryption or duplicate event creation. | Updates use `PATCH /.../{event_id}` (in-place modification, zero new rows). Events already classified as `aes-gcm-envelope` are ignored. |
| **7. Concurrent event updates** | Event updated in another tab or device during migration. | Silent overwrite of concurrent metadata changes. | Conditional `If-Match` check rejects the update with HTTP 412/409, prompting the client to re-read the fresh event state. |
| **8. Application closure during migration** | Browser tab closed or refreshed mid-migration. | Half of events upgraded, half legacy. | State is preserved in the database. On next launch, Webmail detects remaining legacy records and presents the upgrade banner. |
| **9. Multiple mailboxes with legacy records** | Organization has multiple users with legacy events. | Attempting to upgrade events using another user's key. | Migration is strictly scoped to the active mailbox ID (`mailbox_id`). Cross-mailbox updates return HTTP 403. |
| **10. Unrecoverable legacy record** | Payload byte length is zero or corrupted beyond repair. | Process hangs or fails entire migration batch. | Unrecoverable record is isolated, marked with a warning badge, and excluded from the batch, allowing healthy records to finalize migration. |

---

## Acceptance Criteria for Future Phase B Implementation

Before implementing the client-side recovery utility in code, the following criteria must be satisfied:

1. **User Authorization:** The recovery workflow requires an explicit user action (e.g. clicking "Upgrade Events").
2. **Key Validation:** Migration requires an active, validated 32-byte `mailbox_sk` in browser memory.
3. **Zero Plaintext Transmission:** No unencrypted event data may be transmitted over the network.
4. **Wire Compliance:** Every replacement payload must conform to Section 12 AES-GCM specifications (length >= 29, version `0x01`, 16-byte GHASH tag, AAD `byos-calendar-event-v1:<mailbox_id>`).
5. **In-Place Idempotence:** The three records (`74b8ea49-...`, `6c75afcb-...`, `a4196298-...`) must retain their original UUIDs, timestamps, and calendar associations.
6. **Pre- and Post-Flight Verification:** Every upgraded event must succeed in local pre-flight decryption and post-persistence read-back decryption before being marked finished.
7. **Zero Data Loss:** Any error encountered during migration of a single event must leave that event's existing database record completely intact.
8. **Automated Test Coverage:** A browser-level test must execute the full migration workflow against a test account, verifying that events transition from quarantined status to successfully rendered calendar events.
