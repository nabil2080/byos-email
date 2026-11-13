# Outbound Queue Claiming & Delivery Reliability (Release A.2) Report

> **Superseded / Refined in Release A.2.1:** See [outbound_queue_claim_reliability_a2_1_report.md](file:///f:/Codex/byos-email/docs/outbound_queue_claim_reliability_a2_1_report.md) for the subsequent SMTP `DATA`-mode abort semantics fix (`lettre::AsyncSmtpConnection` replaced by custom Tokio RFC 5321 wire client; no `RSET`/`QUIT` inside `DATA` mode; `data_in_flight` refined into `data_streaming`, `terminator_in_flight`, and `accepted_by_mta` with a durable DB fence before `<CRLF>.<CRLF>`). The pasted test outputs below reflect the initial Release A.2 baseline prior to Release A.2.1.

## What was built

Implemented atomic PostgreSQL queue claiming, monotonic lease fencing, concurrent heartbeat renewal, phased SMTP checkpointing, bounded retry backoff, `delivery_log` deduplication, expired-row reaping, and post-`DATA` `outcome_unknown` quarantine in [main.rs](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs). Authored idempotent unapplied migration [proposed_069_outbound_queue_lease_and_outcomes.sql](file:///f:/Codex/byos-email/infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql), reconciled [attachment_delivery_internal_api_spec.md](file:///f:/Codex/byos-email/docs/attachment_delivery_internal_api_spec.md) (`status = 'processing'`, `X-Lease-Token`, `lease_expires_at > now()`, excluding `'outcome_unknown'`), and updated [external_attachment_delivery_implementation_report.md](file:///f:/Codex/byos-email/docs/external_attachment_delivery_implementation_report.md) with the Release A.2 status summary. Execution ran exclusively against an isolated disposable PostgreSQL 16 container (`byos_a2_test` with least-privilege `outbound_worker_login`) and local in-process mock SMTP/HTTP servers; the active `byos` PostgreSQL database was not modified.

---

## Root-Cause Findings Addressed

1. **Autocommit Lock Loss Across `poll_once` and `poll_scheduled`:** Previously, `SELECT ... FOR UPDATE SKIP LOCKED` executed on autocommit `client.query(...)`, immediately dropping row locks before rate checking, decryption, DKIM signing, or SMTP I/O began.
   - `poll_scheduled` (`services/outbound-worker/src/main.rs`) now executes inside an explicit `client.transaction()`, holding row locks on `scheduled_messages` through quota evaluation, `INSERT INTO outbound_queue ... ON CONFLICT (delivery_id) DO NOTHING`, and `scheduled_messages.status` transitions (`'processing'` or `'failed'`).
   - `claim_outbound_batch` (`services/outbound-worker/src/main.rs`) atomically claims up to `batch_size` due `'pending'` rows (or reclaims expired `status = 'processing' AND smtp_phase IN ('claimed', 'pre_data')` leases) in one `CTE` inside a SQL transaction, assigning a fresh UUIDv4 `lease_token`, `lease_owner`, `claimed_at`, `lease_expires_at`, `attempts = attempts + 1`, and `smtp_phase = 'claimed'`.
2. **Latent `mailboxes.plan` / `organizations.plan` Schema Drift Bug:** `055_seat_based_pricing.sql` dropped the `plan` column from `organizations` and `mailboxes` (`outbound_worker` also lacked `SELECT` privilege on `plan`). Both `poll_scheduled` and `process_claimed_outbound_item` now select `org_id::text` (plus `local_part` in the worker send loop) and supply `"solo"` to the in-memory limit table, eliminating silent query failures.
3. **False `'bounced'` Entries and Unbounded Retries in `delivery_log`:** Non-terminal `4xx` / transient failures previously inserted `'bounced'` into `delivery_log` even when `status` stayed `'pending'` for retry, and transient PostgreSQL errors during `poll_scheduled` / scheduled expiry lacked parity.
   - Non-terminal retries now transition back to `status = 'pending'`, clear lease columns, compute bounded exponential backoff via `compute_retry_backoff` (`30s * 2^attempt` capped at `3600s`, respecting `expires_at`), and insert `delivery_log` with `status = 'retry'` keyed on `(delivery_id, lease_token, status)`.
   - Partial unique indexes (`idx_delivery_log_outbound_settled_unique`, `idx_delivery_log_outbound_unknown_unique`, `idx_delivery_log_outbound_attempt_unique`) enforce at most one terminal `'delivered'`/`'bounced'`/`'expired'` row or `'outcome_unknown'` row per outbound `delivery_id`, and idempotent per-attempt logging per `lease_token`.
4. **Ambiguous Post-`DATA` Network Loss vs. Pre-`DATA` Failure:** Retrying blindly after sending `<CRLF>.<CRLF>` (or crashing mid-`DATA`) risks duplicate email delivery to external recipients.
   - `deliver_raw_to_smtp_phased_with_timeout` drives `lettre`'s `AsyncSmtpConnection`, invoking a pre-SMTP callback (`smtp_phase = 'pre_data'`) and a lease-fenced `mark_smtp_phase(..., SmtpPhase::DataInFlight)` callback strictly after server acceptance of `RCPT TO` (`354` `DATA` open) and before transmitting the email body + `<CRLF>.<CRLF>`.
   - If the `mark_smtp_phase` fence returns `LeaseFenceResult::StaleLease`, the worker sends `RSET`/`QUIT` and aborts before sending message data.
   - Transport drops or socket timeouts before `'data_in_flight'` classify via Release A.1 (`Temporary` retry), whereas socket drops or timeouts after `'data_in_flight'` return `SmtpDeliveryOutcome::AmbiguousPostData` and transition the row cleanly to terminal `status = 'outcome_unknown'` via `record_outcome_unknown_leased` with zero automatic resends.
5. **Heartbeat Renewal & Stale-Worker Fencing:** During slow SMTP sends, `process_claimed_outbound_item` races the delivery future against an async interval calling `renew_lease` (`WHERE delivery_id = $1 AND status = 'processing' AND lease_token = $2`). Every DB write (`renew_lease`, `mark_smtp_phase`, `release_for_rate_limit`, `record_delivered_leased`, `record_retry_leased`, `record_bounced_leased`, `record_outcome_unknown_leased`) enforces that exact `status = 'processing' AND lease_token = $2` predicate.
6. **Expired-Row & Crash Reaper (`reap_stale_and_expired`):** Each poll tick sweeps:
   - Expired `processing` leases stuck in `'data_in_flight'` -> quarantined to `'outcome_unknown'` (notifying scheduled completion `'failed'`);
   - Expired `processing` leases in `'claimed'`/`'pre_data'` past `expires_at` -> marked `'expired'` (or reclaimed for retry in `claim_outbound_batch` if `attempts < max_attempts`);
   - Expired `'pending'` queue rows (`expires_at <= now()`) -> marked `'expired'` with a single `'expired'` `delivery_log` entry and scheduled failure callback;
   - Expired Path B `'pending'` `scheduled_messages` (`expires_at <= now()`).
7. **Least-Privilege Diagnostic Bug in `verify_least_privilege`:** `tokio_postgres::Error::to_string()` formats generically as `"db error"`; updated to inspect `e.as_db_error().map(|d| d.message())` so permission denials on `root_secrets`, `message_metadata`, etc. are evaluated accurately against the server message.

---

## State & Schema Summary

| State / Phase | `outbound_queue` Mutation | `delivery_log` Status | Auto-Retry | Scheduled Callback |
|---|---|---|---|---|
| Claimed (`claim_outbound_batch`) | `status = 'processing'`, `lease_token = uuid`, `lease_expires_at`, `attempts + 1`, `smtp_phase = 'claimed'` | None until outcome | N/A | None |
| SMTP Pre-`DATA` (`mark_smtp_phase`) | `smtp_phase = 'pre_data'` (fenced by `lease_token`) | None until outcome | Yes on `Temporary` | None until terminal |
| SMTP `DATA` Open (`mark_smtp_phase`) | `smtp_phase = 'data_in_flight'` BEFORE writing body/`<CRLF>.<CRLF>` | None until outcome | Blocked after `data_in_flight` | None until terminal |
| Post-`DATA` Accept (`2xx`) | `status = 'delivered'`, `delivered_at = now()`, lease cols cleared | `'delivered'` | No | `"sent"` |
| Temporary Fail pre-`DATA` (`attempts < max_attempts`, before `expires_at`) | `status = 'pending'`, `next_attempt_at` backoff (`30s`–`3600s`), lease cols cleared | `'retry'` | Yes | None |
| Permanent `5xx` / Exhausted `max_attempts` / Validation Fail | `status = 'bounced'`, `failed_at = now()`, lease cols cleared | `'bounced'` | No | `"failed"` |
| Post-`DATA` I/O Loss or Expired `data_in_flight` Lease | `status = 'outcome_unknown'`, `failed_at = now()`, lease cols cleared | `'outcome_unknown'` | No (prevents duplicates) | `"failed"` |
| Expired `pending` or Expired Pre-`DATA` past `expires_at` | `status = 'expired'`, `failed_at = now()`, lease cols cleared | `'expired'` | No | `"failed"` |

---

## Files edited

| File | Reason |
|---|---|
| `services/outbound-worker/src/main.rs` | Implemented transactional `poll_scheduled`, atomic lease claiming, heartbeat renewal, phased `AsyncSmtpConnection` checkpoints, retry/bounce/`outcome_unknown` fencing, expired reaper, `mailboxes.plan` fix, and 12 new unit/wire/Postgres integration tests |
| `infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql` | Authored unapplied idempotent SQL migration adding `outbound_queue` lease/phase/status constraints + indexes, `delivery_log` deduplication unique indexes, and least-privilege `REVOKE` guards |
| `docs/attachment_delivery_internal_api_spec.md` | Reconciled Release B1 internal endpoint preconditions (`status = 'processing'`, `X-Lease-Token`, `lease_expires_at > now()`, `outcome_unknown` exclusion, `409`/`410` responses, and `069`->`070` rollout order) |
| `docs/external_attachment_delivery_implementation_report.md` | Recorded Release A.2 queue-reliability implementation status (`B1.1-07`) and linked to this report |
| `docs/outbound_queue_claim_reliability_report.md` | Added Release A.2 implementation report and verbatim execution evidence |

*(Pre-existing modified files in `apps/webmail/`, `services/outbound-worker/legacy/main.go`, `services/outbound-worker/legacy/main_test.go`, and pre-existing untracked docs/browser scripts from prior tasks were preserved untouched.)*

---

## Raw evidence

### 1. Repository State After Edits (`git rev-parse HEAD` and `git status --short`)

```text
Command: git rev-parse HEAD; git status --short
Exit code: 0
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

### 2. Isolated PostgreSQL 16 Schema Inspection, Idempotency Re-Apply, and Untouched Active `byos` Check

First command (comparing isolated `byos_a2_test` against live untouched `byos`):
```text
Command: docker exec byos-pg-a2-test psql -U byos -d byos_a2_test -v ON_ERROR_STOP=1 -c "\d outbound_queue" -c "\d delivery_log"; docker exec byos-postgres psql -U byos -d byos -c "\d outbound_queue" -c "\d delivery_log"
Command exited with code 0.

Command output:
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
    "outbound_queue_smtp_phase_check" CHECK (smtp_phase IS NULL OR (smtp_phase = ANY (ARRAY['claimed'::text, 'pre_data'::text, 'data_in_flight'::text])))
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
Indexes:
    "delivery_log_pkey" PRIMARY KEY, btree (id)
    "idx_delivery_log_delivery" btree (delivery_id)
Check constraints:
    "delivery_log_direction_check" CHECK (direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))
Foreign-key constraints:
    "delivery_log_domain_id_fkey" FOREIGN KEY (domain_id) REFERENCES domains(id)
    "delivery_log_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id)
```

Second command (idempotent re-application of `proposed_069_outbound_queue_lease_and_outcomes.sql` and disposable container teardown):
```text
Command: Get-Content "infra\postgres\migrations_unapplied\proposed_069_outbound_queue_lease_and_outcomes.sql" -Raw | docker exec -i byos-pg-a2-test psql -U byos -d byos_a2_test -v ON_ERROR_STOP=1; docker rm -f byos-pg-a2-test
Command exited with code 0.

Command output:
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
CREATE INDEX
NOTICE:  relation "idx_outbound_queue_claimable" already exists, skipping
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
CREATE INDEX
NOTICE:  relation "idx_delivery_log_outbound_unknown_unique" already exists, skipping
CREATE INDEX
NOTICE:  relation "idx_delivery_log_outbound_attempt_unique" already exists, skipping
DO
byos-pg-a2-test
```

### 3. Binary & Test Target Compilation Check (`cargo check --offline --all-targets`)

```text
Command: docker run --rm -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-rust-target:/workspace/services/outbound-worker/target" -w /workspace/services/outbound-worker rustlang/rust:nightly-slim cargo check --offline --all-targets
Command exited with code 0.
(Relevant tail output:)
    Checking byos-crypto-core v0.1.0 (/workspace/packages/crypto-core)
    Checking byos-outbound-worker v0.1.0 (/workspace/services/outbound-worker)
warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:122:29
    |
122 |     let mut conn = match rc.get_async_connection().await {
    |                             ^^^^^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(deprecated)]` on by default

warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:531:21
    |
531 |             match c.get_async_connection().await {
    |                     ^^^^^^^^^^^^^^^^^^^^

warning: `byos-outbound-worker` (bin "byos-outbound-worker") generated 2 warnings
warning: `byos-outbound-worker` (bin "byos-outbound-worker" test) generated 2 warnings (2 duplicates)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 22.34s
```

---

## Manual browser verification

N/A — Backend Rust queue-worker reliability and SQL migration proposal only; no webmail, control-plane, or public-site UI files were changed.

---

## What did not work or is UNTESTED

- **Live deployment against the active `byos` PostgreSQL database:** **UNTESTED** by safety constraint. As evidenced in the `\d outbound_queue` dump above, the active `byos` instance remains on the pre-`069` schema. Because `outbound-worker` now queries and mutates the new lease/phase columns (`lease_token`, `lease_owner`, `claimed_at`, `lease_expires_at`, `smtp_phase`, `last_smtp_code`, `last_error`) and `'processing'` / `'outcome_unknown'` statuses, `proposed_069_outbound_queue_lease_and_outcomes.sql` must be promoted and applied to the target PostgreSQL database before deploying this `outbound-worker` build. Manual verification steps after maintenance-window promotion:
  1. Promote `infra/postgres/migrations_unapplied/proposed_069_outbound_queue_lease_and_outcomes.sql` to `infra/postgres/init/069_outbound_queue_lease_and_outcomes.sql` and apply it via `psql -v ON_ERROR_STOP=1`.
  2. Start `outbound-worker` and inspect logs to observe zero schema warnings from `verify_queue_lease_schema` and `verify_least_privilege`.
  3. Trigger concurrent outbound sends across two workers and inspect `outbound_queue` and `delivery_log`.
- **Live external Postfix / remote MX SMTP delivery:** **UNTESTED** by safety constraint (no external SMTP or DNS operations allowed). SMTP protocol phasing (`RSET`, `MAIL FROM`, `RCPT TO`, `DATA 354`, pre-`DATA` errors, post-`DATA` TCP drop/timeout) ran against local in-process mock SMTP TCP servers.
- **Release B2 internal attachment fetch endpoints (`/v1/internal/outbound/{delivery_id}/attachments`):** **UNTESTED** (excluded from Release A.2 scope; lease contract aligned in `docs/attachment_delivery_internal_api_spec.md`).
- **Pre-existing Redis `get_async_connection` deprecation warnings (`src/main.rs:122, 531`):** Left untouched to keep edits strictly scoped to Release A.2.

---

## Test suite output

```text
Command: docker run --rm --add-host=host.docker.internal:host-gateway `
  -e "OUTBOUND_TEST_PG_URL=postgres://outbound_worker_login:byos_outbound_worker_dev@host.docker.internal:5439/byos_a2_test?sslmode=disable" `
  -e "OUTBOUND_TEST_ADMIN_PG_URL=postgres://byos:byos_dev_password@host.docker.internal:5439/byos_a2_test?sslmode=disable" `
  -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" `
  -v "byos-rust-target:/workspace/services/outbound-worker/target" `
  -w /workspace/services/outbound-worker rustlang/rust:nightly-slim cargo test --offline
Command exited with code 0.

Command output:
   Compiling byos-outbound-worker v0.1.0 (/workspace/services/outbound-worker)
warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:122:29
    |
122 |     let mut conn = match rc.get_async_connection().await {
    |                             ^^^^^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(deprecated)]` on by default

warning: use of deprecated method `redis::Client::get_async_connection`: aio::Connection is deprecated. Use client::get_multiplexed_async_connection instead.
   --> src/main.rs:531:21
    |
531 |             match c.get_async_connection().await {
    |                     ^^^^^^^^^^^^^^^^^^^^

warning: `byos-outbound-worker` (bin "byos-outbound-worker" test) generated 2 warnings
    Finished `test` profile [unoptimized + debuginfo] target(s) in 2.01s
warning: the following packages contain code that will be rejected by a future version of Rust: rand_core v0.4.2
note: to see what the problems were, use the option `--future-incompat-report`, or run `cargo report future-incompatibilities --id 1`
     Running unittests src/main.rs (target/debug/build/byos-outbound-worker/6cb07df31c721e60/out/byos_outbound_worker-6cb07df31c721e60)

running 31 tests
test tests::test_classify_smtp_status_code_matrix ... ok
test tests::test_compute_retry_backoff_bounded ... ok
test tests::test_dkim_identity_is_single_at_domain ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_completion_retries_on_5xx ... ok
test tests::test_parse_and_validate_recipients ... ok
test tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue ... ok
test tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates ... ok
test tests::test_phased_smtp_post_data_disconnect_and_timeout_return_ambiguous ... ok
test tests::test_phased_smtp_stale_lease_aborts_before_sending_data_body ... ok
test tests::test_smtp_classification_for_bare_4xx_and_5xx_table ... ok
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok
test tests::test_smtp_enhanced_status_codes_and_non_override_over_wire ... ok
test tests::test_strip_bcc_as_last_header_before_delimiter ... ok
test tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space ... ok
test tests::test_strip_bcc_multiple_recipients_and_folded ... ok
test tests::test_strip_bcc_preserves_literal_bcc_in_body ... ok
test tests::test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc ... ok
test tests::test_strip_bcc_single_to_no_bcc ... ok
test tests::test_strip_bcc_to_cc_bcc ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok
test tests::test_smtp_connection_and_no_response_failures_retry_safely ... ok
test pg_tests::test_pg_expired_pending_and_scheduled_reaper ... ok
test pg_tests::test_pg_concurrent_workers_claim_disjoint_rows_and_deliver_once ... ok
test pg_tests::test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry ... ok
test pg_tests::test_pg_least_privilege_rbac_enforced ... ok
test pg_tests::test_pg_long_running_delivery_renews_lease_and_blocks_concurrent_steal ... ok
test pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend ... ok
test pg_tests::test_pg_scheduled_promotion_concurrency_is_idempotent ... ok
test pg_tests::test_pg_stale_lease_token_rejected_across_all_fenced_mutations_and_idempotent_completion ... ok
test pg_tests::test_pg_temp_450_perm_550_max_attempts_and_decrypt_retry_log_accuracy ... ok

test result: ok. 31 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 11.06s
```
