# Missing Test Tooling Installation Report

## What was built
Installed and configured the missing end-to-end testing harnesses across frontend, backend, and cryptographic core layers:
1. **Frontend (`apps/webmail`)**: Configured Vitest 5.0 with `@solidjs/testing-library`, `happy-dom`, and `@testing-library/jest-dom`, creating `vitest.config.ts`, updating `package.json` scripts (`test:vitest`, `test:watch`, `test:legacy`), and implementing reactive DOM unit verification in `src/components/ErrorBoundary.test.tsx`.
2. **Backend (`services/api`)**: Integrated `github.com/stretchr/testify`, built an in-process SQL query counter interceptor (`StartQueryCounter`) hooking Go `*sql.DB` connection drivers in `query_counter_test.go`, and added `TestAttachmentQueryCount` in `attachments_test.go` to enforce single set-based batch operations and prevent N+1 regressions.
3. **Crypto Core (`packages/crypto-core`)**: Added a containerized `test-crypto` target to both `Makefile` and `make.bat` utilizing `rustlang/rust:nightly-slim` to execute the 7 integration test suites and unit tests without requiring host cargo/rust dependencies.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/package.json` | Installed `vitest`, `@solidjs/testing-library`, `happy-dom`, `@testing-library/jest-dom`; added `test:vitest`, `test:watch`, and `test:legacy` scripts |
| `apps/webmail/package-lock.json` | Updated package-lock with frontend testing dependencies |
| `apps/webmail/vitest.config.ts` | Configured Vitest runner with `vite-plugin-solid`, `vite-plugin-wasm`, and `happy-dom` environment |
| `apps/webmail/src/components/ErrorBoundary.test.tsx` | Implemented reactive SolidJS DOM tests for `<AppErrorBoundary>` verifying mounting, fallback UI, error capture, and reset handling |
| `services/api/go.mod` | Added `github.com/stretchr/testify` dependency |
| `services/api/go.sum` | Checksum records for testify dependency and indirect packages |
| `services/api/query_counter_test.go` | Implemented `QueryCounter` interface and `StartQueryCounter(t, db)` driver connection wrapper |
| `services/api/attachments_test.go` | Added `TestAttachmentQueryCount` asserting <= 3 queries on batch linking 10 attachments |
| `Makefile` | Added `test-crypto` target mounting workspace into Rust container to execute crypto tests |
| `make.bat` | Added Windows batch `test-crypto` target mounting `%~dp0` into Rust container |

## Raw evidence

### 1. Frontend Vitest DOM Test Execution
Command:
```bash
cmd /c "cd apps\webmail && npm run test:vitest"
```
Output:
```
> test:vitest
> vitest run


 RUN  v5.0.5 F:/Codex/byos-email/apps/webmail

 ✓ src/components/ErrorBoundary.test.tsx (3 tests) 23ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  12:54:27
   Duration  9.97s (environment 67%, setup 31%, import 1%, transform 1%, worker 1%)
```

### 2. Backend Query Counter & Attachment Batch Link Assertion
Command:
```bash
cmd /c "set TEST_DATABASE_URL=postgres://byos:byos_dev_password@127.0.0.1:5432/byos_test_isolation&& cd services\api && go test -v -run TestAttachmentQueryCount"
```
Output:
```
=== RUN   TestAttachmentQueryCount
    attachments_test.go:381: [test-db] Using test database 'byos_test_isolation' on host '127.0.0.1'
--- PASS: TestAttachmentQueryCount (0.21s)
PASS
ok  	byos.email/services/api	0.355s
```

### 3. Backend Query Counter Verification Test
Command:
```bash
cmd /c "set TEST_DATABASE_URL=postgres://byos:byos_dev_password@127.0.0.1:5432/byos_test_isolation&& cd services\api && go test -v -run TestQueryCounter"
```
Output:
```
=== RUN   TestQueryCounter
    query_counter_test.go:281: [test-db] Using test database 'byos_test_isolation' on host '127.0.0.1'
--- PASS: TestQueryCounter (0.05s)
PASS
ok  	byos.email/services/api	0.172s
```

### 4. Containerized Crypto Core Test Suite
Command:
```bash
cmd /c "make.bat test-crypto"
```
Output:
```
running 64 tests
test tests::test_aes_gcm_empty_plaintext ... ok
test tests::test_aes_gcm_large_payload ... ok
test tests::test_aes_gcm_roundtrip ... ok
test tests::test_aes_gcm_tampered_ciphertext_fails ... ok
test tests::test_aes_gcm_with_nonce_deterministic ... ok
test tests::test_aes_gcm_with_nonce_roundtrip ... ok
test tests::test_aes_gcm_with_nonce_tampered_fails ... ok
test tests::test_aes_gcm_wrong_key_fails ... ok
test tests::test_aes_gcm_wrong_aad_fails ... ok
test tests::test_aes_gcm_with_nonce_wrong_key_fails ... ok
test tests::test_dkim_verify_fails_on_header_tamper ... ok
test tests::test_hpke_content_key_roundtrip ... ok
test tests::test_hpke_rejects_wrong_private_key ... ok
test tests::test_hpke_wrapped_roundtrip ... ok
test tests::test_mnemonic_roundtrip ... ok
test tests::test_recovery_auth_pk_is_public_not_seed ... ok
test tests::test_recovery_auth_sign_verify_negative ... ok
test tests::test_dkim_verify_fails_on_body_tamper ... ok
test tests::test_dkim_body_hash_changes ... ok
test tests::test_dkim_sign_contains_fields ... ok
test tests::test_wasm_canonical_aad_wire_shape ... ok
test tests::test_wasm_derive_search_key_logic ... ok
test tests::test_webmail_client_decrypt_chain ... ok
test tests::test_wrap_unwrap_mailbox_key ... ok
test tests::test_x25519_dh ... ok
test tests::test_x25519_keypair ... ok
test tests::test_dkim_key_generation ... ok
test tests::test_dkim_verify_valid ... ok
test tests::test_dkim_wrong_dek_fails ... ok
test tests::test_dkim_sign_blinded_positive_still_verifies ... ok
test tests::test_dkim_sign_negative_invalid_pem_and_tamper_blocked ... ok
test tests::test_recovery_principal_kdf_params_frozen ... ok
test tests::test_recovery_principal_passphrase_roundtrip ... ok
test tests::test_dkim_private_key_not_in_ciphertext ... ok
test tests::test_ed25519_recovery_auth_pk_is_public ... ok
test tests::test_ed25519_recovery_auth_sign_verify ... ok
test tests::test_ed25519_recovery_auth_tamper_fails ... ok
test tests::test_ed25519_recovery_auth_wrong_pk_fails ... ok
test tests::test_envelope_canonical_wire_format ... ok
test tests::test_envelope_cross_mailbox_isolation ... ok
test tests::test_envelope_key_id_deterministic ... ok
test tests::test_envelope_tampered_aad_fails ... ok
test tests::test_envelope_tampered_ciphertext_fails ... ok
test tests::test_envelope_tampered_enc_fails ... ok
test tests::test_envelope_tampered_key_id_fails ... ok
test tests::test_envelope_tampered_nonce_fails ... ok
test tests::test_envelope_wrong_key_fails ... ok
test tests::test_hpke_empty_plaintext ... ok
test tests::test_hpke_large_payload ... ok
test tests::test_hpke_tampered_aad_fails ... ok
test tests::test_hpke_tampered_ciphertext_fails ... ok
test tests::test_hpke_tampered_enc_fails ... ok
test tests::test_hpke_vector_rejection ... ok
test tests::test_mailbox_key_deterministic_derivation ... ok
test tests::test_mailbox_key_domain_separation ... ok
test tests::test_mailbox_key_epoch_isolation ... ok
test tests::test_mailbox_key_tamper_fails ... ok
test tests::test_mnemonic_deterministic ... ok
test tests::test_mnemonic_invalid_phrase_fails ... ok
test tests::test_mnemonic_to_root_secret ... ok
test tests::test_recovery_envelope_roundtrip ... ok
test tests::test_recovery_envelope_tamper_fails ... ok
test tests::test_recovery_envelope_wrong_principal_fails ... ok
test tests::test_x25519_dh_mismatch ... ok

test result: ok. 64 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s

     Running unittests src/bin/seed_test_mailboxes.rs (target/debug/build/byos-crypto-core/5cb9d7ba275c58d3/out/seed_test_mailboxes-5cb9d7ba275c58d3)

running 1 test
test tests::hash_format_matches_server_expectation ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.15s

     Running tests/ed25519_signing.rs (target/debug/build/byos-crypto-core/849ba990f5b1650e/out/ed25519_signing-849ba990f5b1650e)

running 9 tests
test test_derivation_different_mailboxes ... ok
test test_derivation_different_epochs ... ok
test test_derivation_deterministic ... ok
test test_verify_fails_tampered_aad ... ok
test test_verify_fails_tampered_signature ... ok
test test_verify_fails_wrong_public_key ... ok
test test_sign_verify_round_trip ... ok
test test_verify_fails_tampered_ciphertext ... ok
test test_cross_language_vectors ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s

     Running tests/seed_tool_roundtrip.rs (target/debug/build/byos-crypto-core/b863ff2505c7bfe8/out/seed_tool_roundtrip-b863ff2505c7bfe8)

running 1 test
test seed_tool_produces_unwrappable_payload ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 13.08s

     Running tests/signing_seed.rs (target/debug/build/byos-crypto-core/1e4d7a8a7a91237f/out/signing_seed-1e4d7a8a7a91237f)

running 8 tests
test test_rfc_8032_vector ... ok
test test_derive_different_epoch ... ok
test test_derive_different_mailbox ... ok
test test_derive_signing_seed_deterministic ... ok
test test_round_trip_wrap_unwrap ... ok
test test_sign_and_verify_with_seed ... ok
test test_tamper_aad ... ok
test test_tamper_ciphertext ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/worker_dispatch.rs (target/debug/build/byos-crypto-core/28060a3fbeff2bae/out/worker_dispatch-28060a3fbeff2bae)

running 4 tests
test test_dispatch_invalid_xwing_key_length ... ok
test test_dispatch_x25519_path ... ok
test test_dispatch_xwing_path ... ok
test test_dispatch_round_trip_xwing ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s

     Running tests/xwing_envelope.rs (target/debug/build/byos-crypto-core/c40063b3dd82923b/out/xwing_envelope-c40063b3dd82923b)

running 20 tests
test test_envelope_canonical_form ... ok
test test_seal_xwing_envelope_signed_different_sender_fails_verify ... ok
test test_envelope_tamper_ciphertext ... ok
test test_envelope_empty_plaintext ... ok
test test_envelope_round_trip ... ok
test test_envelope_tamper_enc ... ok
test test_cross_language_signed_vector ... ok
test test_envelope_tamper_nonce ... ok
test test_envelope_wrong_recipient ... ok
test test_seal_xwing_envelope_signed_wrong_recipient_key_length_rejected ... ok
test test_wasm_build_envelope_aad_matches_direct ... ok
test test_seal_xwing_envelope_signed_empty_seed_rejected ... ok
test test_envelope_tamper_key_epoch ... ok
test test_seal_xwing_envelope_signed_wrong_seed_length_rejected ... ok
test test_envelope_tamper_key_id ... ok
test test_seal_xwing_envelope_signed_empty_plaintext ... ok
test test_seal_xwing_envelope_signed_tamper_ciphertext ... ok
test test_seal_xwing_envelope_signed_wrong_recipient ... ok
test test_seal_xwing_envelope_signed_round_trip ... ok
test test_envelope_1mb_plaintext ... ok

test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.68s

     Running tests/xwing_seed.rs (target/debug/build/byos-crypto-core/46a696bc4fd372c9/out/xwing_seed-46a696bc4fd372c9)

running 8 tests
test test_derive_xwing_seed_deterministic ... ok
test test_derive_xwing_seed_different_mailbox ... ok
test test_derive_xwing_seed_different_root ... ok
test test_derive_xwing_seed_different_epoch ... ok
test test_derive_xwing_seed_domain_separation ... ok
test test_xwing_seed_wrap_tamper_fails ... ok
test test_xwing_seed_wrap_unwrap_roundtrip ... ok
test test_xwing_public_key_from_seed_length ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/xwing_storage.rs (target/debug/build/byos-crypto-core/9b00be76b006ad1c/out/xwing_storage-9b00be76b006ad1c)

running 2 tests
test xwing_storage_round_trip ... ok
test xwing_cross_language_vectors_match ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s

   Doc-tests byos_crypto_core

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### 5. Frontend Typecheck Verification
Command:
```bash
cmd /c "cd apps\webmail && npm run typecheck"
```
Output:
```
> typecheck
> tsc --noEmit
```

## Manual browser verification
This task introduced developer testing harnesses and build tooling (Vitest runner, Go test query hooks, and containerized Cargo test runner). No interactive UI views or user-facing components were modified. Browser verification for application workflows remains verified through automated test suites.

## What did not work or is untested
- Host `cargo` executable is not installed on Windows host PATH; resolved by providing containerized Docker test runner in `Makefile` and `make.bat`.
- Direct `make` command is not installed on Windows host PATH (`CommandNotFoundException`); Windows invocations run via `make.bat test-crypto`.

## Test suite output

### Legacy Frontend Test Suite Output
Command:
```bash
cmd /c "cd apps\webmail && npm run test:legacy"
```
Output:
```
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed
TOTP TESTS: 5 passed, 0 failed
DATE TIME TESTS: 10 passed, 0 failed
FILE TYPE TESTS: 10 passed, 0 failed
MULTI ACCOUNT TESTS: 44 passed, 0 failed
PASSWORD REWRAP TESTS: 11 passed, 0 failed
PATH A COMPOSE TESTS: 13 passed, 0 failed
PATH A READ TESTS: 18 passed, 0 failed
MIME TESTS: 10 passed, 0 failed
SIGNATURE TESTS: 8 passed, 0 failed
REPLY SIGNATURE TESTS: 5 passed, 0 failed
MBOX STREAM TESTS: 9 passed, 0 failed
MBOX LABELS TESTS: 8 passed, 0 failed
IMPORT QUEUE TESTS: 10 passed, 0 failed
THREADING TESTS: 10 passed, 0 failed
UNDO SEND TESTS: 5 passed, 0 failed
KEYBOARD SHORTCUTS TESTS: 10 passed, 0 failed
SNOOZE TESTS: 8 passed, 0 failed
SCHEDULED FOLDER TESTS: 11 passed, 0 failed
DISPLAY PARTY TESTS: 10 passed, 0 failed
NESTED LABELS TESTS: 11 passed, 0 failed
API ERROR TESTS: 10 passed, 0 failed
UNIFIED INBOX TESTS: 14 passed, 0 failed
MASKED EMAIL TESTS: 11 passed, 0 failed
FOCUSED INBOX TESTS: 11 passed, 0 failed
OFFLINE TESTS: 12 passed, 0 failed
COMPOSER SANITIZER TESTS: 15 passed, 0 failed
CONTACTS TESTS: 14 passed, 0 failed
SIDEBAR BORDERLESS TESTS: 6 passed, 0 failed
PROFILE PHOTO TESTS: 11 passed, 0 failed
PERSISTENT SESSION TESTS: 10 passed, 0 failed
OAUTH IMPORT TESTS: 12 passed, 0 failed
CALENDAR RRULE TESTS: 10 passed, 0 failed
CALENDAR CRYPTO TESTS: 10 passed, 0 failed
CALENDAR ICS TESTS: 15 passed, 0 failed
CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed
CALENDAR RECOVERY TESTS: 7 passed, 0 failed
HISTORICAL KEY REACTIVATION & PREFLIGHT TESTS: 9 passed, 0 failed
CALENDAR RECURRENCE EXCEPTION TESTS: 9 passed, 0 failed
CALENDAR INVITATION EXTERNAL TESTS: 9 passed, 0 failed
CALENDAR SHARING TESTS: 8 passed, 0 failed
CALENDAR SETTINGS TESTS: 8 passed, 0 failed
CALENDAR MANAGEMENT TESTS: 9 passed, 0 failed
CALENDAR HOLIDAYS TESTS: 8 passed, 0 failed
CALENDAR YEAR VIEW TESTS: 8 passed, 0 failed
CALENDAR CATEGORIES 01 02 03 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 04 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 05 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 06 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 07 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 08 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 10 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 11 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 12 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 13 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 14 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 15 TESTS: 8 passed, 0 failed
CALENDAR LAYOUT TESTS: 8 passed, 0 failed
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed
GOOGLE NOTE FEATURE TESTS: All 21 passed, 0 failed
TRACK 2 & ZERO-KNOWLEDGE SECURITY TESTS: 17 passed, 0 failed
CALENDAR TRACK 3 TESTS: 8 passed, 0 failed
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed
OVERALL: 602 passed, 0 failed
```
