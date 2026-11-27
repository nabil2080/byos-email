# BYOS Release C6.8.1: Actual Deployment WAL Archiving Integration Test
# Validates PostgreSQL configuration, persistent archiving, container recreation,
# restore command accuracy, and byte-for-byte fidelity against original WAL segments.

$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

Write-Host "=================================================="
Write-Host "BYOS C6.8.1: Deployment WAL Archiving Integration"
Write-Host "=================================================="

$composeFile = Join-Path $PSScriptRoot "..\infra\docker-compose.c681-disposable.yml"
$projectName = "byos-c681-deploy"
$port = 15436
$keyHostPath = (Join-Path $PSScriptRoot "..\scratch\backup_c67.key").Replace('\', '/')
$binHostPath = (Join-Path $PSScriptRoot "..\tools\byos-backup\byos-backup-linux").Replace('\', '/')

if (-not (Test-Path $keyHostPath)) {
    throw "Missing test key: $keyHostPath"
}
if (-not (Test-Path $binHostPath)) {
    throw "Missing Linux binary: $binHostPath"
}

# 1. Generate Disposable Docker Compose specification
$composeContent = @"
name: $projectName

services:
  postgres:
    image: postgres:16-alpine
    container_name: byos-c681-deploy-test-pg
    environment:
      POSTGRES_DB: byos_deploy_test
      POSTGRES_USER: byos
      POSTGRES_PASSWORD: byos_deploy_password
    ports:
      - "127.0.0.1:${port}:5432"
    entrypoint:
      - "sh"
      - "-c"
      - "mkdir -p /var/byos/archive && chown -R postgres:postgres /var/byos/archive && chmod 700 /var/byos/archive && exec docker-entrypoint.sh postgres -c wal_level=replica -c archive_mode=on -c \"archive_command=/usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key\" -c archive_timeout=300"
    volumes:
      - c681_deploy_pg_data:/var/lib/postgresql/data
      - c681_deploy_wal_archive:/var/byos/archive
      - "${binHostPath}:/usr/local/bin/byos-backup:ro"
      - "${keyHostPath}:/etc/byos/keys/backup.key:ro"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U byos -d byos_deploy_test"]
      interval: 3s
      timeout: 3s
      retries: 20

volumes:
  c681_deploy_pg_data:
  c681_deploy_wal_archive:
"@

Set-Content -Path $composeFile -Value $composeContent -Encoding utf8

# Cleanup any previous runs
docker compose -f $composeFile -p $projectName down -v 2>$null | Out-Null

try {
    Write-Host "`n[Step 1] Starting PostgreSQL via Compose with C6.8 Archiving Configuration..."
    docker compose -f $composeFile -p $projectName up -d

    # Wait for readiness (genuine query readiness, not just init phase)
    $ready = $false
    $maxAttempts = 45
    $attempt = 0
    while ($attempt -lt $maxAttempts) {
        Start-Sleep -Seconds 1
        $check = docker exec byos-c681-deploy-test-pg psql -U byos -d byos_deploy_test -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
        $attempt++
    }
    if (-not $ready) {
        $logs = docker logs byos-c681-deploy-test-pg 2>&1
        Write-Host "PostgreSQL container logs on failure:`n$logs"
        throw "PostgreSQL container failed to become ready"
    }
    Write-Host "  -> PostgreSQL is ready on port $port."

    Write-Host "`n[Step 2] Verifying Effective PostgreSQL Archiving Configuration..."
    $configQuery = @"
SELECT name, setting FROM pg_settings 
WHERE name IN ('wal_level', 'archive_mode', 'archive_command', 'archive_timeout');
"@
    $settings = docker exec byos-c681-deploy-test-pg psql -U byos -d byos_deploy_test -t -A -F"=" -c $configQuery
    Write-Host "Effective PostgreSQL Settings:"
    $settingsDict = @{}
    foreach ($line in $settings.Trim().Split("`n")) {
        $p = $line.Trim().Split("=")
        if ($p.Length -ge 2) {
            $settingsDict[$p[0]] = $p[1]
            Write-Host "  - $($p[0]) = $($p[1])"
        }
    }

    if ($settingsDict["wal_level"] -ne "replica") {
        throw "Expected wal_level=replica, got $($settingsDict['wal_level'])"
    }
    if ($settingsDict["archive_mode"] -ne "on") {
        throw "Expected archive_mode=on, got $($settingsDict['archive_mode'])"
    }
    if (-not $settingsDict["archive_command"].Contains("byos-backup archive-wal")) {
        throw "archive_command does not invoke byos-backup: $($settingsDict['archive_command'])"
    }

    Write-Host "`n[Step 3] Generating Transactions & Forcing WAL Segment Switches..."
    $seedSql = @"
CREATE TABLE deploy_audit (
    id SERIAL PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO deploy_audit (payload) VALUES ('Transaction Set 1 - Initial Deployment Baseline');
SELECT pg_switch_wal();
INSERT INTO deploy_audit (payload) VALUES ('Transaction Set 2 - Post-Switch Activity');
SELECT pg_switch_wal();
"@
    docker exec byos-c681-deploy-test-pg psql -U byos -d byos_deploy_test -c $seedSql | Out-Null
    Start-Sleep -Seconds 2

    Write-Host "`n[Step 4] Checking Archived Objects in Archive Volume..."
    $archiveFiles = docker exec byos-c681-deploy-test-pg ls -lh /var/byos/archive/wal
    Write-Host "$archiveFiles"

    $encCount = (docker exec byos-c681-deploy-test-pg sh -c "ls -1 /var/byos/archive/wal/*.enc | wc -l").Trim()
    Write-Host "  -> Encrypted WAL count in archive: $encCount"
    if ([int]$encCount -lt 2) {
        throw "Expected at least 2 archived WAL segments, found $encCount"
    }

    Write-Host "`n[Step 5] Checking pg_stat_archiver Metrics..."
    $archiverStats = docker exec byos-c681-deploy-test-pg psql -U byos -d byos_deploy_test -x -c "SELECT * FROM pg_stat_archiver;"
    Write-Host "$archiverStats"

    $failedCount = (docker exec byos-c681-deploy-test-pg psql -U byos -d byos_deploy_test -t -A -c "SELECT failed_count FROM pg_stat_archiver;").Trim()
    $archivedCount = (docker exec byos-c681-deploy-test-pg psql -U byos -d byos_deploy_test -t -A -c "SELECT archived_count FROM pg_stat_archiver;").Trim()
    if ([int]$failedCount -ne 0) {
        throw "pg_stat_archiver reports $failedCount failed archive attempts!"
    }
    if ([int]$archivedCount -lt 2) {
        throw "pg_stat_archiver reports only $archivedCount archived segments (expected >= 2)"
    }
    Write-Host "  -> Confirmed: $archivedCount segments archived successfully with 0 failures."

    Write-Host "`n[Step 6] Testing Container Recreation & Volume Persistence..."
    Write-Host "  Stopping container..."
    docker compose -f $composeFile -p $projectName stop postgres | Out-Null
    Write-Host "  Removing container (retaining volumes)..."
    docker compose -f $composeFile -p $projectName rm -f postgres | Out-Null
    Write-Host "  Recreating container..."
    docker compose -f $composeFile -p $projectName up -d postgres

    # Wait for recreation readiness
    $readyRecreated = $false
    $attempt = 0
    while ($attempt -lt 30) {
        Start-Sleep -Seconds 1
        $null = docker exec byos-c681-deploy-test-pg psql -U byos -d byos_deploy_test -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $readyRecreated = $true
            break
        }
        $attempt++
    }
    if (-not $readyRecreated) {
        throw "Recreated PostgreSQL container failed to accept connections"
    }
    Write-Host "  -> Recreated container is ready."

    $persistedCount = (docker exec byos-c681-deploy-test-pg sh -c "ls -1 /var/byos/archive/wal/*.enc | wc -l").Trim()
    Write-Host "  -> Archived WAL count after container recreation: $persistedCount"
    if ([int]$persistedCount -lt [int]$encCount) {
        throw "Volume persistence failure: expected at least $encCount WAL files, found $persistedCount"
    }

    Write-Host "`n[Step 7] Restoring an Archived WAL Segment & Verifying Byte Fidelity..."
    # Get name of first archived WAL segment
    $firstWalEnc = (docker exec byos-c681-deploy-test-pg sh -c "ls -1 /var/byos/archive/wal/*.enc | head -n 1").Trim()
    $firstWalName = [System.IO.Path]::GetFileNameWithoutExtension($firstWalEnc)
    Write-Host "  Target WAL segment for restoration: $firstWalName"

    # Execute restore-wal command
    $restoreCmd = "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name $firstWalName --target-path /tmp/restored_$firstWalName"
    docker exec byos-c681-deploy-test-pg sh -c "$restoreCmd"
    if ($LASTEXITCODE -ne 0) {
        throw "restore-wal failed with exit code $LASTEXITCODE"
    }

    # Verify decrypted size matches standard 16MB PostgreSQL WAL
    $restoredSize = (docker exec byos-c681-deploy-test-pg stat -c "%s" "/tmp/restored_$firstWalName").Trim()
    Write-Host "  -> Restored WAL size: $restoredSize bytes (expected: 16777216 bytes)"
    if ([long]$restoredSize -ne 16777216) {
        throw "Restored WAL size mismatch: $restoredSize != 16777216"
    }

    # Verify SHA-256 matches the plaintext checksum stored in metadata
    $metaJson = docker exec byos-c681-deploy-test-pg cat "/var/byos/archive/wal/${firstWalName}.meta.json"
    $metaObj = $metaJson | ConvertFrom-Json
    $expectedChecksum = $metaObj.plaintext_sha256

    $actualChecksum = (docker exec byos-c681-deploy-test-pg sha256sum "/tmp/restored_$firstWalName").Split()[0].Trim()
    Write-Host "  -> Metadata Plaintext Checksum: $expectedChecksum"
    Write-Host "  -> Restored File Checksum:     $actualChecksum"

    if ($expectedChecksum -ne $actualChecksum) {
        throw "Checksum mismatch! Restored WAL does not match original plaintext!"
    }
    Write-Host "  -> Cryptographic & Byte Fidelity: EXACT MATCH!"

    Write-Host "`n=================================================="
    Write-Host "SUCCESS: Phase 1 Real Deployment Integration VERIFIED!"
    Write-Host "=================================================="
}
finally {
    Write-Host "`nCleaning up test deployment..."
    docker compose -f $composeFile -p $projectName down -v 2>$null | Out-Null
    if (Test-Path $composeFile) { Remove-Item -Force $composeFile }
}
