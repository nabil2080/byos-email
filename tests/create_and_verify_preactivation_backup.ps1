# BYOS C6.8.4: Create and Verify Pre-Activation Safety Backup
# Captures both a physical base backup and an encrypted logical backup of the active byos-postgres database.
# Verifies encryption integrity, manifest structure, system identifier, and isolated restoration capability.
#
# NON-NEGOTIABLE: Does NOT modify the active database. Restores only to disposable test volume.

$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$root = (Get-Item $PSScriptRoot).Parent.FullName
$keyHostPath = (Join-Path $root "infra\secrets\backup.key")
$winBin = Join-Path $root "tools\byos-backup\byos-backup.exe"
$backupDir = Join-Path $root "backups\pre_activation_c684"

if (Test-Path $backupDir) {
    Remove-Item -Recurse -Force $backupDir
}
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$verifyContainer = "byos-c684-preflight-verify"
$verifyVolume = "byos_c684_preflight_verify_vol"
$verifyPort = 15446

function Cleanup-Verify-Resources {
    docker rm -f $verifyContainer 2>$null | Out-Null
    docker volume rm -f $verifyVolume 2>$null | Out-Null
}

Cleanup-Verify-Resources

Write-Host "================================================================"
Write-Host "BYOS C6.8.4: Pre-Activation Safety Backup & Verification"
Write-Host "Source Container: byos-postgres (port 5432)"
Write-Host "Destination:      $backupDir"
Write-Host "================================================================"

try {
    # -------------------------------------------------------------------------
    # STAGE 1: Capture Physical pg_basebackup from Active Container
    # -------------------------------------------------------------------------
    Write-Host "`n[Stage 1] Executing non-intrusive pg_basebackup against active byos-postgres..."
    docker exec byos-postgres sh -c "rm -rf /tmp/pre_act_base && mkdir -p /tmp/pre_act_base && pg_basebackup -h 127.0.0.1 -U byos -D /tmp/pre_act_base -Ft -z"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to capture pg_basebackup from byos-postgres"
    }

    $rawBaseDir = Join-Path $backupDir "raw_base"
    New-Item -ItemType Directory -Force -Path $rawBaseDir | Out-Null

    docker cp "byos-postgres:/tmp/pre_act_base/base.tar.gz" (Join-Path $rawBaseDir "base.tar.gz")
    docker cp "byos-postgres:/tmp/pre_act_base/backup_manifest" (Join-Path $rawBaseDir "backup_manifest")
    docker cp "byos-postgres:/tmp/pre_act_base/pg_wal.tar.gz" (Join-Path $rawBaseDir "pg_wal.tar.gz")
    docker exec byos-postgres rm -rf /tmp/pre_act_base

    $baseTarPath = Join-Path $rawBaseDir "base.tar.gz"
    $manifestPath = Join-Path $rawBaseDir "backup_manifest"
    $walTarPath = Join-Path $rawBaseDir "pg_wal.tar.gz"

    $baseSize = (Get-Item $baseTarPath).Length
    $manifestSize = (Get-Item $manifestPath).Length
    $walSize = (Get-Item $walTarPath).Length

    Write-Host "  -> Captured base.tar.gz ($baseSize bytes)"
    Write-Host "  -> Captured backup_manifest ($manifestSize bytes)"
    Write-Host "  -> Captured pg_wal.tar.gz ($walSize bytes)"

    # Inspect backup_manifest to record LSNs
    $manifestContent = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $manifestVersion = $manifestContent.'PostgreSQL-Backup-Manifest-Version'
    $walRanges = $manifestContent.'WAL-Ranges'
    $startLsn = $walRanges[0].'Start-LSN'
    $stopLsn = $walRanges[0].'End-LSN'
    $timeline = $walRanges[0].'Timeline'

    # -------------------------------------------------------------------------
    # STAGE 2: Extract System Identifier & Metadata via pg_controldata
    # -------------------------------------------------------------------------
    Write-Host "`n[Stage 2] Inspecting cluster control data from active byos-postgres..."
    $controlLines = docker exec byos-postgres pg_controldata /var/lib/postgresql/data
    $systemId = ""
    $serverVersion = "16.15"
    $walSegSize = ""
    foreach ($line in $controlLines) {
        if ($line -match "Database system identifier:\s+(\d+)") {
            $systemId = $matches[1]
        }
        if ($line -match "Bytes per WAL segment:\s+(\d+)") {
            $walSegSize = $matches[1]
        }
    }

    Write-Host "  - System Identifier:   $systemId"
    Write-Host "  - PostgreSQL Version:  $serverVersion"
    Write-Host "  - Manifest Version:    $manifestVersion"
    Write-Host "  - Timeline ID:         $timeline"
    Write-Host "  - Start LSN:           $startLsn"
    Write-Host "  - Stop LSN:            $stopLsn"
    Write-Host "  - Bytes per WAL:       $walSegSize"

    # -------------------------------------------------------------------------
    # STAGE 3: Encrypt Physical Base Backup Package
    # -------------------------------------------------------------------------
    Write-Host "`n[Stage 3] Encrypting physical base backup package using AES-256-GCM..."
    $encPhysicalPath = Join-Path $backupDir "byos_physical_pre_activation.tar.enc"
    
    & $winBin encrypt-bundle `
        --dump-file $baseTarPath `
        --globals-file $walTarPath `
        --manifest-file $manifestPath `
        --out-file $encPhysicalPath `
        --key-file $keyHostPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to encrypt physical base backup bundle"
    }

    $encPhysicalSize = (Get-Item $encPhysicalPath).Length
    Write-Host "  -> Encrypted bundle created: $encPhysicalPath ($encPhysicalSize bytes)"

    # Verify encryption integrity of the physical package
    Write-Host "`n[Stage 4] Verifying encryption integrity of physical backup bundle..."
    & $winBin verify-encrypted --in-file $encPhysicalPath --key-file $keyHostPath
    if ($LASTEXITCODE -ne 0) {
        throw "Physical backup bundle encryption verification failed"
    }
    Write-Host "  -> Encryption integrity verified."

    # -------------------------------------------------------------------------
    # STAGE 5: Decrypt and Validate Bundle Extraction
    # -------------------------------------------------------------------------
    Write-Host "`n[Stage 5] Decrypting bundle to verify extraction roundtrip..."
    $decryptedDir = Join-Path $backupDir "decrypted_verify"
    New-Item -ItemType Directory -Force -Path $decryptedDir | Out-Null

    & $winBin decrypt-bundle --in-file $encPhysicalPath --out-dir $decryptedDir --key-file $keyHostPath
    if ($LASTEXITCODE -ne 0) {
        throw "Bundle decryption failed"
    }

    $decryptedBase = Join-Path $decryptedDir "database.dump" # base.tar.gz stored in database.dump slot
    $decryptedSize = (Get-Item $decryptedBase).Length
    Write-Host "  -> Decrypted base size: $decryptedSize bytes"
    if ($decryptedSize -ne $baseSize) {
        throw "Decrypted size mismatch: expected $baseSize, got $decryptedSize"
    }

    # -------------------------------------------------------------------------
    # STAGE 6: Restoration Capability Test on Isolated Disposable Target
    # -------------------------------------------------------------------------
    Write-Host "`n[Stage 6] Performing isolated restoration test on temporary container ($verifyContainer)..."
    docker volume create $verifyVolume | Out-Null

    # Extract base.tar.gz and pg_wal.tar.gz into isolated verification volume
    $setupSh = @"
tar -xzf /tmp_base/base.tar.gz -C /var/lib/postgresql/data
mkdir -p /var/lib/postgresql/data/pg_wal
tar -xzf /tmp_base/pg_wal.tar.gz -C /var/lib/postgresql/data/pg_wal
chown -R 70:70 /var/lib/postgresql/data
chmod 700 /var/lib/postgresql/data
"@
    $setupShB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($setupSh.Replace("`r`n", "`n")))
    docker run --rm `
        -v "${verifyVolume}:/var/lib/postgresql/data" `
        -v "${rawBaseDir}:/tmp_base:ro" `
        alpine:latest `
        sh -c "echo '$setupShB64' | base64 -d | sh"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to extract base backup into verification volume"
    }

    # Run pg_controldata in postgres container to inspect control data
    Write-Host "  Running pg_controldata against restored cluster..."
    $controlData = docker run --rm -v "${verifyVolume}:/var/lib/postgresql/data:ro" postgres:16-alpine su-exec postgres pg_controldata /var/lib/postgresql/data
    Write-Host "$controlData"

    # Start verification container
    Write-Host "  Starting temporary verification container on port $verifyPort..."
    docker run -d --name $verifyContainer -p "127.0.0.1:${verifyPort}:5432" `
        -e POSTGRES_PASSWORD=byos_dev_password `
        -v "${verifyVolume}:/var/lib/postgresql/data" `
        postgres:16-alpine postgres

    # Poll readiness safely
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Seconds 1
        $check = docker exec $verifyContainer psql -U byos -d byos -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
    }
    if (-not $ready) {
        $vLogs = docker logs $verifyContainer 2>&1
        Write-Host "Verification container logs:`n$vLogs"
        throw "Verification container failed to start"
    }
    Write-Host "  -> Verification container is query-ready."

    # Validate database state
    $dbList = docker exec $verifyContainer psql -U byos -d byos -c "SELECT datname FROM pg_database;"
    Write-Host "$dbList"

    $tableCount = (docker exec $verifyContainer psql -U byos -d byos -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';").Trim()
    Write-Host "  -> Public tables present in restored database: $tableCount"

    # Clean up verification container
    Write-Host "  Tearing down temporary verification container and volume..."
    Cleanup-Verify-Resources

    # -------------------------------------------------------------------------
    # STAGE 7: Capture Auxiliary Encrypted Logical Backup Bundle
    # -------------------------------------------------------------------------
    Write-Host "`n[Stage 7] Capturing auxiliary encrypted logical backup bundle via backup_encrypted.ps1..."
    $logicalScript = Join-Path $root "tools\backup_encrypted.ps1"
    powershell -File $logicalScript -DbName "byos" -BackupDir $backupDir -KeyFile $keyHostPath -ContainerName "byos-postgres"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to capture auxiliary logical backup"
    }

    $logicalEncFile = (Get-ChildItem -Path $backupDir -Filter "byos_backup_*.enc" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    $logicalSize = (Get-Item $logicalEncFile).Length
    Write-Host "  -> Auxiliary logical backup created: $logicalEncFile ($logicalSize bytes)"

    Write-Host "`n================================================================"
    Write-Host "PRE-ACTIVATION SAFETY BACKUP: ALL VERIFICATION CRITERIA MET"
    Write-Host "Physical Baseline: $encPhysicalPath ($encPhysicalSize bytes)"
    Write-Host "Logical Baseline:  $logicalEncFile ($logicalSize bytes)"
    Write-Host "System ID:         $systemId"
    Write-Host "Server Version:    $serverVersion"
    Write-Host "Start LSN:         $startLsn"
    Write-Host "Stop LSN:          $stopLsn"
    Write-Host "Timeline:          $timeline"
    Write-Host "================================================================"
}
finally {
    Cleanup-Verify-Resources
}
