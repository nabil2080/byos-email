# tests/verify_recovery_monitoring.ps1
# C6.8.1 Phase 6: Recovery Monitoring & Alerting Verification
$ErrorActionPreference = "Stop"

Write-Host "=================================================="
Write-Host "C6.8.1 Phase 6: Disaster Recovery Monitoring & Alerting Drill"
Write-Host "=================================================="

$testDir = "f:\Codex\byos-email\tests\scratch_mon_test"
if (Test-Path $testDir) {
    Remove-Item -Recurse -Force $testDir
}
New-Item -ItemType Directory -Path "$testDir\archive\backups" -Force | Out-Null
New-Item -ItemType Directory -Path "$testDir\archive\wal" -Force | Out-Null

$binPath = "f:\Codex\byos-email\tools\byos-backup\byos-backup.exe"

$keyHex = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
$keyFile = "$testDir\backup.key"
[System.IO.File]::WriteAllText($keyFile, $keyHex)
$env:BYOS_BACKUP_ENCRYPTION_KEY = $keyHex

# Create mock base backup bundle
$manifest = @"
{
  "backup_id": "base_20261124_200000",
  "start_lsn": "0/01000028",
  "start_wal": "000000010000000000000001",
  "stop_lsn": "0/02000060",
  "stop_wal": "000000010000000000000002",
  "start_time": "$((Get-Date).ToUniversalTime().AddMinutes(-5).ToString("yyyy-MM-ddTHH:mm:ssZ"))",
  "stop_time": "$((Get-Date).ToUniversalTime().AddMinutes(-4).ToString("yyyy-MM-ddTHH:mm:ssZ"))",
  "timeline_id": 1,
  "required_wals": ["000000010000000000000001", "000000010000000000000002"],
  "format": "tar"
}
"@
$manifestBytes = [System.Text.Encoding]::UTF8.GetBytes($manifest)
$tarBytes = [System.Text.Encoding]::UTF8.GetBytes("MOCK_TAR_BASE_BACKUP_DATA")

# Package into .enc using PackageBaseBackupArchive format
# MagicHeader (8) + Nonce (12) + AES-GCM(tarLen(8) + manifestLen(8) + tarBytes + manifestBytes)
# We can use byos-backup basebackup or create continuous WALs and test wal-status and recovery-status

# Create 3 sequential WAL segments: 000000010000000000000001, 000000010000000000000002, 000000010000000000000003
for ($i = 1; $i -le 3; $i++) {
    $walName = [string]::Format("00000001000000000000000{0:X}", $i)
    $srcPath = "$testDir\$walName"
    $bytes = New-Object byte[] 16777216
    [System.IO.File]::WriteAllBytes($srcPath, $bytes)
    & $binPath archive-wal --source-path $srcPath --wal-name $walName --archive-dir "$testDir\archive" --key-file $keyFile --key-version "v1" | Out-Null
}

Write-Host "`n--- Check 1: Continuous WAL Archive Status (Healthy) ---"
$walStatusOut = & $binPath wal-status --archive-dir "$testDir\archive"
Write-Host ($walStatusOut -join "`n")

if (-not ($walStatusOut -match "CONTINUOUS \(No gaps detected\)")) {
    throw "Expected continuous WAL status without gaps"
}

Write-Host "`n--- Check 2: Injecting Sequence Gap (Deleting segment 000000010000000000000002) ---"
Remove-Item "$testDir\archive\wal\000000010000000000000002.enc" -Force
Remove-Item "$testDir\archive\wal\000000010000000000000002.meta.json" -Force

$gapStatusOut = & $binPath wal-status --archive-dir "$testDir\archive"
Write-Host ($gapStatusOut -join "`n")

if (-not ($gapStatusOut -match "WARNING: 1 sequence gaps detected")) {
    throw "Expected sequence gap detection warning"
}
Write-Host "CONFIRMED: Gap detection alert triggered correctly!"

Write-Host "`n--- Check 3: Recovery Health Status with Gaps ---"
$recStatusOut = & $binPath recovery-status --archive-dir "$testDir\archive" --key-file $keyFile
Write-Host ($recStatusOut -join "`n")

if (-not ($recStatusOut -match "CRITICAL")) {
    throw "Expected recovery health status to be CRITICAL when gaps exist"
}
Write-Host "CONFIRMED: Recovery health accurately reported CRITICAL status!"

# Cleanup test directory
Remove-Item -Recurse -Force $testDir
Write-Host "`n=================================================="
Write-Host "C6.8.1 Phase 6: Recovery Monitoring & Alerting Drill PASSED"
Write-Host "=================================================="
