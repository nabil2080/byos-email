# Cleaning up test data

In local development, automated and manual test scripts can generate test organizations, test domains, ephemeral mailboxes, sessions, message metadata, and stray storage buckets. When test artifacts accumulate, they cause phantom bugs, signature verification failures, and decryption errors.

A dedicated target is provided to reset the environment to a pristine state:
```bash
make clean-test-data
```
Or on Windows PowerShell directly:
```powershell
.\clean-test-data.ps1
```

## When to run `make clean-test-data`
- After running any manual test script (e.g. `tests/manual_verification_path_a.mjs`, integration scripts, or end-to-end testing).
- Whenever debugging test failures or unexpected behavior in `byos-api` or `webmail`.
- Before running the test suite to ensure an uncontaminated baseline.
- If `byos-api` logs a `[STARTUP-WARN] test pollution detected: ...` message during container startup.

## What it deletes
1. **PostgreSQL**:
   - Mailboxes whose `local_part` is one of `alice`, `bob`, `carol`, `dave`, or any mailbox belonging to a domain ending in `.byos.local` (or named `byos.local` in non-production), **excluding** the canonical seed mailboxes.
   - Associated `message_metadata`, `message_chunks`, `threads`, `mail_sync_tokens`, `search_tokens`, and mailbox key records.
   - Non-browser sessions created in the last 24 hours (identified by script token hashes or non-browser user agents).
   - Orphan `scheduled_messages` rows in status `pending` older than 1 hour.
   - Orphan `outbound_queue` rows in status `delivered` whose corresponding scheduled message is missing or no longer pending.
   - Orphan non-seed test users, test domains, and test organizations created during script runs.
2. **MinIO**:
   - Objects under `byos-mailbox/mailboxes/{test_mailbox_id}/` for deleted test mailboxes.
   - Stray buckets that are not the canonical `byos-mailbox` bucket (e.g. accidental `byos-mail` or test buckets).
3. **Redis**:
   - Test-only pub/sub keys and rate-limit tracking keys (`test:*`, `ratelimit:test:*`, etc.). Note: `FLUSHALL` is **not** used to avoid clearing system configuration or shared cache state.
4. **Key Reseeding**:
   - Reseeds pristine seed mailboxes (`alice@byos.local` and `bob@byos.local`) with correct Ed25519 signing keys and X-Wing encryption keys derived from canonical seed phrases.

## What it preserves
- The canonical seed organization (`00000000-0000-0000-0000-000000000aaa`).
- The canonical seed domain (`00000000-0000-0000-0000-000000000bbb`, `byos.local`).
- The canonical seed users:
  - Alice (`cccccccc-0000-0000-0000-000000000002`, `alice@byos.local`)
  - Bob (`cccccccc-0000-0000-0000-000000000003`, `bob@byos.local`)
- The canonical seed mailboxes:
  - Alice mailbox (`c0000000-0000-0000-0000-000000000001`)
  - Bob mailbox (`c0000000-0000-0000-0000-000000000002`)
- Active real browser user sessions (with standard browser `User-Agent` strings).
- Canonical MinIO bucket `byos-mailbox`.

## How to recognize pollution symptoms
Watch out for these symptoms indicating test pollution:
1. **Signature failures on Path A send (`invalid_signature`)**:
   - Cause: Stale or mismatched Ed25519 public keys in `mailboxes.mailbox_ed25519_pk` that do not match the private key derived by the client from `wrapped_sk_user`.
   - Symptom: Outbound dispatch or verification fails with signature verification errors.
2. **Decryption failures ("content decrypt: decryption failed")**:
   - Cause: Historical messages referencing stale X-Wing or AES-GCM keys, or test messages sealed with dummy keys.
   - Symptom: Webmail displays "content decrypt: decryption failed" when viewing inbox messages.
3. **Phantom MinIO objects and stray buckets**:
   - Cause: Stray buckets (e.g. `byos-mail`, `foo`) or leftover encrypted objects for mailboxes that no longer exist in Postgres.
   - Symptom: `byos-api` logs `[STARTUP-WARN] test pollution detected: more than one MinIO bucket exists...`, or storage quota tracking fails.
4. **Stuck outbound messages**:
   - Cause: Orphan `scheduled_messages` with status `pending` sealed with invalid credentials.
   - Symptom: Worker loops trying to deliver messages that can never succeed.

## Safety Guards & Environment Configuration

### Cleanup Guard (`BYOS_LOCAL_DEV`)
To protect staging and production environments against accidental data loss, `clean-test-data.ps1` enforces two guards:
1. **Local Endpoint Check**: Inspects the MinIO `local` alias and refuses to run unless the host matches `localhost`, `127.0.0.1`, `byos-minio`, or `minio:9000`.
2. **Explicit Opt-in**: Requires `BYOS_LOCAL_DEV=1` in the environment:
   ```powershell
   $env:BYOS_LOCAL_DEV = "1"
   make clean-test-data
   ```

### Startup Key-Mismatch Check (`BYOS_DEV_MODE`)
The API boots with startup pollution checks for stray buckets and stale scheduled messages. However, the cryptographic key-mismatch check (which unwraps the mailbox seed using Argon2) is a developer-time convenience and is gated behind `BYOS_DEV_MODE=1`.

- When `BYOS_DEV_MODE=1` (configured in local `docker-compose.yml`), `byos-api` verifies all active mailboxes against their wrapped seeds on boot.
- When `BYOS_DEV_MODE` is unset or not `"1"` (in production or staging), the key-mismatch check is safely skipped and `byos-api` logs:
  `[STARTUP] key-mismatch check skipped (BYOS_DEV_MODE not set)`
- Argon2 safety limits: Any wrapped seed specifying `time_cost > 10`, `memory_cost > 1_048_576` (1 GB), or `parallelism > 8` is immediately rejected to prevent CPU exhaustion.
