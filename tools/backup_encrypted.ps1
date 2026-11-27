# BYOS Encrypted Backup and Retention Automation Script
# Performs logical database backup, cluster globals export, AES-256-GCM encryption,
# integrity verification, and lifecycle retention management.

param(
    [string]$DbName = "byos_disposable_fresh_c67",
    [string]$BackupDir = "backups",
    [string]$KeyFile = "",
    [string]$ContainerName = "byos-postgres",
    [switch]$Prune = $false,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

Write-Host "=================================================="
Write-Host "BYOS Encrypted Backup & Retention Procedure"
Write-Host "Database:       $DbName"
Write-Host "Container:      $ContainerName"
Write-Host "Destination:    $BackupDir"
Write-Host "=================================================="

# 1. Resolve and Validate Encryption Key
$KeyArg = @()
if ($KeyFile -ne "") {
    $KeyArg = @("--key-file", $KeyFile)
} elseif ($env:BYOS_BACKUP_ENCRYPTION_KEY -eq $null -or $env:BYOS_BACKUP_ENCRYPTION_KEY -eq "") {
    Write-Error "ERROR: Encryption key must be provided via -KeyFile or BYOS_BACKUP_ENCRYPTION_KEY environment variable."
    exit 1
}

# 2. Setup Directories
$ResolvedBackupDir = [System.IO.Path]::GetFullPath($BackupDir)
if (-not (Test-Path $ResolvedBackupDir)) {
    New-Item -ItemType Directory -Force -Path $ResolvedBackupDir | Out-Null
}

$TempWorkDir = Join-Path $ResolvedBackupDir ("tmp_" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TempWorkDir | Out-Null

$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmss")
$EncryptedFile = Join-Path $ResolvedBackupDir ("byos_backup_" + $Timestamp + ".enc")
$ContainerGlobals = "/tmp/byos_globals_$Timestamp.sql"
$ContainerDump = "/tmp/byos_dump_$Timestamp.dump"
$LocalGlobals = Join-Path $TempWorkDir "globals.sql"
$LocalDump = Join-Path $TempWorkDir "database.dump"
$LocalManifest = Join-Path $TempWorkDir "manifest.json"

try {
    # 3. Export Cluster-Global Objects inside Postgres Container
    Write-Host "[1/5] Exporting cluster-global objects (roles, grants, memberships)..."
    docker exec $ContainerName pg_dumpall -U byos --globals-only -f $ContainerGlobals
    docker cp "${ContainerName}:${ContainerGlobals}" $LocalGlobals
    docker exec $ContainerName rm -f $ContainerGlobals

    # 4. Export Consistent Database Custom Archive (-Fc)
    Write-Host "[2/5] Exporting database archive ($DbName)..."
    docker exec $ContainerName pg_dump -U byos -Fc -b -f $ContainerDump $DbName
    docker cp "${ContainerName}:${ContainerDump}" $LocalDump
    docker exec $ContainerName rm -f $ContainerDump

    # 5. Create Manifest
    $ManifestContent = @{
        version = 1
        database = $DbName
        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        cipher = "AES-256-GCM"
        section23_compliant = $true
    } | ConvertTo-Json
    Set-Content -Path $LocalManifest -Value $ManifestContent

    # 6. Encrypt Archive into Single .enc Bundle with AES-256-GCM
    Write-Host "[3/5] Encrypting backup bundle with AES-256-GCM before egress..."
    $byosBackupExe = Join-Path (Get-Location) "tools/byos-backup/byos-backup.exe"
    if (-not (Test-Path $byosBackupExe)) {
        & go build -o $byosBackupExe ./tools/byos-backup
    }

    $EncryptArgs = @(
        "encrypt-bundle",
        "--globals-file", $LocalGlobals,
        "--dump-file", $LocalDump,
        "--manifest-file", $LocalManifest,
        "--out-file", $EncryptedFile
    ) + $KeyArg

    & $byosBackupExe $EncryptArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to encrypt backup bundle."
    }

    # 7. Authenticate and Verify Encrypted Archive
    Write-Host "[4/5] Verifying encrypted archive integrity and authentication tag..."
    $VerifyArgs = @(
        "verify-encrypted",
        "--in-file", $EncryptedFile
    ) + $KeyArg

    & $byosBackupExe $VerifyArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to verify encrypted backup archive."
    }

    # 8. Optional Retention Lifecycle Pruning
    if ($Prune) {
        Write-Host "[5/5] Executing lifecycle retention pruning with last-known-good protection..."
        $PruneArgs = @(
            "prune",
            "--backup-dir", $ResolvedBackupDir,
            "--daily-days", "7",
            "--weekly-weeks", "4",
            "--monthly-months", "12"
        )
        if ($DryRun) {
            $PruneArgs += "--dry-run"
        }
        & $byosBackupExe $PruneArgs
    } else {
        Write-Host "[5/5] Pruning skipped (use -Prune to enable automatic lifecycle retention)."
    }

    Write-Host "=================================================="
    Write-Host "BACKUP SUCCESSFUL"
    Write-Host "Archive:  $EncryptedFile"
    Write-Host "Size:     $((Get-Item $EncryptedFile).Length) bytes"
    Write-Host "=================================================="
    exit 0

} finally {
    # Clean up local temporary plain dumps
    if (Test-Path $TempWorkDir) {
        Remove-Item -Recurse -Force $TempWorkDir
    }
}
