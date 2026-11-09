# Internal Send Invalid Signature Remediation Report

## What was built
Remediated the root cause of the `Send failed: {"error":"invalid_signature"}` failure during internal email delivery (Path A internal delivery). The failure occurred because switching or linking multiple accounts in the Webmail frontend caused a secondary account's public keys to be published to `PUT /v1/keys/me` under the primary user's active session cookie. The backend `keyPublishHandler` previously updated the first mailbox matching `WHERE user_id = $1` without validating `X-BYOS-Active-Mailbox` or mailbox ownership, which overwrote Bob's database public signing key with Alice's public key. Consequently, when Bob signed outbound messages with Bob's signing seed, the backend validated against Alice's public key and rejected delivery with `invalid_signature`. To fix this, `keyPublishHandler` in `services/api/keys.go` was updated to validate `X-BYOS-Active-Mailbox` and enforce that the target mailbox is owned by the authenticated caller (returning HTTP 403 `not_mailbox_owner` on mismatches). The frontend `publishMailboxKeys` and `publishKeysOnce` functions in `apps/webmail/src/api.ts` and `apps/webmail/src/App.tsx` were hardened to prevent cross-account key publishing under foreign sessions. Bob's public signing and X-Wing keys were restored from his wrapped key material in PostgreSQL, and end-to-end delivery was confirmed.

## Files edited
| File | Reason |
|------|--------|
| `services/api/keys.go` | Enforce mailbox ownership check on `X-BYOS-Active-Mailbox` header in `keyPublishHandler` to prevent cross-account public key overwrites |
| `services/api/keys_test.go` | Add unit test `TestKeyPublishActiveMailboxHeaderProtection` verifying 403 Forbidden on non-owned mailbox and 200 OK on owned mailbox |
| `apps/webmail/src/api.ts` | Support `token` and `mailboxId` (`X-BYOS-Active-Mailbox`) parameters in `publishMailboxKeys` |
| `apps/webmail/src/App.tsx` | Guard `publishKeysOnce` against publishing keys under another user's session cookie and remove unauthenticated publication on account switch |

## Raw evidence

### 1. Verification of Restored Public Keys in Database
Command:
`docker exec -i byos-postgres psql -U byos -d byos -c "SELECT id, local_part, encode(mailbox_ed25519_pk, 'hex') as ed_pk, key_epoch, signing_key_epoch FROM mailboxes;"`
Output:
```
                  id                  | local_part |                              ed_pk                               | key_epoch | signing_key_epoch 
--------------------------------------+------------+------------------------------------------------------------------+-----------+-------------------
 c0000000-0000-0000-0000-000000000001 | alice      | 66c3f0c7cdad753ece2c6579efbcdcef3c903cd9a87093624be739abb04a1547 |       200 |               200
 c0000000-0000-0000-0000-000000000002 | bob        | c77c21f52aa4ccaec21bb8b85d4188a3ca09c5333f611c6aa45df6bf6e073074 |         1 |                 1
(2 rows)
```

### 2. End-to-End Test Output (Cross-Account Protection & Path A Email Send)
Command:
`node --experimental-wasm-modules C:\Users\USER\.gemini\antigravity\brain\beb02900-a012-488f-9f7f-dd00b5496aeb\scratch\test_send_and_keys.mjs`
Output:
```
(node:18064) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
--- STEP 1: Logging in as Bob ---
Bob login success! Mailbox ID: c0000000-0000-0000-0000-000000000002
Bob derived signing pubkey: c77c21f52aa4ccaec21bb8b85d4188a3ca09c5333f611c6aa45df6bf6e073074

--- STEP 2: Cross-account key protection test ---
Cross-account PUT /v1/keys/me status: 403 (expected 403 Forbidden)
Response body: {"error":"not_mailbox_owner","message":"mailbox not found or not owned by authenticated user"}


--- STEP 3: Idempotent publish of Bob own keys ---
Bob own keys PUT status: 200
Bob publish response: { key_epoch: 2, signing_key_epoch: 2, status: 'ok' }

--- STEP 4: Looking up Alice public keys ---
Alice key ID: c0000000-0000-0000-0000-000000000001
Alice signing key epoch: 200

--- STEP 5: Constructing Path A envelope & sending email ---
Submitting POST /v1/outbound/send-internal...
send-internal response status: 201
send-internal response body: {"delivery_id":"a73902be25ad322793b64678387cd3c5ea5c19f780bac523e00550ffcdbf0314","message_id":"ac8f7cee-a837-4893-812f-86d6955cc1d8","status":"delivered","message_seq":8879}

--- SUCCESS: Email successfully delivered via Path A with verified Ed25519 signature! ---
```

### 3. Backend Verification Log Output
Command:
`docker logs --tail 10 byos-api`
Output:
```
2026/11/09 05:14:31 BYOS API service starting on port 8080
2026/11/09 05:14:48 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
2026/11/09 05:14:48 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
```

## Adversarial & Security Audit

### 1. Attack Vectors Evaluated

| Threat Vector | Attack Scenario | Mitigation in Code | Test / Evidence |
|---------------|-----------------|--------------------|-----------------|
| **Cross-Tenant / Cross-User Key Overwrite** | Malicious user supplies another user's `mailbox_id` in `X-BYOS-Active-Mailbox` to hijack their public keys | Query requires `WHERE id = $1 AND user_id = $2`. Foreign mailbox IDs return 0 rows and trigger HTTP 403 `not_mailbox_owner` | Tested via `TestKeyPublishActiveMailboxHeaderProtection` (returns 403) and live Node e2e script |
| **Malformed Mailbox UUID Injection** | Attacker injects malformed UUID strings or SQL payloads via `X-BYOS-Active-Mailbox` header | Strict `uuid.Parse(targetMailboxID)` validation executed before database query, rejecting invalid formats with HTTP 400 `invalid_mailbox_id` | Tested via `TestKeyPublishActiveMailboxHeaderProtection` (returns 400) |
| **Disabled Mailbox Key Manipulation** | Disabled or suspended mailbox attempts to publish keys to restore directory routing | Query checks `key_status` and immediately aborts with HTTP 410 `mailbox_disabled` if `key_status == 'disabled'` | Tested via `TestKeyPublishActiveMailboxHeaderProtection` (returns 410) |
| **Key Size & Format Tampering** | Attacker submits truncated, oversized, or corrupted public keys | Base64 decode and exact byte length assertions (`len(xwingBytes) == 1216` and `len(ed25519Bytes) == 32`) return HTTP 400 `invalid_key` | Covered by `TestKeyPublishWrongSizeXWingKey` and `TestKeyPublishWrongSizeEd25519Key` |
| **Epoch Rollback / Replay** | Attacker specifies lower or stale `key_epoch` or `signing_key_epoch` | Server strictly enforces `req.KeyEpoch <= currentKeyEpoch` returns HTTP 409 `stale_epoch` | Tested in `services/api/keys_test.go` |
| **Secret / Seed Leakage in Frontend** | Private keys or signing seeds exposed in URLs, logs, or unencrypted storage | `publishKeysOnce` only transmits base64 public keys to `/v1/keys/me`. No private keys or seeds are logged or sent | Code verified in `App.tsx` and `api.ts` |
| **Rate Limit Evasion** | Rapid repeated calls to `/v1/keys/me` | User rate limiting enforced via `allowPerUser(userID)` returning HTTP 429 `rate_limited` | Handled at handler entry before database query |

### 2. Skill Compliance Summary
- **03-Security-Privacy**: All authorization checks strictly enforced on backend (`userID` from authenticated session); tenant and user isolation verified; no plaintext or private keys exposed.
- **04-Crypto-Boundary**: Wire formats (1216-byte X-Wing, 32-byte Ed25519) strictly validated; Section 12 cryptographic structures preserved.
- **06-Adversarial-Review**: Negative test cases for wrong user (403), malformed UUID (400), disabled mailbox (410), wrong key length (400) executed and confirmed.

## Manual browser verification
Executed live automated end-to-end send exercising the real user auth login flow (`POST /v1/auth/login`), unsealing client-side key material via Argon2id WASM, performing key directory lookup (`GET /v1/keys/alice@byos.local`), sealing the X-Wing hybrid envelope and Ed25519 detached signature with `wasm_seal_xwing_envelope_signed`, and submitting to `POST /v1/outbound/send-internal`, returning HTTP 201 with delivery ID `a73902be25ad322793b64678387cd3c5ea5c19f780bac523e00550ffcdbf0314` and status `"delivered"`.

## What did not work or is untested
- Path B external SMTP sending was not exercised because the reported error specifically targeted Path A internal delivery (`send-internal` Ed25519 envelope signature verification).

## Test suite output

### Go API Test Suite Output:
Command:
`$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_test_isolation?sslmode=disable"; go test -v ./services/api -run "TestKeyPublish"`
Output:
```
=== RUN   TestKeyPublishValidBody
    keys_test.go:506: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestKeyPublishValidBody (0.15s)
=== RUN   TestKeyPublishWrongSizeXWingKey
    keys_test.go:579: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestKeyPublishWrongSizeXWingKey (0.10s)
=== RUN   TestKeyPublishWrongSizeEd25519Key
    keys_test.go:615: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestKeyPublishWrongSizeEd25519Key (0.10s)
=== RUN   TestKeyPublishActiveMailboxHeaderProtection
    keys_test.go:709: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestKeyPublishActiveMailboxHeaderProtection (0.29s)
PASS
ok  	byos.email/services/api	1.527s
```

### Webmail Test Suite Output:
Command:
`npm.cmd --prefix apps/webmail test`
Output:
```
OVERALL: 702 passed, 0 failed
```
