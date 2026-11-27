# BYOS Release C6.4.1: SMTP Acceptance Checkpoint & Graceful Shutdown Integrity Report

## What was built

Release C6.4.1 delivers a targeted reliability and recovery follow-up to Release C6.4 for the BYOS outbound email delivery pipeline (`services/outbound-worker`). It resolves four critical failure boundaries across SMTP wire transmission and database state management:
1. **Durable Acceptance Reconciliation on Connection Loss:** Implemented `check_and_reconcile_durable_acceptance` and `PostAcceptanceReconciliation` to handle database network failures or query errors occurring immediately after receiving a remote `250 OK`. Instead of guessing or risking duplicate transmission, the worker opens a fresh PostgreSQL connection, inspects the durable row state, and reconciles: settling as already delivered if the commit landed, finalizing delivery on the fresh connection if the row remains leased, acknowledging quarantine if the reaper intervened, or safely refusing action if the lease expired.
2. **PostgreSQL Checkpoint and Defense-in-Depth Retry Guard:** Hardened `mark_smtp_phase_with_code` and `record_delivered_leased` with strict lease-token and expiration fencing (`WHERE id = $1 AND lease_token = $2 AND status = 'processing' AND lease_expires_at > clock_timestamp()`). Added SQL-level guards `AND (smtp_phase IS NULL OR smtp_phase != 'accepted_by_mta')` to `record_retry_leased` and `record_bounced_leased` so that a message accepted by an upstream MTA can never be re-enqueued for delivery under any code path.
3. **Graceful Shutdown & Signal Handling:** Implemented cross-platform signal listeners in `services/outbound-worker/src/main.rs` supporting both `SIGTERM` and `SIGINT` via Unix signal subscriptions and `tokio::signal::ctrl_c()`. When shutdown is requested, the worker immediately ceases claiming new batches, wakes idle sleep loops instantly, grants up to 25 seconds for in-flight tasks to terminate cleanly, and exits with code 0. Configured Docker Compose with `stop_signal: SIGTERM`, `stop_grace_period: 30s`, and `SHUTDOWN_TIMEOUT_SECS: "25"`.
4. **Multi-Recipient RFC 5321 Transaction Reset & Retry Semantics:** Hardened recipient evaluation to enforce an all-or-nothing policy prior to `DATA`. Across 8 distinct multi-recipient scenarios, any temporary (4xx) rejection triggers an immediate `RSET` and aborts data transmission so that accepted recipients receive zero duplicate fragments on retry. Any permanent (5xx) rejection triggers an immediate `RSET` and marks the item permanently bounced, preventing infinite retry loops.

---

## Files edited

| File | Reason |
|------|--------|
| `services/outbound-worker/src/main.rs` | Implemented `check_and_reconcile_durable_acceptance`, defense-in-depth retry guard against `accepted_by_mta`, cross-platform SIGTERM/SIGINT graceful shutdown, bounded shutdown timeout, 8-scenario multi-recipient tests, and PostgreSQL integration tests for Scenarios A, B, C, and D. |
| `infra/docker-compose.yml` | Configured `stop_signal: SIGTERM`, `stop_grace_period: 30s`, and `SHUTDOWN_TIMEOUT_SECS: "25"` on the `outbound-worker` service to guarantee orderly process termination under Docker. |
| `docs/outbound_delivery_reliability_release_c6_4_1_report.md` | Authoritative Release C6.4.1 engineering and verification report containing state transitions, multi-recipient scenario results, raw test outputs, and deployment guidance. |

---

## Acceptance Checkpoint State-Transition Diagram

```mermaid
stateDiagram-v2
    [*] --> pending: Enqueued by API

    pending --> processing: Claimed by Worker (FOR UPDATE SKIP LOCKED)
    
    state processing {
        [*] --> pre_data: EHLO / MAIL FROM
        pre_data --> rcpt_eval: RCPT TO (all recipients)
        
        state rcpt_eval <<choice>>
        rcpt_eval --> rset_abort_temp: Any 4xx -> Issue RSET & QUIT
        rcpt_eval --> rset_abort_perm: Any 5xx -> Issue RSET & QUIT
        rcpt_eval --> data_streaming: All 250 -> Send DATA (354)
        
        data_streaming --> terminator_in_flight: Stream MIME -> Send Checkpoint
        terminator_in_flight --> accepted_by_mta: Transmit <CRLF>.<CRLF> -> Receive 250 OK
        
        accepted_by_mta --> delivered_commit: Send QUIT -> record_delivered_leased()
    }

    rset_abort_temp --> retry_scheduled: record_retry_leased() (backoff jitter)
    retry_scheduled --> pending: next_attempt_at elapsed
    
    rset_abort_perm --> bounced: record_bounced_leased() (no infinite retries)

    terminator_in_flight --> outcome_unknown: Timeout/Disconnect after Dot OR Checkpoint Fail + Reaper
    
    accepted_by_mta --> fresh_conn_check: Checkpoint or record_delivered query fails
    
    state fresh_conn_check <<choice>>
    fresh_conn_check --> delivered: Status is 'delivered' (AlreadyDelivered)
    fresh_conn_check --> delivered: Status is 'processing' -> record_delivered on fresh conn
    fresh_conn_check --> outcome_unknown: Status is 'outcome_unknown' (Reaper quarantined)
    fresh_conn_check --> outcome_unknown: Lease expired/superseded (StaleLeaseLost)

    processing --> delivered: Crash after 250 OK -> Reaper reconciles accepted_by_mta
```

---

## Raw Evidence

### Checkpoint Failure Results (Scenario A)

In Scenario A, the worker completes transmission of the end-of-data terminator and receives a `250 OK` acceptance response from the remote MTA, but the immediate database checkpoint query fails (simulating a database network drop, pool failure, or timeout). The worker attempts fresh-connection reconciliation, but if the database is completely unreachable until the lease expires, the worker halts and refuses retransmission. When the expiration reaper runs, it identifies `smtp_phase = 'terminator_in_flight'` and quarantines the row to `outcome_unknown`, guaranteeing that the message is never automatically resent.

Raw test execution:
```
test pg_tests::test_pg_scenario_a_checkpoint_fails_recovers_as_outcome_unknown_never_resent ... ok
```

### Ambiguous Commit Results (Scenario B)

In Scenario B, the worker receives `250 OK`, persists `accepted_by_mta`, but encounters a network disconnect during `record_delivered_leased`. The worker invokes `check_and_reconcile_durable_acceptance` on a fresh database connection:
- **Sub-scenario B1 (Commit Succeeded):** The transaction committed prior to the socket disconnect. The fresh connection observes `status = 'delivered'` and cleanly exits without duplicate delivery.
- **Sub-scenario B2 (Commit Did Not Land):** The row is still `status = 'processing'` with the worker's active `lease_token`. The worker completes `record_delivered_leased` directly on the fresh connection, transitioning the item to `delivered`.
- **Sub-scenario B3 (Reaper Quarantined):** If database reconnection took longer than the lease duration and the reaper quarantined the row to `outcome_unknown`, the fresh connection acknowledges the quarantine and aborts transmission.

Raw test execution:
```
test pg_tests::test_pg_scenario_b_ambiguous_checkpoint_commit_rechecked_on_fresh_connection ... ok
```

### Reaper Recovery Results (Scenario C)

In Scenario C, the worker receives `250 OK`, persists `smtp_phase = 'accepted_by_mta'`, and then immediately crashes (simulating an unhandled panic, hardware power cut, or `kill -9`) before `record_delivered_leased` can be called. When the background expiration reaper executes after lease expiry, it inspects `smtp_phase`. Because the message had logged MTA acceptance prior to the crash, the reaper transitions the row directly to `delivered` with delivery log entry `reaper: accepted by mta prior to crash; completed delivery`, wholly preventing duplicate transmission.

Raw test execution:
```
test pg_tests::test_pg_scenario_c_checkpoint_committed_crash_recovers_as_delivered ... ok
```

### Stale Lease Results (Scenario D)

In Scenario D, Worker 1 claims a queue row, experiences an extended pause (e.g. process freeze or network partition), and its 300-second lease expires. Worker 2 claims the expired row, acquiring a new lease token. Worker 1 then unfreezes and attempts to call `mark_smtp_phase_with_code` or `record_delivered_leased` using its original, expired lease token. Because all state mutations enforce `WHERE id = $1 AND lease_token = $2 AND status = 'processing' AND lease_expires_at > clock_timestamp()`, Worker 1's mutations affect 0 rows and return an error. Worker 1 cannot overwrite Worker 2's lease or corrupt row state.

Raw test execution:
```
test pg_tests::test_pg_scenario_d_stale_lease_cannot_overwrite_newer_worker ... ok
```

### Defense-in-Depth Retry Guard

To ensure that an email marked `accepted_by_mta` cannot be rescheduled for retry even if an errant code path invokes `record_retry_leased`, the SQL query enforces `AND (smtp_phase IS NULL OR smtp_phase != 'accepted_by_mta')`.

Raw test execution:
```
test pg_tests::test_pg_defense_in_depth_record_retry_leased_blocks_accepted_by_mta ... ok
```

### Graceful Shutdown (SIGTERM and SIGINT)

Graceful shutdown was implemented using `tokio::sync::Notify` and cross-platform signal listening:
- On Unix platforms: listens for `SIGTERM` and `SIGINT` using `tokio::signal::unix::{signal, SignalKind}`.
- On non-Unix platforms: listens for `tokio::signal::ctrl_c()`.
- When triggered, sets `SHUTDOWN_REQUESTED = true`, notifies idle polling loops to break without waiting for sleep intervals, permits in-flight tasks up to `shutdown_timeout` (25s) to finish, closes connections cleanly, and exits with code 0.
- Docker configuration specifies `stop_signal: SIGTERM` and `stop_grace_period: 30s` (providing a 5s safety margin after the 25s internal timeout).

Raw test execution:
```
test tests::test_graceful_shutdown_coordination_and_signals ... ok
```

### Multi-Recipient SMTP (All 8 RFC 5321 Scenarios)

The test `test_multi_recipient_rfc5321_all_8_scenarios` exercises every combination of recipient responses against the mock wire server:
1. **All Recipients Accepted:** Both recipients return `250 OK`. Message proceeds to `DATA` and delivers cleanly.
2. **One Temporary Rejection (450):** First recipient returns `250`, second returns `450`. Worker immediately issues `RSET` and `QUIT`. `DATA` command is never sent; zero body bytes transmitted. Queue item scheduled for retry without partial duplicate delivery.
3. **One Permanent Rejection (550):** First recipient returns `250`, second returns `550`. Worker immediately issues `RSET` and `QUIT`. `DATA` command is never sent. Queue item marked permanently bounced; zero infinite retries.
4. **Multiple Temporary Rejections (450, 452):** Both recipients return 4xx codes. Worker issues `RSET` and `QUIT` without sending `DATA`.
5. **Accepted Recipient Followed by Temporary Rejection:** Recipient 1 returns `250`, Recipient 2 returns `451`. Worker sends `RSET` before `DATA`, clearing the MTA transaction buffer so Recipient 1 receives no message on this attempt.
6. **Temporary Rejection Followed by Accepted Recipient:** Recipient 1 returns `450`. Worker aborts immediately via `RSET`, never submitting Recipient 2 to the wire.
7. **All Recipients Rejected (550, 550):** Both recipients return `550`. Worker issues `RSET`, `QUIT`, and marks item bounced.
8. **SMTP Disconnect During Recipient Negotiation:** Remote MTA closes socket after first `RCPT TO`. Worker detects EOF, treats as retryable network error, and never transmits `DATA`.

Raw test execution:
```
test tests::test_multi_recipient_rfc5321_all_8_scenarios ... ok
```

---

## Manual browser verification

This release modifies backend Rust outbound delivery infrastructure (`services/outbound-worker`) and Docker service orchestration (`infra/docker-compose.yml`). No frontend UI components, DOM templates, or webmail styles were altered. The webmail test suite was run to ensure no regressions occurred across the application stack.

---

## What did not work or is untested

1. **Physical Impossibility of Distributed Two-Phase Commit Across SMTP and PostgreSQL:**
   RFC 5321 SMTP lacks two-phase commit primitives. If a remote Mail Transfer Agent crashes after committing a message to spool but before transmitting `250 OK` across TCP, or if the local database severs connection during the exact moment of post-data acknowledgment, no software protocol can distinguish between remote delivery drop and local network drop without external human reconciliation. The system safely fails closed by quarantining to `outcome_unknown`.
2. **Untested Scenarios:**
   - Physical hardware power disconnection of bare-metal server during post-data terminator transit: **UNTESTED** (requires physical power-cycling of hardware node during active SMTP session).
   - Upstream Postfix daemon internal memory corruption during queue write: **UNTESTED** (requires fault-injection instrumentation in the Postfix binary).

---

## Test suite output

### Outbound Worker Unit Tests

Command:
`docker run --rm -v "F:\Codex\byos-email:/app" -v "byos-cargo-cache:/usr/local/cargo/registry" -w /app/services/outbound-worker rustlang/rust:nightly-slim cargo test --bin byos-outbound-worker -- --skip pg_tests`

Output:
```
running 54 tests
test attachments::tests::test_mime_crlf_line_endings_base64_wrap_and_injection_blocked ... ok
test attachments::tests::test_keyring_rotation_epochs ... ok
test attachments::tests::test_mime_size_limit_and_cid_sanitization ... ok
test tests::test_c6_outbound_sender_domain_mismatch_fallback ... ok
test tests::test_classify_smtp_status_code_matrix ... ok
test attachments::tests::test_mime_text_only_and_html_only_and_alternative ... ok
test tests::test_c6_rfc5322_date_now_format ... ok
test tests::test_compute_retry_backoff_bounded ... ok
test tests::test_compute_retry_backoff_with_jitter_bounds_and_entropy ... ok
test attachments::tests::test_mime_unicode_filename_and_zero_byte_and_inline_cid ... ok
test attachments::tests::test_mime_mixed_single_and_multiple_attachments_roundtrip ... ok
test tests::test_dkim_identity_is_single_at_domain ... ok
test attachments::tests::test_mime_spaces_special_chars_and_unicode_filenames ... ok
test tests::test_c6_sanitize_and_validate_outbound_rfc5322 ... ok
test tests::test_parse_and_validate_recipients ... ok
test tests::test_graceful_shutdown_coordination_and_signals ... ok
test tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue ... ok
test attachments::tests::test_fetch_rejects_negative_outbox_seq ... ok
test tests::test_phased_smtp_stale_lease_aborts_before_sending_data_body ... ok
test tests::test_smtp_classification_for_bare_4xx_and_5xx_table ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_smtp_dot_stuffing_edge_cases_empty_crlf_and_leading_dots ... ok
test tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates ... ok
test tests::test_strip_bcc_as_last_header_before_delimiter ... ok
test tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space ... ok
test tests::test_strip_bcc_multiple_recipients_and_folded ... ok
test tests::test_strip_bcc_preserves_literal_bcc_in_body ... ok
test tests::test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc ... ok
test tests::test_strip_bcc_single_to_no_bcc ... ok
test tests::test_strip_bcc_to_cc_bcc ... ok
test tests::test_smtp_enhanced_status_codes_and_non_override_over_wire ... ok
test attachments::tests::test_fetch_auth_401_403_and_future_key_epoch_are_retryable ... ok
test tests::test_completion_retries_on_5xx ... ok
test tests::test_multi_recipient_rfc5321_all_8_scenarios ... ok
test tests::test_wire_data_mode_body_commands_not_interpreted_and_no_rset_quit ... ok
test attachments::tests::test_fetch_interrupted_retrieval_and_incomplete_object_and_corrupt_decryption ... ok
test tests::test_wire_malformed_and_oversized_smtp_replies ... ok
test tests::test_wire_dot_stuffing_and_clean_250_delivery ... ok
test tests::test_wire_phased_client_preserves_a1_4xx_5xx_classification ... ok
test tests::test_wire_plaintext_boundary_no_tls_handshake_or_starttls ... ok
test tests::test_wire_incomplete_smtp_server_responses ... ok
test tests::test_wire_stale_during_chunked_streaming_closes_without_terminator_or_commands ... ok
test tests::test_wire_stale_immediately_after_354_drops_socket_without_rset_quit_or_dot ... ok
test tests::test_wire_multiline_ehlo_and_capability_negotiation ... ok
test tests::test_wire_ehlo_line0_and_greeting_timeout_and_data_non_354 ... ok
test tests::test_smtp_connection_and_no_response_failures_retry_safely ... ok
test tests::test_wire_db_error_at_terminator_fence_aborts_without_marker_and_body_write_drop_fails_streaming ... ok
test tests::test_phased_smtp_post_data_disconnect_and_timeout_return_ambiguous ... ok
test tests::test_wire_smtp_command_timeouts ... ok
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok
test attachments::tests::test_mime_bcc_stripped_before_assembly_and_dkim_verifies ... ok
test tests::test_wire_dkim_preserved_bytes_after_dot_unstuffing ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok
test attachments::tests::test_mime_html_only_with_attachment_and_dkim ... ok

test result: ok. 54 passed; 0 failed; 0 ignored; 0 measured; 21 filtered out; finished in 6.67s
```

### Outbound Worker PostgreSQL Integration Tests

Command:
`docker run --rm --network byos-email_default -v "F:\Codex\byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -w /workspace/services/outbound-worker -e OUTBOUND_TEST_ADMIN_PG_URL="postgres://byos:byos_dev_password@byos-postgres:5432/byos_test_isolation?sslmode=disable" -e OUTBOUND_TEST_PG_URL="postgres://outbound_worker_login:byos_outbound_worker_dev@byos-postgres:5432/byos_test_isolation?sslmode=disable" rustlang/rust:nightly-slim cargo test --bin byos-outbound-worker pg_tests -- --test-threads=1`

Output:
```
running 21 tests
test pg_tests::test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry ... ok
test pg_tests::test_pg_concurrent_workers_claim_disjoint_rows_and_deliver_once ... ok
test pg_tests::test_pg_data_streaming_fence_reclaim_reaper_and_post_terminator_outcomes ... ok
test pg_tests::test_pg_defense_in_depth_record_retry_leased_blocks_accepted_by_mta ... ok
test pg_tests::test_pg_expired_pending_and_scheduled_reaper ... ok
test pg_tests::test_pg_jittered_retry_reschedules_within_bounds ... ok
test pg_tests::test_pg_least_privilege_rbac_enforced ... ok
test pg_tests::test_pg_long_running_delivery_renews_lease_and_blocks_concurrent_steal ... ok
test pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend ... ok
test pg_tests::test_pg_reaper_idempotence_and_concurrent_execution_safety ... ok
test pg_tests::test_pg_release_b_interrupted_retrieval_and_performance_metrics ... ok
test pg_tests::test_pg_release_b_least_privilege_rbac_and_e2e_attachments_25mib_and_failures ... ok
test pg_tests::test_pg_scenario_a_checkpoint_fails_recovers_as_outcome_unknown_never_resent ... ok
test pg_tests::test_pg_scenario_b_ambiguous_checkpoint_commit_rechecked_on_fresh_connection ... ok
test pg_tests::test_pg_scenario_c_checkpoint_committed_crash_recovers_as_delivered ... ok
test pg_tests::test_pg_scenario_d_stale_lease_cannot_overwrite_newer_worker ... ok
test pg_tests::test_pg_scheduled_promotion_concurrency_is_idempotent ... ok
test pg_tests::test_pg_stale_lease_token_rejected_across_all_fenced_mutations_and_idempotent_completion ... ok
test pg_tests::test_pg_temp_450_perm_550_max_attempts_and_decrypt_retry_log_accuracy ... ok
test pg_tests::test_pg_verify_queue_lease_schema_presence_and_missing ... ok
test pg_tests::test_pg_worker_crash_after_250_ok_recovers_as_delivered_never_outcome_unknown ... ok

test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 54 filtered out; finished in 71.41s
```

### Migration Runner Regression Suite (`tools/byos-migrate`)

Command:
`go test -count=1 -v ./tools/byos-migrate/...`

Output:
```
=== RUN   TestPhase4_FreshDatabaseBootstrap
--- PASS: TestPhase4_FreshDatabaseBootstrap (3.83s)
=== RUN   TestPhase5_ExistingDatabaseUpgrade_Baseline068
--- PASS: TestPhase5_ExistingDatabaseUpgrade_Baseline068 (1.27s)
=== RUN   TestPhase6_MigrationInterruptionAndRecovery
--- PASS: TestPhase6_MigrationInterruptionAndRecovery (0.39s)
=== RUN   TestPhase6_NonTransactionalMigrationSupport
--- PASS: TestPhase6_NonTransactionalMigrationSupport (0.30s)
=== RUN   TestPhase6_ChecksumMismatchDetection
--- PASS: TestPhase6_ChecksumMismatchDetection (0.34s)
=== RUN   TestPhase6_MissingRequiredMigrationFile
--- PASS: TestPhase6_MissingRequiredMigrationFile (0.31s)
=== RUN   TestPhase6_DuplicateVersionDetection
--- PASS: TestPhase6_DuplicateVersionDetection (0.01s)
=== RUN   TestPhase6_ConcurrentDeploymentProtection
--- PASS: TestPhase6_ConcurrentDeploymentProtection (0.32s)
=== RUN   TestPhase6_InsufficientPrivilegesFailsClosed
--- PASS: TestPhase6_InsufficientPrivilegesFailsClosed (0.90s)
PASS
ok  	byos-migrate	17.623s
```

### Mail Router Regression Suite (`services/mail-router`)

Command:
`$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_test_isolation?sslmode=disable"; go test -count=1 -v ./services/mail-router/...`

Output:
```
=== RUN   TestAliasRoutingRewritesRecipient
--- PASS: TestAliasRoutingRewritesRecipient (0.29s)
=== RUN   TestAliasRoutingRejectsUnknown
--- PASS: TestAliasRoutingRejectsUnknown (0.02s)
=== RUN   TestAliasRoutingRejectsDisabled
--- PASS: TestAliasRoutingRejectsDisabled (0.15s)
=== RUN   TestAliasReplyMapInserted
--- PASS: TestAliasReplyMapInserted (0.24s)
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
--- PASS: TestPhase1_MessageID_CasePreservationAndCleaning (0.00s)
=== RUN   TestPhase1_ReferencesParsing
--- PASS: TestPhase1_ReferencesParsing (0.00s)
=== RUN   TestPhase1_ComputeThreadID_DatabasePriority
--- PASS: TestPhase1_ComputeThreadID_DatabasePriority (0.18s)
=== RUN   TestPhase2_StripBccHeader_MIMEStorageSanitization
--- PASS: TestPhase2_StripBccHeader_MIMEStorageSanitization (0.00s)
=== RUN   TestPhase2_MetadataRecipients_VisibleIsolation
--- PASS: TestPhase2_MetadataRecipients_VisibleIsolation (0.00s)
=== RUN   TestPhase3_PartialDelivery_NeverHidesRecipientFailures
--- PASS: TestPhase3_PartialDelivery_NeverHidesRecipientFailures (0.46s)
=== RUN   TestPhase4_RecipientVerifyEndpoint_SupportAddresses
--- PASS: TestPhase4_RecipientVerifyEndpoint_SupportAddresses (0.00s)
=== RUN   TestPhase4_RecipientVerifyEndpoint_AuthProtection
--- PASS: TestPhase4_RecipientVerifyEndpoint_AuthProtection (0.00s)
=== RUN   TestPhase2_MessageID_ThreadingSafetyMatrix
--- PASS: TestPhase2_MessageID_ThreadingSafetyMatrix (0.32s)
PASS
ok  	byos.email/services/mail-router	1.935s
```

### Inbound Bridge Regression Suite (`services/inbound-bridge`)

Command:
`go test -count=1 -v ./services/inbound-bridge/...`

Output:
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
=== RUN   TestPhase4_VerifyMatrix_UnknownRecipient_550
--- PASS: TestPhase4_VerifyMatrix_UnknownRecipient_550 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_ValidRecipient_Accept
--- PASS: TestPhase4_VerifyMatrix_ValidRecipient_Accept (0.00s)
=== RUN   TestPhase4_VerifyMatrix_ServiceUnavailable_451
--- PASS: TestPhase4_VerifyMatrix_ServiceUnavailable_451 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_InternalAuthFailure_451
--- PASS: TestPhase4_VerifyMatrix_InternalAuthFailure_451 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_InvalidInternalRequest_SafeReject
--- PASS: TestPhase4_VerifyMatrix_InvalidInternalRequest_SafeReject (0.00s)
=== RUN   TestPhase4_VerifyMatrix_SyntacticallyInvalid_501
--- PASS: TestPhase4_VerifyMatrix_SyntacticallyInvalid_501 (0.00s)
=== RUN   TestPhase3_CompleteSMTPRetry_And_PartialDeliveryVerification
--- PASS: TestPhase3_CompleteSMTPRetry_And_PartialDeliveryVerification (0.02s)
PASS
ok  	github.com/byos/byos-email/services/inbound-bridge	2.505s
```

### Cryptographic Core Test Suite (`crypto-core`)

Command:
`docker run --rm -v "F:\Codex\byos-email:/app" -v "byos-cargo-cache:/usr/local/cargo/registry" -w /app/crypto-core rustlang/rust:nightly-slim cargo test`

Output:
```
     Running unittests src/lib.rs (/app/target/debug/build/crypto-core/e33ec87952935115/out/crypto_core-e33ec87952935115)
running 6 tests
test hpke::tests::test_labeled_expand_exceeded_hkdf_length ... ok
test hpke::tests::test_labeled_expand_exceeded_u16_max ... ok
test hpke::tests::test_derive_aead_key_error_propagation ... ok
test hpke::tests::test_labeled_expand_zero_length ... ok
test hpke::tests::test_labeled_expand_valid_vector ... ok
test hpke::tests::test_labeled_expand_max_permitted_length ... ok
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/cross_language.rs (/app/target/debug/build/crypto-core/c6dcf6c7c3567676/out/cross_language-c6dcf6c7c3567676)
running 1 test
test test_all_14_cross_language_vectors ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.19s

     Running tests/envelope_parity.rs (/app/target/debug/build/crypto-core/47aa124ff9979e35/out/envelope_parity-47aa124ff9979e35)
running 5 tests
test test_validation_bounds ... ok
test test_build_aad_layout ... ok
test test_canonical_json_ordering_and_format ... ok
test test_unmarshal_canonical_rejects_missing_field ... ok
test test_canonical_json_with_sig ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/rfc9180_a11.rs (/app/target/debug/build/crypto-core/2a73a19bbe03e4da/out/rfc9180_a11-2a73a19bbe03e4da)
running 2 tests
test test_rfc9180_vector_a12_key_schedule ... ok
test test_rfc9180_vector_a11 ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/wasm_smoke.rs (/app/target/debug/build/crypto-core/db949b820527cd88/out/wasm_smoke-db949b820527cd88)
running 1 test
test test_decrypt_envelope_via_public_api ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/xwing_draft10.rs (/app/target/debug/build/crypto-core/653ed659ffadbf5a/out/xwing_draft10-653ed659ffadbf5a)
running 1 test
test test_xwing_draft10_vectors ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
```

### Webmail Client Test Suite (`apps/webmail`)

Command:
`npm.cmd --prefix apps/webmail test`

Output:
```
ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed
TOTP TESTS: 5 passed, 0 failed
DATE TIME TESTS: 10 passed, 0 failed
FILE TYPE TESTS: 10 passed, 0 failed
MULTI-ACCOUNT & STORAGE SYNC TESTS: 39 passed, 0 failed
MBOX PARSER TESTS: 12 passed, 0 failed
MBOX STREAM TESTS: 7 passed, 0 failed
MBOX LABELS TESTS: 8 passed, 0 failed
IMPORT QUEUE TESTS: 8 passed, 0 failed
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed
KASHCAL PARSER TESTS: 6 passed, 0 failed
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed
FOLDER & TRASH TESTS: 9 passed, 0 failed
REPLY & REPLY ALL TESTS: 8 passed, 0 failed

OVERALL: 735 passed, 0 failed
```

---

## Deployment Recommendations

1. **Docker Compose Signal Configuration:**
   Ensure `services/outbound-worker` has `stop_signal: SIGTERM` and `stop_grace_period: 30s` configured in `infra/docker-compose.yml`. This ensures Docker allows the worker's internal 25-second grace period (`SHUTDOWN_TIMEOUT_SECS=25`) to conclude cleanly before issuing an ungraceful `SIGKILL`.
2. **PostgreSQL Connection Pool Margins:**
   Verify that PostgreSQL's `max_connections` provides sufficient overhead for outbound workers to establish temporary reconciliation connections during failover.
3. **Queue Monitoring & Alerting:**
   Configure Prometheus alerts on rows entering `status = 'outcome_unknown'`. Any quarantined row indicates a severe network partition during post-data terminator exchange and should trigger prompt operator investigation.

---

## Final Verdict Table

| Requirement | Verdict | Raw Verification Output |
|-------------|---------|-------------------------|
| 1. Persistence of `accepted_by_mta` Checkpoint | PASS | `test pg_tests::test_pg_scenario_c_checkpoint_committed_crash_recovers_as_delivered ... ok` |
| 2. Recovery on Ambiguous Checkpoint Persistence | PASS | `test pg_tests::test_pg_scenario_b_ambiguous_checkpoint_commit_rechecked_on_fresh_connection ... ok` |
| 3. Expiration Quarantine on Unconfirmed Post-Data Drop | PASS | `test pg_tests::test_pg_scenario_a_checkpoint_fails_recovers_as_outcome_unknown_never_resent ... ok` |
| 4. Fencing against Stale Lease Token Mutations | PASS | `test pg_tests::test_pg_scenario_d_stale_lease_cannot_overwrite_newer_worker ... ok` |
| 5. Defense-in-Depth Retry Guard on Accepted Mail | PASS | `test pg_tests::test_pg_defense_in_depth_record_retry_leased_blocks_accepted_by_mta ... ok` |
| 6. Docker SIGTERM / SIGINT Graceful Shutdown | PASS | `test tests::test_graceful_shutdown_coordination_and_signals ... ok` |
| 7. Multi-Recipient RFC 5321 Fail-Closed Semantics | PASS | `test tests::test_multi_recipient_rfc5321_all_8_scenarios ... ok` |
| 8. Full Ecosystem Regression Suite | PASS | `test result: ok. 54 passed (outbound-worker)`<br>`test result: ok. 21 passed (pg_tests)`<br>`PASS ok byos-migrate 17.623s`<br>`PASS ok byos.email/services/mail-router 1.935s`<br>`PASS ok github.com/byos/byos-email/services/inbound-bridge 2.505s`<br>`OVERALL: 735 passed, 0 failed (apps/webmail)` |
