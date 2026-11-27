# BYOS C6.9.2M: Migration Repair Rehearsal on an Isolated Production-State Clone

**Phase:** C6.9.2M (Isolated Production-State Clone Migration Rehearsal)  
**Final Status:** **PASS - MIGRATION REHEARSAL SUCCESSFUL**  
**Safety Confirmation:** **Active `byos-postgres` was NEVER modified; no migrations, baseline stamps, or schema changes were executed against the active database; `byos-migrate` remains exited; all application services remain stopped; `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.**

---

## 1. Active Database Initial State (Read-Only Inspection)

- **PostgreSQL Version / Database:** `PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit` / `byos`
- **Public Tables:** `52` (`51` user tables + empty `schema_migrations`, `0` rows)
- **Missing `066` Objects:** `support_notification_outbox`, `support_reply_tokens`, `support_inbound_dedup`, and `support_ticket_messages.source`
- **`067` Grants (`role_support_agent`):** Already present (`users`: `SELECT(status)`, `UPDATE(status, is_active, updated_at)`; `mailboxes`: `SELECT(status)`, `UPDATE(status, is_active, updated_at)`; `sessions`: `SELECT(id, user_id)`, `DELETE`)
- **`068` Columns:** `drafts.folder` and `drafts.folder_id` already present
- **`069`–`075` Objects:** Absent (`outbound_queue.lease_token`, `outbound_delivery_attachments`, `outbound_delivery_keys`, `draft_attachments` absent)

---

## 2. Encrypted Backup Verification & PITR Clone Restoration

- **Encrypted Physical Baseline:** `backups/first_physical_baseline_c684/byos_physical_baseline_c684.tar.enc` (`41,237,440` bytes, `backup_manifest` WAL range `0/A3000028`–`0/A3000138`, verified with `byos-backup verify-encrypted` + `infra/secrets/backup.key`: `AES-256-GCM Tag MATCHED`).
- **Continuous Encrypted WAL Archive:** `/var/byos/archive/wal` (`20` segments, `0000000100000000000000A1`–`0000000100000000000000B4`, `Sequence Check: CONTINUOUS (No gaps detected)`).
- **Clone Isolation & Identity:** Container `byos-c692m-migration-rehearsal` (`postgres:16-alpine`, `86967d757fde`), loopback `127.0.0.1:55434:5432`, container-local storage (no active volume mounts), restored via `byos-backup decrypt-bundle` + `byos-backup prepare-pitr --target-action promote` + `restore-wal`, promoted cleanly (`CLONE_IN_RECOVERY=f`).
- **Initial Clone-to-Active Schema Comparison:** Clone matched active `byos-postgres` identically (`52` public tables, `0` `schema_migrations` rows, `drafts.folder` + `drafts.folder_id` present, pre-repair `byos-migrate baseline --version 068` failed with `63/66` checks passed and the exact 3 missing `066` tables).

---

## 3. Migration 066, 067, and 001–068 Reconciliation

- **`066_support_notifications_and_reply_tokens.sql`:** Transaction-safe DDL creating `support_notification_outbox`, `support_reply_tokens`, `support_inbound_dedup`, 6 partial/lookup indexes, `ALTER TABLE support_ticket_messages ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web' CHECK (...)`, and `GRANT SELECT, INSERT, UPDATE` (`outbox`, `reply_tokens`) / `GRANT SELECT, INSERT` (`inbound_dedup`) to `role_support_agent`.
- **`067_support_account_suspension_privileges.sql`:** Idempotent `DO $$ ... GRANT ...` block; does **not** reference the 3 `066` tables; all `067` grants were already present on active `byos-postgres` and the clone.
- **`001`–`068` Reconciliation & `005` Gap:** Canonical inventory has `74` files (`001`–`075`, intentional gap at `005` — no `005_*.sql` file exists in `infra/postgres/migrations/`). Historical DB had `001`–`065`, `067`, and `068` applied outside `byos-migrate`, skipping `066`.

---

## 4. Rehearsal Execution & Raw Output (Clone Only)

1. **Apply `066` transactionally on clone:** `psql -v ON_ERROR_STOP=1 --single-transaction -f 066_support_notifications_and_reply_tokens.sql` -> `EXIT=0`.
2. **Baseline `068` Preflight & `--confirm` (`tools/byos-migrate`):**
   - `VerifyBaseline("068")` uses advisory lock `4780962453531182930`, validates all 66 checks (`54` tables + `8` columns + `4` prohibited objects), and with `--confirm` stamps `001`–`068` into `schema_migrations` inside a single transaction without executing migration DDL.
   - Output:
```
2026/11/26 11:36:41 [BASELINE] Database positively verified against baseline 068 manifest (passed 66/66 checks).
2026/11/26 11:36:41 [BASELINE] Stamping baseline migrations through 068 in schema_migrations...
SUCCESS: Stamped baseline migrations through version 068 in schema_migrations.
```
3. **Apply `069`–`075` (`byos-migrate up`):**
```
2026/11/26 11:36:41 Found 7 pending migration(s) to apply.
2026/11/26 11:36:41 [APPLIED] 069 (069_outbound_queue_lease_and_outcomes.sql) in 110ms
2026/11/26 11:36:42 [APPLIED] 070 (070_attachment_encryption_v2_and_delivery.sql) in 193ms
2026/11/26 11:36:42 [APPLIED] 071 (071_outbound_delivery_operations.sql) in 75ms
2026/11/26 11:36:42 [APPLIED] 072 (072_operator_reconciliation_provenance.sql) in 18ms
2026/11/26 11:36:42 [APPLIED] 073 (073_operator_retry_governance_and_idempotency.sql) in 45ms
2026/11/26 11:36:42 [APPLIED] 074 (074_support_agent_retry_governance_permissions.sql) in 6ms
2026/11/26 11:36:42 [APPLIED] 075 (075_support_agent_least_privilege_hardening.sql) in 4ms
SUCCESS: Applied 7 migration(s).
```
4. **Verify (`byos-migrate verify`):** `SUCCESS: Database schema is completely up to date and all checksums match.`

---

## 5. Before-and-After Comparison

| Check | Active DB Initial State | Restored Clone Initial State | Rehearsal Final State (Clone Only) |
|---|---|---|---|
| Public Tables | `52` (`51` user + `schema_migrations`) | `52` (`51` user + `schema_migrations`) | `60` (`59` user + `schema_migrations`) |
| Baseline `068` Checks | `63/66` (`066` tables missing) | `63/66` (`066` tables missing) | `66/66` passed |
| `066` `role_support_agent` Grants | Absent | Absent | `8` grants (`SELECT`/`INSERT`/`UPDATE` on `066` tables) |
| `ProhibitedObjects068` (`069`/`070`) | Absent (pre-069) | Absent (pre-069) | Present via `069`–`075` |
| `schema_migrations` Rows | `0` | `0` | `74` (`001`–`075`, gap at `005`) |

---

## 6. Proposed Active Migration Procedure (Requires Separate Operator Authorization)

1. Take a fresh encrypted physical backup of `byos-postgres` (confirming WAL archive continuity).
2. Apply `infra/postgres/migrations/066_support_notifications_and_reply_tokens.sql` transactionally (`psql -v ON_ERROR_STOP=1 --single-transaction`).
3. Run `byos-migrate baseline --version 068` (confirm `66/66`), then `byos-migrate baseline --version 068 --confirm`.
4. Run `byos-migrate up` (applies `069`–`075`) and `byos-migrate verify`.

---

## 7. Cleanup & Safety Confirmation

- Disposable container `byos-c692m-migration-rehearsal` was stopped and removed (`docker rm -v`), and `scratch/c692m_clone` was deleted.
- Active `byos-postgres`, `byos-redis`, and `byos-migrate` were not modified; all application services remain stopped; `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.
