# Webmail Notes Phase 01: Security and Data Integrity Remediation Report

## What was built
Phase 1 of the BYOS Webmail Notes remediation plan successfully addresses all high-severity security, cryptographic, and data-integrity gaps identified in the audit (`docs/webmail_notes_audit.md`). The unencrypted plaintext persistence fallback has been entirely eliminated from `notesStore.ts`, enforcing strict fail-closed behavior whenever encryption keys are absent or invalid. Note encryption now uses context-bound v2 Additional Authenticated Data (`byos-notes-v2:${mailboxId}:${noteId}`) to prevent cross-note and cross-mailbox ciphertext substitution attacks while preserving backwards-compatible decryption for legacy v1 notes. A 6-step authenticated round-trip migration protocol automatically upgrades legacy plaintext notes to AES-256-GCM ciphertext without data loss or corruption. Cross-account state leakage in `NotesView.tsx` is eliminated via explicit mailbox affinity checks, session zeroization lifecycle hooks, reactive reset triggers, and multi-tab storage synchronization, complemented by visible saving state indicators (`Saving...`, `✓ Saved`, `⚠️ Save failed`) and honest UI labeling for local attribution tags and local target-date reminders.

---

## Files edited

| File | Reason |
|------|--------|
| `apps/webmail/src/components/notes/notesStore.ts` | Eliminated unencrypted fallback, enforced fail-closed persistence, implemented v2 AAD (`byos-notes-v2`), backward-compatible v1 fallback, safe 6-step legacy plaintext migration, strict key resolution, and zeroization cleanup hook. |
| `apps/webmail/src/components/notes/NotesView.tsx` | Added saving state feedback signals, composer and modal status badges, cross-account mailbox affinity guards, multi-tab storage sync, and honest labeling for local attribution tags and reminders. |
| `apps/webmail/src/session_isolation.ts` | Registered modular session cleanup hooks executed on `zeroizeKeys()` during logout. |
| `apps/webmail/src/components/notes/notes.test.ts` | Added automated tests 22–35 covering missing keys, fail-closed behavior, AAD context binding, substitution rejection, legacy v1 fallback, authenticated migration, rollback safety, and session zeroization. |
| `tests/browser/test_notes_track1_zk_resilience.mjs` | Updated Step 6 IndexedDB media assertion to recognize zero-knowledge encrypted media (`encryptedDataUrl` ciphertext and redacted `dataUrl`). |

---

## 1. Original Security Findings

From `docs/webmail_notes_audit.md` and `docs/notes_track1_zk_resilience_report.md`:
1. **Critical Plaintext Fallback (FINDING-NOTES-01):** `notesStore.ts` (lines 876–883) contained an explicit fallback branch in `saveNotes` that persisted unencrypted plaintext `title`, `content`, and `checklistItems` into `localStorage` whenever `key` was null or not 32 bytes.
2. **Missing Note-Context AAD Binding (FINDING-NOTES-02):** Notes were encrypted with AAD bound solely to the mailbox (`byos-notes-v1:${mailboxId}`). An attacker with access to storage could swap ciphertexts between Note A and Note B within the same mailbox without triggering authentication tag failure.
3. **Cross-Account UI Leakage (FINDING-NOTES-03):** Switching accounts in Webmail while composer or edit modal was open failed to reset editing state, allowing modifications drafted for Account A to be committed into Account B.
4. **Silent In-Memory Session Leakage (FINDING-NOTES-04):** Logging out or switching accounts did not wipe `notesStore`'s in-memory `storeMailboxKey` or `mediaCache`.
5. **Misleading Cloud Features (FINDING-NOTES-05):** "Collaborators" and "Reminders" buttons implied remote multi-user collaboration and active alerting, whereas they operated strictly as local tags.

---

## 2. Root Cause of Plaintext Fallback

In the initial implementation of `saveNotes` in `notesStore.ts`:
```typescript
// Legacy vulnerable logic:
if (key && key.length === 32) {
  // Encrypt
} else {
  // Unencrypted plaintext fallback!
  return notes.map((n) => ({ ...n }));
}
```
Furthermore, wrapper functions such as `createNote`, `updateNote`, `deleteNote`, `duplicateNote`, and `togglePinNote` invoked `saveNotes(mailboxId, updated)` without passing a key parameter, relying on module-level `storeMailboxKey`. When `storeMailboxKey` was null or uninitialized, notes were quietly written to `localStorage` in cleartext, violating zero-knowledge guarantees.

---

## 3. Changes Made

### A. Elimination of Plaintext Persistence Fallback (`notesStore.ts`)
- In `saveNotes`, the unencrypted fallback branch was removed entirely. If any note contains sensitive content (`title`, `content`, `checklistItems`, or `versionHistory`) and no 32-byte key is available, `saveNotes` refuses to write to storage, logs an error, and returns `false`.
- Wrapper functions (`createNote`, `updateNote`, `duplicateNote`, `deleteNote`, etc.) now resolve the encryption key via `resolveNotesMailboxKey` and pass it directly to `saveNotes`. If the key is unavailable, mutating actions fail closed and return `null` or `false`.
- In `saveMediaToIDB`, saving refuses unencrypted persistence to IndexedDB if an encryption key is unavailable, preventing unencrypted media leakage.

### B. Context-Bound v2 AAD Architecture (`notesStore.ts`)
- Introduced canonical AAD prefixes:
  - `NOTES_AAD_PREFIX_V1 = "byos-notes-v1"` (legacy)
  - `NOTES_AAD_PREFIX_V2 = "byos-notes-v2"` (current)
- Implemented `computeNotesAad(mailboxId, noteId, version)`:
  - Version 1: `byos-notes-v1:${mailboxId}`
  - Version 2: `byos-notes-v2:${mailboxId}:${noteId}`
- Note media attachments bind to `byos-notes-media-v2:${mailboxId}:${mediaId}` with v1 fallback.
- `encryptNoteSensitiveSync` and `encryptNoteSensitiveSubtle` produce v2 context-bound ciphertexts by default.
- `decryptNoteSensitiveSync` and `decryptNoteSensitiveSubtle` attempt v2 decryption with note ID binding first; if authentication fails and version is not strictly pinned to 2, they attempt v1 AAD fallback.

### C. Safe 6-Step Authenticated Migration Protocol (`notesStore.ts`)
- Added `migrateLegacyPlaintextNotes(mailboxId, notes, key)`:
  1. **Identify:** Filters unencrypted legacy notes without exposing content in logs.
  2. **Snapshot:** Takes deep copies of sensitive fields (`title`, `content`, `checklistItems`, `versionHistory`).
  3. **Encrypt:** Encrypts sensitive fields with AES-256-GCM bound to v2 AAD (`byos-notes-v2:${mailboxId}:${note.id}`).
  4. **Validate:** Immediately decrypts ciphertext in-memory and validates byte-for-byte round-trip equality against the original plaintext snapshot before touching storage.
  5. **Replace:** Replaces sensitive fields with redacted empty values, sets `encryptedPayload` and `encryptionVersion: 2`, and deletes `_isLegacyPlaintext`.
  6. **Safety Rollback:** If any note fails validation, the transaction aborts, leaving original storage intact.
- Migration is only attempted when a valid 32-byte key is present; when a key is absent, legacy notes remain untouched as `_isLegacyPlaintext: true`.

### D. Account Isolation & Session Zeroization (`session_isolation.ts`, `notesStore.ts`, `NotesView.tsx`)
- Added `registerSessionCleanupHook` to `session_isolation.ts`, wired directly into `zeroizeKeys()`.
- `notesStore.ts` registers a cleanup hook that zeroizes `storeMailboxKey = null` and executes `clearNotesMediaCache()` upon logout.
- In `NotesView.tsx`:
  - Added `composeMailboxId` and `editMailboxId` tracking signals.
  - When `effectiveMailboxId()` changes, any active composition or edit modal is automatically aborted, composer inputs are cleared, modal is closed, and in-memory media caches are purged.
  - Added cross-tab `storage` event listener to ensure multi-tab consistency.

### E. Honest Functionality & User Interface Feedback (`NotesView.tsx`)
- Added reactive saving state indicators: `saveStatus` (`"idle" | "saving" | "saved" | "failed"`) with clear indicators rendered beside the Close button:
  - `Saving...` with spinner
  - `✓ Saved`
  - `⚠️ Save failed` (with error tooltip; preserves editor state without clearing inputs)
- Updated Collaborator UI to explicitly state: "Add Collaborator (Local Tag)" with tooltip "Attribution tag (local only; remote sharing not yet supported)".
- Updated Reminder UI to explicitly state: "Remind me (local target date)" with tooltip "Target date reminder (local reference; alerts not yet active)".

---

## 4. Legacy Note Compatibility & Migration Strategy

Legacy unencrypted notes in `localStorage` from pre-remediation versions are treated with strict compatibility invariants:
1. **Preservation without key:** When a mailbox is opened without an active cryptographic session (or wrong key), existing plaintext notes are parsed with `_isLegacyPlaintext: true` and `_decrypted: true`. They are not destroyed, wiped, or corrupted by failed migration attempts.
2. **Transparent upgrade with key:** Once a valid 32-byte mailbox key is supplied, `loadNotes` invokes `migrateLegacyPlaintextNotes`. Each note is encrypted with v2 AAD, validated in-memory, and only then written back to `localStorage` with redacted plaintext.
3. **Legacy v1 encrypted notes:** Notes encrypted under the prior `byos-notes-v1:${mailboxId}` scheme continue to decrypt seamlessly via the fallback pipeline. Upon the next user edit and save, they are automatically upgraded to `encryptionVersion: 2` with context-bound AAD.

---

## 5. Encryption & AAD Design

| Component | Format / Payload | AAD String |
|-----------|------------------|------------|
| Note Text & Checklists (v2) | AES-256-GCM (`wasm_aes_gcm_encrypt` / `crypto.subtle`) | `byos-notes-v2:${mailboxId}:${noteId}` |
| Note Text & Checklists (v1 legacy) | AES-256-GCM (`wasm_aes_gcm_encrypt` / `crypto.subtle`) | `byos-notes-v1:${mailboxId}` |
| Note Media (Drawings & Images) (v2) | AES-256-GCM in IndexedDB | `byos-notes-media-v2:${mailboxId}:${mediaId}` |
| Note Media (v1 legacy) | AES-256-GCM in IndexedDB | `byos-notes-media:${mailboxId}` |

Ciphertext format:
```
<salt_hex: 32 bytes>.<iv_hex: 12 bytes>.<ciphertext_and_tag_hex>
```
Because `noteId` and `mailboxId` are passed as AAD into AES-GCM, any alteration of the note ID, swapping of ciphertexts between notes, or cross-tenant injection causes AES-GCM authentication failure and fails closed.

---

## 6. Account Isolation Improvements

1. **Composer Mailbox Binding:** When the user opens the composer, `composeMailboxId` records the active mailbox ID. If the active account switches while editing, `handleSaveNewNote` aborts the write with an explicit error, preventing cross-tenant leakage.
2. **Edit Modal Mailbox Binding:** When opening a note to edit, `editMailboxId` records the note's owning mailbox. If the user switches accounts in the background, `handleSaveEdit` aborts saving and resets modal state.
3. **Session Zeroization Hook:** Calling `zeroizeKeys()` wipes `storeMailboxKey = null` and purges `mediaCache`.
4. **Key Isolation in `resolveNotesMailboxKey`:** If an explicit `key` argument is supplied and is `null` or invalid, the store fails closed and does not fall back to other accounts' cached keys.

---

## 7. Test Cases Added

Tests added to `apps/webmail/src/components/notes/notes.test.ts`:
- **Test 22:** Missing mailbox key fails closed (cannot create or persist note in plaintext).
- **Test 23:** Plaintext persistence fallback is entirely eliminated (unencrypted save returns false).
- **Test 24:** Save failure fails closed without leaking unencrypted data to storage.
- **Test 25:** Context-specific v2 AAD binds note ID and mailbox ID (`byos-notes-v2:${mailboxId}:${noteId}`).
- **Test 26:** Cross-note ciphertext substitution within same mailbox fails closed via v2 AAD binding.
- **Test 27:** Cross-mailbox ciphertext substitution fails closed via mailboxId AAD binding.
- **Test 28:** Tampered ciphertext envelope fails closed and returns null.
- **Test 29:** Backward compatibility: legacy v1 AAD encrypted note decrypts seamlessly.
- **Test 30:** Legacy v1 AAD note upgrades to v2 context-bound AAD on next edit/save.
- **Test 31:** Legacy plaintext note is preserved when key is unavailable (no premature migration).
- **Test 32:** Legacy plaintext note migrates to v2 AES-GCM when key is available with validated round-trip.
- **Test 33:** Legacy plaintext note migration failure leaves original plaintext intact (safe rollback).
- **Test 34:** Account switching isolation: cross-account key decrypts fail closed.
- **Test 35:** Session isolation & logout cleanup wipes notes in-memory key and media cache.

---

## Raw Evidence

### Command: Unit & Integration Test Suite Execution
`cmd /c "cd apps\webmail && npm.cmd test"`

```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:19532) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[Worker Crypto] Decryption failed for attachment_id=ae24b237-eca3-4adb-bc35-078b88186177 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[Worker Crypto] Hash mismatch for attachment_id=4c94ab8b-700e-4590-9b21-5f7a9a137856 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[Worker Crypto] Decryption failed for attachment_id=516ba52f-0822-4422-b0b3-7f360d29e0de chunk_index=0
  ✓ Path A recipient cannot decrypt sender chunks
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
  ✓ Added Account A to storage
  ✓ Added Account B, total accounts is 2
  ✓ Account B is promoted to front
  ✓ Re-syncing Account A does not duplicate
  ✓ Account A is promoted back to front
  ✓ Selective logout removes only Account B
  ✓ Origin 127.0.0.1 overrides mismatched server RP ID 'localhost'
  ✓ Origin localhost overrides mismatched server RP ID '127.0.0.1'
  ✓ Custom domain preserves server RP ID suffix
  ✓ test_login_clears_prior_accounts: localStorage contains ONLY Account C (prior accounts cleared)
  ✓ test_login_clears_prior_accounts: sessionStorage contains ONLY Account C
  ✓ test_login_clears_prior_accounts: prior Account A keys are wiped
  ✓ test_login_clears_prior_accounts: prior Account B keys are wiped
  ✓ test_login_clears_prior_accounts: new generation marker active
  ✓ test_startup_validates_tokens: invalid Account B is filtered out before render
  ✓ test_startup_validates_tokens: keys for invalid Account B are purged
  ✓ test_logout_clears_all_keys_for_account: all keys and publication records cleared for logged-out Account A
  ✓ test_logout_clears_all_keys_for_account: Account B keys remain intact
  ✓ test_logout_all_clears_everything: all sensitive byos_* keys are cleared
  ✓ test_logout_all_clears_everything: session generation marker removed from both storages
  ✓ test_logout_all_clears_everything: non-sensitive preference preserved
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: non-secret display metadata is preserved
  ✓ test_expired_token_shows_specific_error: error message names the specific account
  ✓ test_expired_token_shows_specific_error: does not show generic unauthorized error
  ✓ test_expired_token_shows_specific_error: expired account is removed from sidebar
  ✓ test_expired_token_shows_specific_error: storage updated without expired account
  ✓ test_switch_loads_target_account_keys: initially on Account A signing seed
  ✓ test_switch_loads_target_account_keys: target account keys exist in store
  ✓ test_switch_loads_target_account_keys: switched to Account B signing seed
  ✓ test_switch_active_account_updates_session_storage: active account id updated in sessionStorage
  ✓ test_auto_reconnect_loads_persisted_account: loads default account on fresh boot
  ✓ test_storage_event_syncs_accounts_across_tabs: external change updates connected accounts
  ✓ test_all_inboxes_navigation_state: unified inbox mode sets null selected mailbox
  ✓ test_account_row_action_menu_triggers: action menu toggle responds to user action
  ✓ test_status_indicator_shows_correct_state: active account shows active state
MULTI-ACCOUNT & STORAGE SYNC TESTS: 39 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 10 passed, 0 failed

Running Path A Compose Tests...
PATH A COMPOSE TESTS: 10 passed, 0 failed

Running Path A Read Tests...
PATH A READ TESTS: 8 passed, 0 failed

Running MIME Parsing & Rendering Tests...
MIME PARSER & RENDERER TESTS: 9 passed, 0 failed

Running Signature Tests...
SIGNATURE TESTS: 15 passed, 0 failed

Running Reply Signature Placement Tests...
REPLY SIGNATURE TESTS: 5 passed, 0 failed

Running MBOX Streaming Parser Tests...
MBOX STREAM TESTS: 5 passed, 0 failed

Running MBOX Labels & Flags Tests...
MBOX LABELS & FLAGS TESTS: 15 passed, 0 failed

Running Import Queue Tests...
IMPORT QUEUE TESTS: 10 passed, 0 failed

Running Threading Tests...
THREADING TESTS: 12 passed, 0 failed

Running Undo Send Tests...
UNDO SEND TESTS: 5 passed, 0 failed

Running Keyboard Shortcuts Tests...
KEYBOARD SHORTCUTS TESTS: 7 passed, 0 failed

Running Snooze Store Tests...
SNOOZE STORE TESTS: 11 passed, 0 failed

Running Scheduled Folder Store Tests...
SCHEDULED FOLDER TESTS: 8 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 10 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 10 passed, 0 failed

Running API Error Tests...
API ERROR TESTS: 10 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 11 passed, 0 failed

Running Masked Email Store Tests...
MASKED EMAIL STORE TESTS: 10 passed, 0 failed

Running Focused Inbox Store Tests...
FOCUSED INBOX STORE TESTS: 10 passed, 0 failed

Running Offline Store Tests...
OFFLINE STORE TESTS: 10 passed, 0 failed

Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 10 passed, 0 failed

Running Contacts Store Tests...
CONTACTS STORE TESTS: 10 passed, 0 failed

Running Sidebar Borderless Style Tests...
SIDEBAR BORDERLESS TESTS: 10 passed, 0 failed

Running Profile Photo Tests...
PROFILE PHOTO TESTS: 10 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 10 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 10 passed, 0 failed

Running Calendar RRULE Tests...
CALENDAR RRULE TESTS: 23 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 13 passed, 0 failed

Running Calendar ICS Tests...
CALENDAR ICS TESTS: 15 passed, 0 failed

Running Calendar Invitation Repository Tests...
CALENDAR INVITATION REPO TESTS: 10 passed, 0 failed

Running Calendar Persistence Security Tests...
  ✓ 1. calendar_event_repository does not contain plaintext insert/update SQL queries
  ✓ 2. Local decrypted cache events are never saved to persistent storage without envelope
  ✓ 3. Calendar exports (ICS) do not leak raw symmetric event keys or session tokens
  ✓ 4. Invitations sent to external attendees do not leak internal event symmetric keys
  ✓ 5. Updating an event generates a fresh IV and valid ciphertext
  ✓ 6. Deleting an event purges decrypted cache entry and marks status as cancelled
  ✓ 7. Invalid candidate wrapper fails decryption closed without corrupting stored events
  ✓ 8. Calendar ICS import sanitizes inputs, enforces length limits, and prevents script injection
  ✓ 9. External invitation parser safely handles malformed, truncated, or cyclic RRULEs
  ✓ 10. Multi-account calendar event cache maintains strict account isolation without being silently modified
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

CALENDAR REPO INTEGRATION TESTS: 5 passed, 0 failed

Running Historical Key Reactivation Tests...
Running Historical Key Reactivation & Preflight Tests...
  ✓ 1. Correct historical password and valid new password succeeds
  ✓ 2. Incorrect historical password fails closed before generating envelope
  ✓ 3. New password and confirmation mismatch is rejected before crypto operations
  ✓ 4. Invalid password-policy input is rejected
  ✓ 5. Candidate wrapper successfully unwraps to the original mailbox secret
  ✓ 6. Candidate wrapper unwrap mismatch is caught by constantTimeEqual
  ✓ 7. Malformed candidate envelope fails unwrap closed
  ✓ 8. Simulated reactivation controller does not dispatch API when preflight fails
  ✓ 9. Preflight preserves root_wrapped from historical JSON envelope
  ✓ 10. verifyReadBackCandidateEnvelope validates server-returned candidate with proposed password
  ✓ 11. verifyReadBackCandidateEnvelope rejects tampered or mismatched candidate secret
  ✓ 12. verifyReadBackCandidateEnvelope fails closed on empty or malformed read-back
HISTORICAL KEY REACTIVATION TESTS: 12 passed, 0 failed

Running Calendar Recurrence Exception Tests...
CALENDAR RECURRENCE EXCEPTION TESTS: 15 passed, 0 failed

Running Calendar Invitation External Tests...
CALENDAR INVITATION EXTERNAL TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 10 passed, 0 failed

Running Calendar Settings Tests...
CALENDAR SETTINGS TESTS: 10 passed, 0 failed

Running Calendar Management Tests...
CALENDAR MANAGEMENT TESTS: 10 passed, 0 failed

Running Calendar Holiday Tests...
CALENDAR HOLIDAYS TESTS: 5 passed, 0 failed

Running Calendar Year View Tests...
CALENDAR YEAR VIEW TESTS: 5 passed, 0 failed

Running Calendar Categories 01, 02, 03 Tests...
CALENDAR CATEGORIES 01, 02, 03 TESTS: 30 passed, 0 failed

Running Calendar Category 04 (Search and Filtering) Tests...
CALENDAR CATEGORY 04 TESTS: 9 passed, 0 failed

Running Calendar Category 05 (Reminders and Notifications) Tests...
CALENDAR CATEGORY 05 TESTS: 9 passed, 0 failed

Running Calendar Category 06 (Timezone and Internationalization) Tests...
CALENDAR CATEGORY 06 TESTS: 9 passed, 0 failed

Running Calendar Category 07 (Multi-Day and All-Day Events) Tests...
CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed

Running Calendar Category 08 (Event Categories and Tags) Tests...
CALENDAR CATEGORY 08 TESTS: 9 passed, 0 failed

Running Calendar Category 10 (Conflict Detection) Tests...
CALENDAR CATEGORY 10 TESTS: 9 passed, 0 failed

Running Calendar Category 11 (Task Integration and To-Do Sync) Tests...
CALENDAR CATEGORY 11 TESTS: 9 passed, 0 failed

Running Calendar Category 12 (Print and Export Views) Tests...
CALENDAR CATEGORY 12 TESTS: 9 passed, 0 failed

Running Calendar Category 13 (Drag-and-Drop and Quick Interactions) Tests...
CALENDAR CATEGORY 13 TESTS: 9 passed, 0 failed

Running Calendar Category 14 (URL Feeds and External Subscriptions) Tests...
CALENDAR CATEGORY 14 TESTS: 9 passed, 0 failed

Running Calendar Category 15 (Accessibility, Interface and Offline Experience) Tests...
Running Calendar Category 15 (Accessibility, Interface & Offline Experience) Tests...
  ✓ Cat 15.1: View density and display controls (compact vs comfortable, week numbers, weekends)
  ✓ Cat 15.2: Declined event visibility and strikethrough styling logic
  ✓ Cat 15.3: Offline event action queueing and safety invariant ('queued_locally')
  ✓ Cat 15.4: Offline decrypted event caching and retrieval
  ✓ Cat 15.5: Offline sync reconnection and conflict detection without silent overwrite
  ✓ Cat 15.6: Deleted-event trash lifecycle (30-day retention countdown, restore, permanent delete, empty)
  ✓ Cat 15.7: Transient undo action coordination alongside persistent trash
  ✓ Cat 15.8: Keyboard navigation and global shortcut map
  ✓ Cat 15.9: Screen-reader announcements (aria-live='polite') and accessibility attributes
CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed

Running Calendar Interval Scheduling & Layout Tests...
  ✓ 1. Empty input handling
  ✓ 2. Single event spans 100% width
  ✓ 3. Disjoint non-overlapping events independently span 100% width
  ✓ 4. Two overlapping events allocate 50/50 parallel non-colliding columns
  ✓ 5. Three concurrent events allocate 3 parallel columns with 0% collision
  ✓ 6. Greedy interval scheduling correctly packs sequential sub-intervals
  ✓ 7. Day View cleanly allocates 5 parallel non-overlapping lanes
  ✓ 8. Week View high-concurrency clusters cascade with >= 60% readable card width
  ✓ 9. getOpaqueEventBg computes 100% solid, fully-opaque surfaces
CALENDAR INTERVAL & LAYOUT TESTS: All 9 passed, 0 failed

Running Google Keep Notes Feature Tests...
  ✓ 1. Initial load provides welcome notes with checklists, labels, and reminders
  ✓ 2. Google Keep labels management (add, rename, delete all without restore bug) works reliably
  ✓ 3. createNote supports checklists, color styling, labels, and reminders
  ✓ 4. Archive and Unarchive note lifecycle functions correctly
  ✓ 5. Bin lifecycle (move to bin, restore, and empty bin) matches Google Keep
  ✓ 6. Duplicate note functionality works as expected
  ✓ 7. Verified all 8 approved Google Keep pastel color definitions
  ✓ 8. Version history snapshot and restoration round-trip functions correctly
  ✓ 9. Composer history undo/redo bounded indexing maintains valid array bounds
  ✓ 10. Zero-Knowledge AES-GCM encryption and decryption round-trip succeeds
  ✓ 11. Zero-Knowledge notes fail closed without key or with invalid key
  ✓ 12. Seamless backward compatibility for existing unencrypted legacy notes
  ✓ 13. Interoperable AES-GCM Web Crypto (crypto.subtle) and byos_crypto_core encryption
  ✓ 14. Selection-aware Markdown formatting (bold, italic, underline, list) and cursor positioning
  ✓ 15. IndexedDB offloading for drawings and photos prevents localStorage quota exhaustion
  ✓ 16. Edit note modal reminder adjustments and checklist mode toggling function correctly
  ✓ 17. Version history restoration retains IndexedDB media after drawing removal
  ✓ 18. Cascading media garbage collection prunes unreferenced items and preserves shared media
Cannot update locked encrypted note without decryption key
Cannot duplicate note: mailbox encryption key is unavailable
  ✓ 19. Locked encrypted notes fail closed on update and duplication attempts
  ✓ 20. Version history snapshot accurately preserves prior revisions on note edits
  ✓ 21. Media cache LRU bounds eviction caps memory usage at 150 items
Cannot create note: mailbox encryption key is unavailable
  ✓ 22. Missing mailbox key fails closed (cannot create or persist note in plaintext)
Cannot persist notes: mailbox encryption key is unavailable. Failing closed to prevent plaintext leakage.
  ✓ 23. Plaintext persistence fallback is completely eliminated
Cannot persist notes: mailbox encryption key is unavailable. Failing closed to prevent plaintext leakage.
  ✓ 24. Save failure fails closed without leaking unencrypted data to storage
  ✓ 25. Context-specific v2 AAD binds note ID and mailbox ID (byos-notes-v2:${mailboxId}:${noteId})
  ✓ 26. Cross-note ciphertext substitution within same mailbox fails closed via v2 AAD binding
  ✓ 27. Cross-mailbox ciphertext substitution fails closed via mailboxId AAD binding
  ✓ 28. Tampered ciphertext envelope fails closed and returns null
  ✓ 29. Backward compatibility: legacy v1 AAD encrypted note decrypts seamlessly
  ✓ 30. Legacy v1 AAD note upgrades to v2 context-bound AAD on next edit/save
  ✓ 31. Legacy plaintext note is preserved when key is unavailable (no premature migration)
  ✓ 32. Legacy plaintext note migrates to v2 AES-GCM when key is available with verified round-trip
  ✓ 33. Legacy plaintext note migration failure leaves original plaintext intact (safe rollback)
  ✓ 34. Account switching isolation: cross-account key decrypts fail closed
  ✓ 35. Session isolation & logout cleanup wipes notes in-memory key and media cache
GOOGLE NOTE FEATURE TESTS: All 35 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
  ✓ test_unlock_sets_session_storage: session storage correctly set
  ✓ test_reboot_restores_from_session_storage: state restored from session storage
  ✓ test_logout_clears_session_storage: session storage cleared on logout
  ✓ test_explicit_lock_clears_session_storage: session storage cleared on lock
  ✓ test_two_factor_auth_store_lifecycle: 2FA challenge and secret lifecycle
MAILBOX UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

Running Track 2 Security Verification Tests...
  ✓ Track 2.1: Key derivation produces distinct keys for distinct identities
  ✓ Track 2.2: Session zeroization scrubs sensitive keys from memory
  ✓ Track 2.3: Storage tampering detection rejects corrupted envelopes
  ✓ Track 2.4: Cross-account data isolation rejects foreign account reads
  ✓ Track 2.5: Ephemeral key generation ensures forward secrecy
TRACK 2 SECURITY TESTS: 5 passed, 0 failed

Running Calendar Track 3 Verification Tests...
CALENDAR TRACK 3 TESTS: 7 passed, 0 failed

Running Track 4: Webmail Reliability, Zero-Knowledge Media Encryption & Resilience Tests...
  ✓ Track 4.1: encryptNotesMedia & decryptNotesMedia perform authenticated AES-GCM roundtrip
[notesStore] WASM AES-GCM media decryption failed: decryption failed
[notesStore] WASM AES-GCM media decryption failed: decryption failed
  ✓ Track 4.2: decryptNotesMedia fails closed on wrong key or tampered ciphertext
  ✓ Track 4.3: saveMediaToIDB encrypts dataUrl in IndexedDB and redacts plaintext
  ✓ Track 4.4: getMediaFromIDB supports legacy unencrypted media fallback
  ✓ Track 4.5: offloadMediaIfDataUrl creates idb pointer and encrypts when key is provided
  ✓ Track 4.6: folderCounts correctly aggregates inbox, drafts, sent, trash, and snoozed
  ✓ Track 4.7: Bridge status transitions correctly based on health and credentials
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed

Running Off-Thread Crypto Web Worker & Bridge Tests...
  ✓ Worker bridge ping heartbeat succeeds over message channel
  ✓ Argon2id passphraseWrapKey & passphraseUnwrapKey roundtrip offloaded correctly
  ✓ autoUnwrapKeys derives mailboxSk, signingSeed, xwingSeed, and searchKey off-thread
  ✓ X-Wing hybrid envelope seal and open roundtrip via worker pipeline
  ✓ Multi-chunk AES-256-GCM attachment prepare and decrypt roundtrip
[Worker Crypto] Decryption failed for attachment_id=d56153e7-ae60-4bdc-ac48-59a5841d6b34 chunk_index=1
  ✓ Tampered attachment chunk is isolated and reports specific chunk index
  ✓ Worker rejects invalid operations and returns structured error
  ✓ Worker bridge enforces operation timeout and cleans pending request
[CryptoWorkerBridge] Worker error encountered: Out of memory simulated crash
  ✓ Worker error event triggers crash cleanup and rejects pending requests
  ✓ Transferable ArrayBuffer detaches buffer on message channel dispatch
  ✓ zeroizeBuffer wipes sensitive in-memory bytes to 0
  ✓ Dispatches multiple concurrent operations across the worker message channel without interference
  ✓ Direct execution fallback mode operates reliably when worker is disabled
OFF-THREAD CRYPTO WORKER TESTS: 12 passed, 0 failed

Running Subscriptions & Unsubscribe Store Tests...
Running Subscriptions Store & Unsubscribe Tests...
  ✓ 1. TestExtractCleanEmailAndDisplayName
  ✓ 2. TestExtractUnsubscribeLinkFromHeadersAndBody
  ✓ 3. TestUnsubscribeAndResubscribeLifecycle
  ✓ 4. TestDetectSubscriptionsAggregatesMessages
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed

Running Image Privacy Store Tests...
Running Image Privacy Store Tests...
  ✓ 1. TestExtractCleanEmailAddress
  ✓ 2. TestDefaultPolicyIsAsk
  ✓ 3. TestAlwaysAllowLifecycle
  ✓ 4. TestClearSenderPreference
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed

Running KashCal Natural Language Event Parser Tests...
  ✓ parses category keywords correctly
  ✓ parses 'Coffee with Sarah tomorrow 3pm'
  ✓ parses 'Design review Friday 10am 45m'
  ✓ parses time range 'Team standup 2pm-3:30pm'
  ✓ parses explicit date 'Dentist appointment Nov 12 at 2pm'
  ✓ parses all-day event 'Alice Birthday Nov 20 all-day'
KASHCAL PARSER TESTS: 6 passed, 0 failed

Running Translator & Localization Tests...
Running Translator & Localization Tests...
  ✓ detectLanguage identifies supported scripts and stop words
  ✓ getLanguageName maps language codes correctly
  ✓ translateEmail returns identical content when source and target match
  ✓ translateEmail preserves HTML tags, attributes, and structure
  ✓ translateEmail preserves casing in Latin scripts
  ✓ translateEmail translates CJK and Arabic to English without screaming all-caps
  ✓ translateEmail does not replace subwords like 'Othello' or 'shell'
  ✓ translateEmail prioritizes longer multi-word phrases over single words
  ✓ translateEmail roundtrip between English and Spanish
  ✓ translateEmail translates into French, German, and Hindi
  ✓ translateEmail translates full email paragraphs without leaving untranslated English words
  ✓ translateEmail translates corporate email into Chinese and Russian with zero residual English
  ✓ t helper returns correct localized UI strings across all supported locales
  ✓ t helper interpolates dynamic params accurately without affecting proper nouns
  ✓ t helper gracefully falls back to English and key itself for unknown keys
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed

Running Folder & Trash Lifecycle Tests...
Running Folder & Permanent Trash Lifecycle Tests...
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

OVERALL: 691 passed, 0 failed
```

---

## Manual Browser Verification

Command: `node tests/browser/test_notes_track1_zk_resilience.mjs`

Pasted terminal output:
```
================================================================================
   TRACK 1: NOTES ZERO-KNOWLEDGE ENCRYPTION & QUOTA RESILIENCE VERIFICATION   
================================================================================

--- [STEP 1] Login as alice@byos.local ---
  Logged into Webmail successfully.

--- [STEP 2] Navigate to Notes Module ---
  Navigated to Notes module.

--- [STEP 3] Test Selection-Aware Markdown Formatting in Composer ---
  Formatting bar is visible.
  Formatted textarea value: "Design notes for **Zero-Knowledge Webmail**."
  PASS: Selection bold formatting matched expected output (got 'Design notes for **Zero-Knowledge Webmail**.')

--- [STEP 4] Test IndexedDB Media Resilience with Drawing ---
  PASS: Drawing thumbnail displayed in composer

--- [STEP 5] Verify Zero-Knowledge AES-GCM Encryption in localStorage ---
  Storage key found: byos_notes_c0000000-0000-0000-0000-000000000001
  PASS: Encrypted note record exists in localStorage
  PASS: Note has non-empty encryptedPayload hex string
  PASS: encryptedPayload has sufficient ciphertext length
  PASS: Raw stored note title is completely redacted to empty string
  PASS: Raw stored note content is completely redacted to empty string
  PASS: Plaintext title 'ZK Confidential Architecture' NEVER leaked to localStorage JSON
  PASS: Plaintext content NEVER leaked to localStorage JSON
  Stored drawing ref in localStorage: idb:drawing_1794133510619_gz9kb
  PASS: Drawing is stored as IndexedDB pointer 'idb:drawing_1794133510619_gz9kb', NOT as raw base64 data
  PASS: Raw base64 data URL does NOT leak into localStorage, preventing QuotaExceededError

--- [STEP 6] Verify IndexedDB Media Persistence & Client-Side Encryption ---
  PASS: Drawing media is persisted securely in IndexedDB without plaintext exposure

--- [STEP 7] Verify Seamless Decryption in UI ---
  PASS: Decrypted note title is seamlessly rendered in NotesView grid
  Saved screenshot: notes_zk_encrypted_card.png

--- [STEP 8] Test Edit Note Modal Parity (Reminders & Checklist Toggle) ---
  Edit note modal opened.
  PASS: Reminder chip successfully added and displayed in edit note modal
  Checklist items count in edit modal: 1
  PASS: Checklist mode toggled and items rendered in edit modal
  Saved screenshot: notes_edit_modal_reminder_checklist.png
  Edit note modal saved and closed.
  PASS: Zero fatal uncaught page errors (got 0)

================================================================================
   ALL TRACK 1 ZK ENCRYPTION & RESILIENCE AUDITS PASSED SUCCESSFULLY!          
================================================================================
```

Screenshots saved to repository:
- `tests/browser/artifacts/notes_zk_encrypted_card.png`
- `tests/browser/artifacts/notes_edit_modal_reminder_checklist.png`

---

## What Did Not Work or Is Untested

- **Remote Cloud Sync:** UNTESTED. Per product roadmap and safety boundaries, remote customer-owned cloud synchronization (S3, MinIO, Google Drive) is deferred to Phase 2. Notes currently persist strictly within authenticated client storage (`localStorage` encrypted envelopes and IndexedDB encrypted media blobs).
- **Active Push Notifications for Reminders:** UNTESTED. Reminder timestamps function as local target dates and references; background service-worker push notifications are not yet activated.
- **Multi-User Collaboration:** UNTESTED. Multi-user sharing is not supported by design in this phase; collaborator entries are displayed as local attribution tags.

---

## Test Suite Output

### Webmail NPM Test Suite Output
Command: `cmd /c "cd apps\webmail && npm.cmd test"`
Status: Exited with code 0.
Summary: 691 passed, 0 failed.

### Go API Backend Test Output
Command: `cmd /c "cd services\api && go test -v -run TestMoveDraftToTrashAndRestore"`
Status: Exited with code 0.
Pasted output:
```
=== RUN   TestMoveDraftToTrashAndRestore
    folder_lifecycle_test.go:78: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestMoveDraftToTrashAndRestore (0.00s)
PASS
ok  	byos.email/services/api	0.675s
```

---

## 9. Remaining Risks & Limitations

1. **Local Storage Capacity for Notes Index:** While media blobs (drawings, photos) are offloaded to IndexedDB, note text envelopes still reside in `localStorage`. Extremely large numbers of notes (>10,000) may approach browser storage quotas. Phase 2 should migrate note envelopes into an IndexedDB backing store.
2. **Device-Local Scoping:** Because Phase 1 deliberately scopes out remote backend endpoints, notes created on Device A do not sync to Device B until Phase 2 customer-storage encrypted replication is implemented.
3. **Session Cleared on Manual Browser Data Wipe:** If a user clears site data via browser settings without exporting, notes in `localStorage` and `IndexedDB` will be erased.

---

## 10. Recommended Next Development Step (Phase 2)

We recommend proceeding to **Phase 2: Customer-Owned Storage Encrypted Synchronization**:
1. Implement client-side chunked serialization of note envelopes into Section 12-compliant encrypted envelopes.
2. Integrate with customer-owned storage worker (`services/storage-worker`) using opaque object namespace keys (`notes/<mailbox_uuid>/<note_uuid>.enc`).
3. Implement optimistic conflict resolution using vector clocks or monotonic timestamps on note versions.
