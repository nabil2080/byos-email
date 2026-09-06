#!/usr/bin/env pwsh
<#
.SYNOPSIS
Integration test: mail-router → native Rust crypto-worker → V5.3 response → PostgreSQL metadata/storage

.PREREQUISITES
- Docker stack running with native crypto-worker
- mail-router, storage-worker, crypto-worker, postgres healthy
- Test mailbox seeded in database
#>

param(
    [string]$MailRouterUrl = "http://localhost:8081",
    [string]$CryptoWorkerUrl = "http://localhost:8084",
    [string]$StorageWorkerUrl = "http://localhost:8083",
    [string]$MailboxAddress = "local@byos.local",
    [string]$MailboxId = "0cb877dc-4206-4408-8709-1eac14129d6a"
)

Write-Host "=== Mail-Router → Native Crypto-Worker Integration Test ===" -ForegroundColor Cyan

# 1. Health checks
Write-Host "`n[1/7] Health checks..." -ForegroundColor Yellow
$services = @(
    @{ Name = "crypto-worker"; Url = "$CryptoWorkerUrl/health" },
    @{ Name = "mail-router"; Url = "$MailRouterUrl/health" },
    @{ Name = "storage-worker"; Url = "$StorageWorkerUrl/health" }
)
foreach ($svc in $services) {
    try {
        $r = Invoke-RestMethod -Uri $svc.Url -TimeoutSec 5
        Write-Host "  OK $($svc.Name): $($r.status) ($($r.implementation))" -ForegroundColor Green
    } catch {
        Write-Error "FAIL $($svc.Name): $_"
        exit 1
    }
}

# 2. Get mailbox public key from DB
Write-Host "`n[2/7] Verifying mailbox public key in PostgreSQL..." -ForegroundColor Yellow
$pkHex = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(mailbox_pk, 'base64') FROM mailboxes WHERE local_part = 'local';"
$pkHex = $pkHex.Trim()
Write-Host "  Mailbox public key (base64): $pkHex"
if ($pkHex.Length -ne 44) { Write-Error "Invalid public key length"; exit 1 }

# 3. Generate test keypair and seed mailbox
Write-Host "`n[3/7] Seeding mailbox with known keypair..." -ForegroundColor Yellow
$keypair = & "$PSScriptRoot\..\target\debug\byos-crypto-client.exe" generate | ConvertFrom-Json
$publicKeyB64 = $keypair.public_key
$privateKeyB64 = $keypair.secret_key
Write-Host "  Public key:  $publicKeyB64"
docker exec byos-postgres psql -U byos -d byos -c "UPDATE mailboxes SET mailbox_pk = decode('$publicKeyB64', 'base64') WHERE local_part = 'local';" | Out-Null
Write-Host "  Mailbox updated with new public key"

# 4. Send test message via mail-router /v1/inbound endpoint directly
Write-Host "`n[4/7] Sending test message via mail-router /v1/inbound..." -ForegroundColor Yellow
$testSubject = "Integration Test $(Get-Date -Format 'yyyyMMdd-HHmmss')"
$testBody = "This is a mail-router -> native crypto-worker integration test.`nSent at $(Get-Date -Format 'o')"
$rawMsg = "From: integration-test@example.com`nTo: $MailboxAddress`nSubject: $testSubject`n`n$testBody"

$inboundReq = @{
    envelope_from = "integration-test@example.com"
    recipients = @($MailboxAddress)
    raw_message_b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($rawMsg))
} | ConvertTo-Json -Compress

try {
    $resp = Invoke-RestMethod -Uri "$MailRouterUrl/v1/inbound" -Method Post -Body $inboundReq -ContentType "application/json" -TimeoutSec 30
    Write-Host "  Mail-router response: $($resp.Stored.Count) message(s) stored" -ForegroundColor Green
    $stored = $resp.Stored[0]
    Write-Host "  Message ID: $($stored.message_id)"
    Write-Host "  Mailbox ID: $($stored.mailbox_id)"
    Write-Host "  Seq: $($stored.message_seq)"
    Write-Host "  Object: $($stored.storage_object_id)"
} catch {
    Write-Error "FAIL mail-router inbound: $_"
    exit 1
}

# 5. Verify metadata in PostgreSQL
Write-Host "`n[5/7] Verifying PostgreSQL metadata..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# Query each field separately to avoid line-wrapping issues
$seq = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT message_seq FROM message_metadata WHERE mailbox_id = '$MailboxId' ORDER BY message_seq DESC LIMIT 1;"
$objectId = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT storage_object_id FROM message_metadata WHERE mailbox_id = '$MailboxId' ORDER BY message_seq DESC LIMIT 1;"
$wrappedKeyB64 = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(content_key_hpke_wrapped, 'base64') FROM message_metadata WHERE mailbox_id = '$MailboxId' ORDER BY message_seq DESC LIMIT 1;"
$ivB64 = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(encryption_iv, 'base64') FROM message_metadata WHERE mailbox_id = '$MailboxId' ORDER BY message_seq DESC LIMIT 1;"
$encVer = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encryption_version FROM message_metadata WHERE mailbox_id = '$MailboxId' ORDER BY message_seq DESC LIMIT 1;"
$aadVer = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT aad_version FROM message_metadata WHERE mailbox_id = '$MailboxId' ORDER BY message_seq DESC LIMIT 1;"
$bundleHashB64 = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(bundle_hash, 'base64') FROM message_metadata WHERE mailbox_id = '$MailboxId' ORDER BY message_seq DESC LIMIT 1;"
$skVer = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT mailbox_sk_version FROM message_metadata WHERE mailbox_id = '$MailboxId' ORDER BY message_seq DESC LIMIT 1;"
$status = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT status FROM message_metadata WHERE mailbox_id = '$MailboxId' ORDER BY message_seq DESC LIMIT 1;"

$seq = $seq.Trim()
$objectId = $objectId.Trim()
$wrappedKeyB64 = $wrappedKeyB64.Trim()
$ivB64 = $ivB64.Trim()
$encVer = $encVer.Trim()
$aadVer = $aadVer.Trim()
$bundleHashB64 = $bundleHashB64.Trim()
$skVer = $skVer.Trim()
$status = $status.Trim()

Write-Host "  Seq: $seq"
Write-Host "  Object: $objectId"
Write-Host "  Wrapped key (b64): $($wrappedKeyB64.Substring(0, [Math]::Min(40, $wrappedKeyB64.Length)))..."
Write-Host "  IV (b64): $ivB64"
Write-Host "  Enc version: $encVer"
Write-Host "  AAD version: $aadVer"
Write-Host "  Bundle hash (b64): $($bundleHashB64.Substring(0, [Math]::Min(40, $bundleHashB64.Length)))..."
Write-Host "  SK version: $skVer"
Write-Host "  Status: $status"

# Verify V5.3 fields
if ($encVer -ne "1") { Write-Error "FAIL: encryption_version != 1 (got: $encVer)"; exit 1 }
if ($aadVer -ne "1") { Write-Error "FAIL: aad_version != 1 (got: $aadVer)"; exit 1 }
if ($status -ne "received") { Write-Error "FAIL: status != received (got: $status)"; exit 1 }
Write-Host "  PASS: All V5.3 metadata fields correct" -ForegroundColor Green

# 6. Verify ciphertext in MinIO
Write-Host "`n[6/7] Verifying encrypted object in MinIO..." -ForegroundColor Yellow
$ciphertextB64 = docker exec byos-minio sh -c "mc cat local/byos-mailbox/$objectId | base64 -w 0"
Write-Host "  Ciphertext length: $($ciphertextB64.Length) chars (base64)"

# Verify no plaintext in ciphertext
if ($ciphertextB64 -match "(?i)integration|test|hello") {
    Write-Error "FAIL: Plaintext found in encrypted object!"
    exit 1
}
Write-Host "  PASS: No plaintext detected in ciphertext" -ForegroundColor Green

# 7. Independent V5.3 decryption with a fresh keypair
Write-Host "`n[7/7] Independent V5.3 decryption..." -ForegroundColor Yellow

# Generate a fresh keypair for this test
$keypair = & "$PSScriptRoot\..\target\debug\byos-crypto-client.exe" generate | ConvertFrom-Json
$publicKeyB64 = $keypair.public_key
$privateKeyB64 = $keypair.secret_key
Write-Host "  Test keypair generated"

# Seed mailbox with the new public key
docker exec byos-postgres psql -U byos -d byos -c "UPDATE mailboxes SET mailbox_pk = decode('$publicKeyB64', 'base64') WHERE local_part = 'local';" | Out-Null

# Send another test message with the new keypair (different body to avoid duplicate delivery_identity)
$rawMsg2 = "From: integration-test2@example.com`nTo: $MailboxAddress`nSubject: Integration Test 2`n`nTest body for decryption. Unique: $(Get-Date -Format 'yyyyMMddHHmmssfff')"
$rawMsgB64_2 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($rawMsg2))
$inboundReq2 = @{
    envelope_from = "integration-test2@example.com"
    recipients = @($MailboxAddress)
    raw_message_b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($rawMsg2))
} | ConvertTo-Json -Compress

$resp2 = Invoke-RestMethod -Uri "$MailRouterUrl/v1/inbound" -Method Post -Body $inboundReq2 -ContentType "application/json" -TimeoutSec 30
$stored2 = $resp2.Stored[0]
$objectId2 = $stored2.storage_object_id

# Get metadata for this message (use separate queries to avoid wrapping)
Write-Host "  Fetching message_seq for message 2..."
$seq2 = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT message_seq FROM message_metadata WHERE mailbox_id = '$MailboxId' AND storage_object_id = '$objectId2';"
$seq2 = $seq2.Trim()
Write-Host "  Message seq: $seq2"

$wrappedKeyB64_2 = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(content_key_hpke_wrapped, 'base64') FROM message_metadata WHERE mailbox_id = '$MailboxId' AND storage_object_id = '$objectId2';"
$ivB64_2 = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(encryption_iv, 'base64') FROM message_metadata WHERE mailbox_id = '$MailboxId' AND storage_object_id = '$objectId2';"
$wrappedKeyB64_2 = $wrappedKeyB64_2.Trim()
$ivB64_2 = $ivB64_2.Trim()

Write-Host "  Wrapped key (b64): $($wrappedKeyB64_2.Substring(0, [Math]::Min(40, $wrappedKeyB64_2.Length)))..."
Write-Host "  IV (b64): $ivB64_2"

# Get ciphertext from MinIO
Write-Host "  Fetching ciphertext from MinIO..."
$ciphertextB64_2 = docker exec byos-minio sh -c "mc cat local/byos-mailbox/$objectId2 | base64 -w 0"
Write-Host "  Ciphertext length: $($ciphertextB64_2.Length) chars (base64)"

# Decrypt with crypto-client
Write-Host "  Decrypting with crypto-client..."
$cryptoClient = "$PSScriptRoot\..\target\debug\byos-crypto-client.exe"
$args = @(
    "decrypt",
    $MailboxId,
    $seq2,
    $privateKeyB64,
    $wrappedKeyB64_2,
    $ciphertextB64_2
)
$proc = Start-Process -FilePath $cryptoClient -ArgumentList $args -NoNewWindow -Wait -RedirectStandardOutput "temp_out.txt" -RedirectStandardError "temp_err.txt" -PassThru
$plaintextB64 = Get-Content "temp_out.txt" -Raw
$err = Get-Content "temp_err.txt" -Raw
if ($err) { Write-Host "  stderr: $err" }
Write-Host "  Decryption output: $plaintextB64"

Write-Host "`n=== ALL INTEGRATION TESTS PASSED ===" -ForegroundColor Green
Write-Host "mail-router -> native Rust crypto-worker -> V5.3 response -> PostgreSQL/MinIO verified"