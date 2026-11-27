# BYOS C6.9.2P: Runtime Containment Audit & Recovery Readiness Report

**Phase:** C6.9.2P (Read-Only Runtime Containment Audit)  
**Timestamp (UTC):** `2026-11-26T10:13:50Z`  
**Repository Revision:** `ffd4692`  
**Final Verdict:** **CONDITIONAL PASS** (runtime state, network exposure, queue counts, `public-site` failure, and C6.9.2O exit code `1` are all explained; explicit operator approval is required to stop unapproved running mail/API services)

---

## 1. Complete Container Inventory (`docker ps -a` / `docker inspect`)

| Container | ID (12) | Compose Service (`proj`) | State / Health | Host Ports & Bind | Restart | Networks |
|---|---|---|---|---|---|---|
| `byos-postgres` | `72e2b4cee994` | `postgres` (`byos-email`) | `running (healthy)` | `127.0.0.1:5432->5432/tcp` | `no` | `byos-email_default` |
| `byos-redis` | `7199c4dceb5f` | `redis` (`byos-email`) | `running (healthy)` | `127.0.0.1:6379->6379/tcp` | `no` | `byos-email_default` |
| `byos-minio` | `227c39d14808` | `minio` (`byos-email`) | `running (healthy)` | `127.0.0.1:9000-9001->9000-9001/tcp` | `no` | `byos-email_default` |
| `byos-crypto-worker` | `4273f343ed78` | `crypto-worker` (`byos-email`) | `running (healthy)` | `8084/tcp` (internal) | `no` | `byos-email_default` |
| `byos-storage-worker` | `5423ae92f754` | `storage-worker` (`byos-email`) | `running (healthy)` | `8083/tcp` (internal) | `no` | `byos-email_default` |
| `byos-admin-api` | `9142b1228c80` | `admin-api` (`byos-email`) | `running (none)` | `127.0.0.1:8087->8087/tcp` | `no` | `byos-email_default` |
| `byos-support-crm` | `da70e9e2b0f4` | `support-crm` (`byos-email`) | `running (none)` | `127.0.0.1:3003->3003/tcp` | `no` | `byos-email_default` |
| `byos-api` | `cf4cf78ae28a` | `api` (`byos-email`) | `running (none)` | `127.0.0.1:8080->8080/tcp` | `no` | `byos-email_default` |
| `byos-webmail` | `382308900a82` | `webmail` (`byos-email`) | `running (none)` | `127.0.0.1:3001->3001/tcp` | `no` | `byos-email_default` |
| `byos-control-plane` | `6ad4ea19667f` | `control-plane` (`byos-email`) | `running (none)` | `127.0.0.1:3000->3000/tcp` | `no` | `byos-email_default` |
| `byos-mail-router` | `a14bce40a487` | `mail-router` (`byos-email`) | `running (healthy)` | `8081-8082/tcp` (internal) | `no` | `byos-email_default` |
| `byos-rspamd` | `2db15b1d6278` | `rspamd` (`byos-email`) | `running (healthy)` | `11332-11334/tcp` (internal) | `no` | `byos-email_default` |
| `byos-inbound-bridge` | `f399ff5592be` | `inbound-bridge` (`byos-email`) | `running (healthy)` | **`0.0.0.0:25->25/tcp, [::]:25->25/tcp`**, `127.0.0.1:8085->8085/tcp` | `no` | `byos-email_default` |
| `byos-postfix` | `aeb6297be7fb` | `postfix` (`byos-email`) | `running (healthy)` | `127.0.0.1:2525->587/tcp` | `no` | `byos-email_default` |
| `byos-mailpit` | `1e033ca556e8` | `mailpit` (`byos-email`) | `running (healthy)` | `127.0.0.1:1025->1025/tcp`, `127.0.0.1:8025->8025/tcp` | `no` | `byos-email_byos-net,byos-email_default` |
| `byos-outbound-worker` | `1702eb9f77e0` | `outbound-worker` (`byos-email`) | `running (none)` | `8086/tcp` (internal) | `no` | `byos-email_default` |
| `byos-migrate` | `41e62c251776` | `migrate` (`byos-email`) | `exited (0)` | — | `no` | `byos-email_default` |
| `byos-minio-init` | `4b0a180f2dc6` | `minio-init` (`byos-email`) | `exited (0)` | — | `no` | `byos-email_default` |
| `byos-public-site` | `93ee134bcf9f` | `public-site` (`byos-email`) | `exited (1)` | — | `no` | `byos-email_default` |
| `sweet_napier` | `f833023698ad` | `api` (`byos-email`, stray) | `running (none)` | `8080/tcp` (internal) | `no` | `bridge` |
| `byos_relb_pg` / `byos_relb_redis` | `2f8732ec21f3` / `07f89a01d218` | (none) | `exited (255)` | `127.0.0.1:55432` / `56379` | `no` | `bridge` |
| `admiring_franklin` | `c33df7a3d9b9` | (none, MCP server) | `running (none)` | `8082/tcp` (internal) | `no` | `bridge` |

*(All BYOS containers were already running from the user's earlier `start_dev.bat` execution at `~09:00Z` except `byos-postgres`, `byos-redis`, and `byos-migrate`.)*

---

## 2. Active Side Effects, Queue Counts & Network Exposure

- **Read-Only Queue Counts (`byos-postgres`):**
  - `outbound_queue`: `delivered = 1`, `leased_processing = 0` (`pending`/`processing` = `0`).
  - `scheduled_messages`: `0` rows.
  - `support_notification_outbox`: `0` rows.
  - `import_jobs`: `completed = 3`.
- **Active Side Effects:**
  - `byos-outbound-worker` is actively polling PostgreSQL every 5s (`scheduled reconciliation pass: checked (found 0 pending completed rows)`) and is armed to send SMTP via `byos-postfix:25` if any row enters `outbound_queue` or `scheduled_messages`.
  - `byos-inbound-bridge` is **currently capable of accepting external/local SMTP** on **`0.0.0.0:25` and `[::]:25`** (all interfaces, not restricted to `127.0.0.1`).
  - `byos-api` is running background `startRateCacheRefresh`, `startStorageHealthMonitor`, `startJanitor`, `startScheduledPathADelivery`, and `StartCalendarExpirationWorker` on `127.0.0.1:8080`.
  - All other published BYOS ports (`5432`, `6379`, `9000-9001`, `8080`, `8087`, `3000`, `3001`, `3003`, `2525`, `1025`, `8025`, `8085`) are bound strictly to `127.0.0.1`.

---

## 3. `byos-public-site` Failure & C6.9.2O Exit Code 1

- **`byos-public-site` (`Exited (1)`):** Logs show `Another astro dev server is already running. URL: http://localhost:3002 PID: 19`. Astro v7 left a stale dev-server lock inside the container's `.astro/` directory after the earlier ungraceful VM stop. It does not affect core recovery; clearing the stale lock or running `astro dev --force` (or recreating the container) resolves it.
- **C6.9.2O Exit Code 1:** `docker start -a byos-migrate` itself returned `MIGRATE_EXIT=0`. The PowerShell command exited `1` because: (1) `GET http://127.0.0.1:8087/health` returned `404 page not found` (`byos-admin-api` only exposes `/admin/v1/...`), and (2) `docker inspect` Go template failed on `.State.Health` for `byos-admin-api` and `byos-support-crm` (which have no Docker `HEALTHCHECK`).

---

## 4. Proposed Containment Plan (Not Executed)

| Container/service | Current state | Background processing | External side effect | Network exposure | Recommendation |
|---|---|---|---|---|---|
| `byos-postgres` (`postgres`) | `running (healthy)` | WAL archiving (`wal_level=replica`) | None | `127.0.0.1:5432` | **Keep running** |
| `byos-redis` (`redis`) | `running (healthy)` | AOF persistence | None | `127.0.0.1:6379` | **Keep running** |
| `byos-minio` (`minio`) | `running (healthy)` | None | None | `127.0.0.1:9000-9001` | **Keep running** |
| `byos-crypto-worker` (`crypto-worker`) | `running (healthy)` | None (HTTP-only) | None | Internal `8084` | **Keep running** |
| `byos-storage-worker` (`storage-worker`) | `running (healthy)` | None (HTTP-only) | Local MinIO only | Internal `8083` | **Keep running** |
| `byos-admin-api` (`admin-api`) | `running` | None (HTTP-only) | None | `127.0.0.1:8087` | **Keep running** |
| `byos-support-crm` (`support-crm`) | `running` | None (Vite dev) | None | `127.0.0.1:3003` | **Keep running** |
| `byos-inbound-bridge` (`inbound-bridge`) | `running (healthy)` | SMTP listener | **Accepts inbound SMTP** | **`0.0.0.0:25`, `[::]:25`**, `127.0.0.1:8085` | **Requires explicit approval to stop** |
| `byos-outbound-worker` (`outbound-worker`) | `running` | **5s DB queue poller** | **Armed to send SMTP** | Internal `8086` | **Requires explicit approval to stop** |
| `byos-postfix` (`postfix`) | `running (healthy)` | Mail queue daemon | **Relays SMTP** | `127.0.0.1:2525->587` | **Requires explicit approval to stop** |
| `byos-mailpit` (`mailpit`) | `running (healthy)` | Dev SMTP sink | Captures dev mail | `127.0.0.1:1025,8025` | **Requires explicit approval to stop** |
| `byos-mail-router` (`mail-router`) | `running (healthy)` | None (HTTP-only) | Routes mail to PG/MinIO | Internal `8081-8082` | **Requires explicit approval to stop** |
| `byos-rspamd` (`rspamd`) | `running (healthy)` | Spam filter daemon | None | Internal `11332-11334` | **Requires explicit approval to stop** |
| `byos-api` (`api`) | `running` | **Janitor, Path A, Calendar workers** | OTP/Path A if triggered | `127.0.0.1:8080` | **Requires explicit approval to stop** |
| `byos-webmail` (`webmail`) | `running` | Vite dev server | Calls `api` | `127.0.0.1:3001` | **Requires explicit approval to stop** |
| `byos-control-plane` (`control-plane`) | `running` | Vite dev server | Calls `api` | `127.0.0.1:3000` | **Requires explicit approval to stop** |
| `sweet_napier` (`api` stray) | `running` | Orphaned `api` container | Unknown stale instance | Internal `8080` (`bridge`) | **Investigate before deciding** |
| `byos-public-site` (`public-site`) | `exited (1)` | None | None | — | **Already stopped or exited** |
| `byos-migrate` / `byos-minio-init` | `exited (0)` | None | None | — | **Already stopped or exited** |

- **Impact of Stopping Excluded Services:** Stopping `inbound-bridge`, `outbound-worker`, `postfix`, `mailpit`, `mail-router`, `rspamd`, `api`, `webmail`, and `control-plane` halts mail ingestion/delivery and user-facing webmail/control-plane UIs while leaving `postgres`, `redis`, `minio`, `crypto-worker`, `storage-worker`, `admin-api`, and `support-crm` operational. Each can be restarted later via `docker compose -f infra/docker-compose.yml start <service>`.
