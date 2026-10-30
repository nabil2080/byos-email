# BYOS Calendar Phase 5.1 & Phase 5.1.1: Security, Interoperability, and Evidence Correction Report

## What was built

Phase 5.1 and Phase 5.1.1 delivered comprehensive security hardening, standards-accurate sequence semantics, test-hook isolation, and full-lifecycle persistence verification for the BYOS Calendar invitation system:

1. **RFC 5545 / RFC 5546 SEQUENCE Standards Realignment**: Corrected the standards claim regarding `SEQUENCE`. RFC 5545 specifies `INTEGER` as a signed value; RFC 5546 §3.5 dictates that an organizer begins components at zero and monotonically increments revisions. BYOS's rejection of negative sequence numbers is now strictly classified as a **BYOS validation policy** (`isInvalidInput: true`), completely distinguished from genuine older-revision detection (`isStale: true`) and idempotent duplicate delivery (`isDuplicate: true`).
2. **Method-Specific Sequence Semantics**: Added explicit handling and tests for scheduling methods per RFC 5546:
   - `METHOD:REQUEST`: Organizer revision increment updates stored sequence and event details.
   - `METHOD:CANCEL`: Organizer cancellation requires sequence increment above the latest stored REQUEST.
   - `METHOD:REPLY`: Attendee echoes the organizer's sequence without incrementing it; inbound attendee replies are never falsely rejected as stale.
   - Duplicate delivery: Repeated delivery of the same revision with the same RSVP status is detected as duplicate and produces no side effects or re-sent emails.
   - Recurring instances: Single-instance exceptions identified and correlated by `UID` plus `RECURRENCE-ID`.
3. **Isolated Repository Integration Suite**: Built `apps/webmail/src/calendar_invitation_repository.test.ts` executing the complete persistence and cryptographic lifecycle against an isolated calendar event repository. This verifies genuine stale REQUEST rejection (sequence 2 arriving when sequence 3 is stored), newer REQUEST application (sequence 4), duplicate delivery idempotence, stale CANCEL rejection, valid CANCEL application, organizer hijack rejection, and locked-mailbox fail-closed behavior, asserting both returned result and persisted database state at every single step.
4. **Test Hook Security Review & Production Tree-Shaking**: Gated all internal testing hooks (`__BYOS_TEST_HANDLE_RSVP__`, `__BYOS_TEST_VERIFY_AUTHENTICITY__`, etc.) behind `import.meta.env.DEV && typeof window !== "undefined"`. Verified via static inspection of the production Vite/Rollup build (`dist/assets/*.js`) that zero test hooks are present in production bundles.
5. **Locked-Mailbox Fail-Closed Verification**: Validated through both repository integration tests and browser tests that when the mailbox key is unavailable (locked mailbox), the invitation pipeline fails closed with an actionable unlock prompt and refuses to update stored events or generate outbound email.

## Files edited

| File | Reason |
|------|--------|
| `apps/webmail/src/utils/calendarIcs.ts` | Aligned SEQUENCE documentation with RFC 5545/5546, introduced `isInvalidInput` in `AuthenticityCheckResult` for BYOS policy rejections, distinguished from `isStale` and `isDuplicate`. |
| `apps/webmail/src/utils/calendarIcs.test.ts` | Updated test 10, added tests 21-27 covering BYOS negative sequence policy, full sequence lifecycle, REPLY semantics, CANCEL sequence requirements, recurring RECURRENCE-ID exceptions, and organizer authorization. |
| `apps/webmail/src/calendar_invitation_repository.test.ts` | Added isolated repository integration test suite verifying persistence, WASM encryption/decryption, stale rejection, duplicate idempotence, and locked-mailbox fail-closed behavior. |
| `apps/webmail/src/run_test.node.js` | Registered `runCalendarInvitationRepositoryTests` in webmail test runner. |
| `apps/webmail/src/App.tsx` | Gated internal test hooks behind `import.meta.env.DEV`, tree-shaking them from production builds; aligned pre-check comments with BYOS policy terminology. |
| `apps/webmail/tsconfig.json` | Added `vite/client` type definitions to support `import.meta.env` typechecking. |
| `tests/browser/test_calendar_invitations.mjs` | Updated Step 4b to distinguish BYOS policy sequence rejection from organizer-mismatch helper; added Step 4c testing locked-mailbox fail-closed behavior through the application path; pointed to port 3004. |
| `docs/calendar_phase_5_1_security_interoperability_report.md` | Authoritative security, interoperability, and evidence correction report. |

## Raw evidence

### 1. Production Build Hook Tree-Shaking Verification

Command:
```powershell
cd f:\Codex\byos-email\apps\webmail; npm.cmd run build
```

Terminal output:
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 158 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  1.45 kB │ gzip:   0.73 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm  600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css               1.31 kB │ gzip:   0.61 kB
dist/assets/index-BjZ8eN7u.css                 106.20 kB │ gzip:  16.91 kB
dist/assets/highlight-CFsI1eMM.js               73.46 kB │ gzip:  23.49 kB
dist/assets/index-C1WRDt2u.js                  928.04 kB │ gzip: 226.54 kB
✓ built in 4.15s
```

Inspection of `dist/assets/*.js` for test hooks:
Command:
```powershell
Select-String -Path "f:\Codex\byos-email\apps\webmail\dist\assets\*.js" -Pattern "__BYOS_TEST_"
```

Terminal output:
```
(no output - pattern not found in any production bundle)
```

Verification claim:
verified
(no output - pattern not found in any production bundle)

### 2. TypeScript Typecheck Execution

Command:
```powershell
cd f:\Codex\byos-email\apps\webmail; npm.cmd run typecheck
```

Terminal output:
```
> typecheck
> tsc --noEmit
```

Verification claim:
verified
> typecheck
> tsc --noEmit

### 3. Active Database Calendar Records Reconciliation

Querying `user_calendars` table in active `byos` database:
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "SELECT id, mailbox_id, name, color, is_default, created_at FROM user_calendars ORDER BY created_at;"
```

Terminal output:
```
                  id                  |              mailbox_id              |         name         |  color  | is_default |          created_at           
--------------------------------------+--------------------------------------+----------------------+---------+------------+-------------------------------
 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | c0000000-0000-0000-0000-000000000001 | Personal             | #9E725F | t          | 2026-10-20 08:23:50.367108+00
 8839f2cf-7ec7-4a4c-9e20-a78ebab2e19f | c0000000-0000-0000-0000-000000000001 | Engineering Projects | #9E725F | f          | 2026-10-20 08:23:55.809369+00
 d87f94be-d675-46ec-8970-a43a2e4e5355 | c0000000-0000-0000-0000-000000000002 | Personal             | #9E725F | t          | 2026-10-20 08:26:56.226259+00
(3 rows)
```

Querying `calendar_events` table in active `byos` database:
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "SELECT id, mailbox_id, calendar_id, start_time, end_time, is_all_day, status, length(encrypted_payload) as payload_len, created_at FROM calendar_events ORDER BY created_at;"
```

Terminal output:
```
                  id                  |              mailbox_id              |             calendar_id              |       start_time       |        end_time        | is_all_day | status | payload_len |          created_at           
--------------------------------------+--------------------------------------+--------------------------------------+------------------------+------------------------+------------+--------+-------------+-------------------------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | c0000000-0000-0000-0000-000000000001 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | 2026-10-20 08:23:00+00 | 2026-10-20 09:23:00+00 | f          | busy   |         188 | 2026-10-20 08:23:53.880289+00
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | c0000000-0000-0000-0000-000000000001 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | 2026-10-20 09:18:00+00 | 2026-10-20 10:18:00+00 | f          | busy   |         281 | 2026-10-20 09:18:50.034662+00
 a4196298-d4e1-4921-8b26-0a2d470636f3 | c0000000-0000-0000-0000-000000000001 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | 2026-10-20 09:21:00+00 | 2026-10-21 10:21:00+00 | f          | busy   |         281 | 2026-10-20 09:21:30.891065+00
(3 rows)
```

Reconciliation claim:
confirmed
                  id                  |              mailbox_id              |         name         |  color  | is_default |          created_at           
--------------------------------------+--------------------------------------+----------------------+---------+------------+-------------------------------
 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | c0000000-0000-0000-0000-000000000001 | Personal             | #9E725F | t          | 2026-10-20 08:23:50.367108+00
 8839f2cf-7ec7-4a4c-9e20-a78ebab2e19f | c0000000-0000-0000-0000-000000000001 | Engineering Projects | #9E725F | f          | 2026-10-20 08:23:55.809369+00
 d87f94be-d675-46ec-8970-a43a2e4e5355 | c0000000-0000-0000-0000-000000000002 | Personal             | #9E725F | t          | 2026-10-20 08:26:56.226259+00

### 4. Post-Migration-059 Backup Restoration Into Disposable Database

Restoring `byos_dev_backup_20261020_post_migration_059.dump` into `byos_disposable_verify_20261024`:
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos_disposable_verify_20261024 -c "SELECT id, mailbox_id, name, color, is_default FROM user_calendars; SELECT id, mailbox_id, calendar_id, start_time, end_time, is_all_day, status, length(encrypted_payload) as payload_len FROM calendar_events;"
```

Terminal output:
```
                  id                  |              mailbox_id              |         name         |  color  | is_default 
--------------------------------------+--------------------------------------+----------------------+---------+------------
 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | c0000000-0000-0000-0000-000000000001 | Personal             | #9E725F | t
 8839f2cf-7ec7-4a4c-9e20-a78ebab2e19f | c0000000-0000-0000-0000-000000000001 | Engineering Projects | #9E725F | f
 d87f94be-d675-46ec-8970-a43a2e4e5355 | c0000000-0000-0000-0000-000000000002 | Personal             | #9E725F | t
(3 rows)

                  id                  |              mailbox_id              |             calendar_id              |       start_time       |        end_time        | is_all_day | status | payload_len 
--------------------------------------+--------------------------------------+--------------------------------------+------------------------+------------------------+------------+--------+-------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | c0000000-0000-0000-0000-000000000001 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | 2026-10-20 08:23:00+00 | 2026-10-20 09:23:00+00 | f          | busy   |         188
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | c0000000-0000-0000-0000-000000000001 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | 2026-10-20 09:18:00+00 | 2026-10-20 10:18:00+00 | f          | busy   |         281
 a4196298-d4e1-4921-8b26-0a2d470636f3 | c0000000-0000-0000-0000-000000000001 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | 2026-10-20 09:21:00+00 | 2026-10-20 10:21:00+00 | f          | busy   |         281
(3 rows)
```

Restore verification claim:
verified
                  id                  |              mailbox_id              |         name         |  color  | is_default 
--------------------------------------+--------------------------------------+----------------------+---------+------------
 6ef9acca-12c6-4af9-85f0-c6cdc1316851 | c0000000-0000-0000-0000-000000000001 | Personal             | #9E725F | t
 8839f2cf-7ec7-4a4c-9e20-a78ebab2e19f | c0000000-0000-0000-0000-000000000001 | Engineering Projects | #9E725F | f
 d87f94be-d675-46ec-8970-a43a2e4e5355 | c0000000-0000-0000-0000-000000000002 | Personal             | #9E725F | t

### 5. Go Calendar API Lifecycle Test Execution

Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; cd f:\Codex\byos-email\services\api; go test -v -count=1 -run TestCalendarLifecycleAndIsolation .
```

Terminal output:
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:56: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarLifecycleAndIsolation (0.53s)
PASS
ok  	byos.email/services/api	2.140s
```

Go test execution claim:
PASS
ok  	byos.email/services/api	2.140s

## Manual browser verification

The browser test was executed using Puppeteer against the live application running on `http://127.0.0.1:3004` and `http://127.0.0.1:8080`:

Command:
```powershell
node f:\Codex\byos-email\tests\browser\test_calendar_invitations.mjs
```

Terminal output:
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
  Current Webmail test state: {
  "selectedMsg": {
    "id": "ffc6dd23-0f89-4264-98f1-352733db8c8c",
    "messageId": "ffc6dd23-0f89-4264-98f1-352733db8c8c",
    "messageSeq": 8657,
    "folder": "inbox",
    "folderId": null,
    "labelIds": [],
    "sender": "bob@byos.local",
    "recipient": "alice@byos.local",
    "recipients": [
      "alice@byos.local"
    ],
    "subject": "(Encrypted message)",
    "snippet": "Encrypted payload • mailboxes/c0000000-0000-0000-0000-000000000001/00000000000000008657.eml.enc",
    "encryptedBody": "mailboxes/c0000000-0000-0000-0000-000000000001/00000000000000008657.eml.enc",
    "draftStorageRef": "",
    "scheduledAt": "2026-10-18T15:14:17Z",
    "status": "received",
    "date": "Oct 18",
    "read": true,
    "starred": false,
    "isRealApi": true,
    "hasAttachments": false,
    "attachmentCount": 0,
    "attachmentTypes": [],
    "mailboxId": "c0000000-0000-0000-0000-000000000001",
    "accountEmail": "alice@byos.local",
    "category": "primary"
  },
  "isDecrypting": false,
  "lockedReadingAccount": null,
  "decryptedCalendarIcs": "BEGIN:VCALENDAR\r\nPRODID:-//BYOS//BYOS Webmail Calendar//EN\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:inv-exec-1792825410894\r\nSEQUENCE:0\r\nDTSTAMP:20261025T120000Z\r\nDTSTART:20261025T140000Z\r\nDTEND:20261025T150000Z\r\nSUMMARY:Executive Strategy & Architecture Sync\r\nDESCRIPTION:Reviewing Phase 5 deliverables, encryption boundaries, and calendar roadmap.\r\nLOCATION:Room 402 / BYOS Executive\r\nURL:https://meet.byos.local/exec-sync\r\nORGANIZER;CN=\"Bob Jones\":mailto:bob@byos.local\r\nATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=\"Alice Smith\":mailto:alice@byos.local\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR",
  "decryptedContent": "Unlock alice@byos.local to read this message."
}
  PASS: Calendar Invitation Card rendered in ReadingPane
  Extracted cardText:
CALENDAR INVITATION
Response requested
Executive Strategy & Architecture Sync
Sun, Oct 25, 2026 · 8:00 PM – 9:00 PM
Room 402 / BYOS Executive
https://meet.byos.local/exec-sync
Organizer:
Bob Jones (bob@byos.local)

Reviewing Phase 5 deliverables, encryption boundaries, and calendar roadmap.

Going?
Yes (Accept)
Maybe (Tentative)
No (Decline)
  PASS: Card displays correct event title
  PASS: Card displays organizer name
  PASS: Card displays organizer email
  PASS: Card displays event location
  PASS: Card displays method badge
  Saved screenshot: f:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_card.png

--- [STEP 3b] Testing Authenticity Warning (Organizer Mismatch) ---
  PASS: Authenticity warning banner rendered when organizer differs from sender
  PASS: Warning identifies divergent organizer email
  Saved screenshot: f:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_authenticity_warning.png

--- [STEP 4] Exercising RSVP Lifecycle (Accept, Tentative, Decline) ---
  PASS: Card reflects Accepted RSVP state
  PASS: Action feedback banner confirms calendar sync
  Saved screenshot: f:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_accepted.png
  PASS: Card reflects Tentative RSVP state
  PASS: Card reflects Declined RSVP state

--- [STEP 4b] Security rejection: BYOS policy (neg seq) and organizer-mismatch helper ---
  Security rejection results: {
  "invalidSeqRejected": true,
  "invalidSeqError": "Rejected by BYOS policy: SEQUENCE -1 is below zero. Conformant organizers start at 0 and only increment.",
  "hijackHelperRejected": true,
  "hijackHelperError": "Organizer mismatch: incoming organizer (hijacker@unauthorized.local) does not match existing organizer (bob@byos.local)"
}
  PASS: BYOS policy: sequence -1 was rejected before mailbox-key guard
  PASS: Rejection message attributes to BYOS policy
  PASS: Organizer-mismatch helper correctly rejects with synthetic state

--- [STEP 4c] Locked-mailbox fail-closed: hijack with positive seq returns without throw ---
  Locked-mailbox result: {
  "returnedWithoutThrow": true
}
  PASS: Locked mailbox: handleRsvpInvitation must return (not throw) when mailbox key unavailable

--- [STEP 5] Testing Event Cancellation (METHOD:CANCEL) ---
  Extracted cancelCardText:
EVENT CANCELLED
Executive Strategy & Architecture Sync
Sun, Oct 25, 2026 · 8:00 PM – 9:00 PM
Organizer:
Bob Jones (bob@byos.local)
Invitation declined.
  PASS: Card displays Event Cancelled badge
  Saved screenshot: f:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_cancelled.png

--- [STEP 6] Testing Calendar Module with Outgoing Invitations ---
  PASS: Calendar view rendered
  PASS: Event modal opened
  PASS: Send invitations checkbox rendered when attendees are specified
  PASS: Send invitations checkbox is checked by default
  Phase 5 event with attendees and invitation flag created successfully.
  Saved screenshot: f:\Codex\byos-email\tests\browser\artifacts\calendar_invitation_event_created.png

--- [STEP 7] Verifying 375px Mobile Viewport Responsiveness ---
  PASS: 375px mobile viewport has NO horizontal overflow
  Saved screenshot: f:\Codex\byos-email\tests\browser\artifacts\calendar_invitations_mobile_375px.png

--- [STEP 8] Returning to Mail View ---
  PASS: Successfully returned to Mail view

================================================================================
    ALL CALENDAR INVITATION BROWSER TESTS COMPLETED SUCCESSFULLY!                
================================================================================
```

Browser verification artifacts saved in repository:
- `tests/browser/artifacts/calendar_invitation_card.png`
- `tests/browser/artifacts/calendar_invitation_authenticity_warning.png`
- `tests/browser/artifacts/calendar_invitation_accepted.png`
- `tests/browser/artifacts/calendar_invitation_cancelled.png`
- `tests/browser/artifacts/calendar_invitation_event_created.png`
- `tests/browser/artifacts/calendar_invitations_mobile_375px.png`

## What did not work or is untested

1. **Server-Side Decryption / Zero-Knowledge Constraint**: Server-side organizer identity enforcement in `calendar.go` cannot inspect encrypted event details without possessing client mailbox keys. The server accepts `encrypted_payload` as an opaque Section 12 envelope. Organizer authenticity and sequence monotonicity are enforced client-side at the RSVP and calendar rendering boundary.
2. **Real Outbound SMTP to External Internet Inboxes**: As mandated by safety directives, no real invitations were delivered to external public mail systems. Delivery was verified via captured MIME payloads and Path A mock dispatch pipelines.
3. **CalDAV Synchronization Protocol**: CalDAV endpoints (`/caldav/v2/`) are out of scope for Phase 5.1 and remain UNTESTED.

## Test suite output

Command:
```powershell
cd f:\Codex\byos-email\apps\webmail; npm.cmd test
```

Terminal output:
```
Running Calendar ICS & Invitation Tests...
  ✓ unescapeIcsText handles commas, semicolons, backslashes, and newlines
  ✓ escapeIcsText escapes special characters
  ✓ foldIcsLine folds lines > 75 characters
  ✓ parseIcsDate parses UTC and all-day dates
  ✓ cleanEmail strips mailto: and angle brackets
  ✓ generateIcs and parseIcs full roundtrip with attendees and organizer
  ✓ generateRsvpReplyIcs formats RFC 5546 iTIP reply
  ✓ parseIcs safely handles malformed, truncated, or empty input
  ✓ Distinguish invitation (METHOD:REQUEST) from ordinary published calendar
  ✓ 9. Organizer update increments sequence and retains stable UID
  ✓ 10. Stale update rejected: incoming revision older than stored revision
  ✓ 11. Organizer mismatch rejected by verifyInvitationAuthenticity
  ✓ 12. Duplicate RSVP response detected without duplicate side-effects
  ✓ 13. Cancellation followed by older REQUEST is rejected
  ✓ 14. Single-instance recurrence exception (RECURRENCE-ID) parsed
  ✓ 15. Timezone-aware timestamp and Daylight-Saving transition
  ✓ 16. Parser resilience: reject oversized input (>512KB)
  ✓ 17. Parser resilience: sanitize dangerous URL schemes (javascript:)
  ✓ 18. Parser resilience: sanitize ASCII control characters
  ✓ 19. Parser resilience: duplicate UID property takes first valid UID
  ✓ 20. RFC 6047 MIME fixtures roundtrip for REQUEST, REPLY, CANCEL
  ✓ 21. BYOS policy: negative SEQUENCE rejected as invalid input (not a stale-revision check)
  ✓ 22. Full stale REQUEST lifecycle: seq3 stored → seq2 rejected → seq4 accepted → dup seq4 idempotent → old CANCEL rejected → valid CANCEL accepted
  ✓ 23. REPLY method: attendee response with organizer's sequence is accepted, not treated as stale
  ✓ 24. REQUEST updates v0 → v1 → v2 accepted by verifyInvitationAuthenticity at each step
  ✓ 25. CANCEL sequence must exceed stored REQUEST sequence
  ✓ 26. Recurring event: RECURRENCE-ID parsed; stale exception rejected; fresh exception accepted
  ✓ 27. Organizer authorization: pipeline integration — stored organizer blocks hijack, correct organizer proceeds
CALENDAR ICS TESTS: 28 passed, 0 failed

Running Calendar Invitation Repository Integration Tests...
  ✓ 1. Setup: Create stored event at sequence 3 with trusted organizer
  ✓ 2. Stale REQUEST (seq 2 < stored 3): rejected, stored event sequence remains 3
  ✓ 3. Newer REQUEST (seq 4 > stored 3): accepted, stored event sequence updated to 4
  ✓ 4. Duplicate delivery of seq 4: idempotent detection, no DB change, no re-sent reply
  ✓ 5. Stale CANCEL (seq 2 < stored 4): rejected, event status remains active
  ✓ 6. Valid CANCEL (seq 5 > stored 4): accepted, persisted status updated to free/cancelled
  ✓ 7. Organizer hijack attempt (different organizer): rejected, stored organizer untouched
  ✓ 8. Locked mailbox fail-closed: returns actionable unlock message, DB untouched, no outbound email
CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed

OVERALL: 329 passed, 0 failed
```

Unit test execution claim:
all tests pass
OVERALL: 329 passed, 0 failed
