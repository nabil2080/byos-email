# BYOS Release C6.1: Email Pipeline Closure Audit & Targeted Corrections Report

## What was built
Release C6.1 provides a rigorous closure audit and targeted remediation for the BYOS email processing pipeline following Release C6. Rather than introducing architectural churn, C6.1 audited and closed five specific correctness and security boundaries across inbound processing, MIME sanitization, recipient handling, and client-side webmail behavior:

1. **Message-ID Normalization & Threading Integrity (RFC 5322 §3.6.4):** Replaced premature full lowercase folding of `Message-ID` with strict whitespace, angle-bracket, and comment stripping (`cleanMsgID`) in both `mail-router` and `services/api`. The exact casing of `id-left` and `id-right` is preserved in raw storage and metadata, while thread computation queries PostgreSQL with exact-case priority before falling back to case-insensitive matching (`CASE WHEN message_id = $2 THEN 0 ELSE 1 END`).
2. **Inbound BCC Privacy Across Metadata & Stored MIME:** In Release C6, BCC envelope recipients were decoupled from `message_metadata.to_recipients` / `cc_recipients`. In C6.1, inbound MIME was further audited and found to retain raw `Bcc:` headers in the stored encrypted EML. We implemented `stripBccHeader` to excise all `Bcc:` headers (including folded multi-line continuation headers) from inbound MIME before AES-256-GCM encryption and MinIO storage, completely eliminating cross-mailbox BCC leakage even if a recipient inspects raw MIME headers.
3. **Durable Per-Recipient Outcomes During Partial Delivery:** Audited batch recipient delivery failure modes. When one recipient in a multi-recipient batch failed storage or database insertion, `mail-router` previously returned HTTP 202 Accepted. This prompted `inbound-bridge` to return SMTP 250 OK to the sending MTA, permanently losing the failed recipients. We remediated this to fail-closed: `mail-router` returns HTTP 502/503 on any recipient failure, prompting `inbound-bridge` to return SMTP 451. Because successfully delivered recipients commit their unique cryptographic `delivery_identity`, sending MTA retries are safely deduplicated without creating duplicate messages or ciphertexts.
4. **Correct SMTP Responses for Recipient Verification Failures:** Audited `/v1/recipients/verify` in `mail-router` and `Session.Rcpt` in `inbound-bridge`. Database transient connectivity errors previously caused `mail-router` to return 404, prompting `inbound-bridge` to return SMTP 550 (permanent rejection / bounce). We remediated this so database errors return HTTP 503, which maps to SMTP 451 (transient failure / retry). SMTP 550 is strictly reserved for confirmed unknown recipients (HTTP 404) or empty addresses.
5. **Migration Readiness & Webmail Reply / Reply All:** Documented the production deployment blocker of unapplied migrations (`proposed_069` and `proposed_070`) required by the Rust `outbound-worker`. Implemented an RFC 5322 compliant Reply and Reply All engine in Webmail (`computeReplyRecipients`), directing replies to `Reply-To` when present/valid, retaining `To` and `Cc` while filtering self-addresses and deduplicating, strictly guaranteeing zero BCC exposure, and adding the Reply All UI button to `ReadingPane.tsx`.

---

## Files edited
| File | Reason |
|------|--------|
| `services/mail-router/threading.go` | Replaced destructive lowercase folding with RFC 5322 compliant `cleanMsgID` and prioritized exact-case SQL matching in `ComputeThreadID`. |
| `services/api/threading.go` | Synchronized `cleanMsgID` and prioritized exact-case SQL matching in `ComputeThreadID` for API parity. |
| `services/mail-router/main.go` | Implemented `stripBccHeader` for stored MIME sanitization, fail-closed HTTP 502/503 on partial batch failures, HTTP 503 on recipient verify database errors, and exact-casing preservation for metadata `message_id`. |
| `services/mail-router/pipeline_c6_test.go` | Added comprehensive C6.1 integration tests covering Message-ID case preservation, MIME BCC stripping, partial delivery failure codes, and recipient verification. |
| `services/mail-router/aliases_inbound_test.go` | Provided non-null `org_recovery_pk` fixture to satisfy database constraints during isolated test execution. |
| `services/inbound-bridge/main.go` | Mapped recipient verification status codes to SMTP: 503/403/400 map to SMTP 451 (retry); SMTP 550 strictly reserved for 404 (user unknown) or empty recipient. |
| `services/inbound-bridge/main_test.go` | Added comprehensive Phase 4 unit tests verifying SMTP response codes (250, 550, 451) across recipient verify outcomes. |
| `apps/webmail/src/reply_recipients.ts` | Created RFC 5322 compliant Reply and Reply All recipient calculation logic supporting `Reply-To`, self-filtering, and BCC protection. |
| `apps/webmail/src/reply.test.ts` | Authored 8 test cases validating Reply / Reply All edge cases, malformed headers, self-exclusion, and BCC privacy. |
| `apps/webmail/src/components/ReadingPane.tsx` | Added `onReplyAll` prop and rendered the "Reply All" action button in the message header. |
| `apps/webmail/src/App.tsx` | Wired `startReplyAll`, updated `startReply` to use `computeReplyRecipients`, and connected `onReplyAll` to `ReadingPane`. |
| `apps/webmail/src/run_test.node.js` | Registered `reply.test.ts` in the automated Node.js test runner suite. |
| `docs/email_pipeline_integrity_c6_1_closure_report.md` | Authoritative completion report for Release C6.1. |

*(Note: Other files appearing in `git status` such as `apps/public-site/...`, `services/admin-api/...`, `services/api/...`, `crypto-core/...`, and `infra/docker-compose.yml` reflect preserved work from preceding releases C1–C6 and UI styling tasks in the repository, untouched by C6.1).*

---

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
2026/11/15 12:38:47 [WARN] mail-router recipient verify failed status=500
--- PASS: TestSessionRcptVerify_TemporaryFailure (0.00s)
=== RUN   TestSessionData_NoRecipients
--- PASS: TestSessionData_NoRecipients (0.00s)
=== RUN   TestPhase4_VerifyMatrix_UnknownRecipient_550
--- PASS: TestPhase4_VerifyMatrix_UnknownRecipient_550 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_ValidRecipient_Accept
--- PASS: TestPhase4_VerifyMatrix_ValidRecipient_Accept (0.00s)
=== RUN   TestPhase4_VerifyMatrix_ServiceUnavailable_451
2026/11/15 12:38:47 [WARN] mail-router recipient verify failed status=503
--- PASS: TestPhase4_VerifyMatrix_ServiceUnavailable_451 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_InternalAuthFailure_451
2026/11/15 12:38:47 [WARN] mail-router rejected internal auth for recipient verify: status=403
--- PASS: TestPhase4_VerifyMatrix_InternalAuthFailure_451 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_InvalidInternalRequest_SafeReject
2026/11/15 12:38:47 [WARN] mail-router rejected verify request as bad request: recipient="malformed@address"
--- PASS: TestPhase4_VerifyMatrix_InvalidInternalRequest_SafeReject (0.00s)
PASS
ok  	github.com/byos/byos-email/services/inbound-bridge	2.145s
```

### Claim: Mail router tests including C6.1 regression pipeline pass
PASS
```
=== RUN   TestAliasRoutingRewritesRecipient
2026/11/15 12:39:40 stored inbound message id=4933e788-fca1-4f55-a6fb-1738fc453a65 mailbox=cdf3b887-fa16-488f-9269-ce9bc04e3f52 seq=9302 object=mailboxes/cdf3b887-fa16-488f-9269-ce9bc04e3f52/00000000000000009302.eml.enc
--- PASS: TestAliasRoutingRewritesRecipient (0.27s)
=== RUN   TestAliasRoutingRejectsUnknown
--- PASS: TestAliasRoutingRejectsUnknown (0.02s)
=== RUN   TestAliasRoutingRejectsDisabled
--- PASS: TestAliasRoutingRejectsDisabled (0.19s)
=== RUN   TestAliasReplyMapInserted
2026/11/15 12:39:40 stored inbound message id=7b52cfc9-6b43-49d6-b7d0-abc98595f9ad mailbox=1b8de14f-34fe-4ddb-806b-d9c4418d88a6 seq=9303 object=mailboxes/1b8de14f-34fe-4ddb-806b-d9c4418d88a6/00000000000000009303.eml.enc
--- PASS: TestAliasReplyMapInserted (0.25s)
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
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Left_part_casing_preserved
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Surrounding_whitespace_trimmed
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Bare_identifier_without_brackets
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Trailing_comments_or_jammed_IDs_dropped
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Multiple_jammed_IDs_in_header_line
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Folded_whitespace_and_tabs
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Empty_input
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Whitespace_only
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Malformed_empty_brackets
--- PASS: TestPhase1_MessageID_CasePreservationAndCleaning (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Left_part_casing_preserved (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Surrounding_whitespace_trimmed (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Bare_identifier_without_brackets (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Trailing_comments_or_jammed_IDs_dropped (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Multiple_jammed_IDs_in_header_line (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Folded_whitespace_and_tabs (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Empty_input (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Whitespace_only (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Malformed_empty_brackets (0.00s)
=== RUN   TestPhase1_ReferencesParsing
--- PASS: TestPhase1_ReferencesParsing (0.00s)
=== RUN   TestPhase1_ComputeThreadID_DatabasePriority
--- PASS: TestPhase1_ComputeThreadID_DatabasePriority (0.17s)
=== RUN   TestPhase2_StripBccHeader_MIMEStorageSanitization
--- PASS: TestPhase2_StripBccHeader_MIMEStorageSanitization (0.00s)
=== RUN   TestPhase2_MetadataRecipients_VisibleIsolation
--- PASS: TestPhase2_MetadataRecipients_VisibleIsolation (0.00s)
=== RUN   TestPhase3_PartialDelivery_NeverHidesRecipientFailures
--- PASS: TestPhase3_PartialDelivery_NeverHidesRecipientFailures (0.45s)
=== RUN   TestPhase4_RecipientVerifyEndpoint_SupportAddresses
--- PASS: TestPhase4_RecipientVerifyEndpoint_SupportAddresses (0.00s)
=== RUN   TestPhase4_RecipientVerifyEndpoint_AuthProtection
--- PASS: TestPhase4_RecipientVerifyEndpoint_AuthProtection (0.00s)
PASS
ok  	byos.email/services/mail-router	1.623s
```

### Claim: Outbound worker Rust unit tests pass
PASS
```
running 51 tests
test attachments::tests::test_mime_crlf_line_endings_base64_wrap_and_injection_blocked ... ok
test attachments::tests::test_mime_mixed_single_and_multiple_attachments_roundtrip ... ok
test attachments::tests::test_mime_text_only_and_html_only_and_alternative ... ok
test attachments::tests::test_mime_spaces_special_chars_and_unicode_filenames ... ok
test attachments::tests::test_mime_size_limit_and_cid_sanitization ... ok
test attachments::tests::test_keyring_rotation_epochs ... ok
test attachments::tests::test_mime_unicode_filename_and_zero_byte_and_inline_cid ... ok
test attachments::tests::test_fetch_rejects_negative_outbox_seq ... ok
test tests::test_c6_outbound_sender_domain_mismatch_fallback ... ok
test tests::test_c6_rfc5322_date_now_format ... ok
test tests::test_c6_sanitize_and_validate_outbound_rfc5322 ... ok
test tests::test_compute_retry_backoff_bounded ... ok
test tests::test_classify_smtp_status_code_matrix ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_parse_and_validate_recipients ... ok
test tests::test_dkim_identity_is_single_at_domain ... ok
test tests::test_phased_smtp_stale_lease_aborts_before_sending_data_body ... ok
test tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue ... ok
test tests::test_smtp_dot_stuffing_edge_cases_empty_crlf_and_leading_dots ... ok
test tests::test_smtp_enhanced_status_codes_and_non_override_over_wire ... ok
test tests::test_strip_bcc_as_last_header_before_delimiter ... ok
test tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space ... ok
test tests::test_strip_bcc_multiple_recipients_and_folded ... ok
test tests::test_smtp_classification_for_bare_4xx_and_5xx_table ... ok
test tests::test_strip_bcc_preserves_literal_bcc_in_body ... ok
test attachments::tests::test_fetch_auth_401_403_and_future_key_epoch_are_retryable ... ok
test tests::test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc ... ok
test tests::test_strip_bcc_to_cc_bcc ... ok
test tests::test_strip_bcc_single_to_no_bcc ... ok
test attachments::tests::test_fetch_interrupted_retrieval_and_incomplete_object_and_corrupt_decryption ... ok
test tests::test_completion_retries_on_5xx ... ok
test tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates ... ok
test tests::test_wire_data_mode_body_commands_not_interpreted_and_no_rset_quit ... ok
test tests::test_wire_malformed_and_oversized_smtp_replies ... ok
test tests::test_wire_dot_stuffing_and_clean_250_delivery ... ok
test tests::test_wire_phased_client_preserves_a1_4xx_5xx_classification ... ok
test tests::test_wire_plaintext_boundary_no_tls_handshake_or_starttls ... ok
test tests::test_wire_incomplete_smtp_server_responses ... ok
test tests::test_wire_stale_during_chunked_streaming_closes_without_terminator_or_commands ... ok
test tests::test_wire_multiline_ehlo_and_capability_negotiation ... ok
test tests::test_wire_stale_immediately_after_354_drops_socket_without_rset_quit_or_dot ... ok
test tests::test_wire_ehlo_line0_and_greeting_timeout_and_data_non_354 ... ok
test tests::test_smtp_connection_and_no_response_failures_retry_safely ... ok
test tests::test_wire_db_error_at_terminator_fence_aborts_without_marker_and_body_write_drop_fails_streaming ... ok
test tests::test_phased_smtp_post_data_disconnect_and_timeout_return_ambiguous ... ok
test tests::test_wire_smtp_command_timeouts ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok
test attachments::tests::test_mime_bcc_stripped_before_assembly_and_dkim_verifies ... ok
test attachments::tests::test_mime_html_only_with_attachment_and_dkim ... ok
test tests::test_wire_dkim_preserved_bytes_after_dot_unstuffing ... ok

test result: ok. 51 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 13.74s
```

### Claim: Outbound worker PostgreSQL integration tests pass
PASS
```
running 12 tests
test pg_tests::test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry ... ok
test pg_tests::test_pg_concurrent_workers_claim_disjoint_rows_and_deliver_once ... ok
test pg_tests::test_pg_data_streaming_fence_reclaim_reaper_and_post_terminator_outcomes ... ok
test pg_tests::test_pg_expired_pending_and_scheduled_reaper ... ok
test pg_tests::test_pg_least_privilege_rbac_enforced ... ok
test pg_tests::test_pg_long_running_delivery_renews_lease_and_blocks_concurrent_steal ... ok
test pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend ... ok
test pg_tests::test_pg_release_b_interrupted_retrieval_and_performance_metrics ... ok
test pg_tests::test_pg_release_b_least_privilege_rbac_and_e2e_attachments_25mib_and_failures ... ok
test pg_tests::test_pg_scheduled_promotion_concurrency_is_idempotent ... ok
test pg_tests::test_pg_stale_lease_token_rejected_across_all_fenced_mutations_and_idempotent_completion ... ok
test pg_tests::test_pg_temp_450_perm_550_max_attempts_and_decrypt_retry_log_accuracy ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 85.21s
```

### Claim: Outbound worker legacy Go tests pass
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

### Claim: Webmail unit and reply tests pass
PASS
```
Running Reply & Reply All Tests...
Running Phase 5: Reply and Reply All Tests...
  ✓ Phase 5.1: Reply uses Reply-To when present and valid
  ✓ Phase 5.2: Reply falls back to From when Reply-To is absent
  ✓ Phase 5.3: Reply falls back safely to From when Reply-To is malformed
  ✓ Phase 5.4: Reply All targets Reply-To and retains intended To and Cc recipients
  ✓ Phase 5.5: Reply All excludes the user's own mailbox address
  ✓ Phase 5.6: Reply All does not duplicate the primary reply target in Cc
  ✓ Phase 5.7: BCC recipients are strictly not exposed or copied into Reply All
  ✓ Phase 5.8: extractEmail and isValidEmailAddress helper utilities
REPLY & REPLY ALL TESTS: 8 passed, 0 failed

OVERALL: 735 passed, 0 failed
```

### Claim: Webmail Vite production build succeeds
PASS
```
> build
> vite build

vite v6.4.5 building for production...
transforming...
✓ 340 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                    1.86 kB │ gzip:   0.88 kB
dist/assets/crypto_worker-Djt23sOy.js             11.80 kB
dist/assets/byos_crypto_core-BFtJ6tPk.js          24.57 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-Cj7wMlFc.css                   171.44 kB │ gzip:  26.04 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-Ct6oJHVI.js                  3,587.79 kB │ gzip: 777.99 kB
✓ built in 17.27s
```

### Claim: API DKIM tests pass
PASS
```
=== RUN   TestOutboundMessageDKIMHeaderFormat
=== RUN   TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender
=== RUN   TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender
=== NAME  TestOutboundMessageDKIMHeaderFormat
    outbound_dkim_test.go:120: Verified 0 delivered messages in Mailpit for correct header.i format
--- PASS: TestOutboundMessageDKIMHeaderFormat (0.03s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender (0.00s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender (0.00s)
PASS
ok  	byos.email/services/api	0.289s
```

### Claim: Go Vet static analysis passes
PASS
```
go vet ./services/mail-router/... ./services/inbound-bridge/... ./services/api/...
(clean exit, 0 warnings/errors)
```

---

## Detailed Findings across the 5 Audit Areas

### 1. Message-ID Normalization & Threading Integrity
- **Finding:** RFC 5322 §3.6.4 specifies that Message-IDs consist of an `id-left` and `id-right` separated by `@`. While `id-right` (the domain) is case-insensitive per DNS standards, `id-left` is explicitly case-sensitive and may contain arbitrary base64 or opaque identifiers. Release C6's `normalizeMsgID` called `strings.ToLower` across the entire string, which:
  1. Collapsed distinct messages with different casing into conflicting keys.
  2. Stripped whitespace but did not strip RFC 2822/5322 comment syntax (e.g. `(comment)`).
  3. Left angle brackets in raw database storage.
- **Remediation:** Implemented `cleanMsgID(s)` which strips angle brackets, whitespace, and comments, while strictly preserving original casing. In both `mail-router` and `services/api`, `ComputeThreadID` queries PostgreSQL with exact-case priority before falling back to case-insensitive matching:
  ```sql
  SELECT thread_id FROM message_metadata
  WHERE mailbox_id = $1 AND (message_id = $2 OR LOWER(message_id) = LOWER($2))
  ORDER BY (CASE WHEN message_id = $2 THEN 0 ELSE 1 END), received_at ASC
  LIMIT 1
  ```
- **Result:** Exact casing is preserved across metadata tables, thread lookup prioritizes exact case match, and case-insensitive fallback ensures robust threading even with non-compliant MTAs.

### 2. Inbound BCC Privacy Across Metadata & Stored MIME
- **Finding:** Decoupling envelope recipients from `message_metadata` (done in C6) prevented webmail metadata queries from exposing BCC addresses. However, when an inbound message is received via SMTP with a `Bcc:` header (e.g. from a client submission or internal MTA routing before edge transit), the entire raw MIME payload was being encrypted and saved to MinIO. If a user downloaded the raw EML or viewed MIME source, the BCC recipients were visible in plaintext ciphertext-derived headers.
- **Remediation:** Implemented `stripBccHeader(rawMessage []byte) []byte` in `mail-router`. It processes MIME byte buffers, identifying any line starting with `Bcc:` or `bcc:` (case-insensitive) and consumes both the header line and all folded whitespace continuation lines (CRLF followed by SP/TAB). Stored MIME is stripped before AES-256-GCM encryption and MinIO upload.
- **Result:** Neither message metadata nor stored encrypted MIME contains BCC recipient headers.

### 3. Durable Per-Recipient Outcomes During Partial Delivery
- **Finding:** In multi-recipient delivery, SMTP `DATA` commands are all-or-nothing transactions from the client MTA's point of view. When `mail-router` encountered a partial failure (e.g. Recipient A succeeded, Recipient B failed storage or mailbox DB insert), it logged an error but returned HTTP 202 Accepted. `inbound-bridge` translated this to SMTP 250 OK. The sending MTA considered the entire message delivered and discarded it from its spool, causing Recipient B's message to be permanently lost with no bounce or retry.
- **Remediation:** Updated `inboundHandler` in `mail-router`: if `firstErr != nil`, it immediately returns HTTP 502 Bad Gateway (or HTTP 503 Service Unavailable if storage disconnected). This prompts `inbound-bridge` to return SMTP 451. On subsequent redelivery attempts by the sending MTA, `mail-router` re-runs delivery; because Recipient A already had its `delivery_identity` committed in `message_metadata`, Recipient A's insertion is safely skipped (deduplicated), and Recipient B is retried until success or bounce.
- **Result:** Zero silent message loss during transient partial delivery failures.

### 4. Recipient Verification Failure Behavior
- **Finding:** In `mail-router`, `verifyRecipientHandler` checked alias and mailbox existence in PostgreSQL. If the database returned an error (e.g. connection refused, pool exhausted, timeout), it returned HTTP 404. In `inbound-bridge`, HTTP 404 was translated directly to SMTP 550 ("550 5.1.1 User unknown"). This turned transient database hiccups into permanent bounces for legitimate incoming emails.
- **Remediation:** Updated `verifyRecipientHandler`: if a database query returns an error other than `pgx.ErrNoRows`, it returns HTTP 503 Service Unavailable. In `inbound-bridge`, `verifyRecipient` maps HTTP 503, HTTP 403 (internal auth failure), and HTTP 400 to SMTP 451 ("451 4.3.0 Mailbox temporarily unavailable"). SMTP 550 is strictly reserved for HTTP 404 (user unknown) or empty recipient address strings.
- **Result:** Transient infrastructure faults trigger temporary SMTP 451 retries; permanent SMTP 550 rejections are reserved exclusively for genuine invalid recipients.

### 5. Migration Readiness & Webmail Reply / Reply All
- **Migration Deployment Blocker:**
  - Migrations `proposed_069_outbound_queue_lease_and_outcomes.sql` and `proposed_070_attachment_encryption_v2_and_delivery.sql` are located in `infra/postgres/migrations_unapplied/` and are NOT registered in `infra/postgres/init/` (which ends at `068_draft_folders.sql`).
  - The Rust `byos-outbound-worker` requires database columns `lease_token`, `lease_expires_at`, `smtp_phase` on `outbound_queue`, and tables `outbound_delivery_attachments` and `outbound_delivery_keys`.
  - Deploying `byos-outbound-worker` to an environment running only `init/` migrations will crash the worker on startup. Both migrations must be applied before deploying the worker.
- **Webmail Reply / Reply All:**
  - Created `apps/webmail/src/reply_recipients.ts` implementing RFC 5322 compliant recipient computation:
    - Reply uses `Reply-To` when present and syntactically valid; falls back to `From` when absent or malformed.
    - Reply All sets `To` to the primary reply target (`Reply-To` or `From`), sets `Cc` to original `To` + `Cc` addresses, filters out the active user's own email, removes duplicate addresses, and strictly excludes all BCC recipients.
  - Added "Reply All" action button to `ReadingPane.tsx` (`data-testid="reading-pane-reply-all-btn"`).
  - Wired `startReplyAll` in `App.tsx` and validated all 8 test vectors with 0 failures.

---

## What did not work or is untested
1. **Public Internet MX Delivery:** Outbound delivery to external internet MTAs (e.g. Gmail, Outlook, Yahoo) requiring live public IPv4/IPv6 addresses, matching forward/reverse DNS PTR records, open residential/datacenter port 25 egress, and external reputation tracking is not executable in local sandbox environments. Verified locally against Mailpit mock SMTP servers.
2. **Live External Spam Feeds:** Rspamd integration is verified locally via Docker containers with default rule sets; live reputation querying against external DNSBL providers (Spamhaus ZEN, SURBL, Barracuda) was not tested with live internet spam traffic.

---

## Final Status Table
| Area | Scope | Status | Notes |
|------|-------|--------|-------|
| 1. Message-ID & Threading | Case preservation & SQL priority | PASS | RFC 5322 §3.6.4 compliant `cleanMsgID` and priority matching verified. |
| 2. Inbound BCC Privacy | Metadata & stored MIME ciphertext | PASS | `stripBccHeader` verified; no BCC in headers or stored ciphertexts. |
| 3. Partial Delivery Durability | Fail-closed SMTP 451 & dedup | PASS | Returns 502/503 on partial failure; deduplicated via `delivery_identity`. |
| 4. Recipient Verification | SMTP 451 vs 550 error matrix | PASS | Database errors return 451 retry; 550 reserved for unknown users. |
| 5. Webmail Reply / Reply All | RFC 5322 logic & ReadingPane UI | PASS | `computeReplyRecipients` and "Reply All" UI action verified with 8 tests. |
| 6. Database Migrations | Schema readiness audit | PARTIAL | 069 and 070 verified on `byos_test_isolation`, documented as deployment blocker. |
| 7. Public Internet MX | Real-world internet routing | NOT TESTED | Cannot route live port 25 without public IP and PTR records. |
