# Alice Mailbox Historical Key Reactivation and Unlock Mails Report

## What was built
Resolved an issue in the Webmail interface where attempting to open an end-to-end encrypted post-quantum Path A message (HPKE-XWing-AES256GCM-v1) after an account password reset displayed a raw unhandled error string (`Failed to open message: Failed to decrypt end-to-end message: key unwrap: Mailbox alice@byos.local X-Wing private key is locked. Unlock alice@byos.local to read this message.`). Updated `<ReadingPane />` to suppress raw decryption failures and present a user-facing locked placeholder card with an action button labeled "Unlock mails". Updated the unlock modal dialog in `App.tsx` to solicit the user's 24-word recovery phrase or old password alongside the current account password, integrated client-side unsealing of secondary X-Wing and Ed25519 seed material in `historical_key_reactivation.ts`, executed staged historical key reactivation via API, restored cryptographic keys directly to session storage, and automatically decrypted the selected message upon submission.

## Files edited
| File | Reason |
|------|--------|
| apps/webmail/src/components/ReadingPane.tsx | Added isMessageLocked evaluator to suppress raw decryption errors and render dedicated Unlock mails button and historical messages copy |
| apps/webmail/src/historical_key_reactivation.ts | Enhanced executeHistoricalKeyPreflight to unseal and re-wrap X-Wing and Ed25519 secondary seeds into the 9-field cryptographic wrapper |
| apps/webmail/src/App.tsx | Added unlockSecretInput state, updated unlock modal inputs for 24-word recovery phrase or old password, and integrated staged reactivation with auto-decryption retry |
| apps/webmail/src/routes/settings/SecurityTab.tsx | Enforced pre-flight check preventing password changes from stripping quantum keys when not present in memory |
| tests/browser/test_alice_xwing_resolution.mjs | Created end-to-end browser verification asserting Unlock mails button, modal inputs, staged key reactivation, and plaintext message decryption |

## Raw evidence
Verification of candidate envelope 9-field generation with secondary post-quantum seeds in historical key preflight:
```
npx.cmd tsx --experimental-wasm-modules scratch/test_preflight_alice.mjs
(node:13672) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Preflight succeeded!
unwrappedSk length: 32
unwrappedXWingSeed length: 32
unwrappedSigningSeed length: 32
Candidate fields: [
  'salt',
  'envelope',
  'root_wrapped',
  'signing_root_wrapped',
  'xwing_root_wrapped',
  'signing_salt',
  'signing_envelope',
  'xwing_salt',
  'xwing_envelope'
]
```

Database state of Alice's mailbox showing presence of previous historical wrapper:
```sql
SELECT id, local_part, (previous_wrapped_sk_user IS NOT NULL) AS has_prev, (wrapped_sk_user IS NOT NULL) AS has_curr FROM mailboxes WHERE id = 'c0000000-0000-0000-0000-000000000001';
                  id                  | local_part | has_prev | has_curr 
--------------------------------------+------------+----------+----------
 c0000000-0000-0000-0000-000000000001 | alice      | t        | t
(1 row)
```

## Manual browser verification
Ran automated headless browser execution in Google Chrome:
1. Navigated to Webmail and logged in as `alice@byos.local` with current password `test-password-123`.
2. Checked `byos_xwing_seed_c0000000-0000-0000-0000-000000000001` in `sessionStorage` was `null`, reflecting pending historical reactivation.
3. Clicked Path A message `217595a7-afb2-4e90-b502-7b39da36cb58` from `charlie@byos.local`. Observed `<ReadingPane />` suppressed raw error text and displayed the placeholder card with prompt "Historical Messages Locked: Unlock alice@byos.local to read this message." and action button "Unlock mails".
   Screenshot saved: `tests/browser/artifacts/alice_mailbox_locked_prompt.png`
4. Clicked "Unlock mails" button. Observed modal opened displaying inputs for "24-Word Recovery Phrase or Old Password" (`data-testid="unlock-mails-secret-input"`), "Current Account Password" (`data-testid="unlock-account-password-input"`), and submit button "Unlock Mails".
5. Entered `test-password-123` in both fields and clicked "Unlock Mails". Observed staged historical key reactivation execute, restoring `byos_xwing_seed_...` to `sessionStorage` and automatically decrypting the message body to display "Greetings Alice! Third mailbox send from Charlie.".
   Screenshot saved: `tests/browser/artifacts/alice_mailbox_message_decrypted.png`
   Screenshot saved: `tests/browser/artifacts/alice_mailbox_unlocked_and_recovered.png`

Execution output:
```
node tests/browser/test_alice_xwing_resolution.mjs
================================================================================
    ALICE X-WING & HISTORICAL MESSAGES UNLOCK BROWSER VERIFICATION              
================================================================================


--- [STEP 1] Navigate to Webmail & Clear Storage ---

--- [STEP 2] Log in as alice@byos.local ---
  Active account: "alice@byos.local"
  PASS: Active account is alice@byos.local

--- [STEP 3] Verify Historical Locked State upon Login ---
  Initial sessionStorage byos_xwing_seed_c0000000-0000-0000-0000-000000000001: null
  PASS: X-Wing seed is initially locked in sessionStorage pending reactivation

--- [STEP 4] Open Path A Message & Verify 'Unlock mails' Button ---
  Clicking message 217595a7-afb2-4e90-b502-7b39da36cb58 (from charlie@byos.local)...
  Reading pane text length: 367
  Reading pane preview: Back (Encrypted message) C charlie@byos.local <charlie@byos.local> to alice@byos.local 08:34 PM Historical Messages Locked: Unlock alice@byos.local to read this message. Your account password was re
  PASS: Reading pane does NOT contain 'Failed to decrypt end-to-end message'
  PASS: Reading pane does NOT contain raw error 'X-Wing private key is locked'
  Locked account message: "Historical Messages Locked: Unlock alice@byos.local to read this message."
  PASS: Locked placeholder indicates 'Unlock alice@byos.local to read this message.'
  Unlock button text: "Unlock mails"
  PASS: Reading section button has text 'Unlock mails'
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alice_mailbox_locked_prompt.png
  PASS: Screenshot alice_mailbox_locked_prompt.png was successfully written

--- [STEP 5] Open Popup Modal & Verify Fields for 24-Word Phrase / Old Password ---
  PASS: Popup modal contains 24-word recovery phrase or old password input
  PASS: Popup modal contains current password input
  Popup submit button text: "Unlock Mails"
  PASS: Popup modal submit button has text 'Unlock Mails'

--- [STEP 6] Submit Historical Recovery Secret & Verify Auto-Decryption ---
  Restored seed in sessionStorage: ea01f553ee1988202f1c41f1d3d478afdf7ef0cddf611a28d2e3c2c3af42b13a
  PASS: X-Wing seed was successfully restored to sessionStorage after unlock
  After unlock reading pane preview: Back From Charlie to Alice 1792938842871 C charlie@byos.local <charlie@byos.local> ✓ Verified sender to alice@byos.local 08:34 PM Greetings Alice! Third mailbox send from Charlie. Reply Forward
  PASS: Locked placeholder is removed after unlock
  PASS: Message decrypted cleanly without decryption errors
  PASS: Plaintext message body from Charlie rendered successfully
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alice_mailbox_message_decrypted.png
  PASS: Screenshot alice_mailbox_message_decrypted.png was successfully written
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alice_mailbox_unlocked_and_recovered.png
  PASS: Screenshot alice_mailbox_unlocked_and_recovered.png was successfully written

--- [STEP 7] Final Error Integrity Verification ---
  Fatal uncaught page errors: 0
  PASS: Zero fatal uncaught errors during the entire session

================================================================================
       ALICE X-WING & HISTORICAL MESSAGES UNLOCK VERIFIED SUCCESSFULLY          
================================================================================
```

Account switch crypto integration test execution output:
```
node tests/browser/test_account_switch_crypto.mjs
================================================================================
     ACCOUNT SWITCH CRYPTO INTEGRATION TEST (RULES 1 - 6 & MANUAL CHECKS)       
================================================================================
  PASS: Initial active account is alice@byos.local
  PASS: Send network request dispatched for bob@byos.local
  PASS: Send response HTTP status is 201 (received 201)
  PASS: Chip text successfully changed to bob@byos.local
  PASS: Send network request dispatched for alice@byos.local
  PASS: Send response HTTP status is 201 (received 201)
  PASS: Reading pane does NOT contain 'content decrypt: decryption failed'
  PASS: Reading pane does NOT contain 'Failed to decrypt end-to-end message'
  PASS: Plaintext message body rendered successfully for Bob
  PASS: Chip text successfully restored to alice@byos.local
  PASS: Reading pane does NOT contain 'content decrypt: decryption failed'
  PASS: Reading pane does NOT contain 'Failed to decrypt end-to-end message'
  PASS: Plaintext message body rendered successfully for Alice
  PASS: Chip text successfully changed to charlie@byos.local
  PASS: Send network request dispatched for alice@byos.local
  PASS: Send response HTTP status is 201 (received 201)
  PASS: Active account remains alice@byos.local
  PASS: Bob signing seed removed on signout
  PASS: Bob mailbox key removed on signout
  PASS: Alice signing seed remains intact
  PASS: Zero send requests failed with HTTP 400 or invalid_signature
  PASS: Zero fatal crypto errors in console logs

================================================================================
            ALL ACCOUNT SWITCH CRYPTO CHECKS FINISHED SUCCESSFULLY              
================================================================================
```

## What did not work or is untested
- Hardware token WebAuthn biometric prompts are simulated in headless Chrome automation.
- Historical messages encrypted under discarded ephemeral keys from earlier development sessions display a missing key notice as expected.

## Test suite output
Webmail test suite:
```
npm.cmd --prefix apps/webmail test

> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:1964) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI ACCOUNT TESTS: 48 passed, 0 failed

Running Key Publication Tests...
KEY PUBLICATION TESTS: 2 passed, 0 failed

Running Inbound MIME Parse & Verify Tests...
INBOUND MIME PARSE & VERIFY TESTS: 24 passed, 0 failed

Running Reading Pane A11y & Navigation Tests...
READING PANE A11Y & NAVIGATION TESTS: 14 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 17 passed, 0 failed

Running Calendar ICS Tests...
CALENDAR ICS TESTS: 25 passed, 0 failed

Running Calendar RRULE Tests...
CALENDAR RRULE TESTS: 20 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 10 passed, 0 failed

Running Calendar Invitation Repository Tests...
CALENDAR INVITATION REPOSITORY TESTS: 8 passed, 0 failed

Running Calendar Persistence Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 8 passed, 0 failed

Running Historical Key Reactivation & Preflight Tests...
HISTORICAL KEY REACTIVATION TESTS: 15 passed, 0 failed

Running Calendar Recovery Tests...
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

Running Calendar Recurrence Exceptions Tests...
CALENDAR RECURRENCE EXCEPTIONS TESTS: 5 passed, 0 failed

Running Calendar External Invitations Tests...
CALENDAR EXTERNAL INVITATIONS TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 7 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 409 passed, 0 failed
```

Services API test suite:
```
powershell -Command "Set-Location services/api; go test -count=1 ./..."
ok  	byos.email/services/api	2.191s
```
