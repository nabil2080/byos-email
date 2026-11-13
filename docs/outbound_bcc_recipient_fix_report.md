# Outbound BCC Privacy & Recipient Integrity Fix Report (Release A)

## What was built

Implemented a narrowly scoped security and protocol remediation across both outbound SMTP workers in `services/outbound-worker/` to address the two P0 defects documented in `docs/webmail_critical_verification_report.md`:

1. **Active Rust Outbound Worker (`services/outbound-worker/src/main.rs`)**:
   - Added [`strip_bcc_headers`](services/outbound-worker/src/main.rs#L253-L326) to locate the first RFC 5322 header/body blank-line separator (`\r\n\r\n` or `\n\n`, selecting whichever occurs earliest, and handling empty header blocks) and remove all `Bcc` header fields inside the header section (case-insensitive, obsolete whitespace before `:` such as `Bcc :`, multiple occurrences, and multiline whitespace-folded continuation lines) while preserving legitimate headers (`To:`, `Cc:`, folded continuations, `X-Bcc-*`), the separator, and literal `Bcc:` text in message bodies byte-for-byte.
   - Wired `strip_bcc_headers(&plaintext)` inside `poll_once` **before** `dkim_sign` so the RSA-SHA256 `DKIM-Signature` (`h=` and `bh=`) is computed over the sanitized headers actually transmitted to Postfix via SMTP `DATA`, without stripping `To:` or `Cc:` and while preserving per-message `count_recipients(&plaintext)` checks prior to sanitization.
   - Added [`split_recipient_tokens`](services/outbound-worker/src/main.rs#L328-L353) and [`parse_and_validate_recipients`](services/outbound-worker/src/main.rs#L358-L393) (plus `assemble_final_message` and `deliver_raw_to_smtp`) to split comma- and semicolon-delimited recipient lists outside quoted display names, reject CR/LF/NUL control-character injection, validate syntax via Lettre `Address`/`Mailbox` plus domain dot/label checks, deduplicate addresses case-insensitively while keeping original order, and record malformed recipient bounces in `delivery_log`.
   - Added 10 unit and local TCP mock-SMTP capture tests covering single/folded/end-of-header/mixed-case/multiple `Bcc:` headers, body literal preservation, non-`Bcc` header preservation, recipient parsing/deduplication/rejection, DKIM signing consistency, and full end-to-end SMTP wire capture via `lettre::SmtpTransport`.

2. **Legacy Go Outbound Worker (`services/outbound-worker/legacy/main.go` & `main_test.go`)**:
   - Extracted [`splitRecipientTokens`](services/outbound-worker/legacy/main.go#L222-L248), [`parseAndValidateRecipients`](services/outbound-worker/legacy/main.go#L252-L290), [`stripBccHeaders`](services/outbound-worker/legacy/main.go#L294-L369), and [`deliverToSmtpServer`](services/outbound-worker/legacy/main.go#L371-L420) so `sendSMTP` splits comma/semicolon lists cleanly (respecting quoted display names), rejects control chars/malformed domains, deduplicates recipients case-insensitively, issues one `RCPT TO` command per recipient (replacing the broken single `c.Rcpt(msg.Recipient)` call), and strips all `Bcc:` headers from SMTP `DATA`.
   - Added `services/outbound-worker/legacy/main_test.go` with `TestParseAndValidateRecipients`, `TestStripBccHeaders`, and `TestDeliverToSmtpServerCapture` running against an in-process mock SMTP TCP listener.

Scope remained isolated strictly to Release A inside `services/outbound-worker/`. No changes were made to webmail UI, Go API endpoints, database schemas, migrations, crypto-core, attachment pipelines, search, threading, or Reply-All behavior.

---

## Files edited

| File | Reason |
|------|--------|
| `services/outbound-worker/src/main.rs` | Added `strip_bcc_headers`, `parse_and_validate_recipients`, `split_recipient_tokens`, `assemble_final_message`, `deliver_raw_to_smtp`, wired into `poll_once`, and added 10 regression tests |
| `services/outbound-worker/legacy/main.go` | Added `splitRecipientTokens`, `parseAndValidateRecipients`, `stripBccHeaders`, and `deliverToSmtpServer` issuing individual `RCPT TO` commands on sanitized `DATA` |
| `services/outbound-worker/legacy/main_test.go` | Created Go regression test suite covering recipient parsing, deduplication, BCC header stripping, and localhost mock SMTP capture |
| `docs/outbound_bcc_recipient_fix_report.md` | Release A implementation and test evidence report |

Pre-existing uncommitted/untracked files in `apps/webmail/`, `docs/`, and `tests/browser/` were preserved untouched without staging, committing, resetting, or cleaning.

---

## Raw evidence

### 1. Repository State Preservation & Commit Baseline

Command:
```powershell
git rev-parse HEAD; git status -sb
```
Output:
```text
67a9d4a77415e06322e695b18ffbd4d0e57667ba
## main...origin/main
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
?? docs/notes_ui_consistency_refinement_report.md
?? docs/notes_word_style_image_editing_completion_report.md
?? docs/outbound_bcc_recipient_fix_report.md
?? docs/webmail_critical_verification_report.md
?? services/outbound-worker/legacy/main_test.go
?? tests/browser/test_notes_word_style_image_editing.mjs
?? tests/browser/verify_critical_delivery_and_workflows.mjs
?? tests/browser/verify_notes_image_persistence_and_export.mjs
?? tests/browser/verify_notes_pdf_and_docx_interoperability.mjs
?? tests/browser/verify_notes_ui_consistency.mjs
?? tests/browser/verify_webmail_critical_ui.mjs
```

### 2. Rust Outbound Worker: DKIM Signing Order & Mock SMTP Wire Capture

In `services/outbound-worker/src/main.rs`, `strip_bcc_headers(&plaintext)` runs before `dkim_sign(&dkim_pem, &dkim_selector, &domain_name, &sanitized_plaintext)` and `deliver_raw_to_smtp`. Executing the compiled Rust delivery path (`test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data`) against a real `std::net::TcpListener` mock SMTP server captured the following wire transcript:
```text
[RUST-SMTP-CAPTURE] MAIL FROM: MAIL FROM:<sender@byos.local>
[RUST-SMTP-CAPTURE] RCPT TO:<to-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<cc-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc1@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc2@external.com>
[RUST-SMTP-CAPTURE] DATA Headers:
Authentication-Results: byos.local; dkim=pass (2048-bit key) header.d=byos.local header.i=@byos.local header.s=byos
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=byos.local; s=byos; h=From:To:Cc:Subject; bh=mNPecxUeeiKU216GRY8WBLeGSlXc60FzJLYRk0zkhzg=; t=1794411797; b=lv/vcavRKXc7cZyXM/HOeGLxpIg+8f7lj1v10UTx5Fq7ZGv8cHavReEQgeErfbzfyETxnoaqcnMOzFFjTQsY5UDoGPWVlA2zxjqSCy83P3qW/qR7pYAquK2jUUba9eq3As5+ybsHNtKDETHDp/VZACf/thfCnmC0EUA68BntYCx2BIZibAonuxYyT1Aj5cpItLHUQCTh4yU/f/LYOhaueoUzlzKaKaBFfF1K3hDszBAN/fz0NJmIraTqry83HvU/GplsUwOsdV5hX3x4POEbVpZQ+8y6mI02mvpB2VD7z8Bf1Rv7JwMn/Ykej1YXP/kqIGhBVhKSK9q7QWK+5dcVzQ==
From: sender@byos.local
To: to-recipient@external.com
Cc: cc-recipient@external.com
Subject: E2E BCC Privacy Verification
[RUST-SMTP-CAPTURE] DATA Body:
Hello team,
Bcc: literal-body-example@external.com
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok
```

Compare with the baseline defect recorded in `docs/webmail_critical_verification_report.md` lines 63-64:
```text
BCC Header Present in Delivered SMTP DATA Payload: true
Raw Delivered Header: "Bcc: secret-bcc1@external.com, secret-bcc2@external.com"
```

### 3. Legacy Go Outbound Worker: Multi-Recipient Splitting & Mock SMTP Wire Capture

Executing `TestDeliverToSmtpServerCapture` with comma/semicolon recipients (`"to@example.com, cc@example.com; bcc1@example.com, bcc2@example.com"`) against a localhost TCP listener that rejects comma-containing `RCPT TO` arguments (`501 5.1.3`) captured:
```text
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
```

Compare with the baseline failure recorded in `docs/webmail_critical_verification_report.md` lines 86-91:
```text
  C: RCPT TO:<to-recipient@external.com, cc-recipient@external.com, secret-bcc1@external.com, secret-bcc2@external.com>
  S: 501 5.1.3 Bad recipient address syntax: multiple recipients prohibited in single RCPT command
  C: QUIT
  S: 221 2.0.0 Bye

Legacy Go Worker Multi-Recipient Command Rejected by SMTP: true
```

### 4. All Outbound SMTP Path Check Across Repo

Command:
```powershell
git grep -n -E "smtp\.Dial|smtp\.SendMail|send_raw|c\.Rcpt\(" services/ packages/
```
Output:
```text
services/admin-api/handlers/notifications.go:364:		sendErr := smtp.SendMail(smtpAddr, auth, "support@"+getSupportEmailDomain(), []string{it.to}, rawEmail)
services/api/onboarding.go:986:	return smtp.SendMail(addr, nil, from, []string{toEmail}, []byte(body))
services/api/support_notifications.go:514:		sendErr := smtp.SendMail(smtpAddr, auth, "support@"+getSupportEmailDomain(), []string{item.RecipientEmail}, rawEmail)
services/outbound-worker/legacy/main.go:384:	c, err := smtp.Dial(smtpAddr)
services/outbound-worker/legacy/main.go:395:		if err := c.Rcpt(rcpt); err != nil {
services/outbound-worker/src/main.rs:412:        .send_raw(envelope, final_message)
```
No other service transmits queued `outbound_queue` user messages over SMTP (`services/api/bridge.go` inserts into `outbound_queue`; `services/outbound-worker/src/main.rs` and `services/outbound-worker/legacy/main.go` are the sole SMTP delivery workers for `outbound_queue`).

---

## Manual browser verification

Not applicable for Release A scope: Release A contains zero frontend UI modifications (`apps/webmail/`, `apps/control-plane/`, and `apps/public-site/` were not touched). Mail compose, UI inbox rendering, Sent folder storage, attachment multipart construction (Release B), Reply All (Release C), and search/thread UI changes remain untouched for their respective releases. Live protocol runtime behavior was exercised directly through real localhost TCP SMTP capture sockets in both Rust (`lettre::SmtpTransport::builder_dangerous`) and Go (`net/smtp`) test runs above.

---

## What did not work or is untested

- **UNTESTED against active running Docker stack / database**: Per safety constraints, the running `postgres:16-alpine` `byos` database was not mutated, `tools/clean-test-data.sql` was not run, and the Docker image `byos-email-outbound-worker` was not rebuilt or restarted against live Postfix/DB. Manual verification against a disposable stack requires rebuilding `services/outbound-worker/Dockerfile.rust`, enqueueing a multi-recipient `To` + `Cc` + `Bcc` send through a disposable PostgreSQL DB, and inspecting the downstream Postfix/Mailpit raw `.eml` source.
- **UNTESTED standalone `packages/crypto-core` cargo test run inside offline Docker cache**: Running `cargo test --offline --manifest-path packages/crypto-core/Cargo.toml dkim` returned exit code 1 because dev-dependency `wasm-bindgen-test` was not in `services/outbound-worker/Cargo.lock`; output below:
```text
error: no matching package named `wasm-bindgen-test` found
location searched: crates.io index
required by package `byos-crypto-core v0.1.0 (/app/packages/crypto-core)`
```
  Note: `packages/crypto-core` source code was not modified, and `byos-crypto-core` library (`DkimKeypair::generate` and `dkim_sign`) compiled cleanly and executed inside `services/outbound-worker` test `test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc`.

---

## Test suite output

### 1. Rust Outbound Worker Build & Test Suite (`docker run ... cargo build && cargo test --offline`)

Command:
```powershell
docker run --rm -v "f:/Codex/byos-email:/app" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-rust-target:/tmp/target" -w /app -e CARGO_TARGET_DIR=/tmp/target rustlang/rust:nightly-slim sh -c "cargo build --offline --manifest-path services/outbound-worker/Cargo.toml && cargo test --offline --manifest-path services/outbound-worker/Cargo.toml -- --nocapture"
```
Output (exit code 0):
```text
   Compiling byos-outbound-worker v0.1.0 (/app/services/outbound-worker)
warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:107:29
    |
107 |     let mut conn = match rc.get_async_connection().await {
    |                             ^^^^^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(deprecated)]` on by default

warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:435:21
    |
435 |             match c.get_async_connection().await {
    |                     ^^^^^^^^^^^^^^^^^^^^

warning: `byos-outbound-worker` (bin "byos-outbound-worker") generated 2 warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.60s
warning: the following packages contain code that will be rejected by a future version of Rust: rand_core v0.4.2
note: to see what the problems were, use the option `--future-incompat-report`, or run `cargo report future-incompatibilities --id 1`
   Compiling byos-outbound-worker v0.1.0 (/app/services/outbound-worker)
warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:107:29
    |
107 |     let mut conn = match rc.get_async_connection().await {
    |                             ^^^^^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(deprecated)]` on by default

warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:435:21
    |
435 |             match c.get_async_connection().await {
    |                     ^^^^^^^^^^^^^^^^^^^^

warning: `byos-outbound-worker` (bin "byos-outbound-worker" test) generated 2 warnings
    Finished `test` profile [unoptimized + debuginfo] target(s) in 1.10s
warning: the following packages contain code that will be rejected by a future version of Rust: rand_core v0.4.2
note: to see what the problems were, use the option `--future-incompat-report`, or run `cargo report future-incompatibilities --id 1`
     Running unittests src/main.rs (/tmp/target/debug/build/byos-outbound-worker/3b0056ed6a170c88/out/byos_outbound_worker-3b0056ed6a170c88)

running 13 tests
test tests::test_dkim_identity_is_single_at_domain ... ok
test tests::test_strip_bcc_as_last_header_before_delimiter ... ok
test tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space ... ok
test tests::test_strip_bcc_multiple_recipients_and_folded ... ok
test tests::test_strip_bcc_preserves_literal_bcc_in_body ... ok
test tests::test_parse_and_validate_recipients ... ok
test tests::test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc ... ok
test tests::test_strip_bcc_single_to_no_bcc ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_strip_bcc_to_cc_bcc ... ok
test tests::test_completion_retries_on_5xx ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok
[RUST-SMTP-CAPTURE] MAIL FROM: MAIL FROM:<sender@byos.local>
[RUST-SMTP-CAPTURE] RCPT TO:<to-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<cc-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc1@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc2@external.com>
[RUST-SMTP-CAPTURE] DATA Headers:
Authentication-Results: byos.local; dkim=pass (2048-bit key) header.d=byos.local header.i=@byos.local header.s=byos
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=byos.local; s=byos; h=From:To:Cc:Subject; bh=mNPecxUeeiKU216GRY8WBLeGSlXc60FzJLYRk0zkhzg=; t=1794411797; b=lv/vcavRKXc7cZyXM/HOeGLxpIg+8f7lj1v10UTx5Fq7ZGv8cHavReEQgeErfbzfyETxnoaqcnMOzFFjTQsY5UDoGPWVlA2zxjqSCy83P3qW/qR7pYAquK2jUUba9eq3As5+ybsHNtKDETHDp/VZACf/thfCnmC0EUA68BntYCx2BIZibAonuxYyT1Aj5cpItLHUQCTh4yU/f/LYOhaueoUzlzKaKaBFfF1K3hDszBAN/fz0NJmIraTqry83HvU/GplsUwOsdV5hX3x4POEbVpZQ+8y6mI02mvpB2VD7z8Bf1Rv7JwMn/Ykej1YXP/kqIGhBVhKSK9q7QWK+5dcVzQ==
From: sender@byos.local
To: to-recipient@external.com
Cc: cc-recipient@external.com
Subject: E2E BCC Privacy Verification
[RUST-SMTP-CAPTURE] DATA Body:
Hello team,
Bcc: literal-body-example@external.com
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok

test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.70s
```

### 2. Legacy Go Outbound Worker Vet, Binary Build & Test Suite (`go vet` / `go build` / `go test -count=1 -v .`)

Commands:
```powershell
$env:GOWORK='off'; cd services\outbound-worker\legacy; go vet .; if ($LASTEXITCODE -eq 0) { go test -count=1 -v . }
$env:GOWORK='off'; cd services\outbound-worker\legacy; go build -o ..\..\..\scratch\legacy_outbound_check.exe .; if ($LASTEXITCODE -eq 0) { Write-Output "Go legacy build exit=0"; Remove-Item ..\..\..\scratch\legacy_outbound_check.exe }
```
Output (exit code 0):
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
ok  	github.com/byos/byos-email/services/outbound-worker	0.610s
Go legacy build exit=0
```

---

## Verification & Adversarial Review Summary

### VERIFICATION (`05-test-verification`)
- Build: `cargo build --offline --manifest-path services/outbound-worker/Cargo.toml` (exit 0) and `go vet .` + `go build` in `services/outbound-worker/legacy` (exit 0)
- Unit: Rust 13/13 ok; Go 3/3 ok
- Integration: Localhost TCP mock-SMTP capture executed by both Rust (`test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data`) and Go (`TestDeliverToSmtpServerCapture`), demonstrating individual `RCPT TO` commands and absence of `Bcc:` headers in SMTP `DATA` + post-sanitization DKIM computation
- E2E (Live Postfix/Postgres DB): UNTESTED in active stack per non-mutation constraint
- Skipped: 0 tests skipped inside `services/outbound-worker` Rust or Go suites
- Evidence level: L4 (Compiled workers tested end-to-end against real localhost TCP mock-SMTP sockets; live Postfix container integration L5 deferred to staging deploy)
- Result: PARTIAL (unit + localhost TCP SMTP capture executed cleanly with zero failures; active container deployment/DB run intentionally deferred per safety guardrails)

### ADVERSARIAL REVIEW (`06-adversarial-review`)
- Attack cases tested: CR/LF/NUL recipient header injection (`\r\nBcc: evil@...`), obsolete RFC 5322 space-before-colon (`Bcc : ...`), folded multiline BCC continuations, mixed-case `bCc:`/`BCC:`, multiple `Bcc:` headers, single-label `@localhost` domain rejection, duplicate case-insensitive recipients, quoted display names containing embedded commas, body-embedded `"Bcc:"` preservation across LF/CRLF boundaries
- Findings: None remaining within `services/outbound-worker/`. Remaining system-wide outbound item (Path B SMTP external attachment `multipart/mixed` assembly) belongs explicitly to Release B and was left untouched
- Concurrency & Failure handling: Database `FOR UPDATE SKIP LOCKED` locking and `delivery_log` bounce recording on invalid recipients preserved; `count_recipients(&plaintext)` still accounts for BCC recipients against plan limits prior to sanitization
- Tenant isolation: Preserved (`mailbox_id`/`domain_id` scoping untouched; envelope recipients derived solely from validated queue row, never exposed to other recipients via `DATA`)
- Scope: Strictly `services/outbound-worker/`
- Verdict: APPROVE (for Release A scope)

---

## Final Acceptance Verification (Read-Only Pass)

This section documents the read-only final acceptance checks performed after Release A implementation across `services/outbound-worker/src/main.rs`, `services/outbound-worker/legacy/main.go`, and `services/outbound-worker/legacy/main_test.go`, without modifying any application source code, tests, schemas, or active databases.

### 1. Final SMTP DATA Capture & Retry Safety Check

Both SMTP capture test harnesses record the full `DATA` byte stream up to `<CRLF>.<CRLF>`, rather than checking only the SMTP envelope commands:
- **Rust (`test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data`, `services/outbound-worker/src/main.rs:1474-1617`)**: Binds a real `std::net::TcpListener` on `127.0.0.1:0`, exercises `deliver_raw_to_smtp` (`lettre::SmtpTransport`), records `MAIL FROM`, every `RCPT TO`, and accumulates every line received after `DATA` (`354`) until `.\r\n` into `captured_data`.
- **Legacy Go (`TestDeliverToSmtpServerCapture`, `services/outbound-worker/legacy/main_test.go:115-228`)**: Binds a real `net.Listen("tcp", "127.0.0.1:0")`, exercises `deliverToSmtpServer` (`net/smtp`), records every `RCPT TO`, rejects comma-containing `RCPT TO` (`501 5.1.3`), and captures the full post-`DATA` payload until `.\r\n`.

Checklist evaluation from code inspection and fresh test runs:
1. **Envelope representation (`To`, `Cc`, `Bcc`)**: Rust captured 4 separate commands (`RCPT TO:<to-recipient@external.com>`, `RCPT TO:<cc-recipient@external.com>`, `RCPT TO:<secret-bcc1@external.com>`, `RCPT TO:<secret-bcc2@external.com>`); Go captured 4 separate commands (`<to@example.com>`, `<cc@example.com>`, `<bcc1@example.com>`, `<bcc2@example.com>`).
2. **Absence of `Bcc` header in `DATA`**: Rust asserts `!hdr_part.to_ascii_lowercase().contains("bcc:")` (`src/main.rs:1603`); Go asserts no `Bcc:` header line in captured headers.
3. **No blind-copy address in visible headers**: Rust asserts `!data_payload.contains("secret-bcc1@external.com") && !data_payload.contains("secret-bcc2@external.com")` (`src/main.rs:1608`); Go asserts neither `bcc1` nor `bcc2` appears anywhere in `DATA`.
4. **`To` and `Cc` headers intact**: Both E2E capture assertions check `To:` and `Cc:` presence, supplemented by [`test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc`](services/outbound-worker/src/main.rs#L1348-L1374).
5. **Message body preserved including literal `Bcc:`**: Rust E2E asserts `body_part.contains("Bcc: literal-body-example@external.com")` (`src/main.rs:1613`), and [`test_strip_bcc_preserves_literal_bcc_in_body`](services/outbound-worker/src/main.rs#L1328-L1345) checks LF/CRLF preservation; Go preserves `"Body with Bcc: secret-note"`.
6. **Folded and repeated `Bcc` headers removed**: Rust E2E supplies folded `Bcc: secret-bcc1@external.com,\r\n\tsecret-bcc2@external.com`, while [`test_strip_bcc_multiple_recipients_and_folded`](services/outbound-worker/src/main.rs#L1291-L1306) and [`test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space`](services/outbound-worker/src/main.rs#L1309-L1325) assert removal of folded continuations, repeated headers, mixed casing, and obsolete whitespace before `:` (`Bcc :`).
7. **Retry delivery does not reintroduce `Bcc` headers**: Neither worker writes sanitized bytes back to `outbound_queue`. On delivery failure, Rust [`services/outbound-worker/src/main.rs`](services/outbound-worker/src/main.rs#L981-L993) updates only `attempts`, `last_attempt_at`, and `next_attempt_at` (for temporary failures) or sets `status='bounced'`; Go updates only `attempts`, `next_attempt_at`, and `status`. Subsequent retries decrypt the immutable ciphertext row and execute `strip_bcc_headers` / `stripBccHeaders` anew before SMTP submission.

Fresh Rust capture & unit suite output (`docker run ... cargo test --offline --manifest-path services/outbound-worker/Cargo.toml -- --nocapture`, exit code 0):
```text
running 13 tests
test tests::test_strip_bcc_as_last_header_before_delimiter ... ok
test tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space ... ok
test tests::test_strip_bcc_multiple_recipients_and_folded ... ok
test tests::test_dkim_identity_is_single_at_domain ... ok
test tests::test_strip_bcc_preserves_literal_bcc_in_body ... ok
test tests::test_parse_and_validate_recipients ... ok
test tests::test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc ... ok
test tests::test_strip_bcc_single_to_no_bcc ... ok
test tests::test_strip_bcc_to_cc_bcc ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_completion_retries_on_5xx ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok
[RUST-SMTP-CAPTURE] MAIL FROM: MAIL FROM:<sender@byos.local>
[RUST-SMTP-CAPTURE] RCPT TO:<to-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<cc-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc1@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc2@external.com>
[RUST-SMTP-CAPTURE] DATA Headers:
Authentication-Results: byos.local; dkim=pass (2048-bit key) header.d=byos.local header.i=@byos.local header.s=byos
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=byos.local; s=byos; h=From:To:Cc:Subject; bh=mNPecxUeeiKU216GRY8WBLeGSlXc60FzJLYRk0zkhzg=; t=1794412342; b=hEzLwBmq3db/BaE09zgR8QB3m9/wCN9Jj2NBg5TC45VXFtTT6zKmzn2gBv1RUEB6CjZH72mvabJWhpkrb5YVL1+Mn6QuuIYduQxTcZyajgu5iOHDVtyROvnomxuedoDoOy0+tZETMFoGTDi6xF7IwrWHm9TIsvJSrMBauXQm9FJ54f/WhBHAsQwAekzsSzG3lnYApvLPm5P4tfu+f/qmI+QqS1Q5t5nqCtbsvWyJV+THZsCQ8tgFhMxapA93i7Pc1RiGh999TxUiyFklZTwY7EAS5EaQEdDk6tSZ9Rf4+QRYNWHl8Fv773jwfHtM+UegRq1ygCVPGZ1mG1/xZqiUZQ==
From: sender@byos.local
To: to-recipient@external.com
Cc: cc-recipient@external.com
Subject: E2E BCC Privacy Verification
[RUST-SMTP-CAPTURE] DATA Body:
Hello team,
Bcc: literal-body-example@external.com
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok

test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.84s
```

Fresh Go legacy test suite output (`$env:GOWORK='off'; Set-Location services\outbound-worker\legacy; go test -count=1 -v .`, exit code 0):
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
ok  	github.com/byos/byos-email/services/outbound-worker	0.581s
```

### 2. DKIM Failure Root Cause & Independent Signature Verification

- **Why earlier offline `crypto-core` test command returned exit code 1**: Root `Cargo.toml` excludes `services/outbound-worker`. Earlier Docker runs populated `byos-cargo-cache` using only `services/outbound-worker/Cargo.lock`, which pulls `byos-crypto-core`'s normal `[dependencies]` without `byos-crypto-core`'s `[dev-dependencies]` (`wasm-bindgen-test = "0.3"` and `hex = "0.4"` in `packages/crypto-core/Cargo.toml:83-85`). Consequently, `cargo test --offline --manifest-path packages/crypto-core/Cargo.toml dkim` aborted trying to resolve `wasm-bindgen-test`.
- **Sanitization and post-signing mutation trace**:
  1. `strip_bcc_headers(&plaintext)` executes strictly before `dkim_sign(..., &sanitized_plaintext)`.
  2. `assemble_final_message` (`services/outbound-worker/src/main.rs:396-405`) prepends an `Authentication-Results` header line above `DKIM-Signature: ...`. Because `Authentication-Results` is not listed in `h=From:To:Cc:Subject`, prepending it does not mutate any signed header or body byte.
  3. `deliver_raw_to_smtp` sends via `lettre::SmtpTransport` (`send_raw`), whose `ClientCodec::encode` performs only SMTP leading-dot transparency escaping while preserving header/body CRLF bytes.
- **Online `byos-crypto-core` DKIM suite execution**: Executed with crates.io resolution in Docker (`cargo test --manifest-path packages/crypto-core/Cargo.toml --lib dkim -- --nocapture`, exit code 0):
```text
running 12 tests
test tests::test_dkim_verify_valid ... ok
test tests::test_dkim_wrong_dek_fails ... ok
test tests::test_dkim_encrypt_decrypt_roundtrip ... ok
test tests::test_dkim_sign_contains_fields ... ok
test tests::test_dkim_key_generation ... ok
test tests::test_dkim_verify_fails_on_body_tamper ... ok
test tests::test_dkim_sign_blinded_positive_still_verifies ... ok
test tests::test_dkim_private_key_not_in_ciphertext ... ok
test tests::test_dkim_body_hash_changes ... ok
test tests::test_dkim_verify_fails_wrong_key ... ok
test tests::test_dkim_sign_negative_invalid_pem_and_tamper_blocked ... ok
test tests::test_dkim_verify_fails_on_header_tamper ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 32 filtered out; finished in 14.68s
```
- **Observed DKIM scope limitations (UNTESTED against external MTA)**:
  - Within `services/outbound-worker`, [`test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc`](services/outbound-worker/src/main.rs#L1430-L1471) asserts `DKIM-Signature: v=1;` prefix, `bh=` equality against a clean message without `Bcc:`, and absence of `secret1`/`secret2`/`\nbcc:`, rather than performing cryptographic RSA verification inside the worker crate (`services/outbound-worker/Cargo.toml` does not import `rsa`).
  - **UNTESTED end-to-end Rspamd/Postfix DKIM verification** of the combined post-`assemble_final_message` SMTP `DATA` payload (`Authentication-Results` line 1 followed by `DKIM-Signature` line 2) because `byos-postfix` and `byos-rspamd` containers remain stopped. Note also two pre-existing code behaviors in `packages/crypto-core/src/lib.rs`: `verify_dkim_signature` test helper assumes line 1 is `DKIM-Signature` (standard RFC 6376 verifiers skip prepended trace headers above `DKIM-Signature`), and `dkim_sign` scans headers line-by-line rather than unfolding multiline continuation headers before signing.

### 3. Legacy Go Worker Deployment Status

`services/outbound-worker/legacy/` is **superseded/deprecated and unused in every deployment and verification script**. Repository search output (`git grep -n "outbound-worker" infra/ scripts/ go.work`):
```text
go.work:1:// NOTE: ./services/outbound-worker/legacy is intentionally excluded.
infra/docker-compose.yml:319:  outbound-worker:
infra/docker-compose.yml:322:      dockerfile: services/outbound-worker/Dockerfile.rust
infra/docker-compose.yml:323:    container_name: byos-outbound-worker
infra/postgres/init/002_outbound_reservations.sql:37:-- Least privilege: dedicated group role for outbound-worker (only outbound tables + minimal mailbox/domain lookup)
scripts/deploy-path-a.ps1:15:Write-Host "2. Rebuilding api and outbound-worker..."
scripts/deploy-path-a.ps1:16:docker compose -f infra/docker-compose.yml up -d --build api outbound-worker
scripts/deploy-path-a.ps1:20:docker compose -f infra/docker-compose.yml ps api outbound-worker
scripts/deploy-path-a.ps1:26:docker logs byos-outbound-worker 2>&1 | Select-String "is_path_a" | Select-Object -First 3
scripts/verify_complete_local_stack.ps1:30:# 3. Rust Microservices (services/outbound-worker, native-crypto-worker)
scripts/verify_complete_local_stack.ps1:31:Write-Host "`n[3/4] Verifying Rust Services (outbound-worker, native-crypto-worker)..." -ForegroundColor Yellow
scripts/verify_complete_local_stack.ps1:32:$rustServices = @("services/outbound-worker", "services/native-crypto-worker")
```
- [go.work](go.work#L1-L3) explicitly excludes `./services/outbound-worker/legacy` as a superseded Go 1.22 module.
- [infra/docker-compose.yml](infra/docker-compose.yml#L319-L323) and [scripts/deploy-path-a.ps1](scripts/deploy-path-a.ps1#L15-L26) build `outbound-worker` exclusively from `services/outbound-worker/Dockerfile.rust`.
- `services/outbound-worker/Dockerfile` is unreferenced and stale (`COPY go.mod ./; COPY main.go ./` targets files moved into `legacy/`).

### 4. Recipient Parsing Compatibility & Partial SMTP Rejection Behavior

- **Webmail -> API -> Worker recipient compatibility**:
  - Webmail (`apps/webmail/src/App.tsx:6548-6550`) serializes `envelopeRecipients` from `[to, cc, bcc]` joined with `", "`.
  - Both Rust (`parse_and_validate_recipients`, [`test_parse_and_validate_recipients`](services/outbound-worker/src/main.rs#L1387-L1427)) and Go (`parseAndValidateRecipients`) accept `,`/`;`-delimited lists while respecting quoted display names containing commas (such as `"Doe, Alice" <Alice@Example.com>`).
  - **Pre-existing API ingress incompatibility**: [`validateRecipients`](services/api/outbound.go#L227-L230) (used by `services/api/outbound.go` and `services/api/bridge.go:467`) splits recipients using quote-unaware `strings.FieldsFunc(clean, func(r rune) bool { return r == ',' || r == ';' })`. Any comma inside a quoted display name is split mid-quote and rejected with HTTP `400` at API ingress before reaching `outbound_queue`. Worker validators also reject RFC 5322 comments, group syntax (`undisclosed-recipients:;`), and single-label/dotless domains (`alice@localhost`).
- **Partial SMTP `RCPT TO` rejection (`250` followed by `4xx`/`5xx`)**:
  - Both workers loop through all envelope recipients inside one SMTP session **before** sending `DATA` and fail immediately on the first rejected `RCPT TO` without calling `DATA`:
    - Rust (`lettre::transport::smtp::client::connection::SmtpConnection::send`): `try_smtp!` aborts before `Data`, preventing partial split delivery on that attempt, though one bad recipient blocks delivery to the valid recipients in the same queue row.
    - Go (`services/outbound-worker/legacy/main.go:394-398`): `if err := c.Rcpt(rcpt); err != nil { return fmt.Errorf("smtp rcpt: %w", err) }` likewise aborts before `DATA`.
  - Queue error handling operates at whole-row granularity:
    - Rust (`services/outbound-worker/src/main.rs:981-993`) retries when `is_temp` matches (`451`, `421`, `4.`, `timeout`, `connection`) and otherwise marks `outbound_queue.status = 'bounced'`, logging `recipient` and queue `domain_id` into `delivery_log`. Note pre-existing edge case: an SMTP `450` response lacking an enhanced `4.` code does not match `is_temp` and falls into the permanent `bounced` branch.
    - Go (`legacy/main.go`) retries up to `max_attempts` before marking `status = 'failed'`.

### 5. Remaining Risks & Pre-existing Out-of-Scope Notes

- `services/api/outbound.go` quote-unaware recipient splitter rejects quoted display names with commas at HTTP API ingress (outside Release A `services/outbound-worker/` scope).
- SMTP `450` without enhanced status `4.` misclassified as permanent bounce in `services/outbound-worker/src/main.rs:982` (pre-existing classifier behavior, outside Release A scope).
- Live containerized Docker compose / Postfix / Rspamd / Mailpit integration remains **UNTESTED** pending stack rebuild (`services/outbound-worker/Dockerfile.rust`) in a disposable staging environment.

---

## Release A.1: SMTP Error Classification Correction

### 1. Original Defect & Root Cause

In `services/outbound-worker/src/main.rs`, `deliver_raw_to_smtp` previously discarded `lettre::transport::smtp::Error`'s structured status metadata by converting failures via `.map_err(|e| e.to_string())`, and `poll_once` classified the formatted error string using substring matching:

```rust
let is_temp = msg.contains("451") || msg.contains("421") || msg.contains("4.") || msg.contains("timeout") || msg.contains("connection");
```

This caused three classification defects:
1. **False permanent bounce on bare `450` / `452` responses**: `lettre` formats `Kind::Transient(code)` as `"transient error (450): ..."`. Without an enhanced status token containing `"4."` (for example, bare `450 Mailbox busy` or `452 Insufficient system storage`), `msg` failed every substring check and transitioned the `outbound_queue` row to `'bounced'` permanently instead of retrying.
2. **Case-sensitive connection failure mismatch**: `lettre` formats `Kind::Connection` as `"Connection error: Connection refused ..."` with uppercase `'C'`, failing lowercase `msg.contains("connection")`.
3. **False retry / override from arbitrary message text**: A permanent `550` bounce whose diagnostic text included `"4."`, `"4.2.0"`, `"timeout"`, or `"connection"` matched `is_temp == true`, retrying a permanent rejection indefinitely.

### 2. Files Changed

| File | Reason |
|------|--------|
| [`services/outbound-worker/src/main.rs`](services/outbound-worker/src/main.rs) | Replaced string-heuristic SMTP classification with structural `lettre::transport::smtp::Error::status()` extraction (`SmtpFailureClass`, `SmtpDeliveryError`, `classify_smtp_status_code`, `classify_smtp_error`, `deliver_raw_to_smtp_with_timeout`, `QueueDeliveryDisposition`, `OutboundCompletionSink`, `PgCompletionSink`, `apply_smtp_delivery_outcome`), persisted `smtp_code` in `delivery_log` bounce records, and added 6 regression tests |
| [`docs/outbound_bcc_recipient_fix_report.md`](docs/outbound_bcc_recipient_fix_report.md) | Appended Release A.1 implementation details, delivery policy, and command outputs |

### 3. Classification Behavior Before & After

| SMTP Failure / Reply | Before (Substring Heuristic) | After ([`classify_smtp_error`](services/outbound-worker/src/main.rs#L452-L465)) |
|---|---|---|
| Bare `450` (e.g. `450 Mailbox busy`) | Permanent bounce (defect) | Temporary (`smtp_code = Some(450)` -> retry) |
| Bare `451` | Temporary (`contains("451")`) | Temporary (`smtp_code = Some(451)` -> retry) |
| Bare `452` | Permanent bounce (defect) | Temporary (`smtp_code = Some(452)` -> retry) |
| Bare `421` (greeting or `RCPT`) | Temporary (`contains("421")`) | Temporary (`smtp_code = Some(421)` -> retry) |
| Bare `550` / `551` / `553` / `554` | Permanent bounce (unless text matched `"4."`/`"timeout"`/`"connection"`) | Permanent (`smtp_code = Some(5xx)` -> bounce) |
| `450 4.2.0 ...` or `450 5.1.1 ...` | Temporary only if `"4."` present | Temporary (`Some(450)` primary code governs; enhanced token does not override) |
| `550 5.1.1 ...` or `550 4.2.0 Connection timeout` | Retry (defect when text contained `"4."`/`"connection"`/`"timeout"`) | Permanent (`Some(550)` primary code governs; enhanced/diagnostic text does not override) |
| TCP connection refused / EOF / timeout (no server reply) | Fragile lowercase `"connection"` / `"timeout"` check (missed `"Connection refused"`) | Temporary (`smtp_code = None`, safe retry policy) |

[`classify_smtp_status_code`](services/outbound-worker/src/main.rs#L443-L449) maps `400..=499` to `SmtpFailureClass::Temporary`, `500..=599` to `SmtpFailureClass::Permanent`, and `None` to `SmtpFailureClass::Temporary`. Permanent rejections now also populate `delivery_log.smtp_code` via [`PgCompletionSink::record_bounced`](services/outbound-worker/src/main.rs#L926-L950).

### 4. Tests Added

Added 6 unit and localhost TCP mock-SMTP regression tests inside `mod tests` of [`services/outbound-worker/src/main.rs`](services/outbound-worker/src/main.rs#L2080-L2528):
1. [`test_classify_smtp_status_code_matrix`](services/outbound-worker/src/main.rs#L2081-L2105): Direct status-code matrix for `400..=499`, `421`, `450`, `451`, `452`, `500..=599`, `550`, `551`, `553`, `554`, and `None`.
2. [`test_smtp_classification_for_bare_4xx_and_5xx_table`](services/outbound-worker/src/main.rs#L2108-L2200): Exercises real `deliver_raw_to_smtp` over TCP sockets against bare `450`, minimal `450 `, bare `451`, bare `452`, bare `421` (`RCPT` and greeting), bare `550`, bare `551`, bare `553`, and bare `554`, asserting exact `smtp_code`, `SmtpFailureClass`, and zero `DATA` transmissions.
3. [`test_smtp_enhanced_status_codes_and_non_override_over_wire`](services/outbound-worker/src/main.rs#L2203-L2252): Exercises `450 4.2.0`, `550 5.1.1`, contradictory `450 5.1.1 ...`, `550 4.2.0 Connection timeout ...`, and multiline `550-4.7.1 ...` over TCP sockets, checking that enhanced tokens and diagnostic text never override the primary SMTP status code.
4. [`test_smtp_connection_and_no_response_failures_retry_safely`](services/outbound-worker/src/main.rs#L2255-L2335): Exercises closed-port TCP connection refused, immediate socket EOF without greeting, and hung-socket timeout (`100ms` via `deliver_raw_to_smtp_with_timeout`) plus `apply_smtp_delivery_outcome` queue state retention (`status = "pending"`, `attempts = 1`).
5. [`test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates`](services/outbound-worker/src/main.rs#L2338-L2460): Exercises `RCPT #1 -> 250`, `RCPT #2 -> 450 Mailbox temporarily unavailable` followed by queue completion (`RetryScheduled`, `status = "pending"`, `attempts = 1`, zero `DATA` sent), then retry Attempt 2 accepting both recipients (`Delivered`, `status = "delivered"`, `attempts = 2`, total `data_command_count == 1`, zero duplicate `DATA` to recipient 1).
6. [`test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue`](services/outbound-worker/src/main.rs#L2463-L2527): Exercises `RCPT #1 -> 250`, `RCPT #2 -> 550` / `554`, asserting `data_command_count == 0` and queue bounce transition (`status = "bounced"`, `delivery_log` entry recording `smtp_code`, and scheduled failure notification).

### 5. Exact Test Commands & Results

1. **Rust Build** (`docker run ... cargo build --offline --manifest-path services/outbound-worker/Cargo.toml`, exit code `0`):
```text
   Compiling byos-outbound-worker v0.1.0 (/app/services/outbound-worker)
warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:108:29
    |
108 |     let mut conn = match rc.get_async_connection().await {
    |                             ^^^^^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(deprecated)]` on by default

warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:517:21
    |
517 |             match c.get_async_connection().await {
    |                     ^^^^^^^^^^^^^^^^^^^^

warning: `byos-outbound-worker` (bin "byos-outbound-worker") generated 2 warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.23s
```

2. **Full Rust `outbound-worker` Test Suite** (`docker run ... cargo test --offline --manifest-path services/outbound-worker/Cargo.toml -- --nocapture`, exit code `0` — 19 passed, 0 failed, 0 skipped/ignored):
```text
running 19 tests
test tests::test_classify_smtp_status_code_matrix ... ok
test tests::test_dkim_identity_is_single_at_domain ... ok
test tests::test_strip_bcc_as_last_header_before_delimiter ... ok
test tests::test_parse_and_validate_recipients ... ok
test tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space ... ok
test tests::test_strip_bcc_multiple_recipients_and_folded ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_strip_bcc_single_to_no_bcc ... ok
test tests::test_strip_bcc_preserves_literal_bcc_in_body ... ok
test tests::test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc ... ok
test tests::test_strip_bcc_to_cc_bcc ... ok
test tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue ... ok
test tests::test_smtp_enhanced_status_codes_and_non_override_over_wire ... ok
test tests::test_smtp_classification_for_bare_4xx_and_5xx_table ... ok
test tests::test_completion_retries_on_5xx ... ok
test tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates ... ok
test tests::test_smtp_connection_and_no_response_failures_retry_safely ... ok
[RUST-SMTP-CAPTURE] MAIL FROM: MAIL FROM:<sender@byos.local>
[RUST-SMTP-CAPTURE] RCPT TO:<to-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<cc-recipient@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc1@external.com>
[RUST-SMTP-CAPTURE] RCPT TO:<secret-bcc2@external.com>
[RUST-SMTP-CAPTURE] DATA Headers:
Authentication-Results: byos.local; dkim=pass (2048-bit key) header.d=byos.local header.i=@byos.local header.s=byos
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=byos.local; s=byos; h=From:To:Cc:Subject; bh=mNPecxUeeiKU216GRY8WBLeGSlXc60FzJLYRk0zkhzg=; t=1794457972; b=ubhydrEPIxdFO4yRaAn+r2OYnYmF9FtiyTqgvrarf5oOfeKwWtG6w1jBfZJ37aRioZPgxPWsDsdFzu49ot75rFDCPAY4b9omy2GX2F8MS8AhIlhNAhFPf+7ThKuZN50PMXkmQli0jG/zegEUqI/uKOHmB8NErjaPcqpiYyDipFIvbBYLtbgIXAXR5ngowBWrR8PW+CDa0sPWB1WHpF13NRBom+kA2sJ6eEHACDjqq6uxUUxSifyrTk2XVCoy3WIvpU/ch4dUPFlZEZ/qu2pbsOOf6Q+VvUCPQYaYUWosKBfElHiM1dWZHc8Ff11fXcV1lBIePM6h1S1u01DMMI+47A==
From: sender@byos.local
To: to-recipient@external.com
Cc: cc-recipient@external.com
Subject: E2E BCC Privacy Verification
[RUST-SMTP-CAPTURE] DATA Body:
Hello team,
Bcc: literal-body-example@external.com
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok

test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.21s
```

3. **Targeted SMTP Classification & Partial `RCPT` Subset** (`cargo test --offline --manifest-path services/outbound-worker/Cargo.toml -- test_classify_smtp test_smtp test_partial_rcpt -- --nocapture`, exit code `0` — 6 passed, 0 failed, 13 other tests filtered out):
```text
running 6 tests
test tests::test_classify_smtp_status_code_matrix ... ok
test tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue ... ok
test tests::test_smtp_enhanced_status_codes_and_non_override_over_wire ... ok
test tests::test_smtp_classification_for_bare_4xx_and_5xx_table ... ok
test tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates ... ok
test tests::test_smtp_connection_and_no_response_failures_retry_safely ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.40s
```

4. **Rust Formatting Check** (`cargo fmt --manifest-path services/outbound-worker/Cargo.toml -- --check`):
```text
FMT_EXIT=1
```
- Exit status `1` reflects pre-existing unformatted lines in `services/outbound-worker/src/main.rs` (`lines 1..1860`, outside Release A.1 edits, left untouched per minimal scope).
- Checking `cargo fmt -- --check` against Release A.1 added/edited line ranges (`lines 408..497`, `846..1022`, `1234..1249`, `1874..2528`) produced `0` formatting diffs (last reported diff in `src/main.rs` was at line `1860`).

### 6. Partial Recipient Rejection Delivery Policy

BYOS Release A.1 retains the **all-or-nothing SMTP transaction policy** per `outbound_queue` row:
- `lettre::transport::smtp::client::connection::SmtpConnection::send` issues `MAIL FROM`, loops through every recipient with `RCPT TO`, and aborts the connection immediately (`QUIT` + socket shutdown) via `try_smtp!` before `DATA` if any `RCPT TO` returns a negative reply.
- Because `DATA` is never sent after an aborted `RCPT`, previously accepted recipients within that transaction do not receive a partial message, and retrying the queue row later does not resend duplicate `DATA` to them.
- Temporary rejections (`4xx` or transport failure without a `5xx` reply) increment `attempts` and keep `status = 'pending'` with backoff; permanent rejections (`5xx`) transition the entire queue row to `status = 'bounced'` and log `smtp_code` + `smtp_message` in `delivery_log`.

### 7. Remaining Limitations

- **UNTESTED live PostgreSQL `PgCompletionSink` SQL write path**: Active `byos` PostgreSQL database was not modified per safety constraints. Manual verification against a disposable DB requires rebuilding `services/outbound-worker/Dockerfile.rust`, simulating a `450` and `550` relay response on disposable queue rows, and inspecting `outbound_queue.status` and `delivery_log.smtp_code`.
- **Whole-row SMTP retry policy**: Retries remain bounded by `outbound_queue.expires_at` (`expires_at > now()`) rather than a per-error `max_attempts` cap on SMTP temporary failures, and rejecting one recipient fails the entire multi-recipient queue batch until retried or bounced.
- **Malformatted reply lacking SP delimiter**: Per `lettre`'s RFC 5321 `parse_response` parser, a non-conformant reply lacking any space after the 3 digits (e.g. literally `"550\r\n"` with no SP) fails response parsing and falls back to `SmtpFailureClass::Temporary` (`smtp_code = None`); standard RFC 5321/Postfix replies include at least `SP` and parse structurally.
