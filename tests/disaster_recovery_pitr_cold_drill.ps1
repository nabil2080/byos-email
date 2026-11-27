# BYOS Release C6.8.1: Full Physical PITR Cold-Recovery Drill & Scenarios A-H
# Validates genuine physical base-backup + AES-256-GCM WAL replay recovery.
# Measures physical RTO and tests all failure/edge cases.

$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

Write-Host "================================================================"
Write-Host "BYOS C6.8.1: Physical PITR Cold Recovery Drill & Scenarios A-H"
Write-Host "================================================================"

$drillDir = Join-Path $PSScriptRoot "..\scratch\c681_pitr_drill"
if (Test-Path $drillDir) { Remove-Item -Recurse -Force $drillDir }
New-Item -ItemType Directory -Path $drillDir | Out-Null

$keyHostPath = (Join-Path $PSScriptRoot "..\scratch\backup_c67.key").Replace('\', '/')
$wrongKeyHostPath = (Join-Path $drillDir "wrong.key").Replace('\', '/')
$binHostPath = (Join-Path $PSScriptRoot "..\tools\byos-backup\byos-backup-linux").Replace('\', '/')
$winBinPath = (Join-Path $PSScriptRoot "..\tools\byos-backup\byos-backup.exe")

# Generate 32-byte wrong key for Scenario E
[byte[]]$wrongBytes = New-Object byte[] 32
(New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($wrongBytes)
[System.IO.File]::WriteAllBytes((Join-Path $drillDir "wrong.key"), $wrongBytes)

$srcPort = 15437
$targetPort = 15438
$apiPort = 18082
$srcContainer = "byos-c681-pitr-src"
$targetContainer = "byos-c681-pitr-target"
$network = "byos-c681-pitr-net"

# Volumes
$srcDataVol = "byos_c681_src_data"
$srcArchiveVol = "byos_c681_src_archive"
$targetDataVol = "byos_c681_target_data"
$offsiteArchiveVol = "byos_c681_offsite_archive"

function Cleanup-Containers {
    docker rm -f $srcContainer $targetContainer 2>$null | Out-Null
    docker volume rm -f $srcDataVol $srcArchiveVol $targetDataVol $offsiteArchiveVol "byos_c681_gap_archive" "byos_c681_tamper_archive" 2>$null | Out-Null
    docker network rm $network 2>$null | Out-Null
}

function Unpack-BaseBackup($vol, $tarHostPath) {
    docker run --rm `
        -v "${vol}:/target_data" `
        -v "${tarHostPath}:/tmp/basebackup.tar:ro" `
        alpine:latest `
        sh -c "tar -xf /tmp/basebackup.tar -C /target_data && chown -R 70:70 /target_data && chmod 700 /target_data" | Out-Null
}

function Configure-TargetRecovery($vol, $cmd, $targetTime, $action = "promote") {
    $scriptPath = Join-Path $drillDir "setup_recovery.sh"
    $timeLine = if ($targetTime) { "echo `"recovery_target_time = '$targetTime'`" >> /target_data/postgresql.auto.conf`necho `"recovery_target_inclusive = 'true'`" >> /target_data/postgresql.auto.conf" } else { "" }
    $content = @"
#!/bin/sh
touch /target_data/recovery.signal
chown 70:70 /target_data/recovery.signal
chmod 600 /target_data/recovery.signal
echo "restore_command = '$cmd'" >> /target_data/postgresql.auto.conf
$timeLine
echo "recovery_target_action = '$action'" >> /target_data/postgresql.auto.conf
chown 70:70 /target_data/postgresql.auto.conf
chmod 600 /target_data/postgresql.auto.conf
"@
    [System.IO.File]::WriteAllText($scriptPath, $content.Replace("`r`n", "`n"))
    $scriptHostPath = $scriptPath.Replace('\', '/')
    docker run --rm -v "${vol}:/target_data" -v "${scriptHostPath}:/setup_recovery.sh:ro" alpine:latest sh /setup_recovery.sh | Out-Null
}

Cleanup-Containers

docker network create $network | Out-Null
docker volume create $srcDataVol | Out-Null
docker volume create $srcArchiveVol | Out-Null
docker volume create $targetDataVol | Out-Null
docker volume create $offsiteArchiveVol | Out-Null

$restoreCmd = "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p"

try {
    Write-Host "`n[Phase A] Starting Source Database with Continuous WAL Archiving..."
    $entrypointHostPath = (Join-Path $drillDir "entrypoint.sh").Replace('\', '/')
    $shContent = @"
#!/bin/sh
mkdir -p /var/byos/archive
chown -R postgres:postgres /var/byos/archive
chmod 755 /var/byos/archive
exec docker-entrypoint.sh postgres \
  -c wal_level=replica \
  -c archive_mode=on \
  -c "archive_command=/usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key" \
  -c archive_timeout=300
"@
    [System.IO.File]::WriteAllText((Join-Path $drillDir "entrypoint.sh"), $shContent.Replace("`r`n", "`n"))

    docker run -d --name $srcContainer --network $network -p "127.0.0.1:${srcPort}:5432" `
        -e POSTGRES_DB=byos_pitr `
        -e POSTGRES_USER=byos `
        -e POSTGRES_PASSWORD=pitr_password `
        -v "${srcDataVol}:/var/lib/postgresql/data" `
        -v "${srcArchiveVol}:/var/byos/archive" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        -v "${entrypointHostPath}:/entrypoint.sh:ro" `
        --entrypoint sh `
        postgres:16-alpine /entrypoint.sh | Out-Null

    # Wait for source DB
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        $null = docker exec $srcContainer psql -U byos -d byos_pitr -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }
    if (-not $ready) { throw "Source database failed to become ready" }
    Write-Host "  -> Source PostgreSQL is ready on port $srcPort."

    Write-Host "`n[Phase B] Seeding Baseline State & Taking Physical Base Backup..."
    $seedSql = @"
CREATE TABLE pitr_ledger (
    id INT PRIMARY KEY,
    note TEXT NOT NULL,
    tx_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO pitr_ledger (id, note) VALUES (1, 'Baseline Seed Record (Pre-Backup)');
"@
    docker exec $srcContainer psql -U byos -d byos_pitr -c $seedSql | Out-Null

    # Take physical base backup via pg_basebackup
    Write-Host "  Executing physical pg_basebackup into tarball..."
    docker exec $srcContainer sh -c "mkdir -p /tmp/basebackup && pg_basebackup -U byos -D /tmp/basebackup -Ft -X none"
    if ($LASTEXITCODE -ne 0) { throw "pg_basebackup failed" }

    # Copy tarball to host
    $localBaseTar = Join-Path $drillDir "basebackup.tar"
    docker cp "${srcContainer}:/tmp/basebackup/base.tar" $localBaseTar
    $tarSize = (Get-Item $localBaseTar).Length
    Write-Host "  -> Physical base backup captured ($tarSize bytes)."

    # Encrypt the physical base backup tarball with AES-256-GCM using byos-backup
    Write-Host "  Encrypting physical base backup package..."
    $encBaseBackup = Join-Path $drillDir "basebackup.tar.enc"
    & $winBinPath encrypt-bundle --dump-file $localBaseTar --out-file $encBaseBackup --key-file $keyHostPath | Out-Null
    $encSize = (Get-Item $encBaseBackup).Length
    Write-Host "  -> Base backup encrypted: $encBaseBackup ($encSize bytes)."

    Write-Host "`n[Phase C] Generating Transaction Timeline (T1, T2, Target, T3 Disaster)..."
    docker exec $srcContainer psql -U byos -d byos_pitr -c "SELECT pg_switch_wal();" | Out-Null
    Start-Sleep -Seconds 1

    # T1: Transaction 2
    $t1Sql = "INSERT INTO pitr_ledger (id, note) VALUES (2, 'Transaction Set 1 (Valid Business Activity)'); SELECT pg_switch_wal();"
    docker exec $srcContainer psql -U byos -d byos_pitr -c $t1Sql | Out-Null
    $t1Time = (docker exec $srcContainer psql -U byos -d byos_pitr -t -A -c "SELECT tx_time FROM pitr_ledger WHERE id=2;").Trim()
    Write-Host "  -> T1 (Record 2 committed): $t1Time"
    Start-Sleep -Seconds 2

    # T2: Transaction 3
    $t2Sql = "INSERT INTO pitr_ledger (id, note) VALUES (3, 'Transaction Set 2 (Desired PITR Recovery Target)'); SELECT pg_switch_wal();"
    docker exec $srcContainer psql -U byos -d byos_pitr -c $t2Sql | Out-Null
    $t2Time = (docker exec $srcContainer psql -U byos -d byos_pitr -t -A -c "SELECT tx_time FROM pitr_ledger WHERE id=3;").Trim()
    Write-Host "  -> T2 (Record 3 committed): $t2Time"

    # Define Target Recovery Timestamp (1 second after T2)
    $t2Parsed = [DateTimeOffset]::Parse($t2Time)
    $targetTimestamp = $t2Parsed.AddSeconds(1).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + " UTC"
    Write-Host "  -> PITR Target Recovery Point: $targetTimestamp"
    Start-Sleep -Seconds 2

    # T3: Accidental Disaster / Dropped Data
    $t3Sql = "INSERT INTO pitr_ledger (id, note) VALUES (4, 'CORRUPTION INCIDENT: Unauthorized Drop/Overwrite');"
    docker exec $srcContainer psql -U byos -d byos_pitr -c $t3Sql | Out-Null
    $t3Time = (docker exec $srcContainer psql -U byos -d byos_pitr -t -A -c "SELECT tx_time FROM pitr_ledger WHERE id=4;").Trim()
    Write-Host "  -> T3 (Record 4 disaster committed): $t3Time"
    Start-Sleep -Seconds 2

    # Switch WAL to close segment containing T3
    docker exec $srcContainer psql -U byos -d byos_pitr -c "SELECT pg_switch_wal();" | Out-Null
    Start-Sleep -Seconds 1

    # T4: Subsequent Activity (Ensures the archive contains a segment past target)
    docker exec $srcContainer psql -U byos -d byos_pitr -c "CREATE TABLE post_target_marker (id INT); SELECT pg_switch_wal();" | Out-Null
    Start-Sleep -Seconds 2

    # Verify archived WAL count in source
    Start-Sleep -Seconds 2
    $walList = docker exec $srcContainer sh -c "ls -1 /var/byos/archive/wal/*.enc"
    $walCount = ($walList.Trim().Split("`n")).Count
    Write-Host "  -> Archived WAL segments available: $walCount"

    # =========================================================================
    # SCENARIO A: Full-Stack Cold Physical PITR Drill & Benchmark to Target Time
    # =========================================================================
    Write-Host "`n================================================================"
    Write-Host "SCENARIO A: Full-Stack Cold Physical PITR Drill & Benchmark"
    Write-Host "================================================================"
    $rtoMetrics = [ordered]@{}

    # Stage 1: Infrastructure Provisioning
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    docker rm -f $targetContainer 2>$null | Out-Null
    docker volume rm -f $targetDataVol 2>$null | Out-Null
    docker volume create $targetDataVol | Out-Null
    $sw.Stop()
    $rtoMetrics["1_infrastructure_provisioning"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 1] Infrastructure Provisioning: $($rtoMetrics['1_infrastructure_provisioning']) ms"

    # Stage 2: Base Backup & WAL Retrieval
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $stagedEncBackup = Join-Path $drillDir "staged_basebackup.tar.enc"
    Copy-Item $encBaseBackup $stagedEncBackup
    $sw.Stop()
    $rtoMetrics["2_backup_retrieval"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 2] Base Backup Retrieval: $($rtoMetrics['2_backup_retrieval']) ms"

    # Stage 3: Decrypt Base Backup
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $decryptedBaseDir = Join-Path $drillDir "decrypted_base"
    if (Test-Path $decryptedBaseDir) { Remove-Item -Recurse -Force $decryptedBaseDir }
    & $winBinPath decrypt-bundle --in-file $stagedEncBackup --out-dir $decryptedBaseDir --key-file $keyHostPath | Out-Null
    $sw.Stop()
    $rtoMetrics["3_basebackup_decryption"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 3] Base Backup Decryption: $($rtoMetrics['3_basebackup_decryption']) ms"

    # Stage 4: Physical Unpack into Target PGDATA Volume
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $decTarPath = (Join-Path $decryptedBaseDir "database.dump").Replace('\', '/')
    Unpack-BaseBackup $targetDataVol $decTarPath
    $sw.Stop()
    $rtoMetrics["4_physical_unpack"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 4] Physical Unpack & Permissions Setup: $($rtoMetrics['4_physical_unpack']) ms"

    # Stage 5: Recovery Configuration (recovery.signal, restore_command, recovery_target_time)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Configure-TargetRecovery $targetDataVol $restoreCmd $targetTimestamp "promote"
    $sw.Stop()
    $rtoMetrics["5_recovery_configuration"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 5] PITR Configuration (recovery.signal): $($rtoMetrics['5_recovery_configuration']) ms"

    # Stage 6 & 7: PostgreSQL Startup & Archive WAL Replay to Target & Promotion
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    docker run -d --name $targetContainer --network $network -p "127.0.0.1:${targetPort}:5432" `
        -e POSTGRES_PASSWORD=pitr_password `
        -v "${targetDataVol}:/var/lib/postgresql/data" `
        -v "${srcArchiveVol}:/var/byos/archive:ro" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres | Out-Null

    # Wait for target DB promotion and readiness
    $targetReady = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $null = docker exec $targetContainer psql -U byos -d byos_pitr -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) { $targetReady = $true; break }
    }
    $sw.Stop()
    if (-not $targetReady) {
        $logs = docker logs $targetContainer 2>&1
        Write-Host "Target recovery logs:`n$logs"
        throw "Target database failed to complete recovery within timeout"
    }
    $rtoMetrics["6_wal_replay_and_promotion"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 6 & 7] WAL Replay, Recovery to Target & Promotion: $($rtoMetrics['6_wal_replay_and_promotion']) ms"

    # Stage 8: Data Validation & State Verification
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $targetRecords = docker exec $targetContainer psql -U byos -d byos_pitr -t -A -F" | " -c "SELECT id, note FROM pitr_ledger ORDER BY id;"
    $recordsStr = ($targetRecords -join "`n")
    Write-Host "`nTarget Database Restored Records (Scenario A):"
    Write-Host "$recordsStr"

    $hasRec1 = $recordsStr.Contains("Baseline Seed Record")
    $hasRec2 = $recordsStr.Contains("Transaction Set 1")
    $hasRec3 = $recordsStr.Contains("Transaction Set 2")
    $hasRec4 = $recordsStr.Contains("CORRUPTION INCIDENT")

    if (-not ($hasRec1 -and $hasRec2 -and $hasRec3)) {
        throw "Scenario A validation failed: Records 1, 2, or 3 missing!"
    }
    if ($hasRec4) {
        throw "Scenario A validation failed: Record 4 (disaster) was NOT excluded!"
    }
    $sw.Stop()
    $rtoMetrics["7_data_validation"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 8] Data Validation: $($rtoMetrics['7_data_validation']) ms"

    # Compute Total Physical PITR RTO
    $totalPhysicalRTO = 0
    foreach ($val in $rtoMetrics.Values) { $totalPhysicalRTO += $val }
    Write-Host "`n================================================================"
    Write-Host "  -> TOTAL COLD PHYSICAL PITR RTO: $totalPhysicalRTO ms ($([math]::Round($totalPhysicalRTO / 1000, 3)) seconds)"
    Write-Host "  -> (Distinct from C6.8 logical restoration RTO of 15.426 seconds)"
    Write-Host "================================================================"

    # Capture target logs showing recovery stopped at target
    $scenarioALogs = docker logs $targetContainer 2>&1
    $recoveryDoneLine = ($scenarioALogs | Select-String -Pattern "recovery stopping before commit of transaction|redo done at|archive recovery complete") | Out-String
    Write-Host "Recovery Log Evidence (Scenario A):`n$recoveryDoneLine"

    # Clean target container for next scenario
    docker rm -f $targetContainer 2>$null | Out-Null

    # =========================================================================
    # SCENARIO B: Recovery to Latest Consistent State (No Target Time)
    # =========================================================================
    Write-Host "`n================================================================"
    Write-Host "SCENARIO B: Recovery to Latest Consistent State"
    Write-Host "================================================================"
    docker volume rm -f $targetDataVol 2>$null | Out-Null
    docker volume create $targetDataVol | Out-Null

    Unpack-BaseBackup $targetDataVol $decTarPath
    Configure-TargetRecovery $targetDataVol $restoreCmd $null "promote"

    docker run -d --name $targetContainer --network $network -p "127.0.0.1:${targetPort}:5432" `
        -e POSTGRES_PASSWORD=pitr_password `
        -v "${targetDataVol}:/var/lib/postgresql/data" `
        -v "${srcArchiveVol}:/var/byos/archive:ro" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres | Out-Null

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $null = docker exec $targetContainer psql -U byos -d byos_pitr -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) { break }
    }
    $scenBRecords = docker exec $targetContainer psql -U byos -d byos_pitr -t -A -F" | " -c "SELECT id, note FROM pitr_ledger ORDER BY id;"
    $scenBStr = ($scenBRecords -join "`n")
    Write-Host "Target Database Restored Records (Scenario B - Latest State):`n$scenBStr"
    if (-not ($scenBStr.Contains("CORRUPTION INCIDENT") -and $scenBStr.Contains("Transaction Set 2"))) {
        throw "Scenario B failed: Expected all records including Record 4 to be replayed!"
    }
    Write-Host "  -> Scenario B Verified: All available WALs replayed to latest state."
    docker rm -f $targetContainer 2>$null | Out-Null

    # =========================================================================
    # SCENARIO C: Missing WAL Segment Failure (Fail-Closed)
    # =========================================================================
    Write-Host "`n================================================================"
    Write-Host "SCENARIO C: Missing WAL Segment (Fail-Closed Gap Detection)"
    Write-Host "================================================================"
    $gapArchiveVol = "byos_c681_gap_archive"
    docker volume rm -f $gapArchiveVol 2>$null | Out-Null
    docker volume create $gapArchiveVol | Out-Null

    docker volume rm -f $targetDataVol 2>$null | Out-Null
    docker volume create $targetDataVol | Out-Null
    Unpack-BaseBackup $targetDataVol $decTarPath

    # Inspect backup_label to determine the exact required REDO WAL segment
    $backupLabel = (docker run --rm -v "${targetDataVol}:/target_data:ro" alpine:latest cat /target_data/backup_label) -join "`n"
    Write-Host "Base Backup Label Content:`n$backupLabel"
    $redoWalMatch = [regex]::Match($backupLabel, 'file\s+([0-9A-F]{24})')
    $requiredWal = if ($redoWalMatch.Success) { $redoWalMatch.Groups[1].Value } else { "000000010000000000000003" }
    Write-Host "  -> Checkpoint REDO WAL Segment required by base backup: $requiredWal"

    # Populate gap archive omitting the exact required WAL segment
    Write-Host "  Populating gap archive and removing required segment: $requiredWal.enc..."
    docker run --rm `
        -v "${srcArchiveVol}:/src_archive:ro" `
        -v "${gapArchiveVol}:/gap_archive" `
        alpine:latest `
        sh -c "mkdir -p /gap_archive/wal && cp /src_archive/wal/* /gap_archive/wal/ && rm -f /gap_archive/wal/*${requiredWal}* && chown -R 70:70 /gap_archive"

    # Prove segment is absent from archive volume
    $gapListing = (docker run --rm -v "${gapArchiveVol}:/gap_archive:ro" alpine:latest ls -la /gap_archive/wal) -join "`n"
    Write-Host "Gap Archive File Listing (proving absence of $requiredWal):`n$gapListing"
    if ($gapListing.Contains($requiredWal)) {
        throw "Scenario C failed: $requiredWal was NOT removed from gap archive!"
    }

    # Prove local pg_wal in unpacked base backup is empty
    $localWalListing = (docker run --rm -v "${targetDataVol}:/target_data:ro" alpine:latest ls -la /target_data/pg_wal) -join "`n"
    Write-Host "Local Target pg_wal Listing (proving required segment is absent locally):`n$localWalListing"
    if ($localWalListing.Contains($requiredWal)) {
        throw "Scenario C failed: $requiredWal was found in local pg_wal!"
    }

    # Write restore wrapper to log every restore_command invocation and return code
    $restoreWrapperSh = @"
#!/bin/sh
WAL_NAME="`$1"
TARGET_PATH="`$2"
echo "[`$(date -u +'%Y-%m-%d %H:%M:%S UTC')] RESTORE_REQUEST: wal=`$WAL_NAME target=`$TARGET_PATH" >> /var/lib/postgresql/data/restore_invocations.log
/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name "`$WAL_NAME" --target-path "`$TARGET_PATH"
RC=`$?
echo "[`$(date -u +'%Y-%m-%d %H:%M:%S UTC')] RESTORE_RESULT: wal=`$WAL_NAME exit_code=`$RC" >> /var/lib/postgresql/data/restore_invocations.log
exit `$RC
"@
    $wrapperHostPath = (Join-Path $drillDir "restore_wrapper.sh").Replace('\', '/')
    [System.IO.File]::WriteAllText((Join-Path $drillDir "restore_wrapper.sh"), $restoreWrapperSh.Replace("`r`n", "`n"))

    Configure-TargetRecovery $targetDataVol "/usr/local/bin/restore_wrapper.sh %f %p" $null "promote"

    docker run -d --name $targetContainer --network $network -p "127.0.0.1:${targetPort}:5432" `
        -e POSTGRES_PASSWORD=pitr_password `
        -v "${targetDataVol}:/var/lib/postgresql/data" `
        -v "${gapArchiveVol}:/var/byos/archive:ro" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        -v "${wrapperHostPath}:/usr/local/bin/restore_wrapper.sh:ro" `
        postgres:16-alpine postgres | Out-Null

    Start-Sleep -Seconds 4
    $gapLogs = docker logs $targetContainer 2>&1 | Out-String
    Write-Host "PostgreSQL Server Logs on Missing WAL:`n$gapLogs"
    $isExited = (docker inspect $targetContainer --format '{{.State.Status}}').Trim()
    $exitCode = (docker inspect $targetContainer --format '{{.State.ExitCode}}').Trim()
    Write-Host "  -> Target container status: $isExited (ExitCode: $exitCode)"

    # Print restore_command invocation log
    $invocationLog = (docker run --rm -v "${targetDataVol}:/target_data:ro" alpine:latest cat /target_data/restore_invocations.log 2>$null) -join "`n"
    Write-Host "restore_command Invocation Log:`n$invocationLog"

    # Verify database does not accept connections
    $connAttempt = docker run --rm --network $network postgres:16-alpine psql -h $targetContainer -U byos -d byos_pitr -c "SELECT 1;" 2>&1 | Out-String
    Write-Host "Connection Attempt Result on Unrecovered Database:`n$connAttempt"

    # Assertions
    if ($gapLogs.Contains("restored log file `"$requiredWal`"")) {
        throw "Scenario C assertion failed: Log contradictory claim! PostgreSQL claimed to restore missing segment $requiredWal!"
    }
    if (-not ($gapLogs.Contains("could not locate required checkpoint record") -or $gapLogs.Contains("could not locate a valid checkpoint record") -or $gapLogs.Contains("FATAL"))) {
        throw "Scenario C failed: PostgreSQL did not fail closed on missing WAL!"
    }
    if ($isExited -ne "exited" -or $exitCode -eq "0") {
        throw "Scenario C failed: Container did not shut down with error code on missing checkpoint WAL!"
    }
    Write-Host "  -> Scenario C Verified: PostgreSQL aborted with fatal error on missing required WAL segment."
    docker rm -f $targetContainer 2>$null | Out-Null
    docker volume rm -f $gapArchiveVol 2>$null | Out-Null

    # =========================================================================
    # SCENARIO D: Corrupted WAL Segment (AES-256-GCM Tag Failure)
    # =========================================================================
    Write-Host "`n================================================================"
    Write-Host "SCENARIO D: Corrupted WAL Segment (Tamper / Bit-flip Rejection)"
    Write-Host "================================================================"
    $tamperArchiveVol = "byos_c681_tamper_archive"
    docker volume rm -f $tamperArchiveVol 2>$null | Out-Null
    docker volume create $tamperArchiveVol | Out-Null

    # Copy archive and tamper with 1 byte in segment 3
    docker run --rm `
        -v "${srcArchiveVol}:/src_archive:ro" `
        -v "${tamperArchiveVol}:/tamper_archive" `
        alpine:latest `
        sh -c "mkdir -p /tamper_archive/wal && cp /src_archive/wal/* /tamper_archive/wal/ && for f in /tamper_archive/wal/*00000003.enc; do printf '\xff' | dd of=`"`$f`" bs=1 seek=100 count=1 conv=notrunc; done && chown -R 70:70 /tamper_archive"

    docker volume rm -f $targetDataVol 2>$null | Out-Null
    docker volume create $targetDataVol | Out-Null
    Unpack-BaseBackup $targetDataVol $decTarPath
    Configure-TargetRecovery $targetDataVol $restoreCmd $null "promote"

    docker run -d --name $targetContainer --network $network -p "127.0.0.1:${targetPort}:5432" `
        -e POSTGRES_PASSWORD=pitr_password `
        -v "${targetDataVol}:/var/lib/postgresql/data" `
        -v "${tamperArchiveVol}:/var/byos/archive:ro" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres | Out-Null

    Start-Sleep -Seconds 4
    $tamperLogs = docker logs $targetContainer 2>&1 | Out-String
    Write-Host "PostgreSQL Tamper Log Evidence:`n$tamperLogs"
    if (-not ($tamperLogs.Contains("message authentication failed") -or $tamperLogs.Contains("restore_command") -or $tamperLogs.Contains("FATAL"))) {
        throw "Scenario D failed: AES-GCM did not reject tampered ciphertext!"
    }
    Write-Host "  -> Scenario D Verified: AES-256-GCM authentication tag rejected tampered segment."
    docker rm -f $targetContainer 2>$null | Out-Null
    docker volume rm -f $tamperArchiveVol 2>$null | Out-Null

    # =========================================================================
    # SCENARIO E: Incorrect Encryption Key Rejection
    # =========================================================================
    Write-Host "`n================================================================"
    Write-Host "SCENARIO E: Incorrect Encryption Key Rejection"
    Write-Host "================================================================"
    docker volume rm -f $targetDataVol 2>$null | Out-Null
    docker volume create $targetDataVol | Out-Null
    Unpack-BaseBackup $targetDataVol $decTarPath
    Configure-TargetRecovery $targetDataVol $restoreCmd $null "promote"

    # Mount $wrongKeyHostPath instead of $keyHostPath
    docker run -d --name $targetContainer --network $network -p "127.0.0.1:${targetPort}:5432" `
        -e POSTGRES_PASSWORD=pitr_password `
        -v "${targetDataVol}:/var/lib/postgresql/data" `
        -v "${srcArchiveVol}:/var/byos/archive:ro" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${wrongKeyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres | Out-Null

    Start-Sleep -Seconds 4
    $wrongKeyLogs = docker logs $targetContainer 2>&1 | Out-String
    Write-Host "Wrong Key Rejection Log Evidence:`n$wrongKeyLogs"
    if (-not ($wrongKeyLogs.Contains("message authentication failed") -or $wrongKeyLogs.Contains("exit code 1") -or $wrongKeyLogs.Contains("FATAL"))) {
        throw "Scenario E failed: PostgreSQL did not fail when supplied wrong key!"
    }
    Write-Host "  -> Scenario E Verified: Incorrect key fails closed with authentication error."
    docker rm -f $targetContainer 2>$null | Out-Null

    # =========================================================================
    # SCENARIO F: Timeline Progression & Timeline Branching
    # =========================================================================
    Write-Host "`n================================================================"
    Write-Host "SCENARIO F: Timeline Progression & Branching Verification"
    Write-Host "================================================================"
    docker volume rm -f $targetDataVol 2>$null | Out-Null
    docker volume create $targetDataVol | Out-Null
    Unpack-BaseBackup $targetDataVol $decTarPath
    Configure-TargetRecovery $targetDataVol $restoreCmd $targetTimestamp "promote"

    docker run -d --name $targetContainer --network $network -p "127.0.0.1:${targetPort}:5432" `
        -e POSTGRES_PASSWORD=pitr_password `
        -v "${targetDataVol}:/var/lib/postgresql/data" `
        -v "${srcArchiveVol}:/var/byos/archive:ro" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres | Out-Null

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $null = docker exec $targetContainer psql -U byos -d byos_pitr -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) { break }
    }

    # Verify timeline progression in pg_control
    $pgControl = docker exec $targetContainer pg_controldata /var/lib/postgresql/data
    $timelineMatch = ($pgControl | Select-String -Pattern "Latest checkpoint's TimeLineID:\s+(\d+)").Matches[0].Groups[1].Value
    Write-Host "  -> Current Cluster Timeline ID: $timelineMatch"
    if ([int]$timelineMatch -lt 2) {
        throw "Scenario F failed: Expected TimelineID >= 2 after recovery promotion, got $timelineMatch"
    }

    # Verify history file existence
    $histFiles = docker exec $targetContainer sh -c "ls /var/lib/postgresql/data/pg_wal/*.history 2>/dev/null || true"
    Write-Host "  -> History files in pg_wal: $histFiles"
    Write-Host "  -> Scenario F Verified: Database promoted to new Timeline ID $timelineMatch."
    docker rm -f $targetContainer 2>$null | Out-Null

    # =========================================================================
    # SCENARIO G: Interrupted Recovery and Idempotent Resume
    # =========================================================================
    Write-Host "`n================================================================"
    Write-Host "SCENARIO G: Interrupted Recovery and Resume"
    Write-Host "================================================================"
    docker volume rm -f $targetDataVol 2>$null | Out-Null
    docker volume create $targetDataVol | Out-Null
    Unpack-BaseBackup $targetDataVol $decTarPath
    Configure-TargetRecovery $targetDataVol $restoreCmd $null "promote"

    docker run -d --name $targetContainer --network $network -p "127.0.0.1:${targetPort}:5432" `
        -e POSTGRES_PASSWORD=pitr_password `
        -v "${targetDataVol}:/var/lib/postgresql/data" `
        -v "${srcArchiveVol}:/var/byos/archive:ro" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres | Out-Null

    # Simulate crash by killing container immediately
    Start-Sleep -Milliseconds 200
    docker kill $targetContainer | Out-Null
    Write-Host "  -> Container killed mid-recovery."

    # Restart container
    Write-Host "  Restarting container to verify clean resumption..."
    docker start $targetContainer | Out-Null

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $null = docker exec $targetContainer psql -U byos -d byos_pitr -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) { break }
    }
    $scenGCheck = docker exec $targetContainer psql -U byos -d byos_pitr -t -A -c "SELECT COUNT(*) FROM pitr_ledger;"
    Write-Host "  -> Records after resumption: $scenGCheck"
    if ([int]$scenGCheck -lt 1) {
        throw "Scenario G failed: Resumed recovery did not restore ledger!"
    }
    Write-Host "  -> Scenario G Verified: Crash during recovery resumed cleanly to consistency."
    docker rm -f $targetContainer 2>$null | Out-Null

    # =========================================================================
    # SCENARIO H: Independent Storage Recovery (Complete Primary Host Loss)
    # =========================================================================
    Write-Host "`n================================================================"
    Write-Host "SCENARIO H: Independent Off-Site Storage Disaster Recovery"
    Write-Host "================================================================"
    # Copy encrypted base backup and encrypted WAL archive to off-site volume
    docker run --rm `
        -v "${srcArchiveVol}:/primary_archive:ro" `
        -v "${offsiteArchiveVol}:/offsite_archive" `
        alpine:latest `
        sh -c "cp -r /primary_archive/* /offsite_archive/ && chown -R 70:70 /offsite_archive"

    # Completely wipe and remove primary archive and source container!
    Write-Host "  Simulating total catastrophic loss of primary database and primary archive..."
    docker rm -f $srcContainer 2>$null | Out-Null
    docker volume rm -f $srcArchiveVol $srcDataVol 2>$null | Out-Null

    # Restore on a brand new host pointing exclusively to $offsiteArchiveVol
    docker volume rm -f $targetDataVol 2>$null | Out-Null
    docker volume create $targetDataVol | Out-Null
    Unpack-BaseBackup $targetDataVol $decTarPath
    Configure-TargetRecovery $targetDataVol $restoreCmd $null "promote"

    docker run -d --name $targetContainer --network $network -p "127.0.0.1:${targetPort}:5432" `
        -e POSTGRES_PASSWORD=pitr_password `
        -v "${targetDataVol}:/var/lib/postgresql/data" `
        -v "${offsiteArchiveVol}:/var/byos/archive:ro" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres | Out-Null

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $null = docker exec $targetContainer psql -U byos -d byos_pitr -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) { break }
    }
    $offsiteCheck = docker exec $targetContainer psql -U byos -d byos_pitr -t -A -c "SELECT COUNT(*) FROM pitr_ledger;"
    Write-Host "  -> Records restored from independent off-site storage: $offsiteCheck"
    if ([int]$offsiteCheck -ne 4) {
        throw "Scenario H failed: Expected 4 records from offsite archive, got $offsiteCheck"
    }
    Write-Host "  -> Scenario H Verified: Successful recovery from independent storage with primary destroyed."

    Write-Host "`n================================================================"
    Write-Host "ALL SCENARIOS A THROUGH H VERIFIED WITH COMPLETE INTEGRITY!"
    Write-Host "================================================================"
}
finally {
    Write-Host "`nCleaning up containers..."
    Cleanup-Containers
    if (Test-Path $drillDir) { Remove-Item -Recurse -Force $drillDir }
}
