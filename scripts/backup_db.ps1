# Section 23: Backup & Disaster Recovery - Database Backup Script
# Creates a timestamped PostgreSQL backup of control plane metadata, schemas, and cryptographic metadata.

param(
    [string]$ContainerName = "byos-postgres",
    [string]$DatabaseUser = "byos",
    [string]$DatabaseName = "byos",
    [string]$BackupDir = "./infra/backups"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = Join-Path $BackupDir "byos_db_backup_$Timestamp.sql"

Write-Host "Starting BYOS PostgreSQL backup to $BackupFile..." -ForegroundColor Cyan

docker exec $ContainerName pg_dump -U $DatabaseUser $DatabaseName | Set-Content -Path $BackupFile -Encoding UTF8

if (Test-Path $BackupFile) {
    $Size = (Get-Item $BackupFile).Length
    Write-Host "Backup completed successfully! Backup size: $Size bytes." -ForegroundColor Green
} else {
    Write-Error "Backup file was not created."
}
