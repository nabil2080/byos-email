# BYOS C6.9.2K: Application Stack Recovery Readiness Audit Report

**Phase:** C6.9.2K (Read-Only Application Stack Recovery Readiness Audit)  
**Final Status:** **CONDITIONAL - SERVICE-SPECIFIC RISKS REMAIN**  
**Safety Confirmation:** **No application container was started or stopped; no migrations, database writes, Redis writes, or email deliveries were performed; `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.**

---

## 1. Current Infrastructure Status

- **PostgreSQL (`byos-postgres`):** ID `72e2b4cee994633b528f6efddaa5678a1c6db5ae5068e70727408f10aa83774e`, `Status: running`, `Health: healthy`, `RestartCount: 0`, `52` public tables, `outbound_queue` has `delivered: 1` (`0` pending/processing), `scheduled_messages` has `0` rows.
- **Redis (`byos-redis`):** ID `7199c4dceb5f75d419c1ba6d68dab0f1b93b50a4f3048b09a6feda36fff0c646`, `Status: running`, `Health: healthy`, `RestartCount: 0`, `redis_version:7.4.11`, AOF enabled and loaded cleanly, `DBSIZE = 0` (short-TTL keys expired naturally).

---

## 2. Complete Service Inventory (`infra/docker-compose.yml`)

| Service | Container | Current State | Depends On | Persistent State | External Side Effects |
|---|---|---|---|---|---|
| `postgres` | `byos-postgres` | `Up (healthy)` | — | `postgres-data`, `postgres-archive` | None |
| `redis` | `byos-redis` | `Up (healthy)` | — | `redis-data` (`/data`) | None |
| `migrate` | `byos-migrate` | `Exited (1)` (45h ago) | `postgres` (healthy) | Modifies PG schema | None |
| `minio` | `byos-minio` | `Exited (255)` | — | `minio-data` (`/data`) | None |
| `minio-init` | `byos-minio-init` | `Exited (0)` | `minio` (healthy) | Creates `byos-mailbox` bucket | None |
| `crypto-worker` | `byos-crypto-worker` | `Exited (255)` | — | Stateless (reads `/run/secrets`) | None |
| `storage-worker` | `byos-storage-worker` | `Exited (255)` | `minio`, `minio-init`, `postgres`, `migrate` | Writes PG + MinIO/S3 on HTTP | Potential external S3 if configured |
| `api` | `byos-api` | `Exited (255)` | `postgres`, `migrate`, `redis`, `minio` | Writes PG + Redis | Path A scheduled delivery; OTP SMTP/SMS if live |
| `admin-api` | `byos-admin-api` | `Exited (255)` | `postgres`, `migrate` | Reads/writes PG (`role_support_agent`) | None on startup |
| `control-plane` | `byos-control-plane` | `Exited (255)` | `api` | None (Vite frontend) | None |
| `webmail` | `byos-webmail` | `Exited (143)` | `api` | None (Vite frontend) | None |
| `support-crm` | `byos-support-crm` | `Exited (255)` | `admin-api` | None (Vite frontend) | None |
| `public-site` | `byos-public-site` | `Exited (1)` | `control-plane` | None (Astro frontend) | None |
| `rspamd` | `byos-rspamd` | `Exited (255)` | — | Ephemeral | Spam scanning |
| `mail-router` | `byos-mail-router` | `Exited (255)` | `postgres`, `migrate`, `redis`, `storage-worker`, `crypto-worker` | Writes PG, calls storage/crypto, Redis Pub/Sub | None on startup |
| `inbound-bridge` | `byos-inbound-bridge` | `Exited (255)` | `mail-router`, `rspamd` | Stateless SMTP proxy | Binds `:25` (`0.0.0.0:25`) and accepts external SMTP |
| `mailpit` | `byos-mailpit` | `Exited (255)` | — | Ephemeral dev SMTP sink | Captures dev mail (`1025`/`8025`) |
| `postfix` | `byos-postfix` | `Exited (255)` | — | Ephemeral mail queue | Relays outbound SMTP (`[mailpit]:1025` or `POSTFIX_RELAYHOST`) |
| `outbound-worker` | `byos-outbound-worker` | `Exited (255)` | `postgres`, `migrate`, `crypto-worker` | Claims PG `outbound_queue` leases, writes audit/delivery rows | **Sends external email via `postfix:25`** |

---

## 3. Dependency Graph & Secret/Volume Readiness

- **Core Chain:** `postgres` + `redis` (running) -> `minio` -> `minio-init` -> `crypto-worker` -> `storage-worker` -> `api` / `admin-api` -> UI frontends (`control-plane`, `webmail`, `support-crm`, `public-site`).
- **Inbound Chain:** `rspamd` + `mail-router` -> `inbound-bridge` (`0.0.0.0:25`).
- **Outbound Chain:** `mailpit` -> `postfix` -> `outbound-worker` (also depends on `postgres`, `redis`, `crypto-worker`, `api:8080`).
- **Secrets Verified Present in `infra/secrets/`:** All 10 Compose secret files exist and are non-empty (`outbound_delivery_sk.b64`, `outbound_delivery_pk.b64`, `outbound_worker_db_password.txt`, `byos_dkim_dek.b64`, `storage_dek.b64`, `storage_worker_internal_key.txt`, `mail_router_internal_key.txt`, `crypto_worker_internal_key.txt`, `internal_api_key.txt`, `ses_smtp_credentials.txt`), plus `backup.key`. Services fail closed (`ValidateStartupEnv` / secret file read) if missing.

---

## 4. Per-Service Startup Side Effects & Migration Behavior

- **Migration Behavior (`byos-migrate`):** `api`, `admin-api`, `storage-worker`, `mail-router`, and `outbound-worker` do **not** run schema migrations on startup; `byos-migrate` is a standalone one-shot service. Currently `byos-migrate` (`41e62c251776`) is `Exited (1)` (`baseline verification failed: 63/66 checks passed; missing support_notification_outbox, support_reply_tokens, support_inbound_dedup`), and `schema_migrations` has `0` rows across `52` public tables.
- **`api` (`services/api/main.go`):** Starts background goroutines immediately: `startRateCacheRefresh` (5m), `startStorageHealthMonitor`, `startJanitor`, `RunStartupPollutionCheck`, `startScheduledPathADelivery`, `RunStartupMigrationReconciliation` (calendar legacy reconciliation), and `StartCalendarExpirationWorker` (60s).
- **`outbound-worker` (`services/outbound-worker/src/main.rs`):** Immediately runs `reconcile_delivered_scheduled` and enters a `5000ms` loop calling `poll_scheduled` and `poll_once_with_config` (acquires DB leases, claims `outbound_queue` rows, connects to `postfix:25`, schedules retries/bounces). Currently `outbound_queue` has `0` pending/processing rows (`delivered: 1`) and `scheduled_messages` has `0` rows, but starting it arms external SMTP delivery.
- **`inbound-bridge` (`services/inbound-bridge/main.go`):** Immediately binds `0.0.0.0:25` and forwards incoming SMTP to `rspamd:11333` and `mail-router:8081`.
- **`crypto-worker`, `storage-worker`, `mail-router`, `admin-api`:** Pure HTTP request-driven servers with no background polling loops.

---

## 5. Redis Pub/Sub & Queue Safety Assessment

- **Authoritative Queue:** PostgreSQL (`outbound_queue`, `outbound_reservations`, `scheduled_messages`) is authoritative; Redis holds zero durable queue state.
- **Empty Redis Keyspace (`DBSIZE = 0`):** Rate-limit counters (`checkAndIncrRate` / `RATE_LUA`) regenerate safely on demand. Pub/Sub (`mailbox:<id>:events`) is at-most-once; SSE clients re-subscribe on reconnect without assuming missed downtime notifications are replayed.

---

## 6. Proposed Staged Startup Plan & Smoke Tests

> **Important Pre-Condition:** Because `byos-migrate` is `Exited (1)` (missing `066` tables / unstamped `schema_migrations`), `docker compose up` will fail `migrate: service_completed_successfully` unless the schema baseline is separately resolved. Use individual `docker start <container>` per stage (never simultaneous Compose startup) only after operator authorization.

### Stage A: Core Application Infrastructure (Non-Email-Processing)
1. `byos-minio` (wait `healthy`), then `byos-crypto-worker` (wait `healthy`), then `byos-storage-worker` (wait `healthy`), then `byos-admin-api`.
2. **Requires Separate Authorization:** `byos-api` (runs `startJanitor`, `startScheduledPathADelivery`, `RunStartupMigrationReconciliation`, `StartCalendarExpirationWorker` on boot), plus UI frontends (`byos-control-plane`, `byos-webmail`, `byos-support-crm`, `byos-public-site`).
- **Safe Smoke Tests:** `docker inspect` healthchecks, `GET http://127.0.0.1:8080/health` (read-only), `GET http://127.0.0.1:9000/minio/health/live`, `GET http://127.0.0.1:3001/`.

### Stage B: Internal Processing (No External Delivery)
1. `byos-rspamd` (wait `healthy`), then `byos-mail-router` (wait `healthy`).
- **Safe Smoke Tests:** `wget -qO- http://127.0.0.1:8082/health` inside `byos-mail-router`, `docker exec byos-redis redis-cli PING`.

### Stage C: Inbound Processing (**Requires Separate Operator Authorization**)
1. `byos-inbound-bridge` (binds `0.0.0.0:25`; immediately accepts external/local SMTP connections).
- **Stop Condition:** Port 25 conflict or `mail-router`/`rspamd` unhealthy.
- **Safe Smoke Test:** `GET http://127.0.0.1:8085/health` (do NOT send test SMTP mail).

### Stage D: Outbound Processing (**Requires Separate Operator Authorization**)
1. `byos-mailpit` (dev sink, wait `healthy`) -> `byos-postfix` (verify `POSTFIX_RELAYHOST=[mailpit]:1025` if dev-only) -> `byos-outbound-worker`.
- **Stop Condition:** Unexpected pending rows in `outbound_queue`/`scheduled_messages` or unintended `POSTFIX_RELAYHOST` pointing to a live external relay.
- **Safe Smoke Test:** Read-only `SELECT status, count(*) FROM outbound_queue GROUP BY status;` before starting `outbound-worker`, then `GET :8086/health` (no test email dispatch).
