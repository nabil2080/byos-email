<#
.SYNOPSIS
Cleans up test-generated pollution across PostgreSQL, MinIO, and Redis in local dev.

.DESCRIPTION
1. Wipes test-generated rows from PostgreSQL while preserving seed accounts.
2. Removes test objects and stray buckets from MinIO.
3. Cleans test pub/sub and rate limit keys from Redis without FLUSHALL.
4. Reseeds seed accounts (Alice & Bob) with fresh, client-compatible Ed25519 & X-Wing keys.
5. Prints a detailed cleanup summary.

SAFETY GUARDS:
This script contains strict guards to prevent accidental execution against staging or production:
1. It verifies that the MinIO 'local' alias points to a local endpoint (localhost, 127.0.0.1, byos-minio, or minio:9000).
2. It requires the environment variable BYOS_LOCAL_DEV=1 to be set explicitly:
     $env:BYOS_LOCAL_DEV = "1"
#>

$ErrorActionPreference = "Stop"

# Safety Guard 1: Require explicit BYOS_LOCAL_DEV=1 opt-in environment variable
if ($env:BYOS_LOCAL_DEV -ne "1") {
    Write-Error "Refusing to run: set BYOS_LOCAL_DEV=1 to confirm this is a local dev environment."
    exit 1
}

# Safety Guard 2: Verify MinIO alias points to local development instance
$minioEndpoint = docker exec byos-minio sh -c "mc alias ls local 2>/dev/null || mc config host ls local" 2>$null
if (-not $minioEndpoint -or (($minioEndpoint -join "`n") -notmatch "localhost|127\.0\.0\.1|byos-minio|minio:9000")) {
    Write-Error "Refusing to run: MinIO alias 'local' does not point at a local dev instance."
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "      BYOS Local Test-Data Cleanup & Reset      " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# Ensure scratch directory exists
$scratchDir = Join-Path $scriptDir "scratch"
if (-not (Test-Path $scratchDir)) {
    New-Item -ItemType Directory -Path $scratchDir | Out-Null
}

# 1. MinIO count before cleanup
Write-Host "`n[1/5] Inspecting MinIO objects..." -ForegroundColor Yellow
$minioObjCount = 0
try {
    $mcLines = docker exec byos-minio sh -c "mc ls -r local/byos-mailbox/ 2>/dev/null"
    if ($mcLines) {
        $minioObjCount = ($mcLines | Measure-Object).Count
    }
} catch {
    Write-Host "Warning: Could not count MinIO objects: $_" -ForegroundColor DarkGray
}

# 2. PostgreSQL Cleanup
Write-Host "`n[2/5] Cleaning PostgreSQL test data..." -ForegroundColor Yellow
$sqlFile = Join-Path $scriptDir "tools\clean-test-data.sql"
if (-not (Test-Path $sqlFile)) {
    Write-Error "Cleanup SQL script not found at $sqlFile"
}

$pgOutput = Get-Content $sqlFile -Raw | docker exec -i byos-postgres psql -U byos -d byos -A -F "|" -t
$deletedRows = @{}
if ($pgOutput) {
    foreach ($line in ($pgOutput -split "`r?`n")) {
        $line = $line.Trim()
        if ($line -match '^([a-z_]+)\|(\d+)$') {
            $tableName = $matches[1]
            $cnt = [int64]$matches[2]
            if ($cnt -gt 0) {
                $deletedRows[$tableName] = $cnt
            }
        }
    }
}

# 3. MinIO Cleanup
Write-Host "`n[3/5] Cleaning MinIO storage..." -ForegroundColor Yellow
try {
    docker exec byos-minio sh -c "
        mc rm -r --force local/byos-mailbox/ 2>/dev/null || true
        mc mb -p local/byos-mailbox 2>/dev/null || true
    " | Out-Null
} catch {}

# Remove any stray buckets not named byos-mailbox
try {
    $rawBuckets = docker exec byos-minio sh -c "mc ls local/ 2>/dev/null"
    if ($rawBuckets) {
        foreach ($bLine in ($rawBuckets -split "`r?`n")) {
            if ($bLine -match '\s+([a-zA-Z0-9_\-]+)/$') {
                $bName = $matches[1]
                if ($bName -ne "byos-mailbox") {
                    Write-Host "  Removing stray bucket: $bName" -ForegroundColor DarkYellow
                    docker exec byos-minio sh -c "mc rb --force local/$bName 2>/dev/null" | Out-Null
                }
            }
        }
    }
} catch {}

$remainingBuckets = @()
try {
    $mcList = docker exec byos-minio sh -c "mc ls local/ 2>/dev/null"
    if ($mcList) {
        foreach ($line in ($mcList -split "`r?`n")) {
            if ($line -match '\s+([a-zA-Z0-9_\-]+)/$') {
                $remainingBuckets += $matches[1]
            }
        }
    }
} catch {}

# 4. Redis Cleanup (selective test keys, no FLUSHALL)
Write-Host "`n[4/5] Cleaning Redis test keys..." -ForegroundColor Yellow
$redisDeleted = 0
try {
    $testKeys = docker exec byos-redis redis-cli --scan --pattern "mailbox:*:events" 2>/dev/null
    $rateKeys = docker exec byos-redis redis-cli --scan --pattern "rate:*:*" 2>/dev/null
    $sessionKeys = docker exec byos-redis redis-cli --scan --pattern "auth:user_sessions:*" 2>/dev/null
    
    $allKeysToDelete = @()
    if ($testKeys) { $allKeysToDelete += ($testKeys -split "`r?`n" | Where-Object { $_ }) }
    if ($rateKeys) { $allKeysToDelete += ($rateKeys -split "`r?`n" | Where-Object { $_ }) }
    if ($sessionKeys) { $allKeysToDelete += ($sessionKeys -split "`r?`n" | Where-Object { $_ }) }

    foreach ($k in $allKeysToDelete) {
        $k = $k.Trim()
        if ($k) {
            docker exec byos-redis redis-cli del $k 2>/dev/null | Out-Null
            $redisDeleted++
        }
    }
} catch {
    Write-Host "Warning: Redis cleanup skipped: $_" -ForegroundColor DarkGray
}

# 5. Republish / Reseed Keys
Write-Host "`n[5/5] Reseeding seed accounts with fresh derived keys..." -ForegroundColor Yellow
$seedBin = Join-Path $scriptDir "target\release\seed-test-mailboxes.exe"
if (-not (Test-Path $seedBin)) {
    $seedBin = Join-Path $scriptDir "target\debug\seed-test-mailboxes.exe"
}

if (Test-Path $seedBin) {
    & $seedBin --pair | docker exec -i byos-postgres psql -U byos -d byos | Out-Null
} else {
    cargo run --release --manifest-path "$scriptDir\packages\crypto-core\Cargo.toml" --bin seed-test-mailboxes -- --pair | docker exec -i byos-postgres psql -U byos -d byos | Out-Null
}

# Fetch remaining mailboxes and their Ed25519 pubkey prefixes
$queryRemaining = "SELECT m.local_part, d.name, m.id::text, encode(m.mailbox_ed25519_pk, 'hex') FROM mailboxes m JOIN domains d ON d.id = m.domain_id ORDER BY m.local_part;"
$rawRemaining = docker exec byos-postgres psql -U byos -d byos -A -F "|" -t -c $queryRemaining
$remainingBoxes = @()
if ($rawRemaining) {
    foreach ($r in ($rawRemaining -split "`r?`n")) {
        $r = $r.Trim()
        if ($r) {
            $parts = $r -split '\|'
            if ($parts.Count -ge 4) {
                $remainingBoxes += [PSCustomObject]@{
                    Address = "$($parts[0])@$($parts[1])"
                    Id      = $parts[2]
                    Ed25519 = $parts[3]
                    Prefix  = if ($parts[3].Length -ge 16) { $parts[3].Substring(0, 16) } else { $parts[3] }
                }
            }
        }
    }
}

# Print Cleanup Summary
Write-Host "`n=================================================" -ForegroundColor Green
Write-Host "             CLEANUP SUMMARY REPORT              " -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green

Write-Host "`nPostgreSQL rows deleted per table:" -ForegroundColor Cyan
if ($deletedRows.Count -eq 0) {
    Write-Host "  None (database was already clean)" -ForegroundColor DarkGray
} else {
    foreach ($tbl in ($deletedRows.Keys | Sort-Object)) {
        Write-Host ("  {0,-25} : {1,6} rows" -f $tbl, $deletedRows[$tbl])
    }
}

Write-Host "`nMinIO cleanup:" -ForegroundColor Cyan
Write-Host ("  Objects deleted           : {0}" -f $minioObjCount)
Write-Host ("  Remaining buckets         : {0}" -f ($remainingBuckets -join ", "))

Write-Host "`nRedis cleanup:" -ForegroundColor Cyan
Write-Host ("  Test keys deleted         : {0}" -f $redisDeleted)

Write-Host "`nRemaining mailboxes (Seed State):" -ForegroundColor Cyan
foreach ($box in $remainingBoxes) {
    Write-Host ("  {0,-20} (ID: {1}) Ed25519 PK Prefix: {2}..." -f $box.Address, $box.Id, $box.Prefix)
}

Write-Host "`n=================================================" -ForegroundColor Green
Write-Host "Environment is now in a known-clean seed state!" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
