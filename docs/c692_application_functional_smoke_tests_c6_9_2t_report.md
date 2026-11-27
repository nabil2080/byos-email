# BYOS C6.9.2T: Application Functional Smoke Tests & Readiness Verification Report

**Phase:** C6.9.2T (Read-Only Application Functional Smoke Tests)  
**Timestamp (UTC):** `2026-11-26T11:32:09Z`  
**Repository Revision:** `ffd4692`  
**Final Verdict:** **PASS** (API, Webmail, and Control Plane passed read-only functional smoke checks; `api` `/health` reports `status: degraded` solely because `postfix` and `rspamd` remain intentionally stopped under mail containment)

---

## 1. Current Container Inventory (`2026-11-26T11:32:09Z`)

- **Running Core & Application Services (0 restarts):**
  - `byos-postgres` (`72e2b4cee994`, `running (healthy)`, `127.0.0.1:5432`)
  - `byos-redis` (`7199c4dceb5f`, `running (healthy)`, `127.0.0.1:6379`)
  - `byos-minio` (`227c39d14808`, `running (healthy)`, `127.0.0.1:9000-9001`)
  - `byos-crypto-worker` (`4273f343ed78`, `running (healthy)`, `8084`)
  - `byos-storage-worker` (`5423ae92f754`, `running (healthy)`, `8083`)
  - `byos-admin-api` (`9142b1228c80`, `running`, `127.0.0.1:8087`)
  - `byos-support-crm` (`da70e9e2b0f4`, `running`, `127.0.0.1:3003`)
  - `byos-api` (`cf4cf78ae28a`, `running`, `127.0.0.1:8080`)
  - `byos-webmail` (`382308900a82`, `running`, `127.0.0.1:3001`)
  - `byos-control-plane` (`6ad4ea19667f`, `running`, `127.0.0.1:3000`)
- **Stopped / Excluded:** `byos-outbound-worker` (`1702eb9f77e0`), `byos-inbound-bridge` (`f399ff5592be`), `byos-mail-router` (`a14bce40a487`), `byos-rspamd` (`2db15b1d6278`), `byos-postfix` (`aeb6297be7fb`), `byos-mailpit` (`1e033ca556e8`), `byos-public-site` (`93ee134bcf9f`), `sweet_napier` (`f833023698ad`), `byos-migrate` (`41e62c251776`, `exited (0)`), `byos-minio-init` (`4b0a180f2dc6`, `exited (0)`).

---

## 2. API Liveness / Readiness Classification (`services/api/health.go`)

- **`GET /health` (`healthHandler`, lines 99–125):** Always returns **HTTP 200** JSON (`HealthStatus`), acting as an HTTP liveness + dependency-status reporter. It checks `postgres`, `redis`, `minio`, `postfix` (`checkSMTP()`), and `rspamd` (`checkRspamd()`), setting `status: "degraded"` if any of the 5 is not `"up"`. No separate `/ready` or `/live` endpoint exists (`/metrics` is the only other health/telemetry endpoint).
- **Observed Response:**
```json
{"status":"degraded","services":{"minio":"up","postfix":"down","postgres":"up","redis":"up","rspamd":"down"},"timestamp":"2026-11-26T11:32:25.268344813Z"}
```
- **Classification:** Required core infrastructure (`postgres`, `redis`, `minio`) is `up`; `postfix` and `rspamd` are `down` solely because mail/SMTP services are intentionally contained.

---

## 3. API, Webmail & Control Plane Integration Results

- **API Read-Only Checks:**
  - `GET http://127.0.0.1:8080/v1/auth/me` -> `401 Unauthorized` (auth middleware active).
  - `GET http://127.0.0.1:3000/health` (Control Plane Vite proxy -> `api:8080/health`) -> `200`.
  - `GET http://127.0.0.1:3000/v1/auth/me` (Control Plane Vite proxy) -> `401`.
  - `byos-api` logs show clean startup (`rate cache loaded 6 plans`, `storage health monitor enabled`, `credential janitor enabled`, `[scheduled-path-a] goroutine started`, `[calendar-recovery] expiration worker started`, `BYOS API service starting on port 8080`) with zero panics or delivery activity.
- **Webmail Browser Smoke Check (`http://127.0.0.1:3001/`):**
  - Rendered `"BYOS Webmail"` login screen (`Email`, `Password`, `Remember this device for 30 days`, `Sign in`, `Sign in with Passkey`), zero browser console errors, `GET /v1/auth/me -> 401 Unauthorized` (unauthenticated state).
- **Control Plane Browser Smoke Check (`http://127.0.0.1:3000/`):**
  - Redirected to `/login?redirect=%2Fdashboard`, rendered `"BYOS Dashboard"` (`Sign in to Control Panel`, `WORK EMAIL`, `PASSWORD`, `Sign In to Admin Console`, `Sign in with Passkey`), zero browser console errors, `GET http://127.0.0.1:8080/v1/auth/me -> 401 Unauthorized`.

---

## 4. Mail Containment & Queue Counts

- **Ports `25`, `2525`, `1025`, `8025`:** Verified closed (`EXCLUDED_PORTS_CLOSED`), and `outbound-worker`, `inbound-bridge`, `mail-router`, `rspamd`, `postfix`, `mailpit` remain exited.
- **Read-Only DB Counts (`byos-postgres`):** `outbound_queue` (`delivered = 1`, `0` pending/processing), `scheduled_messages` (`0` rows), `calendar_event_migrations` (`finalized = 3`).
- **`BYOS_BACKUP_REMOTE_ENABLED=false`** remains unchanged in `.env.example`.

---

## 5. Prior Isolated Test & Build Evidence (Unchanged Code Since C6.9.2O/R)

- `services/api`: `go vet ./...` -> `EXIT=0` (C6.9.2R)
- `apps/webmail`: `npm.cmd run build` -> `EXIT=0` (`18.88s`, C6.9.2R)
- `apps/control-plane`: `npm.cmd run build` -> `EXIT=0` (`5.80s`, C6.9.2R)
- `tools/byos-migrate` (`16.982s`), `services/admin-api` (`1.381s` + `5.246s`), `services/storage-worker` (`4.764s`) -> `EXIT=0` (C6.9.2O)
- **Limitation:** Authenticated end-to-end Webmail/Control Plane flows were not exercised in C6.9.2T because this milestone is strictly read-only without mutating/creating test sessions or accounts.
