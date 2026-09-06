#!/usr/bin/env pwsh
<# Outbound E2E: prepare -> WASM encrypt -> send -> worker decrypt -> postfix #>
param(
  [string]$ApiUrl = "http://localhost:8080",
  [string]$MailboxId = "0cb877dc-4206-4408-8709-1eac14129d6a",
  [string]$UserId = "6ee985a3-cb80-466b-98f3-ac78472a8fe6"
)

Write-Host "=== Outbound E2E Test ===" -ForegroundColor Cyan

# Ensure mailbox exists and get actual user_id
$actualUser = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT user_id::text FROM mailboxes WHERE id='$MailboxId'" 2>$null
if ($actualUser) { $UserId = $actualUser.Trim() }
Write-Host "Using UserId: $UserId MailboxId: $MailboxId"

$headers = @{ "X-User-Id" = $UserId }

# 1. Get pubkey
Write-Host "`n[1/5] GET /v1/outbound/pubkey" -ForegroundColor Yellow
$pubkeyResp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/pubkey" -Method Get
$pkB64 = $pubkeyResp.outbound_delivery_pk
Write-Host "  PK: $pkB64"
if (-not $pkB64) { Write-Error "No pubkey"; exit 1 }

# Get SK for test (from secret file) - only for test verification, not via API
$skB64 = Get-Content F:\Codex\byos-email\infra\secrets\outbound_delivery_sk.b64 -Raw
$skB64 = $skB64.Trim()
Write-Host "  SK available for test: $($skB64.Substring(0,10))..."

# 2. Prepare
Write-Host "`n[2/5] POST /v1/outbound/prepare" -ForegroundColor Yellow
$prepBody = @{ mailbox_id = $MailboxId } | ConvertTo-Json -Compress
$prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -Body $prepBody -ContentType "application/json"
Write-Host "  reservation_id: $($prep.reservation_id) outbox_seq: $($prep.outbox_seq)"

# 3. Encrypt via native crypto-client (WASM path would be via browser, but we use CLI for test)
Write-Host "`n[3/5] Encrypt outbound via crypto-client" -ForegroundColor Yellow
$plaintext = "From: local@byos.local`nTo: test@example.com`nSubject: Outbound Test`n`nHello outbound V5.3"
$plaB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plaintext))
$encOut = & "F:\Codex\byos-email\target\debug\byos-crypto-client.exe" encrypt-outbound $pkB64 $MailboxId $prep.outbox_seq $plaB64 | ConvertFrom-Json
Write-Host "  ciphertext: $($encOut.ciphertext.Substring(0,30))..."
Write-Host "  wrapped: $($encOut.wrapped.Substring(0,30))..."
Write-Host "  iv: $($encOut.iv)"

# 4. Send
Write-Host "`n[4/5] POST /v1/outbound/send" -ForegroundColor Yellow
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

$sendResp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -Body $sendBody -ContentType "application/json"
Write-Host "  delivery_id: $($sendResp.delivery_id) status: $($sendResp.status)"
$deliveryId = $sendResp.delivery_id

# Verify idempotent retry
Write-Host "`n[4b] Retry same reservation (idempotency)" -ForegroundColor Yellow
$sendResp2 = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -Body $sendBody -ContentType "application/json"
Write-Host "  second delivery_id: $($sendResp2.delivery_id)"
if ($sendResp.delivery_id -ne $sendResp2.delivery_id) { Write-Error "Idempotency failed"; exit 1 }
Write-Host "  PASS: idempotent"

# 5. Wait for worker and check status
Write-Host "`n[5/5] Wait for outbound-worker (poll 5s)" -ForegroundColor Yellow
Start-Sleep -Seconds 8
$status = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT status FROM outbound_queue WHERE delivery_id='$deliveryId'" 2>$null
$status = $status.Trim()
Write-Host "  queue status: $status"
$logStatus = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT status FROM delivery_log WHERE delivery_id='$deliveryId' ORDER BY created_at DESC LIMIT 1" 2>$null
Write-Host "  delivery_log status: $($logStatus.Trim())"

# Verify worker cannot decrypt inbound (negative test)
Write-Host "`n[6/6] Negative: worker cannot decrypt inbound wrapper" -ForegroundColor Yellow
$inboundWrap = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(content_key_hpke_wrapped,'base64') FROM message_metadata LIMIT 1" 2>$null
$inboundWrap = $inboundWrap.Trim()
$inboundCipher = docker exec byos-minio sh -c "mc cat local/byos-mailbox/mailboxes/local/00000000000000000001.eml.enc 2>/dev/null | base64 -w 0" 2>$null
# Try to decrypt inbound wrapper with outbound SK (should fail)
$neg = & "F:\Codex\byos-email\target\debug\byos-crypto-client.exe" decrypt-outbound $skB64 $MailboxId 1 $inboundWrap $inboundCipher 2>&1
if ($neg -match "invalid HPKE") { Write-Host "  PASS: outbound SK cannot decrypt inbound" } else { Write-Host "  wrapped inbound decrypt output: $neg" }

Write-Host "`n=== OUTBOUND E2E TEST COMPLETE ===" -ForegroundColor Green
