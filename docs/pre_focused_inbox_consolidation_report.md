# Pre-Focused-Inbox Consolidation Pass Report

## What was built
Strengthened the test verification harness and end-to-end wire integrity verification across all shared surfaces (crypto unwrap, multi-account session management, wire DKIM authentication, and UI state isolation). Implemented `tests/browser/test_wire_integrity.mjs` executing four end-to-end scenarios (Path A 100 KB encrypted attachment, reply from custom masked alias with DKIM wire assertions, non-alias outbound with standard domain headers, and account switch crypto isolation over 10 rapid open/close cycles). Fixed a reactive alias rendering defect in `ComposeDrawer.tsx` and `App.tsx`, resolved a missing session key persistence issue in `AddMailboxModal.tsx`, harmonized canonical seed derivations across browser suites, updated `smoke.ps1`, `scripts/smoke.ps1`, `Makefile`, and `make.bat`, and documented manual gaps for mobile viewports and accessibility in `docs/smoke_gaps.md`.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/ComposeDrawer.tsx` | Added fallback `<Show>` option for `props.fromAlias` so sender dropdown reliably renders alias value upon reply even before asynchronous alias list fetches finish. |
| `apps/webmail/src/App.tsx` | Invoked `refreshMaskedAliases()` in `startReply()` to ensure active alias registrations are always up to date prior to opening the composer. |
| `apps/webmail/src/components/AddMailboxModal.tsx` | Persisted `byos_xwing_seed_` and `byos_signing_seed_` into `sessionStorage` alongside `byos_mailbox_sk_` when a secondary mailbox is connected via `AddMailboxModal`. |
| `tests/browser/test_wire_integrity.mjs` | Implemented end-to-end Scenarios A-D with strict allowlist error tracking and screenshot generation. |
| `tests/browser/test_compose_default_account.mjs` | Replaced arbitrary dummy keys with canonical derived seed keys to prevent polluting the database `mailboxes.mailbox_xwing_pk`. |
| `tests/browser/test_unified_inbox_browser.mjs` | Replaced arbitrary dummy keys with canonical derived seed keys for Alice and Bob to maintain cryptographic consistency. |
| `scripts/smoke.ps1` | Created PowerShell smoke test runner executing all 8 browser test suites in sequence with health checks and `-SkipClean` support. |
| `smoke.ps1` | Updated root smoke test script to include all 8 browser tests in sequence. |
| `Makefile` | Pointed `smoke` target to `./scripts/smoke.ps1`. |
| `make.bat` | Pointed `smoke` target to `%~dp0scripts\smoke.ps1`. |
| `docs/smoke_gaps.md` | Added Section 7 (Mobile Responsive Viewports & Touch Navigation) and Section 8 (Accessibility / a11y & Screen Readers). |
| `docs/pre_focused_inbox_consolidation_report.md` | Full consolidation audit and evidence report for the pre-focused-inbox consolidation pass. |

## Raw evidence

### 1. Rust Outbound Worker DKIM Format Test
Command: `cargo test --bin byos-outbound-worker test_dkim_identity_is_single_at_domain`
```
running 1 test
test tests::test_dkim_identity_is_single_at_domain ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
```

### 2. Go API DKIM Format Test
Command: `go test -v -run TestOutboundMessageDKIMHeaderFormat ./...`
```
=== RUN   TestOutboundMessageDKIMHeaderFormat
=== RUN   TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender
=== RUN   TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender
=== NAME  TestOutboundMessageDKIMHeaderFormat
    outbound_dkim_test.go:120: Verified 1 delivered messages in Mailpit for correct header.i format
--- PASS: TestOutboundMessageDKIMHeaderFormat (0.03s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender (0.00s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender (0.00s)
PASS
ok  	byos.email/services/api	(cached)
```

### 3. Wire Integrity Integration Test Standalone Execution
Command: `node --experimental-wasm-modules tests/browser/test_wire_integrity.mjs`
```
================================================================================
             WIRE INTEGRITY CONSOLIDATION SMOKE TEST (SCENARIOS A-D)            
================================================================================

Generated 100 KB test attachment at: F:\Codex\byos-email\tests\browser\artifacts\wire_test_attachment_100k.dat
Expected SHA-256: aa1eddebaf4600312d36d1931e2d46744d4d169ef6f0e203ee6fb8ef027a068e

--- [SETUP] Real Login Flow: Alice & Connect Bob ---
  Authenticating Alice (alice@byos.local)...
  Active account chip: "alice@byos.local"
  PASS: Alice logged in successfully via real credentials
  Connecting secondary account Bob (bob@byos.local)...
  Connected accounts in session: [{"email":"bob@byos.local","id":"c0000000-0000-0000-0000-000000000002"},{"email":"alice@byos.local","id":"c0000000-0000-0000-0000-000000000001"}]
  PASS: Alice present in connected accounts
  PASS: Bob present in connected accounts
  PASS: Bob's X-Wing secret seed is unsealed in session
  Switching back to Alice for Scenario A...
  PASS: Alice is active account for Scenario A

================================================================================
  SCENARIO A: PATH A WITH 100 KB ATTACHMENT                                      
================================================================================
  Uploading 100 KB attachment in ComposeDrawer...
  Attachment pill rendered in ComposeDrawer.
  Clicked Send button in ComposeDrawer
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\wire_a_attachment_sent.png
  Path A send response HTTP status: 201
  PASS: Path A send returned HTTP 201 (got 201)
  Path A send response JSON: {"delivery_id":"...","message_id":"...","status":"delivered","message_seq":3860}
  PASS: Path A response contains message_id

  [DB Check] Querying recipient's message_metadata in Postgres...
  recipient message_metadata (has_attachments | envelope_count): "t|1"
  PASS: recipient message_metadata has_attachments=true and envelope_count=1 (got "t|1")
  Envelope attachment_id: 86b7fafe-835b-43d9-a541-d6a575b6cf71, chunk_count: 1, size_bytes: 102400
  PASS: Envelope size_bytes equals 102400
  PASS: Fetched encrypted chunk from API: HTTP 200
  Fetched encrypted chunk 0 bytes: 102429 bytes
  PASS: Path A decryption succeeded without corruption: OK
  PASS: Decrypted data is present
  Decrypted bytes size: 102400
  Decrypted SHA-256: aa1eddebaf4600312d36d1931e2d46744d4d169ef6f0e203ee6fb8ef027a068e
  Expected  SHA-256: aa1eddebaf4600312d36d1931e2d46744d4d169ef6f0e203ee6fb8ef027a068e
  PASS: Decrypted attachment SHA-256 matches original 100 KB payload
  Scenario A: Path A attachment wire integrity verified successfully!

================================================================================
  SCENARIO B: REPLY FROM CUSTOM ALIAS                                           
================================================================================
  Target custom alias: "wiresmoke0x5pnq@masked.byos.local"
  Navigating to Settings > Masked Email...
  PASS: Custom alias wiresmoke0x5pnq@masked.byos.local appears in settings table
  Initial reply_count in DB: 0
  PASS: Initial reply_count is 0
  Delivering inbound SMTP to alias wiresmoke0x5pnq@masked.byos.local...
  PASS: Inbound SMTP delivered to alias successfully (250 OK)
  PASS: Inbound message received via alias opened in Alice's inbox
  Reading Pane alias badge text: "Received via Wire Smoke Order Alias"
  PASS: Reading Pane displays 'Received via' alias badge
  Reply From dropdown: text="wiresmoke0x5pnq@masked.byos.local (alias)" value="alias:wiresmoke0x5pnq@masked.byos.local"
  PASS: Reply From value is alias:wiresmoke0x5pnq@masked.byos.local
  PASS: Reply From text contains wiresmoke0x5pnq@masked.byos.local
  PASS: Reply From does NOT leak Alice's real address
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\wire_b_alias_reply_compose.png
  PASS: Masked alias reply send returned HTTP 201 (got 201)

  [Mailpit Check] Polling delivered message for recipient: merchant@external-store.com...
  PASS: Delivered message found in Mailpit for merchant@external-store.com
  PASS: Fetched full message from Mailpit
  PASS: Fetched message headers from Mailpit
  --- Outbound Message Headers [Scenario B Custom Alias Reply] ---
  Authentication-Results: "byos.local; dkim=pass (2048-bit key) header.d=masked.byos.local header.i=@masked.byos.local header.s=byos"
  From: "wiresmoke0x5pnq@masked.byos.local"
  Reply-To: "wiresmoke0x5pnq@masked.byos.local"
  Return-Path: "wiresmoke0x5pnq@masked.byos.local"
  PASS: Scenario B Custom Alias Reply: Authentication-Results contains dkim=pass
  PASS: Scenario B Custom Alias Reply: header.d matches sending domain (masked.byos.local)
  PASS: Scenario B Custom Alias Reply: header.i found in Authentication-Results
  Extracted header.i: "@masked.byos.local"
  PASS: Scenario B Custom Alias Reply: header.i contains exactly one @ (got "@masked.byos.local")
  PASS: Scenario B Custom Alias Reply: header.i matches @masked.byos.local
  PASS: Scenario B Custom Alias Reply: From header matches expected sender (wiresmoke0x5pnq@masked.byos.local)
  PASS: Scenario B Custom Alias Reply: Reply-To header matches expected value (wiresmoke0x5pnq@masked.byos.local)
  PASS: Scenario B Custom Alias Reply: Return-Path matches envelope sender (wiresmoke0x5pnq@masked.byos.local)
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\wire_b_mailpit_delivered.png
  Updated reply_count in DB: 1
  PASS: reply_count on alias in Postgres incremented by exactly 1 (0 -> 1)
  Scenario B: Reply from custom alias wire integrity verified successfully!

================================================================================
  SCENARIO C: NON-ALIAS OUTBOUND TO external@test.local                          
================================================================================
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\wire_c_non_alias_sent.png
  PASS: Non-alias outbound send returned HTTP 201 (got 201)

  [Mailpit Check] Polling delivered message for recipient: external@test.local...
  PASS: Delivered message found in Mailpit for external@test.local
  PASS: Fetched full message from Mailpit
  PASS: Fetched message headers from Mailpit
  --- Outbound Message Headers [Scenario C Non-Alias Outbound] ---
  Authentication-Results: "byos.local; dkim=pass (2048-bit key) header.d=byos.local header.i=@byos.local header.s=byos"
  From: "alice@byos.local"
  Reply-To: "alice@byos.local"
  Return-Path: "alice@byos.local"
  PASS: Scenario C Non-Alias Outbound: Authentication-Results contains dkim=pass
  PASS: Scenario C Non-Alias Outbound: header.d matches sending domain (byos.local)
  PASS: Scenario C Non-Alias Outbound: header.i found in Authentication-Results
  Extracted header.i: "@byos.local"
  PASS: Scenario C Non-Alias Outbound: header.i contains exactly one @ (got "@byos.local")
  PASS: Scenario C Non-Alias Outbound: header.i matches @byos.local
  PASS: Scenario C Non-Alias Outbound: From header matches expected sender (alice@byos.local)
  PASS: Scenario C Non-Alias Outbound: Reply-To header matches expected value (alice@byos.local)
  PASS: Scenario C Non-Alias Outbound: Return-Path matches envelope sender (alice@byos.local)
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\wire_c_mailpit_delivered.png
  Scenario C: Non-alias outbound wire integrity verified successfully!

================================================================================
  SCENARIO D: ACCOUNT SWITCH CRYPTO ISOLATION & 10 RAPID CYCLES                 
================================================================================
  Testing switch Alice -> Bob -> Alice...
  PASS: Active account switched to bob@byos.local
  Bob active -> Compose From: "bob@byos.local" (value: "account:c0000000-0000-0000-0000-000000000002")
  PASS: Compose From is Bob when Bob is active
  PASS: Active account switched to alice@byos.local
  Alice active -> Compose From: "alice@byos.local" (value: "account:c0000000-0000-0000-0000-000000000001")
  PASS: Compose From is Alice when Alice is active

  Running 10 rapid open/close compose cycles with Bob active...
  PASS: Active account switched to bob@byos.local
  Cycle  1: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 1: From must be Bob
  PASS: Cycle 1: From must NOT be Alice
  Cycle  2: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 2: From must be Bob
  PASS: Cycle 2: From must NOT be Alice
  Cycle  3: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 3: From must be Bob
  PASS: Cycle 3: From must NOT be Alice
  Cycle  4: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 4: From must be Bob
  PASS: Cycle 4: From must NOT be Alice
  Cycle  5: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 5: From must be Bob
  PASS: Cycle 5: From must NOT be Alice
  Cycle  6: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 6: From must be Bob
  PASS: Cycle 6: From must NOT be Alice
  Cycle  7: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 7: From must be Bob
  PASS: Cycle 7: From must NOT be Alice
  Cycle  8: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 8: From must be Bob
  PASS: Cycle 8: From must NOT be Alice
  Cycle  9: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 9: From must be Bob
  PASS: Cycle 9: From must NOT be Alice
  Cycle 10: From = "bob@byos.local" | Drifted: NO
  PASS: Cycle 10: From must be Bob
  PASS: Cycle 10: From must NOT be Alice
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\wire_d_account_switch.png
  Rapid cycles summary: 10/10 iterations remained stable as bob@byos.local (Drifted: 0)
  PASS: From: never drifted to Alice across 10 rapid open/close cycles
  Scenario D: Account switch crypto isolation verified successfully!

--- [Console & HTTP Error Allowlist Enforcement] ---
  Total unallowed errors captured: 0
  PASS: No unallowed console or HTTP errors occurred during execution

================================================================================
             ALL WIRE INTEGRITY CHECKS (SCENARIOS A-D) PASSED CLEANLY           
================================================================================
```

### 4. Smoke Run 1 (Clean Database Reset)
Command: `.\make.bat smoke`
```
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (21.2s)
  [PASS] test_sidebar_restructure.mjs        PASS (12.7s)
  [PASS] test_unified_inbox_browser.mjs      PASS (29.8s)
  [PASS] test_account_switch_crypto.mjs      PASS (69s)
  [PASS] test_masked_email.mjs               PASS (46.7s)
  [PASS] test_alias_custom.mjs               PASS (43.9s)
  [PASS] test_compose_default_account.mjs    PASS (17.8s)
  [PASS] test_wire_integrity.mjs             PASS (85.4s)
================================================================================

SMOKE SUITE PASSED: All 8 tests passed cleanly.
```

### 5. Smoke Run 2 (Uncleaned Consecutive Run - State Leakage Verification)
Command: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke.ps1 -SkipClean`
```
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (20.6s)
  [PASS] test_sidebar_restructure.mjs        PASS (18s)
  [PASS] test_unified_inbox_browser.mjs      PASS (31.4s)
  [PASS] test_account_switch_crypto.mjs      PASS (71.4s)
  [PASS] test_masked_email.mjs               PASS (45.4s)
  [PASS] test_alias_custom.mjs               PASS (43.9s)
  [PASS] test_compose_default_account.mjs    PASS (20.6s)
  [PASS] test_wire_integrity.mjs             PASS (83.6s)
================================================================================

SMOKE SUITE PASSED: All 8 tests passed cleanly.
```

## Manual browser verification
Exercised across all 4 scenarios in `tests/browser/test_wire_integrity.mjs` against the live local development stack:
1. **Scenario A (Path A with 100 KB attachment):**
   - Logged in as `alice@byos.local` via real password form.
   - Connected `bob@byos.local` as secondary account via AddMailboxModal.
   - Composed 100 KB payload attachment to `bob@byos.local`.
   - Sent via `/v1/outbound/send-internal`, returned HTTP 201.
   - Asserted PostgreSQL row: `has_attachments=true`, `jsonb_array_length(attachment_envelopes)=1`.
   - Fetched chunk 0 via API, decrypted client-side via `decryptPathAAttachment()`, validated SHA-256 match.
   - Screenshot saved to: `tests/browser/artifacts/wire_a_attachment_sent.png`
2. **Scenario B (Reply from custom alias):**
   - Created custom alias `wiresmoke...` in Settings → Masked Email.
   - Delivered inbound SMTP to local port 25 (`250 OK: queued`).
   - Opened received message in Inbox, verified "Received via" badge.
   - Clicked Reply, verified sender dropdown prefilled with alias address (value `alias:...`).
   - Screenshot saved to: `tests/browser/artifacts/wire_b_alias_reply_compose.png`
   - Sent reply (HTTP 201). Polled Mailpit: verified `From`, `Reply-To`, `Return-Path`, `dkim=pass`, `header.d=masked.byos.local`, and `header.i` with exactly one `@`. Verified PostgreSQL `reply_count` incremented by 1.
   - Screenshot saved to: `tests/browser/artifacts/wire_b_mailpit_delivered.png`
3. **Scenario C (Non-alias outbound):**
   - Composed to `external@test.local`, sent via `/v1/outbound/send` (HTTP 201).
   - Screenshot saved to: `tests/browser/artifacts/wire_c_non_alias_sent.png`
   - Polled Mailpit: verified `From: alice@byos.local`, `dkim=pass`, `header.d=byos.local`, `header.i=@byos.local`.
4. **Scenario D (Account switch crypto isolation):**
   - Cycled Alice -> Bob -> Alice, asserting sender dropdown value.
   - Executed 10 rapid open/close cycles with Bob active: 10/10 iterations remained `bob@byos.local` with zero drift to Alice.
   - Screenshot saved to: `tests/browser/artifacts/wire_d_account_switch.png`

## What did not work or is untested
Documented in `docs/smoke_gaps.md`:
1. Real External SMTP Relay & Public Reputation Validation (DKIM / SPF / DMARC): Requires public IP with reverse DNS and external third-party mail providers.
2. Hardware WebAuthn / Passkeys / FIDO2: Requires physical biometric/YubiKey interaction.
3. Strict STARTTLS & TLS Cipher Negotiation: Requires public CA-signed certificates on external ports.
4. Third-Party S3 Storage Providers (AWS / Cloudflare R2): Requires external cloud billing and network fault injection.
5. Cross-Engine Browser Cryptography (Safari WebKit & Firefox Gecko): Requires physical macOS/iOS/Linux devices.
6. Concurrent Multi-Device Session Epoch Invalidation: Requires millisecond-accurate cross-device race condition injection.
7. Mobile Responsive Viewports (375px) & Touch Navigation: Requires manual physical touchscreen testing and virtual keyboard testing.
8. Accessibility (a11y) & Screen Readers: Requires NVDA/VoiceOver screen reader audio testing and keyboard focus traversal.

## Test suite output

### Go API Test Suite Output
```
ok  	byos.email/services/api	64.184s
```

### Webmail TypeScript and Test Suite Output
```
Running Signature Tests...
  ✓ 1. loadSignature returns stored plaintext
  ✓ 2. loadSignatureHtml returns stored HTML
  ✓ 3. loadSignatureHtml falls back to plaintext conversion when HTML is absent
  ✓ 4. saveSignature with empty string removes the key
  ✓ 5. saveSignatureHtml with empty string removes the key
  ✓ 6. clearSignature removes both keys
  ✓ 7. applySignature appends signature to plaintext
  ✓ 8. applySignatureHtml appends byos-signature div to HTML
  ✓ 9. Server hydration writes both keys to localStorage
  ✓ 10. Server hydration with empty signature_html removes the key
  ✓ 11. Server hydration with only signature_plain leaves signature_html absent
SIGNATURE TESTS: 11 passed, 0 failed

Running Reply Signature Tests...
Running Reply Signature Tests...
  ✓ 1. TestReplyPrePopulatesSignature
  ✓ 2. TestForwardPrePopulatesSignature
  ✓ 3. TestNewComposePrePopulatesSignature
  ✓ 4. TestSendDoesNotDoubleAppend
  ✓ 5. TestNewComposeDefaultsToActiveMailbox
  ✓ 6. TestClearComposeFormResetsComposeAccountId
REPLY SIGNATURE TESTS: 6 passed, 0 failed

Running Mbox Stream Tests...
Running Mbox Stream Tests...
  ✓ 1. Parse a 3-message mbox -> yields 3 messages in order
  ✓ 2. Message boundary detection works with CRLF
  ✓ 3. Message boundary detection works with LF only
  ✓ 4. mboxrd unescaping works (>From -> From)
  ✓ 5. A very large message (simulate 2MB) yields correctly
  ✓ 6. AbortSignal stops iteration cleanly
MBOX STREAM TESTS: 6 passed, 0 failed

Running Mbox Labels Tests...
Running Mbox Labels Tests...
  ✓ 1. X-Gmail-Labels with "Sent" -> "sent"
  ✓ 2. X-Gmail-Labels with "Spam" -> "spam"
  ✓ 3. X-Gmail-Labels with "Inbox,Important" -> "inbox"
  ✓ 4. X-Gmail-Labels with "Archive" only -> "archive"
  ✓ 5. No X-Gmail-Labels + From matches user email -> "sent"
  ✓ 6. No X-Gmail-Labels + From != user email -> null
  ✓ 7. Priority: message with both "Inbox" and "Spam" -> "spam" (spam wins)
  ✓ 8. Priority: message with both "Trash" and "Sent" -> "trash"
MBOX LABELS TESTS: 8 passed, 0 failed

Running Import Queue Tests...
Running Import Queue Tests...
  ✓ 1. Concurrency limit is respected
Import worker error on item 1: Error: Simulated upload error
    at <anonymous> (F:\Codex\byos-email\apps\webmail\src\import_queue.test.ts:60:17)
    at runWorker (F:\Codex\byos-email\apps\webmail\src\import_queue.ts:51:15)
    at async Promise.all (index 1)
    at async runWithConcurrency (F:\Codex\byos-email\apps\webmail\src\import_queue.ts:68:3)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\import_queue.test.ts:55:5)
    at async test (F:\Codex\byos-email\apps\webmail\src\import_queue.test.ts:15:7)
    at async runImportQueueTests (F:\Codex\byos-email\apps\webmail\src\import_queue.test.ts:51:3)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:108:26)
  ✓ 2. Continues when item worker throws
  ✓ 3. onProgress tracks completed and total accurately
IMPORT QUEUE TESTS: 3 passed, 0 failed

Running Conversation Threading Tests...
Running Conversation Threading Tests...
  ✓ 1. TestThreadRowRendersParticipantLabel
  ✓ 2. TestThreadRowShowsUnreadBold
  ✓ 3. TestFetchThreadsFunctionCallsCorrectURL
  ✓ 4. TestToggleMessageStarCallsCorrectURL
  ✓ 5. TestThreadSnoozeFiltering
  ✓ 6. TestThreadMultiSelectHelpers
CONVERSATION THREADING TESTS: 6 passed, 0 failed

Running Undo Send Tests...
Running Undo Send Tests...
  ✓ 1. TestPrepareSendPayloadEmptyRecipient
  ✓ 2. TestPrepareSendPayloadAppliesSignature
  ✓ 3. TestRestoreComposeFromPayload
  ✓ 4. TestUndoRemovesPendingSend
UNDO SEND TESTS: 4 passed, 0 failed

Running Keyboard Shortcuts Tests...
Running Keyboard Shortcuts Tests...
  ✓ 1. isTextInputElement returns true for input, textarea, contenteditable
  ✓ 2. isTextInputElement returns false for div, button, body
  ✓ 3. matchShortcut matches plain keys correctly
  ✓ 4. matchShortcut respects shift, ctrl, meta modifiers
  ✓ 5. matchShortcut rejects when shift state mismatches
KEYBOARD SHORTCUTS TESTS: 5 passed, 0 failed

Running Snooze Tests...
Running Snooze Tests...
  ✓ 1. TestSnoozePresetsComputeCorrectTimes
  ✓ 2. TestFormatSnoozeTime
SNOOZE TESTS: 2 passed, 0 failed

Running Scheduled Folder Tests...
Running Scheduled Folder Tests...
  ✓ 1. Folder type union includes 'scheduled'
  ✓ 2. Sidebar folder list order places 'scheduled' between 'sent' and 'drafts'
  ✓ 3. MessageRow formatSmartDate formats scheduled dates correctly
  ✓ 4. DisplayMessage folder supports 'scheduled'
  ✓ 5. Scheduled message error placeholders conform to specification
  ✓ 6. Folder threading support accurately distinguishes flat-by-design folders
  ✓ 7. Edit then discard leaves scheduled item untouched
  ✓ 8. Edit then save with body change updates same row in place
  ✓ 9. Edit then save with time change updates send_at on same row
  ✓ 10. Edit then save with no changes preserves all attributes without orphan drafts
  ✓ 11. Failed schedule surfaces specific backend error step, not generic wrapper
  ✓ 12. Schedule send with locked mailbox key surfaces actionable unlock message
  ✓ 13. Real-time event message.deleted removes scheduled item from list live
  ✓ 14. Real-time event message.created adds delivered sent copy to Sent folder live
  ✓ 15. Delivery failure event moves message to Drafts with sendFailed marker live
SCHEDULED FOLDER TESTS: 15 passed, 0 failed

Running Display Party Tests...
Running Display Party & Sent Folder Tests...
  ✓ 1. formatAddress extracts clean display name or email
  ✓ 2. Inbox row renders sender, not recipient
  ✓ 3. Archive, spam, trash, and search rows render sender
  ✓ 4. Sent row renders recipient, not sender
  ✓ 5. Sent row with multiple recipients renders first +N
  ✓ 6. Drafts row with no recipient renders 'No recipient'
  ✓ 7. Scheduled folder renders recipient(s) and first +N
  ✓ 8. Threaded Sent row renders the recipient of the latest message
  ✓ 9. Sent folder rows are never treated as unread
DISPLAY PARTY TESTS: 9 passed, 0 failed

Running Nested Labels Tests...
  PASS: test_sidebar_renders_tree
  PASS: test_parent_click_filters_descendants
  PASS: test_expand_state_persists
  PASS: test_reparent_cycle_blocked_ui
NESTED LABELS TESTS: 4 passed, 0 failed

Running API Error Handling Tests...
Running API Error Handling Tests...
  ✓ test_api_error_propagates_not_swallowed: fetchMailboxes throws on 500
  ✓ test_api_error_propagates_not_swallowed: fetchDrafts, fetchFolders, fetchLabels, fetchContacts throw on 500
  ✓ test_successful_return_shape: api client returns data on 200
  ✓ test_global_error_banner_renders: set and clear global error signal
API ERROR HANDLING TESTS: 4 passed, 0 failed

Running Unified Inbox Tests...
Running Unified Inbox Tests...
  ✓ test_unified_inbox_merges_accounts
  ✓ test_account_chip_renders
  ✓ test_reply_uses_message_account
  ✓ test_unified_search_deduplicates
  ✓ test_snooze_uses_correct_account_endpoint
  ✓ test_multi_sse_routing
  ✓ test_account_chip_shows_current_selection
  ✓ test_dropdown_lists_all_accounts
  ✓ test_selecting_account_updates_folders
  ✓ test_selecting_all_inboxes_shows_aggregate
  ✓ test_account_chip_color_matches_selection
  ✓ test_key_resolution_uses_owning_mailbox
  ✓ test_key_locked_prompts_for_correct_account
  ✓ test_unlock_retries_decrypt
  ✓ test_global_key_signal_never_used_in_unified_path
UNIFIED INBOX TESTS: 15 passed, 0 failed

Running Masked Email Tests...
Running Masked Email Tests...
  ✓ 1. TestBuildMimeStringIncludesAliasHeaders
  ✓ 2. TestBuildPendingSendPayloadWithFromAlias
  ✓ 3. TestRestoreComposeStateWithFromAlias
  ✓ 4. TestMaskedAliasAPIFunctions
  ✓ 5. TestMaskedAliasRateLimitErrorHandling
  ✓ 6. TestMessageMetadataReplyViaAlias
  ✓ 7. test_custom_alias_validation_shows_errors
  ✓ 8. test_custom_alias_preview_updates
  ✓ 9. test_custom_alias_409_shows_friendly_error
  ✓ 10. test_random_mode_hides_custom_input
  ✓ 11. TestCreateCustomAliasAPI
MASKED EMAIL TESTS: 11 passed, 0 failed

OVERALL: 229 passed, 0 failed
```
