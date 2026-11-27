# BYOS C6.9.2N: Active Database Migration Preflight & Execution Plan

**Phase:** C6.9.2N (Active Database Migration Preflight & Authorization Gate)  
**Final Status:** **READY - AWAITING ACTIVE MIGRATION AUTHORIZATION**  
**Explicit Authorization Required Before Execution:** `APPROVE ACTIVE DATABASE MIGRATION C6.9.2N`  
**Safety Confirmation:** **No active database migrations, schema changes, writes, backups, or container restarts were performed; `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged; all application services remain stopped.**

---

## 1. Current Active Infrastructure & Database State (Read-Only Preflight)

- **PostgreSQL (`byos-postgres`):** `72e2b4cee994633b528f6efddaa5678a1c6db5ae5068e70727408f10aa83774e`, `Status: running`, `Health: healthy` (`52` public tables, `schema_migrations` = `0` rows).
- **Redis (`byos-redis`):** `7199c4dceb5f75d419c1ba6d68dab0f1b93b50a4f3048b09a6feda36fff0c646`, `Status: running`, `Health: healthy`.
- **Migration Runner (`byos-migrate`):** `41e62c2517768cd921358ac0a73e20d2dfc6f89dab9e5ccb30032b4037e35295`, `Status: exited`, `ExitCode: 1`.
- **Application Services:** All remain stopped.

---

## 2. Final 66-Check Baseline & 066/067 Effect Comparison

- **Baseline `068` Status:** `63 / 66` (`51/54` tables, `8/8` `ExpectedColumns068` including `drafts.folder`/`folder_id`, `4/4` `ProhibitedObjects068` absent).
- **Migration `066` (`066_support_notifications_and_reply_tokens.sql`):** All 3 tables (`support_notification_outbox`, `support_reply_tokens`, `support_inbound_dedup`) and `support_ticket_messages.source` are **absent** (zero partial `066` effects).
- **Migration `067` (`067_support_account_suspension_privileges.sql`):** `role_support_agent` exists, and all intended `067` column/table grants (`users`: `SELECT(status)`, `UPDATE(status, is_active, updated_at)`; `mailboxes`: `SELECT(status)`, `UPDATE(status, is_active, updated_at)`; `sessions`: `SELECT(id, user_id)`, `DELETE`) are **already present** on active `byos-postgres`. No `067` re-execution is needed.
- **Migration `005` Gap:** Canonical inventory has `74` SQL files (`001`–`075`, intentional gap at `005`); `byos-migrate` `LoadMigrations()` and `CheckAndApplyBaseline()` operate on files present on disk and handle the `005` gap cleanly.

---

## 3. Backup Freshness & WAL Continuity Verification

- **Encrypted Physical Baseline:** `backups/first_physical_baseline_c684/byos_physical_baseline_c684.tar.enc` (`41,237,440` bytes, `AES-256-GCM Tag MATCHED` with `infra/secrets/backup.key`, WAL range `0/A3000028`–`0/A3000138`).
- **Active WAL Archiver (`pg_stat_archiver` & `byos-backup wal-status`):**
  - `archived_count = 5` (since controlled restart), `failed_count = 0`, `last_archived_wal = 0000000100000000000000B8` (`2026-11-26 05:42:37 UTC`), active segment `0000000100000000000000B9` (`0/B9000110`).
  - `Total Segments: 24` (`0000000100000000000000A1`–`0000000100000000000000B8`), `Archive Lag: 3m24s`, `Sequence Check: CONTINUOUS (No gaps detected)`.
- **Fresh Backup Recommendation:** Existing physical baseline + continuous WAL (`A1`–`B8`) covers recovery through `05:42:37 UTC` (`< 4m` lag). Immediately prior to executing the active migration, record `SELECT pg_current_wal_lsn();` (and optionally take a fresh `pg_basebackup` / encrypted baseline) so a clean pre-migration PITR target timestamp/LSN is established.

---

## 4. Exact Active Migration Execution Sequence (Requires Authorization)

| Step | Command / Action | Expected Result | Failure / Recovery Behavior |
|---|---|---|---|
| 1 | Verify `byos-backup wal-status --archive-dir /var/byos/archive` & record `SELECT now(), pg_current_wal_lsn();` | `CONTINUOUS`, pre-migration PITR target recorded | Stop if WAL archive has gaps or `failed_count > 0` |
| 2 | Re-confirm `52` public tables, `0` `schema_migrations` rows, `066` tables absent | Matches preflight | Stop on unexpected schema drift |
| 3 | Apply `066_support_notifications_and_reply_tokens.sql` via `psql -v ON_ERROR_STOP=1 --single-transaction` | `COMMIT`, 3 tables + `source` column + 6 indexes + 3 grants created | Transaction rolls back atomically on error |
| 4 | Verify `066` tables, `support_ticket_messages.source`, and `role_support_agent` grants | All present | Stop before baseline if any check fails |
| 5 | Confirm `067` grants (read-only) | Already complete | Do not apply `067` unless missing |
| 6 | Run `byos-migrate baseline --version 068` (dry-run) | `Total Checks: 66 \| Passed: 66 \| Failed: 0` | Aborts fail-closed without stamping |
| 7 | Run `byos-migrate baseline --version 068 --confirm` | Stamps `001`–`068` into `schema_migrations` transactionally | Rolls back cleanly on error |
| 8 | Run `byos-migrate up` (`069`–`075`) | Applies 7 migrations (`069`–`075`) transactionally | Stops at first failing migration; do **not** blindly retry |
| 9 | Run `byos-migrate verify` and `byos-migrate status` | `SUCCESS: Database schema is completely up to date` (`74` rows, `001`–`075`) | Stop if checksum mismatch or pending rows |
| 10 | Verify `066`–`075` grants for `role_support_agent` and `outbound_worker` | All expected grants present | Investigate before starting Stage A services |

---

## 5. Rollback & Physical Recovery Considerations

- **Irreversibility:** DDL changes in `066` and `069`–`075` (new tables, columns, indexes, triggers, constraints) are forward-only; once committed, logical rollback is not automatic.
- **Pre-Migration Physical PITR Recovery:** If any post-commit issue occurs, stop `byos-postgres`, restore `byos_physical_baseline_c684.tar.enc` + encrypted WALs `A1`–`B8`+ into a clean data directory with `recovery_target_lsn` / `recovery_target_time` set to Step 1's pre-migration marker (only after `byos-postgres` is stopped and preserved). Any writes performed after Step 1 would be discarded by PITR rollback.

---

## 6. Explicit Authorization Gate

**STOP.** Active PostgreSQL has **not** been modified. To proceed with executing Steps 1–10 against `byos-postgres`, the operator must explicitly issue:

`APPROVE ACTIVE DATABASE MIGRATION C6.9.2N`
