# BYOS C6.9.2O: Controlled Core Application Recovery & Staged Startup Report

**Phase:** C6.9.2O (Core Application Infrastructure Recovery)  
**Final Verdict:** **CONDITIONAL PASS - SERVICE-SPECIFIC ISSUES REMAIN**  
*(Core infrastructure — PostgreSQL, Redis, `byos-migrate`, MinIO, `crypto-worker`, `storage-worker`, `admin-api`, and `support-crm` — is verified healthy; however, excluded services `byos-api`, `byos-webmail`, `byos-control-plane`, `byos-mail-router`, `byos-rspamd`, `byos-inbound-bridge`, `byos-mailpit`, `byos-postfix`, and `byos-outbound-worker` were already running from the user's earlier `start_dev.bat` execution prior to C6.9.2N/O, and `byos-public-site` is `Exited (1)`.)*

---

## 1. Migration Verification & Container Completion Reconciliation

- **Read-Only Verification (`byos-migrate verify`):** `SUCCESS: Database schema is completely up to date and all checksums match.` (`74` rows in `schema_migrations`, `001`–`075`, `outbound_queue`: `delivered = 1`, `scheduled_messages`: `0`).
- **One-Shot `byos-migrate` Reconciliation:** `docker start -a byos-migrate` (`41e62c251776`, `Cmd: ["up"]`) ran with `0` pending migrations and exited cleanly with `MIGRATE_EXIT=0` (`SUCCESS: Applied 0 migration(s). Database schema is up to date (version 075). No pending migrations.`).

---

## 2. Core Infrastructure & Service Health Verification

| Service | Container ID | State / Health | Verification |
|---|---|---|---|
| `byos-postgres` | `72e2b4cee994` | `running (healthy)` | `74` migrations (`001`–`075`), `schema_migrations` intact |
| `byos-redis` | `7199c4dceb5f` | `running (healthy)` | Redis `7.4.11`, AOF enabled |
| `byos-minio` | `227c39d14808` | `running (healthy)` | `GET http://127.0.0.1:9000/minio/health/live` -> `200`; `byos-mailbox` bucket present in `/data` |
| `byos-minio-init` | `4b0a180f2dc6` | `Exited (0)` | Bucket initialization already complete |
| `byos-crypto-worker` | `4273f343ed78` | `running (healthy)` | TCP `:8084` healthcheck passing |
| `byos-storage-worker` | `5423ae92f754` | `running (healthy)` | `:8083/health` passing; targets local `minio:9000` |
| `byos-admin-api` | `9142b1228c80` | `running` | Unauthenticated `GET /admin/v1/mailboxes/...` -> `401` (auth middleware active) |
| `byos-support-crm` | `da70e9e2b0f4` | `running` | `GET http://127.0.0.1:3003/` -> `200` |

---

## 3. Excluded Services Observation (Pre-Existing from `start_dev.bat`)

No excluded services were started during C6.9.2O. However, `docker ps -a` recorded that the user's earlier `start_dev.bat` execution (~`09:00Z`) had already started:
- `byos-api` (`cf4cf78ae28a`, `Up`), `byos-webmail` (`382308900a82`, `Up`), `byos-control-plane` (`6ad4ea19667f`, `Up`), `byos-mail-router` (`a14bce40a487`, `Up (healthy)`), `byos-rspamd` (`2db15b1d6278`, `Up (healthy)`), `byos-inbound-bridge` (`f399ff5592be`, `Up (healthy)`), `byos-mailpit` (`1e033ca556e8`, `Up (healthy)`), `byos-postfix` (`aeb6297be7fb`, `Up (healthy)`), `byos-outbound-worker` (`1702eb9f77e0`, `Up`), and `byos-public-site` (`93ee134bcf9f`, `Exited (1)`).

---

## 4. Test Suite & Build Outputs

```
ok  	byos-migrate	16.982s
MIGRATE_TEST=0
ok  	admin-api	1.381s
ok  	admin-api/handlers	5.246s
ADMIN_API_TEST=0
ok  	byos.email/services/storage-worker	4.764s
STORAGE_WORKER_TEST=0
```
```
apps/support-crm: npm.cmd run build -> ✓ built in 3.08s (SUPPORT_CRM_BUILD=0)
```

---

## 5. Safety Confirmation

- PostgreSQL and Redis were never restarted or recreated; no schema changes or business data modifications occurred; `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged; no AWS credentials or resources were introduced.
