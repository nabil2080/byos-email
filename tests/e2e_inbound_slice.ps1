#!/usr/bin/env pwsh
<#
.SYNOPSIS
End-to-end test for BYOS Step 3: Inbound vertical slice
Tests: SMTP -> inbound-bridge -> Rspamd -> mail-router -> crypto-worker -> MinIO -> client decrypt

.PREREQUISITES
- Docker Desktop running with byos-email stack up
- Rust crypto-core built (cargo build --bins)
- Test mailbox seeded with known keypair
#>

param(
    [string]$SmtpHost = "localhost",
    [int]$SmtpPort = 25,
    [string]$MailboxAddress = "e2email@e2e-inbound-byos.local",
    [string]$MailboxId = "e1000000-0000-4000-8000-00000000000b"
)

Write-Host "=== BYOS Step 3 E2E Inbound Slice Test ===" -ForegroundColor Cyan

# Fixture: dedicated org/domain/mailbox/storage mapping. The old script assumed
# a seeded `local@byos.local` mailbox from a previous lab incarnation; nothing
# guarantees it here, so this suite owns its fixtures (idempotent reruns).
$E2EOrg = "e1000000-0000-4000-8000-000000000001"
$E2EUser = "e1000000-0000-4000-8000-000000000002"
$E2EDomain = "e1000000-0000-4000-8000-00000000000a"
$E2EStorage = "e1000000-0000-4000-8000-00000000000c"
$E2ERoot = "e1000000-0000-4000-8000-00000000000d"
function Exec-Sql($sql) {
  $out = docker exec byos-postgres psql -U byos -d byos -t -A -c $sql 2>$null
  if ($null -eq $out) { return "" }
  return ($out | Out-String).Trim()
}
Exec-Sql "INSERT INTO organizations (id, name, org_recovery_pk, plan) VALUES ('$E2EOrg', 'e2einbound', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','base64'), 'team') ON CONFLICT (id) DO NOTHING;" | Out-Null
Exec-Sql "INSERT INTO users (id, org_id, email, password_hash, display_name, is_active, role) VALUES ('$E2EUser', '$E2EOrg', 'e2einbound@byos.local', 'x', 'e2e', true, 'owner') ON CONFLICT (id) DO NOTHING;" | Out-Null
Exec-Sql "INSERT INTO domains (id, org_id, name, is_verified) VALUES ('$E2EDomain', '$E2EOrg', 'e2e-inbound-byos.local', true) ON CONFLICT (id) DO UPDATE SET is_verified=true;" | Out-Null
Exec-Sql "INSERT INTO storage_connections (id, org_id, provider, provider_type, bucket_name, endpoint, config, encrypted, status, credentials_enc, is_active) VALUES ('$E2EStorage', '$E2EOrg', 'minio', 'minio', 'byos-mailbox', 'minio:9000', '{}'::jsonb, true, 'active', '\x00', true) ON CONFLICT (id) DO UPDATE SET status='active';" | Out-Null
Exec-Sql "INSERT INTO root_secrets (id, root_secret_wrapped) VALUES ('$E2ERoot', decode('AA==','base64')) ON CONFLICT (id) DO NOTHING;" | Out-Null
Exec-Sql "INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_pk, is_active) VALUES ('$MailboxId', '$E2EOrg', '$E2EUser', '$E2EDomain', 'e2email', 'org_managed', '$E2ERoot', decode('AA==','base64'), decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','base64'), true) ON CONFLICT (id) DO NOTHING;" | Out-Null
Exec-Sql "INSERT INTO mailbox_storage (mailbox_id, storage_connection_id, object_prefix, status) VALUES ('$MailboxId', '$E2EStorage', 'mailboxes/$MailboxId', 'active') ON CONFLICT (mailbox_id) DO UPDATE SET storage_connection_id='$E2EStorage', status='active';" | Out-Null
$routeCheck = Exec-Sql "SELECT m.local_part || '@' || d.name FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.id='$MailboxId';"
if ($routeCheck -ne $MailboxAddress) { Write-Error "Fixture route mismatch: $routeCheck vs $MailboxAddress"; exit 1 }
Write-Host "  Fixture route OK: $routeCheck" -ForegroundColor Green

Write-Host "=== BYOS Step 3 E2E Inbound Slice Test ===" -ForegroundColor Cyan

# 1. Generate test keypair
Write-Host "`n[1/7] Generating test mailbox keypair..." -ForegroundColor Yellow
$keypair = & "$PSScriptRoot\..\target\debug\byos-crypto-client.exe" generate | ConvertFrom-Json
$publicKeyB64 = $keypair.public_key
$privateKeyB64 = $keypair.secret_key
Write-Host "  Public key:  $publicKeyB64"
Write-Host "  Private key: $privateKeyB64 (kept client-side)"

# 2. Seed mailbox with public key
Write-Host "`n[2/7] Seeding mailbox in PostgreSQL..." -ForegroundColor Yellow
$updateSql = @"
UPDATE mailboxes SET mailbox_pk = decode('$publicKeyB64', 'base64') WHERE id = '$MailboxId';
"@
docker exec byos-postgres psql -U byos -d byos -c $updateSql | Out-Null
$pkCheck = Exec-Sql "SELECT encode(mailbox_pk,'base64') FROM mailboxes WHERE id='$MailboxId';"
if ($pkCheck -ne $publicKeyB64) { Write-Error "Mailbox public key seeding failed"; exit 1 }
Write-Host "  Mailbox updated with new public key"

# 3. Send test email via SMTP
Write-Host "`n[3/7] Sending test email via SMTP to ${SmtpHost}:${SmtpPort}..." -ForegroundColor Yellow
$testSubject = "E2E Test $(Get-Date -Format 'yyyyMMdd-HHmmss')"
$testBody = "This is an end-to-end test message for BYOS Step 3 vertical slice.`nSent at $(Get-Date -Format 'o')"

$mailMsg = @"
From: e2e-test@example.com
To: ${MailboxAddress}
Subject: ${testSubject}
Content-Type: text/plain; charset=us-ascii
Content-Transfer-Encoding: quoted-printable

${testBody}
"@

try {
    $client = New-Object System.Net.Mail.SmtpClient($SmtpHost, $SmtpPort)
    $client.Send("e2e-test@example.com", $MailboxAddress, $testSubject, $testBody)
    Write-Host "  Email sent successfully"
} catch {
    Write-Error "Failed to send email: $_"
    exit 1
}

# 4. Wait for processing
Write-Host "`n[4/7] Waiting for inbound processing..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 5. Query latest message metadata
Write-Host "`n[5/7] Retrieving message metadata from PostgreSQL..." -ForegroundColor Yellow
$query = @"
SELECT message_seq, storage_object_id, encode(content_key_hpke_wrapped, 'base64'), encode(encryption_iv, 'base64'), encode(bundle_hash, 'base64')
FROM message_metadata
WHERE mailbox_id = '$MailboxId'
ORDER BY message_seq DESC
LIMIT 1;
"@
# psql may wrap long base64 fields across lines; read all output and join lines until we have 5 fields
$raw = docker exec byos-postgres psql -U byos -d byos -t -A -c $query
# Join all lines, then split on |
$joined = ($raw -split "`r?`n") -join ''
$parts = $joined -split '\|'
if ($parts.Count -lt 5) {
    Write-Error "Failed to parse psql output: got $($parts.Count) fields, need 5"
    exit 1
}
$seq = $parts[0].Trim()
$objectId = $parts[1].Trim()
$wrappedKeyB64 = $parts[2].Trim()
$ivB64 = $parts[3].Trim()
$bundleHashB64 = $parts[4].Trim()

Write-Host "  Message seq: $seq"
Write-Host "  Object ID: $objectId"
Write-Host "  Wrapped key: $wrappedKeyB64"

# 6. Fetch encrypted object from MinIO
Write-Host "`n[6/7] Fetching encrypted object from MinIO..." -ForegroundColor Yellow

# Configure MinIO client alias
docker exec byos-minio mc alias set local http://localhost:9000 byosminio byosminio_dev_password | Out-Null

$ciphertextB64 = docker exec byos-minio sh -c "mc cat local/byos-mailbox/$objectId | base64 -w 0"
Write-Host "  Ciphertext length: $($ciphertextB64.Length) chars (base64)"

# Verify no plaintext in ciphertext
if ($ciphertextB64 -match "(?i)test|e2e|vertical|slice") {
    Write-Error "FAIL: Plaintext found in encrypted object!"
    exit 1
}
Write-Host "  PASS: No plaintext detected in ciphertext"

# 7. Decrypt with private key
Write-Host "`n[7/7] Decrypting with private key (client-side)..." -ForegroundColor Yellow
$plaintextB64 = & "$PSScriptRoot\..\target\debug\byos-crypto-client.exe" decrypt `
    $MailboxId $seq `
    $privateKeyB64 `
    $wrappedKeyB64 `
    $ciphertextB64

if (-not $plaintextB64) {
    Write-Error "Decryption failed"
    exit 1
}

$plaintextBytes = [System.Convert]::FromBase64String($plaintextB64)
$plaintext = [System.Text.Encoding]::UTF8.GetString($plaintextBytes)

if ($plaintext -notmatch [Regex]::Escape("This is an end-to-end test message for BYOS Step 3 vertical slice")) {
    Write-Error "FAIL: Decrypted content does not contain expected message text"
    Write-Host "Decrypted content (first 500 chars):" $plaintext.Substring(0, [Math]::Min(500, $plaintext.Length))
    exit 1
}

Write-Host "  PASS: Decrypted content matches original message" -ForegroundColor Green
Write-Host "`n=== ALL TESTS PASSED ===" -ForegroundColor Green
Write-Host "Step 3 vertical slice verified end-to-end:"
Write-Host "  SMTP -> inbound-bridge -> Rspamd -> mail-router -> crypto-worker -> MinIO -> Client Decrypt"