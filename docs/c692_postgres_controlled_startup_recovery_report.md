# BYOS C6.9.2H: Controlled PostgreSQL Startup and Crash-Recovery Verification Report

**Phase:** C6.9.2H (Controlled PostgreSQL Startup & Crash-Recovery Verification)  
**Final Status:** **HEALTHY - STARTUP AND READ-ONLY CHECKS PASSED**  
**Safety Confirmation:** **Exactly one `docker start byos-postgres` was executed; no migrations, repairs, WAL switches, or data modifications were performed; Redis and all other BYOS services remain untouched.**

---

## 1. C6.9.2G Investigation Findings Summary

C6.9.2G established that `byos-postgres` (`72e2b4cee994633b528f6efddaa5678a1c6db5ae5068e70727408f10aa83774e`) and `byos-redis` (`7199c4dceb5f`) both exited with code `255` at `2026-11-26T04:17:25.49Z` (`OOMKilled=false`, `RestartPolicy="no"`) when Docker Desktop / WSL2 restarted following a `vpnkit-bridge` shutdown (`0x40010004`). Both `byos-email_postgres-data` and `byos-email_postgres-archive` volumes remained intact, and C6.9.2F did not cause the exit.

---

## 2. Pre-Start Container Identity, State & Volume Verification

- **Container ID:** `72e2b4cee994633b528f6efddaa5678a1c6db5ae5068e70727408f10aa83774e`
- **Name / Image:** `/byos-postgres` (`postgres:16-alpine`)
- **Pre-Start State:** `exited` (`ExitCode: 255`, `RestartCount: 0`, `RestartPolicy: "no"`, `OOMKilled: false`)
- **Port Mapping:** `127.0.0.1:5432->5432/tcp` (host port `5432` was free prior to startup)
- **Volumes Verified Present:**
  - `byos-email_postgres-data` -> `/var/lib/postgresql/data` (`rw`)
  - `byos-email_postgres-archive` -> `/var/byos/archive` (`rw`)

---

## 3. Active Dependent-Service Check (Pre-Start)

`docker ps --no-trunc` prior to startup showed only `mystifying_agnesi` (`ghcr.io/github/github-mcp-server:latest`) running. Zero BYOS database-writing services (API, Admin API, mail router, inbound bridge, outbound worker, migration runner, or other workers) were running.

---

## 4. Startup Command, Timestamp & Exit Code

- **Command Executed (exactly once):** `docker start byos-postgres`
- **Start Timestamp:** `2026-11-26T05:05:04Z` (`StartedAt: 2026-11-26T05:05:04.323889187Z`)
- **Returned Output / Exit Code:** `byos-postgres`, `EXIT=0`

---

## 5. PostgreSQL Crash-Recovery Log Excerpts (`docker logs --since 2026-11-26T05:05:04Z --timestamps byos-postgres`)

```
2026-11-26T05:05:04.765651421Z 2026-11-26 05:05:04.765 UTC [1] LOG:  starting PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit
2026-11-26T05:05:04.765673053Z 2026-11-26 05:05:04.765 UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432
2026-11-26T05:05:04.765717250Z 2026-11-26 05:05:04.765 UTC [1] LOG:  listening on IPv6 address "::", port 5432
2026-11-26T05:05:04.772626114Z 2026-11-26 05:05:04.772 UTC [1] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
2026-11-26T05:05:04.789115335Z 2026-11-26 05:05:04.788 UTC [33] LOG:  database system was interrupted; last known up at 2026-11-25 09:23:29 UTC
2026-11-26T05:05:08.126656803Z 2026-11-26 05:05:08.126 UTC [33] LOG:  database system was not properly shut down; automatic recovery in progress
2026-11-26T05:05:08.139387056Z 2026-11-26 05:05:08.139 UTC [33] LOG:  redo starts at 0/B3000028
2026-11-26T05:05:08.139926235Z 2026-11-26 05:05:08.139 UTC [33] LOG:  unexpected pageaddr 0/B0000000 in WAL segment 0000000100000000000000B4, LSN 0/B4000000, offset 0
2026-11-26T05:05:08.139942757Z 2026-11-26 05:05:08.139 UTC [33] LOG:  redo done at 0/B3000110 system usage: CPU: user: 0.00 s, system: 0.00 s, elapsed: 0.00 s
2026-11-26T05:05:08.166778942Z 2026-11-26 05:05:08.166 UTC [31] LOG:  checkpoint starting: end-of-recovery immediate wait
2026-11-26T05:05:08.190360767Z 2026-11-26 05:05:08.190 UTC [31] LOG:  checkpoint complete: wrote 2 buffers (0.0%); 0 WAL file(s) added, 0 removed, 1 recycled; write=0.006 s, sync=0.005 s, total=0.027 s; sync files=3, longest=0.002 s, average=0.002 s; distance=16384 kB, estimate=16384 kB; lsn=0/B4000028, redo lsn=0/B4000028
2026-11-26T05:05:08.199342377Z 2026-11-26 05:05:08.198 UTC [1] LOG:  database system is ready to accept connections
```

---

## 6. Final Container State & Docker Health Status (`docker inspect byos-postgres`)

- **Container ID:** `72e2b4cee994633b528f6efddaa5678a1c6db5ae5068e70727408f10aa83774e` (unchanged)
- **`.State.Status` / `.State.Running`:** `running` / `true` (`Pid: 2607`, `ExitCode: 0`, `Error: ""`, `OOMKilled: false`, `RestartCount: 0`)
- **`.State.StartedAt`:** `2026-11-26T05:05:04.323889187Z`
- **`.State.Health.Status`:** `healthy` (`FailingStreak: 0`, 5 consecutive passing `pg_isready -h 127.0.0.1 -U byos -d byos` checks with `ExitCode: 0` from `05:05:09Z` to `05:05:29Z`)

---

## 7. `pg_isready` & Read-Only SQL Health Result

- **`docker exec byos-postgres pg_isready -h 127.0.0.1 -p 5432`:**
```
127.0.0.1:5432 - accepting connections
PG_ISREADY_EXIT=0
```
- **Read-Only SQL Transaction (`BEGIN READ ONLY; SELECT current_database(), pg_is_in_recovery(), current_timestamp; ROLLBACK;`):**
```
BEGIN
 current_database | pg_is_in_recovery |       current_timestamp       
------------------+-------------------+-------------------------------
 byos             | f                 | 2026-11-26 05:05:31.349757+00
(1 row)

ROLLBACK
```

---

## 8. WAL & Archive Configuration Observations (Read-Only `SHOW`)

| Setting | Observed Value | Matches C6.8.4 |
|---|---|---|
| `archive_mode` | `on` | Yes |
| `archive_timeout` | `5min` (`300s`) | Yes |
| `archive_command` | `/usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key` | Yes |
| `wal_level` | `replica` | Yes |
| `max_wal_senders` | `10` | Yes |
| `archive_library` | `(empty)` | Yes |

---

## 9. Redis & Other Services State

- **`byos-redis` (`7199c4dceb5f75d419c1ba6d68dab0f1b93b50a4f3048b09a6feda36fff0c646`):** Remains `Exited (255)` (not started or modified).
- **Running Containers:** Only `mystifying_agnesi` and `byos-postgres` (`Up ... (healthy)`).

---

## 10. Warnings, Errors & Safety Confirmations

- **Warnings/Errors:** PostgreSQL logged the normal end-of-WAL detection message (`unexpected pageaddr 0/B0000000 in WAL segment 0000000100000000000000B4, LSN 0/B4000000, offset 0`) during crash recovery, completed `redo` at `0/B3000110`, executed `end-of-recovery` checkpoint at `0/B4000028`, and reached `database system is ready to accept connections` with zero errors.
- **Safety Confirmations:**
  - Exactly one `docker start byos-postgres` occurred; no second startup attempt occurred.
  - No migrations, repairs, WAL switches, or data modifications were performed.
  - `BYOS_BACKUP_REMOTE_ENABLED=false` in `.env.example` remains unchanged; no AWS credentials or resources were introduced.
