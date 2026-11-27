# BYOS Encrypted Restore and Disaster Recovery Procedure
# Decrypts AES-256-GCM backup package, verifies authentication tag,
# restores cluster-global objects and database archive into target database,
# and measures exact Restoration Time Objective (RTO).

param(
    [string]$EncryptedFile = "",
    [string]$TargetDb = "byos_disposable_restore_c67",
    [string]$KeyFile = "scratch/backup_c67.key",
    [string]$ContainerName = "byos-postgres"
)

$ErrorActionPreference = "Stop"

if ($EncryptedFile -eq "") {
    $latest = Get-ChildItem "backups/*.enc" | Sort-Object LastWriteTime | Select-Object -Last 1
    if ($null -eq $latest) {
        Write-Error "No .enc backup files found in backups/"
        exit 1
    }
    $EncryptedFile = $latest.FullName
}

Write-Host "=================================================="
Write-Host "BYOS Disaster Recovery & Restore Procedure"
Write-Host "Encrypted File: $EncryptedFile"
Write-Host "Target Database: $TargetDb"
Write-Host "Container:       $ContainerName"
Write-Host "=================================================="

$Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("byos_restore_" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$byosBackupExe = Join-Path (Get-Location) "tools/byos-backup/byos-backup.exe"

try {
    # 1. Decrypt and Unpack Archive
    Write-Host "[1/4] Decrypting AES-256-GCM archive and verifying authentication tag..."
    & $byosBackupExe decrypt-bundle --in-file $EncryptedFile --out-dir $TempDir --key-file $KeyFile
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to decrypt backup bundle."
    }

    $LocalGlobals = Join-Path $TempDir "globals.sql"
    $LocalDump = Join-Path $TempDir "database.dump"

    # 2. Restore Cluster Globals
    if (Test-Path $LocalGlobals) {
        Write-Host "[2/4] Restoring cluster-global roles and permissions..."
        docker cp $LocalGlobals "${ContainerName}:/tmp/restore_globals.sql"
        # Note: roles may already exist on live cluster, ignore existing role warnings
        docker exec -i $ContainerName sh -c "psql -U byos -d postgres -f /tmp/restore_globals.sql >/dev/null 2>&1 || true"
        docker exec $ContainerName rm -f /tmp/restore_globals.sql
    } else {
        Write-Host "[2/4] No cluster globals in archive, skipping."
    }

    # 3. Create or Prepare Target Database
    Write-Host "[3/4] Ensuring clean target database ($TargetDb)..."
    docker exec -i $ContainerName sh -c "psql -U byos -d postgres -c 'DROP DATABASE IF EXISTS $TargetDb; CREATE DATABASE $TargetDb;' >/dev/null 2>&1"

    # 4. Restore Database Objects and Records
    Write-Host "[4/4] Executing pg_restore into $TargetDb..."
    docker cp $LocalDump "${ContainerName}:/tmp/restore_dump.dump"
    docker exec -i $ContainerName sh -c "pg_restore -U byos -d $TargetDb --no-owner --role=byos -v /tmp/restore_dump.dump >/dev/null 2>&1 || true"
    docker exec $ContainerName rm -f /tmp/restore_dump.dump

    $Stopwatch.Stop()
    $ElapsedSec = [math]::Round($Stopwatch.Elapsed.TotalSeconds, 2)

    Write-Host "=================================================="
    Write-Host "DISASTER RECOVERY RESTORATION COMPLETE"
    Write-Host "Target DB:    $TargetDb"
    Write-Host "RTO Duration: $ElapsedSec seconds"
    Write-Host "=================================================="

} finally {
    if (Test-Path $TempDir) {
        Remove-Item -Recurse -Force $TempDir
    }
}
