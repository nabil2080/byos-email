# Outbound SMTP Transport Security & Wire Protocol Acceptance Report (Release A.2.2)

## Summary of inspection and remediation

Performed a focused inspection and targeted hardening of the custom Tokio RFC 5321 SMTP wire client (`deliver_raw_to_smtp_phased_impl`, `read_smtp_reply`, `EhloCapabilities::from_lines`, and `smtp_dot_stuff_body`) introduced in Release A.2.1 in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs). Established from `HEAD` (`67a9d4a77415e06322e695b18ffbd4d0e57667ba`), Release A.2, legacy Go worker code, `Cargo.toml`, `infra/docker-compose.yml`, `infra/postfix/`, and live read-only `postconf` output that no TLS or SMTP AUTH downgrade occurred between the prior `lettre` client and the custom Tokio TCP client: both communicate strictly over plaintext SMTP to the internal `postfix:25` relay on the private Docker network, while Postfix handles external MX/relay TLS independently. During the SMTP response-parser audit, five concrete defects were identified and repaired (`read_smtp_reply` unbounded single-line buffering before limit check, accepting EOF without a newline as a valid reply line, UTF-8 slicing `&trimmed[4..]` before validating the byte separator at index `3`, accepting out-of-range SMTP status codes outside `200..=599`, and `EhloCapabilities::from_lines` scanning EHLO line 0 `Domain [ehlo-greet]` as an ESMTP capability keyword), and 10 deterministic wire-protocol, boundary, timeout, dot-stuffing, and DKIM-preservation tests were added and executed alongside the existing Release A/A.1/A.2/A.2.1 suites (46 tests executed against a disposable PostgreSQL 16 container on port `5439`, leaving the active `byos` PostgreSQL database unmodified).

---

## Files edited

| File | Reason |
|---|---|
| `services/outbound-worker/src/main.rs` | Imported `AsyncReadExt`; hardened `read_smtp_reply` (`take(2049).read_until`, strict `\n` termination check before EOF, separator validation prior to UTF-8 slice `&trimmed[4..]`, `200..=599` status code validation); updated `EhloCapabilities::from_lines` to skip RFC 5321 §4.1.1.1 line 0 (`Domain [ehlo-greet]`); and added 10 Release A.2.2 SMTP wire, boundary, timeout, dot-stuffing, and DKIM preservation tests |
| `docs/outbound_smtp_transport_security_report.md` | Authored Release A.2.2 SMTP transport security and wire protocol acceptance report with verbatim command and diff evidence |
| `docs/outbound_queue_claim_reliability_a2_1_report.md` | Appended the final Release A.2.2 transport-security acceptance summary and cross-reference |

*(Pre-existing uncommitted modifications and untracked files in `apps/webmail/`, `services/outbound-worker/legacy/`, `infra/postgres/migrations_unapplied/`, `docs/`, and `tests/browser/` were preserved untouched.)*

---

## 1. Previous vs. New SMTP Transport Behavior

### Previous implementations (`HEAD`, Release A.2, and legacy Go worker)

1. **`HEAD` (`67a9d4a77415e06322e695b18ffbd4d0e57667ba`) `lettre::SmtpTransport::builder_dangerous`:**
   `HEAD` [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs) (and the retained legacy sync helper `deliver_raw_to_smtp_with_timeout` in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs)) constructed the relay transport with `SmtpTransport::builder_dangerous(postfix_host).port(postfix_port)`. Per `lettre 0.11.23` (`src/transport/smtp/transport.rs:130-143`), `builder_dangerous` configures `Tls::None`, no SMTP credentials, and no STARTTLS negotiation.

   ```text
   Command: git show HEAD:services/outbound-worker/src/main.rs | Select-String -Pattern "SmtpTransport|builder_dangerous|POSTFIX_ADDR" -Context 2,2
   Command exited with code 0.
   >     let postfix_addr = env::var("POSTFIX_ADDR").unwrap_or_else(|_| "postfix:25".into());
   ...
   >         let (postfix_host, postfix_port) = parse_postfix_addr(postfix_addr);
   >         let mailer = SmtpTransport::builder_dangerous(postfix_host).port(postfix_port).build();
   ```

2. **Release A.2 (`lettre::AsyncSmtpConnection`):**
   Release A.2 connected via `AsyncSmtpConnection::connect_tokio1((postfix_host.as_str(), postfix_port), timeout, &ClientId::Domain(...), None, None)` with `tls_parameters = None`, never called `starttls()`, and never issued `AUTH`.
3. **Cargo feature evidence (`services/outbound-worker/Cargo.toml:15`):**
   `lettre` was declared with `default-features = false, features = ["tokio1", "smtp-transport", "builder"]` — no `lettre` TLS feature (`tokio1-rustls`, `tokio1-native-tls`, `rustls`, `native-tls`) was enabled.
4. **Legacy Go worker (`services/outbound-worker/legacy/main.go:384`):**
   Used `smtp.Dial(cfg.PostfixAddr)` defaulting to `localhost:25` with plaintext SMTP, no `StartTLS`, and no `Auth`.

### New implementation (Release A.2.1 / A.2.2 Tokio TCP client)

`deliver_raw_to_smtp_phased_impl` in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs) connects directly using `tokio::net::TcpStream::connect((postfix_host.as_str(), postfix_port))` to `POSTFIX_ADDR` (default `"postfix:25"` in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs) and `infra/docker-compose.yml:337`):

- **Plaintext SMTP:** Yes — plaintext TCP socket on port `25`.
- **STARTTLS negotiated:** No.
- **Implicit TLS:** No.
- **SMTP AUTH:** No.
- **Configured relay hostname and port:** `POSTFIX_ADDR` (defaults to `postfix:25`).
- **Exclusive internal Postfix connection:** Yes — `outbound-worker` accepts a single `POSTFIX_ADDR` relay target configured inside the Compose network (`postfix:25`) and performs no direct MX lookups.

---

## 2. TLS, Authentication & Trust Boundary Decision

### No TLS downgrade occurred

Both the prior `lettre` client (`SmtpTransport::builder_dangerous` in `HEAD`, `AsyncSmtpConnection::connect_tokio1(..., None, None)` in Release A.2) and the new Tokio TCP client communicate exclusively via unauthenticated plaintext SMTP over internal port `25`. Therefore, replacing `lettre::AsyncSmtpConnection` with `deliver_raw_to_smtp_phased_impl` did **not** introduce a TLS or authentication downgrade.

### Worker-to-Postfix internal trust boundary

Per frozen architecture design (`docs/08-v5.3-final.md:226-228` §13.8), `outbound-worker -> Postfix` communicates over internal `postfix:25` inside the isolated Docker Compose network using `mynetworks` trust (`permit_mynetworks`) without SASL authentication. In `infra/docker-compose.yml:58-84`, Postfix publishes only `"127.0.0.1:2525:587"` to the loopback host interface; port `25` is not bound to the host and is reachable only on the internal Docker network.

### External Postfix-to-MX / upstream relay TLS behavior (separate boundary)

Outbound delivery from Postfix to external MX hosts or upstream SMTP relays operates under a distinct security boundary configured in `infra/postfix/init/10-byos-routing.sh:30-58` and live `byos-postfix` `main.cf`:

```text
Command: docker exec byos-postfix postconf smtp_tls_security_level smtpd_tls_security_level smtpd_tls_auth_only relayhost mynetworks smtpd_recipient_restrictions
Command exited with code 0.
smtp_tls_security_level = may
smtpd_tls_security_level = may
smtpd_tls_auth_only = no
relayhost = [mailpit]:1025
mynetworks = 127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
smtpd_recipient_restrictions = permit_mynetworks, reject_unauth_destination
```

- When routing externally via Amazon SES (`*email-smtp*|*amazonaws.com*`), `infra/postfix/init/10-byos-routing.sh:34-49` enforces `smtp_tls_security_level = encrypt` alongside SASL (`smtp_sasl_auth_enable = yes`).
- For general direct MX delivery (`smtp_tls_security_level = may`), Postfix opportunistically negotiates STARTTLS with destination MX servers independently of how `outbound-worker` injects mail into `postfix:25`. (In local Compose dev, `relayhost = [mailpit]:1025` intercepts outbound mail into Mailpit.)

### Future TLS compatibility path (if worker-to-relay ever crosses an untrusted network)

If a future deployment sets `POSTFIX_ADDR` to an external relay outside a trusted private network, plaintext SMTP would be unsafe. No custom TLS wrapper was added here because internal `postfix:25` is the intended boundary, and `services/outbound-worker/Cargo.toml:18` already enables `reqwest`'s `rustls-tls` stack (`tokio-rustls`, `rustls`, `rustls-pki-types`, `rustls-webpki` are present in `services/outbound-worker/Cargo.lock`), allowing a minimal `tokio-rustls` STARTTLS/implicit-TLS integration with full WebPKI certificate & hostname verification without disabling certificate checks.

---

## 3. SMTP Response Parser Assessment & Fixes Applied

Audited `read_smtp_reply`, `EhloCapabilities::from_lines`, and `deliver_raw_to_smtp_phased_impl` in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs):

| Protocol Aspect | Behavior Observed / Hardened |
|---|---|
| Three-digit status code | Enforces `trimmed.len() >= 3`, ASCII digits in `&trimmed.as_bytes()[..3]`, and valid RFC 5321 range `(200..=599).contains(&code)`, rejecting non-numeric, short, or out-of-range (`0xx`, `1xx`, `6xx`–`9xx`) lines with `InvalidData`. |
| Multiline hyphen continuation (`-`) | Loops on `sep == Some(b'-')`, enforces identical numeric code across every line in the reply (`prev != code` -> `InvalidData`), and terminates only when `sep == Some(b' ')` or `None` (bare 3-digit code). |
| `EHLO` capability parsing | `EhloCapabilities::from_lines` skips line 0 (`Domain [ehlo-greet]` per RFC 5321 §4.1.1.1) and scans the first whitespace token on `lines[1..]` case-insensitively for `SMTPUTF8` and `8BITMIME`; uses `BODY=8BITMIME` and `SMTPUTF8` on `MAIL FROM` only when advertised. |
| `HELO` fallback | Not supported (returns explicit error if `EHLO` is rejected), matching `lettre::AsyncSmtpConnection` (`docs` / Postfix ESMTPA expectation). |
| `RCPT` / `DATA 354` / final reply | `RCPT` requires `2xx`; `DATA` requires exact `354`; final reply after `<CRLF>.<CRLF>` maps `2xx` -> `Delivered`, `4xx`/`5xx` -> `RejectedAfterTerminator` (preserving Release A.1 structural `classify_smtp_status_code`), and EOF/reset/timeout -> `AmbiguousAfterTerminator`. |
| `DATA`-mode command isolation | `read_smtp_reply` is never called during body streaming (`DATA` content lines such as `QUIT`, `RSET`, `250`, or `550` are written only as body payload and never parsed). `close_command_mode_cleanly` (`RSET`/`QUIT`) is callable only pre-`354` or after final reply. |
| Command & response timeouts | Every connect, `read_smtp_reply`, `write_and_flush_all`, and full-body streaming phase is wrapped in `tokio::time::timeout(io_timeout, ...)` (default `60s`, configurable via `OUTBOUND_SMTP_TIMEOUT_SECS`). |
| Line-length & total-reply bounds | `MAX_REPLY_LINE_BYTES = 2048` and `MAX_REPLY_TOTAL_BYTES = 100_000`. |

### Concrete parser defects found and repaired in `read_smtp_reply` & `EhloCapabilities::from_lines`

1. **Unbounded pre-check line buffering (DoS risk):** `reader.read_line(&mut line)` previously allocated and buffered an arbitrarily long server line in memory before checking `n > MAX_REPLY_LINE_BYTES`. Replaced with `AsyncReadExt::take(&mut *reader, (MAX_REPLY_LINE_BYTES + 1) as u64).read_until(b'\n', &mut raw_line)` so a single line read stops after `2049` bytes and immediately returns `InvalidData`.
2. **Truncated final line on EOF:** Previously `if !raw_line.ends_with(b"\n")` was not checked, causing a socket closing mid-reply immediately after a code (e.g. `"250"` or `"250 OK"` with no `\r\n`) to be accepted as a valid `250` completion. Now returns `UnexpectedEof` (`"truncated SMTP reply line before newline"`).
3. **Panic hazard on multi-byte UTF-8 at byte offset `3`:** Previously `&trimmed[4..]` ran before checking `trimmed.as_bytes().get(3)`, which would panic if byte index `3` fell inside a multi-byte UTF-8 sequence (e.g., `"250é\r\n"`). Validated `matches!(sep, Some(b'-') | Some(b' ') | None)` prior to slicing `&trimmed[4..]`.
4. **Out-of-range SMTP reply codes (`000`–`199`, `600`–`999`) accepted:** Previously `read_smtp_reply` parsed any 3 ASCII digits without checking `(200..=599).contains(&code)`, allowing invalid codes like `999` or `000` to be treated as SMTP replies (and recorded as `last_smtp_code`). Now returns `InvalidData` (`"out-of-range SMTP reply code: ..."`), matching RFC 5321 §4.2.1 and `lettre::response`.
5. **`EHLO` line 0 parsed as a capability keyword:** Previously `EhloCapabilities::from_lines` scanned `for line in lines`, so an `EHLO` greeting banner starting with `8BITMIME` or `SMTPUTF8` on line 0 (`250-Domain [ehlo-greet]`) could be misread as an advertised capability. Now skips line 0 (`lines.iter().skip(1)`) per RFC 5321 §4.1.1.1.

Observed `read_smtp_reply` & `EhloCapabilities::from_lines` implementation after repair ([main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs#L1187-L1304)):

```rust
1188:     fn from_lines(lines: &[String]) -> Self {
1189:         let mut caps = Self::default();
1190:         // RFC 5321 §4.1.1.1: line 0 of an EHLO 250 response is always `Domain [ SP ehlo-greet ]`.
1191:         // Capability keywords only appear on subsequent lines.
1192:         for line in lines.iter().skip(1) {
...
1219:         let n = AsyncReadExt::take(&mut *reader, (MAX_REPLY_LINE_BYTES + 1) as u64)
1220:             .read_until(b'\n', &mut raw_line)
1221:             .await?;
...
1232:         if n > MAX_REPLY_LINE_BYTES || total_bytes > MAX_REPLY_TOTAL_BYTES {
...
1238:         if !raw_line.ends_with(b"\n") {
1239:             return Err(std::io::Error::new(
1240:                 std::io::ErrorKind::UnexpectedEof,
1241:                 "truncated SMTP reply line before newline",
1242:             ));
1243:         }
...
1261:         if !(200..=599).contains(&code) {
1262:             return Err(std::io::Error::new(
1263:                 std::io::ErrorKind::InvalidData,
1264:                 format!("out-of-range SMTP reply code: {}", code),
1265:             ));
1266:         }
...
1278:         let sep = trimmed.as_bytes().get(3).copied();
1279:         if !matches!(sep, Some(b'-') | Some(b' ') | None) {
1280:             return Err(std::io::Error::new(
1281:                 std::io::ErrorKind::InvalidData,
1282:                 format!("invalid SMTP reply separator: {}", trimmed),
1283:             ));
1284:         }
1285:         let body_text = if trimmed.len() > 4 {
1286:             trimmed[4..].to_string()
```

---

## 4. Byte Preservation & Dot-Stuffing Evidence

Audited `smtp_dot_stuff_body` ([main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs#L1135-L1172)):

- **State machine (`StartOfNewLine` -> `AfterCr` -> `MiddleOfLine`):** Begins in `StartOfNewLine`, transitions to `AfterCr` on `\r`, returns to `StartOfNewLine` on `\n` immediately after `AfterCr`, and duplicates `.` -> `..` whenever `.` occurs in `StartOfNewLine` (both at byte `0` of the message and immediately after any `\r\n`, including `..\r\n` and `.` alone on a line).
- **Empty body and trailing CRLF handling:**
  - Empty body `b""` produces `(b"", b"\r\n.\r\n")`.
  - Input ending in `\r\n` emits `terminator = b".\r\n"`, forming `<CRLF>.<CRLF>` together with the payload's trailing `\r\n` without adding an extra blank CRLF that would alter a signed MIME body.
  - Input not ending in `\r\n` emits `terminator = b"\r\n.\r\n"`, properly framing the SMTP end-of-data sequence.
- **No premature end-of-data marker & DKIM preservation:** A literal line `"\r\n.\r\n"` inside the body is stuffed to `"\r\n..\r\n"`. `test_wire_dkim_preserved_bytes_after_dot_unstuffing` generates an RSA-2048 DKIM-signed RFC 5322 message containing leading `.`, `\r\n.\r\n`, `\r\n..\r\n`, and `Bcc:` headers, delivers it through `deliver_raw_to_smtp_phased_impl` over loopback TCP, dot-unstuffs the received wire DATA bytes, and asserts byte-for-byte equality with `final_message` and (after stripping the prepended `Authentication-Results` header) the exact DKIM-signed `signed` byte slice, alongside asserting that the stripped `Bcc:` recipient is absent.

---

## 5. Tests Executed & Verbatim Evidence

### Disposable PostgreSQL 16 Initialization (`127.0.0.1:5439`, removed after run)

Initialized `byos_a22_test` with all 67 `infra/postgres/init/*.sql` files (`049_masked_domain_dkim.sql` ran without `ON_ERROR_STOP=1` because its seed `org_id` `00000000-0000-0000-0000-000000000aaa` is absent from base `organizations` in init schema) plus `infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql` with `-v ON_ERROR_STOP=1`:

```text
Command: docker exec byos-pg-a22-test ... + init/*.sql + proposed_069_outbound_queue_lease_and_outcomes.sql
Command exited with code 0.
Initialized 67 init scripts + proposed_069 successfully.
```

### Full Rust Compilation & Test Suite (`cargo check --offline --all-targets && cargo test --offline`)

Executed against `byos_a22_test` on `127.0.0.1:5439` and local loopback mock TCP/SMTP/HTTP servers:

```text
Command: docker run --rm --add-host=host.docker.internal:host-gateway -v "${PWD}:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-rust-target:/target" -w /workspace/services/outbound-worker -e CARGO_TARGET_DIR=/target -e OUTBOUND_TEST_PG_URL="postgres://outbound_worker_login:byos_outbound_worker_dev@host.docker.internal:5439/byos_a22_test?sslmode=disable" -e OUTBOUND_TEST_ADMIN_PG_URL="postgres://byos:byos_dev_password@host.docker.internal:5439/byos_a22_test?sslmode=disable" rustlang/rust:nightly-slim sh -c "cargo check --offline --all-targets && cargo test --offline"
Command exited with code 0.
    Checking byos-outbound-worker v0.1.0 (/workspace/services/outbound-worker)
...
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.67s
...
    Finished `test` profile [unoptimized + debuginfo] target(s) in 2.41s
     Running unittests src/main.rs (/target/debug/build/byos-outbound-worker/6cb07df31c721e60/out/byos_outbound_worker-6cb07df31c721e60)

running 46 tests
test tests::test_classify_smtp_status_code_matrix ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_compute_retry_backoff_bounded ... ok
test tests::test_dkim_identity_is_single_at_domain ... ok
test tests::test_completion_retries_on_5xx ... ok
test pg_tests::test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry ... ok
test tests::test_parse_and_validate_recipients ... ok
test tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue ... ok
test tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates ... ok
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok
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
test tests::test_phased_smtp_post_data_disconnect_and_timeout_return_ambiguous ... ok
test pg_tests::test_pg_concurrent_workers_claim_disjoint_rows_and_deliver_once ... ok
test tests::test_wire_data_mode_body_commands_not_interpreted_and_no_rset_quit ... ok
test tests::test_wire_dot_stuffing_and_clean_250_delivery ... ok
test tests::test_wire_ehlo_line0_and_greeting_timeout_and_data_non_354 ... ok
test tests::test_wire_incomplete_smtp_server_responses ... ok
test tests::test_wire_malformed_and_oversized_smtp_replies ... ok
test tests::test_wire_multiline_ehlo_and_capability_negotiation ... ok
test tests::test_wire_phased_client_preserves_a1_4xx_5xx_classification ... ok
test tests::test_wire_plaintext_boundary_no_tls_handshake_or_starttls ... ok
test tests::test_wire_db_error_at_terminator_fence_aborts_without_marker_and_body_write_drop_fails_streaming ... ok
test tests::test_wire_stale_during_chunked_streaming_closes_without_terminator_or_commands ... ok
test tests::test_wire_stale_immediately_after_354_drops_socket_without_rset_quit_or_dot ... ok
test pg_tests::test_pg_data_streaming_fence_reclaim_reaper_and_post_terminator_outcomes ... ok
test pg_tests::test_pg_least_privilege_rbac_enforced ... ok
test tests::test_wire_smtp_command_timeouts ... ok
test pg_tests::test_pg_long_running_delivery_renews_lease_and_blocks_concurrent_steal ... ok
test pg_tests::test_pg_expired_pending_and_scheduled_reaper ... ok
test pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend ... ok
test pg_tests::test_pg_scheduled_promotion_concurrency_is_idempotent ... ok
test pg_tests::test_pg_stale_lease_token_rejected_across_all_fenced_mutations_and_idempotent_completion ... ok
test tests::test_wire_dkim_preserved_bytes_after_dot_unstuffing ... ok
test pg_tests::test_pg_temp_450_perm_550_max_attempts_and_decrypt_retry_log_accuracy ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok

test result: ok. 46 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.03s
```

### Active `byos-postgres` Preservation Verification

```text
Command: docker exec byos-postgres psql -U byos -d byos -c "\d outbound_queue"
Command exited with code 0.
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

---

## 6. Remaining Limitations & UNTESTED Areas

1. **Retained legacy sync helper:** `deliver_raw_to_smtp_with_timeout` (`SmtpTransport::builder_dangerous`) remains in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs) solely for Release A/A.1 sync unit tests; `process_claimed_outbound_item` uses `deliver_raw_to_smtp_phased_with_timeout` exclusively.
2. **Internal-network plaintext assumption:** Plaintext TCP to `POSTFIX_ADDR` assumes a trusted internal Docker/VPC segment per `docs/08-v5.3-final.md §13.8`; pointing `POSTFIX_ADDR` at an external or untrusted relay without adding `tokio-rustls` STARTTLS/TLS + WebPKI certificate validation would expose SMTP traffic.
3. **No `HELO` fallback:** If a downstream relay rejects `EHLO`, the phased client aborts pre-`DATA` rather than falling back to `HELO` (matching `lettre::AsyncSmtpConnection`).
4. **CRLF line-ending scope in `smtp_dot_stuff_body`:** `smtp_dot_stuff_body` treats `\r\n` (not bare `\n`) as the RFC 5321 line boundary (matching `lettre::ClientCodec`). Note that live `byos-postfix` (`Postfix 3.10.5`) runs with `smtpd_forbid_bare_newline = normalize`, so un-normalized MIME payloads containing bare `\n.\r\n` would have bare `\n` converted to `\r\n` by Postfix unless callers supply canonical CRLF MIME before DKIM signing (as `dkim_sign` and Webmail MIME builders do).
5. **Non-ASCII capability rejection classification:** When `has_non_ascii_addresses && !caps.supports_smtputf8` or `!final_message.is_ascii() && !caps.supports_8bitmime`, `deliver_raw_to_smtp_phased_impl` returns `SmtpFailureClass::Permanent` (`smtp_code: None`), whereas `lettre::AsyncSmtpConnection` returned `error::client` (previously mapped by Release A.1 to `Temporary`). Both are pre-DATA rejections; the new behavior avoids futile retry loops on an internal relay lacking `SMTPUTF8`/`8BITMIME`.
6. **Whole-body `io_timeout` during streaming:** `stream_res` bounds the entire body-streaming write+flush loop with `io_timeout` (default `60s`) rather than per-chunk I/O; very large messages over slow links require increasing `OUTBOUND_SMTP_TIMEOUT_SECS`.
7. **Live relay / external MX / active DB delivery (UNTESTED):** Live `byos-postfix` -> Mailpit/SES/external MX TLS handshakes and applying `proposed_069_outbound_queue_lease_and_outcomes.sql` to active `byos-postgres` are **UNTESTED** in this run due to safety constraints forbidding production/external SMTP operations and active DB modifications. To verify manually in staging: apply `069`, enqueue a test email targeting an external TLS-enabled MX, inspect Postfix `smtp` TLS logs (`Trusted TLS connection established`), and confirm clean delivery.
