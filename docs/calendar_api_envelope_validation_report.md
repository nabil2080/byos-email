# BYOS Calendar: API Boundary Encryption Enforcement Report

## What was built
Server-side Section 12 AES-GCM wire-envelope validation was implemented for all calendar event write routes in `services/api/calendar.go`. Before inserting or updating records in the database, the API independently decodes the submitted Base64 payload, enforces a substantiated minimum envelope length of 29 bytes, validates the version byte (`0x01`), rejects plaintext and Base64-wrapped JSON (e.g. `0x7B` `{`, `0x5B` `[`), rejects truncated nonces and authentication tags, and ensures that invalid requests produce zero database writes. Client-side cryptographic boundaries and AAD bindings remain preserved, and the active database records were kept isolated and unmodified.

## Files edited
| File | Reason |
|------|--------|
| `services/api/calendar.go` | Added `validateCalendarEventEnvelope` helper and integrated envelope checks into event creation (`POST`) and update (`PATCH`/`PUT`) handlers. |
| `services/api/calendar_test.go` | Added `TestCalendarEventAPIEnvelopeSecurity` covering 15 validation, persistence, and isolation scenarios; updated existing lifecycle test fixture to valid envelope. |
| `docs/calendar_api_envelope_validation_report.md` | Comprehensive report documenting wire format, API protection, direct integration evidence, and test outcomes. |

---

## Wire-Envelope Format Specification and Source Locations

### Source Inspections:
1. **WASM Crypto Core (Rust):**
   - File: `packages/crypto-core/src/lib.rs`
   - Constant (line 36): `pub const AES_GCM_ENVELOPE_VERSION: u8 = 0x01;`
   - Encryption (lines 400–426):
     ```rust
     // Build envelope: version(1) || nonce(12) || ciphertext+tag(N+16)
     let mut envelope = Vec::with_capacity(1 + 12 + ciphertext.len());
     envelope.push(AES_GCM_ENVELOPE_VERSION);
     envelope.extend_from_slice(&nonce_bytes);
     envelope.extend_from_slice(&ciphertext);
     Ok(envelope)
     ```
   - Decryption format check (lines 434–439):
     ```rust
     if envelope.len() < 29 {
         return Err(CryptoError::InvalidFormat);
     }
     if envelope[0] != AES_GCM_ENVELOPE_VERSION {
         return Err(CryptoError::UnsupportedVersion);
     }
     ```
2. **Webmail Crypto Bridge (TypeScript):**
   - File: `apps/webmail/src/calendar_crypto.ts`
   - `encryptCalendarEventPayload` (lines 86–121): Invokes `wasm_aes_gcm_encrypt` with mailbox key and AAD `byos-calendar-event-v1:<mailbox_id>`, encodes the resulting envelope bytes to standard Base64.
   - `decryptCalendarEventPayload` (lines 128–188): Pre-screens `rawBytes[0] === 0x7b` to refuse unencrypted or legacy JSON payloads, then calls `wasm_aes_gcm_decrypt`.

### Envelope Byte Layout:
- **Offset 0 (1 byte):** Envelope format version. Must equal `0x01` (`AES_GCM_ENVELOPE_VERSION`).
- **Offsets 1..13 (12 bytes):** Nonce / IV generated via CSPRNG (`rand::fill`).
- **Offsets 13..(len-16) (N bytes):** AES-256-GCM ciphertext payload (N >= 0 bytes).
- **Offsets (len-16)..len (16 bytes):** Poly1305 / GHASH AEAD authentication tag.
- **Minimum Valid Envelope Length:** `1 + 12 + 0 + 16 = 29 bytes`.

### Structural Cryptography Note:
Structural wire-envelope validation confirms the format, version, and length constraints of the envelope, but does not prove AES-GCM ciphertext authenticity because the server does not hold `mailbox_sk`. Cryptographic authenticity and mailbox-specific AAD verification are strictly enforced client-side inside WASM.

---

## API Endpoints Protected

All endpoints that write to the `calendar_events` table in PostgreSQL are protected:

1. `POST /v1/mailboxes/{mailbox_id}/calendar-events`
   - Handler: `calendarEventsHandler` (`MethodPost`, `services/api/calendar.go` lines 680–700)
   - Action: Validates `req.EncryptedPayload` via `validateCalendarEventEnvelope` before calendar lookup or SQL `INSERT`.
2. `PATCH /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}`
   - Handler: `calendarEventsHandler` (`MethodPatch`, `services/api/calendar.go` lines 472–485)
   - Action: When `req.EncryptedPayload != nil`, validates via `validateCalendarEventEnvelope` before SQL `UPDATE`.
3. `PUT /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}`
   - Handler: `calendarEventsHandler` (`MethodPut`, `services/api/calendar.go` lines 472–485)
   - Action: Evaluates the same validation block as `PATCH`.

### Validation Behavior & Error Responses:
When validation fails, the API responds with `400 Bad Request` and a consistent error message prefix (`invalid encrypted_payload: `) without leaking cryptographic secrets:
- Missing / whitespace payload: `invalid encrypted_payload: encrypted_payload is required and cannot be empty`
- Corrupted Base64: `invalid encrypted_payload: invalid base64 encoding`
- Payloads < 29 bytes: `invalid encrypted_payload: payload shorter than minimum envelope length (29 bytes)`
- Plaintext JSON (starting with `{` or `[`): `invalid encrypted_payload: plaintext or unencrypted JSON payload is rejected`
- Unsupported version byte: `invalid encrypted_payload: unsupported envelope version: 0x... (expected 0x01)`

---

## Direct HTTP Integration-Test Results

The Go test suite `services/api/calendar_test.go` was expanded with `TestCalendarEventAPIEnvelopeSecurity`, asserting HTTP status codes and database persistence against disposable database `byos_disposable_rehearsal`.

### Direct Go Test Execution:
Command: `$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 ./services/api -run TestCalendar`
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:57: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarLifecycleAndIsolation (0.51s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:199: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.86s)
PASS
ok  	byos.email/services/api	2.871s
```

### Direct Proof of Zero Database Writes on Invalid Requests:
In `TestCalendarEventAPIEnvelopeSecurity`:
1. Row count of `calendar_events` for the test mailbox was measured before each test.
2. The following 9 invalid payloads were dispatched via HTTP `POST`:
   - Base64-encoded plaintext JSON (`{"title":"Insecure Plaintext Event"}`) -> HTTP 400, count = 0
   - Raw JSON string (`{"title":"Raw JSON"}`) -> HTTP 400, count = 0
   - Empty string (`""`) -> HTTP 400, count = 0
   - Invalid Base64 (`"not-valid-base64-&&&%%%"`) -> HTTP 400, count = 0
   - Payload shorter than minimum (15 bytes) -> HTTP 400, count = 0
   - Boundary payload of 28 bytes (1 byte short of 29) -> HTTP 400, count = 0
   - Incorrect version byte (`0x02`, length 30) -> HTTP 400, count = 0
   - Truncated nonce (7 bytes) -> HTTP 400, count = 0
   - Truncated authentication tag (21 bytes) -> HTTP 400, count = 0
3. Total database writes for all 9 invalid creation requests: **0 rows written**.
4. A valid 29-byte envelope was posted -> HTTP 201, count = 1.
5. A valid 55-byte envelope was posted -> HTTP 201, count = 2.
6. The same 9 invalid payloads were dispatched via `PATCH` and `PUT` to the created event ID:
   - Each returned HTTP 400.
   - The stored database `encrypted_payload` was queried after each rejection and evaluated byte-for-byte; **0 modifications occurred**.
7. A valid 40-byte envelope was dispatched via `PATCH` -> HTTP 200, database `encrypted_payload` updated to new envelope.
8. A metadata-only update (`{"status":"tentative"}`) was dispatched -> HTTP 200, status updated while `encrypted_payload` was preserved untouched.
9. An HTTP `GET` request retrieved the event -> HTTP 200, `encrypted_payload` matched the updated Base64 envelope.

---

## Active Database Legacy Record Preservation

The active `byos` PostgreSQL database was inspected to confirm that its three legacy test records were not altered:

Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT id, calendar_id, length(encrypted_payload) as payload_len, encode(substring(encrypted_payload from 1 for 10), 'escape') as prefix_preview, encode(substring(encrypted_payload from 1 for 10), 'hex') as prefix_hex FROM calendar_events;"`
```
                  id                  |             calendar_id              | payload_len | prefix_preview |      prefix_hex      
--------------------------------------+--------------------------------------+-------------+----------------+----------------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         188 | {"title":"     | 7b227469746c65223a22
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         281 | {"title":"     | 7b227469746c65223a22
 a4196298-d4e1-4921-8b26-0a2d470636f3 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         281 | {"title":"     | 7b227469746c65223a22
(3 rows)
```
Status: Untouched. Zero records were modified, re-encrypted, or removed.

---

## Manual Browser Verification

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

## Production Build & Bundle Inspection

Command: `cd apps/webmail; npm run build`
```
dist/index.html                                  1.45 kB │ gzip:   0.73 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm  600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css               1.31 kB │ gzip:   0.61 kB
dist/assets/index-BjZ8eN7u.css                 106.20 kB │ gzip:  16.91 kB
dist/assets/highlight-CFsI1eMM.js               73.46 kB │ gzip:  23.49 kB
dist/assets/index-RMyX9ke4.js                  929.92 kB │ gzip: 227.05 kB
✓ built in 3.75s
```

Command: `Select-String -Path apps/webmail/dist/assets/*.js -Pattern "__BYOS_TEST_"`
Output: 0 matches.

---

## Test File Changes Diff

Per operational directives, here is the exact diff of `services/api/calendar_test.go`:

```diff
--- a/services/api/calendar_test.go
+++ b/services/api/calendar_test.go
@@ -3,6 +3,7 @@ package main
 import (
 	"bytes"
+	"context"
 	"encoding/base64"
 	"encoding/json"
 	"fmt"
@@ -99,7 +100,16 @@ func TestCalendarLifecycleAndIsolation(t *testing.T) {
 	now := time.Now().UTC()
 	startStr := now.Add(1 * time.Hour).Format(time.RFC3339)
 	endStr := now.Add(2 * time.Hour).Format(time.RFC3339)
-	payloadB64 := base64.StdEncoding.EncodeToString([]byte(`{"title":"Sprint Planning","location":"Room A"}`))
+	// Valid Section 12 AES-GCM envelope: version(0x01) || nonce(12) || ciphertext+tag(16)
+	validEnvelope := make([]byte, 29)
+	validEnvelope[0] = 0x01
+	for i := 1; i <= 12; i++ {
+		validEnvelope[i] = byte(i)
+	}
+	for i := 13; i < 29; i++ {
+		validEnvelope[i] = 0xAA
+	}
+	payloadB64 := base64.StdEncoding.EncodeToString(validEnvelope)
 
 	createEventJSON := fmt.Sprintf(`{
 		"calendar_id": "%s",
@@ -194,3 +204,264 @@ func TestCalendarLifecycleAndIsolation(t *testing.T) {
 	_ = userB_Mailbox
 }
+
+func TestCalendarEventAPIEnvelopeSecurity(t *testing.T) {
+	db := setupTestDB(t)
+	defer db.Close()
+	ctx := context.Background()
+	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
+	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "cal-sec-user")
+	token := createTestSession(t, db, ownerID)
+
+	// Auto-create personal calendar
+	w := calRequest(t, http.MethodGet, mailboxID, "", "", token)
+	if w.Code != http.StatusOK {
+		t.Fatalf("get calendars: expected 200, got %d", w.Code)
+	}
+	var calendars []UserCalendar
+	if err := json.NewDecoder(w.Body).Decode(&calendars); err != nil || len(calendars) == 0 {
+		t.Fatalf("failed to decode initial calendar: %v", err)
+	}
+	calID := calendars[0].ID
+
+	countEvents := func() int {
+		var count int
+		err := db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_events WHERE mailbox_id=$1`, mailboxID).Scan(&count)
+		if err != nil {
+			t.Fatalf("failed to count events: %v", err)
+		}
+		return count
+	}
+
+	initialCount := countEvents()
+	if initialCount != 0 {
+		t.Fatalf("expected initial event count to be 0, got %d", initialCount)
+	}
+
+	now := time.Now().UTC()
+	startStr := now.Add(1 * time.Hour).Format(time.RFC3339)
+	endStr := now.Add(2 * time.Hour).Format(time.RFC3339)
+
+	// Helper to send create event request
+	sendCreate := func(payloadStr string) *httptest.ResponseRecorder {
+		body := fmt.Sprintf(`{
+			"calendar_id": "%s",
+			"start_time": "%s",
+			"end_time": "%s",
+			"is_all_day": false,
+			"status": "busy",
+			"encrypted_payload": %s
+		}`, calID, startStr, endStr, payloadStr)
+		return calEventRequest(t, http.MethodPost, mailboxID, "", "", body, token)
+	}
+
+	// 1. Plaintext JSON encoded as Base64 rejected
+	plaintextB64 := base64.StdEncoding.EncodeToString([]byte(`{"title":"Insecure Plaintext Event","location":"Cleartext"}`))
+	w = sendCreate(fmt.Sprintf(`"%s"`, plaintextB64))
+	if w.Code != http.StatusBadRequest {
+		t.Fatalf("create with Base64 plaintext JSON: expected 400, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount {
+		t.Fatalf("database write occurred for Base64 plaintext JSON payload")
+	}
+
+	// 2. Raw JSON rejected
+	w = sendCreate(`"{\"title\":\"Raw JSON\"}"`)
+	if w.Code != http.StatusBadRequest {
+		t.Fatalf("create with raw JSON in string: expected 400, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount {
+		t.Fatalf("database write occurred for raw JSON payload")
+	}
+
+	// 3. Empty payload rejected
+	w = sendCreate(`""`)
+	if w.Code != http.StatusBadRequest {
+		t.Fatalf("create with empty payload: expected 400, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount {
+		t.Fatalf("database write occurred for empty payload")
+	}
+
+	// 4. Invalid Base64 rejected
+	w = sendCreate(`"not-valid-base64-&&&%%%"`)
+	if w.Code != http.StatusBadRequest {
+		t.Fatalf("create with invalid base64: expected 400, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount {
+		t.Fatalf("database write occurred for invalid base64 payload")
+	}
+
+	// 5. Payload shorter than minimum rejected (15 bytes)
+	shortBytes := make([]byte, 15)
+	shortBytes[0] = 0x01
+	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(shortBytes)))
+	if w.Code != http.StatusBadRequest {
+		t.Fatalf("create with short payload (15 bytes): expected 400, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount {
+		t.Fatalf("database write occurred for short payload")
+	}
+
+	// 6. Payload 28 bytes (1 byte short of 29) rejected
+	boundary28 := make([]byte, 28)
+	boundary28[0] = 0x01
+	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(boundary28)))
+	if w.Code != http.StatusBadRequest {
+		t.Fatalf("create with 28-byte payload: expected 400, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount {
+		t.Fatalf("database write occurred for 28-byte payload")
+	}
+
+	// 7. Incorrect version byte rejected (version 0x02, length 30 bytes)
+	wrongVerBytes := make([]byte, 30)
+	wrongVerBytes[0] = 0x02
+	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(wrongVerBytes)))
+	if w.Code != http.StatusBadRequest {
+		t.Fatalf("create with wrong version byte (0x02): expected 400, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount {
+		t.Fatalf("database write occurred for wrong version payload")
+	}
+
+	// 8. Truncated nonce rejected (version 0x01, only 6 bytes of nonce, total 7 bytes)
+	truncNonce := make([]byte, 7)
+	truncNonce[0] = 0x01
+	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(truncNonce)))
+	if w.Code != http.StatusBadRequest {
+		t.Fatalf("create with truncated nonce: expected 400, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount {
+		t.Fatalf("database write occurred for truncated nonce payload")
+	}
+
+	// 9. Truncated authentication tag rejected (version 0x01, 12 nonce bytes, 8 tag bytes, total 21 bytes < 29)
+	truncTag := make([]byte, 21)
+	truncTag[0] = 0x01
+	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(truncTag)))
+	if w.Code != http.StatusBadRequest {
+		t.Fatalf("create with truncated auth tag: expected 400, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount {
+		t.Fatalf("database write occurred for truncated auth tag payload")
+	}
+
+	// 10. Valid encrypted-envelope structure accepted (minimum 29 bytes: 1 ver + 12 nonce + 16 tag)
+	validMinEnvelope := make([]byte, 29)
+	validMinEnvelope[0] = 0x01
+	for i := 1; i <= 12; i++ {
+		validMinEnvelope[i] = byte(i)
+	}
+	for i := 13; i < 29; i++ {
+		validMinEnvelope[i] = 0xBB
+	}
+	validMinB64 := base64.StdEncoding.EncodeToString(validMinEnvelope)
+	w = sendCreate(fmt.Sprintf(`"%s"`, validMinB64))
+	if w.Code != http.StatusCreated {
+		t.Fatalf("create with valid 29-byte envelope: expected 201, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount+1 {
+		t.Fatalf("expected event count %d, got %d", initialCount+1, countEvents())
+	}
+	var createdEv CalendarEvent
+	if err := json.NewDecoder(w.Body).Decode(&createdEv); err != nil {
+		t.Fatalf("decode created event: %v", err)
+	}
+	if createdEv.EncryptedPayload != validMinB64 {
+		t.Fatalf("expected payload %s, got %s", validMinB64, createdEv.EncryptedPayload)
+	}
+
+	// 11. Valid encrypted-envelope structure with ciphertext (e.g. 55 bytes)
+	validCipherEnvelope := make([]byte, 55)
+	validCipherEnvelope[0] = 0x01
+	for i := 1; i <= 12; i++ {
+		validCipherEnvelope[i] = byte(i * 2)
+	}
+	for i := 13; i < 55; i++ {
+		validCipherEnvelope[i] = 0xCC
+	}
+	validCipherB64 := base64.StdEncoding.EncodeToString(validCipherEnvelope)
+	w = sendCreate(fmt.Sprintf(`"%s"`, validCipherB64))
+	if w.Code != http.StatusCreated {
+		t.Fatalf("create with valid 55-byte envelope: expected 201, got %d: %s", w.Code, w.Body.String())
+	}
+	if countEvents() != initialCount+2 {
+		t.Fatalf("expected event count %d, got %d", initialCount+2, countEvents())
+	}
+
+	// 12. Update endpoint (PATCH and PUT) rejects the same invalid payloads
+	invalidPayloads := []struct {
+		name string
+		val  string
+	}{
+		{"Base64 plaintext JSON", plaintextB64},
+		{"Raw JSON", "{\"title\":\"Bad\"}"},
+		{"Empty string", ""},
+		{"Invalid Base64", "not-valid-base64-&&&"},
+		{"Short (15 bytes)", base64.StdEncoding.EncodeToString(shortBytes)},
+		{"Boundary (28 bytes)", base64.StdEncoding.EncodeToString(boundary28)},
+		{"Wrong version (0x02)", base64.StdEncoding.EncodeToString(wrongVerBytes)},
+		{"Truncated nonce (7 bytes)", base64.StdEncoding.EncodeToString(truncNonce)},
+		{"Truncated tag (21 bytes)", base64.StdEncoding.EncodeToString(truncTag)},
+	}
+
+	for _, tc := range invalidPayloads {
+		// PATCH
+		patchBody := fmt.Sprintf(`{"encrypted_payload": "%s"}`, tc.val)
+		w = calEventRequest(t, http.MethodPatch, mailboxID, createdEv.ID, "", patchBody, token)
+		if w.Code != http.StatusBadRequest {
+			t.Fatalf("PATCH with %s: expected 400, got %d: %s", tc.name, w.Code, w.Body.String())
+		}
+
+		// PUT
+		w = calEventRequest(t, http.MethodPut, mailboxID, createdEv.ID, "", patchBody, token)
+		if w.Code != http.StatusBadRequest {
+			t.Fatalf("PUT with %s: expected 400, got %d: %s", tc.name, w.Code, w.Body.String())
+		}
+
+		// Verify database payload was NOT modified
+		var dbPayload []byte
+		err := db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id=$1`, createdEv.ID).Scan(&dbPayload)
+		if err != nil {
+			t.Fatalf("failed to query event payload: %v", err)
+		}
+		if base64.StdEncoding.EncodeToString(dbPayload) != validMinB64 {
+			t.Fatalf("database payload was modified after invalid %s update", tc.name)
+		}
+	}
+
+	// 13. Update endpoint accepts valid new envelope
+	updatedEnvelope := make([]byte, 40)
+	updatedEnvelope[0] = 0x01
+	for i := 1; i < 40; i++ {
+		updatedEnvelope[i] = 0xDD
+	}
+	updatedB64 := base64.StdEncoding.EncodeToString(updatedEnvelope)
+	patchValidBody := fmt.Sprintf(`{"encrypted_payload": "%s"}`, updatedB64)
+	w = calEventRequest(t, http.MethodPatch, mailboxID, createdEv.ID, "", patchValidBody, token)
+	if w.Code != http.StatusOK {
+		t.Fatalf("PATCH with valid envelope: expected 200, got %d: %s", w.Code, w.Body.String())
+	}
+	var dbUpdatedPayload []byte
+	err := db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id=$1`, createdEv.ID).Scan(&dbUpdatedPayload)
+	if err != nil {
+		t.Fatalf("failed to query updated event: %v", err)
+	}
+	if base64.StdEncoding.EncodeToString(dbUpdatedPayload) != updatedB64 {
+		t.Fatalf("database payload was not updated to valid envelope")
+	}
+
+	// 14. Update metadata without sending encrypted_payload keeps existing payload
+	metaUpdateBody := `{"status": "tentative"}`
+	w = calEventRequest(t, http.MethodPatch, mailboxID, createdEv.ID, "", metaUpdateBody, token)
+	if w.Code != http.StatusOK {
+		t.Fatalf("PATCH without encrypted_payload: expected 200, got %d: %s", w.Code, w.Body.String())
+	}
+	var currentStatus string
+	var currentPayload []byte
+	err = db.QueryRowContext(ctx, `SELECT status, encrypted_payload FROM calendar_events WHERE id=$1`, createdEv.ID).Scan(&currentStatus, &currentPayload)
+	if err != nil || currentStatus != "tentative" || base64.StdEncoding.EncodeToString(currentPayload) != updatedB64 {
+		t.Fatalf("unexpected state after metadata update: status=%s, payloadMatch=%v", currentStatus, base64.StdEncoding.EncodeToString(currentPayload) == updatedB64)
+	}
+
+	// 15. GET retrieval returns exact base64 payload
+	w = calEventRequest(t, http.MethodGet, mailboxID, createdEv.ID, "", "", token)
+	if w.Code != http.StatusOK {
+		t.Fatalf("GET event: expected 200, got %d: %s", w.Code, w.Body.String())
+	}
+	var retrievedEv CalendarEvent
+	if err := json.NewDecoder(w.Body).Decode(&retrievedEv); err != nil {
+		t.Fatalf("decode retrieved event: %v", err)
+	}
+	if retrievedEv.EncryptedPayload != updatedB64 {
+		t.Fatalf("expected retrieved payload %s, got %s", updatedB64, retrievedEv.EncryptedPayload)
+	}
+}
```

---

## What Did Not Work or Is Untested

1. **Untested:** Automatic migration of the three legacy records in the active database.
   - *Reason:* By design, the remediation quarantines legacy plaintext records and does not automatically decrypt or modify them. An explicit client-side migration flow has not yet been authored.
   - *Manual Verification Steps:*
     1. Log in as Alice.
     2. Open Calendar View.
     3. Verify legacy events display as `(Encrypted Event - Unable to Decrypt)`.
     4. Build and trigger client re-encryption tool.
     5. Query PostgreSQL `calendar_events` and verify `encrypted_payload` starts with `0x01` byte.

---

## Test Suite Output

### 1. Go Calendar Integration Suite (Full Output)
Command: `$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 ./services/api -run TestCalendar`
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:57: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarLifecycleAndIsolation (0.51s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:199: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.86s)
PASS
ok  	byos.email/services/api	2.871s
```

### 2. Webmail Test Suite (Full Summary Output)
Command: `cd apps/webmail; npm test`
```
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed
TOTP TESTS: 5 passed, 0 failed
DATE TIME TESTS: 10 passed, 0 failed
FILE TYPE TESTS: 10 passed, 0 failed
MULTI-ACCOUNT & STORAGE SYNC TESTS: 39 passed, 0 failed
SESSION EXPIRATION GRACE PERIOD TESTS: 8 passed, 0 failed
ACTIVE ACCOUNT AUTO-RESOLUTION TESTS: 5 passed, 0 failed
SIGNATURE REPOSITORY TESTS: 8 passed, 0 failed
SESSION DEBOUNCE TESTS: 2 passed, 0 failed
MIME ENVELOPE PARSING TESTS: 20 passed, 0 failed
CALENDAR ICS TESTS: 28 passed, 0 failed
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed
CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed

OVERALL: 346 passed, 0 failed
```
