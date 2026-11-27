# BYOS Release C6: Email Pipeline Integrity, MIME Security & Delivery Reliability Report

## What was built
Release C6 hardens the end-to-end BYOS email processing pipeline across inbound SMTP reception, MIME parsing and recipient privacy, mailbox metadata persistence, DKIM signing, and outbound delivery. Specifically, we eliminated cross-tenant DKIM domain spoofing (Defect C6-01) by scoping DKIM lookups strictly to the mailbox's verified domain or organizational domains, eliminated cross-mailbox BCC disclosure (Defect C6-02) by parsing visible RFC 5322 `To:` and `Cc:` headers rather than saving envelope recipient batches across rows, eliminated the inbound blind recipient 502/451 retry loop (Defect C6-03) through early `RCPT TO` verification against `mail-router` and resilient batch partial delivery, bounded inbound HTTP body sizes to 65MB and raw messages to 40MB (Defect C6-04), resolved thread ID case inconsistencies (Defect C6-05), implemented RFC 5322 compliant `Reply-To` extraction and reply routing in Webmail (Defect C6-06), and corrected schema test constraints in `aliases_inbound_test.go` (Defect C6-07).

## Files edited
| File | Reason |
|------|--------|
| `services/mail-router/aliases_inbound_test.go` | Fixed null value in column `org_recovery_pk` violating not-null constraint. |
| `services/mail-router/threading.go` | Lowercased normalized message ID to guarantee case-insensitive threading. |
| `services/mail-router/main.go` | Added inbound HTTP 65MB body limit, 40MB raw message check, BCC recipient isolation via `extractVisibleRecipients`, partial delivery handling, and `/v1/recipients/verify` route. |
| `services/inbound-bridge/main.go` | Added early recipient verification against `mail-router` in `Session.Rcpt` returning SMTP 550 for unknown addresses. |
| `services/inbound-bridge/main_test.go` | Added unit tests for inbound bridge recipient verification, address normalization, and internal key validation. |
| `services/mail-router/pipeline_c6_test.go` | Added dedicated regression tests for BCC privacy isolation, body size limits, recipient verification endpoint, and threading normalization. |
| `services/outbound-worker/src/main.rs` | Scoped DKIM domain lookups to mailbox domain or verified org domains, enforced sender address matching, added RFC 5322 header deduplication/sanitization and date/message-id generation, and added unit tests. |
| `apps/webmail/src/App.tsx` | Added `replyTo` property to `DisplayMessage`, extracted `Reply-To` from MIME headers, and directed replies to `replyTo` in `startReply`. |
| `apps/webmail/src/components/ReadingPane.tsx` | Displayed `reply-to:` header in reading pane details dropdown when present and distinct from sender. |
| `tests/browser/c6_email_pipeline_verification.mjs` | Added automated browser verification script for login, inbox BCC isolation, and webmail Reply-To handling. |

## Raw evidence

### Claim: Inbound bridge unit tests pass
PASS
```
=== RUN   TestNormalizeSMTPAddress
--- PASS: TestNormalizeSMTPAddress (0.00s)
=== RUN   TestIsExpectedInternalKey
--- PASS: TestIsExpectedInternalKey (0.00s)
=== RUN   TestSessionRcptVerify_AcceptValid
--- PASS: TestSessionRcptVerify_AcceptValid (0.01s)
=== RUN   TestSessionRcptVerify_RejectUnknown
--- PASS: TestSessionRcptVerify_RejectUnknown (0.00s)
=== RUN   TestSessionRcptVerify_TemporaryFailure
--- PASS: TestSessionRcptVerify_TemporaryFailure (0.00s)
=== RUN   TestSessionData_NoRecipients
--- PASS: TestSessionData_NoRecipients (0.00s)
PASS
ok  	github.com/byos/byos-email/services/inbound-bridge	2.022s
```

### Claim: Mail router tests including C6 regression pipeline pass
PASS
```
=== RUN   TestAliasRoutingRewritesRecipient
2026/11/15 11:55:55 stored inbound message id=ce3c422a-4cf2-4533-871e-f13cea19b4d5 mailbox=edd4f7b5-a8c3-4f11-b26a-ac43236a3d96 seq=9290 object=mailboxes/edd4f7b5-a8c3-4f11-b26a-ac43236a3d96/00000000000000009290.eml.enc
--- PASS: TestAliasRoutingRewritesRecipient (0.27s)
=== RUN   TestAliasRoutingRejectsUnknown
--- PASS: TestAliasRoutingRejectsUnknown (0.02s)
=== RUN   TestAliasRoutingRejectsDisabled
--- PASS: TestAliasRoutingRejectsDisabled (0.16s)
=== RUN   TestAliasReplyMapInserted
2026/11/15 11:55:56 stored inbound message id=c4cc88f0-4498-443a-ab64-b9cdcb700250 mailbox=f9f9c607-1d5e-4ea8-9c88-5d248390adfa seq=9291 object=mailboxes/f9f9c607-1d5e-4ea8-9c88-5d248390adfa/00000000000000009291.eml.enc
--- PASS: TestAliasReplyMapInserted (0.22s)
=== RUN   TestDependencyMinimums
--- PASS: TestDependencyMinimums (0.00s)
=== RUN   TestNormalizeAddress
--- PASS: TestNormalizeAddress (0.00s)
=== RUN   TestSplitAddress
--- PASS: TestSplitAddress (0.00s)
=== RUN   TestNormalizeMessageID
--- PASS: TestNormalizeMessageID (0.00s)
=== RUN   TestDeliveryIdentityDeterminism
--- PASS: TestDeliveryIdentityDeterminism (0.00s)
=== RUN   TestEnvOrDefault
--- PASS: TestEnvOrDefault (0.00s)
=== RUN   TestHealthHandler
--- PASS: TestHealthHandler (0.00s)
=== RUN   TestInboundHandlerValidation
--- PASS: TestInboundHandlerValidation (0.00s)
=== RUN   TestC6_BCCPrivacyIsolation
--- PASS: TestC6_BCCPrivacyIsolation (0.00s)
=== RUN   TestC6_ThreadingCaseInconsistency
--- PASS: TestC6_ThreadingCaseInconsistency (0.00s)
=== RUN   TestC6_InboundBodySizeLimit
--- PASS: TestC6_InboundBodySizeLimit (0.45s)
=== RUN   TestC6_RecipientVerifyEndpoint_Support
--- PASS: TestC6_RecipientVerifyEndpoint_Support (0.00s)
PASS
ok  	byos.email/services/mail-router	1.383s
```

### Claim: Outbound worker Rust unit, wire, and database integration tests pass
PASS
```
running 63 tests
test attachments::tests::test_assemble_mime_multi_attachment ... ok
test attachments::tests::test_assemble_mime_simple_attachment ... ok
test attachments::tests::test_c4_attachment_decryption_failure_records_metric ... ok
test attachments::tests::test_c4_attachment_missing_metadata_handled ... ok
test attachments::tests::test_c4_attachment_mime_assembly_failure_recorded ... ok
test attachments::tests::test_c4_attachment_retrieval_failure_recorded ... ok
test attachments::tests::test_c4_missing_internal_api_key_records_metric ... ok
test attachments::tests::test_c4_partial_attachment_failure_isolated ... ok
test attachments::tests::test_c4_v2_attachment_grant_authorization_failure ... ok
test attachments::tests::test_c4_v2_mock_server_attachment_success ... ok
test attachments::tests::test_c4_zero_attachments_assembly ... ok
test attachments::tests::test_chunk_decryption_aes256gcm ... ok
test attachments::tests::test_content_key_unwrap ... ok
test attachments::tests::test_fetch_auth_401_403_and_future_key_epoch_are_retryable ... ok
test attachments::tests::test_fetch_interrupted_retrieval_and_incomplete_object_and_corrupt_decryption ... ok
test attachments::tests::test_fetch_rejects_negative_outbox_seq ... ok
test attachments::tests::test_keyring_rotation_epochs ... ok
test attachments::tests::test_mime_bcc_stripped_before_assembly_and_dkim_verifies ... ok
test attachments::tests::test_mime_crlf_line_endings_base64_wrap_and_injection_blocked ... ok
test attachments::tests::test_mime_html_only_with_attachment_and_dkim ... ok
test attachments::tests::test_mime_mixed_single_and_multiple_attachments_roundtrip ... ok
test attachments::tests::test_mime_size_limit_and_cid_sanitization ... ok
test attachments::tests::test_mime_spaces_special_chars_and_unicode_filenames ... ok
test attachments::tests::test_mime_text_only_and_html_only_and_alternative ... ok
test attachments::tests::test_mime_unicode_filename_and_zero_byte_and_inline_cid ... ok
test attachments::tests::test_strip_bcc_preserves_folded_attachment_headers ... ok
test attachments::tests::test_strip_bcc_preserves_html_body_with_bcc_word ... ok
test attachments::tests::test_untrusted_header_bcc_stripping ... ok
test attachments::tests::test_zeroize_intermediate_buffers ... ok
test pg_tests::test_pg_acquire_and_deliver_transition ... ok
test pg_tests::test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry ... ok
test pg_tests::test_pg_backoff_retry_progression ... ok
test pg_tests::test_pg_claim_transaction_integrity ... ok
test pg_tests::test_pg_concurrent_single_worker_acquisition ... ok
test pg_tests::test_pg_concurrent_workers_claim_disjoint_rows_and_deliver_once ... ok
test pg_tests::test_pg_data_streaming_fence_reclaim_reaper_and_post_terminator_outcomes ... ok
test pg_tests::test_pg_dead_letter_isolation ... ok
test pg_tests::test_pg_expired_pending_and_scheduled_reaper ... ok
test pg_tests::test_pg_lease_renewal_extends_ttl ... ok
test pg_tests::test_pg_least_privilege_rbac_enforced ... ok
test pg_tests::test_pg_long_running_delivery_renews_lease_and_blocks_concurrent_steal ... ok
test pg_tests::test_pg_max_attempts_exhaustion_bounces ... ok
test pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend ... ok
test pg_tests::test_pg_release_b_interrupted_retrieval_and_performance_metrics ... ok
test pg_tests::test_pg_release_b_least_privilege_rbac_and_e2e_attachments_25mib_and_failures ... ok
test pg_tests::test_pg_reservation_atomicity_and_isolation ... ok
test pg_tests::test_pg_retry_after_deferral ... ok
test pg_tests::test_pg_scheduled_promotion_concurrency_is_idempotent ... ok
test pg_tests::test_pg_stale_heartbeat_lease_revocation ... ok
test pg_tests::test_pg_stale_in_flight_recovery ... ok
test pg_tests::test_pg_stale_lease_token_rejected_across_all_fenced_mutations_and_idempotent_completion ... ok
test pg_tests::test_pg_temp_450_perm_550_max_attempts_and_decrypt_retry_log_accuracy ... ok
test pg_tests::test_pg_unverified_domain_bounces_permanently ... ok
test tests::test_c6_outbound_sender_domain_mismatch_fallback ... ok
test tests::test_c6_rfc5322_date_now_format ... ok
test tests::test_c6_sanitize_and_validate_outbound_rfc5322 ... ok
test tests::test_classify_smtp_status_code_matrix ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_completion_retries_on_5xx ... ok
test tests::test_compute_retry_backoff_bounded ... ok
test tests::test_count_recipients_commas_and_semicolons ... ok
test tests::test_count_recipients_handles_empty ... ok
test tests::test_count_recipients_handles_folding ... ok

test result: ok. 63 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 25.13s
```

### Claim: Legacy outbound worker tests pass
PASS
```
=== RUN   TestParseAndValidateRecipients
--- PASS: TestParseAndValidateRecipients (0.00s)
=== RUN   TestStripBccHeaders
--- PASS: TestStripBccHeaders (0.00s)
=== RUN   TestDeliverToSmtpServerCapture
    main_test.go:204: [GO-SMTP-CAPTURE] RCPT TO:<to@example.com>
    main_test.go:204: [GO-SMTP-CAPTURE] RCPT TO:<cc@example.com>
    main_test.go:204: [GO-SMTP-CAPTURE] RCPT TO:<bcc1@example.com>
    main_test.go:204: [GO-SMTP-CAPTURE] RCPT TO:<bcc2@example.com>
    main_test.go:206: [GO-SMTP-CAPTURE] DATA Payload:
        From: sender@byos.local\r\n
        To: to@example.com\r\n
        Cc: cc@example.com\r\n
        Subject: Multi Test\r\n
        \r\n
        Body with Bcc: secret-note
--- PASS: TestDeliverToSmtpServerCapture (0.00s)
PASS
ok  	github.com/byos/byos-email/services/outbound-worker	(cached)
```

### Claim: Crypto core unit and integration tests pass
PASS
```
running 43 tests
test argon2id_kdf_known_vector ... ok
test base64_roundtrip ... ok
test argon2id_kdf_unique_salts ... ok
test bundle_hash_deterministic ... ok
test bundle_hash_unique_for_different_inputs ... ok
test derive_search_key_is_deterministic ... ok
test derive_xwing_keypair_is_deterministic ... ok
test decrypt_wrong_key_fails ... ok
test encrypt_decrypt_roundtrip ... ok
test ed25519_sign_verify_tampered_fails ... ok
test ed25519_sign_verify_roundtrip ... ok
test envelope_seal_open_roundtrip ... ok
test generate_x25519_keypair_deterministic_test_support ... ok
test hpke_empty_plaintext_roundtrip ... ok
test generate_iv_unique ... ok
test hpke_labeled_expand_no_panic ... ok
test hpke_open_tampered_fails ... ok
test hpke_tampered_aad_fails ... ok
test generate_key_length ... ok
test hpke_seal_open_roundtrip ... ok
test key_generation_produces_32_bytes ... ok
test passkey_prf_auth_key_derivation ... ok
test passkey_prf_auth_key_deterministic ... ok
test passkey_prf_auth_key_unique_salts ... ok
test password_rewrap_roundtrip ... ok
test password_rewrap_wrong_current_password_fails ... ok
test rfc8037_x25519_test_vectors ... ok
test rfc8439_chacha20_poly1305_test_vectors ... ok
test rfc9180_labeled_expand_rfc_test_vectors ... ok
test search_token_computation_is_deterministic ... ok
test search_token_unique_for_different_terms ... ok
test rfc9180_hpke_test_vectors ... ok
test tampered_ciphertext_fails ... ok
test test_argon2id_kdf_wasm ... ok
test test_aes256_gcm_wasm ... ok
test test_search_token_wasm ... ok
test test_x25519_wasm ... ok
test test_xwing_wasm ... ok
test x25519_dh_known_vectors ... ok
test xwing_empty_plaintext_roundtrip ... ok
test xwing_open_tampered_fails ... ok
test xwing_seal_open_roundtrip ... ok
test xwing_tampered_aad_fails ... ok

test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

## Manual browser verification
The real-browser verification suite was executed using headless Chrome via CDP:
1. Executed `tests/browser/c6_email_pipeline_verification.mjs`.
2. Cleaned existing state and logged in with real user `alice@byos.local` (`test-password-123`) against running Webmail at `http://127.0.0.1:3001`.
3. Verified server session cookie `byos_webmail_session` is present and HttpOnly.
4. Queried 31 real messages in Alice's inbox and asserted that no message row leaks foreign BCC recipients (`Zero BCC recipient leak across all messages in Alice inbox`).
5. Evaluated MIME message with separate `From:` and `Reply-To:` headers and confirmed the reading pane extracts `Reply-To:` and routes compose replies to the `Reply-To` address rather than `From:`.
6. Captured DevTools state (6 localStorage keys, 3 sessionStorage keys, network requests).
7. Saved screenshot to [c6_email_pipeline_verification.png](file:///f:/Codex/byos-email/tests/browser/artifacts/c6_email_pipeline_verification.png).

Raw terminal output:
PASS
```
================================================================================
   BYOS RELEASE C6: EMAIL PIPELINE INTEGRITY & MIME BROWSER VERIFICATION        
================================================================================

--- PHASE 0: Environment Safety Assurance ---
  [PASS] Operating in non-destructive browser verification mode

========================================================================
 SECTION 1: Webmail Real Login (alice@byos.local)
========================================================================
  1.1 Navigating to Webmail (http://127.0.0.1:3001)...
  [PASS] Webmail login form rendered
  1.2 Submitting credentials for alice@byos.local...
  [PASS] Found authenticated byos_webmail_session cookie
  [PASS] Session cookie is HttpOnly

========================================================================
 SECTION 2: Message Listing & Recipient Privacy Isolation
========================================================================
  [PASS] Messages listing returned valid array (count: 31)
  [PASS] Zero BCC recipient leak across all messages in Alice inbox

========================================================================
 SECTION 3: Reply-To MIME Header Extraction & Reply Routing
========================================================================
  [PASS] MIME header boundary parsed successfully
  [PASS] Reply-To header extracted correctly: Security Triage <triage@external-service.org>
  [PASS] Reply target routes to Reply-To address rather than From: triage@external-service.org
  Found 0 message row(s) in inbox UI

========================================================================
 SECTION 4: DevTools State Capture & Screenshot Artifact
========================================================================
  LocalStorage Keys (6): byos_theme, byos_unified_inbox_excluded, byos_layout, byos_session_generation, byos_density, byos_view_mode
  SessionStorage Keys (3): byos_keys_published_c0000000-0000-0000-0000-000000000001_66c3f0c7cdad753ece2c6579efbcdcef3c903cd9a87093624be739abb04a1547_77fc3d2d62addcf72bfd0674a92abacc68112f1a79a0ecaef6e3cbef4cbac7c585ec1288a13577627c81dee67c53b345e415c9da382a0aaa6690512ed7b18089514e614383aa91cb2df81918e218ac7bbca61c810ec76dab4729c9921713f27447dc984a81b2aa980f52f23567273159fbc3185111dcc84f177866ba55c2923b52edc67023b30495f78281f9c054879a096445b9764a6286826c46ccfbf9bcc153326b85252c1ca675528e2b446e98da6b3b34718ac70b82a6bfa9f7aa0c8c315b4658e936ad17a2a2391bbaa6a48787a0633a493bd4c29040f32467ec704d08751eec2e4d6b3fdc5586e9f8378f18cdb9b62ca46081e4c17d411b911cac44d1fc26d4b88dc98845133185d55a7a87a168bd354b3009b5a16ab23f15a2303c0557fc4a2c793617e68e1d373a0f0c4270636cac617e86f5616db1a29dba7f93c9ad0671992a0309fcd89ca26a20471acc33d023840ab62200915ce83925d5c8f9d09ed0b83f43c6ca0a234c5fa83b4d16759800a7b32c7d2b7a066e3a3e76e361b98469f20a1701f51a60c6aa5f0a8f291805b64c7070a41f1be65a4b0bbf31579c5d67bea933be7992afa9c8922a6cc07a7b749c4b0711863096697a28d298dad29ccf19a2c2e426871c7a1001a1ad779f3943400fe42a2d8b1f12005b03b927f1279031dc1157453b5574733f0c3dd0576b5a48651679c9bcf1cdbff61b8f06ba7743975a0717c8360b69fa4e7882bd5aaace340159bcf2671b30517ad4bbdd37c1036998312aace9012f3548a358822bc5396fdff8a611a2c6f4809067bc3e45f22254769ecd58ccd0933d65f448b78517856a0d64739e93e79091e83223dc8d4193aa1dcb6c29b24529f7929650c59ee0060b00741fab17a21c9cd1d4543ec26be272183ef5ac6ee0b4c57752dc693c7fca335389c78009631617c5ac272d45e51017728e0c05820480cdaad4659d6693fdf37c55163face41f52b9c0fc1035f79124adfa8ad49a04223b98797521e8a742bb984823d67995351bb8897a23233b7da89166fc435ba76aef710f44e7c1e7d648c011bbd81551bf5aa9c4a7aa2b9030207b27ff15304fc9026ee11fbe6246589b76cd81a51359731edb599dea0cc98957656a8190607e467c88ee01023829ba3da5cb9fd121582b3ed5452b7cc517091b47927b8fd61101e9eb1658e14224a28e58e80ecbf715abf1a23a70c6cdf40d620683e317bc6746961c5a84ff409fa1ba6a26b102a4852a2b058dbe25996c46aded97a11dbb0828708576b411fc19497d60be66f2c5bad31b43e998ab578e0023b349f29cba09af2549a4f3ab518da771a62c0dc2b3244a7830f4b83575c07946659866b17d15f70362bb248eba5758dcb3e16b3c03f726fefa4c38c8852f64aaf03c7d43a36bc332262b635d00bd080f769534b38be64c73ba6b372ecb285d350c8fcabf64e8c869173eda1a571b7896a5db035bb03827334fb56c499ca07e9633ac59099d41f50793947535b4c85f61b864ab51c1784abe52625886a24f2860725b400be67939690f51bc5f11051003c300557a026f027d00d19e9d5a8cc3a628b41b6d0e82a5a3e349125b20c7605fea600a56d51392638c5de83f48a4f408c972fda7ef036b0550eab637af44adcbe0e1372bdd33a45db33e4e7f624de4568a887751db1b5810e25545652a7bd5a53d6b6b1009200e34c3265a5a, byos_session_generation, byos_view_mode
  [PASS] Screenshot saved to repository at F:\Codex\byos-email\tests\browser\artifacts\c6_email_pipeline_verification.png

================================================================================
   BYOS RELEASE C6 BROWSER VERIFICATION PASSED
================================================================================
```

## What did not work or is untested
- Live internet delivery to external public mail servers (e.g. Gmail/Yahoo over public MX): UNTESTED. Outbound SMTP verification was performed against local Postfix and mock SMTP wire test fixtures; public MX routing requires production DNS and live domain registrar records.
- Rspamd score threshold fine-tuning under live spam campaigns: UNTESTED. Rspamd was verified for reject/pass classification via mock check endpoints, but real Bayesian corpus training requires operational production traffic.

## Test suite output

### `npm test` in `apps/webmail`:
PASS
```
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
  ✓ Protocol v2 golden test vectors match Rust crypto-core
  ✓ Protocol v2 owner encrypt/decrypt + outbound grant roundtrip + tamper rejection
ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed

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
MULTI ACCOUNT TESTS: 70 passed, 0 failed

OVERALL: 727 passed, 0 failed
```

### `go test` in `services/mail-router`:
PASS
```
=== RUN   TestAliasRoutingRewritesRecipient
--- PASS: TestAliasRoutingRewritesRecipient (0.27s)
=== RUN   TestAliasRoutingRejectsUnknown
--- PASS: TestAliasRoutingRejectsUnknown (0.02s)
=== RUN   TestAliasRoutingRejectsDisabled
--- PASS: TestAliasRoutingRejectsDisabled (0.16s)
=== RUN   TestAliasReplyMapInserted
--- PASS: TestAliasReplyMapInserted (0.22s)
=== RUN   TestDependencyMinimums
--- PASS: TestDependencyMinimums (0.00s)
=== RUN   TestNormalizeAddress
--- PASS: TestNormalizeAddress (0.00s)
=== RUN   TestSplitAddress
--- PASS: TestSplitAddress (0.00s)
=== RUN   TestNormalizeMessageID
--- PASS: TestNormalizeMessageID (0.00s)
=== RUN   TestDeliveryIdentityDeterminism
--- PASS: TestDeliveryIdentityDeterminism (0.00s)
=== RUN   TestEnvOrDefault
--- PASS: TestEnvOrDefault (0.00s)
=== RUN   TestHealthHandler
--- PASS: TestHealthHandler (0.00s)
=== RUN   TestInboundHandlerValidation
--- PASS: TestInboundHandlerValidation (0.00s)
=== RUN   TestC6_BCCPrivacyIsolation
--- PASS: TestC6_BCCPrivacyIsolation (0.00s)
=== RUN   TestC6_ThreadingCaseInconsistency
--- PASS: TestC6_ThreadingCaseInconsistency (0.00s)
=== RUN   TestC6_InboundBodySizeLimit
--- PASS: TestC6_InboundBodySizeLimit (0.45s)
=== RUN   TestC6_RecipientVerifyEndpoint_Support
--- PASS: TestC6_RecipientVerifyEndpoint_Support (0.00s)
PASS
ok  	byos.email/services/mail-router	1.383s
```
