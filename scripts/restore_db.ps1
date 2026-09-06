# Section 23: Backup & Disaster Recovery - Database Restore Script
# Restores a PostgreSQL backup file into the BYOS database.

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile,
    [string]$ContainerName = "byos-postgres",
    [string]$DatabaseUser = "byos",
    [string]$DatabaseName = "byos"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -Path $BackupFile)) {
    Write-Error "Backup file not found at: $BackupFile"
}

Write-Host "Restoring BYOS PostgreSQL backup from $BackupFile..." -ForegroundColor Yellow

Get-Content $BackupFile -Encoding UTF8 | docker exec -i $ContainerName psql -U $DatabaseUser -d $DatabaseName

Write-Host "Database restore completed successfully!" -ForegroundColor Green
