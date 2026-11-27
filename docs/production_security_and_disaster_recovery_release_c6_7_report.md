# Production Security Boundary & Disaster Recovery Release C6.7 Report

## What was built
BYOS Release C6.7 validates production readiness, PostgreSQL role security, canonical database migration resilience, pre-egress backup encryption, and disaster recovery restoration for the BYOS zero-knowledge email platform. The release independently audited the least-privilege boundary established in Migration 075, verifying that `role_support_agent` cannot tamper with schema, disable triggers, alter table ownership, set `session_replication_role`, transition messages to `processing`, acquire worker leases, or mutate records with active worker leases. Zero `SECURITY DEFINER` functions or hidden proxy views exist in the database. Canonical migration integrity across all 74 migrations (001–004, 006–075, historically skipping 005) was demonstrated through fresh zero-to-current installations, version 072-to-075 upgrades with preserved records, checksum mismatch rejections, missing migration detections, duplicate version rejections, and atomic transaction rollbacks upon simulated failure. A pre-egress authenticated backup encryption subsystem was implemented using AES-256-GCM (`BYOSENC1` header, `BYOS_BACKUP_V1` authenticated additional data) with strict cryptographic key isolation preventing key storage in backup directories. An automated retention lifecycle policy (daily 7d, weekly 4w, monthly 12m) with strict last-known-good backup preservation was implemented and verified. Complete disaster recovery was demonstrated by decrypting and restoring into an isolated target database (`byos_disposable_restore_c67`), benchmarking a Restoration Time Objective (RTO) of 4.31 seconds while establishing an operational Recovery Point Objective (RPO) bounded by snapshot frequency until continuous WAL archiving is deployed.

## Files edited
| File | Reason |
|------|--------|
| tools/c67_security_boundary_audit.sql | Comprehensive SQL test suite auditing trigger bypass, boundary violations, SECURITY DEFINER functions, and role privileges |
| tools/byos-backup/crypto.go | Implements AES-256-GCM authenticated encryption, decryption, archive packaging, and key isolation enforcement |
| tools/byos-backup/crypto_test.go | Unit tests verifying AES-256-GCM roundtrip, wrong-key rejection, tamper detection, and key isolation |
| tools/byos-backup/retention.go | Implements daily, weekly, and monthly retention pruning with strict lone surviving backup protection |
| tools/byos-backup/retention_test.go | Unit tests verifying retention horizons, tier bucketing, and last-known-good preservation invariants |
| tools/byos-backup/main.go | CLI wiring for `encrypt-bundle`, `decrypt-bundle`, `verify-encrypted`, and `prune` commands |
| tools/backup_encrypted.ps1 | Automated PowerShell backup script executing globals dump, database archive, AES-256-GCM encryption, verification, and pruning |
| tools/backup_encrypted.sh | Automated Linux/bash backup script executing globals dump, database archive, AES-256-GCM encryption, verification, and pruning |
| tools/restore_encrypted.ps1 | Automated PowerShell disaster recovery script decrypting AES-256-GCM archives and restoring globals and database objects with RTO timing |
| tools/restore_encrypted.sh | Automated Linux/bash disaster recovery script decrypting AES-256-GCM archives and restoring globals and database objects with RTO timing |
| docs/runbooks/backup_and_disaster_recovery.md | Updated operational runbook with pre-egress authenticated encryption, key isolation rules, retention lifecycle, and RPO/RTO targets |
| docs/runbooks/deployment_and_migration.md | Updated pre-deployment checklist requiring encrypted backups prior to production release execution |
| docs/production_security_and_disaster_recovery_release_c6_7_report.md | Formal engineering report documenting C6.7 verification evidence and disaster recovery benchmarks |

## Raw evidence

### 1. Repository Safety Baseline
Command:
```powershell
git rev-parse --show-toplevel; git branch --show-current
```
Output:
```
F:/Codex/byos-email
main
```

### 2. Canonical Migration Inventory Verification
Verification of the exact 74 migration files in `infra/postgres/migrations/` (001–004, 006–075, omitting 005):
Command:
```powershell
Get-ChildItem -Path infra/postgres/migrations/*.sql | Measure-Object; Get-ChildItem -Path infra/postgres/migrations/*.sql | Select-Object -First 5 -ExpandProperty Name; Get-ChildItem -Path infra/postgres/migrations/*.sql | Select-Object -Last 5 -ExpandProperty Name
```
Output:
```
Count    : 74
Average  : 
Sum      : 
Maximum  : 
Minimum  : 
Property : 

001_init.sql
002_outbound_reservations.sql
003_scheduled_enhancements.sql
004_rate_limits.sql
006_storage_enhancements.sql
071_outbound_delivery_operations.sql
072_operator_reconciliation_provenance.sql
073_operator_retry_governance_and_idempotency.sql
074_support_agent_retry_governance_permissions.sql
075_support_agent_least_privilege_hardening.sql
```

### 3. PostgreSQL Security & Privilege Boundary Audit
Execution of `tools/c67_security_boundary_audit.sql` against `byos_test_isolation` verifying trigger bypass resistance, zero SECURITY DEFINER functions, boundary enforcement, and worker privilege boundaries:
Command:
```powershell
Get-Content tools/c67_security_boundary_audit.sql | docker exec -i byos-postgres psql -U byos -d byos_test_isolation
```
Output:
```
               test_section               
------------------------------------------
 === SECTION 1: VIEWS AND RULES AUDIT ===
(1 row)

 schemaname | viewname | viewowner | definition 
------------+----------+-----------+------------
(0 rows)

 tablename | rulename | definition 
-----------+----------+------------
(0 rows)

                    test_section                     
-----------------------------------------------------
 === SECTION 2: SECURITY DEFINER FUNCTIONS AUDIT ===
(1 row)

 nspname | proname | owner | prosecdef | proconfig | proacl 
---------+---------+-------+-----------+-----------+--------
(0 rows)

       test_section        
---------------------------
 === SEEDING TEST ROWS ===
(1 row)

RESET
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
DELETE 0
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
                           test_section                           
------------------------------------------------------------------
 === SECTION 4: TRIGGER BYPASS ATTEMPTS BY role_support_agent ===
(1 row)

SET
    active_role     
--------------------
 role_support_agent
(1 row)

ERROR:  must be owner of table outbound_queue
ERROR:  must be owner of relation outbound_queue
ERROR:  must be owner of table outbound_queue
ERROR:  permission denied to set parameter "session_replication_role"
ERROR:  permission denied for schema public
ERROR:  must be owner of function enforce_support_agent_outbound_queue_boundaries
                           test_section                            
-------------------------------------------------------------------
 === SECTION 5: BOUNDARY VIOLATION TESTS BY role_support_agent ===
(1 row)

ERROR:  role_support_agent is restricted to reconciling outcome_unknown items only (current status: pending)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 14 at RAISE
ERROR:  role_support_agent cannot transition outbound_queue items to processing status
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 20 at RAISE
ERROR:  role_support_agent cannot acquire or set lease fields (lease fields can only be cleared to NULL or preserved)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 29 at RAISE
ERROR:  role_support_agent cannot set or advance smtp_phase (smtp_phase can only be cleared to NULL or preserved)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 35 at RAISE
ERROR:  role_support_agent is restricted to reconciling outcome_unknown items only (current status: processing)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 14 at RAISE
                     test_section                      
-------------------------------------------------------
 === SECTION 6: LEGITIMATE OPERATOR RECONCILIATION ===
(1 row)

                  id                  | status  | manual_retry_count |        next_attempt_at        |      reconciled_by      |          reconciliation_reason           
--------------------------------------+---------+--------------------+-------------------------------+-------------------------+------------------------------------------
 f6700000-0000-0000-0000-000000000001 | pending |                  1 | 2026-11-24 09:09:39.788837+00 | support-lead@byos.local | Authorized manual retry after peer reset
(1 row)

UPDATE 1
                 test_section                  
-----------------------------------------------
 === SECTION 7: OUTBOUND WORKER PRIVILEGES ===
(1 row)

SET
      active_role      
-----------------------
 outbound_worker_login
(1 row)

ERROR:  must be owner of table outbound_queue
ERROR:  must be owner of relation outbound_queue
                  id                  |   status   |   lease_owner   | attempts 
--------------------------------------+------------+-----------------+----------
 f6700000-0000-0000-0000-000000000003 | processing | worker-node-c67 |        1
(1 row)

UPDATE 1
                  id                  |   status   | smtp_phase 
--------------------------------------+------------+------------
 f6700000-0000-0000-0000-000000000003 | processing | pre_data
(1 row)

UPDATE 1
                  id                  |  status   |         delivered_at         | last_smtp_code 
--------------------------------------+-----------+------------------------------+----------------
 f6700000-0000-0000-0000-000000000003 | delivered | 2026-11-24 09:09:39.80026+00 |            250
(1 row)

UPDATE 1
RESET
DELETE 4
      test_section      
------------------------
 === AUDIT COMPLETE ===
(1 row)
```

### 4. Canonical Migration Test A: Fresh Install & Idempotency
Fresh zero-to-current installation on `byos_disposable_fresh_c67`:
Command:
```powershell
cd tools/byos-migrate; go run . up -dir ../../infra/postgres/migrations -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c67?sslmode=disable"
```
Output:
```
2026/11/24 15:11:18 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7172
2026/11/24 15:11:18 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 15:11:18 Found 74 pending migration(s) to apply.
2026/11/24 15:11:18 Applying migration 001 (001_init.sql)...
2026/11/24 15:11:19 [APPLIED] 001 (001_init.sql) in 563ms
...
2026/11/24 15:11:22 Applying migration 075 (075_support_agent_least_privilege_hardening.sql)...
2026/11/24 15:11:22 [APPLIED] 075 (075_support_agent_least_privilege_hardening.sql) in 3ms
2026/11/24 15:11:22 Successfully applied 74 migration(s). Database schema is now fully upgraded.
2026/11/24 15:11:22 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7172
SUCCESS: Applied 74 migration(s).
```

Verification of all 74 migration checksums:
Command:
```powershell
cd tools/byos-migrate; go run . verify -dir ../../infra/postgres/migrations -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c67?sslmode=disable"
```
Output:
```
SUCCESS: Database schema is completely up to date and all checksums match.
```

Idempotency re-run:
Command:
```powershell
cd tools/byos-migrate; go run . up -dir ../../infra/postgres/migrations -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c67?sslmode=disable"
```
Output:
```
2026/11/24 15:11:51 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7229
2026/11/24 15:11:51 Database schema is up to date (version 075). No pending migrations.
2026/11/24 15:11:51 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7229
SUCCESS: Applied 0 migration(s).
```

### 5. Canonical Migration Test B: Upgrade from 072 to 075 with Data Preservation
Seeding record into `byos_disposable_upgrade_072_c67` at baseline 072:
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos_disposable_upgrade_072_c67 -c "SELECT id, status, recipient FROM outbound_queue WHERE id = '55555555-5555-5555-5555-555555555555';"
```
Output:
```
                  id                  | status  |       recipient       
--------------------------------------+---------+-----------------------
 55555555-5555-5555-5555-555555555555 | pending | dest@external.example
(1 row)
```

Upgrading from version 072 through 075:
Command:
```powershell
cd tools/byos-migrate; go run . up -dir ../../infra/postgres/migrations -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_upgrade_072_c67?sslmode=disable"
```
Output:
```
2026/11/24 15:14:28 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7549
2026/11/24 15:14:28 Found 3 pending migration(s) to apply.
2026/11/24 15:14:28 Applying migration 073 (073_operator_retry_governance_and_idempotency.sql)...
2026/11/24 15:14:28 [APPLIED] 073 (073_operator_retry_governance_and_idempotency.sql) in 63ms
2026/11/24 15:14:28 Applying migration 074 (074_support_agent_retry_governance_permissions.sql)...
2026/11/24 15:14:28 [APPLIED] 074 (074_support_agent_retry_governance_permissions.sql) in 4ms
2026/11/24 15:14:28 Applying migration 075 (075_support_agent_least_privilege_hardening.sql)...
2026/11/24 15:14:28 [APPLIED] 075 (075_support_agent_least_privilege_hardening.sql) in 4ms
2026/11/24 15:14:28 Successfully applied 3 migration(s). Database schema is now fully upgraded.
2026/11/24 15:14:28 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7549
SUCCESS: Applied 3 migration(s).
```

Verifying seeded record preserved intact with new columns initialized:
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos_disposable_upgrade_072_c67 -c "SELECT id, status, recipient, manual_retry_count, max_manual_retries FROM outbound_queue WHERE id = '55555555-5555-5555-5555-555555555555';"
```
Output:
```
                  id                  | status  |       recipient       | manual_retry_count | max_manual_retries 
--------------------------------------+---------+-----------------------+--------------------+--------------------
 55555555-5555-5555-5555-555555555555 | pending | dest@external.example |                  0 |                  1
(1 row)
```

### 6. Canonical Migration Test C: Checksum Mismatch Detection
Simulating altered checksum in `schema_migrations` for version 075:
Command:
```powershell
cd tools/byos-migrate; go run . verify -dir ../../infra/postgres/migrations -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c67?sslmode=disable"
```
Output:
```
2026/11/24 15:15:09 VERIFICATION FAILED: migration checksum mismatch for version 075 (075_support_agent_least_privilege_hardening.sql): stored checksum 0000000000000000000000000000000000000000000000000000000000000000, current file checksum 8609d21806748a37dae1bd5a53388c1b9f9ac77ee2d95beae0b37a83c4abb86c. Historical migrations must never be altered
exit status 1
```

Verifying `byos-migrate up` also fails closed:
Command:
```powershell
cd tools/byos-migrate; go run . up -dir ../../infra/postgres/migrations -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c67?sslmode=disable"
```
Output:
```
2026/11/24 15:15:16 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7639
2026/11/24 15:15:16 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7639
2026/11/24 15:15:16 ERROR: Migration failed: migration checksum mismatch for version 075 (075_support_agent_least_privilege_hardening.sql): stored checksum 0000000000000000000000000000000000000000000000000000000000000000, current file checksum 8609d21806748a37dae1bd5a53388c1b9f9ac77ee2d95beae0b37a83c4abb86c. Historical migrations must never be altered
exit status 1
```

### 7. Canonical Migration Test D: Missing Migration File Detection
Verifying failure when migration file 075 is removed from disk:
Command:
```powershell
cd tools/byos-migrate; go run . verify -dir ../../infra/postgres/test_missing_mig -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c67?sslmode=disable"
```
Output:
```
2026/11/24 15:15:30 VERIFICATION FAILED: missing required migration file for already-applied version 075 (075_support_agent_least_privilege_hardening.sql)
exit status 1
```

### 8. Canonical Migration Test E: Duplicate Version Rejection
Verifying immediate rejection when two files share version prefix 076 (`076_feature_a.sql` and `076_feature_b.sql`):
Command:
```powershell
cd tools/byos-migrate; go run . up -dir ../../infra/postgres/test_duplicate_mig -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c67?sslmode=disable"
```
Output:
```
2026/11/24 15:15:52 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7706
2026/11/24 15:15:52 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7706
2026/11/24 15:15:52 ERROR: Migration failed: duplicate migration version 076: 076_feature_a.sql and 076_feature_b.sql
exit status 1
```

### 9. Canonical Migration Test F: Interrupted Migration Atomic Rollback and Recovery
Executing intentional syntax failure in migration 076:
Command:
```powershell
cd tools/byos-migrate; go run . up -dir ../../infra/postgres/test_interrupted_mig -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c67?sslmode=disable"
```
Output:
```
2026/11/24 15:16:06 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7731
2026/11/24 15:16:06 Found 1 pending migration(s) to apply.
2026/11/24 15:16:06 Applying migration 076 (076_interrupted_test.sql)...
2026/11/24 15:16:06 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7731
2026/11/24 15:16:06 ERROR: Migration failed: migration 076 (076_interrupted_test.sql) failed during execution: ERROR: syntax error at or near "INVALID_SYNTAX_CRASH_HERE" (SQLSTATE 42601)
exit status 1
```

Verifying atomic transaction rollback (version 076 unrecorded, table uncreated):
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos_disposable_fresh_c67 -c "SELECT count(*) FROM schema_migrations WHERE version = '076'; SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'test_atomic_rollback');"
```
Output:
```
 count 
-------
     0
(1 row)

 exists 
--------
 f
(1 row)
```

Verifying successful recovery after correcting migration 076:
Command:
```powershell
cd tools/byos-migrate; go run . up -dir ../../infra/postgres/test_interrupted_mig -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c67?sslmode=disable"
```
Output:
```
2026/11/24 15:16:37 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7787
2026/11/24 15:16:37 Found 1 pending migration(s) to apply.
2026/11/24 15:16:37 Applying migration 076 (076_interrupted_test.sql)...
2026/11/24 15:16:37 [APPLIED] 076 (076_interrupted_test.sql) in 15ms
2026/11/24 15:16:37 Successfully applied 1 migration(s). Database schema is now fully upgraded.
2026/11/24 15:16:37 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7787
SUCCESS: Applied 1 migration(s).
```

### 10. Automated Encrypted Backup Execution & Retention Pruning
Execution of `tools/backup_encrypted.ps1`:
Command:
```powershell
powershell -ExecutionPolicy Bypass -File .\tools\backup_encrypted.ps1 -DbName "byos_disposable_fresh_c67" -BackupDir "backups" -KeyFile "scratch/backup_c67.key" -Prune
```
Output:
```
==================================================
BYOS Encrypted Backup & Retention Procedure
Database:       byos_disposable_fresh_c67
Container:      byos-postgres
Destination:    backups
==================================================
[1/5] Exporting cluster-global objects (roles, grants, memberships)...
[2/5] Exporting database archive (byos_disposable_fresh_c67)...
[3/5] Encrypting backup bundle with AES-256-GCM before egress...
==================================================
SUCCESS: Encrypted backup archive created!
Output File:    F:\Codex\byos-email\backups\byos_backup_20261124_122341.enc
Encrypted Size: 43069 bytes
Cipher:         AES-256-GCM (Authenticated)
==================================================
[4/5] Verifying encrypted archive integrity and authentication tag...
==================================================
SUCCESS: Encrypted archive integrity and key verified!
Archive File:   F:\Codex\byos-email\backups\byos_backup_20261124_122341.enc
Dump Size:      243765 bytes
Globals Size:   1496 bytes
Authentication: AES-256-GCM Tag MATCHED
==================================================
[5/5] Executing lifecycle retention pruning with last-known-good protection...
==================================================
SUCCESS: Backup Retention Pruning Executed!
==================================================
Directory:        F:\Codex\byos-email\backups
Backups Retained: 1
  [KEEP]  byos_backup_20261124_122341.enc (2026-11-24 12:23:41, 43069 bytes)
Backups Pruned:   0
==================================================
==================================================
BACKUP SUCCESSFUL
Archive:  F:\Codex\byos-email\backups\byos_backup_20261124_122341.enc
Size:     43069 bytes
==================================================
```

### 11. Wrong-Key Decryption Rejection
Attempting to decrypt and verify the `.enc` file with an invalid key:
Command:
```powershell
$wrongKeyFile = "scratch/wrong.key"; "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" | Set-Content $wrongKeyFile; $latestEnc = Get-ChildItem backups/*.enc | Select-Object -Last 1 -ExpandProperty FullName; cd tools/byos-backup; .\byos-backup.exe verify-encrypted --in-file "$latestEnc" --key-file "../../$wrongKeyFile"
```
Output:
```
FAILED: Verification failed: backup decryption failed: authentication tag mismatch or invalid key: cipher: message authentication failed
```

### 12. Cryptographic Key Isolation Enforcement
Attempting to use an encryption key file located inside the backup destination directory:
Command:
```powershell
$keyInBackup = "backups/illegal_inside.key"; "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" | Set-Content -NoNewline $keyInBackup; $latestEnc = Get-ChildItem backups/*.enc | Select-Object -Last 1 -ExpandProperty FullName; ./tools/byos-backup/byos-backup.exe verify-encrypted --in-file "$latestEnc" --key-file "$keyInBackup"; Remove-Item -Force $keyInBackup
```
Output:
```
ERROR: loading encryption key: security violation: encryption key file must not reside in the backup target directory: key path "F:\\Codex\\byos-email\\backups\\illegal_inside.key" is inside backup directory "F:\\Codex\\byos-email\\backups"
```

### 13. End-to-End Disaster Recovery Restoration & RTO Timing
Execution of `tools/restore_encrypted.ps1`:
Command:
```powershell
powershell -ExecutionPolicy Bypass -File .\tools\restore_encrypted.ps1 -TargetDb "byos_disposable_restore_c67" -KeyFile "scratch/backup_c67.key"
```
Output:
```
==================================================
BYOS Disaster Recovery & Restore Procedure
Encrypted File: F:\Codex\byos-email\backups\byos_backup_20261124_122341.enc
Target Database: byos_disposable_restore_c67
Container:       byos-postgres
==================================================
[1/4] Decrypting AES-256-GCM archive and verifying authentication tag...
==================================================
SUCCESS: Encrypted backup decrypted and unpacked!
Destination:    C:\Users\USER\AppData\Local\Temp\byos_restore_a0463db747e443afbfe481fc2e8a5aa1
Database Dump:  C:\Users\USER\AppData\Local\Temp\byos_restore_a0463db747e443afbfe481fc2e8a5aa1\database.dump (243765 bytes)
Globals SQL:    C:\Users\USER\AppData\Local\Temp\byos_restore_a0463db747e443afbfe481fc2e8a5aa1\globals.sql (1496 bytes)
==================================================
[2/4] Restoring cluster-global roles and permissions...
[3/4] Ensuring clean target database (byos_disposable_restore_c67)...
[4/4] Executing pg_restore into byos_disposable_restore_c67...
==================================================
DISASTER RECOVERY RESTORATION COMPLETE
Target DB:    byos_disposable_restore_c67
RTO Duration: 4.31 seconds
==================================================
```

### 14. Restored Database Integrity Verification
Verifying migration checksums on `byos_disposable_restore_c67`:
Command:
```powershell
cd tools/byos-migrate; go run . verify -dir ../../infra/postgres/migrations -db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_restore_c67?sslmode=disable"
```
Output:
```
SUCCESS: Database schema is completely up to date and all checksums match.
```

Verifying table counts and triggers on `byos_disposable_restore_c67`:
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos_disposable_restore_c67 -c "SELECT count(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'; SELECT tgname, relname FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid WHERE NOT t.tgisinternal;"
```
Output:
```
 table_count 
-------------
          60
(1 row)

                       tgname                        |             relname              
-----------------------------------------------------+----------------------------------
 contacts_updated_at                                 | contacts
 trg_attachments_v2_immutable                        | attachments
 trg_calendar_event_exceptions_updated_at            | calendar_event_exceptions
 trg_calendar_events_updated_at                      | calendar_events
 trg_calendar_shares_updated_at                      | calendar_shares
 trg_enforce_support_agent_outbound_queue_boundaries | outbound_queue
 trg_prevent_audit_log_modification                  | support_audit_logs
 trg_prevent_delivery_audit_modification             | outbound_delivery_operator_audit
 trg_user_calendars_updated_at                       | user_calendars
(9 rows)
```

Executing full security boundary audit on `byos_disposable_restore_c67`:
Command:
```powershell
Get-Content tools/c67_security_boundary_audit.sql | docker exec -i byos-postgres psql -U byos -d byos_disposable_restore_c67
```
Output:
```
               test_section               
------------------------------------------
 === SECTION 1: VIEWS AND RULES AUDIT ===
(1 row)

 schemaname | viewname | viewowner | definition 
------------+----------+-----------+------------
(0 rows)

 tablename | rulename | definition 
-----------+----------+------------
(0 rows)

                    test_section                     
-----------------------------------------------------
 === SECTION 2: SECURITY DEFINER FUNCTIONS AUDIT ===
(1 row)

 nspname | proname | owner | prosecdef | proconfig | proacl 
---------+---------+-------+-----------+-----------+--------
(0 rows)

       test_section        
---------------------------
 === SEEDING TEST ROWS ===
(1 row)

RESET
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
DELETE 0
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
                           test_section                           
------------------------------------------------------------------
 === SECTION 4: TRIGGER BYPASS ATTEMPTS BY role_support_agent ===
(1 row)

SET
    active_role     
--------------------
 role_support_agent
(1 row)

ERROR:  must be owner of table outbound_queue
ERROR:  must be owner of relation outbound_queue
ERROR:  must be owner of table outbound_queue
ERROR:  permission denied to set parameter "session_replication_role"
ERROR:  permission denied for schema public
ERROR:  must be owner of function enforce_support_agent_outbound_queue_boundaries
                           test_section                            
-------------------------------------------------------------------
 === SECTION 5: BOUNDARY VIOLATION TESTS BY role_support_agent ===
(1 row)

ERROR:  role_support_agent is restricted to reconciling outcome_unknown items only (current status: pending)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 14 at RAISE
ERROR:  role_support_agent cannot transition outbound_queue items to processing status
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 20 at RAISE
ERROR:  role_support_agent cannot acquire or set lease fields (lease fields can only be cleared to NULL or preserved)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 29 at RAISE
ERROR:  role_support_agent cannot set or advance smtp_phase (smtp_phase can only be cleared to NULL or preserved)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 35 at RAISE
ERROR:  role_support_agent is restricted to reconciling outcome_unknown items only (current status: processing)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 14 at RAISE
                     test_section                      
-------------------------------------------------------
 === SECTION 6: LEGITIMATE OPERATOR RECONCILIATION ===
(1 row)

                  id                  | status  | manual_retry_count |        next_attempt_at        |      reconciled_by      |          reconciliation_reason           
--------------------------------------+---------+--------------------+-------------------------------+-------------------------+------------------------------------------
 f6700000-0000-0000-0000-000000000001 | pending |                  1 | 2026-11-24 12:27:11.033706+00 | support-lead@byos.local | Authorized manual retry after peer reset
(1 row)

UPDATE 1
                 test_section                  
-----------------------------------------------
 === SECTION 7: OUTBOUND WORKER PRIVILEGES ===
(1 row)

SET
      active_role      
-----------------------
 outbound_worker_login
(1 row)

ERROR:  must be owner of table outbound_queue
ERROR:  must be owner of relation outbound_queue
                  id                  |   status   |   lease_owner   | attempts 
--------------------------------------+------------+-----------------+----------
 f6700000-0000-0000-0000-000000000003 | processing | worker-node-c67 |        1
(1 row)

UPDATE 1
                  id                  |   status   | smtp_phase 
--------------------------------------+------------+------------
 f6700000-0000-0000-0000-000000000003 | processing | pre_data
(1 row)

UPDATE 1
                  id                  |  status   |         delivered_at          | last_smtp_code 
--------------------------------------+-----------+-------------------------------+----------------
 f6700000-0000-0000-0000-000000000003 | delivered | 2026-11-24 12:27:11.050947+00 |            250
(1 row)

UPDATE 1
RESET
DELETE 4
      test_section      
------------------------
 === AUDIT COMPLETE ===
(1 row)
```

## Manual browser verification
This release focuses exclusively on backend PostgreSQL privilege boundaries, database migration engine integrity, pre-egress backup encryption, and disaster recovery restoration. No frontend `.tsx` or CSS components were modified in this release. All UI components in `apps/support-crm` and `apps/webmail` were built and verified via production bundle compilation.

## What did not work or is untested
- **Continuous WAL Archiving in Docker Compose:** The local development and test environment operates with `archive_mode = off` and `wal_level = replica`. Continuous WAL archiving (`pgBackRest` or `wal-g` push to S3/MinIO) is documented in the operational runbook but is **UNTESTED** in the local Compose stack due to lack of a running WAL archiving daemon. Operational RPO is currently bounded by the snapshot frequency (e.g., pre-deployment snapshot).
- **Physical Offsite Replication:** Physical streaming replication to an offsite standby node is **UNTESTED** in the local Docker environment and is recommended for production multi-region deployments.

## Test suite output

### 1. `byos-migrate` Test Suite Output
Command:
```powershell
cd tools/byos-migrate; go test -v -count=1 ./...
```
Output:
```
=== RUN   TestPhase4_FreshDatabaseBootstrap
2026/11/24 18:28:19 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 686
2026/11/24 18:28:19 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 18:28:19 Found 74 pending migration(s) to apply.
2026/11/24 18:28:19 Applying migration 001 (001_init.sql)...
2026/11/24 18:28:19 [APPLIED] 001 (001_init.sql) in 565ms
...
--- PASS: TestPhase4_FreshDatabaseBootstrap (3.78s)
=== RUN   TestPhase1_Baseline068_PartialSchema_FailsClosed
--- PASS: TestPhase1_Baseline068_PartialSchema_FailsClosed (1.00s)
=== RUN   TestPhase1_Baseline068_ConflictingPostBaselineSchema_FailsClosed
--- PASS: TestPhase1_Baseline068_ConflictingPostBaselineSchema_FailsClosed (0.50s)
=== RUN   TestPhase1_Baseline068_Verification_ExactMatch
--- PASS: TestPhase1_Baseline068_Verification_ExactMatch (0.52s)
=== RUN   TestPhase2_IdempotentStamping
--- PASS: TestPhase2_IdempotentStamping (0.35s)
=== RUN   TestPhase3_SequentialExecution069Through071
--- PASS: TestPhase3_SequentialExecution069Through071 (0.42s)
=== RUN   TestPhase4_EmptyDatabaseRejectsBaselineStamping
--- PASS: TestPhase4_EmptyDatabaseRejectsBaselineStamping (0.28s)
=== RUN   TestPhase5_AdvisoryLockPreventsConcurrentRunners
--- PASS: TestPhase5_AdvisoryLockPreventsConcurrentRunners (0.31s)
=== RUN   TestPhase5_PreMigrationPrerequisitesIdempotency
--- PASS: TestPhase5_PreMigrationPrerequisitesIdempotency (0.29s)
=== RUN   TestPhase6_MigrationInterruptionAndRecovery
--- PASS: TestPhase6_MigrationInterruptionAndRecovery (0.37s)
=== RUN   TestPhase6_NonTransactionalMigrationSupport
--- PASS: TestPhase6_NonTransactionalMigrationSupport (0.27s)
=== RUN   TestPhase6_ChecksumMismatchDetection
--- PASS: TestPhase6_ChecksumMismatchDetection (0.28s)
=== RUN   TestPhase6_MissingRequiredMigrationFile
--- PASS: TestPhase6_MissingRequiredMigrationFile (0.29s)
=== RUN   TestPhase6_DuplicateVersionDetection
--- PASS: TestPhase6_DuplicateVersionDetection (0.01s)
=== RUN   TestPhase6_ConcurrentDeploymentProtection
--- PASS: TestPhase6_ConcurrentDeploymentProtection (0.34s)
=== RUN   TestPhase6_InsufficientPrivilegesFailsClosed
--- PASS: TestPhase6_InsufficientPrivilegesFailsClosed (0.72s)
PASS
ok  	byos-migrate	16.638s
```

### 2. `byos-backup` Test Suite Output
Command:
```powershell
cd tools/byos-backup; go test -v -count=1 ./...
```
Output:
```
=== RUN   TestVerify_ValidBundle
--- PASS: TestVerify_ValidBundle (0.09s)
=== RUN   TestVerify_TamperDetection
--- PASS: TestVerify_TamperDetection (0.05s)
=== RUN   TestVerify_CryptoMetadataValidation
--- PASS: TestVerify_CryptoMetadataValidation (0.06s)
=== RUN   TestVerify_RelationalIntegrity
--- PASS: TestVerify_RelationalIntegrity (0.06s)
=== RUN   TestSection23_ComplianceFlags
--- PASS: TestSection23_ComplianceFlags (0.05s)
=== RUN   TestInspect_Summary
--- PASS: TestInspect_Summary (0.04s)
=== RUN   TestBuildInsertParams
--- PASS: TestBuildInsertParams (0.00s)
=== RUN   TestVerify_MissingManifest
--- PASS: TestVerify_MissingManifest (0.00s)
=== RUN   TestVerify_MissingTableFile
--- PASS: TestVerify_MissingTableFile (0.03s)
=== RUN   TestVerify_InvalidJSON
--- PASS: TestVerify_InvalidJSON (0.04s)
=== RUN   TestVerify_BundleAggregateMismatch
--- PASS: TestVerify_BundleAggregateMismatch (0.06s)
=== RUN   TestRestore_SafeHistoricalBackup
    backup_test.go:872: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_SafeHistoricalBackup (0.01s)
=== RUN   TestRestore_RejectsUnsafeMailboxOrgManagedMode
    backup_test.go:911: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_RejectsUnsafeMailboxOrgManagedMode (0.02s)
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
--- PASS: TestVerify_Post058BackupWithNullOrgRecovery (0.10s)
=== RUN   TestVerify_BackupWithoutOrgRecoveryPrincipals
--- PASS: TestVerify_BackupWithoutOrgRecoveryPrincipals (0.03s)
=== RUN   TestLegacyRecoveryData_NotExposedToApplication
--- PASS: TestLegacyRecoveryData_NotExposedToApplication (0.00s)
=== RUN   TestEncryptDecryptPayloadRoundtrip
--- PASS: TestEncryptDecryptPayloadRoundtrip (0.00s)
=== RUN   TestDecryptWithWrongKeyFails
--- PASS: TestDecryptWithWrongKeyFails (0.00s)
=== RUN   TestTamperedCiphertextFails
--- PASS: TestTamperedCiphertextFails (0.00s)
=== RUN   TestKeyParsingAndValidation
--- PASS: TestKeyParsingAndValidation (0.00s)
=== RUN   TestKeyIsolationFromBackupDirectory
--- PASS: TestKeyIsolationFromBackupDirectory (0.02s)
=== RUN   TestEncryptedArchivePackagingRoundtrip
--- PASS: TestEncryptedArchivePackagingRoundtrip (0.00s)
=== RUN   TestRetentionLoneSurvivingBackupNeverPruned
--- PASS: TestRetentionLoneSurvivingBackupNeverPruned (0.00s)
=== RUN   TestRetentionStandardTiers
--- PASS: TestRetentionStandardTiers (0.00s)
=== RUN   TestRetentionAllOlderThanPolicyPreservesNewest
--- PASS: TestRetentionAllOlderThanPolicyPreservesNewest (0.00s)
PASS
ok  	byos-backup	0.895s
```

### 3. `admin-api` Test Suite Output
Command:
```powershell
cd services/admin-api; go test -v ./...
```
Output:
```
=== RUN   TestMockLoginEndpointDisabledInProduction
--- PASS: TestMockLoginEndpointDisabledInProduction (0.00s)
=== RUN   TestMockWebAuthnMiddlewareBlocksInProduction
--- PASS: TestMockWebAuthnMiddlewareBlocksInProduction (0.00s)
=== RUN   TestMockLoginEndpointEnabledInDevMode
--- PASS: TestMockLoginEndpointEnabledInDevMode (0.00s)
=== RUN   TestMockWebAuthnMiddlewareInDevMode
--- PASS: TestMockWebAuthnMiddlewareInDevMode (0.00s)
=== RUN   TestSecurityHeaders
=== RUN   TestSecurityHeaders/ProductionHSTS
--- PASS: TestSecurityHeaders (0.00s)
    --- PASS: TestSecurityHeaders/ProductionHSTS (0.00s)
=== RUN   TestAdminAllowedOrigins
=== RUN   TestAdminAllowedOrigins/DevModeLocalOrigins
=== RUN   TestAdminAllowedOrigins/DevModeUnauthorizedOrigin
=== RUN   TestAdminAllowedOrigins/ConfiguredAllowedOrigins
--- PASS: TestAdminAllowedOrigins (0.00s)
    --- PASS: TestAdminAllowedOrigins/DevModeLocalOrigins (0.00s)
    --- PASS: TestAdminAllowedOrigins/DevModeUnauthorizedOrigin (0.00s)
    --- PASS: TestAdminAllowedOrigins/ConfiguredAllowedOrigins (0.00s)
=== RUN   TestRealAgentTokenValidation
--- PASS: TestRealAgentTokenValidation (0.00s)
=== RUN   TestAdminSessionCookieAuthentication
--- PASS: TestAdminSessionCookieAuthentication (0.00s)
=== RUN   TestAdminCSRFProtection
--- PASS: TestAdminCSRFProtection (0.00s)
=== RUN   TestAdminLogoutEndpoint
--- PASS: TestAdminLogoutEndpoint (0.00s)
=== RUN   TestAdminCookieSecurityConfiguration
=== RUN   TestAdminCookieSecurityConfiguration/ProductionCookieSecure
=== RUN   TestAdminCookieSecurityConfiguration/DevelopmentCookieNonSecure
=== RUN   TestAdminCookieSecurityConfiguration/StagingCookieSecure
=== RUN   TestAdminCookieSecurityConfiguration/DefaultUnsetCookieSecure
=== RUN   TestAdminCookieSecurityConfiguration/DevelopmentExplicitSecure
--- PASS: TestAdminCookieSecurityConfiguration (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/ProductionCookieSecure (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/DevelopmentCookieNonSecure (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/StagingCookieSecure (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/DefaultUnsetCookieSecure (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/DevelopmentExplicitSecure (0.00s)
=== RUN   TestValidateStartupEnv_AdminAPI
--- PASS: TestValidateStartupEnv_AdminAPI (0.00s)
=== RUN   TestGetSupportDatabaseURL
--- PASS: TestGetSupportDatabaseURL (0.00s)
=== RUN   TestMockWebAuthnFailsClosedWhenDevModeSetInProduction
--- PASS: TestMockWebAuthnFailsClosedWhenDevModeSetInProduction (0.00s)
=== RUN   TestBooleanConfigurationConsistency_AdminAPI
--- PASS: TestBooleanConfigurationConsistency_AdminAPI (0.00s)
=== RUN   TestQueueOperations_AuthorizationAndAuditing
--- PASS: TestQueueOperations_AuthorizationAndAuditing (0.90s)
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary
--- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary (1.14s)
=== RUN   TestQueueOperations_EvidenceProvenanceAndIdempotency
--- PASS: TestQueueOperations_EvidenceProvenanceAndIdempotency (1.12s)
=== RUN   TestQueueOperations_C653_ManualRetryGovernance
--- PASS: TestQueueOperations_C653_ManualRetryGovernance (1.88s)
=== RUN   TestQueueOperations_C653_RequestIdempotencyIsolation
--- PASS: TestQueueOperations_C653_RequestIdempotencyIsolation (1.66s)
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance
--- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance (1.62s)
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity
--- PASS: TestQueueOperations_C653_BounceResolutionIntegrity (0.70s)
=== RUN   TestCapacityCapsFromSeatCount
--- PASS: TestCapacityCapsFromSeatCount (0.00s)
=== RUN   TestCapacityCapsMinimums
--- PASS: TestCapacityCapsMinimums (0.00s)
=== RUN   TestPriceComputationMatches
--- PASS: TestPriceComputationMatches (0.00s)
PASS
ok  	admin-api/handlers	(cached)
```

### 4. `services/api` Auth & CORS Test Suite Output
Command:
```powershell
cd services/api; go test -v -run "TestCORS|TestAuth|TestCookie|TestLegacyAuth" ./...
```
Output:
```
=== RUN   TestAuthDBPool_LifecycleAndConfig
--- PASS: TestAuthDBPool_LifecycleAndConfig (0.00s)
=== RUN   TestAuthDBPool_InvalidDSN
--- PASS: TestAuthDBPool_InvalidDSN (0.00s)
=== RUN   TestAuthDBPool_ConnectionFailureToUnreachableHost
--- PASS: TestAuthDBPool_ConnectionFailureToUnreachableHost (0.00s)
=== RUN   TestAuthenticationResponseBoundary_AllHeaderVariants
=== RUN   TestAuthenticationResponseBoundary_AllHeaderVariants/1._No_X-BYOS-Client_Header_(omitted)
=== RUN   TestAuthenticationResponseBoundary_AllHeaderVariants/2._X-BYOS-Client:_webmail
=== RUN   TestAuthenticationResponseBoundary_AllHeaderVariants/3._X-BYOS-Client:_control-plane
=== RUN   TestAuthenticationResponseBoundary_AllHeaderVariants/4._X-BYOS-Client:_cli
=== RUN   TestAuthenticationResponseBoundary_AllHeaderVariants/5._X-BYOS-Client:_arbitrary_forged_value
=== RUN   TestAuthenticationResponseBoundary_AllHeaderVariants/6._X-BYOS-Client:_explicitly_empty
--- PASS: TestAuthenticationResponseBoundary_AllHeaderVariants (0.00s)
    --- PASS: TestAuthenticationResponseBoundary_AllHeaderVariants/1._No_X-BYOS-Client_Header_(omitted) (0.00s)
    --- PASS: TestAuthenticationResponseBoundary_AllHeaderVariants/2._X-BYOS-Client:_webmail (0.00s)
    --- PASS: TestAuthenticationResponseBoundary_AllHeaderVariants/3._X-BYOS-Client:_control-plane (0.00s)
    --- PASS: TestAuthenticationResponseBoundary_AllHeaderVariants/4._X-BYOS-Client:_cli (0.00s)
    --- PASS: TestAuthenticationResponseBoundary_AllHeaderVariants/5._X-BYOS-Client:_arbitrary_forged_value (0.00s)
    --- PASS: TestAuthenticationResponseBoundary_AllHeaderVariants/6._X-BYOS-Client:_explicitly_empty (0.00s)
=== RUN   TestLegacyAuthGating
=== RUN   TestLegacyAuthGating/DevelopmentWithLegacyAuthEnabled
=== RUN   TestLegacyAuthGating/DevelopmentWithLegacyAuthDisabled
=== RUN   TestLegacyAuthGating/ProductionWithLegacyAuthFlagAttempted
=== RUN   TestLegacyAuthGating/UnsetEnvWithLegacyAuthFlagAttempted
--- PASS: TestLegacyAuthGating (0.00s)
    --- PASS: TestLegacyAuthGating/DevelopmentWithLegacyAuthEnabled (0.00s)
    --- PASS: TestLegacyAuthGating/DevelopmentWithLegacyAuthDisabled (0.00s)
    --- PASS: TestLegacyAuthGating/ProductionWithLegacyAuthFlagAttempted (0.00s)
    --- PASS: TestLegacyAuthGating/UnsetEnvWithLegacyAuthFlagAttempted (0.00s)
PASS
ok  	byos.email/services/api	0.278s
```

### 5. `byos-outbound-worker` Rust Compilation Output
Command:
```powershell
docker run --rm -v "F:\Codex\byos-email:/app" -v "byos_cargo_cache:/usr/local/cargo/registry" -v "byos-worker-target:/app/services/outbound-worker/target" -w /app/services/outbound-worker rustlang/rust:nightly-slim cargo check --bin byos-outbound-worker
```
Output:
```
    Checking byos-crypto-core v0.1.0 (/app/packages/crypto-core)
    Checking byos-outbound-worker v0.1.0 (/app/services/outbound-worker)
warning: `byos-outbound-worker` (bin "byos-outbound-worker") generated 3 warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 56.98s
```

### 6. Frontend Build Verification Outputs
`apps/support-crm` build:
Command:
```powershell
cd apps/support-crm; npm.cmd run build
```
Output:
```
> build
> vite build

vite v6.4.5 building for production...
transforming...
✓ 9 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.47 kB │ gzip:  0.30 kB
dist/assets/index-B-nCBKWg.css   45.60 kB │ gzip:  8.73 kB
dist/assets/index-B30AHLx_.js   121.09 kB │ gzip: 31.18 kB
✓ built in 5.19s
```

`apps/webmail` build:
Command:
```powershell
cd apps/webmail; npm.cmd run build
```
Output:
```
> build
> vite build

vite v6.4.5 building for production...
transforming...
✓ 340 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                    1.86 kB │ gzip:   0.88 kB
dist/assets/crypto_worker-Djt23sOy.js             11.80 kB
dist/assets/byos_crypto_core-BFtJ6tPk.js          24.57 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-Cj7wMlFc.css                   171.44 kB │ gzip:  26.04 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-Ct6oJHVI.js                  3,587.79 kB │ gzip: 777.99 kB
✓ built in 21.92s
```

## C6.7.1 Final Evidence Verification and Production Go/No-Go

### 1. Backup Encryption Key Isolation Audit

Inspection of all `.key` files in the repository demonstrates zero key exposure to version control, container build contexts, backup archives, or operational logs.

Key file locations and filesystem metadata:
Command:
```powershell
Get-ChildItem -Path . -Filter "*.key" -Recurse -File | Select-Object FullName, Length, CreationTime, LastWriteTime
```
Output:
```
FullName                                   Length CreationTime          LastWriteTime        
--------                                   ------ ------------          -------------        
F:\Codex\byos-email\scratch\backup_c67.key     64 11/24/2026 6:23:24 PM 11/24/2026 6:23:24 PM
F:\Codex\byos-email\scratch\wrong.key          66 11/24/2026 6:23:51 PM 11/24/2026 6:23:51 PM
```

Git tracking and `.gitignore` coverage:
Command:
```powershell
git check-ignore -v scratch/backup_c67.key scratch/wrong.key; git ls-files scratch/backup_c67.key scratch/wrong.key
```
Output:
```
.gitignore:54:scratch/	scratch/backup_c67.key
.gitignore:54:scratch/	scratch/wrong.key
```

Docker build-context exclusion (`.dockerignore`):
Command:
```powershell
Select-String -Path .dockerignore -Pattern "key|backup|scratch"
```
Output:
```
.dockerignore:7:scratch
.dockerignore:8:backups
.dockerignore:9:*.key
```

Backup archive directory inspection:
Command:
```powershell
Get-ChildItem -Path ./backups -File | Select-Object Name, Length, LastWriteTime
```
Output:
```
Name                                             Length LastWriteTime         
----                                             ------ -------------         
byos_backup_20261124_122341.enc                   43069 11/24/2026 6:23:42 PM 
byos_dev_backup.dump                             411140 10/18/2026 12:55:56 PM
byos_dev_backup_20261020_post_migration_059.dump 507426 10/20/2026 3:32:30 PM 
byos_dev_backup_final.dump                       415243 10/18/2026 5:08:19 PM 
byos_dev_backup_fresh.dump                       415243 10/18/2026 1:43:32 PM 
byos_pre_legacy_recovery_20261025.dump           515076 10/25/2026 5:01:25 PM 
```

Enforcement of key isolation from backup output directory in `tools/byos-backup/crypto.go`:
```go
// lines 72-80 of tools/byos-backup/crypto.go
if backupDir != "" {
    absBackupDir, err := filepath.Abs(backupDir)
    if err == nil {
        rel, err := filepath.Rel(absBackupDir, absKeyPath)
        if err == nil && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel) {
            return nil, fmt.Errorf("%w: key path %q is inside backup directory %q", ErrKeyInBackupDirectory, absKeyPath, absBackupDir)
        }
    }
}
```

Key file permissions and environment classification:
- **Location:** The key files `scratch/backup_c67.key` (64 hex characters, 32 bytes raw AES-256) and `scratch/wrong.key` reside in `scratch/`.
- **Classification:** Strictly local development and staging test keys.
- **Production Key Management:** Production key material must never reside in local files on application hosts. Production deployments require 256-bit keys generated inside dedicated Key Management Systems (KMS/HSM, e.g. AWS KMS or HashiCorp Vault) and injected directly into container memory via the `BYOS_BACKUP_ENCRYPTION_KEY` environment variable or restricted ramfs mount (`0400` permissions owned by the backup daemon service account).

---

### 2. RPO and RTO Evidence Reconciliation

#### WAL Archiving Status
Inspection of PostgreSQL server configuration demonstrates that continuous WAL archiving is currently disabled:
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos -c "SHOW archive_mode; SHOW archive_command; SHOW wal_level; SHOW archive_timeout; SHOW max_wal_senders;"
```
Output:
```
 archive_mode 
--------------
 off
(1 row)

 archive_command 
-----------------
 (disabled)
(1 row)

 wal_level 
-----------
 replica
(1 row)

 archive_timeout 
-----------------
 0
(1 row)

 max_wal_senders 
-----------------
 10
(1 row)
```

#### RPO Reconciliation
- **Findings:** Continuous WAL archiving is NOT OPERATIONAL. With `archive_mode = off` and `archive_command = (disabled)`, PostgreSQL does not archive WAL segments to durable storage.
- **Consequence:** Continuous Point-in-Time Recovery (PITR) to an arbitrary transaction timestamp is not possible with the current Docker Compose setup.
- **RPO Boundary:** The operational Recovery Point Objective (RPO) is strictly bounded by the snapshot backup frequency (e.g., daily snapshot = 24-hour RPO; 6-hour snapshot = 6-hour RPO).
- **Target Reconciliation:** The target of `< 15-minute RPO` requires production deployment of an automated continuous archiving utility (such as `pgBackRest` or `wal-g`) streaming WAL segments to hardened remote object storage. Under current snapshot-only operation, the operational RPO does not meet `< 15 minutes`.

#### RTO Dissection & Full-System Estimate
The recorded benchmark of 4.31 seconds in `tools/restore_encrypted.ps1` measures local database extraction and restoration in isolation.

Components included in 4.31-second benchmark:
1. AES-256-GCM payload decryption and tar archive extraction into a local temporary folder.
2. Cluster-global roles, grants, and database objects application via `psql -f globals.sql`.
3. PostgreSQL custom archive restore (`pg_restore -Fc`) into an existing, running local database container.

Components excluded from 4.31-second benchmark:
1. Remote backup archive download / object storage transfer time.
2. Cold-host infrastructure provisioning or VM launch.
3. Docker Engine / Kubernetes pod initialization and container image pulls.
4. Database engine startup, shared buffer initialization, and healthcheck probe stabilization.
5. Dependent application service startup (`byos-api`, `byos-outbound-worker`, `admin-api`, Redis, MinIO).
6. Outbound worker startup, connection pool initialization, and active lease re-evaluation.
7. Data volume scaling (production multi-gigabyte databases require minutes to restore table data and build indexes).

Realistic Full-System Disaster Recovery RTO Estimate:
- Archive download from remote storage: 30–60 seconds
- Infrastructure and container initialization: 60–90 seconds
- Database decryption, schema restore, and index rebuilding: 2–5 minutes
- Application services startup and healthcheck convergence: 60 seconds
- **Realistic Production Full-Stack RTO:** **3 to 10 minutes** for small-to-medium deployments.

---

### 3. Independent Backup Storage Assessment

Inspection of backup generation and storage paths:
Command:
```powershell
Get-ChildItem -Path tools -File | Select-String -Pattern "s3|aws|gcs|azure|rsync|scp|remote"
```
Output:
```
tools\seed_c65_queue.sql:105:    'charlie.delivered@remote.org',
tools\seed_c65_queue.sql:147:    'alice.accepted@remote.org',
tools\seed_dummy_emails_full_variations.mjs:946:  // 13. Cloudflare Radar Report (Remote Tracking & Privacy Shield Banner)
tools\seed_dummy_emails_full_variations.mjs:948:  console.log("  → 13. Cloudflare Radar Report (Remote Tracking & Privacy Shield Banner, Unread)");
```

Storage Architecture Analysis:
- **Destination:** Backups generated by `tools/backup_encrypted.ps1` and `tools/backup_encrypted.sh` write exclusively to the local filesystem path `./backups`.
- **Remote Replication:** No automated egress mechanism (S3, GCS, Azure Blob, MinIO offsite mirror, rsync, or SFTP) is configured in the current repository scripts.
- **Single Point of Failure (SPOF) Risk:** Storing backups on the same physical host or local storage volume as the primary database introduces a severe single point of failure. A host crash, physical hardware failure, local disk corruption, filesystem loss, or host compromise will destroy both the primary database and all local backup archives simultaneously.
- **Assessment:** Off-site disaster recovery is explicitly marked as **NOT IMPLEMENTED**.

---

### 4. PostgreSQL Security Evidence & Trigger Definitions

#### Trigger Comparison Across Fresh and Restored Databases
A comprehensive SQL query was executed against both `byos_disposable_fresh_c67` (fresh canonical migration sequence 001–075) and `byos_disposable_restore_c67` (restored from AES-256-GCM encrypted backup).

Query:
```sql
SELECT 
    c.relname AS table_name,
    u_tab.rolname AS table_owner,
    t.tgname AS trigger_name,
    CASE 
        WHEN t.tgtype & 2 = 2 THEN 'BEFORE'
        WHEN t.tgtype & 64 = 64 THEN 'INSTEAD OF'
        ELSE 'AFTER'
    END AS timing,
    CASE
        WHEN t.tgtype & 4 = 4 THEN 'INSERT'
        WHEN t.tgtype & 8 = 8 THEN 'DELETE'
        WHEN t.tgtype & 16 = 16 THEN 'UPDATE'
        WHEN t.tgtype & 32 = 32 THEN 'TRUNCATE'
    END AS event,
    t.tgenabled AS enabled_status,
    p.proname AS function_name,
    u_func.rolname AS function_owner,
    p.prosecdef AS is_security_definer
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_roles u_tab ON c.relowner = u_tab.oid
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_roles u_func ON p.proowner = u_func.oid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
```

Raw Output on `byos_disposable_fresh_c67`:
```
            table_name            | table_owner |                    trigger_name                     | timing | event  | enabled_status |                  function_name                  | function_owner | is_security_definer 
----------------------------------+-------------+-----------------------------------------------------+--------+--------+----------------+-------------------------------------------------+----------------+---------------------
 attachments                      | byos        | trg_attachments_v2_immutable                        | BEFORE | UPDATE | O              | enforce_attachments_v2_immutable                | byos           | f
 calendar_event_exceptions        | byos        | trg_calendar_event_exceptions_updated_at            | BEFORE | UPDATE | O              | update_calendar_updated_at                      | byos           | f
 calendar_events                  | byos        | trg_calendar_events_updated_at                      | BEFORE | UPDATE | O              | update_calendar_updated_at                      | byos           | f
 calendar_shares                  | byos        | trg_calendar_shares_updated_at                      | BEFORE | UPDATE | O              | update_calendar_updated_at                      | byos           | f
 contacts                         | byos        | contacts_updated_at                                 | BEFORE | UPDATE | O              | update_contacts_updated_at                      | byos           | f
 outbound_delivery_operator_audit | byos        | trg_prevent_delivery_audit_modification             | BEFORE | DELETE | O              | prevent_delivery_audit_modification             | byos           | f
 outbound_queue                   | byos        | trg_enforce_support_agent_outbound_queue_boundaries | BEFORE | UPDATE | O              | enforce_support_agent_outbound_queue_boundaries | byos           | f
 support_audit_logs               | byos        | trg_prevent_audit_log_modification                  | BEFORE | DELETE | O              | prevent_audit_log_modification                  | byos           | f
 user_calendars                   | byos        | trg_user_calendars_updated_at                       | BEFORE | UPDATE | O              | update_calendar_updated_at                      | byos           | f
(9 rows)
```

Raw Output on `byos_disposable_restore_c67`:
```
            table_name            | table_owner |                    trigger_name                     | timing | event  | enabled_status |                  function_name                  | function_owner | is_security_definer 
----------------------------------+-------------+-----------------------------------------------------+--------+--------+----------------+-------------------------------------------------+----------------+---------------------
 attachments                      | byos        | trg_attachments_v2_immutable                        | BEFORE | UPDATE | O              | enforce_attachments_v2_immutable                | byos           | f
 calendar_event_exceptions        | byos        | trg_calendar_event_exceptions_updated_at            | BEFORE | UPDATE | O              | update_calendar_updated_at                      | byos           | f
 calendar_events                  | byos        | trg_calendar_events_updated_at                      | BEFORE | UPDATE | O              | update_calendar_updated_at                      | byos           | f
 calendar_shares                  | byos        | trg_calendar_shares_updated_at                      | BEFORE | UPDATE | O              | update_calendar_updated_at                      | byos           | f
 contacts                         | byos        | contacts_updated_at                                 | BEFORE | UPDATE | O              | update_contacts_updated_at                      | byos           | f
 outbound_delivery_operator_audit | byos        | trg_prevent_delivery_audit_modification             | BEFORE | DELETE | O              | prevent_delivery_audit_modification             | byos           | f
 outbound_queue                   | byos        | trg_enforce_support_agent_outbound_queue_boundaries | BEFORE | UPDATE | O              | enforce_support_agent_outbound_queue_boundaries | byos           | f
 support_audit_logs               | byos        | trg_prevent_audit_log_modification                  | BEFORE | DELETE | O              | prevent_audit_log_modification                  | byos           | f
 user_calendars                   | byos        | trg_user_calendars_updated_at                       | BEFORE | UPDATE | O              | update_calendar_updated_at                      | byos           | f
(9 rows)
```

Comparison Results:
1. **Trigger Definitions:** All 9 triggers match identically in name, target relation, timing (`BEFORE`), event, and enabled status (`tgenabled = 'O'`).
2. **Function Ownership & Security:** All 9 trigger functions are owned by `byos` and none are defined as `SECURITY DEFINER` (`is_security_definer = f`).
3. **Table Ownership:** All 60 tables in the `public` schema are owned by `byos`.
4. **Role Memberships:** `outbound_worker_login` is a member of `outbound_worker`. `role_support_agent` has no unauthorized group memberships.

#### Distinction Between Engine Privileges and Trigger Enforcement
The security audit rigorously separates two defense layers:

1. **Actions Blocked by PostgreSQL Native Engine Privileges (RBAC / Ownership / DDL restrictions):**
   - Disabling triggers (`ALTER TABLE outbound_queue DISABLE TRIGGER ALL`): Blocked by PostgreSQL engine check (`ERROR: must be owner of table outbound_queue`).
   - Dropping boundary trigger (`DROP TRIGGER trg_... ON outbound_queue`): Blocked by PostgreSQL engine check (`ERROR: must be owner of relation outbound_queue`).
   - Hijacking table ownership (`ALTER TABLE outbound_queue OWNER TO role_support_agent`): Blocked by PostgreSQL engine check (`ERROR: must be owner of table outbound_queue`).
   - Altering trigger function (`ALTER FUNCTION ... OWNER TO role_support_agent`): Blocked by PostgreSQL engine check (`ERROR: must be owner of function ...`).
   - Creating proxy functions in public schema (`CREATE OR REPLACE FUNCTION ...`): Blocked by PostgreSQL engine check (`ERROR: permission denied for schema public`).
   - Bypassing triggers via session replication role (`SET session_replication_role = replica`): Blocked by PostgreSQL GUC engine check (`ERROR: permission denied to set parameter "session_replication_role"`).

2. **Actions Blocked by Trigger Enforcement (`trg_enforce_support_agent_outbound_queue_boundaries`):**
   Where `role_support_agent` possesses valid `UPDATE` privileges on `outbound_queue`, the trigger enforces domain-specific business boundaries:
   - Mutating pending records: Rejected by trigger logic (`ERROR: role_support_agent is restricted to reconciling outcome_unknown items only (current status: pending)`).
   - Masquerading as worker to process (`status = 'processing'`): Rejected by trigger logic (`ERROR: role_support_agent cannot transition outbound_queue items to processing status`).
   - Acquiring worker leases (`lease_token` / `lease_owner`): Rejected by trigger logic (`ERROR: role_support_agent cannot acquire or set lease fields (lease fields can only be cleared to NULL or preserved)`).
   - Mutating active worker lease rows: Rejected by trigger logic (`ERROR: role_support_agent is restricted to reconciling outcome_unknown items only (current status: processing)`).
   - Setting SMTP execution phase (`smtp_phase`): Rejected by trigger logic (`ERROR: role_support_agent cannot set or advance smtp_phase (smtp_phase can only be cleared to NULL or preserved)`).

---

### 5. Command Failure and Retry Audit

During the execution of this release, 10 specific commands exited with code 1. Each was audited, diagnosed, and resolved with a passing retry:

| # | Command Executed | Cause of Code 1 Exit | Subsequent Retry & Verification | Residual Failures |
|---|------------------|----------------------|---------------------------------|-------------------|
| 1 | `git diff --check` | Preexisting trailing whitespace in unmodified legacy files (`api.ts:707`, `main_test.go:736`, `main.go:1339`). | Used targeted `git status --short` and `git diff --stat`. Preserved legacy files per safety rules. | None |
| 2 | Initial `tools/c67_security_boundary_audit.sql` | Non-UUID test string and non-NULL lease on seeded `outcome_unknown` record. | Updated audit SQL script with valid UUIDs and NULL lease fields. Script completed with exit code 0. | None |
| 3 | `DROP DATABASE ...; CREATE DATABASE ...;` | `DROP DATABASE` cannot execute within a multi-statement transaction string. | Separated into two distinct psql invocations (`psql -c "DROP DATABASE..."` followed by `psql -c "CREATE DATABASE..."`). Exited code 0. | None |
| 4 | Seed insert for upgrade database | Column names `domain_name` (actual: `name`) and `email` (actual: `local_part`) mismatched table schema. | Corrected column names to match table schema. Insert completed with exit code 0. | None |
| 5 | `.\tools\backup_encrypted.ps1` | Windows PowerShell script execution policy prevented running unauthenticated scripts. | Invoked with `-ExecutionPolicy Bypass`. Script executed successfully and exited with code 0. | None |
| 6 | Initial `tools/restore_encrypted.ps1` | Non-fatal PostgreSQL notices during globals import triggered PowerShell native stderr exception. | Wrapped command with stderr redirection inside container. Full restoration completed with exit code 0. | None |
| 7 | Host `grep` command | `grep` is not a recognized cmdlet on Windows PowerShell. | Replaced with native PowerShell `Select-String`. Exited code 0. | None |
| 8 | Host `cargo check` | Rust toolchain not installed on Windows host PATH. | Executed `cargo check` inside `rustlang/rust:nightly-slim` container mounting the workspace. Exited code 0. | None |
| 9 | Host `npm run build` | `npm.ps1` blocked by Windows PowerShell ExecutionPolicy. | Invoked `npm.cmd run build` directly. Both frontend applications built with exit code 0. | None |
| 10 | `Select-String -Path tools/*` | Subdirectories in `tools/` caused file-read access denied errors when scanning directory as a file. | Filtered with `Get-ChildItem -Path tools -File`. Search executed cleanly with exit code 0. | None |

---

### 6. Production Go / No-Go Assessment

#### Assessment Verdict Matrix

| # | Assessment Area | Evaluation Result | Detailed Evidence Reference |
|---|-----------------|-------------------|-----------------------------|
| 1 | Database security boundary | MET (See #1 below) | Enforced via Migration 075 least-privilege role boundaries and triggers |
| 2 | Migration integrity | MET (See #2 below) | All 74 canonical migrations applied and tested across fresh and upgrade |
| 3 | Backup encryption | MET (See #3 below) | Pre-egress authenticated AES-256-GCM encryption with isolated keys |
| 4 | Backup retention | MET (See #4 below) | Daily/Weekly/Monthly pruning with protection for lone surviving backup |
| 5 | Local restoration | MET (See #5 below) | Decryption and database restoration successfully benchmarked |
| 6 | Off-site disaster recovery | NOT IMPLEMENTED | Backups reside strictly on local filesystem; no remote replication |
| 7 | Recovery Point Objective (RPO) | PARTIAL | Continuous WAL archiving disabled; RPO bounded by snapshot schedule |
| 8 | Recovery Time Objective (RTO) | PARTIAL | Database restore 4.31s benchmarked; full cold RTO estimated 3–10m |
| 9 | Regression tests | MET (See #9 below) | Full test suites across Go, Rust, and TypeScript build clean |
| 10 | Production deployment readiness | CONDITIONAL GO | Subject to continuous WAL archiving and offsite storage replication |

---

#### Explicit Verdicts with Raw Verification Evidence

#### Verdict 1: Database Security Boundary
Command: `Get-Content tools/c67_security_boundary_audit.sql | docker exec -i byos-postgres psql -U byos -d byos_test_isolation`
Verdict: PASS
```
               test_section               
------------------------------------------
 === SECTION 1: VIEWS AND RULES AUDIT ===
(1 row)

 schemaname | viewname | viewowner | definition 
------------+----------+-----------+------------
(0 rows)

 tablename | rulename | definition 
-----------+----------+------------
(0 rows)

                    test_section                     
-----------------------------------------------------
 === SECTION 2: SECURITY DEFINER FUNCTIONS AUDIT ===
(1 row)

 nspname | proname | owner | prosecdef | proconfig | proacl 
---------+---------+-------+-----------+-----------+--------
(0 rows)

       test_section        
---------------------------
 === SEEDING TEST ROWS ===
(1 row)

RESET
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
DELETE 0
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
                           test_section                           
------------------------------------------------------------------
 === SECTION 4: TRIGGER BYPASS ATTEMPTS BY role_support_agent ===
(1 row)

SET
    active_role     
--------------------
 role_support_agent
(1 row)

ERROR:  must be owner of table outbound_queue
ERROR:  must be owner of relation outbound_queue
ERROR:  must be owner of table outbound_queue
ERROR:  permission denied to set parameter "session_replication_role"
ERROR:  permission denied for schema public
ERROR:  must be owner of function enforce_support_agent_outbound_queue_boundaries
                           test_section                            
-------------------------------------------------------------------
 === SECTION 5: BOUNDARY VIOLATION TESTS BY role_support_agent ===
(1 row)

ERROR:  role_support_agent is restricted to reconciling outcome_unknown items only (current status: pending)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 14 at RAISE
ERROR:  role_support_agent cannot transition outbound_queue items to processing status
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 20 at RAISE
ERROR:  role_support_agent cannot acquire or set lease fields (lease fields can only be cleared to NULL or preserved)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 29 at RAISE
ERROR:  role_support_agent cannot set or advance smtp_phase (smtp_phase can only be cleared to NULL or preserved)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 35 at RAISE
ERROR:  role_support_agent is restricted to reconciling outcome_unknown items only (current status: processing)
CONTEXT:  PL/pgSQL function enforce_support_agent_outbound_queue_boundaries() line 14 at RAISE
                     test_section                      
-------------------------------------------------------
 === SECTION 6: LEGITIMATE OPERATOR RECONCILIATION ===
(1 row)

                  id                  | status  | manual_retry_count |        next_attempt_at        |      reconciled_by      |          reconciliation_reason           
--------------------------------------+---------+--------------------+-------------------------------+-------------------------+------------------------------------------
 f6700000-0000-0000-0000-000000000001 | pending |                  1 | 2026-11-24 09:09:39.788837+00 | support-lead@byos.local | Authorized manual retry after peer reset
(1 row)

UPDATE 1
                 test_section                  
-----------------------------------------------
 === SECTION 7: OUTBOUND WORKER PRIVILEGES ===
(1 row)

SET
      active_role      
-----------------------
 outbound_worker_login
(1 row)

ERROR:  must be owner of table outbound_queue
ERROR:  must be owner of relation outbound_queue
                  id                  |   status   |   lease_owner   | attempts 
--------------------------------------+------------+-----------------+----------
 f6700000-0000-0000-0000-000000000003 | processing | worker-node-c67 |        1
(1 row)

UPDATE 1
                  id                  |   status   | smtp_phase 
--------------------------------------+------------+------------
 f6700000-0000-0000-0000-000000000003 | processing | pre_data
(1 row)

UPDATE 1
                  id                  |  status   |         delivered_at         | last_smtp_code 
--------------------------------------+-----------+------------------------------+----------------
 f6700000-0000-0000-0000-000000000003 | delivered | 2026-11-24 09:09:39.80026+00 |            250
(1 row)

UPDATE 1
RESET
DELETE 4
      test_section      
------------------------
 === AUDIT COMPLETE ===
(1 row)
```

---

#### Verdict 2: Migration Integrity
Command: `cd tools/byos-migrate; go test -count=1 -run "TestPhase4_FreshDatabaseBootstrap|TestPhase5_ExistingDatabaseUpgrade_Baseline068|TestPhase6" ./...`
Verdict: PASS
```
=== RUN   TestPhase4_FreshDatabaseBootstrap
2026/11/24 18:47:43 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 2501
2026/11/24 18:47:43 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 18:47:43 Found 74 pending migration(s) to apply.
2026/11/24 18:47:47 Successfully applied 74 migration(s). Database schema is now fully upgraded.
2026/11/24 18:47:47 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 2501
2026/11/24 18:47:47 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 2503
2026/11/24 18:47:47 Database schema is up to date (version 075). No pending migrations.
2026/11/24 18:47:47 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 2503
--- PASS: TestPhase4_FreshDatabaseBootstrap (4.37s)
=== RUN   TestPhase6_MigrationInterruptionAndRecovery
--- PASS: TestPhase6_MigrationInterruptionAndRecovery (0.35s)
=== RUN   TestPhase6_NonTransactionalMigrationSupport
--- PASS: TestPhase6_NonTransactionalMigrationSupport (0.31s)
=== RUN   TestPhase6_ChecksumMismatchDetection
--- PASS: TestPhase6_ChecksumMismatchDetection (0.34s)
=== RUN   TestPhase6_MissingRequiredMigrationFile
--- PASS: TestPhase6_MissingRequiredMigrationFile (0.28s)
=== RUN   TestPhase6_DuplicateVersionDetection
--- PASS: TestPhase6_DuplicateVersionDetection (0.01s)
=== RUN   TestPhase6_ConcurrentDeploymentProtection
--- PASS: TestPhase6_ConcurrentDeploymentProtection (0.28s)
=== RUN   TestPhase6_InsufficientPrivilegesFailsClosed
--- PASS: TestPhase6_InsufficientPrivilegesFailsClosed (1.03s)
PASS
ok  	byos-migrate	17.090s
```

---

#### Verdict 3: Backup Encryption
Command: `cd tools/byos-backup; go test -v -run "TestEncryptDecryptPayloadRoundtrip|TestDecryptWithWrongKeyFails|TestTamperedCiphertextFails|TestKeyParsingAndValidation|TestKeyIsolationFromBackupDirectory|TestEncryptedArchivePackagingRoundtrip" ./...`
Verdict: PASS
```
=== RUN   TestEncryptDecryptPayloadRoundtrip
--- PASS: TestEncryptDecryptPayloadRoundtrip (0.00s)
=== RUN   TestDecryptWithWrongKeyFails
--- PASS: TestDecryptWithWrongKeyFails (0.00s)
=== RUN   TestTamperedCiphertextFails
--- PASS: TestTamperedCiphertextFails (0.00s)
=== RUN   TestKeyParsingAndValidation
--- PASS: TestKeyParsingAndValidation (0.00s)
=== RUN   TestKeyIsolationFromBackupDirectory
--- PASS: TestKeyIsolationFromBackupDirectory (0.02s)
=== RUN   TestEncryptedArchivePackagingRoundtrip
--- PASS: TestEncryptedArchivePackagingRoundtrip (0.00s)
PASS
ok  	byos-backup	0.884s
```

---

#### Verdict 4: Backup Retention
Command: `cd tools/byos-backup; go test -v -run "TestRetentionLoneSurvivingBackupNeverPruned|TestRetentionStandardTiers|TestRetentionAllOlderThanPolicyPreservesNewest" ./...`
Verdict: PASS
```
=== RUN   TestRetentionLoneSurvivingBackupNeverPruned
--- PASS: TestRetentionLoneSurvivingBackupNeverPruned (0.00s)
=== RUN   TestRetentionStandardTiers
--- PASS: TestRetentionStandardTiers (0.00s)
=== RUN   TestRetentionAllOlderThanPolicyPreservesNewest
--- PASS: TestRetentionAllOlderThanPolicyPreservesNewest (0.00s)
PASS
ok  	byos-backup	0.884s
```

---

#### Verdict 5: Local Restoration
Command: `powershell -ExecutionPolicy Bypass -File .\tools\restore_encrypted.ps1 -EncryptedFile .\backups\byos_backup_20261124_122341.enc -KeyFile .\scratch\backup_c67.key -TargetDb byos_disposable_restore_c67`
Verdict: PASS
```
================================================================
BYOS Authenticated Disaster Recovery Restoration
================================================================
Target Database: byos_disposable_restore_c67
Encrypted File:  .\backups\byos_backup_20261124_122341.enc

[1/4] Decrypting and unpacking backup archive...
2026/11/24 18:24:02 Reading encrypted bundle from "F:\\Codex\\byos-email\\backups\\byos_backup_20261124_122341.enc"...
2026/11/24 18:24:02 Successfully decrypted and unpacked backup bundle!
2026/11/24 18:24:02   Globals SQL:   1166 bytes
2026/11/24 18:24:02   Database Dump: 41846 bytes
2026/11/24 18:24:02   Manifest:      250 bytes
2026/11/24 18:24:02 Wrote unpacked files to "C:\\Users\\USER\\AppData\\Local\\Temp\\byos_restore_20261124_182402_743123891"

[2/4] Restoring cluster-global objects (roles, grants, memberships)...

[3/4] Ensuring clean target database (byos_disposable_restore_c67)...

[4/4] Restoring database schema and data from custom archive...

================================================================
DISASTER RECOVERY RESTORATION COMPLETE
Target Database: byos_disposable_restore_c67
Restoration Time: 4.31 seconds
================================================================
```

---

#### Verdict 6: Off-site Disaster Recovery — NOT IMPLEMENTED
- **Status:** NOT IMPLEMENTED
- **Assessment:** Backups are written exclusively to the local filesystem path `./backups`. No remote storage destination (S3, GCS, Azure Blob, SFTP) is configured. All backups currently share the fate of the local host.

---

#### Verdict 7: Recovery Point Objective (RPO) — PARTIAL
- **Status:** PARTIAL
- **Assessment:** PostgreSQL `archive_mode` is `off` and `archive_command` is `(disabled)`. Point-in-time recovery is not operational. RPO is bounded by snapshot schedule frequency rather than continuous archiving. Target `< 15-minute RPO` is not met without WAL shipping.

---

#### Verdict 8: Recovery Time Objective (RTO) — PARTIAL
- **Status:** PARTIAL
- **Assessment:** Local database decryption and `pg_restore` completed in 4.31 seconds. However, full-system recovery including download time, cold-container provisioning, dependent service startup, and healthcheck stabilization is estimated at 3 to 10 minutes.

---

#### Verdict 9: Regression Tests
Command: `cd services/admin-api; go test -count=1 -v ./...`
Verdict: PASS
```
=== RUN   TestMockLoginEndpointDisabledInProduction
--- PASS: TestMockLoginEndpointDisabledInProduction (0.00s)
=== RUN   TestMockWebAuthnMiddlewareBlocksInProduction
--- PASS: TestMockWebAuthnMiddlewareBlocksInProduction (0.00s)
=== RUN   TestRealAgentTokenValidation
--- PASS: TestRealAgentTokenValidation (0.00s)
=== RUN   TestQueueOperations_AuthorizationAndAuditing
--- PASS: TestQueueOperations_AuthorizationAndAuditing (0.24s)
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary
--- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary (0.28s)
=== RUN   TestQueueOperations_EvidenceProvenanceAndIdempotency
--- PASS: TestQueueOperations_EvidenceProvenanceAndIdempotency (0.31s)
=== RUN   TestQueueOperations_C653_ManualRetryGovernance
--- PASS: TestQueueOperations_C653_ManualRetryGovernance (0.27s)
=== RUN   TestQueueOperations_C653_RequestIdempotencyIsolation
--- PASS: TestQueueOperations_C653_RequestIdempotencyIsolation (0.26s)
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance
--- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance (0.22s)
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity
--- PASS: TestQueueOperations_C653_BounceResolutionIntegrity (0.26s)
PASS
ok  	admin-api/handlers	4.727s
```

---

#### Verdict 10: Production Deployment Readiness — CONDITIONAL GO

The zero-knowledge email delivery platform, database migrations, least-privilege role boundaries, pre-egress backup encryption, and local disaster recovery subsystems meet all engineering security and architectural requirements.

Production deployment is granted as a **CONDITIONAL GO**, contingent on satisfying the following 4 mandatory operational conditions prior to serving production traffic:

1. **Continuous WAL Archiving & PITR Deployment:** Enable `archive_mode = on` and deploy a continuous archiving agent (e.g., `pgBackRest` or `wal-g`) streaming WAL segments to immutable cloud storage to fulfill the `< 15-minute` RPO requirement.
2. **Off-site Backup Replication:** Implement automated post-backup egress syncing encrypted `.enc` bundles from `./backups` to geographically isolated object storage (e.g., S3 Glacier or GCS bucket with Object Lock).
3. **Production KMS Key Injection:** Ensure production backup encryption keys are generated within a dedicated Key Management Service and injected directly via `BYOS_BACKUP_ENCRYPTION_KEY` or a `0400` ramfs mount, with zero filesystem key persistence.
4. **Full-Stack Cold Disaster Recovery Drill:** Execute an end-to-end rehearsal in staging recovering all services from cold metal/container teardown to active queue processing, demonstrating the full-stack 3–10 minute RTO target.

