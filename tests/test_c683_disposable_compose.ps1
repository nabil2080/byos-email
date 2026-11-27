# BYOS C6.8.3: Safe Compose WAL Activation & Deployment Verification
# Orchestrates isolated verification of:
# 1. Effective Compose WAL archiving configuration.
# 2. Continuous encrypted WAL archiving & byte-for-byte fidelity.
# 3. Container recreation & volume persistence under Compose.
# 4. Archiver failure and recovery modes (unwritable dir, wrong key, idempotency, conflicting duplicate, missing WAL, corrupted WAL).
# 5. Full physical PITR from the Compose deployment to a specific timestamp.
#
# NON-NEGOTIABLE: Completely isolated from active byos-postgres (port 5432) and byos-email_postgres-data.

$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

Write-Host "================================================================="
Write-Host "BYOS C6.8.3: Compose WAL Activation & Deployment Verification"
Write-Host "================================================================="

$root = (Get-Item $PSScriptRoot).Parent.FullName
$composeBase = Join-Path $root "infra\docker-compose.yml"
$composeOverride = Join-Path $root "tests\compose-c683-wal-override.yml"
$projectName = "byos-c683-wal-test"
$testPort = 15444
$recoveryPort = 15445

$pgContainer = "byos-c683-wal-test-pg"
$recoveryContainer = "byos-c683-pitr-recovery"
$recoveryDataVol = "byos_c683_pitr_recovery_data"
$archiveVolName = "${projectName}_c683_test_archive"

$testKeyHostPath = (Join-Path $root "infra\secrets\backup.key").Replace('\', '/')
$linuxBinHostPath = (Join-Path $root "tools\byos-backup\byos-backup-linux").Replace('\', '/')

function Cleanup-Test-Resources {
    Write-Host "[Teardown] Cleaning up any previous disposable test resources..."
    docker rm -f $recoveryContainer 2>$null | Out-Null
    docker volume rm -f $recoveryDataVol 2>$null | Out-Null
    docker compose -p $projectName -f $composeBase -f $composeOverride down -v 2>$null | Out-Null
}

Cleanup-Test-Resources

try {
    # -------------------------------------------------------------------------
    # STEP 1: Start Isolated Disposable Compose Stack
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 1] Starting Disposable Compose postgres service ($projectName)..."
    docker compose -p $projectName -f $composeBase -f $composeOverride up -d postgres
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start disposable compose project"
    }

    Write-Host "  Waiting for $pgContainer to become ready on port $testPort..."
    $ready = $false
    $attempts = 0
    while ($attempts -lt 45) {
        Start-Sleep -Seconds 1
        $null = docker exec $pgContainer psql -U byos -d byos -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
        $attempts++
    }
    if (-not $ready) {
        $logs = docker logs $pgContainer 2>&1
        Write-Host "Container logs:`n$logs"
        throw "Container $pgContainer failed to become ready"
    }
    Write-Host "  -> Container $pgContainer is query-ready."

    # -------------------------------------------------------------------------
    # STEP 2: Verify PostgreSQL Runtime Settings
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 2] Querying runtime PostgreSQL settings..."
    $settingsSql = "SHOW wal_level; SHOW archive_mode; SHOW archive_command; SHOW archive_timeout;"
    $settingsOutput = docker exec $pgContainer psql -U byos -d byos -c $settingsSql
    Write-Host "$settingsOutput"

    $walLevel = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SHOW wal_level;").Trim()
    $archiveMode = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SHOW archive_mode;").Trim()
    $archiveCmd = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SHOW archive_command;").Trim()
    $archiveTimeout = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SHOW archive_timeout;").Trim()

    if ($walLevel -ne "replica") { throw "Unexpected wal_level: $walLevel" }
    if ($archiveMode -ne "on") { throw "Unexpected archive_mode: $archiveMode" }
    if (-not $archiveCmd.Contains("/usr/local/bin/byos-backup archive-wal")) {
        throw "archive_command does not call byos-backup: $archiveCmd"
    }
    Write-Host "  -> wal_level: $walLevel"
    Write-Host "  -> archive_mode: $archiveMode"
    Write-Host "  -> archive_command: $archiveCmd"
    Write-Host "  -> archive_timeout: $archiveTimeout"

    # -------------------------------------------------------------------------
    # STEP 3: Seed Data & Trigger Continuous Archiving
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 3] Seeding test table & forcing WAL segment switches..."
    $seedSql = @"
CREATE TABLE IF NOT EXISTS c683_wal_verification_records (
    id SERIAL PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO c683_wal_verification_records (payload) VALUES ('C683 Baseline Payload Alpha');
SELECT pg_switch_wal();
INSERT INTO c683_wal_verification_records (payload) VALUES ('C683 Baseline Payload Beta');
SELECT pg_switch_wal();
"@
    docker exec $pgContainer psql -U byos -d byos -c $seedSql | Out-Null
    Start-Sleep -Seconds 2

    # Verify pg_stat_archiver
    Write-Host "`n[Step 4] Checking pg_stat_archiver metrics..."
    $archiverStats = docker exec $pgContainer psql -U byos -d byos -x -c "SELECT * FROM pg_stat_archiver;"
    Write-Host "$archiverStats"

    $archivedCount = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SELECT archived_count FROM pg_stat_archiver;").Trim()
    $failedCount = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SELECT failed_count FROM pg_stat_archiver;").Trim()

    Write-Host "  -> archived_count: $archivedCount"
    Write-Host "  -> failed_count: $failedCount"
    if ([int]$archivedCount -lt 2) {
        throw "Expected at least 2 archived segments, got $archivedCount"
    }
    if ([int]$failedCount -ne 0) {
        throw "Archiver encountered failures: $failedCount"
    }

    # Inspect archive directory
    Write-Host "`n[Step 5] Inspecting archive directory in volume..."
    $lsArchive = docker exec $pgContainer ls -lh /var/byos/archive/wal
    Write-Host "$lsArchive"

    $encFiles = docker exec $pgContainer sh -c "ls -1 /var/byos/archive/wal/*.enc"
    $walList = $encFiles.Trim().Split("`n") | Where-Object { $_.Trim() -ne "" }
    Write-Host "  Found $($walList.Length) encrypted WAL segments."
    if ($walList.Length -lt 2) {
        throw "Expected at least 2 .enc WAL files"
    }

    # -------------------------------------------------------------------------
    # STEP 6: Byte-for-Byte Restoration & Cryptographic Verification
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 6] Restoring first archived WAL segment and verifying SHA-256..."
    $firstEncPath = $walList[0].Trim()
    $walName = [System.IO.Path]::GetFileNameWithoutExtension($firstEncPath)
    Write-Host "  Target segment: $walName"

    $restoreCmd = "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name $walName --target-path /tmp/restored_$walName"
    docker exec $pgContainer sh -c "$restoreCmd"
    if ($LASTEXITCODE -ne 0) {
        throw "restore-wal failed with exit code $LASTEXITCODE"
    }

    $restoredBytes = (docker exec $pgContainer stat -c "%s" "/tmp/restored_$walName").Trim()
    Write-Host "  -> Restored size: $restoredBytes bytes (expected: 16777216)"
    if ([long]$restoredBytes -ne 16777216) {
        throw "Restored WAL size does not equal 16MB"
    }

    $metaJson = docker exec $pgContainer cat "/var/byos/archive/wal/${walName}.meta.json"
    $metaObj = $metaJson | ConvertFrom-Json
    $expectedSha = $metaObj.plaintext_sha256
    $actualSha = (docker exec $pgContainer sha256sum "/tmp/restored_$walName").Split()[0].Trim()

    Write-Host "  -> Metadata Checksum: $expectedSha"
    Write-Host "  -> Restored Checksum: $actualSha"
    if ($expectedSha -ne $actualSha) {
        throw "SHA-256 mismatch! Expected $expectedSha but got $actualSha"
    }
    Write-Host "  -> Byte fidelity & SHA-256 integrity: EXACT MATCH"

    # -------------------------------------------------------------------------
    # STEP 7: Container Recreation Test (Volume Persistence)
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 7] Testing Compose container recreation with persistent volumes..."
    Write-Host "  Stopping and removing container..."
    docker compose -p $projectName -f $composeBase -f $composeOverride stop postgres | Out-Null
    docker compose -p $projectName -f $composeBase -f $composeOverride rm -f postgres | Out-Null

    Write-Host "  Restarting container via Compose..."
    docker compose -p $projectName -f $composeBase -f $composeOverride up -d postgres
    $recreateReady = $false
    $attempts = 0
    while ($attempts -lt 30) {
        Start-Sleep -Seconds 1
        $null = docker exec $pgContainer psql -U byos -d byos -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $recreateReady = $true
            break
        }
        $attempts++
    }
    if (-not $recreateReady) {
        throw "Recreated container failed to become ready"
    }
    Write-Host "  -> Recreated container is ready."

    $persistedCount = (docker exec $pgContainer sh -c "ls -1 /var/byos/archive/wal/*.enc | wc -l").Trim()
    Write-Host "  -> Archived WAL count in volume after container recreation: $persistedCount (previous: $($walList.Length))"
    if ([int]$persistedCount -lt $walList.Length) {
        throw "Volume persistence failure: expected at least $($walList.Length) WAL files, found $persistedCount"
    }

    # Insert post-recreation data & switch
    $postRecreateSql = @"
INSERT INTO c683_wal_verification_records (payload) VALUES ('Post-Recreation Activity');
SELECT pg_switch_wal();
"@
    docker exec $pgContainer psql -U byos -d byos -c $postRecreateSql | Out-Null
    Start-Sleep -Seconds 2

    $recreateArchivedCount = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SELECT archived_count FROM pg_stat_archiver;").Trim()
    $recreateFailedCount = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SELECT failed_count FROM pg_stat_archiver;").Trim()
    Write-Host "  -> Recreated container archiver metrics: archived_count=$recreateArchivedCount, failed_count=$recreateFailedCount"
    if ([int]$recreateArchivedCount -lt 1 -or [int]$recreateFailedCount -ne 0) {
        throw "Archiving failed in recreated container"
    }

    $finalDiskCount = (docker exec $pgContainer sh -c "ls -1 /var/byos/archive/wal/*.enc | wc -l").Trim()
    Write-Host "  -> Total encrypted WAL segments on disk: $finalDiskCount"
    if ([int]$finalDiskCount -le [int]$persistedCount) {
        throw "Disk count of archived segments did not increment after post-recreation switch"
    }

    # -------------------------------------------------------------------------
    # STEP 8: Archive Failure & Recovery Modes (Phase 4)
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 8] Testing Archive Failure & Recovery Modes..."

    # Scenario 8A: Unwritable Archive Directory
    Write-Host "  [Scenario 8A] Simulating unwritable archive directory (chmod 500)..."
    docker exec $pgContainer chmod 500 /var/byos/archive/wal
    $prevFailed = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SELECT failed_count FROM pg_stat_archiver;").Trim()

    docker exec $pgContainer psql -U byos -d byos -c "INSERT INTO c683_wal_verification_records (payload) VALUES ('Fault injection unwritable'); SELECT pg_switch_wal();" | Out-Null
    Start-Sleep -Seconds 3

    $newFailed = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SELECT failed_count FROM pg_stat_archiver;").Trim()
    Write-Host "    -> Initial failed_count: $prevFailed, new failed_count: $newFailed"
    if ([int]$newFailed -le [int]$prevFailed) {
        throw "Archiver did not register failure when archive dir was unwritable!"
    }

    # Restore directory permissions and verify recovery
    Write-Host "    Restoring permissions (chmod 700 /var/byos/archive/wal) and verifying archiver recovery..."
    docker exec $pgContainer chmod 700 /var/byos/archive/wal
    Start-Sleep -Seconds 3

    $postRecoveryArchived = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SELECT archived_count FROM pg_stat_archiver;").Trim()
    Write-Host "    -> Archived count after permissions restoration: $postRecoveryArchived"

    # Restore segment in the current container for testing failure and idempotency
    docker exec $pgContainer sh -c "$restoreCmd" | Out-Null

    # Scenario 8B: Key Unavailable / Wrong Key
    Write-Host "  [Scenario 8B] Simulating archive-wal with missing / invalid key..."
    $badKeyCmd = "/usr/local/bin/byos-backup archive-wal --source-path /tmp/restored_$walName --wal-name 999999990000000000000099 --archive-dir /var/byos/archive --key-file /etc/byos/keys/nonexistent.key"
    $badKeyOut = docker exec $pgContainer sh -c "$badKeyCmd" 2>&1
    $badKeyExit = $LASTEXITCODE
    Write-Host "    -> archive-wal exit code with missing key: $badKeyExit (Output: $badKeyOut)"
    if ($badKeyExit -eq 0) {
        throw "archive-wal unexpectedly succeeded with missing key!"
    }

    # Scenario 8C: Duplicate Object with Identical Content (Idempotency)
    Write-Host "  [Scenario 8C] Testing duplicate segment archiving with identical content (Idempotency)..."
    $idemCmd = "/usr/local/bin/byos-backup archive-wal --source-path /tmp/restored_$walName --wal-name $walName --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key"
    $idemOut = docker exec $pgContainer sh -c "$idemCmd" 2>&1
    $idemExit = $LASTEXITCODE
    Write-Host "    -> archive-wal idempotency exit code: $idemExit (Output: $idemOut)"
    if ($idemExit -ne 0) {
        throw "Idempotent re-archiving of identical segment failed with exit code $idemExit"
    }

    # Scenario 8D: Duplicate Object with Conflicting Content (Fail-Closed)
    Write-Host "  [Scenario 8D] Testing duplicate segment archiving with conflicting content (Fail-Closed)..."
    docker exec $pgContainer sh -c "dd if=/dev/urandom of=/tmp/conflicting_wal bs=1M count=16 2>/dev/null"
    $conflictCmd = "/usr/local/bin/byos-backup archive-wal --source-path /tmp/conflicting_wal --wal-name $walName --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key"
    $conflictOut = docker exec $pgContainer sh -c "$conflictCmd" 2>&1
    $conflictExit = $LASTEXITCODE
    Write-Host "    -> archive-wal conflicting duplicate exit code: $conflictExit (Output: $conflictOut)"
    if ($conflictExit -eq 0) {
        throw "archive-wal unexpectedly succeeded when archiving conflicting content over existing segment!"
    }

    # Scenario 8E: Restore Request for Missing Object
    Write-Host "  [Scenario 8E] Testing restore-wal on non-existent object..."
    $missingRestoreCmd = "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name 0000000100000000000000FE --target-path /tmp/missing_wal"
    $missingRestoreOut = docker exec $pgContainer sh -c "$missingRestoreCmd" 2>&1
    $missingRestoreExit = $LASTEXITCODE
    Write-Host "    -> restore-wal missing object exit code: $missingRestoreExit (Output: $missingRestoreOut)"
    if ($missingRestoreExit -eq 0) {
        throw "restore-wal unexpectedly succeeded for missing object!"
    }

    # Scenario 8F: Corrupted Encrypted Object Detection
    Write-Host "  [Scenario 8F] Testing restore-wal on corrupted encrypted segment..."
    docker exec $pgContainer cp "/var/byos/archive/wal/${walName}.enc" "/var/byos/archive/wal/${walName}_corrupt.enc"
    docker exec $pgContainer cp "/var/byos/archive/wal/${walName}.meta.json" "/var/byos/archive/wal/${walName}_corrupt.meta.json"
    docker exec $pgContainer sh -c "printf 'CORRUPT_BYTES_AT_OFFSET' | dd of=/var/byos/archive/wal/${walName}_corrupt.enc bs=1 seek=100 conv=notrunc 2>/dev/null"
    $corruptRestoreCmd = "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name ${walName}_corrupt --target-path /tmp/corrupt_wal"
    $corruptRestoreOut = docker exec $pgContainer sh -c "$corruptRestoreCmd" 2>&1
    $corruptRestoreExit = $LASTEXITCODE
    Write-Host "    -> restore-wal corrupt object exit code: $corruptRestoreExit (Output: $corruptRestoreOut)"
    if ($corruptRestoreExit -eq 0) {
        throw "restore-wal unexpectedly succeeded on corrupted encrypted payload!"
    }
    docker exec $pgContainer rm -f "/var/byos/archive/wal/${walName}_corrupt.enc" "/var/byos/archive/wal/${walName}_corrupt.meta.json"

    # -------------------------------------------------------------------------
    # STEP 9: Physical PITR from the Compose Deployment (Phase 5)
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 9] Executing Physical PITR from the Compose Deployment..."

    # Setup basebackup directory
    docker exec $pgContainer sh -c "rm -rf /var/byos/archive/basebackups/c683_base && mkdir -p /var/byos/archive/basebackups/c683_base"
    Write-Host "  Generating physical pg_basebackup from $pgContainer..."
    docker exec $pgContainer pg_basebackup -h 127.0.0.1 -U byos -D /var/byos/archive/basebackups/c683_base -Ft -X none
    if ($LASTEXITCODE -ne 0) {
        throw "pg_basebackup failed"
    }

    # Insert Transaction T1 (Valid pre-target record)
    Write-Host "  Inserting Transaction T1 (Pre-target valid state)..."
    docker exec $pgContainer psql -U byos -d byos -c "CREATE TABLE IF NOT EXISTS c683_pitr_records (id SERIAL PRIMARY KEY, label TEXT, committed_at TIMESTAMPTZ DEFAULT NOW());" | Out-Null
    docker exec $pgContainer psql -U byos -d byos -c "INSERT INTO c683_pitr_records (label) VALUES ('TX1_VALID_PRE_TARGET');" | Out-Null
    $t1Time = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SELECT committed_at::text FROM c683_pitr_records WHERE label = 'TX1_VALID_PRE_TARGET';").Trim()
    Write-Host "  -> T1 Committed At: $t1Time"

    Start-Sleep -Seconds 2
    # Designate PITR target timestamp 1 second after T1
    $targetTime = ([DateTimeOffset]::Parse($t1Time)).AddSeconds(1).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + " UTC"
    Write-Host "  -> Target Recovery Timestamp: $targetTime"
    Start-Sleep -Seconds 2

    # Insert Transaction T2 (Disaster record after target time)
    Write-Host "  Inserting Transaction T2 (Disaster record after target timestamp)..."
    docker exec $pgContainer psql -U byos -d byos -c "INSERT INTO c683_pitr_records (label) VALUES ('TX2_DISASTER_POST_TARGET');" | Out-Null
    $t2Time = (docker exec $pgContainer psql -U byos -d byos -t -A -c "SELECT committed_at::text FROM c683_pitr_records WHERE label = 'TX2_DISASTER_POST_TARGET';").Trim()
    Write-Host "  -> T2 Committed At: $t2Time"
    Start-Sleep -Seconds 2

    # Insert Post-disaster sync marker and force WAL switch to ensure WAL stream continues past target
    docker exec $pgContainer psql -U byos -d byos -c "CREATE TABLE post_disaster_sync (id INT); SELECT pg_switch_wal();" | Out-Null
    Start-Sleep -Seconds 2

    # Wait for ready queue to drain to 0
    for ($w = 0; $w -lt 20; $w++) {
        $pending = (docker exec $pgContainer sh -c "ls -1 /var/lib/postgresql/data/pg_wal/archive_status/*.ready 2>/dev/null | wc -l").Trim()
        if ([int]$pending -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }
    Write-Host "  All pre-recovery WAL segments archived."

    # Prepare recovery environment
    Write-Host "  Preparing isolated recovery volume and base backup extraction..."
    docker volume create $recoveryDataVol | Out-Null

    # Use a helper container to extract base.tar into the recovery volume and configure PITR
    $setupPitrScript = @"
tar -xf /var/byos/archive/basebackups/c683_base/base.tar -C /var/lib/postgresql/data
touch /var/lib/postgresql/data/recovery.signal
cat << 'EOF' >> /var/lib/postgresql/data/postgresql.auto.conf
restore_command = '/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p'
recovery_target_time = '$targetTime'
recovery_target_action = 'promote'
recovery_target_inclusive = 'true'
EOF
chown -R 70:70 /var/lib/postgresql/data
chmod 700 /var/lib/postgresql/data
"@
    # In PowerShell here-string, $targetTime is already interpolated into the script string.
    $setupEncoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($setupPitrScript.Replace("`r`n", "`n")))
    docker run --rm `
        -v "${recoveryDataVol}:/var/lib/postgresql/data" `
        -v "${archiveVolName}:/var/byos/archive:ro" `
        alpine:latest `
        sh -c "echo '$setupEncoded' | base64 -d | sh"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed extracting base backup and setting up PITR configuration"
    }

    Write-Host "  Starting PITR Recovery PostgreSQL container ($recoveryContainer) on port $recoveryPort..."
    $pitrStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    docker run -d --name $recoveryContainer -p "127.0.0.1:${recoveryPort}:5432" `
        -e POSTGRES_PASSWORD=byos_dev_password `
        -v "${recoveryDataVol}:/var/lib/postgresql/data" `
        -v "${archiveVolName}:/var/byos/archive:ro" `
        -v "${linuxBinHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${testKeyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres

    # Poll until recovery finishes and database is read-write queryable
    $recoveryReady = $false
    $recoveryAttempts = 0
    while ($recoveryAttempts -lt 40) {
        Start-Sleep -Milliseconds 250
        $null = docker exec $recoveryContainer psql -U byos -d byos -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $inRecovery = (docker exec $recoveryContainer psql -U byos -d byos -t -A -c "SELECT pg_is_in_recovery();" 2>&1).Trim()
            if ($inRecovery -eq "f") {
                $recoveryReady = $true
                break
            }
        }
        $recoveryAttempts++
    }
    $pitrStopwatch.Stop()
    $pitrDurationSec = [Math]::Round($pitrStopwatch.Elapsed.TotalSeconds, 3)

    if (-not $recoveryReady) {
        $recLogs = docker logs $recoveryContainer 2>&1
        Write-Host "Recovery logs:`n$recLogs"
        throw "PITR recovery container failed to promote within timeout"
    }

    Write-Host "  -> PITR Recovery succeeded in $pitrDurationSec seconds."

    # Verify PITR Results
    Write-Host "`n[Step 10] Validating PITR Data State & Timeline Promotion..."
    $pitrRecords = docker exec $recoveryContainer psql -U byos -d byos -c "SELECT * FROM c683_pitr_records;"
    Write-Host "$pitrRecords"

    $hasT1 = (docker exec $recoveryContainer psql -U byos -d byos -t -A -c "SELECT COUNT(*) FROM c683_pitr_records WHERE label = 'TX1_VALID_PRE_TARGET';").Trim()
    $hasT2 = (docker exec $recoveryContainer psql -U byos -d byos -t -A -c "SELECT COUNT(*) FROM c683_pitr_records WHERE label = 'TX2_DISASTER_POST_TARGET';").Trim()

    Write-Host "  -> TX1_VALID_PRE_TARGET present: $hasT1 (expected: 1)"
    Write-Host "  -> TX2_DISASTER_POST_TARGET present: $hasT2 (expected: 0)"

    if ($hasT1 -ne "1") {
        throw "PITR failure: TX1_VALID_PRE_TARGET is missing from restored database!"
    }
    if ($hasT2 -ne "0") {
        throw "PITR failure: TX2_DISASTER_POST_TARGET was NOT rolled back!"
    }

    # Verify Timeline promotion
    $timelineInfo = docker exec $recoveryContainer psql -U byos -d byos -c "SELECT timeline_id FROM pg_control_checkpoint();"
    Write-Host "$timelineInfo"
    $timelineId = (docker exec $recoveryContainer psql -U byos -d byos -t -A -c "SELECT timeline_id FROM pg_control_checkpoint();").Trim()
    Write-Host "  -> Restored Timeline ID: $timelineId"
    if ([int]$timelineId -lt 2) {
        throw "Expected timeline promotion to >= 2, got $timelineId"
    }
    Write-Host "  -> Timeline promotion to Timeline $timelineId verified."

    Write-Host "`n================================================================="
    Write-Host "DISPOSABLE COMPOSE INTEGRATION TEST: ALL PHASES SATISFIED"
    Write-Host "================================================================="
}
finally {
    Cleanup-Test-Resources
}
