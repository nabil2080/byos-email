# BYOS C6.9.2L: Migration Baseline Discrepancy Investigation & Application Startup Gate Audit

**Phase:** C6.9.2L (Read-Only Migration Baseline Discrepancy Investigation)  
**Final Status:** **INVESTIGATED - BASELINE ISSUE EXPLAINED**  
**Safety Confirmation:** **No migrations were run, no database writes or schema changes were performed, no containers were started or stopped, `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.**

---

## 1. Current Infrastructure & Migration Runner State

- **PostgreSQL (`byos-postgres`):** `72e2b4cee994633b528f6efddaa5678a1c6db5ae5068e70727408f10aa83774e`, `Status: running`, `Health: healthy`.
- **Redis (`byos-redis`):** `7199c4dceb5f75d419c1ba6d68dab0f1b93b50a4f3048b09a6feda36fff0c646`, `Status: running`, `Health: healthy`.
- **Migration Runner (`byos-migrate`):** `41e62c2517768cd921358ac0a73e20d2dfc6f89dab9e5ccb30032b4037e35295`, `Status: exited`, `ExitCode: 1`, `FinishedAt: 2026-11-24T08:02:47.930737198Z`.
- **Existing `byos-migrate` Failure Output:**
```
2026/11/24 08:02:46 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 41
2026/11/24 08:02:47 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 41
2026/11/24 08:02:47 ERROR: Migration failed: baseline verification failed: database contains unexpected, partial, or conflicting schema (63/66 checks passed). Cannot automatically stamp baseline 068:
- [table] support_notification_outbox: missing expected table
- [table] support_reply_tokens: missing expected table
- [table] support_inbound_dedup: missing expected table
```

---

## 2. The 66 Baseline Checks & Observed Results (`tools/byos-migrate/migrator.go`)

`VerifyBaseline(..., "068")` runs **66 checks** (tables, columns, and absence checks — no index/trigger/function checks):
1. **`ExpectedTables068` (54 user tables, excluding `schema_migrations`):** **51 passed, 3 failed** (`support_notification_outbox`, `support_reply_tokens`, `support_inbound_dedup`).
2. **`ExpectedColumns068` (8 columns across `organizations`, `message_metadata`, `users`, `scheduled_messages`, `drafts`):** **8 passed, 0 failed** (including `drafts.folder` and `drafts.folder_id` from `068_draft_folders.sql`).
3. **`ProhibitedObjects068` (4 objects from `069`/`070` that must be absent):** **4 passed, 0 failed** (`outbound_queue.lease_token`, `outbound_delivery_attachments`, `outbound_delivery_keys`, `draft_attachments` all absent).
- **Total:** `51 + 8 + 4 = 63 / 66` passed. Because `report.IsMatch` is `false`, `CheckAndApplyBaseline` fails closed and aborts `byos-migrate up` before applying any migrations.

---

## 3. Detailed Analysis of the Three Missing Tables

| Question | `support_notification_outbox` / `support_reply_tokens` / `support_inbound_dedup` |
|---|---|
| Where created / owning migration | `infra/postgres/migrations/066_support_notifications_and_reply_tokens.sql` (migration `066`) |
| Active service call sites | `services/admin-api/handlers/notifications.go` (lines 131–384) and `services/api/support_notifications.go` (lines 62–766) |
| Required by current code | **Yes** — actively used by both `api` and `admin-api` support notification & reply flows |
| Foreign keys | Reference `support_tickets(id)`, `users(id)`, and `support_ticket_messages(id)` (`ON DELETE CASCADE`) |
| Why absent | **Inconsistent historical DB state:** `068_draft_folders.sql` (`drafts.folder`, `drafts.folder_id`) was applied to `byos-postgres` before `byos-migrate` was introduced, while `066_support_notifications_and_reply_tokens.sql` was skipped/never applied |
| Is absence safe? | **No** — removing these checks from `ExpectedTables068` would break `api` and `admin-api` support notification/reply endpoints at runtime |

---

## 4. Migration Inventory & `schema_migrations` Analysis

- **Repository Inventory:** 74 SQL files in `infra/postgres/migrations/` (`001_init.sql` through `075_support_agent_least_privilege_hardening.sql`, with an existing gap at `005`).
- **Active DB State (`byos-postgres`):** `52` public tables (`51` user tables + `schema_migrations`), `schema_migrations` has `0` rows. `068` columns exist, `069`/`070` objects do not exist, and `066` tables do not exist.
- **`byos-migrate` Behavior:** Because `schema_migrations` has `0` rows and `51` user tables exist, `byos-migrate up` invokes `CheckAndApplyBaseline` (`targetBaseline = "068"`). Once `VerifyBaseline("068")` passes `66/66`, `byos-migrate` stamps `001`–`068` into `schema_migrations` (without re-executing `001`–`068`) and then executes `069`–`075` in order. No application service runs baseline adoption or schema migrations automatically.

---

## 5. Corrected Compose Dependency Gate & Staged Startup Plan

`infra/docker-compose.yml` enforces `migrate: condition: service_completed_successfully` for `api`, `mail-router`, `storage-worker`, `outbound-worker`, and `admin-api`, and `minio-init: condition: service_completed_successfully` for `storage-worker`. Retaining these gates:

1. **Infrastructure Health (Already Running):** `byos-postgres` (`healthy`), `byos-redis` (`healthy`).
2. **Object Storage:** Start `byos-minio` (wait `healthy`) -> run `byos-minio-init` (wait `Exited (0)`).
3. **Migration Gate (Separate Authorization Required):** Resolve `066` discrepancy and run `byos-migrate` (`up` / `baseline 068` -> `069`–`075`, wait `Exited (0)`).
4. **Stage A (Core Services):** `byos-crypto-worker` -> `byos-storage-worker` -> `byos-admin-api` -> (separate authorization) `byos-api` + frontends (`byos-control-plane`, `byos-webmail`, `byos-support-crm`, `byos-public-site`).
5. **Stage B (Internal Processing):** `byos-rspamd` -> `byos-mail-router`.
6. **Stage C (Inbound — Separate Authorization):** `byos-inbound-bridge`.
7. **Stage D (Outbound — Separate Authorization):** `byos-mailpit` -> `byos-postfix` -> `byos-outbound-worker`.

---

## 6. Evidence-Based Resolution Matrix & Recommended Path

| Finding | Evidence | Risk | Proposed Action | Authorization Required |
|---|---|---|---|---|
| **Path A/C (Recommended): Missing `066` tables in historical DB** | `066` creates the 3 tables; `068` columns exist; `069`–`075` absent | `api` / `admin-api` fail on support notifications if `066` is missing | 1. Backup `byos-postgres`. 2. Apply `066_support_notifications_and_reply_tokens.sql` forward-only (uses `IF NOT EXISTS`). 3. Run `byos-migrate baseline --version 068` (verify `66/66`), then `--confirm`, then `byos-migrate up` (`069`–`075`). | Operator authorization for DB backup + migration execution |
| **Path B (Rejected): Remove 3 tables from `ExpectedTables068`** | Both `api` and `admin-api` query all 3 tables | Runtime SQL errors (`relation does not exist`) | **Do not do this** — would weaken baseline and leave runtime broken | N/A (Rejected) |

**Unresolved Risks:** Whether `067_support_account_suspension_privileges.sql` was also skipped alongside `066` (must be checked read-only before applying `066` and stamping `068`).
