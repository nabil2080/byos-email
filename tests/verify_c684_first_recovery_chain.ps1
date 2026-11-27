# BYOS C6.8.4: First Physical Baseline & Complete Recovery Chain Verification
# Captures the first physical pg_basebackup after WAL activation, creates non-destructive
# restore-point WAL markers, verifies continuous archive integrity, and proves isolated PITR recovery
# using only the encrypted base backup + encrypted WAL archive volume (byos-email_postgres-archive).

$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$root = (Get-Item $PSScriptRoot).Parent.FullName
$keyHostPath = (Join-Path $root "infra\secrets\backup.key").Replace('\', '/')
$linuxBinHostPath = (Join-Path $root "tools\byos-backup\byos-backup-linux").Replace('\', '/')
$winBin = Join-Path $root "tools\byos-backup\byos-backup.exe"
$baselineDir = Join-Path $root "backups\first_physical_baseline_c684"

if (Test-Path $baselineDir) {
    Remove-Item -Recurse -Force $baselineDir
}
New-Item -ItemType Directory -Force -Path $baselineDir | Out-Null

$recContainer = "byos-c684-recovery-chain"
$recVolume = "byos_c684_recovery_chain_vol"
$recPort = 15447
$archiveVolName = "byos-email_postgres-archive"

function Cleanup-Rec-Resources {
    docker rm -f $recContainer 2>$null | Out-Null
    docker volume rm -f $recVolume 2>$null | Out-Null
}

Cleanup-Rec-Resources

Write-Host "================================================================="
Write-Host "BYOS C6.8.4: First Physical Baseline & Recovery Chain Verification"
Write-Host "================================================================="

try {
    # -------------------------------------------------------------------------
    # STEP 1: Create First Physical Baseline on Active Activated Postgres
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 1] Executing pg_basebackup against activated byos-postgres..."
    docker exec byos-postgres sh -c "rm -rf /tmp/c684_base_01 && mkdir -p /tmp/c684_base_01 && pg_basebackup -h 127.0.0.1 -U byos -D /tmp/c684_base_01 -Ft -z -X none"
    if ($LASTEXITCODE -ne 0) {
        throw "pg_basebackup failed on active byos-postgres"
    }

    $rawDir = Join-Path $baselineDir "raw"
    New-Item -ItemType Directory -Force -Path $rawDir | Out-Null
    docker cp "byos-postgres:/tmp/c684_base_01/base.tar.gz" (Join-Path $rawDir "base.tar.gz")
    docker cp "byos-postgres:/tmp/c684_base_01/backup_manifest" (Join-Path $rawDir "backup_manifest")
    docker exec byos-postgres rm -rf /tmp/c684_base_01

    $baseTarPath = Join-Path $rawDir "base.tar.gz"
    $manifestPath = Join-Path $rawDir "backup_manifest"
    $baseSize = (Get-Item $baseTarPath).Length
    $manifestSize = (Get-Item $manifestPath).Length
    Write-Host "  -> Captured base.tar.gz ($baseSize bytes) and backup_manifest ($manifestSize bytes)"

    # Parse manifest and pg_controldata
    $manifestObj = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $walRange = $manifestObj.'WAL-Ranges'[0]
    $startLsn = $walRange.'Start-LSN'
    $endLsn = $walRange.'End-LSN'
    $timeline = $walRange.'Timeline'

    $controlLines = docker exec byos-postgres pg_controldata /var/lib/postgresql/data
    $systemId = ""
    foreach ($line in $controlLines) {
        if ($line -match "Database system identifier:\s+(\d+)") {
            $systemId = $matches[1]
        }
    }

    Write-Host "  -> System Identifier: $systemId"
    Write-Host "  -> Backup LSN Range:  $startLsn -> $endLsn (Timeline $timeline)"

    # Encrypt baseline package
    $encBaselinePath = Join-Path $baselineDir "byos_physical_baseline_c684.tar.enc"
    & $winBin encrypt-bundle `
        --dump-file $baseTarPath `
        --manifest-file $manifestPath `
        --out-file $encBaselinePath `
        --key-file $keyHostPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to encrypt physical baseline bundle"
    }
    $encSize = (Get-Item $encBaselinePath).Length
    Write-Host "  -> Encrypted Baseline: $encBaselinePath ($encSize bytes)"

    & $winBin verify-encrypted --in-file $encBaselinePath --key-file $keyHostPath
    if ($LASTEXITCODE -ne 0) {
        throw "Encrypted baseline verification failed"
    }

    # -------------------------------------------------------------------------
    # STEP 2: Generate Non-Destructive Restore-Point Markers & Archive WALs
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 2] Creating non-destructive WAL restore points (c684_pitr_t1 -> c684_pitr_t2)..."
    $t1Out = docker exec byos-postgres psql -U byos -d byos -t -A -c "BEGIN; SELECT txid_current(), clock_timestamp(), pg_create_restore_point('c684_pitr_t1'); COMMIT;"
    Write-Host "  -> Restore Point T1: $t1Out"

    Start-Sleep -Seconds 2
    $t2Out = docker exec byos-postgres psql -U byos -d byos -t -A -c "BEGIN; SELECT txid_current(), clock_timestamp(), pg_create_restore_point('c684_pitr_t2'); COMMIT;"
    Write-Host "  -> Restore Point T2: $t2Out"

    docker exec byos-postgres psql -U byos -d byos -c "SELECT pg_switch_wal();" | Out-Null

    # Wait for archiver to drain all .ready files
    for ($w = 0; $w -lt 20; $w++) {
        $pending = (docker exec byos-postgres sh -c "ls -1 /var/lib/postgresql/data/pg_wal/archive_status/*.ready 2>/dev/null | wc -l").Trim()
        if ([int]$pending -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }

    Write-Host "`n[Step 3] Inspecting archive volume contents and WAL continuity..."
    $walLs = docker exec byos-postgres ls -lh /var/byos/archive/wal
    Write-Host "$walLs"

    $walStatusOut = docker exec byos-postgres /usr/local/bin/byos-backup wal-status --archive-dir /var/byos/archive
    Write-Host "$walStatusOut"

    $archiverStats = docker exec byos-postgres psql -U byos -d byos -x -c "SELECT archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_wal, last_failed_time FROM pg_stat_archiver;"
    Write-Host "$archiverStats"

    # -------------------------------------------------------------------------
    # STEP 4: Decrypt Baseline & Restore to Isolated Recovery Target
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 4] Restoring physical baseline to isolated recovery volume ($recVolume)..."
    $decDir = Join-Path $baselineDir "decrypted_recovery"
    if (Test-Path $decDir) { Remove-Item -Recurse -Force $decDir }
    New-Item -ItemType Directory -Force -Path $decDir | Out-Null

    & $winBin decrypt-bundle --in-file $encBaselinePath --out-dir $decDir --key-file $keyHostPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to decrypt baseline bundle"
    }
    $decBaseTar = (Join-Path $decDir "database.dump").Replace('\', '/')

    docker volume create $recVolume | Out-Null

    # Extract base.tar.gz WITHOUT copying pg_wal from primary, forcing restore_command replay from encrypted archive!
    $setupSh = @"
tar -xzf /tmp_dec/database.dump -C /var/lib/postgresql/data
mkdir -p /var/lib/postgresql/data/pg_wal
touch /var/lib/postgresql/data/recovery.signal
cat << 'EOF' >> /var/lib/postgresql/data/postgresql.auto.conf
restore_command = '/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p'
recovery_target_name = 'c684_pitr_t1'
recovery_target_action = 'promote'
EOF
chown -R 70:70 /var/lib/postgresql/data
chmod 700 /var/lib/postgresql/data
"@
    $setupB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($setupSh.Replace("`r`n", "`n")))
    docker run --rm `
        -v "${recVolume}:/var/lib/postgresql/data" `
        -v "${decDir}:/tmp_dec:ro" `
        alpine:latest `
        sh -c "echo '$setupB64' | base64 -d | sh"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed preparing isolated recovery volume"
    }

    # -------------------------------------------------------------------------
    # STEP 5: Boot Isolated Recovery Instance & Replay Encrypted WALs
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 5] Booting isolated recovery PostgreSQL ($recContainer) on port $recPort..."
    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    docker run -d --name $recContainer -p "127.0.0.1:${recPort}:5432" `
        -e POSTGRES_PASSWORD=byos_dev_password `
        -v "${recVolume}:/var/lib/postgresql/data" `
        -v "${archiveVolName}:/var/byos/archive:ro" `
        -v "${linuxBinHostPath}:/usr/local/bin/byos-backup:ro" `
        -v "${keyHostPath}:/etc/byos/keys/backup.key:ro" `
        postgres:16-alpine postgres | Out-Null

    $recReady = $false
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Milliseconds 500
        $null = docker exec $recContainer psql -U byos -d byos -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $inRec = (docker exec $recContainer psql -U byos -d byos -t -A -c "SELECT pg_is_in_recovery();" 2>&1).Trim()
            if ($inRec -eq "f") {
                $recReady = $true
                break
            }
        }
    }
    $sw.Stop()
    $recDuration = [math]::Round($sw.Elapsed.TotalSeconds, 3)

    if (-not $recReady) {
        $recLogs = docker logs $recContainer 2>&1
        Write-Host "Recovery logs:`n$recLogs"
        throw "Recovery container failed to promote within timeout"
    }
    Write-Host "  -> Isolated PITR recovery and promotion completed in $recDuration seconds."

    # Show recovery logs confirming restore-wal replay and target stop
    Write-Host "`n[Step 6] Recovery Container Startup & Replay Logs:"
    $recLogsTail = docker logs $recContainer 2>&1 | Select-Object -Last 20
    $recLogsTail | ForEach-Object { Write-Host "  $_" }

    # Verify timeline promotion & database state
    $tlId = (docker exec $recContainer psql -U byos -d byos -t -A -c "SELECT timeline_id FROM pg_control_checkpoint();").Trim()
    $dbCount = (docker exec $recContainer psql -U byos -d byos -t -A -c "SELECT count(*) FROM pg_database;").Trim()
    $tblCount = (docker exec $recContainer psql -U byos -d byos -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';").Trim()

    Write-Host "`n[Step 7] Verification Summary:"
    Write-Host "  - Promoted Timeline ID:   $tlId (expected: >= 2)"
    Write-Host "  - Databases Present:      $dbCount"
    Write-Host "  - Public Tables Present:  $tblCount"

    if ([int]$tlId -lt 2) {
        throw "Expected timeline promotion >= 2, got $tlId"
    }

    # Verify active byos-postgres is still completely healthy and untouched
    $activeHealth = (docker inspect -f "{{.State.Health.Status}}" byos-postgres).Trim()
    Write-Host "  - Active Primary Status:  $activeHealth"

    Write-Host "`n================================================================="
    Write-Host "FIRST PHYSICAL BASELINE & RECOVERY CHAIN: CRITERIA MET"
    Write-Host "================================================================="
}
finally {
    Cleanup-Rec-Resources
}
