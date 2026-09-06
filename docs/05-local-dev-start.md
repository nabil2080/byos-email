# Local Development Start

## Prerequisites

Install these first:

- Docker Desktop
- Git
- Go
- Node.js
- pnpm or npm

Docker is required before the local infrastructure can run.

## Start Infrastructure

From PowerShell:

```powershell
cd F:\Codex\byos-email\infra
docker compose up
```

To run in the background:

```powershell
cd F:\Codex\byos-email\infra
docker compose up -d
```

## Local Service URLs

```text
PostgreSQL: localhost:5432
Redis:      localhost:6379
MinIO API:  http://localhost:9000
MinIO UI:   http://localhost:9001
SMTP:       localhost:1025
Rspamd UI:  http://localhost:11334
```

## MinIO Login

```text
Username: byosminio
Password: byosminio_dev_password
```

## First Build Target

Build the smallest working loop:

```text
Local test email
  -> Postfix
  -> Rspamd
  -> mail-router service
  -> crypto-worker boundary
  -> storage-worker
  -> encrypted object in MinIO
  -> webmail reads object
```

## Important Rule

Do not add real cryptography directly inside the mail router or webmail app.

Keep cryptography behind the crypto package and crypto-worker boundary until the cryptographic specification is approved.

