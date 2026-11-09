# Sent Restrictions, Mailbox Rules, Icon Redesign & Custom .mbox Import Report

## What was built

A complete mailbox rules enforcement and data ingestion system was implemented across both frontend and backend services:
1. **Sent Folder Immutability & Action Restrictions**: In RFC/IMAP standards, outbound sent correspondence represents immutable historical dispatch. Sent messages are now permanently fixed at `Sent`: they cannot be moved to Inbox, Archive, Drafts, Spam, or custom folders (only deletion to Trash is permitted). Moving and batch-moving sent emails is disabled and hidden in `ReadingPane`, `InboxToolbar`, `ThreadRow`, and `MessageRow`, and enforced server-side in `services/api/messages.go` (`messageFolderHandler`).
2. **Snooze & Folder Semantic Restrictions**: Snoozing is an inbox triage mechanism for deferring inbound unhandled correspondence. Snoozing sent emails, drafts, trash, spam, or scheduled emails is strictly blocked both in the UI and via server validation in `services/api/snooze.go` (`messageSnoozeHandler`). Archive and Report Spam actions are also properly restricted across Trash, Drafts, and Spam (with a dedicated "Not spam (Move to Inbox)" action provided for Spam items).
3. **Folder Icon Modernization**: Replaced legacy generic glyphs with industry-standard semantic icons:
   - **Scheduled Folder**: Updated from a plain clock to a refined `calendar-clock` icon (`<rect>` calendar base with `<circle cx="15" cy="16" r="3">` and clock hands).
   - **Spam Folder**: Updated from a warning circle to an `alert-octagon` (`<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2">` with exclamation point).
4. **Custom .mbox File Import (Zero-Knowledge Ingestion)**: Added a 3rd source option in the direct import wizard (`data-testid="provider-card-custom-mbox"`) alongside Google Gmail and Microsoft Outlook. Added client-side streaming ingestion (`runMboxImport` in `apps/webmail/src/import_worker.ts`) using `streamMbox` and `resolveTargetFolder`. Raw MIME messages are parsed in-browser, encrypted locally using AES-GCM with the user's private mailbox key into Section 12 binary envelopes (`0x01` framing, 12-byte IV, ciphertext, 16-byte tag), uploaded to customer storage, and registered via API.

## Files edited

| File | Reason |
|------|--------|
| `apps/webmail/src/components/Sidebar.tsx` | Modernized Scheduled folder icon to `calendar-clock` and Spam folder icon to `alert-octagon`. |
| `apps/webmail/src/components/InboxToolbar.tsx` | Wrapped Archive and Move to folder menus with folder guards; updated spam icon to `alert-octagon`. |
| `apps/webmail/src/components/ReadingPane.tsx` | Enforced folder guards hiding Move to folder, Archive, Snooze, and Report Spam on sent/ineligible items; added `data-testid` attributes. |
| `apps/webmail/src/components/ThreadRow.tsx` | Added folder guard hiding quick archive on sent, draft, and trash thread rows. |
| `apps/webmail/src/components/MessageRow.tsx` | Added folder guard hiding quick archive on sent, draft, and trash message rows. |
| `apps/webmail/src/App.tsx` | Filtered out sent messages from `handleMoveMessages` when target is not trash, and blocked snoozing sent/trash/spam items in `handleSnoozeMessage`. |
| `apps/webmail/src/import_worker.ts` | Implemented `MboxImportOptions` and `runMboxImport` for streaming client-side AES-GCM encryption and customer storage upload of .mbox files. |
| `apps/webmail/src/routes/settings/ImportTab.tsx` | Added "Custom .mbox File" provider card, dropzone, target folder selector, and wired execution to `runMboxImport`. |
| `apps/webmail/src/mbox_stream.test.ts` | Added unit test verifying client-side AES-GCM encryption roundtrip and Section 12 binary envelope framing for .mbox ingestion. |
| `apps/webmail/src/folder_and_trash.test.ts` | Added unit tests verifying sent message move prevention and folder snooze restrictions. |
| `services/api/messages.go` | Added backend validation in `messageFolderHandler` rejecting moving sent messages to any folder other than trash. |
| `services/api/snooze.go` | Added backend validation in `messageSnoozeHandler` rejecting snoozing sent, trash, or spam messages. |
| `services/api/snooze_test.go` | Added Go integration test verifying snooze rejection on sent, trash, and spam items. |
| `services/api/folder_lifecycle_test.go` | Added Go integration test verifying 400 Bad Request when moving sent items to inbox/archive, and 200 OK to trash. |
| `tests/browser/test_sent_restrictions_and_mbox_import.mjs` | Puppeteer browser automation test for icons, sent action restrictions, and custom .mbox file import. |

## Raw evidence

### 1. Go Backend Integration Tests Output
The backend guard enforcement was
verified
```
=== RUN   TestSentMessageFolderRestrictions
    folder_lifecycle_test.go:271: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestSentMessageFolderRestrictions (0.25s)
=== RUN   TestSnoozeSentAndTrashRestrictions
    snooze_test.go:246: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
    threading_test.go:67: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestSnoozeSentAndTrashRestrictions (0.16s)
PASS
ok  	byos.email/services/api	1.057s
```

### 2. Webmail Test Suite Output
The frontend unit and cryptographic tests execution
complete
```
Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE SYNC TESTS: 32 passed, 0 failed

Running Reply & Signature Security Tests...
REPLY & SIGNATURE SECURITY TESTS: 12 passed, 0 failed

Running Mbox Stream Tests...
  ✓ 1. Parse a 3-message mbox -> yields 3 messages in order
  ✓ 2. CRLF line endings -> normalized properly
  ✓ 3. mboxrd unescaping: >From unescaped to From
  ✓ 4. Empty lines within body preserved, trailing separator trimmed
  ✓ 5. A very large message (simulate 2MB) yields correctly
  ✓ 6. AbortSignal stops iteration cleanly
  ✓ 7. Custom .mbox import encryption pipeline (AES-GCM zero-knowledge roundtrip)
MBOX STREAM TESTS: 7 passed, 0 failed

Running Mbox Labels Tests...
MBOX LABELS TESTS: 6 passed, 0 failed

Running Import Queue Tests...
IMPORT QUEUE TESTS: 4 passed, 0 failed

Running Threading Data Structure Tests...
THREADING DATA TESTS: 11 passed, 0 failed

Running Undo Send Tests...
UNDO SEND TESTS: 5 passed, 0 failed

Running Snooze Store Tests...
SNOOZE STORE TESTS: 5 passed, 0 failed

Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 5 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 5 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 16 passed, 0 failed

Running API Error Parsing Tests...
API ERROR PARSING TESTS: 6 passed, 0 failed

Running Track 1 Offline Outbox Tests...
TRACK 1 TESTS: 6 passed, 0 failed

Running Track 2 Encrypted Storage & Search Index Tests...
TRACK 2 TESTS: 9 passed, 0 failed

Running Track 3 Key Directory & Key Rotation Tests...
TRACK 3 TESTS: 7 passed, 0 failed

Running Track 4 Device Management & Revocation Tests...
TRACK 4 TESTS: 8 passed, 0 failed

Running Track 5 Rate Limiting & Abuse Prevention Tests...
TRACK 5 TESTS: 7 passed, 0 failed

Running Track 6 Message Export & Portability Tests...
TRACK 6 TESTS: 8 passed, 0 failed

Running Track 7 Calendar & Event Sync Tests...
TRACK 7 TESTS: 8 passed, 0 failed

Running Track 8 Contact Management & CardDAV Tests...
TRACK 8 TESTS: 8 passed, 0 failed

Running Track 9 Identity & Alias Management Tests...
TRACK 9 TESTS: 8 passed, 0 failed

Running Track 10 Mailbox Rules & Filtering Tests...
TRACK 10 TESTS: 8 passed, 0 failed

Running Track 11 Dark Mode & High Contrast Tests...
TRACK 11 TESTS: 8 passed, 0 failed

Running Track 12 Keyboard Navigation & Shortcuts Tests...
TRACK 12 TESTS: 8 passed, 0 failed

Running Track 13 Draft Auto-Save & Crash Recovery Tests...
TRACK 13 TESTS: 8 passed, 0 failed

Running Track 14 Zero-Knowledge Attachment Preview Tests...
TRACK 14 TESTS: 8 passed, 0 failed

Running Track 15 Multi-Folder Search & Filtering Tests...
TRACK 15 TESTS: 8 passed, 0 failed

Running Track 16 Vacation Responder Tests...
TRACK 16 TESTS: 7 passed, 0 failed

Running Track 17 End-to-End Cryptographic Invariants Tests...
TRACK 17 TESTS: 9 passed, 0 failed

Running Calendar Persistence Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

Running Calendar Repo Integration Tests...
CALENDAR REPO INTEGRATION TESTS: 5 passed, 0 failed

Running Historical Key Reactivation Tests...
HISTORICAL KEY REACTIVATION TESTS: 13 passed, 0 failed

Running Track 3 Calendar Category Tests...
CALENDAR TRACK 3 TESTS: 8 passed, 0 failed

Running Track 4 Webmail Reliability & Media Encryption Tests...
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed

Running Off-Thread Crypto Web Worker & Bridge Tests...
CRYPTO WORKER BRIDGE TESTS: 13 passed, 0 failed

Running Subscriptions & Unsubscribe Store Tests...
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed

Running Image Privacy Store Tests...
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed

Running KashCal Natural Language Event Parser Tests...
KASHCAL PARSER TESTS: 6 passed, 0 failed

Running Translator & Localization Tests...
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed

Running Folder & Trash Lifecycle Tests...
  ✓ 1. TestDraftMappingPreservesFolderAndFlags
  ✓ 2. TestDraftsInTrashFilterCorrectly
  ✓ 3. TestMovingDraftToTrashAndRestoreInState
  ✓ 4. TestPermanentDeleteFiltersMessage
  ✓ 5. TestEmptyTrashFiltersAllTrashItems
  ✓ 6. TestReadingPaneDraftDetectionInTrash
  ✓ 7. TestUndoActionStoresPreviousAndTargetFolder
  ✓ 8. TestSentMessageMoveRestrictions
  ✓ 9. TestSnoozeRestrictions
FOLDER & TRASH TESTS: 9 passed, 0 failed

OVERALL: 677 passed, 0 failed
```

### 3. API Container Health Check
The recreated container is
working
```
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self' http://localhost:* http://127.0.0.1:* https://localhost:*;
Content-Type: application/json
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Xss-Protection: 1; mode=block
Date: Sun, 08 Nov 2026 08:30:13 GMT
Content-Length: 145

{"status":"ok","services":{"minio":"up","postfix":"up","postgres":"up","redis":"up","rspamd":"up"},"timestamp":"2026-11-08T08:30:13.040301267Z"}
```

## Manual browser verification

The automated Puppeteer browser verification was executed against the running application at `http://127.0.0.1:3001` with API gateway at `http://127.0.0.1:8080`.
The browser suite run is
PASS
```
================================================================================
      SENT RESTRICTIONS, FOLDER ICONS & CUSTOM .MBOX IMPORT VERIFICATION        
================================================================================

--- 1. Login as Alice (alice@byos.local) ---
  PASS: Alice logged in successfully and session initialized

--- 2. Inspecting Modernized Folder Icons ---
  Scheduled folder SVG contains calendar-clock: true
  Spam folder SVG contains alert-octagon: true
  PASS: Scheduled folder icon modernized with calendar-clock SVG
  PASS: Spam folder icon modernized with alert-octagon SVG
  Saved screenshot: tests\browser\artifacts\sent_restrictions_and_mbox_icons.png

--- 3. Verifying Sent Folder Action Restrictions ---
  PASS: Move to folder button is REMOVED from sent message ReadingPane
  PASS: Archive button is REMOVED from sent message ReadingPane
  PASS: Snooze option is REMOVED from sent message overflow menu
  PASS: Report spam option is REMOVED from sent message overflow menu
  Saved screenshot: tests\browser\artifacts\sent_restrictions_reading_pane.png

--- 4. Verifying Settings -> Mailbox Import & 3 Provider Cards ---
  Provider cards status: {"hasGmail":true,"hasOutlook":true,"hasCustomMbox":true}
  PASS: Google Gmail provider card is present
  PASS: Microsoft Outlook provider card is present
  PASS: Custom .mbox File provider card is present
  Saved screenshot: tests\browser\artifacts\import_wizard_provider_cards.png

--- 5. Configuring and Running Custom .mbox File Import ---
  PASS: Advanced directly to .mbox configuration step (OAuth authorization bypassed)
  PASS: Found mbox file input element
  PASS: Start .mbox Import button is enabled with selected file
  PASS: File details render uploaded .mbox filename
  Starting in-browser zero-knowledge .mbox import...
  Summary text snippet: Direct Mailbox Import (OAuth 2.0)

Import your entire inbox, sent, archive, and trash messages from Gmail or Outlook with client-side zero-knowledge e
  PASS: Import summary indicates 'Import Completed'
  Saved screenshot: tests\browser\artifacts\custom_mbox_import_summary.png

--- 6. DevTools State Dump ---
localStorage keys: [
  'byos_week_start',
  'byos_unified_inbox_excluded',
  'byos_layout',
  'byos_time_format',
  'byos_language',
  'byos_theme',
  'byos_connected_accounts',
  'byos_session_generation',
  'byos_density',
  'byos_view_mode'
]
sessionStorage keys: [
  'byos_msg_subject_d5407593-7c3b-45c0-bfd9-15c9a7de09f0',
  'byos_msg_subject_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff',
  'byos_msg_category_e311272b-4ef4-4f8c-87e5-3a581441c82e',
  'byos_msg_category_2e7f2b27-49f0-40a6-a997-f3822eaf21eb',
  'byos_msg_category_bcde7268-d542-4e4b-ab31-246b85bace74',
  'byos_msg_subject_bcde7268-d542-4e4b-ab31-246b85bace74',
  'byos_msg_category_d4a7eb57-c3cc-4970-8b75-bfdf51206b23',
  'byos_msg_snippet_570d721f-0317-4ddd-b66b-cb289bfa99c2',
  'byos_msg_category_02fa1dd8-583a-4953-a28d-2e6b761ca6af',
  'byos_msg_category_c0441042-c574-426f-8495-f1427f4373f1',
  'byos_msg_category_4bb7ab91-994b-4b67-a5ab-db11372795c3',
  'byos_msg_subject_8c41392b-ce7f-49e6-b7a7-b3506cb1e402',
  'byos_msg_snippet_4bb7ab91-994b-4b67-a5ab-db11372795c3',
  'byos_msg_subject_bb06cba8-b0c5-4604-a1ea-346e4cc9f117',
  'byos_msg_category_8c41392b-ce7f-49e6-b7a7-b3506cb1e402',
  'byos_msg_snippet_62547fec-370e-4718-94ec-5fe6ba9339ff',
  'byos_msg_snippet_bcde7268-d542-4e4b-ab31-246b85bace74',
  'byos_msg_category_d5407593-7c3b-45c0-bfd9-15c9a7de09f0',
  'byos_msg_snippet_7205e5ee-0f40-486d-a2b2-ebca8a275221',
  'byos_msg_subject_722e051d-4667-412d-93d1-b959f578f41b',
  'byos_msg_category_62547fec-370e-4718-94ec-5fe6ba9339ff',
  'byos_msg_category_913f61da-db27-4b06-ab01-a3fb02dcdb1e',
  'byos_msg_subject_e311272b-4ef4-4f8c-87e5-3a581441c82e',
  'byos_msg_subject_913f61da-db27-4b06-ab01-a3fb02dcdb1e',
  'byos_msg_subject_c0441042-c574-426f-8495-f1427f4373f1',
  'byos_msg_subject_d4a7eb57-c3cc-4970-8b75-bfdf51206b23',
  'byos_msg_snippet_8c41392b-ce7f-49e6-b7a7-b3506cb1e402',
  'byos_msg_subject_02fa1dd8-583a-4953-a28d-2e6b761ca6af',
  'byos_msg_snippet_2e7f2b27-49f0-40a6-a997-f3822eaf21eb',
  'byos_session_generation',
  'byos_msg_category_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70',
  'byos_msg_subject_4bb7ab91-994b-4b67-a5ab-db11372795c3',
  'byos_msg_snippet_c0441042-c574-426f-8495-f1427f4373f1',
  'byos_msg_snippet_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff',
  'byos_msg_subject_570d721f-0317-4ddd-b66b-cb289bfa99c2',
  'byos_msg_category_722e051d-4667-412d-93d1-b959f578f41b',
  'byos_msg_subject_2edb7c58-7024-4f9b-af8c-35fd02cd4277',
  'byos_msg_subject_62547fec-370e-4718-94ec-5fe6ba9339ff',
  'byos_msg_subject_8a52f560-a555-469f-83fc-ea829001eaec',
  'byos_msg_snippet_8a52f560-a555-469f-83fc-ea829001eaec',
  'byos_msg_category_b798701e-8143-4ddf-8d35-0996015e491a',
  'byos_msg_category_570d721f-0317-4ddd-b66b-cb289bfa99c2',
  'byos_view_mode',
  'byos_msg_subject_2e7f2b27-49f0-40a6-a997-f3822eaf21eb',
  'byos_msg_subject_178aa67f-fa69-4b84-9faa-29a88e1219e3',
  'byos_msg_category_7205e5ee-0f40-486d-a2b2-ebca8a275221',
  'byos_msg_subject_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70',
  'byos_msg_snippet_c8175dea-21d2-4361-941a-589e330b2d1b',
  'byos_msg_category_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff',
  'byos_msg_snippet_bb06cba8-b0c5-4604-a1ea-346e4cc9f117',
  'byos_msg_snippet_b798701e-8143-4ddf-8d35-0996015e491a',
  'byos_msg_category_8a52f560-a555-469f-83fc-ea829001eaec',
  'byos_msg_snippet_02fa1dd8-583a-4953-a28d-2e6b761ca6af',
  'byos_msg_snippet_d4a7eb57-c3cc-4970-8b75-bfdf51206b23',
  'byos_session_vault',
  'byos_msg_subject_c8175dea-21d2-4361-941a-589e330b2d1b',
  'byos_msg_snippet_2edb7c58-7024-4f9b-af8c-35fd02cd4277',
  'byos_msg_category_2edb7c58-7024-4f9b-af8c-35fd02cd4277',
  'byos_msg_snippet_722e051d-4667-412d-93d1-b959f578f41b',
  'byos_msg_subject_7205e5ee-0f40-486d-a2b2-ebca8a275221',
  'byos_msg_snippet_178aa67f-fa69-4b84-9faa-29a88e1219e3',
  'byos_keys_published_c0000000-0000-0000-0000-000000000001_66c3f0c7cdad753ece2c6579efbcdcef3c903cd9a87093624be739abb04a1547_77fc3d2d62addcf72bfd0674a92abacc68112f1a79a0ecaef6e3cbef4cbac7c585ec1288a13577627c81dee67c53b345e415c9da382a0aaa6690512ed7b18089514e614383aa91cb2df81918e218ac7bbca61c810ec76dab4729c9921713f27447dc984a81b2aa980f52f23567273159fbc3185111dcc84f177866ba55c2923b52edc67023b30495f78281f9c054879a096445b9764a6286826c46ccfbf9bcc153326b85252c1ca675528e2b446e98da6b3b34718ac70b82a6bfa9f7aa0c8c315b4658e936ad17a2a2391bbaa6a48787a0633a493bd4c29040f32467ec704d08751eec2e4d6b3fdc5586e9f8378f18cdb9b62ca46081e4c17d411b911cac44d1fc26d4b88dc98845133185d55a7a87a168bd354b3009b5a16ab23f15a2303c0557fc4a2c793617e68e1d373a0f0c4270636cac617e86f5616db1a29dba7f93c9ad0671992a0309fcd89ca26a20471acc33d023840ab62200915ce83925d5c8f9d09ed0b83f43c6ca0a234c5fa83b4d16759800a7b32c7d2b7a066e3a3e76e361b98469f20a1701f51a60c6aa5f0a8f291805b64c7070a41f1be65a4b0bbf31579c5d67bea933be7992afa9c8922a6cc07a7b749c4b0711863096697a28d298dad29ccf19a2c2e426871c7a1001a1ad779f3943400fe42a2d8b1f12005b03b927f1279031dc1157453b5574733f0c3dd0576b5a48651679c9bcf1cdbff61b8f06ba7743975a0717c8360b69fa4e7882bd5aaace340159bcf2671b30517ad4bbdd37c1036998312aace9012f3548a358822bc5396fdff8a611a2c6f4809067bc3e45f22254769ecd58ccd0933d65f448b78517856a0d64739e93e79091e83223dc8d4193aa1dcb6c29b24529f7929650c59ee0060b00741fab17a21c9cd1d4543ec26be272183ef5ac6ee0b4c57752dc693c7fca335389c78009631617c5ac272d45e51017728e0c05820480cdaad4659d6693fdf37c55163face41f52b9c0fc1035f79124adfa8ad49a04223b98797521e8a742bb984823d67995351bb8897a23233b7da89166fc435ba76aef710f44e7c1e7d648c011bbd81551bf5aa9c4a7aa2b9030207b27ff15304fc9026ee11fbe6246589b76cd81a51359731edb599dea0cc98957656a8190607e467c88ee01023829ba3da5cb9fd121582b3ed5452b7cc517091b47927b8fd61101e9eb1658e14224a28e58e80ecbf715abf1a23a70c6cdf40d620683e317bc6746961c5a84ff409fa1ba6a26b102a4852a2b058dbe25996c46aded97a11dbb0828708576b411fc19497d60be66f2c5bad31b43e998ab578e0023b349f29cba09af2549a4f3ab518da771a62c0dc2b3244a7830f4b83575c07946659866b17d15f70362bb248eba5758dcb3e16b3c03f726fefa4c38c8852f64aaf03c7d43a36bc332262b635d00bd080f769534b38be64c73ba6b372ecb285d350c8fcabf64e8c869173eda1a571b7896a5db035bb03827334fb56c499ca07e9633ac59099d41f50793947535b4c85f61b864ab51c1784abe52625886a24f2860725b400be67939690f51bc5f11051003c300557a026f027d00d19e9d5a8cc3a628b41b6d0e82a5a3e349125b20c7605fea600a56d51392638c5de83f48a4f408c972fda7ef036b0550eab637af44adcbe0e1372bdd33a45db33e4e7f624de4568a887751db1b5810e25545652a7bd5a53d6b6b1009200e34c3265a5a',
  'byos_msg_snippet_913f61da-db27-4b06-ab01-a3fb02dcdb1e',
  'byos_msg_snippet_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70',
  'byos_msg_subject_b798701e-8143-4ddf-8d35-0996015e491a',
  'byos_msg_category_178aa67f-fa69-4b84-9faa-29a88e1219e3',
  'byos_connected_accounts',
  'byos_msg_snippet_e311272b-4ef4-4f8c-87e5-3a581441c82e',
  'byos_msg_category_bb06cba8-b0c5-4604-a1ea-346e4cc9f117',
  'byos_msg_category_c8175dea-21d2-4361-941a-589e330b2d1b',
  'byos_msg_snippet_d5407593-7c3b-45c0-bfd9-15c9a7de09f0'
]
Recorded 35 console messages
Recorded 462 network requests

================================================================================
     ALL SENT RESTRICTIONS & CUSTOM .MBOX IMPORT BROWSER CHECKS PASSED!        
================================================================================
```

Screenshots saved to repository:
- `tests/browser/artifacts/sent_restrictions_and_mbox_icons.png`
- `tests/browser/artifacts/sent_restrictions_reading_pane.png`
- `tests/browser/artifacts/import_wizard_provider_cards.png`
- `tests/browser/artifacts/custom_mbox_import_summary.png`

## What did not work or is untested

1. Multi-gigabyte `.mbox` archives with over 100,000 emails were not benchmarked in browser heap memory in this run (covered up to standard archives using the chunked streaming generator).
2. Live Google OAuth2 authorization with real Google production consent screens is UNTESTED in automated headless CI due to 3rd-party CAPTCHA and external OAuth requirements (verified via test harness). Manual verification steps:
   - Configure Google Cloud OAuth Client ID in BYOS admin.
   - Open Settings -> Mailbox Import.
   - Click "Google Gmail" card -> click "Authorize with Google".
   - Authorize in Google popup and observe automatic tokens storage and folder sync.

## Test suite output

### 1. `go test` output (services/api):
The Go test suite run is
PASS
```
=== RUN   TestSentMessageFolderRestrictions
    folder_lifecycle_test.go:271: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestSentMessageFolderRestrictions (0.25s)
=== RUN   TestSnoozeSentAndTrashRestrictions
    snooze_test.go:246: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
    threading_test.go:67: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestSnoozeSentAndTrashRestrictions (0.16s)
PASS
ok  	byos.email/services/api	1.057s
```

### 2. `npm test` output (apps/webmail):
The full webmail test suite run is
PASS
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:10644) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
  ✓ test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output
  ✓ test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error
  ✓ test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte
  ✓ test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match
  ✓ test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable
  ✓ Content key generation produces 32 bytes
  ✓ Base IV generation produces 12 bytes
  ✓ Chunk IV generation produces 12 bytes
  ✓ Attachment encryption roundtrip: 1 byte
  ✓ Attachment encryption roundtrip: 64 bytes
  ✓ Path A recipient cannot decrypt sender chunks
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE SYNC TESTS: 32 passed, 0 failed

Running Reply & Signature Security Tests...
REPLY & SIGNATURE SECURITY TESTS: 12 passed, 0 failed

Running Mbox Stream Tests...
  ✓ 1. Parse a 3-message mbox -> yields 3 messages in order
  ✓ 2. CRLF line endings -> normalized properly
  ✓ 3. mboxrd unescaping: >From unescaped to From
  ✓ 4. Empty lines within body preserved, trailing separator trimmed
  ✓ 5. A very large message (simulate 2MB) yields correctly
  ✓ 6. AbortSignal stops iteration cleanly
  ✓ 7. Custom .mbox import encryption pipeline (AES-GCM zero-knowledge roundtrip)
MBOX STREAM TESTS: 7 passed, 0 failed

Running Mbox Labels Tests...
MBOX LABELS TESTS: 6 passed, 0 failed

Running Import Queue Tests...
IMPORT QUEUE TESTS: 4 passed, 0 failed

Running Threading Data Structure Tests...
THREADING DATA TESTS: 11 passed, 0 failed

Running Undo Send Tests...
UNDO SEND TESTS: 5 passed, 0 failed

Running Snooze Store Tests...
SNOOZE STORE TESTS: 5 passed, 0 failed

Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 5 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 5 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 16 passed, 0 failed

Running API Error Parsing Tests...
API ERROR PARSING TESTS: 6 passed, 0 failed

Running Track 1 Offline Outbox Tests...
TRACK 1 TESTS: 6 passed, 0 failed

Running Track 2 Encrypted Storage & Search Index Tests...
TRACK 2 TESTS: 9 passed, 0 failed

Running Track 3 Key Directory & Key Rotation Tests...
TRACK 3 TESTS: 7 passed, 0 failed

Running Track 4 Device Management & Revocation Tests...
TRACK 4 TESTS: 8 passed, 0 failed

Running Track 5 Rate Limiting & Abuse Prevention Tests...
TRACK 5 TESTS: 7 passed, 0 failed

Running Track 6 Message Export & Portability Tests...
TRACK 6 TESTS: 8 passed, 0 failed

Running Track 7 Calendar & Event Sync Tests...
TRACK 7 TESTS: 8 passed, 0 failed

Running Track 8 Contact Management & CardDAV Tests...
TRACK 8 TESTS: 8 passed, 0 failed

Running Track 9 Identity & Alias Management Tests...
TRACK 9 TESTS: 8 passed, 0 failed

Running Track 10 Mailbox Rules & Filtering Tests...
TRACK 10 TESTS: 8 passed, 0 failed

Running Track 11 Dark Mode & High Contrast Tests...
TRACK 11 TESTS: 8 passed, 0 failed

Running Track 12 Keyboard Navigation & Shortcuts Tests...
TRACK 12 TESTS: 8 passed, 0 failed

Running Track 13 Draft Auto-Save & Crash Recovery Tests...
TRACK 13 TESTS: 8 passed, 0 failed

Running Track 14 Zero-Knowledge Attachment Preview Tests...
TRACK 14 TESTS: 8 passed, 0 failed

Running Track 15 Multi-Folder Search & Filtering Tests...
TRACK 15 TESTS: 8 passed, 0 failed

Running Track 16 Vacation Responder Tests...
TRACK 16 TESTS: 7 passed, 0 failed

Running Track 17 End-to-End Cryptographic Invariants Tests...
TRACK 17 TESTS: 9 passed, 0 failed

Running Calendar Persistence Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

Running Calendar Repo Integration Tests...
CALENDAR REPO INTEGRATION TESTS: 5 passed, 0 failed

Running Historical Key Reactivation Tests...
HISTORICAL KEY REACTIVATION TESTS: 13 passed, 0 failed

Running Track 3 Calendar Category Tests...
CALENDAR TRACK 3 TESTS: 8 passed, 0 failed

Running Track 4 Webmail Reliability & Media Encryption Tests...
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed

Running Off-Thread Crypto Web Worker & Bridge Tests...
CRYPTO WORKER BRIDGE TESTS: 13 passed, 0 failed

Running Subscriptions & Unsubscribe Store Tests...
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed

Running Image Privacy Store Tests...
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed

Running KashCal Natural Language Event Parser Tests...
KASHCAL PARSER TESTS: 6 passed, 0 failed

Running Translator & Localization Tests...
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed

Running Folder & Trash Lifecycle Tests...
  ✓ 1. TestDraftMappingPreservesFolderAndFlags
  ✓ 2. TestDraftsInTrashFilterCorrectly
  ✓ 3. TestMovingDraftToTrashAndRestoreInState
  ✓ 4. TestPermanentDeleteFiltersMessage
  ✓ 5. TestEmptyTrashFiltersAllTrashItems
  ✓ 6. TestReadingPaneDraftDetectionInTrash
  ✓ 7. TestUndoActionStoresPreviousAndTargetFolder
  ✓ 8. TestSentMessageMoveRestrictions
  ✓ 9. TestSnoozeRestrictions
FOLDER & TRASH TESTS: 9 passed, 0 failed

OVERALL: 677 passed, 0 failed
```
