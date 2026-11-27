# tests/verify_kms_and_storage.ps1
# C6.8.1 Phase 5: Production Key Management (KMS) & Storage Verification
$ErrorActionPreference = "Stop"

Write-Host "=================================================="
Write-Host "C6.8.1 Phase 5: KMS Key Rotation & Multi-Version Decryption Drill"
Write-Host "=================================================="

$testDir = "f:\Codex\byos-email\tests\scratch_kms_test"
if (Test-Path $testDir) {
    Remove-Item -Recurse -Force $testDir
}
New-Item -ItemType Directory -Path "$testDir\archive\wal" -Force | Out-Null
New-Item -ItemType Directory -Path "$testDir\restore" -Force | Out-Null

$binPath = "f:\Codex\byos-email\tools\byos-backup\byos-backup.exe"

# Generate 2 distinct 256-bit keys (64 hex characters)
$keyV1Hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
$keyV2Hex = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

$keyV1File = "$testDir\key_v1.key"
$keyV2File = "$testDir\key_v2.key"
[System.IO.File]::WriteAllText($keyV1File, $keyV1Hex)
[System.IO.File]::WriteAllText($keyV2File, $keyV2Hex)

# Create 2 mock WAL segment files (each 16MB)
$wal1Name = "000000010000000000000001"
$wal2Name = "000000010000000000000002"

$wal1Path = "$testDir\$wal1Name"
$wal2Path = "$testDir\$wal2Name"

$payload1 = [System.Text.Encoding]::UTF8.GetBytes("WAL_SEGMENT_DATA_EPOCH_V1_INITIAL_KEY")
$payload2 = [System.Text.Encoding]::UTF8.GetBytes("WAL_SEGMENT_DATA_EPOCH_V2_ROTATED_KEY")

$data1 = New-Object byte[] 16777216
[System.Array]::Copy($payload1, $data1, $payload1.Length)
[System.IO.File]::WriteAllBytes($wal1Path, $data1)

$data2 = New-Object byte[] 16777216
[System.Array]::Copy($payload2, $data2, $payload2.Length)
[System.IO.File]::WriteAllBytes($wal2Path, $data2)

Write-Host "`n--- Step 1: Archive WAL Segment 1 under Key Version 'v1' ---"
$env:BYOS_BACKUP_ENCRYPTION_KEY = $keyV1Hex
$archive1Out = & $binPath archive-wal --source-path $wal1Path --wal-name $wal1Name --archive-dir "$testDir\archive" --key-file $keyV1File --key-version "v1"
Write-Host $archive1Out

Write-Host "`n--- Step 2: Rotate KMS Active Key to 'v2' and preserve 'v1' in historical environment ---"
# Active key is now V2, V1 is historical
$env:BYOS_BACKUP_ENCRYPTION_KEY = $keyV2Hex
$env:BYOS_BACKUP_KEY_VERSION = "v2"
$env:BYOS_BACKUP_KEY_V1 = $keyV1Hex

Write-Host "`n--- Step 3: Archive WAL Segment 2 under Key Version 'v2' ---"
$archive2Out = & $binPath archive-wal --source-path $wal2Path --wal-name $wal2Name --archive-dir "$testDir\archive" --key-file $keyV2File --key-version "v2"
Write-Host $archive2Out

Write-Host "`n--- Step 4: Verify Both WAL Segments in Archive Metadata ---"
$meta1Path = "$testDir\archive\wal\$wal1Name.meta.json"
$meta2Path = "$testDir\archive\wal\$wal2Name.meta.json"

$meta1 = Get-Content $meta1Path | ConvertFrom-Json
$meta2 = Get-Content $meta2Path | ConvertFrom-Json

Write-Host "WAL 1 Encrypted Under Key Version: $($meta1.key_version)"
Write-Host "WAL 2 Encrypted Under Key Version: $($meta2.key_version)"

if ($meta1.key_version -ne "v1" -or $meta2.key_version -ne "v2") {
    throw "Metadata key versions do not match expected ('v1' and 'v2')"
}

Write-Host "`n--- Step 5: Restore Historical WAL 1 (v1) using KMS multi-version lookup ---"
$restored1Path = "$testDir\restore\$wal1Name"
& $binPath restore-wal --wal-name $wal1Name --target-path $restored1Path --archive-dir "$testDir\archive"
if (-not (Test-Path $restored1Path)) {
    throw "Failed to restore historical WAL 1 ($wal1Name)"
}
$restored1Data = [System.IO.File]::ReadAllBytes($restored1Path)
if ($restored1Data.Length -ne 16777216) {
    throw "Restored WAL 1 size mismatch: expected 16777216, got $($restored1Data.Length)"
}
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$hash1 = [System.BitConverter]::ToString($sha256.ComputeHash($restored1Data)).Replace("-", "").ToLower()
Write-Host "Restored WAL 1 Size: $($restored1Data.Length) bytes, SHA256: $hash1"
if ($hash1 -ne $meta1.plaintext_sha256) {
    throw "Restored WAL 1 hash does not match plaintext hash in metadata!"
}
Write-Host "Historical WAL 1 successfully decrypted and verified using KMS version v1!"

Write-Host "`n--- Step 6: Restore Active WAL 2 (v2) using KMS active key ---"
$restored2Path = "$testDir\restore\$wal2Name"
& $binPath restore-wal --wal-name $wal2Name --target-path $restored2Path --archive-dir "$testDir\archive"
if (-not (Test-Path $restored2Path)) {
    throw "Failed to restore active WAL 2 ($wal2Name)"
}
$restored2Data = [System.IO.File]::ReadAllBytes($restored2Path)
if ($restored2Data.Length -ne 16777216) {
    throw "Restored WAL 2 size mismatch: expected 16777216, got $($restored2Data.Length)"
}
$hash2 = [System.BitConverter]::ToString($sha256.ComputeHash($restored2Data)).Replace("-", "").ToLower()
Write-Host "Restored WAL 2 Size: $($restored2Data.Length) bytes, SHA256: $hash2"
if ($hash2 -ne $meta2.plaintext_sha256) {
    throw "Restored WAL 2 hash does not match plaintext hash in metadata!"
}
Write-Host "Active WAL 2 successfully decrypted and verified using KMS version v2!"

Write-Host "`n--- Step 7: Fail-Closed Test: Revoke / Remove Historical Key v1 ---"
# Remove historical key from environment
Remove-Item Env:\BYOS_BACKUP_KEY_V1
Remove-Item $restored1Path

$failedExpectedly = $false
try {
    $errOut = & $binPath restore-wal --wal-name $wal1Name --target-path $restored1Path --archive-dir "$testDir\archive" 2>&1
    Write-Host "Output: $errOut"
} catch {
    $failedExpectedly = $true
}

if (-not (Test-Path $restored1Path)) {
    $failedExpectedly = $true
}

if ($failedExpectedly) {
    Write-Host "CONFIRMED: Without historical key v1, restoration of segment 1 safely failed closed (key not found / authentication rejected)."
} else {
    throw "SECURITY FAULT: Restored segment 1 without valid v1 key!"
}

# Cleanup test directory
Remove-Item -Recurse -Force $testDir
Write-Host "`n=================================================="
Write-Host "C6.8.1 Phase 5: KMS Key Rotation & Multi-Version Drill PASSED"
Write-Host "=================================================="
