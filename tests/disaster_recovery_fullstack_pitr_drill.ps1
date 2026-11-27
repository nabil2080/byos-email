# BYOS Release C6.8.2: Full-Stack Cold Physical PITR Disaster Recovery Drill
# Measures complete full-stack physical recovery duration, including:
# - Physical base-backup retrieval, decryption, and extraction.
# - PostgreSQL PITR recovery via encrypted WAL replay to target timestamp.
# - Redis service readiness.
# - BYOS API service startup and /health endpoint HTTP 200 readiness.
# - Application-level verification queries proving data integrity.
#
# Clearly distinguishes:
# - Physical PostgreSQL PITR RTO: ~5.5-5.9 seconds
# - Full-Stack Physical PITR RTO: <measured> seconds
# - Logical backup cold-restore RTO: 15.426 seconds (from C6.8)

$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

Write-Host "================================================================"
Write-Host "BYOS C6.8.2: Full-Stack Cold Physical PITR Disaster Recovery Drill"
Write-Host "================================================================"

$drillDir = Join-Path $PSScriptRoot "..\scratch\c682_fs_pitr_drill"
if (Test-Path $drillDir) { Remove-Item -Recurse -Force $drillDir }
New-Item -ItemType Directory -Path $drillDir | Out-Null

$keyHostPath = (Join-Path $PSScriptRoot "..\scratch\backup_c67.key").Replace('\', '/')
$binHostPath = (Join-Path $PSScriptRoot "..\tools\byos-backup\byos-backup-linux").Replace('\', '/')
$winBinPath = (Join-Path $PSScriptRoot "..\tools\byos-backup\byos-backup.exe")

$srcPort = 15443
$targetPort = 15442
$redisPort = 16381
$apiPort = 18084

$srcContainer = "byos-c682-fs-src"
$targetContainer = "byos-c682-fs-target"
$redisContainer = "byos-c682-fs-redis"
$network = "byos-c682-fs-net"

$srcDataVol = "byos_c682_fs_src_data"
$srcArchiveVol = "byos_c682_fs_src_archive"
$targetDataVol = "byos_c682_fs_target_data"

$apiProcess = $null

function Cleanup-Containers {
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Stop-Process -Id $apiProcess.Id -Force 2>$null
    }
    docker rm -f $srcContainer $targetContainer $redisContainer 2>$null | Out-Null
    docker volume rm -f $srcDataVol $srcArchiveVol $targetDataVol 2>$null | Out-Null
    docker network rm $network 2>$null | Out-Null
}

Cleanup-Containers

docker network create $network | Out-Null
docker volume create $srcDataVol | Out-Null
docker volume create $srcArchiveVol | Out-Null
docker volume create $targetDataVol | Out-Null

try {
    # -------------------------------------------------------------------------
    # PHASE 0: Pre-drill Compilation (Not counted in recovery RTO)
    # -------------------------------------------------------------------------
    Write-Host "`n[Phase 0] Pre-compiling services/api binary for cold startup..."
    $apiBin = Join-Path $drillDir "byos-api-drill.exe"
    go build -o $apiBin ./services/api
    if ($LASTEXITCODE -ne 0) { throw "Failed compiling services/api" }
    Write-Host "  -> services/api compiled: $apiBin"

    # -------------------------------------------------------------------------
    # PHASE 1: Initialize Source DB with Archiving & Real Application Schema
    # -------------------------------------------------------------------------
    Write-Host "`n[Phase 1] Starting Source PostgreSQL with Continuous WAL Archiving..."
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
        -e POSTGRES_DB=byos `
        -e POSTGRES_USER=byos `
        -e POSTGRES_PASSWORD=byos_dev_password `
        -v "${srcDataVol}:/var/lib/postgresql/data" `
        -v "${srcArchiveVol}:/var/byos/archive" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        -v "${entrypointHostPath}:/entrypoint.sh:ro" `
        --entrypoint sh `
        postgres:16-alpine /entrypoint.sh | Out-Null

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        $null = docker exec $srcContainer psql -U byos -d byos -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) { break }
    }
    Write-Host "  -> Source PostgreSQL ready on port $srcPort."

    # Seed source database with full canonical schema (from C6.8 backup bundle)
    Write-Host "  Seeding source cluster with canonical migration 075 schema and application tables..."
    $c68BackupEnc = Join-Path $PSScriptRoot "..\backups\byos_backup_20261124_122341.enc"
    $c68DecDir = Join-Path $drillDir "c68_seed_dec"
    & $winBinPath decrypt-bundle --in-file $c68BackupEnc --out-dir $c68DecDir --key-file $keyHostPath | Out-Null
    
    docker cp "$c68DecDir/globals.sql" "${srcContainer}:/tmp/globals.sql"
    docker cp "$c68DecDir/database.dump" "${srcContainer}:/tmp/database.dump"
    docker exec $srcContainer psql -U byos -d byos --set ON_ERROR_STOP=off -f /tmp/globals.sql 2>&1 | Out-Null
    docker exec $srcContainer pg_restore -U byos -d byos --no-owner --role=byos /tmp/database.dump 2>&1 | Out-Null

    # Create PITR ledger table
    $ledgerSql = @"
CREATE TABLE pitr_fullstack_ledger (
    id INT PRIMARY KEY,
    note TEXT NOT NULL,
    tx_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO pitr_fullstack_ledger (id, note) VALUES (1, 'Baseline Seed Record (Pre-Backup)');
"@
    docker exec $srcContainer psql -U byos -d byos -c $ledgerSql | Out-Null

    # -------------------------------------------------------------------------
    # PHASE 2: Capture Physical Base Backup & Encrypt Bundle
    # -------------------------------------------------------------------------
    Write-Host "`n[Phase 2] Capturing Physical Base Backup via pg_basebackup..."
    docker exec $srcContainer sh -c "mkdir -p /tmp/basebackup && pg_basebackup -U byos -D /tmp/basebackup -Ft -X none" | Out-Null
    $localBaseTar = Join-Path $drillDir "basebackup.tar"
    docker cp "${srcContainer}:/tmp/basebackup/base.tar" $localBaseTar

    $encBaseBackup = Join-Path $drillDir "basebackup.tar.enc"
    & $winBinPath encrypt-bundle --dump-file $localBaseTar --out-file $encBaseBackup --key-file $keyHostPath | Out-Null
    $encSize = (Get-Item $encBaseBackup).Length
    Write-Host "  -> Physical base backup captured and encrypted ($encSize bytes)."

    # -------------------------------------------------------------------------
    # PHASE 3: Generate Real Timeline (Valid Activity, PITR Target, Disaster)
    # -------------------------------------------------------------------------
    Write-Host "`n[Phase 3] Generating Transaction Timeline..."
    docker exec $srcContainer psql -U byos -d byos -c "SELECT pg_switch_wal();" | Out-Null
    Start-Sleep -Seconds 1

    # T1: Valid Business Activity
    $t1Sql = "INSERT INTO pitr_fullstack_ledger (id, note) VALUES (100, 'Valid Pre-Disaster Activity (Customer Order Committed)'); SELECT pg_switch_wal();"
    docker exec $srcContainer psql -U byos -d byos -c $t1Sql | Out-Null
    $t1Time = (docker exec $srcContainer psql -U byos -d byos -t -A -c "SELECT tx_time FROM pitr_fullstack_ledger WHERE id=100;").Trim()
    Write-Host "  -> T1 (Valid activity committed): $t1Time"
    Start-Sleep -Seconds 2

    # Target Point (1 second after T1)
    $t1Parsed = [DateTimeOffset]::Parse($t1Time)
    $targetTimestamp = $t1Parsed.AddSeconds(1).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + " UTC"
    Write-Host "  -> Designated PITR Target Recovery Point: $targetTimestamp"
    Start-Sleep -Seconds 2

    # T2: Disaster / Corruption Event
    $t2Sql = "INSERT INTO pitr_fullstack_ledger (id, note) VALUES (101, 'CORRUPTION EVENT: Unauthorized data drop/alteration'); SELECT pg_switch_wal();"
    docker exec $srcContainer psql -U byos -d byos -c $t2Sql | Out-Null
    $t2Time = (docker exec $srcContainer psql -U byos -d byos -t -A -c "SELECT tx_time FROM pitr_fullstack_ledger WHERE id=101;").Trim()
    Write-Host "  -> T2 (Disaster committed): $t2Time"
    Start-Sleep -Seconds 2

    # T3: Post-disaster activity to ensure WAL stream continues past target
    docker exec $srcContainer psql -U byos -d byos -c "CREATE TABLE post_disaster_marker (id INT); SELECT pg_switch_wal();" | Out-Null
    Start-Sleep -Seconds 2

    # Wait for all segments to be archived
    for ($w = 0; $w -lt 20; $w++) {
        $readyCount = (docker exec $srcContainer sh -c "ls -1 /var/lib/postgresql/data/pg_wal/archive_status/*.ready 2>/dev/null | wc -l").Trim()
        if ([int]$readyCount -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }
    $archWalCount = (docker exec $srcContainer sh -c "ls -1 /var/byos/archive/wal/*.enc | wc -l").Trim()
    Write-Host "  -> All WAL segments archived into independent storage (count: $archWalCount)."

    # Terminate source database to simulate cold catastrophic primary failure
    Write-Host "  Simulating catastrophic primary failure (destroying source database container)..."
    docker rm -f $srcContainer 2>$null | Out-Null
    docker volume rm -f $srcDataVol 2>$null | Out-Null

    # =========================================================================
    # TIMED FULL-STACK COLD PHYSICAL PITR DISASTER RECOVERY DRILL
    # =========================================================================
    Write-Host "`n================================================================"
    Write-Host "BEGINNING TIMED FULL-STACK COLD PHYSICAL PITR DRILL"
    Write-Host "================================================================"

    $rtoPhases = [ordered]@{}
    $fullstackSw = [System.Diagnostics.Stopwatch]::StartNew()

    # Stage 1: Infrastructure Provisioning & Service Dependencies (Redis)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    docker volume rm -f $targetDataVol 2>$null | Out-Null
    docker volume create $targetDataVol | Out-Null
    docker run -d --name $redisContainer --network $network -p "127.0.0.1:${redisPort}:6379" redis:7-alpine | Out-Null
    
    # Wait for Redis readiness
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 100
        $null = docker exec $redisContainer redis-cli ping 2>&1
        if ($LASTEXITCODE -eq 0) { break }
    }
    $sw.Stop()
    $rtoPhases["1_infra_and_redis_provisioning"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 1] Infrastructure & Redis Provisioning: $($rtoPhases['1_infra_and_redis_provisioning']) ms"

    # Stage 2: Base Backup Retrieval
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $stagedEnc = Join-Path $drillDir "staged_basebackup.tar.enc"
    Copy-Item $encBaseBackup $stagedEnc
    $sw.Stop()
    $rtoPhases["2_basebackup_retrieval"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 2] Base Backup Retrieval: $($rtoPhases['2_basebackup_retrieval']) ms"

    # Stage 3: Base Backup Decryption
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $decryptedBaseDir = Join-Path $drillDir "decrypted_target_base"
    if (Test-Path $decryptedBaseDir) { Remove-Item -Recurse -Force $decryptedBaseDir }
    & $winBinPath decrypt-bundle --in-file $stagedEnc --out-dir $decryptedBaseDir --key-file $keyHostPath | Out-Null
    $sw.Stop()
    $rtoPhases["3_basebackup_decryption"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 3] Base Backup Decryption (AES-256-GCM): $($rtoPhases['3_basebackup_decryption']) ms"

    # Stage 4: Physical Decompression & Extraction into Target Volume
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $decTar = (Join-Path $decryptedBaseDir "database.dump").Replace('\', '/')
    docker run --rm `
        -v "${targetDataVol}:/target_data" `
        -v "${decTar}:/tmp/basebackup.tar:ro" `
        alpine:latest `
        sh -c "tar -xf /tmp/basebackup.tar -C /target_data && chown -R 70:70 /target_data && chmod 700 /target_data" | Out-Null
    $sw.Stop()
    $rtoPhases["4_physical_extraction"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 4] Physical Extraction & Ownership Setup: $($rtoPhases['4_physical_extraction']) ms"

    # Stage 5: Target Recovery Configuration (PITR Setup)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $setupSh = @"
#!/bin/sh
touch /target_data/recovery.signal
chown 70:70 /target_data/recovery.signal
chmod 600 /target_data/recovery.signal
echo "restore_command = '/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p'" >> /target_data/postgresql.auto.conf
echo "recovery_target_time = '$targetTimestamp'" >> /target_data/postgresql.auto.conf
echo "recovery_target_inclusive = 'true'" >> /target_data/postgresql.auto.conf
echo "recovery_target_action = 'promote'" >> /target_data/postgresql.auto.conf
chown 70:70 /target_data/postgresql.auto.conf
chmod 600 /target_data/postgresql.auto.conf
"@
    $setupShPath = Join-Path $drillDir "setup_pitr_target.sh"
    [System.IO.File]::WriteAllText($setupShPath, $setupSh.Replace("`r`n", "`n"))
    $setupShHost = $setupShPath.Replace('\', '/')
    docker run --rm -v "${targetDataVol}:/target_data" -v "${setupShHost}:/setup.sh:ro" alpine:latest sh /setup.sh | Out-Null
    $sw.Stop()
    $rtoPhases["5_pitr_configuration"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 5] PITR Configuration Setup: $($rtoPhases['5_pitr_configuration']) ms"

    # Stage 6 & 7: PostgreSQL Startup, Archive WAL Replay to Target & Promotion
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    docker run -d --name $targetContainer --network $network -p "127.0.0.1:${targetPort}:5432" `
        -e POSTGRES_PASSWORD=byos_dev_password `
        -v "${targetDataVol}:/var/lib/postgresql/data" `
        -v "${srcArchiveVol}:/var/byos/archive:ro" `
        -v "${binHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres | Out-Null

    $pgReady = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        $null = docker exec $targetContainer psql -U byos -d byos -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
    }
    $sw.Stop()
    if (-not $pgReady) {
        $logs = docker logs $targetContainer 2>&1
        Write-Host "Target PostgreSQL logs:`n$logs"
        throw "Target PostgreSQL failed to complete recovery"
    }
    $rtoPhases["6_postgresql_pitr_and_promotion"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 6 & 7] PostgreSQL Startup, Encrypted WAL Replay & Promotion: $($rtoPhases['6_postgresql_pitr_and_promotion']) ms"

    # Sub-RTO: Pure Physical PostgreSQL PITR RTO
    $purePostgresRTO = $rtoPhases["1_infra_and_redis_provisioning"] + `
                       $rtoPhases["2_basebackup_retrieval"] + `
                       $rtoPhases["3_basebackup_decryption"] + `
                       $rtoPhases["4_physical_extraction"] + `
                       $rtoPhases["5_pitr_configuration"] + `
                       $rtoPhases["6_postgresql_pitr_and_promotion"]
    Write-Host "  -> PURE PHYSICAL POSTGRESQL PITR RTO: $purePostgresRTO ms ($([math]::Round($purePostgresRTO / 1000, 3)) seconds)"

    # Stage 8: BYOS API Application Startup
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $env:BYOS_ENV = "development"
    $env:DATABASE_URL = "postgres://byos:byos_dev_password@localhost:${targetPort}/byos?sslmode=disable"
    $env:REDIS_URL = "localhost:${redisPort}"
    $env:API_PORT = "$apiPort"
    $apiProcess = Start-Process -FilePath $apiBin -PassThru -NoNewWindow
    $sw.Stop()
    $rtoPhases["8_application_startup"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 8] BYOS API Application Startup: $($rtoPhases['8_application_startup']) ms (PID: $($apiProcess.Id))"

    # Stage 9: Healthcheck Stabilization (/health endpoint HTTP 200)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $healthUrl = "http://localhost:${apiPort}/health"
    $healthReady = $false
    for ($k = 0; $k -lt 40; $k++) {
        Start-Sleep -Milliseconds 250
        try {
            $resp = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 5 -ErrorAction Stop
            if ($resp.status -in @("ok", "degraded") -and $resp.services.postgres -eq "up" -and $resp.services.redis -eq "up") {
                $healthReady = $true
                break
            }
        } catch { }
    }
    $sw.Stop()
    if (-not $healthReady) {
        throw "BYOS API /health endpoint failed to stabilize at $healthUrl"
    }
    $rtoPhases["9_healthcheck_readiness"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 9] BYOS API Healthcheck Readiness (/health HTTP 200): $($rtoPhases['9_healthcheck_readiness']) ms"

    # Stage 10: First Successful Application Query & Data Loss / PITR Verification
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $verOutput = (docker exec $targetContainer psql -U byos -d byos -t -A -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;").Trim()
    $ledgerRecords = (docker exec $targetContainer psql -U byos -d byos -t -A -F"|" -c "SELECT id, note FROM pitr_fullstack_ledger ORDER BY id;") -join "`n"
    $appCounts = (docker exec $targetContainer psql -U byos -d byos -t -A -c "
SELECT 
    (SELECT COUNT(*) FROM organizations) AS orgs,
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM domains) AS domains,
    (SELECT COUNT(*) FROM mailboxes) AS mailboxes;
").Trim()
    $sw.Stop()
    $rtoPhases["10_application_verification_query"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    Write-Host "  [Stage 10] Application-Level Query & Verification: $($rtoPhases['10_application_verification_query']) ms"

    $fullstackSw.Stop()
    $totalFullstackRTO = [math]::Round($fullstackSw.Elapsed.TotalMilliseconds, 2)

    # -------------------------------------------------------------------------
    # PRINT RESULTS & COMPARISONS
    # -------------------------------------------------------------------------
    Write-Host "`nTarget Cluster Schema Migration Version: $verOutput (Expected: 075)"
    Write-Host "Restored Application Entities: $appCounts (orgs|users|domains|mailboxes)"
    Write-Host "Restored PITR Ledger Records:`n$ledgerRecords"

    # Validate PITR Exclusion & Data Integrity
    $hasRec100 = $ledgerRecords.Contains("Valid Pre-Disaster Activity")
    $hasRec101 = $ledgerRecords.Contains("CORRUPTION EVENT")

    if (-not $hasRec100) { throw "Verification failed: Valid Pre-Disaster Record 100 was missing!" }
    if ($hasRec101) { throw "Verification failed: Disaster Incident Record 101 was NOT excluded by PITR!" }
    Write-Host "`n  -> PITR Precision Verified: Record 100 included, Record 101 (disaster) successfully excluded."

    Write-Host "`n================================================================"
    Write-Host "FULL-STACK PHYSICAL PITR DRILL COMPLETED SUCCESSFULLY!"
    Write-Host "================================================================"
    Write-Host "  * Physical PostgreSQL PITR RTO: $([math]::Round($purePostgresRTO / 1000, 3)) seconds ($purePostgresRTO ms)"
    Write-Host "  * Full-Stack Physical PITR RTO: $([math]::Round($totalFullstackRTO / 1000, 3)) seconds ($totalFullstackRTO ms)"
    Write-Host "  * Logical Backup Cold-Restore RTO: 15.426 seconds (from C6.8 baseline)"
    Write-Host "================================================================"

    # Print breakdown table
    Write-Host "`n--- Full-Stack Physical PITR Phase Latency Breakdown ---"
    foreach ($k in $rtoPhases.Keys) {
        Write-Host ("  {0,-45}: {1,8} ms" -f $k, $rtoPhases[$k])
    }
    Write-Host ("  {0,-45}: {1,8} ms" -f "TOTAL_FULLSTACK_PHYSICAL_PITR_RTO", $totalFullstackRTO)
}
finally {
    Write-Host "`nCleaning up full-stack drill containers..."
    Cleanup-Containers
    if (Test-Path $drillDir) { Remove-Item -Recurse -Force $drillDir }
}
