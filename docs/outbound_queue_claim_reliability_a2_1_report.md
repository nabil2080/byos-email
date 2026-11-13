# Outbound Queue Claiming & SMTP DATA Abort Semantics (Release A.2.1) Report

## What was built

Implemented Release A.2.1 SMTP `DATA`-mode abort semantics, explicit pre-terminator / post-terminator phase separation, durable PostgreSQL lease fencing immediately prior to `<CRLF>.<CRLF>` transmission, wire-transcript protocol tests, migration ordering reconciliation (`069` -> `070`), and `"solo"` rate-limit fallback auditing in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs), [proposed_069_outbound_queue_lease_and_outcomes.sql](file:///f:/Codex/byos-email/infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql), and the design/architecture documents listed below. All PostgreSQL and wire-protocol tests executed exclusively against an ephemeral disposable PostgreSQL 16 container (`byos-pg-a21-test` on `127.0.0.1:5439`, removed after testing) and local in-process mock SMTP/HTTP TCP listeners; the active `byos` PostgreSQL database was not altered.

---

## SMTP `DATA` Protocol Correction

### Why `lettre::AsyncSmtpConnection` was replaced on the phased relay path

Inspection of `lettre 0.11.23` (`async_connection.rs:154-390`) showed two protocol constraints:
1. `AsyncSmtpConnection::abort()` (`async_connection.rs:250-257`) unconditionally issues `QUIT` unless an internal `panic` flag is tripped, which would inject literal `QUIT\r\n` bytes into the message body if called after `354 End with <CRLF>.<CRLF>`.
2. `AsyncSmtpConnection::message()` / `message_iter()` (`async_connection.rs:313-333`) bundle RFC 5321 dot-stuffing, `<CRLF>.<CRLF>` termination, and final reply reading into one non-interruptible private step, making it impossible to re-verify lease validity in PostgreSQL after streaming the message body and right before transmitting `<CRLF>.<CRLF>`.

### Custom Tokio RFC 5321 Wire Client (`deliver_raw_to_smtp_phased_impl`)

`deliver_raw_to_smtp_phased_with_timeout` and crate-private `deliver_raw_to_smtp_phased_impl` in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs#L1340-L1760) now drive a `tokio::net::TcpStream` client directly:
- **Pre-`DATA` (`claimed` / `pre_data`):** Executes greeting, `EHLO`, capability checks (`SMTPUTF8`, `8BITMIME`), `on_before_mail` (`pre_data`), `MAIL FROM`, `RCPT TO`, and `DATA` (`354`). Pre-`DATA` errors or stale leases call `close_command_mode_cleanly` (`RSET` when a mail transaction opened + `QUIT`).
- **`DATA` streaming (`data_streaming`):** After `354`, invokes `on_data_streaming` (`mark_smtp_phase(..., SmtpPhase::DataStreaming)`). If stale, closes the `TcpStream` immediately without sending body bytes, `<CRLF>.<CRLF>`, `RSET`, or `QUIT` (`StaleLeaseAbortedInDataStreaming`). Applies RFC 5321 §4.5.2 CRLF dot-stuffing via `smtp_dot_stuff_body` (`\r\n.` / leading `.` -> `..`, selecting `.\r\n` when trailing CRLF is present and `\r\n.\r\n` otherwise) and streams chunks without sending the end-of-data marker yet. Any abort or I/O error drops the socket directly without `RSET`/`QUIT`/`.\r\n`.
- **Pre-terminator DB fence & marker (`terminator_in_flight`):** After flushing all message body bytes, calls `on_before_terminator` -> `mark_smtp_phase(..., SmtpPhase::TerminatorInFlight)` (`WHERE id = $1 AND lease_token = $2 AND status = 'processing' AND lease_expires_at > clock_timestamp()`).
  - If `Ok(false)` (stale/expired/reclaimed lease): drops TCP socket immediately without sending `<CRLF>.<CRLF>`, `RSET`, or `QUIT` (`StaleLeaseAbortedInDataStreaming`).
  - If `Err(...)` (DB outage before marker write): drops TCP socket immediately without `<CRLF>.<CRLF>`, `RSET`, or `QUIT` and propagates `Err` so the row remains in `data_streaming` (retryable upon reaper cleanup, not `outcome_unknown`).
  - Only after `Ok(true)`: transmits the end-of-data marker and reads the final SMTP reply.
- **Post-terminator settlement:**
  - `2xx` -> `Delivered { smtp_code }` -> `record_delivered_leased(..., smtp_code)` sets `status = 'delivered', smtp_phase = 'accepted_by_mta', last_smtp_code = smtp_code`.
  - Explicit `4xx` / `5xx` -> `RejectedAfterTerminator` (temporary `4xx` stays retryable `pending` + `'retry'` log; permanent `5xx` transitions to `'bounced'`).
  - Socket EOF, TCP reset, or read timeout after marker transmission -> `AmbiguousAfterTerminator` -> `record_outcome_unknown_leased` sets `status = 'outcome_unknown', smtp_phase = 'terminator_in_flight'` with zero automatic resends.
- **Concurrent Heartbeat Interaction:** Inside `process_claimed_outbound_item`, `tokio::select!` cancels and drops `smtp_fut` if `renew_lease` returns `Ok(false)` prior to setting `terminator_in_flight_flag`, closing the underlying `TcpStream` before `<CRLF>.<CRLF>` without emitting `RSET`/`QUIT`. Once `terminator_in_flight_flag` is set, lease-renewal loss does not cancel awaiting the final MTA reply.

---

## Final `smtp_phase` Definitions & Reaper Rules

| `smtp_phase` | Meaning | Safely Reclaimable / Retryable on Lease Loss? | Reaper (`reap_stale_and_expired`) Behavior on Expired Lease | `outbound_queue` / `delivery_log` Result |
|---|---|---|---|---|
| `claimed` | Claimed in DB transaction; SMTP `MAIL` not yet sent | Yes (`claim_outbound_batch` & reaper) | Releases to `pending` (or `'expired'` if `expires_at <= now()`; `'bounced'` if `attempts >= max_attempts`) | `'retry'` / `'expired'` / `'bounced'` |
| `pre_data` | `EHLO` succeeded; sending `MAIL FROM` / `RCPT TO` / `DATA` | Yes (`claim_outbound_batch` & reaper) | Releases to `pending` (or `'expired'` / `'bounced'` on TTL/attempt exhaustion) | `'retry'` / `'expired'` / `'bounced'` |
| `data_streaming` | Entered SMTP `354`; streaming body bytes BEFORE `<CRLF>.<CRLF>` | Yes (`claim_outbound_batch` & reaper; old worker DB-fenced before marker) | Releases to `pending`, clears `smtp_phase = NULL` (or `'expired'`/`'bounced'` on limits) | `'retry'` / `'expired'` / `'bounced'` |
| `terminator_in_flight` | Durable fence succeeded; transmitting `<CRLF>.<CRLF>` or awaiting reply | **Never** (duplicate-delivery risk) | Transitions `status = 'processing'` -> `'outcome_unknown'`, preserves `smtp_phase = 'terminator_in_flight'` | `'outcome_unknown'` (no false scheduled failure callback) |
| `accepted_by_mta` | Positive `2xx` final SMTP reply observed before full commit/crash | **Never** re-sent | Transitions expired lease to `status = 'delivered'`, notifies scheduled completion `"delivered"` | `'delivered'` |

`proposed_069_outbound_queue_lease_and_outcomes.sql` normalizes any prior `'data_in_flight'` row to `'terminator_in_flight'` and enforces `outbound_queue_smtp_phase_check` over `('claimed', 'pre_data', 'data_streaming', 'terminator_in_flight', 'accepted_by_mta')`.

---

## `"solo"` Rate-Limit Fallback Audit

Inspection across PostgreSQL migrations, Go API handlers, and the Rust outbound worker showed:
1. `infra/postgres/init/004_rate_limits.sql` seeded `rate_limits` tiers (`solo`, `starter`, `business`, `team`, `business_plus`, `enterprise`, where `solo` = `5/50/200` mailbox and `10/100/400` org per minute/hour/day with `100` max recipients) alongside `plan` columns on `organizations` and `mailboxes`.
2. `infra/postgres/init/055_seat_based_pricing.sql` dropped `organizations.plan` and `mailboxes.plan` cleanly in favor of seat-based billing (`seat_count`), leaving the `rate_limits` table unchanged.
3. Both Go handlers in `services/api/outbound.go:428-429` (`outboundSendHandler`) and `services/api/bridge.go:507` already supply `"solo"` uniformly.
4. `services/outbound-worker/src/main.rs:818, 2624-2625` likewise supplies `"solo"` and `local_part`. Note that `rate_limits` tiers control per-mailbox and per-org send counters only and do not throttle worker claim concurrency.
5. **Decision & Scope Tradeoff:** Retained `"solo"` in Release A.2.1 to preserve quota parity between `services/api` and `services/outbound-worker` without silently changing billing/quota policy. As a known limitation until a coordinated API + Worker `seat_count` policy is designed, multi-seat organizations (`seat_count > 1`) share `"solo"` org-wide caps (`10/min`, `100/hr`, `400/day`).

---

## Migration Numbering Reconciliation (`069` -> `070`)

Reconciled rollout order across repository specs and reports without applying either migration to the active `byos` database:
1. `infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql` — Release A.2 / A.2.1 outbound queue lease columns, `smtp_phase` check (`claimed`, `pre_data`, `data_streaming`, `terminator_in_flight`, `accepted_by_mta`), `processing` / `outcome_unknown` status constraints, and `delivery_log` deduplication indexes.
2. `docs/attachment_delivery_schema_migration_proposal.md` — Updated proposed target filename to `infra/postgres/init/070_attachment_encryption_v2_and_delivery.sql` following `069_outbound_queue_lease_and_outcomes.sql`.
3. `docs/attachment_delivery_internal_api_spec.md` — Already sequenced `070` after `069`; updated internal lease-gating wording to exclude `terminator_in_flight`/`accepted_by_mta` alongside settled states.
4. `docs/external_attachment_delivery_implementation_report.md` & `docs/outbound_queue_claim_reliability_report.md` — Reconciled `069` -> `070` references and cross-referenced Release A.2.1's `AsyncSmtpConnection` replacement and refined phase lifecycle.

---

## Files edited

| File | Reason |
|---|---|
| `services/outbound-worker/src/main.rs` | Replaced `lettre::AsyncSmtpConnection` in phased relay with Tokio RFC 5321 wire client (`smtp_dot_stuff_body`, socket-close abort in `DATA` mode without `RSET`/`QUIT`), split `SmtpPhase` into 5 explicit phases with `lease_expires_at > clock_timestamp()` terminator fencing, updated reaper/claim SQL & outcomes, and added wire-transcript + PostgreSQL integration tests |
| `infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql` | Updated `outbound_queue_smtp_phase_check` to `('claimed', 'pre_data', 'data_streaming', 'terminator_in_flight', 'accepted_by_mta')` with safe `'data_in_flight'` -> `'terminator_in_flight'` normalization |
| `docs/attachment_delivery_schema_migration_proposal.md` | Reconciled proposed Release B1 attachment migration number from `069` to `070` ordered after `069_outbound_queue_lease_and_outcomes.sql` |
| `docs/attachment_delivery_internal_api_spec.md` | Excluded `terminator_in_flight`/`accepted_by_mta` alongside settled states in internal manifest authorization rules |
| `docs/external_attachment_delivery_implementation_report.md` | Reconciled `069` -> `070` references and appended Release A.2.1 status summary |
| `docs/outbound_queue_claim_reliability_report.md` | Added top supersession/refinement notice linking to Release A.2.1 report while preserving Release A.2 historical output |
| `docs/outbound_queue_claim_reliability_a2_1_report.md` | Authored Release A.2.1 implementation report with verbatim tool outputs |

*(All pre-existing modified files under `apps/webmail/`, `services/outbound-worker/legacy/`, and pre-existing untracked docs/test scripts were preserved untouched.)*

---

## Raw evidence

### 1. Repository State (`git rev-parse HEAD` & `git status --short`)

```text
67a9d4a77415e06322e695b18ffbd4d0e57667ba
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
?? docs/outbound_queue_claim_reliability_report.md
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

### 2. Disposable PostgreSQL 16 Schema & Idempotency Check (`byos_a2_test` on port `5439`)

Two consecutive executions of `proposed_069_outbound_queue_lease_and_outcomes.sql` with `-v ON_ERROR_STOP=1` after loading `infra/postgres/init/001`..`068`:

```text
ALL_67_INIT_APPLIED
ALTER TABLE
DO
NOTICE:  constraint "outbound_queue_smtp_phase_check" of relation "outbound_queue" does not exist, skipping
DO
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
ALTER TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
DO
PROPOSED_069_PASS_1_OK
NOTICE:  column "lease_token" of relation "outbound_queue" already exists, skipping
NOTICE:  column "lease_owner" of relation "outbound_queue" already exists, skipping
NOTICE:  column "claimed_at" of relation "outbound_queue" already exists, skipping
NOTICE:  column "lease_expires_at" of relation "outbound_queue" already exists, skipping
NOTICE:  column "smtp_phase" of relation "outbound_queue" already exists, skipping
NOTICE:  column "last_smtp_code" of relation "outbound_queue" already exists, skipping
NOTICE:  column "last_error" of relation "outbound_queue" already exists, skipping
ALTER TABLE
DO
DO
NOTICE:  relation "idx_outbound_queue_claimable" already exists, skipping
CREATE INDEX
CREATE INDEX
NOTICE:  relation "idx_outbound_queue_processing_lease" already exists, skipping
CREATE INDEX
NOTICE:  relation "idx_outbound_queue_pending_expiry" already exists, skipping
NOTICE:  relation "idx_outbound_queue_outcome_unknown" already exists, skipping
CREATE INDEX
NOTICE:  column "lease_token" of relation "delivery_log" already exists, skipping
NOTICE:  column "smtp_phase" of relation "delivery_log" already exists, skipping
ALTER TABLE
NOTICE:  relation "idx_delivery_log_outbound_settled_unique" already exists, skipping
CREATE INDEX
NOTICE:  relation "idx_delivery_log_outbound_unknown_unique" already exists, skipping
CREATE INDEX
CREATE INDEX
NOTICE:  relation "idx_delivery_log_outbound_attempt_unique" already exists, skipping
DO
PROPOSED_069_PASS_2_IDEMPOTENT_OK
```

`\d outbound_queue` and `\d delivery_log` on disposable `byos_a2_test`:

```text
Command: docker exec byos-pg-a21-test psql -U byos -d byos_a2_test -c "\d outbound_queue" -c "\d delivery_log"
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
 lease_token             | uuid                     |           |          | 
 lease_owner             | text                     |           |          | 
 claimed_at              | timestamp with time zone |           |          | 
 lease_expires_at        | timestamp with time zone |           |          | 
 smtp_phase              | text                     |           |          | 
 last_smtp_code          | integer                  |           |          | 
 last_error              | text                     |           |          | 
Indexes:
    "outbound_queue_pkey" PRIMARY KEY, btree (id)
    "idx_outbound_queue_claimable" btree (next_attempt_at) WHERE status = 'pending'::text
    "idx_outbound_queue_delivery" btree (delivery_id)
    "idx_outbound_queue_outbox_seq" btree (mailbox_id, outbox_seq)
    "idx_outbound_queue_outcome_unknown" btree (failed_at DESC) WHERE status = 'outcome_unknown'::text
    "idx_outbound_queue_pending_expiry" btree (expires_at) WHERE status = 'pending'::text
    "idx_outbound_queue_processing_lease" btree (lease_expires_at) WHERE status = 'processing'::text
    "idx_outbound_queue_reservation" UNIQUE, btree (reservation_id)
    "idx_outbound_queue_status" btree (status, next_attempt_at)
    "outbound_queue_delivery_id_key" UNIQUE CONSTRAINT, btree (delivery_id)
Check constraints:
    "outbound_queue_processing_lease_check" CHECK (status = 'processing'::text AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL OR status <> 'processing'::text AND lease_token IS NULL AND lease_expires_at IS NULL)
    "outbound_queue_smtp_phase_check" CHECK (smtp_phase IS NULL OR (smtp_phase = ANY (ARRAY['claimed'::text, 'pre_data'::text, 'data_streaming'::text, 'terminator_in_flight'::text, 'accepted_by_mta'::text])))
    "outbound_queue_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'accepted_by_mta'::text, 'delivered'::text, 'bounced'::text, 'expired'::text, 'outcome_unknown'::text]))
Foreign-key constraints:
    "outbound_queue_domain_id_fkey" FOREIGN KEY (domain_id) REFERENCES domains(id)
    "outbound_queue_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
    "outbound_queue_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES outbound_reservations(reservation_id)

                            Table "public.delivery_log"
    Column    |           Type           | Collation | Nullable |      Default      
--------------+--------------------------+-----------+----------+-------------------
 id           | uuid                     |           | not null | gen_random_uuid()
 delivery_id  | uuid                     |           | not null | 
 direction    | text                     |           | not null | 
 mailbox_id   | uuid                     |           |          | 
 domain_id    | uuid                     |           |          | 
 sender       | text                     |           |          | 
 recipient    | text                     |           |          | 
 status       | text                     |           | not null | 
 smtp_code    | integer                  |           |          | 
 smtp_message | text                     |           |          | 
 created_at   | timestamp with time zone |           | not null | now()
 lease_token  | uuid                     |           |          | 
 smtp_phase   | text                     |           |          | 
Indexes:
    "delivery_log_pkey" PRIMARY KEY, btree (id)
    "idx_delivery_log_delivery" btree (delivery_id)
    "idx_delivery_log_outbound_attempt_unique" UNIQUE, btree (delivery_id, lease_token, status) WHERE direction = 'outbound'::text AND lease_token IS NOT NULL
    "idx_delivery_log_outbound_settled_unique" UNIQUE, btree (delivery_id) WHERE direction = 'outbound'::text AND (status = ANY (ARRAY['delivered'::text, 'bounced'::text, 'expired'::text]))
    "idx_delivery_log_outbound_unknown_unique" UNIQUE, btree (delivery_id) WHERE direction = 'outbound'::text AND status = 'outcome_unknown'::text
Check constraints:
    "delivery_log_direction_check" CHECK (direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))
Foreign-key constraints:
    "delivery_log_domain_id_fkey" FOREIGN KEY (domain_id) REFERENCES domains(id)
    "delivery_log_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id)
```

### 3. Active `byos` PostgreSQL Database Unmodified (`byos-postgres`, port `5432`)

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
Indexes:
    "outbound_queue_pkey" PRIMARY KEY, btree (id)
    "idx_outbound_queue_delivery" btree (delivery_id)
    "idx_outbound_queue_outbox_seq" btree (mailbox_id, outbox_seq)
    "idx_outbound_queue_reservation" UNIQUE, btree (reservation_id)
    "idx_outbound_queue_status" btree (status, next_attempt_at)
    "outbound_queue_delivery_id_key" UNIQUE CONSTRAINT, btree (delivery_id)
Check constraints:
    "outbound_queue_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'accepted_by_mta'::text, 'delivered'::text, 'bounced'::text, 'expired'::text]))
Foreign-key constraints:
    "outbound_queue_domain_id_fkey" FOREIGN KEY (domain_id) REFERENCES domains(id)
    "outbound_queue_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
    "outbound_queue_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES outbound_reservations(reservation_id)
```

### 4. Binary + Test Compilation Check (`cargo check --offline --all-targets`)

```text
Command: docker run --rm -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-rust-target:/workspace/services/outbound-worker/target" -w /workspace/services/outbound-worker rustlang/rust:nightly-slim cargo check --offline --all-targets
Command exited with code 0.
    Checking byos-outbound-worker v0.1.0 (/workspace/services/outbound-worker)
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

warning: `byos-outbound-worker` (bin "byos-outbound-worker") generated 2 warnings
warning: `byos-outbound-worker` (bin "byos-outbound-worker" test) generated 2 warnings (2 duplicates)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.08s
```

---

## Manual browser verification

N/A — Backend Rust outbound worker SMTP protocol, PostgreSQL queue reliability, and architecture documentation updates only; no webmail, control-plane, or public-site UI code changed.

---

## What did not work or is **UNTESTED**

- **Live rollout against the active `byos` PostgreSQL database:** **UNTESTED** (prohibited by task safety constraints). Before running the updated `outbound-worker` binary against a live environment, manual operators must:
  1. Promote `infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql` into `infra/postgres/init/069_outbound_queue_lease_and_outcomes.sql` and run it with `psql -v ON_ERROR_STOP=1`.
  2. Start `outbound-worker` and confirm zero errors from `verify_queue_lease_schema` and `verify_least_privilege`.
  3. Trigger multi-worker outbound relays and inspect `outbound_queue` / `delivery_log`.
- **Live external Postfix / remote MX traffic:** **UNTESTED** (external SMTP and DNS prohibited). All wire-protocol transcripts and state transitions executed against in-process mock SMTP listeners (`WireTranscriptSmtpServer` / `spawn_phased_mock_smtp`).
- **Multi-seat org quota tiering (`seat_count > 1`):** **UNTESTED** / out of scope; multi-seat organizations share `"solo"` caps (`10/min`, `100/hr`, `400/day`) across both `services/api` and `services/outbound-worker` until a unified seat-aware rate policy is implemented.
- **Release B2 attachment encryption & internal manifest endpoints (`070`):** **UNTESTED** (design/numbering reconciled only).
- **Pre-existing Redis deprecation warnings (`src/main.rs:125, 534`):** Unmodified in this release to stay strictly within scope.

---

## Test suite output

```text
Command: docker run --rm --add-host=host.docker.internal:host-gateway -e "OUTBOUND_TEST_PG_URL=postgres://outbound_worker_login:byos_outbound_worker_dev@host.docker.internal:5439/byos_a2_test?sslmode=disable" -e "OUTBOUND_TEST_ADMIN_PG_URL=postgres://byos:byos_dev_password@host.docker.internal:5439/byos_a2_test?sslmode=disable" -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-rust-target:/workspace/services/outbound-worker/target" -w /workspace/services/outbound-worker rustlang/rust:nightly-slim cargo test --offline
Command exited with code 0.

   Compiling byos-outbound-worker v0.1.0 (/workspace/services/outbound-worker)
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
    Finished `test` profile [unoptimized + debuginfo] target(s) in 2.80s
warning: the following packages contain code that will be rejected by a future version of Rust: rand_core v0.4.2
note: to see what the problems were, use the option `--future-incompat-report`, or run `cargo report future-incompatibilities --id 1`
     Running unittests src/main.rs (target/debug/build/byos-outbound-worker/6cb07df31c721e60/out/byos_outbound_worker-6cb07df31c721e60)

running 36 tests
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
test tests::test_smtp_enhanced_status_codes_and_non_override_over_wire ... ok
test tests::test_strip_bcc_as_last_header_before_delimiter ... ok
test tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space ... ok
test tests::test_strip_bcc_multiple_recipients_and_folded ... ok
test tests::test_strip_bcc_preserves_literal_bcc_in_body ... ok
test tests::test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc ... ok
test tests::test_strip_bcc_single_to_no_bcc ... ok
test tests::test_strip_bcc_to_cc_bcc ... ok
test tests::test_wire_db_error_at_terminator_fence_aborts_without_marker_and_body_write_drop_fails_streaming ... ok
test tests::test_wire_dot_stuffing_and_clean_250_delivery ... ok
test tests::test_wire_stale_during_chunked_streaming_closes_without_terminator_or_commands ... ok
test tests::test_wire_stale_immediately_after_354_drops_socket_without_rset_quit_or_dot ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok
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

test result: ok. 36 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.90s
```

---

## Release A.2.2 Transport Security & Wire Protocol Acceptance

See [outbound_smtp_transport_security_report.md](file:///f:/Codex/byos-email/docs/outbound_smtp_transport_security_report.md) for the full Release A.2.2 audit and raw evidence. Key conclusions and hardening updates:

- **No TLS / AUTH regression:** `HEAD` (`SmtpTransport::builder_dangerous`), Release A.2 (`AsyncSmtpConnection::connect_tokio1(..., None, None)`), `Cargo.toml` (`lettre` without TLS features), and legacy Go (`smtp.Dial`) all used unauthenticated plaintext SMTP to internal `POSTFIX_ADDR` (`postfix:25`). The Release A.2.1 Tokio TCP client matches that exact internal Docker network boundary (`docs/08-v5.3-final.md §13.8`, `infra/docker-compose.yml` port `25` internal-only), while external MX / SES TLS remains managed independently by `byos-postfix` (`infra/postfix/init/10-byos-routing.sh`).
- **SMTP parser repairs (`read_smtp_reply` & `EhloCapabilities::from_lines` in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs#L1187-L1304)):** Bounded single-line buffering with `AsyncReadExt::take(2049).read_until`, rejected mid-line EOF without trailing `\n` (`UnexpectedEof`), validated `sep` (`'-'`, `' '`, `None`) prior to UTF-8 slicing `&trimmed[4..]`, enforced RFC 5321 `(200..=599)` reply code range, and skipped EHLO line 0 (`Domain [ehlo-greet]`) when parsing ESMTP capabilities.
- **Wire & PG regression suite (`46 passed; 0 failed` on disposable `byos_a22_test`):**

```text
Command: docker run --rm --add-host=host.docker.internal:host-gateway -v "${PWD}:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-rust-target:/target" -w /workspace/services/outbound-worker -e CARGO_TARGET_DIR=/target -e OUTBOUND_TEST_PG_URL="postgres://outbound_worker_login:byos_outbound_worker_dev@host.docker.internal:5439/byos_a22_test?sslmode=disable" -e OUTBOUND_TEST_ADMIN_PG_URL="postgres://byos:byos_dev_password@host.docker.internal:5439/byos_a22_test?sslmode=disable" rustlang/rust:nightly-slim sh -c "cargo check --offline --all-targets && cargo test --offline"
Command exited with code 0.
     Running unittests src/main.rs (/target/debug/build/byos-outbound-worker/6cb07df31c721e60/out/byos_outbound_worker-6cb07df31c721e60)

running 46 tests
...
test result: ok. 46 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.03s
```
