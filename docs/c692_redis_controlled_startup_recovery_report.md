# BYOS C6.9.2J: Controlled Redis Startup and AOF Recovery Verification Report

**Phase:** C6.9.2J (Controlled Redis Startup & AOF Recovery Verification)  
**Final Status:** **HEALTHY - REDIS STARTUP AND PERSISTENCE CHECKS PASSED**  
**Safety Confirmation:** **Exactly one `docker start byos-redis` was executed; no Redis repair or manual data/config changes were performed; no application services were started; PostgreSQL remains unchanged and healthy.**

---

## 1. C6.9.2I Investigation Summary

C6.9.2I established that `byos-redis` (`7199c4dceb5f75d419c1ba6d68dab0f1b93b50a4f3048b09a6feda36fff0c646`) exited with code `255` at `2026-11-26T04:17:25.48994835Z` (`OOMKilled=false`, `RestartPolicy="no"`) during the same Docker Desktop / WSL2 VM interruption (`04:17:15Z`–`04:17:23Z`) as `byos-postgres`. Persistent volume `byos-email_redis-data` (`/data`) remained intact, and Redis is used for ephemeral rate-limiting counters and SSE Pub/Sub notifications rather than durable job queues or primary session storage.

---

## 2. Pre-Start Container Identity, Volume & Isolation Verification

- **Container ID:** `7199c4dceb5f75d419c1ba6d68dab0f1b93b50a4f3048b09a6feda36fff0c646`
- **Name / Image:** `/byos-redis` (`redis:7-alpine`)
- **Command:** `redis-server --appendonly yes`
- **Pre-Start State:** `exited` (`ExitCode: 255`, `RestartCount: 0`, `RestartPolicy: "no"`, `OOMKilled: false`)
- **Volume:** `byos-email_redis-data` mounted at `/data` (`rw`)
- **Port:** `127.0.0.1:6379->6379/tcp` (host port `6379` verified free: `PORT_6379_FREE`)
- **Dependent-Service Isolation:** Only `mystifying_agnesi` and `byos-postgres` were running; zero Redis-dependent BYOS services (`api`, `mail-router`, `outbound-worker`) were running.

---

## 3. Startup Command, Timestamp & Exit Code

- **Command Executed (exactly once):** `docker start byos-redis`
- **Start Timestamp:** `2026-11-26T05:11:04Z` (`StartedAt: 2026-11-26T05:11:05.073803072Z`)
- **Returned Output / Exit Code:** `byos-redis`, `EXIT=0`

---

## 4. AOF Recovery Logs (`docker logs --since 2026-11-26T05:11:04Z --timestamps byos-redis`)

```
2026-11-26T05:11:05.373031473Z 1:C 26 Nov 2026 05:11:05.372 * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo
2026-11-26T05:11:05.373144245Z 1:C 26 Nov 2026 05:11:05.372 * Redis version=7.4.11, bits=64, commit=00000000, modified=0, pid=1, just started
2026-11-26T05:11:05.373152371Z 1:C 26 Nov 2026 05:11:05.372 * Configuration loaded
2026-11-26T05:11:05.375602146Z 1:M 26 Nov 2026 05:11:05.375 * Running mode=standalone, port=6379.
2026-11-26T05:11:05.376217636Z 1:M 26 Nov 2026 05:11:05.375 * Server initialized
2026-11-26T05:11:05.377150761Z 1:M 26 Nov 2026 05:11:05.376 * Reading RDB base file on AOF loading...
2026-11-26T05:11:05.377171091Z 1:M 26 Nov 2026 05:11:05.376 * Loading RDB produced by version 7.4.11
2026-11-26T05:11:05.377183886Z 1:M 26 Nov 2026 05:11:05.377 * RDB is base AOF
2026-11-26T05:11:05.377193024Z 1:M 26 Nov 2026 05:11:05.377 * Done loading RDB, keys loaded: 0, keys expired: 0.
2026-11-26T05:11:05.377836688Z 1:M 26 Nov 2026 05:11:05.377 * DB loaded from base file appendonly.aof.1.base.rdb: 0.001 seconds
...
2026-11-26T05:11:06.191065439Z 1:M 26 Nov 2026 05:11:06.190 * DB loaded from incr file appendonly.aof.1.incr.aof: 0.813 seconds
2026-11-26T05:11:06.191092663Z 1:M 26 Nov 2026 05:11:06.190 * DB loaded from append only file: 0.814 seconds
2026-11-26T05:11:06.191097201Z 1:M 26 Nov 2026 05:11:06.190 * Opening AOF incr file appendonly.aof.1.incr.aof on server start
2026-11-26T05:11:06.191099787Z 1:M 26 Nov 2026 05:11:06.190 * Ready to accept connections tcp
```

---

## 5. Final Redis Container State & Health-Check Result (`docker inspect byos-redis`)

- **Container ID:** `7199c4dceb5f75d419c1ba6d68dab0f1b93b50a4f3048b09a6feda36fff0c646` (unchanged)
- **State:** `running` (`Running: true`, `Pid: 4113`, `ExitCode: 0`, `Error: ""`, `OOMKilled: false`, `RestartCount: 0`)
- **`StartedAt`:** `2026-11-26T05:11:05.073803072Z`
- **Docker Health Status:** `healthy` (`FailingStreak: 0`, 4 consecutive passing `redis-cli ping` checks returning `PONG` with `ExitCode: 0` from `05:11:10Z` to `05:11:25Z`)

---

## 6. Read-Only `redis-cli` Verification

- **`PING`:** `PONG`
- **Redis Version (`INFO server`):** `redis_version:7.4.11` (`redis_mode:standalone`, `tcp_port:6379`)
- **Persistence Status (`INFO persistence`):**
```
loading:0
async_loading:0
rdb_last_bgsave_status:ok
aof_enabled:1
aof_rewrite_in_progress:0
aof_rewrite_scheduled:0
aof_last_bgrewrite_status:ok
aof_last_write_status:ok
aof_current_size:1644671
aof_base_size:89
```
- **Keyspace (`INFO keyspace` / `DBSIZE` / `LASTSAVE`):** `# Keyspace` (0 keys), `DBSIZE = 0`, `LASTSAVE = 1795669866`. Because Redis stores TTL-bounded rate-limiting counters and ephemeral Pub/Sub state, any short-TTL keys from `2026-11-25` naturally expired by `2026-11-26`. No key names or values were queried.

---

## 7. Dependencies, PostgreSQL Verification & Safety Confirmations

- **Dependencies:** `api`, `mail-router`, and `outbound-worker` were not started. When separately authorized to start, clients will reconnect and re-establish Pub/Sub subscriptions; Pub/Sub messages are not persisted in AOF, and PostgreSQL remains authoritative for all durable mail and outbound-delivery state.
- **PostgreSQL (`docker inspect byos-postgres`):** ID `72e2b4cee994633b528f6efddaa5678a1c6db5ae5068e70727408f10aa83774e`, `Status: running`, `Running: true`, `Health: healthy`, `StartedAt: 2026-11-26T05:05:04.323889187Z` (no restart occurred).
- **Warnings / Failures:** None.
- **Safety Confirmations:**
  - Exactly one `docker start byos-redis` occurred.
  - No application services were started.
  - No Redis repair (`redis-check-aof --fix`), rewrite, or manual write commands were executed.
  - `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged; no AWS resources or credentials were introduced.
