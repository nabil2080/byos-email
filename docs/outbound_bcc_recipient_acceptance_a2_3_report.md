# BYOS Release A.2.3: Final BCC Privacy and Recipient Integrity Acceptance Report

## What was built

No application source code, migration, or test files were modified during Release A.2.3. This engagement executed an end-to-end acceptance inspection and test execution across the active Rust outbound worker (`services/outbound-worker/src/main.rs`) and the superseded legacy Go outbound worker (`services/outbound-worker/legacy/main.go`, `services/outbound-worker/legacy/main_test.go`) against the Release A objectives:

1. Outbound SMTP `DATA` Bcc header sanitization and DKIM signing order in the Rust outbound worker.
2. Multi-recipient parsing, per-recipient `RCPT TO` transmission, Bcc sanitization, and inactive/superseded repository reachability of the legacy Go outbound worker.
3. Cross-worker mock SMTP envelope and full `DATA` capture across all six recipient/rejection scenarios.
4. Full Rust (`tests::*` + `pg_tests::*`, including Release A.2.2 wire-protocol and DKIM byte-preservation suites) and legacy Go regression execution, plus root-cause diagnosis of the earlier `cargo test --offline tests::` exit code `1`.

## Files edited

| File | Reason |
|---|---|
| `docs/outbound_bcc_recipient_acceptance_a2_3_report.md` | Release A.2.3 acceptance report documenting code paths, runtime container reachability, mock SMTP captures, and full test outputs |

All pre-existing modified and untracked workspace files (`services/outbound-worker/src/main.rs`, `services/outbound-worker/legacy/main.go`, `services/outbound-worker/legacy/main_test.go`, `apps/webmail/*`, `docs/*`, `infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql`, `tests/browser/*`) were preserved untouched, and no git staging, commits, resets, or pushes were performed.

---

## Acceptance Findings & Code Traceability

### 1. Rust Outbound Worker: BCC Sanitization, DKIM Order, and Envelope Handling

Inspection of `services/outbound-worker/src/main.rs` establishes:

- **Bcc stripping (`strip_bcc_headers`, lines `271-344`):** Splits headers from body at the first `\r\n\r\n` or `\n\n` delimiter, drops every header whose field name trimmed before `:` matches `"bcc"` case-insensitively (`eq_ignore_ascii_case(b"bcc")`, covering `Bcc:`, `bCc:`, `BCC:`, and obs-space `Bcc :`) together with folded continuation lines starting with `' '` or `'\t'`, and preserves non-Bcc headers (`From:`, `To:`, `Cc:`, `Subject:`, `X-Bcc-Audit:`), folded `To:`/`Cc:` continuations, the delimiter, and literal `Bcc:` strings in the message body verbatim.
- **DKIM signing order (`process_claimed_outbound_item`, lines `2817 -> 2819 -> 2841 -> 2889 -> 2911 -> 2921`):**
  1. Line `2817`: `strip_bcc_headers(&plaintext)` strips all `Bcc:` headers into `sanitized_plaintext`.
  2. Line `2819`: `dkim_sign(..., &sanitized_plaintext)` computes the DKIM body hash and `DKIM-Signature` over `sanitized_plaintext` (after Bcc removal).
  3. Line `2841`: `parse_and_validate_recipients(&item.recipient)` parses and validates all intended `To`, `Cc`, and `Bcc` envelope recipients (`to, cc, bcc`).
  4. Line `2889`: `Envelope::new(Some(sender_addr), recipient_addrs)` builds the SMTP envelope containing all intended recipients (`To + Cc + Bcc`).
  5. Line `2911`: `assemble_final_message(&domain_name, &dkim_selector, &signed)` prepends only `Authentication-Results:` and never reintroduces `Bcc:`.
  6. Line `2921`: `deliver_raw_to_smtp_phased_with_timeout(...)` delivers `final_message` using the active phased Tokio SMTP client, which loops `for rcpt in envelope.to()` at lines `1541-1542` to issue one `RCPT TO:<...>` command per recipient and aborts before `DATA` if any `RCPT TO` is rejected.

### 2. Legacy Go Outbound Worker: Implementation Status and Repository Reachability

Inspection of `services/outbound-worker/legacy/main.go` (`lines 222-420`) shows Release A fixes are already present in the legacy module:

- `splitRecipientTokens` (`lines 222-248`) and `parseAndValidateRecipients` (`lines 252-290`) parse comma/semicolon-separated addresses while respecting quoted display names, trim whitespace, skip empty segments, validate via RFC 5322 `mail.ParseAddress` + 2+ domain labels, deduplicate case-insensitively, and reject `\r\n\x00`.
- `stripBccHeaders` (`lines 294-369`) removes case-insensitive `Bcc:` headers and folded continuation lines while preserving legitimate headers and body content.
- `deliverToSmtpServer` (`lines 371-420`) issues one `c.Rcpt(rcpt)` command per parsed address, returns an error before `c.Data()` on any rejected recipient, and writes only `sanitizedPayload`.

Repository and Docker configuration show the legacy Go worker is inactive/superseded and excluded from deployment:

1. `go.work` (`lines 1-4`) explicitly excludes `./services/outbound-worker/legacy`: `"// NOTE: ./services/outbound-worker/legacy is intentionally excluded.\n// It is a superseded legacy module on Go 1.22 with an old import path."`
2. `infra/docker-compose.yml` (`lines 319-323`) configures `outbound-worker` (`container_name: byos-outbound-worker`) to build `dockerfile: services/outbound-worker/Dockerfile.rust`.
3. `docker inspect byos-outbound-worker` inspects the running container image/entrypoint as `byos-email-outbound-worker | [./byos-outbound-worker]`.
4. `services/outbound-worker/Dockerfile` (`lines 5-10`) is an unreferenced Go Dockerfile copying `go.mod` / `main.go` from `services/outbound-worker/` root rather than `legacy/`.
5. `scripts/verify_complete_local_stack.ps1` (`lines 30-32`) categorizes `"services/outbound-worker"` under `# 3. Rust Microservices`.

### 3. Cross-Worker SMTP Capture Matrix (Scenarios 1-6)

| Scenario | Rust Coverage | Legacy Go Coverage | Outcome |
|---|---|---|---|
| 1. One `To` recipient | `tests::test_parse_and_validate_recipients`, `tests::test_strip_bcc_single_to_no_bcc`, phased wire test `tests::test_wire_dot_stuffing_and_clean_250_delivery` | `TestParseAndValidateRecipients` | Single `RCPT TO`, clean `DATA`, zero `Bcc:` |
| 2. Multiple `To` recipients | `tests::test_parse_and_validate_recipients`, active phased PG test `pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend` (`"ok@external.com, later@external.com"`) | `TestParseAndValidateRecipients` | Separate `RCPT TO` per recipient |
| 3. Mixed `To`, `Cc`, `Bcc` | `tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data` (`[RUST-SMTP-CAPTURE]`) | `TestDeliverToSmtpServerCapture` (`[GO-SMTP-CAPTURE]`) | All `To`+`Cc`+`Bcc` in `RCPT TO`; only `To`+`Cc` headers in `DATA` |
| 4. Multiple `Bcc` | `tests::test_strip_bcc_multiple_recipients_and_folded`, `tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space`, `[RUST-SMTP-CAPTURE]` (`secret-bcc1`, `secret-bcc2`) | `TestStripBccHeaders`, `[GO-SMTP-CAPTURE]` (`bcc1`, `bcc2`) | Every `Bcc` recipient delivered via `RCPT TO`; zero `Bcc:` headers in `DATA` |
| 5. Rejected recipient among valid recipients | Sync client: `tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates`, `tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue`; active phased client: `pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend` (`250 2.1.5 OK` + `450 4.2.0` -> `data_command_count == 0`, status remains `'pending'`) | Static code review of `legacy/main.go:394-398` (returns before `c.Data()` on first `c.Rcpt(rcpt)` error; no partial-reject unit test in `legacy/main_test.go`) | Rust active phased & sync paths abort before `DATA`; zero partial delivery |
| 6. Final SMTP `DATA` with no `Bcc:` headers | `[RUST-SMTP-CAPTURE]` (body literal `Bcc: literal-body-example@external.com` preserved, header absent) & active phased wire/DKIM test `tests::test_wire_dkim_preserved_bytes_after_dot_unstuffing` (excludes `secret@external.com` and preserves DKIM-signed bytes across dot-unstuffing) | `[GO-SMTP-CAPTURE]` (body literal `Body with Bcc: secret-note` preserved, header absent) | Zero `Bcc:` headers transmitted in `DATA`; DKIM signature matches transmitted body |

---

## Raw evidence

### Rust Mock SMTP Capture (`[RUST-SMTP-CAPTURE]`, `--nocapture`, exit `0`)

Command executed:

```powershell
docker run --rm -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-rust-target:/workspace/services/outbound-worker/target" -w /workspace/services/outbound-worker rustlang/rust:nightly-slim cargo test --offline -- --exact tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data --nocapture
```

Verbatim output:

```text
[RUST-SMTP-CAPTURE] MAIL FROM: MAIL FROM:<sender@byos.local>
[RUST-SMTP-CAPTURE] RCPT TO:<to-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<cc-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc1@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc2@external.com>
[RUST-SMTP-CAPTURE] DATA Headers:
Authentication-Results: byos.local; dkim=pass (2048-bit key) header.d=byos.local header.i=@byos.local header.s=byos
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=byos.local; s=byos; h=From:To:Cc:Subject; bh=mNPecxUeeiKU216GRY8WBLeGSlXc60FzJLYRk0zkhzg=; t=1794477197; b=CbSx1cSJrlTRlmr5aOh9vuREogZf4S8aMspcoqGUEvG/T2IVdZ8Dr+ynM8ih7UI6yDWFZgYn2HQxlr1Savi7CD2QzmXFPAOQhoH+MYNJRk1O5NTG5f8d4fyQ6IKaJ4dOKxXV8yTJx0jQAsPcOF3735RRSKwnMiKnGjOg3yj3AHlTt8Hws/liQUFbLYADmmQyug+tDye4kDCe5iaZipCN3eMtjFizxt/ST1T5zZhyiUxen4tlrwuFquaqC2LRGpHV0Sz1aeD68Nnp48JITUPHvO9bRBE+ifd6lTpjZhUyaGTYxX7xK5cqUk0oaGuJz6MouJLBgkm2ttB5A0xdF6t8cA==
From: sender@byos.local
To: to-recipient@external.com
Cc: cc-recipient@external.com
Subject: E2E BCC Privacy Verification
[RUST-SMTP-CAPTURE] DATA Body:
Hello team,
Bcc: literal-body-example@external.com
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 45 filtered out; finished in 1.75s
```

### Legacy Go Test Suite (`go test -v ./...`)

Default workspace mode without `GOWORK=off` fails with exit code `1` because `go.work` intentionally excludes `./services/outbound-worker/legacy`:

```text
pattern ./...: directory prefix . does not contain modules listed in go.work or their selected dependencies
```

Executed with `GOWORK=off` in `services/outbound-worker/legacy`, `go test -v ./...` exits with code `0` (`GO_TEST_EXIT=0`):

```text
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
ok  	github.com/byos/byos-email/services/outbound-worker	0.555s
GO_TEST_EXIT=0
```

### Root Cause of Earlier `cargo test --offline tests::` Exit Code `1`

Earlier execution of `cargo test --offline tests::` without `OUTBOUND_TEST_PG_URL` exited `1` with `36 passed; 10 failed; 0 ignored`:

- Cargo's positional test filter performs substring matching, not module-prefix matching. Because `"pg_tests::"` contains `"tests::"`, the filter matched both the 36 unit tests in `mod tests` and the 10 PostgreSQL integration tests in `mod pg_tests`.
- Without `OUTBOUND_TEST_PG_URL`, `require_isolated_pg_urls()` at `services/outbound-worker/src/main.rs:5790` intentionally panicked on all 10 `pg_tests::*` tests to prevent execution against the active `byos` PostgreSQL database (`OUTBOUND_TEST_PG_URL must point to an isolated disposable PostgreSQL database (never production 'byos'): NotPresent`).
- Running `cargo test --offline` with `OUTBOUND_TEST_PG_URL` targeting the least-privilege `outbound_worker_login` role on an ephemeral PostgreSQL 16 database (`byos_a23_test` on `127.0.0.1:5439`) and `OUTBOUND_TEST_ADMIN_PG_URL` targeting `byos` produced exit code `0` (`46 passed; 0 failed`).

### Active `byos-postgres` Non-Mutation Evidence and Cleanup

The ephemeral container `byos-pg-a23-test` (`127.0.0.1:5439`) was removed via `docker rm -f byos-pg-a23-test`, and active `byos-postgres` (`port 5432`) remains untouched (no `proposed_069` schema columns present on `outbound_queue`):

```text
byos-pg-a23-test
 current_database |             now              
------------------+------------------------------
 byos             | 2026-11-12 09:56:03.63149+00
(1 row)

                                 Table "public.outbound_queue"
         Column          |           Type           | Collation | Nullable |      Default      
-------------------------+--------------------------+-----------+----------+-------------------
 id                      | uuid                     |           | not null | gen_random_uuid()
 delivery_id             | uuid                     |           | not null | 
 mailbox_id              | uuid                     |           | not null | 
 domain_id               | uuid                     |           | not null | 
 recipient               | text                     |           | not null | 
 encrypted_message       | bytea                    |           | not null | 
 send_token_hpke_wrapped | bytea                    |           | not null | 
 status                  | text                     |           | not null | 'pending'::text
 attempts                | integer                  |           | not null | 0
 max_attempts            | integer                  |           | not null | 5
 last_attempt_at         | timestamp with time zone |           |          | 
 next_attempt_at         | timestamp with time zone |           | not null | now()
 created_at              | timestamp with time zone |           | not null | now()
 delivered_at            | timestamp with time zone |           |          | 
 failed_at               | timestamp with time zone |           |          | 
 expires_at              | timestamp with time zone |           | not null | 
 outbox_seq              | bigint                   |           |          | 
 encryption_version      | integer                  |           |          | 1
 aad_version             | smallint                 |           |          | 1
 encryption_iv           | bytea                    |           |          | 
 reservation_id          | uuid                     |           |          | 
```

`git status --short`:

```text
 M apps/webmail/src/components/Sidebar.tsx
 M apps/webmail/src/components/calendar/CalendarSidebar.tsx
 M apps/webmail/src/components/notes/NotesEditor.tsx
 M apps/webmail/src/components/notes/NotesListItem.tsx
 M apps/webmail/src/components/notes/NotesSidebar.tsx
 M apps/webmail/src/components/notes/NotesView.tsx
 M apps/webmail/src/utils/documentExport.test.ts
 M apps/webmail/src/utils/documentExport.ts
 M services/outbound-worker/legacy/main.go
 M services/outbound-worker/src/main.rs
?? docs/attachment_delivery_internal_api_spec.md
?? docs/attachment_delivery_schema_migration_proposal.md
?? docs/attachment_encryption_protocol_v2.md
?? docs/external_attachment_delivery_implementation_report.md
?? docs/notes_ui_consistency_refinement_report.md
?? docs/notes_word_style_image_editing_completion_report.md
?? docs/outbound_bcc_recipient_fix_report.md
?? docs/outbound_queue_claim_reliability_a2_1_report.md
?? docs/outbound_queue_claim_reliability_report.md
?? docs/outbound_smtp_transport_security_report.md
?? docs/webmail_critical_verification_report.md
?? infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql
?? services/outbound-worker/legacy/main_test.go
?? tests/browser/test_notes_word_style_image_editing.mjs
?? tests/browser/verify_critical_delivery_and_workflows.mjs
?? tests/browser/verify_notes_image_persistence_and_export.mjs
?? tests/browser/verify_notes_pdf_and_docx_interoperability.mjs
?? tests/browser/verify_notes_ui_consistency.mjs
?? tests/browser/verify_webmail_critical_ui.mjs
```

---

## Manual browser verification

Not applicable: Release A.2.3 covers backend SMTP worker recipient handling and header sanitization (`services/outbound-worker/`), with no frontend or browser UI code changes.

---

## What did not work or is untested

- Live external SMTP delivery, public DNS resolution, OAuth flows, and live `byos-postfix` relay integration tests were excluded per safety constraints; SMTP wire/envelope/`DATA` behavior ran against local in-process mock SMTP servers in Rust and Go tests.
- `services/outbound-worker/legacy/main_test.go` does not include a dedicated test case for Scenario 5 (partial recipient rejection before `c.Data()` in the legacy Go worker); that path (`legacy/main.go:394-398`) rests on code inspection only, while Scenario 5 runtime coverage runs in both the sync and active phased Rust suites (`tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates`, `tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue`, and `pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend`).
- `cargo check --offline --all-targets` emits two pre-existing deprecation warnings (`redis::Client::get_async_connection` at `src/main.rs:125` and `src/main.rs:534`) and one future-incompat notice for `rand_core v0.4.2`.
- Default `go test -v ./...` in `services/outbound-worker/legacy` without `GOWORK=off` exits `1` by design because `go.work` excludes `legacy`.

---

## Test suite output

### Full Rust Check & 46-Test Suite (`tests::*` + `pg_tests::*`) against Ephemeral PG 16 (`byos_a23_test`)

Command executed:

```powershell
docker run --rm --add-host=host.docker.internal:host-gateway `
  -e "OUTBOUND_TEST_PG_URL=postgres://outbound_worker_login:byos_outbound_worker_dev@host.docker.internal:5439/byos_a23_test" `
  -e "OUTBOUND_TEST_ADMIN_PG_URL=postgres://byos:byos_dev_password@host.docker.internal:5439/byos_a23_test" `
  -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" `
  -v "byos-rust-target:/workspace/services/outbound-worker/target" `
  -w /workspace/services/outbound-worker rustlang/rust:nightly-slim `
  sh -c 'cargo check --offline --all-targets && cargo test --offline; echo RUST_EXIT=$?'
```

Verbatim output:

```text
warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:125:29
    |
125 |     let mut conn = match rc.get_async_connection().await {
    |                             ^^^^^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(deprecated)]` on by default

warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:534:21
    |
534 |             match c.get_async_connection().await {
    |                     ^^^^^^^^^^^^^^^^^^^^

warning: `byos-outbound-worker` (bin "byos-outbound-worker" test) generated 2 warnings
warning: `byos-outbound-worker` (bin "byos-outbound-worker") generated 2 warnings (2 duplicates)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.23s
warning: the following packages contain code that will be rejected by a future version of Rust: rand_core v0.4.2
note: to see what the problems were, use the option `--future-incompat-report`, or run `cargo report future-incompatibilities --id 1`
warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:125:29
    |
125 |     let mut conn = match rc.get_async_connection().await {
    |                             ^^^^^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(deprecated)]` on by default

warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:534:21
    |
534 |             match c.get_async_connection().await {
    |                     ^^^^^^^^^^^^^^^^^^^^

warning: `byos-outbound-worker` (bin "byos-outbound-worker" test) generated 2 warnings
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.22s
warning: the following packages contain code that will be rejected by a future version of Rust: rand_core v0.4.2
note: to see what the problems were, use the option `--future-incompat-report`, or run `cargo report future-incompatibilities --id 1`
     Running unittests src/main.rs (target/debug/build/byos-outbound-worker/6cb07df31c721e60/out/byos_outbound_worker-6cb07df31c721e60)

running 46 tests
test tests::test_classify_smtp_status_code_matrix ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_compute_retry_backoff_bounded ... ok
test tests::test_dkim_identity_is_single_at_domain ... ok
test tests::test_completion_retries_on_5xx ... ok
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok
test tests::test_parse_and_validate_recipients ... ok
test tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue ... ok
test tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates ... ok
test tests::test_phased_smtp_post_data_disconnect_and_timeout_return_ambiguous ... ok
test tests::test_phased_smtp_stale_lease_aborts_before_sending_data_body ... ok
test tests::test_smtp_classification_for_bare_4xx_and_5xx_table ... ok
test tests::test_smtp_connection_and_no_response_failures_retry_safely ... ok
test tests::test_smtp_dot_stuffing_edge_cases_empty_crlf_and_leading_dots ... ok
test tests::test_smtp_enhanced_status_codes_and_non_override_over_wire ... ok
test tests::test_strip_bcc_as_last_header_before_delimiter ... ok
test tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space ... ok
test tests::test_strip_bcc_multiple_recipients_and_folded ... ok
test tests::test_strip_bcc_preserves_literal_bcc_in_body ... ok
test tests::test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc ... ok
test tests::test_strip_bcc_single_to_no_bcc ... ok
test tests::test_strip_bcc_to_cc_bcc ... ok
test tests::test_wire_data_mode_body_commands_not_interpreted_and_no_rset_quit ... ok
test tests::test_wire_db_error_at_terminator_fence_aborts_without_marker_and_body_write_drop_fails_streaming ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok
test tests::test_wire_dot_stuffing_and_clean_250_delivery ... ok
test tests::test_wire_dkim_preserved_bytes_after_dot_unstuffing ... ok
test tests::test_wire_incomplete_smtp_server_responses ... ok
test tests::test_wire_malformed_and_oversized_smtp_replies ... ok
test tests::test_wire_multiline_ehlo_and_capability_negotiation ... ok
test tests::test_wire_phased_client_preserves_a1_4xx_5xx_classification ... ok
test tests::test_wire_plaintext_boundary_no_tls_handshake_or_starttls ... ok
test tests::test_wire_ehlo_line0_and_greeting_timeout_and_data_non_354 ... ok
test tests::test_wire_stale_during_chunked_streaming_closes_without_terminator_or_commands ... ok
test tests::test_wire_stale_immediately_after_354_drops_socket_without_rset_quit_or_dot ... ok
test tests::test_wire_smtp_command_timeouts ... ok
test pg_tests::test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry ... ok
test pg_tests::test_pg_concurrent_workers_claim_disjoint_rows_and_deliver_once ... ok
test pg_tests::test_pg_data_streaming_fence_reclaim_reaper_and_post_terminator_outcomes ... ok
test pg_tests::test_pg_expired_pending_and_scheduled_reaper ... ok
test pg_tests::test_pg_least_privilege_rbac_enforced ... ok
test pg_tests::test_pg_long_running_delivery_renews_lease_and_blocks_concurrent_steal ... ok
test pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend ... ok
test pg_tests::test_pg_scheduled_promotion_concurrency_is_idempotent ... ok
test pg_tests::test_pg_stale_lease_token_rejected_across_all_fenced_mutations_and_idempotent_completion ... ok
test pg_tests::test_pg_temp_450_perm_550_max_attempts_and_decrypt_retry_log_accuracy ... ok

test result: ok. 46 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 15.32s

RUST_EXIT=0
```
