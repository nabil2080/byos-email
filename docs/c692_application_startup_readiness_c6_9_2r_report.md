# BYOS C6.9.2R: Application Startup Safety & Readiness Audit Report

**Phase:** C6.9.2R (Read-Only Application Startup Safety & Readiness Audit)  
**Timestamp (UTC):** `2026-11-26T11:10:34Z`  
**Repository Revision:** `ffd4692`  
**Final Verdict:** **PASS** (all three application services have a reviewed, safe staged startup plan; no containers were started or stopped; awaiting explicit operator approval `APPROVE C6.9.2S APPLICATION STARTUP`)

---

## 1. Contained Baseline Status

- **Running Core Infrastructure:** `byos-postgres` (`72e2b4cee994`, `running healthy`, `127.0.0.1:5432`), `byos-redis` (`7199c4dceb5f`, `running healthy`, `127.0.0.1:6379`), `byos-minio` (`227c39d14808`, `running healthy`, `127.0.0.1:9000-9001`, `/data/byos-mailbox` present), `byos-crypto-worker` (`4273f343ed78`, `running healthy`, `8084`), `byos-storage-worker` (`5423ae92f754`, `running healthy`, `8083`), `byos-admin-api` (`9142b1228c80`, `running`, `127.0.0.1:8087`), `byos-support-crm` (`da70e9e2b0f4`, `running`, `127.0.0.1:3003`).
- **One-Shot Completed:** `byos-migrate` (`41e62c251776`, `exited (0)`), `byos-minio-init` (`4b0a180f2dc6`, `exited (0)`).
- **Stopped / Excluded:** `byos-api` (`cf4cf78ae28a`), `byos-webmail` (`382308900a82`), `byos-control-plane` (`6ad4ea19667f`), `byos-outbound-worker` (`1702eb9f77e0`), `byos-inbound-bridge` (`f399ff5592be`), `byos-mail-router` (`a14bce40a487`), `byos-rspamd` (`2db15b1d6278`), `byos-postfix` (`aeb6297be7fb`), `byos-mailpit` (`1e033ca556e8`), `byos-public-site` (`93ee134bcf9f`, `exited (1)`), `sweet_napier` (`f833023698ad`, `exited (2)`).
- **Host Ports:** `3000`, `3001`, `3002`, and `8080` are free; `BYOS_BACKUP_REMOTE_ENABLED=false`.

---

## 2. API Background Routine & Path A Delivery Analysis (`services/api/`)

| Routine | Trigger | Database Writes | Queue Effects | External Network Effects | Can Send Email? |
|---|---|---|---|---|---|
| `startRateCacheRefresh` (`main.go:172`) | 5m ticker | None (reads `rate_limits`) | None | None | No |
| `startStorageHealthMonitor` (`storage_monitor.go:22`) | `STORAGE_HEALTH_INTERVAL` (300s) | Updates `storage_connections` health on check | None | Calls `storage-worker` | No |
| `startJanitor` (`janitor.go:28`) | `JANITOR_INTERVAL` (3600s) | Deletes expired `recovery_challenges` & dead `sessions` (>7d) | None | None | No |
| `RunStartupPollutionCheck` (`startup_guard.go:325`) | Once at startup | None (read-only) | None | Read-only MinIO check | No |
| `startScheduledPathADelivery` (`scheduled_path_a_delivery.go:27`) | 5s ticker | Polls `scheduled_messages WHERE is_path_a=true`; delivers internal Path A rows to `message_metadata` | **Does NOT write `outbound_queue` or acquire leases** (0 rows currently) | Calls `storage-worker` only | **No** (no Postfix/SMTP connection; internal BYOS-to-BYOS only) |
| `RunStartupMigrationReconciliation` (`calendar.go:457`) | Once at startup | Reconciles expired rows in `calendar_event_migrations` (no SQL DDL) | None | None | No |
| `StartCalendarExpirationWorker` (`calendar.go:488`) | 60s ticker | Sweeps expired rows in `calendar_event_migrations` | None | None | No |

- **Conclusion:** `byos-api` does **not** run SQL schema migrations on boot, does **not** write to `outbound_queue`, and cannot send external SMTP email without `outbound-worker` + `postfix`.

---

## 3. Frontend Dependencies, Compose Config & Port Collisions

- **`webmail` (`apps/webmail/vite.config.ts`):** Listens on `:3001`, published `127.0.0.1:3001->3001/tcp`, proxies `/v1` and `/api/v1` to `VITE_API_URL` (`http://api:8080` inside Docker). Depends only on `api` (`depends_on: api: service_started`, plus `postgres`, `migrate`, `redis`, `minio` via `api`), `restart: "no"`, no Docker `healthcheck`.
- **`control-plane` (`apps/control-plane/vite.config.ts`):** Listens on `:3000`, published `127.0.0.1:3000->3000/tcp`, proxies `/v1` and `/health` to `VITE_API_URL` (`http://api:8080` inside Docker). Depends only on `api` (`service_started`), `restart: "no"`, no Docker `healthcheck`.
- **Note on `api` `depends_on`:** `api` waits for `postgres` (`service_healthy`), `migrate` (`service_completed_successfully`), `redis` (`service_healthy`), and `minio` (`service_healthy`) — all 4 are already satisfied. `api` has no Docker `healthcheck` in `docker-compose.yml`, so `/health` (`127.0.0.1:8080/health`) must be verified explicitly before starting `webmail` and `control-plane`.
- **Port Collisions & `byos-public-site`:** Host ports `3000`, `3001`, `3002`, and `8080` are currently free. `byos-public-site` (`PID: 19` in `.astro/` inside container writable layer, not a host process) remains `exited (1)` and is excluded from this plan.

---

## 4. Test & Build Evidence

```
services/api: go vet ./... -> API_VET=0
apps/webmail: npm.cmd run build -> ✓ built in 18.88s (WEBMAIL_BUILD=0)
apps/control-plane: npm.cmd run build -> ✓ built in 5.80s (CP_BUILD=0)
```

---

## 5. Proposed Staged Startup Sequence (Not Executed)

1. **`api` (`byos-api`, `cf4cf78ae28a`):**
   - Command: `docker compose -f infra/docker-compose.yml -p byos-email start api`
   - Port: `127.0.0.1:8080->8080/tcp`
   - Verify: `GET http://127.0.0.1:8080/health` returns `200` (`status: ok`)
   - Rollback: `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 api`
2. **`webmail` (`byos-webmail`, `382308900a82`):**
   - Precondition: `api` `/health` returns `200`
   - Command: `docker compose -f infra/docker-compose.yml -p byos-email start webmail`
   - Port: `127.0.0.1:3001->3001/tcp`
   - Verify: `GET http://127.0.0.1:3001/` returns `200`
   - Rollback: `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 webmail`
3. **`control-plane` (`byos-control-plane`, `6ad4ea19667f`):**
   - Precondition: `api` `/health` returns `200`
   - Command: `docker compose -f infra/docker-compose.yml -p byos-email start control-plane`
   - Port: `127.0.0.1:3000->3000/tcp`
   - Verify: `GET http://127.0.0.1:3000/` returns `200`
   - Rollback: `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 control-plane`

*(Excluded services `outbound-worker`, `inbound-bridge`, `postfix`, `mailpit`, `mail-router`, `rspamd`, `public-site`, and `sweet_napier` remain stopped.)*
