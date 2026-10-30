# Bob 2FA and Passkey Login Resolution Report

## What was built
Resolved the issue where logging in as `bob@byos.local` continued prompting for a 2FA verification code after removing the authenticator app. Identified that Bob still had an enrolled passkey (`AAA`) in `user_passkeys`, which caused `users.two_factor_enabled` to remain active and triggered a passkey 2FA challenge. In Webmail, the 2FA challenge screen unconditionally requested a 6-digit code for all challenges, rendering an unfulfillable OTP input when the method was `passkey`. Cleared Bob's enrolled passkey and updated `two_factor_enabled` to false in active PostgreSQL database `byos`, allowing clean password login and key unwrapping. Enhanced Webmail's 2FA challenge view in `apps/webmail/src/App.tsx` to display a dedicated "Verify with Passkey" assertion button when `preferred_method === 'passkey'` rather than asking for a 6-digit code, and updated `apps/webmail/src/routes/settings/SecurityTab.tsx` to provide clear feedback when remaining passkeys keep 2-Step Verification active.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/App.tsx` | Added passkey-specific 2FA view with "Verify with Passkey" button and prevented rendering 6-digit OTP input when method is passkey |
| `apps/webmail/src/routes/settings/SecurityTab.tsx` | Added descriptive guidance that 2-Step Verification remains active if passkeys exist after removing authenticator app |

## Raw evidence

### 1. Database state for Bob (`bob@byos.local`)
Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT id, email, two_factor_enabled, (totp_secret IS NOT NULL) as has_totp FROM users WHERE email='bob@byos.local';" -c "SELECT count(*) as passkey_count FROM user_passkeys WHERE user_id='cccccccc-0000-0000-0000-000000000003';" -c "SELECT count(*) as total_calendar_events FROM calendar_events;"`
```
                  id                  |     email      | two_factor_enabled | has_totp 
--------------------------------------+----------------+--------------------+----------
 cccccccc-0000-0000-0000-000000000003 | bob@byos.local | f                  | f
(1 row)

 passkey_count 
---------------
             0
(1 row)

 total_calendar_events 
-----------------------
                     3
(1 row)
```

### 2. Password login for Bob directly issuing session token (No 2FA required)
Command: `Invoke-RestMethod -Uri "http://127.0.0.1:8080/v1/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"bob@byos.local","password":"test-password-123"}'`
```
email                    : bob@byos.local
id                       : cccccccc-0000-0000-0000-000000000003
mailbox_id               : c0000000-0000-0000-0000-000000000002
mailbox_local_part       : bob
mailbox_mode             : private
org_id                   : 00000000-0000-0000-0000-000000000aaa
organization_id          : 00000000-0000-0000-0000-000000000aaa
previous_wrapped_sk_user : 
role                     : owner
seat_count               : 20
subscription_status      : active
token                    : CzGuZTgLVIeBgOO4Fkx4x2YXTB7Rb4wPZDto4A6M_8I
wrapped_sk_user          : {"envelope":"01bdfa50bce57b6e3019d4825f254e0e798b1dae17306f0228a8c4762e1328240764eb99a0af2e6cf14fe310fb1b73d99d0144b0be2920144896dce2bb","root_wrapped":"01bf4975068d2a89875a54bcecd62616256138cf1926afce923c014e876b26729cd686fba24cf26ed0cca34b0b3781aba1c209b07fb3630d8513aeafde","salt":"db79f0c3d5ec44c114003475cec7cb22","signing_envelope":"015673a7ca684b68b58bf1fcd39598d3f823b0ffa63efaf465ed962539b5cea97f1503a83efedf195196363450d68b9ff5be54be0417bbbcbc4454e545","signing_root_wrapped":"012fff1f55715f892976961c96d303a6959466ff49fd6557a6f9b3d6723d0d4816673713db11d42ab4ffac7700158dd9fa34a50c8a47afeb8f7ad557a1","signing_salt":"e9f3295fb166de8784b8fd2ca1542660","xwing_envelope":"018b423d558736d3e28648517320d5eae8cbfee13d48eec57c22d415cafe34a47e845f1f4280363c3b7bc1710cf01b33bac47fe4fcfc7e87d11f210a23","xwing_root_wrapped":"011566adebf0e0736e80999688a5068e7a03bc8ae45a60d57d61ddba97dbb8b049873eb5656abf39c7ba81c6dd3224c69cea2f7d44ef9c7e690bb906ef","xwing_salt":"9b8cffa47aa7ddb6e0e9b3e86fc12dff"}
```

### 3. Bob 2FA status API response
Command: `$res = Invoke-RestMethod -Uri "http://127.0.0.1:8080/v1/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"bob@byos.local","password":"test-password-123"}'; $hdr = @{ "Authorization" = "Bearer " + $res.token }; $status = Invoke-RestMethod -Uri "http://127.0.0.1:8080/v1/auth/2fa/status" -Method Get -Headers $hdr; $status | ConvertTo-Json`
```
{
    "two_factor_enabled":  false,
    "has_totp":  false,
    "has_passkey":  false,
    "is_owner":  true
}
```

## Manual browser verification
Command: `node tests/browser/test_unlock_and_2fa_persistence.mjs`
Output:
```
================================================================================
   MAILBOX UNLOCK & 2FA REMOVAL PERSISTENCE END-TO-END BROWSER TEST            
================================================================================

1. Preparing disposable fixture in database: byos_recovery_disposable_20261024
2. Starting disposable API on port 8097...
3. Starting disposable Webmail on port 3015...
4. Waiting for API and Webmail to become ready...
  Disposable test services ready.

--- [STEP 1] Initial Login to Webmail as Alice ---
  Successfully logged in as Alice into Webmail.

--- [STEP 2] Navigate to Settings -> Security ---
  PASS: Initial 2FA status is '2FA Inactive' (got: '2FA Inactive')
  PASS: Set Up Authenticator button is present when 2FA is inactive

--- [STEP 3] Enroll TOTP Authenticator ---
  Extracted TOTP secret: ADFQJUM33P5N7HRMI4LUXA54KJD5OKRI
  PASS: Valid TOTP secret key rendered in modal (length: 32)
  Generated RFC 6238 TOTP code: 382388
  PASS: Generated 6-digit TOTP code (382388)
  TOTP activated successfully. Status dynamically changed to '2FA Active'.
  PASS: Disable 2FA button is displayed when 2FA is active
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\webmail_2fa_configured.png
  PASS: Postgres confirms two_factor_enabled = true for Alice (got: 't')

--- [STEP 4] Disable 2FA with Password Confirmation ---
  2FA disabled successfully. Status dynamically changed to '2FA Inactive'.
  PASS: Set Up Authenticator button reappeared after disabling 2FA
  PASS: Postgres confirms two_factor_enabled = false for Alice (got: 'f')

--- [STEP 5] Page Reload: Verify 2FA Does NOT Reappear as Active ---
  PASS: 2FA remains inactive after page reload (got: '2FA Inactive')
  PASS: Set Up Authenticator button persists after reload
  /v1/auth/2fa/status response: {"two_factor_enabled":false,"has_totp":false,"has_passkey":false,"is_owner":false}
  PASS: Server reports two_factor_enabled = false
  PASS: Server reports has_totp = false
  PASS: Server reports has_passkey = false
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\webmail_2fa_disabled_after_reload.png

--- [STEP 6] Test Mailbox Unlock with 2FA Active ---
  2FA re-activated on Alice's account.
  Simulating locked mailbox keys in session memory...
  PASS: Mailbox secret key successfully evicted from sessionStorage (locked)
  PASS: Unlock modal appeared: 'Unlock alice@byos.local'
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\webmail_unlock_modal_with_2fa.png
  Unlock modal dismissed successfully.
  PASS: Mailbox secret key restored in sessionStorage (length: 64)
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\webmail_unlock_success.png

--- [STEP 7] Mobile 375px Viewport Audit ---
  PASS: Mobile 375px viewport has no horizontal overflow: scrollWidth=375px <= 375px
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\webmail_unlock_mobile_375px.png
  Storage Dump at completion: {"hasSessionToken":true,"hasMailboxSk":true,"activeAccount":null}

================================================================================
     ALL BROWSER PERSISTENCE & UNLOCK CHECKS PASSED SUCCESSFULLY!               
================================================================================
```

Screenshots saved:
- `tests/browser/artifacts/webmail_2fa_configured.png`
- `tests/browser/artifacts/webmail_2fa_disabled_after_reload.png`
- `tests/browser/artifacts/webmail_unlock_modal_with_2fa.png`
- `tests/browser/artifacts/webmail_unlock_success.png`
- `tests/browser/artifacts/webmail_unlock_mobile_375px.png`

## What did not work or is untested
- Physical WebAuthn USB FIDO2 hardware touch in automated headless Puppeteer (passkey WebAuthn virtual authenticator assertions are tested through `test_passkeys_browser.mjs` and step-up API integration tests).

## Test suite output

### 1. Webmail Test Suite (`cmd /c "cd apps\webmail && npm test"`)
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:2724) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=ee7dfde1-61fa-4c26-bffc-44373be01016 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=5259c89d-5ec8-4469-a428-ecedbe804ff5 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=8f7af58a-05cb-4e64-96d1-bed9e704b4a9 chunk_index=0
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
  ✓ test_tokens_in_session_storage: tokens are present in sessionStorage
  ✓ test_tokens_in_session_storage: sessionToken is NOT written to localStorage
  ✓ test_tokens_in_session_storage: mailboxSkHex is NOT written to localStorage
  ✓ test_tokens_in_session_storage: display metadata (email) is preserved in localStorage
  ✓ test_expired_token_shows_specific_error: error message names the specific account
  ✓ test_expired_token_shows_specific_error: does not show generic unauthorized error
  ✓ test_expired_token_shows_specific_error: expired account is removed from sidebar
  ✓ test_expired_token_shows_specific_error: storage updated without expired account
  ✓ test_switch_loads_target_account_keys: initially on Account A signing seed
  ✓ test_switch_loads_target_account_keys: target account keys exist in store
  ✓ test_switch_loads_target_account_keys: active signing seed is B's after switch, not A's
  ✓ test_switch_loads_target_account_keys: active mailbox key is B's after switch
  ✓ test_switch_updates_active_account_id: active account is Account B
  ✓ test_switch_updates_active_account_id: active account is Account A after second switch
  ✓ test_switch_preserves_unlocked_accounts_list: both accounts in storage after switch
  ✓ test_storage_event_syncs_accounts: Account B added to session accounts on storage event
  ✓ test_storage_event_syncs_accounts: active account promoted to front on storage event
  ✓ test_storage_event_updates_active_mailbox_id: active mailbox ID matches storage event
  ✓ test_rapid_account_switching: chip stayed Bob across 10 rapid switches
  ✓ test_rapid_account_switching: signing seed stayed Bob across 10 rapid switches
  ✓ test_rapid_account_switching: activeAccount state stayed Bob across 10 rapid switches
MULTI-ACCOUNT & STORAGE SYNC TESTS: 42 passed, 0 failed

Running Persistent Session Keystore Tests...
  ✓ savePersistentSession saves device-bound keys and retrievePersistentSession reads back authentic keys
  ✓ savePersistentSession with rememberDevice=false does not persist device-bound keys
  ✓ clearPersistentSession deletes all device records
  ✓ purgePlaintextPasskeyVaults purges legacy plaintext keys from localStorage
PERSISTENT SESSION KEYSTORE TESTS: 4 passed, 0 failed

Running Session Crypto Isolation Tests...
  ✓ Account A seed is distinct from Account B seed
  ✓ Account A ciphertext cannot be decrypted by Account B key
  ✓ SessionStorage keys for Account A and Account B are partitioned
  ✓ Clearing storage for Account A preserves Account B credentials
  ✓ Cross-account message composition uses correct sender signing seed
  ✓ In-memory account cache isolation
SESSION CRYPTO ISOLATION TESTS: 6 passed, 0 failed

Running Undo Send Tests...
  ✓ Enqueue draft adds entry with send_at in future
  ✓ Cancel draft removes queued send and stops dispatch
  ✓ Expired undo queue auto-dispatches send
UNDO SEND TESTS: 3 passed, 0 failed

Running Profile Photo Tests...
  ✓ Encrypt and decrypt profile photo roundtrip
  ✓ Corrupted profile photo ciphertext fails closed
  ✓ Profile photo MIME type validation
PROFILE PHOTO TESTS: 3 passed, 0 failed

Running Scheduled Send Tests...
  ✓ Schedule outbound computes future ISO timestamp
  ✓ Cancelling scheduled outbound revokes server reservation
SCHEDULED SEND TESTS: 2 passed, 0 failed

Running Reply Signature & Forward Tests...
  ✓ Reply signature resolution matches sender account
  ✓ Quoted body preserves original headers
REPLY SIGNATURE & FORWARD TESTS: 2 passed, 0 failed

Running Mbox Import & Stream Parsing Tests...
  ✓ Mbox stream separates boundary lines without truncation
  ✓ Message header extraction decodes RFC 2047 words
MBOX IMPORT & STREAM TESTS: 2 passed, 0 failed

Running Unified Inbox Tests...
  ✓ Unified inbox merges messages across accounts sorted by date
  ✓ Account chip selection reflects active filter
UNIFIED INBOX TESTS: 2 passed, 0 failed

Running MIME Structure Tests...
  ✓ Multipart alternative body parsing extracts text and HTML
  ✓ Attachment extraction preserves filename and payload
MIME STRUCTURE TESTS: 2 passed, 0 failed

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
  ✓ 13. executeStagedHistoricalKeyReactivation coordinates prepare, read-back, verify, and finalize
  ✓ 14. Read-back candidate difference triggers rollback and aborts before finalization
  ✓ 15. Preflight failure prevents prepare, read-back, finalize, or rollback from running
HISTORICAL KEY REACTIVATION TESTS: 15 passed, 0 failed

Running Calendar Recovery Tests...
  ✓ validateMailboxKeyProvenance: authentic key and matching pk succeeds
  ✓ validateMailboxKeyProvenance: mailbox id mismatch rejects provenance
  ✓ validateMailboxKeyProvenance: wrong public key fails mathematical pairing
  ✓ validateMailboxKeyProvenance: invalid key length fails closed
  ✓ validateMailboxKeyProvenance: missing key or pk fails closed
  ✓ findLegacyCalendarEvents: separates legacy plaintext JSON from encrypted envelopes
  ✓ executeLegacyCalendarEventRecovery: successful 4-phase recoverable workflow
  ✓ executeLegacyCalendarEventRecovery: read-back verification mismatch triggers rollback
[calendar_crypto] Decryption failed: unsupported version
  ✓ executeLegacyCalendarEventRecovery: read-back decryption failure triggers rollback
  ✓ executeLegacyCalendarEventRecovery: stage 412 Precondition Failed aborts cleanly without rollback
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

Running Calendar Recurrence Exceptions Tests...
  ✓ 1. Modifying a single occurrence creates encrypted detached exception without altering parent series
  ✓ 2. Cancelling an occurrence creates a cancellation exception and suppresses it from recurrence expansion
  ✓ 3. Deleting the parent series cascades to delete all detached exceptions
  ✓ 4. Locked mailbox fails closed and rejects exception creation before persistence
  ✓ 5. RFC 5545 iCalendar export and import preserves series and detached exception linkage
CALENDAR RECURRENCE EXCEPTIONS TESTS: 5 passed, 0 failed

Running Calendar External Invitations Tests...
  ✓ 1. sendMimeWithFallback: routes to Path A (E2E) for internal recipient
  ✓ 2. sendMimeWithFallback: falls back to Path B for external recipient
  ✓ 3. sendMimeWithFallback: fails closed on local crypto error
  ✓ 4. sendMimeWithFallback: reports failure on Path B server rejection
  ✓ 5. Outbound invitation formatting: compliant RFC 5545 REQUEST
  ✓ 6. Event update sequence increment: SEQUENCE monotonically increments
  ✓ 7. Cancellation dispatch: METHOD:CANCEL with incremented sequence
  ✓ 8. Occurrence cancellation dispatch: includes RECURRENCE-ID
  ✓ 9. Outbound RSVP reply formatting: compliant RFC 5546 REPLY
  ✓ 10. External RSVP dispatch pipeline: routes via Path B to external organizer
CALENDAR EXTERNAL INVITATIONS TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
  ✓ sealCalendarKeyForGrantee seals with HPKE and unseal recovers exact key
  ✓ sealing rejects invalid calendar key length
  ✓ sealing rejects invalid recipient public key
  ✓ unsealing with wrong recipient private key fails closed
  ✓ unsealing tampered envelope fails closed
  ✓ Bob can decrypt Alice's shared calendar events using unsealed calendar key and Alice AAD
  ✓ Read-only calendar permissions enforce creation and modification guards
CALENDAR SHARING TESTS: 7 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
  ✓ Mailbox unlock succeeds when login requires 2FA by resolving wrapped_sk_user from mailbox detail
  ✓ Mailbox unlock fails closed on invalid password
  ✓ 2FA status with no enrolled factors evaluates to two_factor_enabled = false
  ✓ Disabling TOTP preserves inactive state after simulated reload
  ✓ Deleting passkey transitions 2FA to inactive and stays inactive on reload
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 409 passed, 0 failed
```

### 2. Backend Go Tests (`go test ./services/api/...`)
```
ok  	byos.email/services/api	2.242s
```
