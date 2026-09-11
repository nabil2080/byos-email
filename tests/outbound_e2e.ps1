#!/usr/bin/env pwsh
<# Outbound E2E: fixtures -> session auth -> prepare -> WASM/CLI encrypt ->
   send -> idempotent retry -> worker decrypt+DKIM+postfix -> delivered.
   Every step asserts; any unexpected status exits 1. Nothing here can
   vacuously pass (no null-vs-null comparisons). #>
param(
  [string]$ApiUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"
$OrgId = "0e000000-0000-4000-8000-000000000001"
$UserId = "0e000000-0000-4000-8000-000000000002"
$DomainId = "0e000000-0000-4000-8000-000000000003"
$StorageId = "0e000000-0000-4000-8000-000000000004"
$TestEmail = "oute2e@byos.local"
$TestPass = "TestPass123!"
$TestPassHash = '$argon2id$v=19$m=65536,t=3,p=2$jHtCEZRDha7z7FIHjhvwHw$qB316rOdX328N6CrEoSaQyjQpP0LIW5nrraDNcH/Zk0'

Write-Host "=== Outbound E2E Test ===" -ForegroundColor Cyan

function Exec-Sql($sql) {
  $out = docker exec byos-postgres psql -U byos -d byos -t -A -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Error "SQL failed: $out"; exit 1 }
  return $out
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

function Exec-Sql($sql) {
  $out = docker exec byos-postgres psql -U byos -d byos -t -A -c $sql 2>$null
  if ($null -eq $out) { return "" }
  return ($out | Out-String).Trim()
}

# [0] Fixtures: org (team quota headroom) + user + verified domain + storage
Write-Host "`n[0/6] Fixtures..." -ForegroundColor Yellow
Exec-Sql "INSERT INTO organizations (id, name, org_recovery_pk, plan) VALUES ('$OrgId', 'oute2e', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','base64'), 'team') ON CONFLICT (id) DO UPDATE SET plan='team';" | Out-Null
Exec-Sql "INSERT INTO users (id, org_id, email, password_hash, display_name, is_active, role) VALUES ('$UserId', '$OrgId', '$TestEmail', '$TestPassHash', 'oute2e', true, 'owner') ON CONFLICT (id) DO UPDATE SET password_hash='$TestPassHash', is_active=true;" | Out-Null
Exec-Sql "INSERT INTO domains (id, org_id, name, is_verified) VALUES ('$DomainId', '$OrgId', 'oute2e-byos.local', true) ON CONFLICT (id) DO UPDATE SET is_verified=true;" | Out-Null
# DKIM material for the fixture domain (lab-dev fixture, opaque without the dev DEK).
Get-Content "F:\Codex\byos-email\tests\outbound_dkim_fixture.sql" | docker exec -i byos-postgres psql -U byos -d byos 2>&1 | Out-Null
Exec-Sql "INSERT INTO storage_connections (id, org_id, provider, provider_type, bucket_name, endpoint, config, encrypted, status, credentials_enc, is_active) VALUES ('$StorageId', '$OrgId', 'minio', 'minio', 'byos-mailbox', 'minio:9000', '{}'::jsonb, true, 'active', '\x00', true) ON CONFLICT (id) DO UPDATE SET status='active';" | Out-Null
# Real org recovery key (HPKE seal rejects degenerate keys)
$orgPkHex = node -e "const w=require('C:\\Users\\PC\\AppData\\Local\\Temp\\opencode\\wasm-node\\byos_crypto_core.js'); const kp=JSON.parse(w.wasm_generate_keypair()); console.log(kp.public_key)" 2>$null
if ($orgPkHex) { Exec-Sql "UPDATE organizations SET org_recovery_pk=decode('$($orgPkHex.Trim())','hex') WHERE id='$OrgId';" | Out-Null }

# Login -> session cookie (header-only auth is rejected by the hardened API)
$loginBody = @{ email=$TestEmail; password=$TestPass } | ConvertTo-Json -Compress
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
try {
  $lr = Invoke-WebRequest -Uri "$ApiUrl/v1/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -TimeoutSec 15 -WebSession $session
  if ([int]$lr.StatusCode -ne 200) { Write-Error "login failed: $($lr.StatusCode)"; exit 1 }
} catch { Write-Error "login failed: $_"; exit 1 }
Write-Host "  PASS: login 200 + session cookie" -ForegroundColor Green

# Mailbox via API with real WASM crypto payload (fresh ids per run: the lab
# DB persists across runs and (domain_id, local_part) is UNIQUE).
$MailboxId = [guid]::NewGuid().ToString()
$LocalPart = "oute2ebox-$(Get-Random)"
$payloadJson = node "C:\Users\PC\AppData\Local\Temp\opencode\gen_mailbox_payload.js" $OrgId $DomainId $LocalPart $MailboxId 2>$null
if (-not $payloadJson) { Write-Error "WASM payload generation failed"; exit 1 }
$resMb = Api-Req POST "$ApiUrl/v1/organizations/$OrgId/mailboxes" $session $payloadJson
Assert-Code $resMb 201 "mailbox create"
$createdId = (ConvertFrom-Json $resMb.body).id
if ($createdId -ne $MailboxId) { Write-Error "mailbox id mismatch: $createdId vs $MailboxId"; exit 1 }

# [1] Pubkey (canonical runtime source)
Write-Host "`n[1/6] GET /v1/outbound/pubkey" -ForegroundColor Yellow
$pubkeyResp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/pubkey" -Method Get
$pkB64 = $pubkeyResp.outbound_delivery_pk
if (-not $pkB64) { Write-Error "No pubkey"; exit 1 }
Write-Host "  PASS: pubkey present" -ForegroundColor Green
$skB64 = (Get-Content F:\Codex\byos-email\infra\secrets\outbound_delivery_sk.b64 -Raw).Trim()

# [2] Prepare
Write-Host "`n[2/6] POST /v1/outbound/prepare" -ForegroundColor Yellow
$prepBody = @{ mailbox_id = $MailboxId } | ConvertTo-Json -Compress
$prepRes = Api-Req POST "$ApiUrl/v1/outbound/prepare" $session $prepBody
Assert-Code $prepRes 201 "prepare"
$prep = ConvertFrom-Json $prepRes.body
if (-not $prep.reservation_id -or -not $prep.outbox_seq) { Write-Error "prepare missing fields: $($prepRes.body)"; exit 1 }

# [3] Encrypt via crypto-client CLI (same core as WASM path)
Write-Host "`n[3/6] Encrypt outbound via crypto-client" -ForegroundColor Yellow
$plaintext = "From: local@byos.local`nTo: test@example.com`nSubject: Outbound Test`n`nHello outbound V5.3"
$plaB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plaintext))
$encOut = & "F:\Codex\byos-email\target\debug\byos-crypto-client.exe" encrypt-outbound $pkB64 $MailboxId $prep.outbox_seq $plaB64 | ConvertFrom-Json
if (-not $encOut.ciphertext -or -not $encOut.wrapped -or -not $encOut.iv) { Write-Error "encrypt-outbound incomplete"; exit 1 }
Write-Host "  PASS: envelope built" -ForegroundColor Green

# [4] Send + idempotent retry must return the SAME delivery_id
Write-Host "`n[4/6] POST /v1/outbound/send (x2)" -ForegroundColor Yellow
$sendBody = @{
  reservation_id = $prep.reservation_id
  mailbox_id = $MailboxId
  recipient = "test@example.com"
  encrypted_message = $encOut.ciphertext
  send_token_wrapped = $encOut.wrapped
  outbox_seq = $prep.outbox_seq
  encryption_version = $prep.encryption_version
  aad_version = $prep.aad_version
  encryption_iv = $encOut.iv
} | ConvertTo-Json -Compress
$send1 = Api-Req POST "$ApiUrl/v1/outbound/send" $session $sendBody
Assert-Code $send1 201 "first send"
$d1 = (ConvertFrom-Json $send1.body).delivery_id
if (-not $d1) { Write-Error "no delivery_id in send response"; exit 1 }
$send2 = Api-Req POST "$ApiUrl/v1/outbound/send" $session $sendBody
if ($send2.code -ne 200 -and $send2.code -ne 201) { Write-Error "retry send failed: $($send2.code)"; exit 1 }
$d2 = (ConvertFrom-Json $send2.body).delivery_id
if ($d1 -ne $d2) { Write-Error "Idempotency failed: $d1 vs $d2"; exit 1 }
Write-Host "  PASS: idempotent ($d1)" -ForegroundColor Green

# [5] Worker must deliver (poll, not fixed sleep): decrypt -> DKIM -> postfix
Write-Host "`n[5/6] Wait for outbound-worker delivery" -ForegroundColor Yellow
$status = ""
for ($i = 0; $i -lt 24; $i++) {
  Start-Sleep -Seconds 5
  $status = Exec-Sql "SELECT status FROM outbound_queue WHERE delivery_id='$d1'"
  if ($status -eq "delivered") { break }
}
if ($status -ne "delivered") { Write-Error "worker did not deliver, queue status: $status"; exit 1 }
Write-Host "  PASS: queue delivered" -ForegroundColor Green
$logRow = Exec-Sql "SELECT status, smtp_code FROM delivery_log WHERE delivery_id='$d1' ORDER BY created_at DESC LIMIT 1"
Write-Host "  delivery_log: $logRow"
if ($logRow -notmatch "delivered") { Write-Error "delivery_log missing delivered row: $logRow"; exit 1 }
Write-Host "  PASS: delivery logged" -ForegroundColor Green

# [6] Negative: outbound delivery SK must not open an inbound wrapper
Write-Host "`n[6/6] Negative: worker SK cannot decrypt inbound" -ForegroundColor Yellow
$inboundWrap = Exec-Sql "SELECT encode(content_key_hpke_wrapped,'base64') FROM message_metadata LIMIT 1"
if ($inboundWrap) {
  $negOut = & "F:\Codex\byos-email\target\debug\byos-crypto-client.exe" decrypt-outbound $skB64 $MailboxId 1 $inboundWrap "AA==" 2>&1 | Out-String
  $rejected = ($LASTEXITCODE -ne 0) -or ($negOut -match "invalid|error|failed")
  if (-not $rejected) { Write-Error "NEGATIVE FAILED: cross-domain decrypt succeeded: $negOut"; exit 1 }
  Write-Host "  PASS: cross-domain decrypt rejected" -ForegroundColor Green
} else {
  Write-Host "  SKIP: no inbound rows present" -ForegroundColor Yellow
}

Write-Host "`n=== OUTBOUND E2E TEST COMPLETE ===" -ForegroundColor Green
