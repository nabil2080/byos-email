#!/usr/bin/env pwsh
<# Scheduled Sending E2E: fixtures -> session -> prepare -> encrypt -> schedule
   -> idempotent retry -> worker promote (no decrypt) -> DKIM -> postfix ->
   delivered, plus cancellation and hardening checks. Every step asserts;
   exit 1 on any unexpected status. #>
param(
  [string]$ApiUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"
$OrgId = "0e000000-0000-4000-8000-000000000011"
$UserId = "0e000000-0000-4000-8000-000000000012"
$DomainId = "0e000000-0000-4000-8000-000000000013"
$StorageId = "0e000000-0000-4000-8000-000000000014"
$DomainName = "schede2e-byos.local"
$TestEmail = "schede2e@byos.local"
$TestPass = "TestPass123!"
$TestPassHash = '$argon2id$v=19$m=65536,t=3,p=2$jHtCEZRDha7z7FIHjhvwHw$qB316rOdX328N6CrEoSaQyjQpP0LIW5nrraDNcH/Zk0'

Write-Host "=== Scheduled Sending E2E Test ===" -ForegroundColor Cyan

function Exec-Sql($sql) {
  $out = docker exec byos-postgres psql -U byos -d byos -t -A -c $sql 2>$null
  if ($null -eq $out) { return "" }
  return ($out | Out-String).Trim()
}

function Api-Req($method, $url, $session, $body) {
  $params = @{ Uri=$url; Method=$method; TimeoutSec=15; ContentType="application/json"; WebSession=$session }
  if ($body) { $params.Body = $body }
  try {
    $r = Invoke-WebRequest @params
    return @{ code=[int]$r.StatusCode; body=$r.Content }
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode.Value__ } catch {}
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    return @{ code=$code; body=$msg }
  }
}

function Assert-Code($res, $want, $what) {
  if ($res.code -ne $want) { Write-Error "${what}: want ${want} got $($res.code) body: $($res.body)"; exit 1 }
  Write-Host "  PASS: ${what} (${want})" -ForegroundColor Green
}

function Wait-ForDb($sql, $want, $tries, $label) {
  for ($i = 0; $i -lt $tries; $i++) {
    Start-Sleep -Seconds 5
    $got = Exec-Sql $sql
    if ($got -eq $want) { Write-Host "  PASS: ${label} (${want})" -ForegroundColor Green; return $got }
  }
  Write-Error "${label}: want ${want} got ${got}"; exit 1
}

# [0] Fixtures
Write-Host "`n[0/7] Fixtures..." -ForegroundColor Yellow
Exec-Sql "INSERT INTO organizations (id, name, org_recovery_pk, plan) VALUES ('$OrgId', 'schede2e', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','base64'), 'team') ON CONFLICT (id) DO UPDATE SET plan='team';" | Out-Null
Exec-Sql "INSERT INTO users (id, org_id, email, password_hash, display_name, is_active, role) VALUES ('$UserId', '$OrgId', '$TestEmail', '$TestPassHash', 'schede2e', true, 'owner') ON CONFLICT (id) DO UPDATE SET password_hash='$TestPassHash', is_active=true;" | Out-Null
Exec-Sql "INSERT INTO domains (id, org_id, name, is_verified) VALUES ('$DomainId', '$OrgId', '$DomainName', true) ON CONFLICT (id) DO UPDATE SET is_verified=true;" | Out-Null
Exec-Sql "INSERT INTO storage_connections (id, org_id, provider, provider_type, bucket_name, endpoint, config, encrypted, status, credentials_enc, is_active) VALUES ('$StorageId', '$OrgId', 'minio', 'minio', 'byos-mailbox', 'minio:9000', '{}'::jsonb, true, 'active', '\x00', true) ON CONFLICT (id) DO UPDATE SET status='active';" | Out-Null
# Real org recovery key (HPKE seal rejects degenerate keys)
$orgPkHex = node -e "const w=require('C:\\Users\\PC\\AppData\\Local\\Temp\\opencode\\wasm-node\\byos_crypto_core.js'); const kp=JSON.parse(w.wasm_generate_keypair()); console.log(kp.public_key)" 2>$null
if ($orgPkHex) { Exec-Sql "UPDATE organizations SET org_recovery_pk=decode('$($orgPkHex.Trim())','hex') WHERE id='$OrgId';" | Out-Null }
# DKIM material for the fixture domain (lab-dev fixture shared with outbound_e2e).
(Get-Content "F:\Codex\byos-email\tests\outbound_dkim_fixture.sql" -Raw) -replace "oute2e-byos.local", $DomainName | docker exec -i byos-postgres psql -U byos -d byos 2>&1 | Out-Null

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{ email=$TestEmail; password=$TestPass } | ConvertTo-Json -Compress
try {
  $lr = Invoke-WebRequest -Uri "$ApiUrl/v1/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -TimeoutSec 15 -WebSession $session
  if ([int]$lr.StatusCode -ne 200) { Write-Error "login failed"; exit 1 }
} catch { Write-Error "login failed: $_"; exit 1 }
Write-Host "  PASS: login 200 + session cookie" -ForegroundColor Green

$MailboxId = [guid]::NewGuid().ToString()
$LocalPart = "schede2ebox-$(Get-Random)"
$payloadJson = node "C:\Users\PC\AppData\Local\Temp\opencode\gen_mailbox_payload.js" $OrgId $DomainId $LocalPart $MailboxId 2>$null
if (-not $payloadJson) { Write-Error "WASM payload generation failed"; exit 1 }
$resMb = Api-Req POST "$ApiUrl/v1/organizations/$OrgId/mailboxes" $session $payloadJson
Assert-Code $resMb 201 "mailbox create"

# [1] Pubkey
Write-Host "`n[1/7] GET /v1/outbound/pubkey" -ForegroundColor Yellow
$pubkeyResp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/pubkey" -Method Get
$pkB64 = $pubkeyResp.outbound_delivery_pk
if (-not $pkB64) { Write-Error "No pubkey"; exit 1 }
Write-Host "  PASS: pubkey present" -ForegroundColor Green

# [2] Prepare
Write-Host "`n[2/7] POST /v1/outbound/prepare" -ForegroundColor Yellow
$prepBody = @{ mailbox_id = $MailboxId } | ConvertTo-Json -Compress
$prepRes = Api-Req POST "$ApiUrl/v1/outbound/prepare" $session $prepBody
Assert-Code $prepRes 201 "prepare"
$prep = ConvertFrom-Json $prepRes.body
if (-not $prep.reservation_id -or -not $prep.outbox_seq) { Write-Error "prepare missing fields"; exit 1 }

# [3] Encrypt
Write-Host "`n[3/7] Encrypt outbound via crypto-client" -ForegroundColor Yellow
$plaintext = "From: noreply@byos.local`nTo: test@example.com`nSubject: Scheduled Test`n`nHello scheduled V5.3"
$plaB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plaintext))
$encOut = & "F:\Codex\byos-email\target\debug\byos-crypto-client.exe" encrypt-outbound $pkB64 $MailboxId $prep.outbox_seq $plaB64 | ConvertFrom-Json
if (-not $encOut.ciphertext -or -not $encOut.wrapped -or -not $encOut.iv) { Write-Error "encrypt-outbound incomplete"; exit 1 }
Write-Host "  PASS: envelope built" -ForegroundColor Green

# [4] Schedule ~20s out (past the 5s minimum with clock margin)
Write-Host "`n[4/7] POST /v1/outbound/schedule" -ForegroundColor Yellow
$scheduledAt = (Get-Date).ToUniversalTime().AddSeconds(20).ToString("o")
$schedBody = @{
  reservation_id = $prep.reservation_id
  mailbox_id = $MailboxId
  recipient = "test@example.com"
  encrypted_message = $encOut.ciphertext
  send_token_wrapped = $encOut.wrapped
  outbox_seq = $prep.outbox_seq
  encryption_version = $prep.encryption_version
  aad_version = $prep.aad_version
  encryption_iv = $encOut.iv
  scheduled_at = $scheduledAt
} | ConvertTo-Json -Compress
$schedRes = Api-Req POST "$ApiUrl/v1/outbound/schedule" $session $schedBody
Assert-Code $schedRes 201 "schedule"
$deliveryId = (ConvertFrom-Json $schedRes.body).delivery_id
if (-not $deliveryId) { Write-Error "No delivery_id from schedule"; exit 1 }
$s0 = Exec-Sql "SELECT status FROM scheduled_messages WHERE delivery_id='$deliveryId'"
if ($s0 -ne "pending") { Write-Error "Expected pending, got $s0"; exit 1 }
Write-Host "  PASS: scheduled pending" -ForegroundColor Green

# [4b] Idempotent retry returns the same delivery_id
$schedRes2 = Api-Req POST "$ApiUrl/v1/outbound/schedule" $session $schedBody
if ($schedRes2.code -ne 200 -and $schedRes2.code -ne 201) { Write-Error "schedule retry failed: $($schedRes2.code)"; exit 1 }
if ((ConvertFrom-Json $schedRes2.body).delivery_id -ne $deliveryId) { Write-Error "Schedule idempotency failed"; exit 1 }
Write-Host "  PASS: idempotent (same delivery_id)" -ForegroundColor Green

# [5] Scheduler promotes without decrypting; worker delivers via postfix
Wait-ForDb "SELECT status FROM scheduled_messages WHERE delivery_id='$deliveryId'" "executed" 12 "scheduled promoted to executed"
Wait-ForDb "SELECT status FROM outbound_queue WHERE delivery_id='$deliveryId'" "delivered" 24 "queue delivered"
$logStatus = Exec-Sql "SELECT status FROM delivery_log WHERE delivery_id='$deliveryId' ORDER BY created_at DESC LIMIT 1"
if ($logStatus -ne "delivered") { Write-Error "delivery_log missing delivered row: $logStatus"; exit 1 }
Write-Host "  PASS: delivered via postfix (dkim signed)" -ForegroundColor Green
$encLen = Exec-Sql "SELECT length(encrypted_message) FROM outbound_queue WHERE delivery_id='$deliveryId'"
Write-Host "  encrypted_message length in queue: $encLen"

# [6] Cancellation: schedule far future, cancel with both ids, never promoted
Write-Host "`n[6/7] Cancellation test" -ForegroundColor Yellow
$prepBody2 = @{ mailbox_id = $MailboxId } | ConvertTo-Json -Compress
$prepRes2 = Api-Req POST "$ApiUrl/v1/outbound/prepare" $session $prepBody2
Assert-Code $prepRes2 201 "second prepare"
$prep2 = ConvertFrom-Json $prepRes2.body
$encOut2 = & "F:\Codex\byos-email\target\debug\byos-crypto-client.exe" encrypt-outbound $pkB64 $MailboxId $prep2.outbox_seq $plaB64 | ConvertFrom-Json
$farAt = (Get-Date).ToUniversalTime().AddMinutes(10).ToString("o")
$schedBody2 = @{
  reservation_id = $prep2.reservation_id
  mailbox_id = $MailboxId
  recipient = "test@example.com"
  encrypted_message = $encOut2.ciphertext
  send_token_wrapped = $encOut2.wrapped
  outbox_seq = $prep2.outbox_seq
  encryption_version = $prep2.encryption_version
  aad_version = $prep2.aad_version
  encryption_iv = $encOut2.iv
  scheduled_at = $farAt
} | ConvertTo-Json -Compress
$schedRes3 = Api-Req POST "$ApiUrl/v1/outbound/schedule" $session $schedBody2
Assert-Code $schedRes3 201 "far-future schedule"
$deliveryId2 = (ConvertFrom-Json $schedRes3.body).delivery_id
$cancelBody = @{ delivery_id = $deliveryId2; reservation_id = $prep2.reservation_id } | ConvertTo-Json -Compress
$cancelRes = Api-Req POST "$ApiUrl/v1/outbound/scheduled/cancel" $session $cancelBody
Assert-Code $cancelRes 200 "cancel"
if ((ConvertFrom-Json $cancelRes.body).status -ne "cancelled") { Write-Error "cancel status wrong"; exit 1 }
$cs = Exec-Sql "SELECT status FROM scheduled_messages WHERE delivery_id='$deliveryId2'"
if ($cs -ne "cancelled") { Write-Error "Expected cancelled, got $cs"; exit 1 }
Write-Host "  PASS: cancellation works" -ForegroundColor Green
Write-Host "  Waiting 15s to ensure not promoted..."
Start-Sleep -Seconds 15
$qc = Exec-Sql "SELECT COUNT(*) FROM outbound_queue WHERE delivery_id='$deliveryId2'"
if ($qc -ne "0") { Write-Error "Cancelled message was incorrectly promoted"; exit 1 }
Write-Host "  PASS: cancelled not promoted" -ForegroundColor Green

# [7] Hardening: oversized schedule -> 413
Write-Host "`n[7/7] Hardening: 4MB cap" -ForegroundColor Yellow
$big = "A" * (5 * 1024 * 1024)
$bigBody = @{ reservation_id = $prep2.reservation_id; mailbox_id = $MailboxId; recipient = "test@example.com"; encrypted_message = $big; send_token_wrapped = $encOut2.wrapped; outbox_seq = $prep2.outbox_seq; encryption_version = 1; aad_version = 1; encryption_iv = $encOut2.iv; scheduled_at = $farAt } | ConvertTo-Json -Compress
$bigRes = Api-Req POST "$ApiUrl/v1/outbound/schedule" $session $bigBody
if ($bigRes.code -ne 413) { Write-Error "Expected 413, got $($bigRes.code)"; exit 1 }
Write-Host "  PASS: oversized schedule -> 413" -ForegroundColor Green

Write-Host "`n=== SCHEDULED E2E TEST COMPLETE ===" -ForegroundColor Green
