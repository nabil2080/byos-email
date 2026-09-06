#!/usr/bin/env pwsh
# Explicit bootstrap outside PostgreSQL for BYOS storage (Section 9)
# - Obtains storage DEK from secret-file mechanism
# - Encrypts config via storage-worker /internal/encrypt boundary
# - Inserts only encrypted config into PostgreSQL
# DB never needs DEK

param(
  [string]$StorageWorkerUrl = "http://localhost:8083",
  [string]$DekFile = "F:\Codex\byos-email\infra\secrets\storage_dek.b64"
)

Write-Host "=== Bootstrap Storage (explicit, no DB DEK) ===" -ForegroundColor Cyan

# 1. Verify DEK file exists and is 32 bytes after base64 decode (precise format)
if (-not (Test-Path $DekFile)) {
  Write-Error "DEK file not found at $DekFile — create via: openssl rand -base64 32 > $DekFile"
  exit 1
}
$b64 = (Get-Content $DekFile -Raw).Trim()
try {
  $dek = [Convert]::FromBase64String($b64)
} catch {
  Write-Error "DEK base64 decode failed: $_"
  exit 1
}
if ($dek.Length -ne 32) {
  Write-Error "DEK must be exactly 32 bytes after base64 decode, got $($dek.Length)"
  exit 1
}
Write-Host "DEK verified: 32 bytes (base64 transport ok) from $DekFile"

# 2. Wait for storage-worker
Write-Host "Waiting for storage-worker $StorageWorkerUrl/health ..."
for ($i=0; $i -lt 30; $i++) {
  try {
    $h = Invoke-RestMethod -Uri "$StorageWorkerUrl/health" -Method Get -TimeoutSec 2
    if ($h.status -eq "healthy") { Write-Host "storage-worker healthy"; break }
  } catch { Start-Sleep 1 }
  if ($i -eq 29) { Write-Error "storage-worker not healthy"; exit 1 }
}

# 3. Prepare configs (local-first: MinIO S3 + Mock Drive)
$minioConfig = @{
  endpoint = "minio:9000"
  bucket = "byos-mailbox"
  access_key = "byosminio"
  secret_key = "byosminio_dev_password"
  region = ""
  path_style = $true
  provider = "s3"
} | ConvertTo-Json -Compress

$mockConfig = @{
  provider = "google_drive_mock"
  root = "/tmp/byos-drive-mock"
} | ConvertTo-Json -Compress

function Encrypt-Config($plaintextJson) {
  $body = @{ plaintext = $plaintextJson } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Uri "$StorageWorkerUrl/internal/encrypt" -Method Post -Body $body -ContentType "application/json"
  if (-not $resp.ciphertext) { throw "encrypt failed: $($resp | ConvertTo-Json -Compress)" }
  return $resp.ciphertext
}

Write-Host "Encrypting MinIO config via storage-worker boundary ..."
$minioCipher = Encrypt-Config $minioConfig
Write-Host "  MinIO ciphertext $($minioCipher.Substring(0,20))..."

Write-Host "Encrypting Mock Drive config via storage-worker boundary ..."
$mockCipher = Encrypt-Config $mockConfig
Write-Host "  Mock ciphertext $($mockCipher.Substring(0,20))..."

# 4. Insert encrypted configs into PostgreSQL (only encrypted form)
# Use byos superuser for bootstrap (local dev) - SQL files avoid PowerShell quoting issues entirely
Write-Host "Inserting MinIO encrypted config ..."
$minioSqlPath = "$env:TEMP\bootstrap_minio_insert.sql"
$mockSqlPath = "$env:TEMP\bootstrap_mock_insert.sql"
$linkSqlPath = "$env:TEMP\bootstrap_link_insert.sql"

# Read template and substitute ciphertext placeholder
$minioTemplate = Get-Content F:\Codex\byos-email\scripts\bootstrap_sql\minio_insert.sql -Raw
$minioSql = $minioTemplate -replace '__CIPHER__', $minioCipher
$minioSql | Out-File -Encoding UTF8 $minioSqlPath

Write-Host "  Using template: $minioSqlPath"

$mockTemplate = Get-Content F:\Codex\byos-email\scripts\bootstrap_sql\mock_insert.sql -Raw
$mockSql = $mockTemplate -replace '__CIPHER__', $mockCipher
$mockSql | Out-File -Encoding UTF8 $mockSqlPath

Write-Host "  Using template: $mockSqlPath"

$linkTemplate = Get-Content F:\Codex\byos-email\scripts\bootstrap_sql\link_insert.sql -Raw
$linkSql = $linkTemplate  # No placeholder substitution needed
$linkSql | Out-File -Encoding UTF8 $linkSqlPath

Write-Host "  Using template: $linkSqlPath"

# Execute SQL files directly via docker exec psql -f (bypasses PowerShell string parsing)
function Invoke-PsqlFile($sqlPath) {
  $out = docker exec -i byos-postgres psql -U byos -d byos -f $sqlPath 2>&1
  return $out.Trim()
}

try {
  $minioId = Invoke-PsqlFile $minioSqlPath
  Write-Host "MinIO connection id: $minioId"
} catch { Write-Host "MinIO insert: $_" }

try {
  $mockId = Invoke-PsqlFile $mockSqlPath
  Write-Host "Mock Drive connection id: $mockId"
} catch { Write-Host "Mock insert: $_" }

# 5. Link existing mailboxes without storage to default MinIO (explicit, not startup mutation)
$linked = Invoke-PsqlFile $linkSqlPath
Write-Host "Linked mailboxes to storage: $linked"

Write-Host "=== Bootstrap complete (DB never saw DEK, only ciphertext) ===" -ForegroundColor Green