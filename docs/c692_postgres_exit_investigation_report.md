# BYOS C6.9.2G: Active PostgreSQL Exit Investigation & Data-Preservation Audit

**Phase:** C6.9.2G (Read-Only Exit Investigation)  
**Final Status:** **INVESTIGATED - CAUSE IDENTIFIED** (Docker Desktop / WSL2 VM interruption & fresh startup at `2026-11-26T04:17:15Z`, 27 minutes before C6.9.2F; file-level database integrity remains **UNKNOWN** until a separately authorized controlled startup/check)  
**Safety Confirmation:** **No restart, repair, migration, SQL execution, or data modification was performed.**

---

## 1. Previous Known Healthy Status & Current Container State

- **Previous Known Status (from C6.9.2E handoff):** `72e2b4cee994`, `Up ~9h (healthy)`.
- **Current Container State:** `Exited (255)` (`Running: false`, `Status: exited`).
- **Exact Container Identity:**
  - **Container ID:** `72e2b4cee994633b528f6efddaa5678a1c6db5ae5068e70727408f10aa83774e` (matches previously reported `72e2b4cee994`)
  - **Name:** `/byos-postgres`
  - **Image:** `postgres:16-alpine`
  - **Created:** `2026-11-25T06:30:19.71450137Z`

---

## 2. Exit Code & State Metadata (`docker inspect byos-postgres`)

| Field | Observed Value |
|---|---|
| `State.Status` | `exited` |
| `State.ExitCode` | `255` |
| `State.Error` | `""` |
| `State.OOMKilled` | `false` |
| `State.Dead` | `false` |
| `State.StartedAt` | `2026-11-25T08:40:46.069781917Z` |
| `State.FinishedAt` | `2026-11-26T04:17:25.493305609Z` (`10:17:25 AM +06:00`) |
| `RestartCount` | `0` |
| `HostConfig.RestartPolicy` | `{"MaximumRetryCount":0,"Name":"no"}` |
| `State.Health` | `{"FailingStreak":0,"Log":[],"Status":"starting"}` |
| `NetworkSettings.Networks` | `byos-email_default` |
| `Host Port Mapping (ps -a)` | `127.0.0.1:5432->5432/tcp` |

*(Environment variables were intentionally omitted to avoid exposing secrets.)*

---

## 3. Relevant PostgreSQL Container Log Excerpts (`docker logs --timestamps --tail 500 byos-postgres`)

No PostgreSQL normal, fast, or immediate shutdown messages, fatal PostgreSQL startup/WAL errors, or disk-full/permission errors appear at the end of the container logs. The final logged events are from `2026-11-25`:

```
2026-11-25T09:23:13.818378725Z SUCCESS: Archived WAL 0000000100000000000000B2 (Plaintext: 16777216 bytes, Cipher: v1)
2026-11-25T09:28:13.701417006Z SUCCESS: Archived WAL 0000000100000000000000B3 (Plaintext: 16777216 bytes, Cipher: v1)
2026-11-25T09:23:14.535023552Z 2026-11-25 09:23:14.534 UTC [30] LOG:  checkpoint starting: time
2026-11-25T09:23:29.482209191Z 2026-11-25 09:23:29.481 UTC [30] LOG:  checkpoint complete: wrote 149 buffers (0.9%); 0 WAL file(s) added, 0 removed, 1 recycled; write=14.786 s, sync=0.134 s, total=14.948 s; sync files=766, longest=0.003 s, average=0.001 s; distance=1596 kB, estimate=9940 kB; lsn=0/B3000060, redo lsn=0/B3000028
```

---

## 4. Docker Daemon & Host Evidence (`%LOCALAPPDATA%\Docker\log`)

Docker Desktop logs establish a WSL2 VM interruption on `2026-11-25` followed by a fresh Docker Desktop & WSL2 VM startup at `2026-11-26T04:17:15Z`:

1. `com.docker.backend.exe.log.20261126-104851.947`:
```
[2026-11-25T17:12:54.619511100Z][com.docker.backend.exe.wslexec][E] c:\windows\system32\wsl.exe -d docker-desktop -e /usr/bin/vpnkit-bridge --pid-file=/run/vpnkit-bridge.pid guest failed: exit status 0x40010004
[2026-11-25T17:12:54.622214000Z][com.docker.backend.exe.vpnkitcontrol.multiplex] connection multiplexer has shutdown
-------------------------------------------------------------------------------->8
[2026-11-26T04:17:15.783548600Z][com.docker.backend.exe] running monitor
[2026-11-26T04:17:15.898238800Z][com.docker.backend.exe] running services
```
2. `vm\init.log.20261126-101748.872`:
```
{"component":"dns.leases","level":"info","msg":"eBPF loaded","time":"2026-11-26T04:17:23.401829731Z"}
{"component":"httpproxy","level":"info","msg":"listening on TCP port 3128 for internal HTTP proxy","time":"2026-11-26T04:17:23.430450910Z"}
```
3. Immediately after the VM booted (`04:17:23Z`), `dockerd` marked both previously running containers with `RestartPolicy: "no"` as `Exited (255)` at the same instant:
   - `byos-redis` (`7199c4dceb5f`): `FinishedAt: 2026-11-26T04:17:25.48994835Z`, `ExitCode: 255`
   - `byos-postgres` (`72e2b4cee994`): `FinishedAt: 2026-11-26T04:17:25.493305609Z`, `ExitCode: 255`

---

## 5. Disposable Test Container (`byos-c692f-restore-test`) Timeline

- **C6.9.2F Execution Window:** `byos-c692f-restore-test` (`45bf5ffa0b93`) was created at ~`2026-11-26T04:44:17Z` (`10:44:17 AM +06:00`) and stopped/removed with `docker rm -v` at ~`2026-11-26T04:47:59Z` (`10:47:59 AM +06:00`).
- **Isolation:** Bound to `127.0.0.1:55433:5432` on default bridge network with container-local ephemeral storage; cleanup targeted only `byos-c692f-restore-test`.
- **Correlation:** `byos-postgres` exited at `04:17:25Z` — **~27 minutes before** C6.9.2F created `byos-c692f-restore-test`. C6.9.2F did **not** cause the `byos-postgres` exit.

---

## 6. Related Service States (`docker ps -a`)

- `byos-postgres` (`72e2b4cee994`): `Exited (255)` (`FinishedAt: 2026-11-26T04:17:25.493Z`)
- `byos-redis` (`7199c4dceb5f`): `Exited (255)` (`FinishedAt: 2026-11-26T04:17:25.489Z`)
- All other BYOS Compose containers (`byos-api`, `byos-admin-api`, `byos-mail-router`, `byos-inbound-bridge`, `byos-outbound-worker`, `byos-crypto-worker`, `byos-storage-worker`, `byos-webmail`, `byos-control-plane`, `byos-support-crm`, `byos-public-site`, `byos-postfix`, `byos-mailpit`, `byos-rspamd`, `byos-minio`) were already exited 41–45 hours / 2 days earlier.
- Only `mystifying_agnesi` (`ghcr.io/github/github-mcp-server:latest`) was `Up` (started ~`04:20Z`, after Docker Desktop restarted).

---

## 7. Volume-Preservation Findings (`docker volume inspect`)

`byos-postgres` mounts remain intact and both named volumes exist:
- `byos-email_postgres-data` (`CreatedAt: 2026-09-30T08:40:52Z`, mounted at `/var/lib/postgresql/data`, `rw`)
- `byos-email_postgres-archive` (`CreatedAt: 2026-11-25T06:30:19Z`, mounted at `/var/byos/archive`, `rw`)

*(File-level PostgreSQL data-directory and WAL state inside `byos-email_postgres-data` cannot be inspected without mounting or starting the database, which is prohibited in this read-only phase.)*

---

## 8. Confirmed Facts, Possible Causes, and Unknowns

- **Confirmed Facts (Cause Identified):**
  1. Docker Desktop / WSL2 experienced a `vpnkit-bridge` shutdown (`0x40010004`) at `2026-11-25T17:12:54Z` and restarted fresh at `2026-11-26T04:17:15Z`.
  2. Upon VM boot (`04:17:23Z`), `dockerd` recorded both `byos-redis` and `byos-postgres` (which both had `RestartPolicy: "no"`) as `Exited (255)` at `04:17:25.49Z` with `OOMKilled: false`.
  3. No PostgreSQL fatal/corruption/OOM error appears in `byos-postgres` logs, and C6.9.2F occurred 27 minutes later.
- **Possible Causes of the `2026-11-25T17:12:54Z` WSL2 Exit:** Host sleep/hibernation, Windows WSL2 shutdown, or Docker Desktop exit/update prior to `2026-11-26T04:17:15Z`.
- **Unknowns:** Whether PostgreSQL `PGDATA` inside `byos-email_postgres-data` requires standard crash recovery (`redo` from `0/B3000028` upon next clean startup) or encountered any unclean page/WAL state during the `17:12:54Z` WSL2 interruption.

---

## 9. Recommended Next Step

**Outcome A / C (Docker Desktop / WSL2 interruption; no log evidence of data corruption):**  
1. Do **not** run `pg_resetwal`, `initdb`, or `docker compose down -v`.
2. When separately authorized by the operator, perform a controlled startup of `byos-postgres` (`docker start byos-postgres`) while tailing `docker logs -f byos-postgres` to observe PostgreSQL crash-recovery (`redo`) and health-check completion, and verify WAL archiving resumes cleanly.

---

## 10. Explicit Safety Statement

No container was started, restarted, stopped, or removed; no PostgreSQL repair, migration, or SQL query was executed; no volume was mounted or modified; and no AWS or remote-backup configuration was changed.
