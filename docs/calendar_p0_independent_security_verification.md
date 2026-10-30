# BYOS Calendar P0 Remediation: Independent Security Verification Report

## What was built
An independent, forensic security review was executed across the BYOS repository to audit the client-side AES-GCM calendar persistence remediation. The inspection audited the entire lifecycle of calendar event creation and updates, validated that all plaintext and Base64 persistence fallbacks have been eliminated from the frontend codebase, substantiated that locked mailboxes fail closed without issuing persistence requests, assessed the Go API boundary constraints, evaluated the quarantine isolation of legacy database records, and corroborated production bundle isolation.

## Files edited
| File | Reason |
|------|--------|
| `docs/calendar_p0_independent_security_verification.md` | Comprehensive independent security audit report of calendar event encryption remediation. |

## Executive Verdict
VERDICT: PASS WITH LIMITATIONS
```
OVERALL: 346 passed, 0 failed
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:56: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarLifecycleAndIsolation (0.50s)
PASS
ok  	byos.email/services/api	2.045s
```

### Limitations Summary
1. **Medium Severity Finding (API Boundary Validation Gap):** The backend Go API handlers in `services/api/calendar.go` validate only that `encrypted_payload` is valid non-empty Base64. They do not validate Section 12 wire envelope constraints (minimum 29 bytes, version byte `0x01`). A custom client or adversary submitting raw HTTP requests could store arbitrary Base64 blobs or plaintext JSON into PostgreSQL.
2. **Operational Constraint (Active Database Legacy Records Quarantined):** The active `byos` PostgreSQL database contains three legacy event records stored as Base64-encoded plaintext JSON. The Webmail client safely quarantines these records by refusing to decrypt them and rendering `(Encrypted Event - Unable to Decrypt)`. A formal, client-side re-encryption procedure is required before those specific legacy events can be decrypted by the user.

---

## Source Files and Functions Inspected

### Frontend Cryptography & Persistence Pipeline
- `apps/webmail/src/calendar_crypto.ts`:
  - `classifyCalendarPayload(rawPayload)` (lines 44–79): Safe non-destructive format identification helper.
  - `encryptCalendarEventPayload(wasm, mailboxKey, mailboxId, details)` (lines 86–121): Client-side AES-GCM-256 encryption using Section 12 envelope format and AAD `byos-calendar-event-v1:<mailbox_id>`.
  - `decryptCalendarEventPayload(wasm, mailboxKey, mailboxId, payloadB64)` (lines 128–188): Authenticated decryption with defensive pre-screening (`rawBytes[0] === 0x7b` check) and fail-closed placeholder handling.
- `apps/webmail/src/components/calendar/CalendarView.tsx`:
  - `handleSaveEvent(payload)` (lines 334–385): Direct event creation and update handler. Validates `props.mailboxKey`, catches encryption failures, and dispatches only encrypted payloads.
- `apps/webmail/src/components/calendar/EventModal.tsx`:
  - `handleSave(e)` (lines 125–130): Form submission guard checking `props.isLocked` before any processing.
- `apps/webmail/src/App.tsx`:
  - `handleRsvpInvitation(ev, rsvpStatus)` (lines 941–945, 1005–1032): iTIP invitation acceptance and update flow. Guards against locked mailboxes and encrypts payload prior to API call.
- `apps/webmail/src/calendar_persistence_security.test.ts`:
  - Test suite (10 tests) evaluating missing keys, locked states, WASM memory faults, absence of Base64 fallback, wrong keys, tampered ciphertexts, and legacy record quarantine.

### WASM Cryptographic Core (Rust)
- `packages/crypto-core/src/lib.rs`:
  - `aes_gcm_encrypt(key, plaintext, aad)` (lines 400–426): Generates 12-byte CSPRNG nonce, computes AES-256-GCM ciphertext with 16-byte Poly1305/GHASH tag, prepends version byte `0x01`.
  - `aes_gcm_decrypt(key, envelope, aad)` (lines 429–460): Rejects payloads `< 29` bytes, validates version byte `0x01`, verifies authentication tag over ciphertext and AAD.
  - `wasm_aes_gcm_encrypt` (lines 1860–1872): WebAssembly export for AES-GCM encryption.
  - `wasm_aes_gcm_decrypt` (lines 1874–1886): WebAssembly export for AES-GCM decryption.

### Backend Handlers & Database Schema
- `services/api/calendar.go`:
  - `createCalendarEvent` (lines 641–645): Decodes Base64 payload and writes to `calendar_events.encrypted_payload`.
  - `updateCalendarEvent` (lines 436–441): Decodes Base64 payload and updates `calendar_events.encrypted_payload`.
- `services/api/calendar_test.go`:
  - `TestCalendarLifecycleAndIsolation` (lines 50–220): Evaluates CRUD operations, foreign key constraints, and cross-mailbox isolation against PostgreSQL.

---

## Complete Event Persistence-Path Inventory
```
$ git grep --untracked -n "createCalendarEvent\|updateCalendarEvent" apps/webmail/src/
apps/webmail/src/App.tsx:95:  createCalendarEvent,
apps/webmail/src/App.tsx:96:  updateCalendarEvent,
apps/webmail/src/App.tsx:1013:        await updateCalendarEvent(currentBox.id, matchedExisting.id, {
apps/webmail/src/App.tsx:1023:        await createCalendarEvent(currentBox.id, {
apps/webmail/src/api.ts:1952:export async function createCalendarEvent(
apps/webmail/src/api.ts:1971:export async function updateCalendarEvent(
apps/webmail/src/components/calendar/CalendarView.tsx:18:  createCalendarEvent,
apps/webmail/src/components/calendar/CalendarView.tsx:19:  updateCalendarEvent,
apps/webmail/src/components/calendar/CalendarView.tsx:373:      const updated = await updateCalendarEvent(props.mailboxId, eventToEdit()!.id, {
apps/webmail/src/components/calendar/CalendarView.tsx:385:      const created = await createCalendarEvent(props.mailboxId, {
```

Across the entire BYOS codebase, calendar events are persisted through exactly two distinct client paths:

```
[Path A: Interactive UI]
EventModal.tsx (handleSave)
  -> CalendarView.tsx (handleSaveEvent)
       -> mailboxKey validation (throws if locked or != 32 bytes)
       -> encryptCalendarEventPayload (WASM AES-GCM-256 + AAD)
       -> api.createCalendarEvent / api.updateCalendarEvent
            -> HTTP POST/PATCH /api/mailboxes/{mailbox_id}/calendar-events
                 -> services/api/calendar.go
                      -> PostgreSQL calendar_events (encrypted_payload bytea)

[Path B: Invitation RSVP Flow]
InvitationCard.tsx / ReadingPane.tsx
  -> App.tsx (handleRsvpInvitation)
       -> mailboxKey check (returns if null)
       -> encryptCalendarEventPayload (WASM AES-GCM-256 + AAD)
       -> api.createCalendarEvent / api.updateCalendarEvent
            -> HTTP POST/PATCH /api/mailboxes/{mailbox_id}/calendar-events
                 -> services/api/calendar.go
                      -> PostgreSQL calendar_events (encrypted_payload bytea)
```

### Trace Details:
1. **Path A (Interactive Calendar UI):**
   - User edits or creates an event in `EventModal.tsx`.
   - `handleSave` checks `props.isLocked`. If locked, sets error message `"Mailbox is locked. Unlock your mailbox to create or edit events."` and returns without invoking `props.onSave`.
   - `handleSaveEvent` in `CalendarView.tsx` checks `props.mailboxKey`:
     ```typescript
     if (!props.mailboxKey || !(props.mailboxKey instanceof Uint8Array) || props.mailboxKey.length !== 32) {
       throw new Error("Mailbox is locked. Unlock your mailbox to create or edit events.");
     }
     ```
   - Encrypts via `encryptCalendarEventPayload`. If WASM fails, it catches the error and throws, terminating execution before `createCalendarEvent` or `updateCalendarEvent` can be invoked.
   - The former Base64 JSON fallback (`btoa(JSON.stringify(payload.details))`) has been completely removed.
2. **Path B (Invitation RSVP Pipeline):**
   - User clicks Accept, Tentative, or Decline in `InvitationCard.tsx`.
   - `handleRsvpInvitation` in `App.tsx` queries `mKey = getMailboxKeyFor(currentBox.id) || mailboxKey()`.
   - If `mKey` is absent, it displays a toast `"Mailbox is locked. Unlock to RSVP."` and aborts immediately without network calls.
   - Encrypts updated event via `encryptCalendarEventPayload` using `mKey` and `currentBox.id`.
   - Dispatches authenticated envelope to backend API.
3. **Alternative Background / Daemons / External Paths:**
   - Background outbound worker (`services/outbound-worker`): Read-only queue worker for email delivery; does not write to `calendar_events`.
   - CalDAV / CardDAV endpoints: None exist in repository.
   - External sync daemons: None exist in repository.
   - Control plane (`apps/control-plane`): Manages authentication, users, domains, sessions; does not interact with calendar persistence.

---

## Findings Ranked by Severity

| Severity | Finding | Affected Component | Status |
|----------|---------|---------------------|--------|
| **Medium** | API boundary lacks Section 12 wire envelope structural validation | `services/api/calendar.go` | Open / Documented |
| **Low** | In-memory component persistence test harness does not make live HTTP calls | `apps/webmail/src/calendar_persistence_security.test.ts` | Mitigated by separate integration suites |
| **Informational** | 3 pre-existing records in active database contain unencrypted Base64 JSON | `calendar_events` table in `byos` DB | Quarantined / Needs client migration tool |

### Finding 1 (Medium Severity): API Boundary Lacks Envelope Wire-Format Structural Validation
- **Location:** `services/api/calendar.go` lines 436–441, 641–645.
- **Description:** While the Webmail UI client strictly encrypts all payloads using WASM AES-GCM before dispatch, the Go API server validates only that `encrypted_payload` is valid non-empty Base64:
  ```go
  payloadBytes, err := base64.StdEncoding.DecodeString(req.EncryptedPayload)
  if err != nil || len(payloadBytes) == 0 {
      http.Error(w, "encrypted_payload is required and must be valid base64", http.StatusBadRequest)
      return
  }
  ```
- **Risk:** A compromised client, third-party script, or direct API caller could store arbitrary unencrypted JSON or corrupt data in the database.
- **Recommendation:** Implement wire-format envelope validation in `calendar.go`:
  ```go
  if len(payloadBytes) < 29 || payloadBytes[0] != 0x01 || payloadBytes[0] == 0x7B {
      http.Error(w, "invalid calendar event envelope: must be section 12 AES-GCM format", http.StatusBadRequest)
      return
  }
  ```

### Finding 2 (Low Severity): Test Harness In-Memory Scope
- **Location:** `apps/webmail/src/calendar_persistence_security.test.ts`.
- **Description:** The 10 newly added P0 persistence security tests use an in-memory harness (`CalendarPersistenceController`) simulating `CalendarView.tsx` with real WASM crypto rather than making real HTTP network requests to `byos-api`.
- **Mitigation:** Live network persistence and database writes are validated by `services/api/calendar_test.go` (`TestCalendarLifecycleAndIsolation`) and Puppeteer browser suite `tests/browser/test_calendar_invitations.mjs`.

---

## Active Database Legacy Plaintext Data Risk Assessment

Inspection of the active `byos` PostgreSQL database revealed that exactly three records exist in `calendar_events`:

```sql
SELECT id, calendar_id, length(encrypted_payload) as payload_len, encode(substring(encrypted_payload from 1 for 10), 'escape') as prefix_preview, encode(substring(encrypted_payload from 1 for 10), 'hex') as prefix_hex FROM calendar_events;
```
Output:
```
                  id                  |             calendar_id              | payload_len | prefix_preview |      prefix_hex      
--------------------------------------+--------------------------------------+-------------+----------------+----------------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         188 | {"title":"     | 7b227469746c65223a22
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         281 | {"title":"     | 7b227469746c65223a22
 a4196298-d4e1-4921-8b26-0a2d470636f3 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         281 | {"title":"     | 7b227469746c65223a22
(3 rows)
```

### Risk & Isolation Evaluation:
1. **Quarantine State:** In `apps/webmail/src/calendar_crypto.ts` (lines 159–163), `decryptCalendarEventPayload` explicitly checks if `rawBytes[0] === 0x7b`. If so, it logs a warning and returns `(Encrypted Event - Unable to Decrypt)`. It refuses to parse the payload as decrypted plaintext.
2. **Preservation:** The records were not deleted or modified during audits, respecting rule constraints.
3. **Zero-Knowledge Recovery Plan:** Because the server does not have the user's private key (`mailbox_sk`), server-side re-encryption is cryptographically impossible without violating the zero-knowledge security boundary.
4. **Recommended Client Recovery Flow:**
   - Add a client-side migration utility to Webmail settings.
   - When the mailbox is unlocked, the client queries events.
   - For any event where `classifyCalendarPayload(rawPayload) === 'legacy-plaintext-json'`, the client displays a prompt to upgrade legacy records.
   - Upon user confirmation, client parses the legacy JSON, re-encrypts using `encryptCalendarEventPayload` with `mailbox_sk`, and updates the event via `PATCH /api/mailboxes/{mailbox_id}/calendar-events/{id}`.

---

## Production Build & Bundle Inspection

Production build was compiled via `npm run build` in `apps/webmail`:
```
dist/index.html                                  1.45 kB │ gzip:   0.73 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm  600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css               1.31 kB │ gzip:   0.61 kB
dist/assets/index-BjZ8eN7u.css                 106.20 kB │ gzip:  16.91 kB
dist/assets/highlight-CFsI1eMM.js               73.46 kB │ gzip:  23.49 kB
dist/assets/index-RMyX9ke4.js                  929.92 kB │ gzip: 227.05 kB
✓ built in 4.49s
```

### Bundle Isolation Scan:
- Scan for development test hooks:
  Command: `Select-String -Path apps/webmail/dist/assets/*.js -Pattern "__BYOS_TEST_"`
  Output: 0 matches.
- Scan for lock guard string in production bundle:
  Command: `Select-String -Path apps/webmail/dist/assets/index-RMyX9ke4.js -Pattern "Mailbox is locked. Unlock your mailbox to create or edit events" -SimpleMatch`
  Output: Corroborated present in production bundle.

---

## Raw Evidence

### 1. Webmail Unit and Component Test Suite
Command: `cd apps/webmail; npm test`
```
Running Calendar Persistence Security Tests (P0 Remediation)...
  ✓ 1. Missing mailbox key prevents event creation
  ✓ 2. Missing mailbox key prevents event updates
  ✓ 3. Locked mailbox causes zero persistence requests
[CalendarPersistenceController] Event encryption failed: Error: WASM AES-GCM encryption failed: Simulated WASM out of memory
  ✓ 4. WASM encryption failure causes zero persistence requests
  ✓ 5. No Base64/plaintext fallback exists in the persistence path
  ✓ 6. Successful encryption persists the encrypted envelope
[calendar_crypto] Decryption failed: decryption failed
[calendar_crypto] Decryption failed: decryption failed
  ✓ 7. Wrong mailbox key cannot decrypt another mailbox's event
[calendar_crypto] Decryption failed: decryption failed
  ✓ 8. Tampered ciphertext fails closed
  ✓ 9. Existing valid encrypted events remain readable
[calendar_crypto] Refusing to interpret unencrypted or legacy JSON payload as decrypted ciphertext
  ✓ 10. Existing legacy records are identified without being silently modified
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed

OVERALL: 346 passed, 0 failed
```

### 2. Go Backend Integration Test Suite
Command: `$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 ./services/api -run TestCalendar`
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:56: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarLifecycleAndIsolation (0.50s)
PASS
ok  	byos.email/services/api	2.045s
```

### 3. Browser End-to-End Suite
Command: `node tests/browser/test_calendar_invitations.mjs`
```
================================================================================
          BYOS CALENDAR PHASE 5: INVITATION INTEGRATION BROWSER TEST            
================================================================================

--- [STEP 1] Real login flow as Alice (alice@byos.local) ---
  Successfully logged in as Alice.

--- [STEP 2] Opening an email to mount ReadingPane ---
  debug_reading_pane html length: 106132
  has window.__BYOS_TEST_SET_CALENDAR_ICS__: true

--- [STEP 3] Testing Interactive Invitation Card in ReadingPane ---
  PASS: Calendar Invitation Card rendered in ReadingPane
  PASS: Card displays correct event title
  PASS: Card displays organizer name
  PASS: Card displays organizer email
  PASS: Card displays event location
  PASS: Card displays method badge
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_card.png

--- [STEP 3b] Testing Authenticity Warning (Organizer Mismatch) ---
  PASS: Authenticity warning banner rendered when organizer differs from sender
  PASS: Warning identifies divergent organizer email
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_authenticity_warning.png

--- [STEP 4] Exercising RSVP Lifecycle (Accept, Tentative, Decline) ---
  PASS: Card reflects Accepted RSVP state
  PASS: Action feedback banner confirms calendar sync
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_accepted.png
  PASS: Card reflects Tentative RSVP state
  PASS: Card reflects Declined RSVP state

--- [STEP 4b] Security rejection: BYOS policy (neg seq) and organizer-mismatch helper ---
  PASS: BYOS policy: sequence -1 was rejected before mailbox-key guard
  PASS: Rejection message attributes to BYOS policy
  PASS: Organizer-mismatch helper correctly rejects with synthetic state

--- [STEP 4c] Locked-mailbox fail-closed: hijack with positive seq returns without throw ---
  PASS: Locked mailbox: handleRsvpInvitation must return (not throw) when mailbox key unavailable

--- [STEP 5] Testing Event Cancellation (METHOD:CANCEL) ---
  PASS: Card displays Event Cancelled badge
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_cancelled.png

--- [STEP 6] Testing Calendar Module with Outgoing Invitations ---
  PASS: Calendar view rendered
  PASS: Event modal opened
  PASS: Send invitations checkbox rendered when attendees are specified
  PASS: Send invitations checkbox is checked by default
  Phase 5 event with attendees and invitation flag created successfully.
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_event_created.png

--- [STEP 7] Verifying 375px Mobile Viewport Responsiveness ---
  PASS: 375px mobile viewport has NO horizontal overflow
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_invitations_mobile_375px.png

--- [STEP 8] Returning to Mail View ---
  PASS: Successfully returned to Mail view

================================================================================
    ALL CALENDAR INVITATION BROWSER TESTS COMPLETED SUCCESSFULLY!                
================================================================================
```

---

## What Did Not Work or Is Untested

1. **Untested:** Direct Go API rejection of raw Base64 JSON payloads.
   - *Reason:* The backend validation currently accepts non-empty Base64 blobs. A test asserting that the Go server returns HTTP 400 when sent raw JSON cannot succeed until the server-side envelope check described in Finding 1 is added.
   - *Manual Verification Steps:*
     1. Issue `curl -X POST http://localhost:8080/api/mailboxes/{mailbox_id}/calendar-events -d '{"calendar_id":"...","encrypted_payload":"eyJ0aXRsZSI6ICJUZXN0In0="}'`.
     2. Observe HTTP 201 created.
     3. Apply server-side envelope validation patch.
     4. Re-run `curl` and verify HTTP 400 bad request.
2. **Untested:** Automatic migration of the 3 existing legacy database records.
   - *Reason:* By design, the remediation quarantines legacy plaintext records and does not automatically decrypt or modify them. An explicit client-side migration flow has not yet been authored.
   - *Manual Verification Steps:*
     1. Log in as Alice.
     2. Open Calendar View.
     3. Verify legacy events display as `(Encrypted Event - Unable to Decrypt)`.
     4. Build and trigger client re-encryption tool.
     5. Query PostgreSQL `calendar_events` and verify `encrypted_payload` starts with `0x01` byte.

---

## Remaining Blockers Before Calendar Security Acceptance

Before final release and security acceptance of the Calendar subsystem:
1. **API Boundary Validation:** Add structural Section 12 AES-GCM envelope validation in `services/api/calendar.go` (`createCalendarEvent` and `updateCalendarEvent`) to reject non-envelope or raw JSON payloads at the HTTP layer.
2. **Client-Side Legacy Record Migration Utility:** Author an explicit, user-initiated migration dialog to re-encrypt Alice's three legacy records using her unlocked `mailbox_sk`.
