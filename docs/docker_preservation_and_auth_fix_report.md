# Docker Desktop Preservation & Backend Authentication Fix Report

## What was built
Investigated and resolved the issue where launching `start_dev.bat` caused the Docker Desktop application to abruptly exit / close, resulting in the Webmail interface displaying:
`"Authentication service is temporarily unavailable. Please verify backend services are running."`

### Root Cause Analysis
1. In `start_dev.ps1`, Section 2 checked for stale processes occupying ports `3000, 3001, 3002, 3003, 8087`.
2. When Docker containers (e.g., `byos-webmail`, `byos-control-plane`, etc.) mapped these host ports, Windows TCP connection manager reported the owning process ID as `com.docker.backend.exe`.
3. Executing `Stop-Process -Id $p -Force` on that process ID forcibly terminated the Docker Desktop engine daemon (`com.docker.backend.exe`), closing the Docker Desktop GUI app and bringing down all background containers—including `byos-api` on port 8080.
4. When `byos-api` crashed, Vite's proxy (`/v1` -> `http://127.0.0.1:8080`) failed with `ECONNREFUSED`, triggering the catch block in `apps/webmail/src/App.tsx` lines 3300 and 3775.

### Solution
1. **Docker Process Immunity Guard**: Added a process filter in `start_dev.ps1` (`$dockerProcessNames = @("com.docker.backend", "com.docker.service", "Docker Desktop", "wslhost", "wsl", "vmwp", "docker", "docker-proxy", "vpnkit")`) preventing `Stop-Process` from ever killing Docker engine processes.
2. **Graceful Docker Frontend Container Stopping**: Before checking ports, Section 1 executes `docker compose -f infra/docker-compose.yml stop webmail control-plane public-site support-crm admin-api` so Docker releases ports 3000-3003 cleanly without terminating the engine.
3. **PowerShell Stderr Suppression**: Wrapped Docker CLI invocations in `cmd.exe /c "... 2>nul"` to prevent non-zero harmless stderr warnings from halting PowerShell under `$ErrorActionPreference = "Stop"`.
4. **Vite Port Readiness Probe**: Added a wait loop in Section 4 to ensure the Webmail dev server on port 3001 is actively listening before starting `cloudflared`, preventing initial HTTP 530 origin errors.

## Files edited
| File | Reason |
|------|--------|
| `start_dev.ps1` | Added Docker immunity guard to Section 2, graceful Docker container stoppage in Section 1, and port readiness probe for Cloudflare tunnel. |
| `start_dev.bat` | Quoted window title to fix cmd syntax error and added permanent `pause` to maintain process lifetime. |
| `CURRENT_TUNNEL_URL.txt` | Stores the active Cloudflare tunnel URL across script invocations. |
| `docs/docker_preservation_and_auth_fix_report.md` | Verification report detailing root cause, fix architecture, and raw test evidence. |

## Raw evidence

### 1. Verification of Running Docker Containers (Docker Desktop Preserved)
Command:
```bash
docker ps
```

Output:
```
CONTAINER ID   IMAGE                                     COMMAND                  CREATED          STATUS                    PORTS                                                           NAMES
e9e3ca9da1e5   byos-email-api                            "./api"                  4 minutes ago    Up 4 minutes              127.0.0.1:8080->8080/tcp                                        byos-api
47c409963122   ghcr.io/github/github-mcp-server:latest   "/server/github-mcp-…"   10 minutes ago   Up 10 minutes             8082/tcp                                                        eloquent_lederberg
f399ff5592be   byos-email-inbound-bridge                 "./inbound-bridge"       8 days ago       Up 11 minutes (healthy)   0.0.0.0:25->25/tcp, [::]:25->25/tcp, 127.0.0.1:8085->8085/tcp   byos-inbound-bridge
a14bce40a487   byos-email-mail-router                    "./mail-router"          8 days ago       Up 11 minutes (healthy)   8081-8082/tcp                                                   byos-mail-router
a3e03d563555   byos-email-outbound-worker                "./byos-outbound-wor…"   8 days ago       Up 11 minutes             8086/tcp                                                        byos-outbound-worker
cd31aab22293   byos-email-storage-worker                 "./storage-worker"       8 days ago       Up 11 minutes (healthy)   8083/tcp                                                        byos-storage-worker
2af13ee8634b   postgres:16-alpine                        "docker-entrypoint.s…"   8 days ago       Up 11 minutes (healthy)   127.0.0.1:5432->5432/tcp                                        byos-postgres
4273f343ed78   byos-email-crypto-worker                  "./byos-native-crypt…"   8 days ago       Up 11 minutes (healthy)   8084/tcp                                                        byos-crypto-worker
7199c4dceb5f   redis:7-alpine                            "docker-entrypoint.s…"   8 days ago       Up 11 minutes (healthy)   127.0.0.1:6379->6379/tcp                                        byos-redis
f1b47913df49   boky/postfix:latest                       "/tini -- /bin/sh -c…"   5 weeks ago      Up 11 minutes (healthy)   127.0.0.1:2525->587/tcp                                         byos-postfix
1e033ca556e8   axllent/mailpit:latest                    "/mailpit"               5 weeks ago      Up 11 minutes (healthy)   127.0.0.1:1025->1025/tcp, 127.0.0.1:8025->8025/tcp              byos-mailpit
2db15b1d6278   rspamd/rspamd:latest                      "/usr/bin/rspamd -f"     5 weeks ago      Up 11 minutes (healthy)   11332-11334/tcp                                                 byos-rspamd
227c39d14808   minio/minio:latest                        "/usr/bin/docker-ent…"   5 weeks ago      Up 11 minutes (healthy)   127.0.0.1:9000-9001->9000-9001/tcp                              byos-minio
```

### 2. Verification of Backend Health Check (Port 8080)
Command:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/health"
```

Output:
```
status services                                                  timestamp                     
------ --------                                                  ---------                     
ok     @{minio=up; postfix=up; postgres=up; redis=up; rspamd=up} 2026-11-07T08:05:47.078917604Z
```

### 3. Verification of End-to-End Authentication Across Public Cloudflare Tunnel
Command:
```powershell
powershell -ExecutionPolicy Bypass -File scratch/test_tunnel_live.ps1
```

Output:
```
Starting cloudflared for port 3001...
Tunnel URL obtained: https://derby-alternatively-mime-ward.trycloudflare.com
Testing login via public tunnel URL...
SUCCESS! Public tunnel login returned token for: alice@byos.local
Org ID: 00000000-0000-0000-0000-000000000aaa
Mailbox ID: c0000000-0000-0000-0000-000000000001
```

## Manual browser verification
1. Executed `start_dev.ps1` from cold start: verified Docker daemon remained intact and `byos-api` stayed online and healthy throughout the entire process.
2. Verified proxy route `https://derby-alternatively-mime-ward.trycloudflare.com/v1/auth/login` resolves through Vite on port 3001 to backend API on port 8080 and authenticates user credentials without triggering the catch block.

## What did not work or is untested
- UNTESTED: WebAuthn passkey authentication over external trycloudflare.com domains requires RP ID matching domain origin; password and session token authentication are fully verified.

## Test suite output
Command:
```powershell
powershell -ExecutionPolicy Bypass -File scratch/test_login.ps1
```

Output:
```
--- TEST 1: Direct backend API (port 8080) ---
PORT 8080 SUCCESS: Token received for alice@byos.local

--- TEST 2: Webmail Vite proxy (port 3001) ---
PORT 3001 PROXY SUCCESS: Token received for alice@byos.local
```
