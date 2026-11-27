# BYOS C6.9.2Q: Controlled Runtime Containment Report

**Phase:** C6.9.2Q (Controlled Runtime Containment)  
**Start / Completion Timestamps (UTC):** `2026-11-26T10:43:44Z` – `2026-11-26T10:44:20Z`  
**Repository Revision:** `ffd4692`  
**Approval Evidence:** Explicit operator approval `APPROVE C6.9.2Q CONTAINMENT`  
**Final Verdict:** **PASS** (all 10 approved containment targets stopped gracefully with `EXIT=0`; core infrastructure remains healthy; no containers, networks, or volumes removed)

---

## 1. Approved Stop Targets & Execution Results (`EXIT=0` for all 10)

| Order | Target | Command | Exit Code | Result |
|---|---|---|---|---|
| 1 | `outbound-worker` (`1702eb9f77e0`) | `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 outbound-worker` | `0` | Stopped |
| 2 | `inbound-bridge` (`f399ff5592be`) | `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 inbound-bridge` | `0` | Stopped |
| 3 | `api` (`cf4cf78ae28a`) | `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 api` | `0` | Stopped |
| 4 | `webmail` (`382308900a82`) | `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 webmail` | `0` | Stopped |
| 5 | `control-plane` (`6ad4ea19667f`) | `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 control-plane` | `0` | Stopped |
| 6 | `mail-router` (`a14bce40a487`) | `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 mail-router` | `0` | Stopped |
| 7 | `rspamd` (`2db15b1d6278`) | `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 rspamd` | `0` | Stopped |
| 8 | `postfix` (`aeb6297be7fb`) | `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 postfix` | `0` | Stopped |
| 9 | `mailpit` (`1e033ca556e8`) | `docker compose -f infra/docker-compose.yml -p byos-email stop -t 30 mailpit` | `0` | Stopped |
| 10 | `sweet_napier` (`f833023698ad`) | `docker stop -t 15 f833023698ad7c22fc3e8740caa669ed8d9a86d6928bd81e3c35b40998a4d932` | `0` | Stopped |

---

## 2. `sweet_napier` Investigation & Disposition

- `sweet_napier` (`f833023698ad7c22fc3e8740caa669ed8d9a86d6928bd81e3c35b40998a4d932`) was an orphaned/duplicate `byos-email-api:latest` container (`Cmd: ["./api"]`) attached only to the default `bridge` network (`172.17.0.2`, no host ports) failing every 5m to connect to `127.0.0.1:5432`. Stopped cleanly (`EXIT=0`) without removing it.

---

## 3. Infrastructure Health & Containment Verification

- **Core Infrastructure Running & Healthy:** `byos-postgres` (`72e2b4cee994`, `pg_isready` -> `accepting connections`), `byos-redis` (`7199c4dceb5f`, `PING` -> `PONG`), `byos-minio` (`227c39d14808`, `:9000/minio/health/live` -> `200`), `byos-crypto-worker` (`4273f343ed78`, `healthy`), `byos-storage-worker` (`5423ae92f754`, `healthy`), `byos-admin-api` (`9142b1228c80`, `running`), `byos-support-crm` (`da70e9e2b0f4`, `:3003/` -> `200`), `byos-migrate` (`41e62c251776`, `Exited (0)`), `byos-minio-init` (`4b0a180f2dc6`, `Exited (0)`).
- **SMTP & Background Processing Stopped:** Ports `25`, `2525`, `1025`, `8025`, `8080`, `3000`, and `3001` are no longer listening (`ALL_CONTAINED_PORTS_CLOSED` — verified post-stop).
- **`byos-public-site` (`93ee134bcf9f`):** Remains `Exited (1)` with its known stale Astro v7 dev-server PID/lock (`PID: 19`). Not modified or rebuilt.
- **C6.9.2P Inventory Failure Note:** In C6.9.2P, the initial `docker inspect` Go template command exited `1` due to PowerShell inner-quote stripping on `index .Config.Labels "com.docker.compose.service"` (`function "com" not defined`), and was immediately re-run via `ConvertFrom-Json` in C6.9.2P so all inventory data was captured completely.
- **Safety:** `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged; no volumes, containers, networks, or repository code were removed or altered.
