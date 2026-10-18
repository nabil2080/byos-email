# Final Runtime Acceptance Report

## What was built
Rebuilt the API (`byos-api`) and outbound worker (`byos-outbound-worker`) Docker container images directly from the local repository tree without restarting the entire Docker stack or touching existing services. Recreated both services with `--no-deps`. Demonstrated that the outbound worker boots cleanly under least-privilege constraints without referencing removed organization recovery database objects (`org_recovery_principals`). Audited `services/api/mailboxes_private_test.go` to enforce database isolation via `getValidatedTestDSN(t)`, preventing accidental test runs against the development database `byos`. Executed the full acceptance test suite against `byos_disposable_rehearsal`, proving all five acceptance conditions: new mailbox provisioning enforces `private` mode, legacy `org_managed` mailbox creation is rejected (HTTP 400), organization invitations and ordinary administration function normally, organization administrators cannot perform mailbox root rotation on employee mailboxes (HTTP 403), and the outbound worker starts without obsolete recovery table probes. Observed zero net accumulation on the rehearsal database and observed that the development database `byos` remained completely untouched.

## Files edited
| File | Reason |
|------|--------|
| `services/api/mailboxes_private_test.go` | Enforce test database isolation via `getValidatedTestDSN(t)` and remove unused `os` import |
| `docs/final_runtime_acceptance_report.md` | Final runtime acceptance report and verification documentation |

## Raw evidence

### 1. Docker Compose Service Identification
Command:
```powershell
docker compose -f infra/docker-compose.yml config --services
```
Raw Output:
```
admin-api
api
control-plane
cron
dovecot
inbound-worker
mail-router
mgmt-cron
outbound-worker
postfix
postgres
public-site
redis
rspamd
storage-worker
support-crm
webmail
```

Target services identified:
- `api` -> Container name `byos-api`, Dockerfile `services/api/Dockerfile`
- `outbound-worker` -> Container name `byos-outbound-worker`, Dockerfile `services/outbound-worker/Dockerfile.rust`

---

### 2. Service Rebuild from Local Source Tree
Command:
```powershell
docker compose -f infra/docker-compose.yml build api outbound-worker
```
Raw Output:
```
#1 [api internal] load build definition from Dockerfile
#1 transferring dockerfile: 504B done
#1 DONE 0.0s

#2 [outbound-worker internal] load build definition from Dockerfile.rust
#2 transferring dockerfile: 915B done
#2 DONE 0.0s
...
#18 [api 7/7] RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o /app/api ./services/api
#18 DONE 15.1s
...
#27 [outbound-worker builder 9/9] RUN cargo build --release --bin byos-outbound-worker
#27 DONE 69.1s
...
[+] Building 84.7s (28/28) FINISHED
 => => naming to docker.io/library/byos-email-api
 => => naming to docker.io/library/byos-email-outbound-worker
```

---

### 3. Service Recreation Without Full-Stack Restart
Command:
```powershell
docker compose -f infra/docker-compose.yml up -d --no-deps api outbound-worker
```
Raw Output:
```
[+] Running 2/2
 ✔ Container byos-api              Started                                 3.6s 
 ✔ Container byos-outbound-worker  Started                                 3.6s 
```

---

### 4. Container Health and Running Status
Command:
```powershell
docker ps --filter "name=byos-api" --filter "name=byos-outbound-worker" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"
```
Raw Output:
```
NAMES                  STATUS         IMAGE                        PORTS
byos-api               Up 4 minutes   byos-email-api               127.0.0.1:8080->8080/tcp
byos-outbound-worker   Up 4 minutes   byos-email-outbound-worker   8086/tcp
```

Inspect details for `byos-api`:
Command:
```powershell
docker inspect byos-api --format 'ID: {{.Id}} | Created: {{.Created}} | Image: {{.Image}} | State: {{.State.Status}} | StartedAt: {{.State.StartedAt}}'
```
Raw Output:
```
ID: 542beb548d2affc0dc25e6a8613a82812564500ffc6623a46e52dddb38e05128 | Created: 2026-10-18T14:26:25.097324089Z | Image: sha256:e6aec9fc86d6417d994ae94c1712a11a00674c62dd7cfd28f7b6689f617c5b17 | State: running | StartedAt: 2026-10-18T14:26:28.413410076Z
```

Inspect details for `byos-outbound-worker`:
Command:
```powershell
docker inspect byos-outbound-worker --format 'ID: {{.Id}} | Created: {{.Created}} | Image: {{.Image}} | State: {{.State.Status}} | StartedAt: {{.State.StartedAt}}'
```
Raw Output:
```
ID: f47f532a5d0ea5da41b5ace95fdd23ffa62fb173e045dc01920c79db2a4d76ca | Created: 2026-10-18T14:26:24.858246809Z | Image: sha256:74d5aa07a62f23770cf7aed05ea9bb42db875563b11fe10c42275d6c236d9075 | State: running | StartedAt: 2026-10-18T14:26:28.637129602Z
```

---

### 5. API Startup Logs
Command:
```powershell
docker logs --tail 30 byos-api
```
Raw Output:
```
2026/10/18 14:26:28 rate cache loaded 6 plans
2026/10/18 14:26:28 storage health monitor enabled (interval 5m0s)
2026/10/18 14:26:28 credential janitor enabled (interval 1h0m0s)
2026/10/18 14:26:28 startup check: scheduled_messages.is_path_a present
2026/10/18 14:26:28 [STARTUP] key-mismatch check skipped (BYOS_DEV_MODE not set)
2026/10/18 14:26:28 [scheduled-path-a] goroutine started
2026/10/18 14:26:28 BYOS API service starting on port 8080
```

---

### 6. Outbound Worker Startup Logs (Acceptance Condition 5)
Command:
```powershell
docker logs --tail 30 byos-outbound-worker
```
Raw Output:
```
2026-10-18T14:26:28.792626Z  INFO byos_outbound_worker: outbound-worker loaded SK (32 bytes)
2026-10-18T14:26:28.793640Z  INFO byos_outbound_worker: outbound-worker loaded DKIM DEK (32 bytes)
2026-10-18T14:26:28.797850Z  INFO byos_outbound_worker: redis connected redis://redis:6379
2026-10-18T14:26:28.806311Z  INFO byos_outbound_worker: rate cache loaded 6 plans
2026-10-18T14:26:28.807894Z  INFO byos_outbound_worker: least-privilege check root_secrets: db error
2026-10-18T14:26:28.812846Z  INFO byos_outbound_worker: least-privilege check message_metadata: db error
2026-10-18T14:26:28.814529Z  INFO byos_outbound_worker: least-privilege check device_mailbox_access: db error
2026-10-18T14:26:28.815144Z  INFO byos_outbound_worker: rate cache loaded 6 plans
2026-10-18T14:26:28.816200Z  INFO byos_outbound_worker: least-privilege check storage_connections: db error
2026-10-18T14:26:28.818118Z  INFO byos_outbound_worker: least-privilege OK: can access outbound_queue
2026-10-18T14:26:28.819938Z  INFO byos_outbound_worker: least-privilege OK: can access outbound_reservations
2026-10-18T14:26:28.822146Z  INFO byos_outbound_worker: least-privilege OK: can access scheduled_messages
2026-10-18T14:26:28.823450Z  INFO byos_outbound_worker: least-privilege OK: can access delivery_log
2026-10-18T14:26:28.825168Z  INFO byos_outbound_worker: least-privilege OK: can access mailboxes
2026-10-18T14:26:28.826264Z  INFO byos_outbound_worker: least-privilege OK: can access domains
2026-10-18T14:26:28.826909Z  INFO byos_outbound_worker: least-privilege OK: can access rate_limits
2026-10-18T14:26:28.828018Z  INFO byos_outbound_worker: least-privilege OK: can access organizations
2026-10-18T14:26:28.828071Z  INFO byos_outbound_worker: outbound-worker polling every 5000ms, postfix=postfix:25, redis=redis://redis:6379, api=api:8080
2026-10-18T14:26:28.828077Z  INFO byos_outbound_worker: scheduled poller: filtering WHERE is_path_a = false
2026-10-18T14:26:28.831665Z  INFO byos_outbound_worker: scheduled reconciliation pass: checked (found 0 pending completed rows)
```

---

### 7. Core Acceptance Test Suite (Acceptance Conditions 1, 2, 3, 4)
Command:
```powershell
powershell -Command "& { `$env:TEST_DATABASE_URL = 'postgres://byos:byos_dev_password@localhost:5432/byos_disposable_rehearsal?sslmode=disable'; go test -v -count=1 ./services/api/... -run '^(TestRejectOrgManagedMailboxCreation|TestRejectOrgManagedMailboxInvite|TestAdminCannotAccessMailboxSecretKeys|TestOrganizationGetOmitsOrgRecoveryPK|TestPostMigrationWorkflowsEndToEnd|TestRootRotationAuthz)$' }"
```
Raw Output:
```
=== RUN   TestRejectOrgManagedMailboxCreation
    mailboxes_private_test.go:19: [test-db] Using test database 'byos_disposable_rehearsal' on host 'localhost'
--- PASS: TestRejectOrgManagedMailboxCreation (0.22s)
=== RUN   TestRejectOrgManagedMailboxInvite
    mailboxes_private_test.go:133: [test-db] Using test database 'byos_disposable_rehearsal' on host 'localhost'
--- PASS: TestRejectOrgManagedMailboxInvite (0.24s)
=== RUN   TestAdminCannotAccessMailboxSecretKeys
    mailboxes_private_test.go:265: [test-db] Using test database 'byos_disposable_rehearsal' on host 'localhost'
--- PASS: TestAdminCannotAccessMailboxSecretKeys (0.20s)
=== RUN   TestOrganizationGetOmitsOrgRecoveryPK
    mailboxes_private_test.go:394: [test-db] Using test database 'byos_disposable_rehearsal' on host 'localhost'
--- PASS: TestOrganizationGetOmitsOrgRecoveryPK (0.12s)
=== RUN   TestPostMigrationWorkflowsEndToEnd
    post_migration_workflow_test.go:31: [test-db] Using test database 'byos_disposable_rehearsal' on host 'localhost'
    post_migration_workflow_test.go:50: Confirmed: running against migration 058 schema (wrapped_sk_org dropped)
    post_migration_workflow_test.go:316: Post-migration workflows verified successfully against migrated database: orgID=37bb6d5d-48a8-45ee-a435-7db9747c6eb6, founder=8c02661a-2c34-48f6-8f41-afa5f59e9981, alice=f86cd627-b301-4fb8-bc5a-2cb0bb8513e7, seats=25
--- PASS: TestPostMigrationWorkflowsEndToEnd (0.49s)
=== RUN   TestRootRotationAuthz
    root_rotation_test.go:158: [test-db] Using test database 'byos_disposable_rehearsal' on host 'localhost'
--- PASS: TestRootRotationAuthz (0.41s)
PASS
ok  	byos.email/services/api	3.298s
```

---

### 8. Backup Tooling Integration Tests
Command:
```powershell
powershell -Command "& { `$env:TEST_DATABASE_URL = 'postgres://byos:byos_dev_password@localhost:5432/byos_disposable_rehearsal?sslmode=disable'; go test -v -count=1 ./tools/byos-backup/... -run 'TestRestore_' }"
```
Raw Output:
```
=== RUN   TestRestore_SafeHistoricalBackup
Notice: destination table "org_recovery_principals" does not exist, skipping insert.
--- PASS: TestRestore_SafeHistoricalBackup (0.15s)
=== RUN   TestRestore_RejectsUnsafeMailboxOrgManagedMode
--- PASS: TestRestore_RejectsUnsafeMailboxOrgManagedMode (0.03s)
=== RUN   TestRestore_RejectsUnsafeMailboxWrappedSkOrg
--- PASS: TestRestore_RejectsUnsafeMailboxWrappedSkOrg (0.03s)
=== RUN   TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial
--- PASS: TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial (0.03s)
=== RUN   TestRestore_FailedRestoreLeavesDestinationUnchanged
--- PASS: TestRestore_FailedRestoreLeavesDestinationUnchanged (0.05s)
=== RUN   TestRestore_Post058Backup
--- PASS: TestRestore_Post058Backup (0.10s)
PASS
ok  	byos-backup	1.286s
```

---

### 9. Database State Accounting

#### Disposable Rehearsal Database (`byos_disposable_rehearsal`)
Pre-test query:
```
      tbl      | count 
---------------+-------
 organizations |     1
 users         |     2
 mailboxes     |     2
 sessions      |     0
 domains       |     2
 root_secrets  |  7844
(6 rows)
```
Post-test query:
```
      tbl      | count 
---------------+-------
 organizations |     1
 users         |     2
 mailboxes     |     2
 sessions      |     0
 domains       |     2
 root_secrets  |  7844
(6 rows)
```
Net accumulation: 0 rows across all tables.

#### Development Database (`byos`)
Pre-test query:
```
      tbl      | count 
---------------+-------
 organizations |    23
 users         |    56
 mailboxes     |    16
 sessions      |    20
 domains       |    15
 root_secrets  |  7844
(6 rows)
```
Post-test query:
```
      tbl      | count 
---------------+-------
 organizations |    23
 users         |    56
 mailboxes     |    16
 sessions      |    20
 domains       |    15
 root_secrets  |  7844
(6 rows)
```
Net alteration: 0 rows modified, added, or deleted. Development database is completely untouched.

## Manual browser verification
This task did not introduce or modify UI behaviors. It exercised backend runtime container startup, database isolation, and API acceptance criteria using HTTP integration tests against the disposable rehearsal database.

## What did not work or is untested
None. All 5 acceptance criteria were evaluated with raw output against the live containers and the migrated disposable database.

## Test suite output

### Go API Vet
Command:
```powershell
go vet ./services/api/...
```
Raw Output:
(exit code 0, 0 errors)

### Full byos-backup Test Suite
Command:
```powershell
go test -v -count=1 ./tools/byos-backup/...
```
Raw Output:
```
=== RUN   TestVerify_ValidBundle
--- PASS: TestVerify_ValidBundle (0.04s)
=== RUN   TestVerify_TamperDetection
--- PASS: TestVerify_TamperDetection (0.03s)
=== RUN   TestVerify_CryptoMetadataValidation
--- PASS: TestVerify_CryptoMetadataValidation (0.03s)
=== RUN   TestVerify_RelationalIntegrity
--- PASS: TestVerify_RelationalIntegrity (0.04s)
=== RUN   TestSection23_ComplianceFlags
--- PASS: TestSection23_ComplianceFlags (0.04s)
=== RUN   TestInspect_Summary
--- PASS: TestInspect_Summary (0.02s)
=== RUN   TestBuildInsertParams
--- PASS: TestBuildInsertParams (0.00s)
=== RUN   TestVerify_MissingManifest
--- PASS: TestVerify_MissingManifest (0.00s)
=== RUN   TestVerify_MissingTableFile
--- PASS: TestVerify_MissingTableFile (0.02s)
=== RUN   TestVerify_InvalidJSON
--- PASS: TestVerify_InvalidJSON (0.02s)
=== RUN   TestVerify_BundleAggregateMismatch
--- PASS: TestVerify_BundleAggregateMismatch (0.03s)
=== RUN   TestRestore_SafeHistoricalBackup
    backup_test.go:872: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_SafeHistoricalBackup (0.01s)
=== RUN   TestRestore_RejectsUnsafeMailboxOrgManagedMode
    backup_test.go:911: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_RejectsUnsafeMailboxOrgManagedMode (0.01s)
=== RUN   TestRestore_RejectsUnsafeMailboxWrappedSkOrg
    backup_test.go:931: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_RejectsUnsafeMailboxWrappedSkOrg (0.01s)
=== RUN   TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial
    backup_test.go:951: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial (0.01s)
=== RUN   TestRestore_FailedRestoreLeavesDestinationUnchanged
    backup_test.go:971: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_FailedRestoreLeavesDestinationUnchanged (0.00s)
=== RUN   TestRestore_Post058Backup
    backup_test.go:1020: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_Post058Backup (0.01s)
=== RUN   TestVerify_Post058BackupWithNullOrgRecovery
--- PASS: TestVerify_Post058BackupWithNullOrgRecovery (0.04s)
=== RUN   TestVerify_BackupWithoutOrgRecoveryPrincipals
--- PASS: TestVerify_BackupWithoutOrgRecoveryPrincipals (0.03s)
=== RUN   TestLegacyRecoveryData_NotExposedToApplication
--- PASS: TestLegacyRecoveryData_NotExposedToApplication (0.00s)
PASS
ok  	byos-backup	1.374s
```
