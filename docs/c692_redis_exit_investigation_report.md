# BYOS C6.9.2I: Redis Exit Investigation and Persistence Audit

**Phase:** C6.9.2I (Read-Only Redis Exit Investigation & Persistence Audit)  
**Final Status:** **INVESTIGATED - REDIS STARTUP CAN BE CONSIDERED** (under a separate, explicitly authorized controlled startup; `byos-redis` was **not** started or modified)  
**Safety Confirmation:** **Redis was NOT started, restarted, or modified; PostgreSQL remains `Up (healthy)`; no other containers or volumes were modified.**

---

## 1. Container Identity & State (`docker ps -a` / `docker inspect byos-redis`)

- **Container ID:** `7199c4dceb5f75d419c1ba6d68dab0f1b93b50a4f3048b09a6feda36fff0c646` (matches `7199c4dceb5f`)
- **Name / Image:** `/byos-redis` (`redis:7-alpine`)
- **Configured Command:** `Entrypoint: ["docker-entrypoint.sh"]`, `Cmd: ["redis-server", "--appendonly", "yes"]`
- **Created:** `2026-10-29T12:45:42.380435279Z`
- **StartedAt / FinishedAt:** `2026-11-25T08:40:46.272176878Z` -> `2026-11-26T04:17:25.48994835Z`
- **State / ExitCode:** `exited` / `255` (`Error: ""`, `OOMKilled: false`, `RestartCount: 0`, `RestartPolicy: "no"`)
- **Network / Ports:** `byos-email_default` (`127.0.0.1:6379->6379/tcp`)
- **Healthcheck:** `["CMD", "redis-cli", "ping"]` (Interval `5s`, Timeout `5s`, Retries `10`)

---

## 2. Docker Desktop / WSL2 Restart Correlation & Relevant Redis Logs

`byos-redis` exited at `2026-11-26T04:17:25.48994835Z` — **3.4 ms** apart from `byos-postgres` (`04:17:25.493305609Z`) when Docker Desktop / WSL2 restarted (`04:17:15Z`–`04:17:23Z` in Docker Desktop logs).

Last relevant `docker logs --timestamps --tail 500 byos-redis` entries (all normal, zero corruption/OOM/permission errors):
```
2026-11-25T08:40:47.143215090Z 1:M 25 Nov 2026 08:40:47.142 * DB loaded from incr file appendonly.aof.1.incr.aof: 0.711 seconds
2026-11-25T08:40:47.143231673Z 1:M 25 Nov 2026 08:40:47.143 * DB loaded from append only file: 0.711 seconds
2026-11-25T08:40:47.143234669Z 1:M 25 Nov 2026 08:40:47.143 * Opening AOF incr file appendonly.aof.1.incr.aof on server start
2026-11-25T08:40:47.143236562Z 1:M 25 Nov 2026 08:40:47.143 * Ready to accept connections tcp
2026-11-25T08:45:48.080934750Z 1:M 25 Nov 2026 08:45:48.080 * 100 changes in 300 seconds. Saving...
2026-11-25T08:45:48.182915666Z 1:M 25 Nov 2026 08:45:48.182 * Background saving terminated with success
2026-11-25T09:18:35.940009578Z 1:M 25 Nov 2026 09:18:35.939 * 100 changes in 300 seconds. Saving...
2026-11-25T09:18:36.041449769Z 1:M 25 Nov 2026 09:18:36.041 * Background saving terminated with success
```

---

## 3. Redis Version, RDB/AOF Configuration & Volume Findings

- **Image / Version:** `redis:7-alpine` (Redis 7.x multi-part AOF format `appendonly.aof.1.incr.aof` observed in logs).
- **Persistence Mode:** **RDB + AOF** (`--appendonly yes` configured in `infra/docker-compose.yml:55` and `Cmd`; default Redis RDB `save` snapshots also active as seen in `100 changes in 300 seconds` log lines). Default `dir` is `/data` with default `appendfsync everysec` (since no custom `redis.conf` override is mounted).
- **Volume:** Named volume `byos-email_redis-data` (`CreatedAt: 2026-09-30T08:40:52Z`) is intact and mounted at `/data` (`rw`). Data is **not** stored in the container's ephemeral writable layer.
- **File-Level Integrity:** Cannot be verified without starting Redis or mounting `/data` (prohibited in this read-only phase) — classified as **Unknown** until controlled startup.

---

## 4. BYOS Dependency Inventory & Data-Loss Risk

| Component | Redis Purpose | Behavior When Redis Is Unavailable | Persistent State Risk |
|---|---|---|---|
| `byos-api` (`services/api/`) | Lua rate limiting (`checkAndIncrRate`, `auth:login:*`, `auth:link:*`, `caldav:rate:*`), SSE/PubSub (`mailbox:<id>:events`) | Pub/Sub logs non-fatal error; rate-limit checks fail closed or fall back per endpoint | **Low** — ephemeral TTL counters & real-time UI notifications; sessions/users/mailboxes/messages are in PostgreSQL |
| `byos-mail-router` (`services/mail-router/main.go`) | Best-effort `PUBLISH` to `mailbox:<id>:events` after PostgreSQL commit | `_ = a.redisClient.Publish(...)` ignores Pub/Sub failure; mail delivery still persists in PostgreSQL | **None** — PostgreSQL is authoritative |
| `byos-outbound-worker` (`services/outbound-worker/src/main.rs`) | Rate limiting (`RATE_LUA` `GET`/`INCR`/`EXPIRE` with TTL) | **Fail-closed** (`rate limiter unavailable`, `retryAfter=30s`) while `outbound_queue` & leases remain in PostgreSQL | **Low** — no queued jobs or delivery leases are stored in Redis |

- **Classification:** Redis is a **rate-limiter + ephemeral Pub/Sub broker**, NOT a durable job queue or primary session store. PostgreSQL is the authoritative source for all durable operational state.
- **Data-Loss / Duplicate-Work Risk:** Up to ~1 second of rate-limit counter increments (under default `appendfsync everysec`) could be lost across an ungraceful VM stop; no message-delivery state or queued jobs are held solely in Redis, and duplicate outbound jobs are governed by PostgreSQL leases/reservations (`outbound_reservations`), not Redis.

---

## 5. C6.9.2H Exit-Code Discrepancy Analysis

1. **Pre-start check (`Command exited with code 1`):** `Get-NetTCPConnection -LocalPort 5432 -ErrorAction SilentlyContinue` returned zero rows (expected negative check confirming port 5432 was unbound), causing the PowerShell command's final exit code to be `1` while all Docker/volume/port checks succeeded.
2. **Startup/monitoring command (`Command exited with code 1`):** `docker start byos-postgres` returned `EXIT=0`, polling reached `running|true|healthy|0`, and `docker logs --since ... 2>&1` streamed PostgreSQL log lines written to `stderr`, which PowerShell surfaced as `NativeCommandError` (`RemoteException`) — an artifact of `2>&1` in Windows PowerShell, **not** a Docker or PostgreSQL failure.

---

## 6. Current PostgreSQL State & Recommended Redis Controlled-Startup Procedure

- **PostgreSQL (`byos-postgres`):** Confirmed `Up (healthy)` (`72e2b4cee994`).
- **Recommended Controlled-Startup Procedure (requires separate operator authorization):**
  1. Confirm `byos-redis` ID (`7199c4dceb5f...`), `byos-email_redis-data` volume, and zero running dependent services (`api`, `mail-router`, `outbound-worker`).
  2. Run `docker start byos-redis` once (do not recreate).
  3. Tail `docker logs --since <START_TS> --timestamps byos-redis` for `DB loaded from append only file` and `Ready to accept connections tcp`, and stop immediately if any AOF/RDB corruption error appears.
  4. Verify `docker inspect byos-redis` reports `State.Health.Status == "healthy"` and `docker exec byos-redis redis-cli ping` returns `PONG`.
