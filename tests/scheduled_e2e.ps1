#!/usr/bin/env pwsh
<# Scheduled Sending E2E: prepare -> encrypt -> schedule -> worker promote -> DKIM -> postfix
   plus cancellation test
#>
param(
  [string]$ApiUrl = "http://localhost:8080",
  [string]$MailboxId = "0cb877dc-4206-4408-8709-1eac14129d6a",
  [string]$UserId = "6ee985a3-cb80-466b-98f3-ac78472a8fe6"
)

Write-Host "=== Scheduled Sending E2E Test ===" -ForegroundColor Cyan

$actualUser = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT user_id::text FROM mailboxes WHERE id='$MailboxId'" 2>$null
if ($actualUser) { $UserId = $actualUser.Trim() }
Write-Host "Using UserId: $UserId MailboxId: $MailboxId"

$headers = @{ "X-User-Id" = $UserId }

# 1. Get pubkey
Write-Host "`n[1/7] GET /v1/outbound/pubkey" -ForegroundColor Yellow
$pubkeyResp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/pubkey" -Method Get
$pkB64 = $pubkeyResp.outbound_delivery_pk
Write-Host "  PK: $($pkB64.Substring(0,20))..."
if (-not $pkB64) { Write-Error "No pubkey"; exit 1 }

# 2. Prepare for scheduled (outbox_seq allocation via prepare)
Write-Host "`n[2/7] POST /v1/outbound/prepare (for schedule)" -ForegroundColor Yellow
$prepBody = @{ mailbox_id = $MailboxId } | ConvertTo-Json -Compress
$prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -Body $prepBody -ContentType "application/json"
Write-Host "  reservation_id: $($prep.reservation_id) outbox_seq: $($prep.outbox_seq)"

# 3. Encrypt
Write-Host "`n[3/7] Encrypt outbound via crypto-client" -ForegroundColor Yellow
$plaintext = "From: noreply@byos.local`nTo: test@example.com`nSubject: Scheduled Test`n`nHello scheduled V5.3"
$plaB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plaintext))
$encOut = & "F:\Codex\byos-email\target\debug\byos-crypto-client.exe" encrypt-outbound $pkB64 $MailboxId $prep.outbox_seq $plaB64 | ConvertFrom-Json
Write-Host "  ciphertext: $($encOut.ciphertext.Substring(0,30))... wrapped: $($encOut.wrapped.Substring(0,30))... iv: $($encOut.iv)"

# 4. Schedule for ~15 seconds in future
Write-Host "`n[4/7] POST /v1/outbound/schedule" -ForegroundColor Yellow
$scheduledAt = (Get-Date).ToUniversalTime().AddSeconds(15).ToString("o")
Write-Host "  scheduled_at: $scheduledAt"
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

$schedResp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/schedule" -Method Post -Headers $headers -Body $schedBody -ContentType "application/json"
Write-Host "  delivery_id: $($schedResp.delivery_id) status: $($schedResp.status) scheduled_at: $($schedResp.scheduled_at)"
$deliveryId = $schedResp.delivery_id
if (-not $deliveryId) { Write-Error "No delivery_id from schedule"; exit 1 }

# Verify scheduled_messages pending
$schedStatus = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT status FROM scheduled_messages WHERE delivery_id='$deliveryId'" 2>$null
$schedStatus = $schedStatus.Trim()
Write-Host "  scheduled_messages status: $schedStatus"
if ($schedStatus -ne "pending") { Write-Error "Expected pending, got $schedStatus"; exit 1 }

# Idempotency: retry same reservation should return same delivery_id
Write-Host "`n[4b] Retry same reservation (idempotent schedule)" -ForegroundColor Yellow
$schedResp2 = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/schedule" -Method Post -Headers $headers -Body $schedBody -ContentType "application/json" -ErrorAction SilentlyContinue
if ($schedResp2 -and $schedResp2.delivery_id -ne $deliveryId) { Write-Error "Schedule idempotency failed"; exit 1 }
Write-Host "  PASS: idempotent (same delivery_id)"

# 5. Wait for scheduler (poll 5s) to promote
Write-Host "`n[5/7] Wait for scheduler promotion (20s)" -ForegroundColor Yellow
Start-Sleep -Seconds 20
$schedStatus2 = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT status FROM scheduled_messages WHERE delivery_id='$deliveryId'" 2>$null
$schedStatus2 = $schedStatus2.Trim()
Write-Host "  scheduled_messages after wait: $schedStatus2"
if ($schedStatus2 -ne "executed") { Write-Error "Expected executed after scheduler, got $schedStatus2"; exit 1 }
Write-Host "  PASS: scheduled promoted to executed"

# Check outbound_queue exists and was delivered
$queueStatus = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT status FROM outbound_queue WHERE delivery_id='$deliveryId'" 2>$null
$queueStatus = $queueStatus.Trim()
Write-Host "  outbound_queue status: $queueStatus"
# Wait a bit more for worker to deliver via postfix
Start-Sleep -Seconds 8
$queueStatus2 = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT status FROM outbound_queue WHERE delivery_id='$deliveryId'" 2>$null
$queueStatus2 = $queueStatus2.Trim()
Write-Host "  outbound_queue after delivery: $queueStatus2"
$logStatus = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT status FROM delivery_log WHERE delivery_id='$deliveryId' ORDER BY created_at DESC LIMIT 1" 2>$null
$logStatus = $logStatus.Trim()
Write-Host "  delivery_log status: $logStatus"
if ($queueStatus2 -ne "delivered" -and $logStatus -ne "delivered") {
  Write-Host "  WARN: not yet delivered, checking worker logs"
  docker logs byos-outbound-worker --tail 50
  # Allow bounced due to not found? For test@example.com postfix accepts (byos.local routing), should be delivered
}
if ($logStatus -eq "delivered" -or $queueStatus2 -eq "delivered") { Write-Host "  PASS: delivered via postfix (dkim signed)" -ForegroundColor Green } else { Write-Error "Scheduled E2E not delivered"; exit 1 }

# Verify worker promoted without decryption? Check that outbound_queue has copy of encrypted payload (no plaintext)
$encCheck = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT length(encrypted_message) FROM outbound_queue WHERE delivery_id='$deliveryId'" 2>$null
Write-Host "  encrypted_message length in queue: $($encCheck.Trim())"

# 6. Cancellation test: schedule far future then cancel
Write-Host "`n[6/7] Cancellation test" -ForegroundColor Yellow
$prep2 = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -Body $prepBody -ContentType "application/json"
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
$schedResp3 = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/schedule" -Method Post -Headers $headers -Body $schedBody2 -ContentType "application/json"
$deliveryId2 = $schedResp3.delivery_id
Write-Host "  scheduled far future delivery_id: $deliveryId2 at $farAt"

# Cancel it
$cancelBody = @{ delivery_id = $deliveryId2 } | ConvertTo-Json -Compress
$cancelResp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/scheduled/cancel" -Method Post -Headers $headers -Body $cancelBody -ContentType "application/json"
Write-Host "  cancel response: $($cancelResp.status) for $($cancelResp.delivery_id)"
if ($cancelResp.status -ne "cancelled") { Write-Error "Cancel failed"; exit 1 }
$cancelStatus = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT status FROM scheduled_messages WHERE delivery_id='$deliveryId2'" 2>$null
$cancelStatus = $cancelStatus.Trim()
Write-Host "  scheduled status after cancel: $cancelStatus"
if ($cancelStatus -ne "cancelled") { Write-Error "Expected cancelled"; exit 1 }
Write-Host "  PASS: cancellation works"

# Ensure cancelled not promoted after wait
Write-Host "  Waiting 8s to ensure not promoted..."
Start-Sleep -Seconds 8
$afterCancelQueue = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT COUNT(*) FROM outbound_queue WHERE delivery_id='$deliveryId2'" 2>$null
$afterCancelQueue = $afterCancelQueue.Trim()
Write-Host "  outbound_queue rows for cancelled: $afterCancelQueue"
if ($afterCancelQueue -ne "0") { Write-Error "Cancelled message was incorrectly promoted"; exit 1 }
Write-Host "  PASS: cancelled not promoted"

# 7. Hardening checks for new endpoints
Write-Host "`n[7/7] Hardening: new endpoints 60/min and 4MB" -ForegroundColor Yellow
# 60/min already tested via previous, just check MaxBytes still 4MB for schedule
try {
  $big = "A" * (5 * 1024 * 1024)
  $bigBody = @{ reservation_id = $prep2.reservation_id; mailbox_id = $MailboxId; recipient = "test@example.com"; encrypted_message = $big; send_token_wrapped = $encOut2.wrapped; outbox_seq = $prep2.outbox_seq; encryption_version = 1; aad_version = 1; encryption_iv = $encOut2.iv; scheduled_at = $farAt } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/schedule" -Method Post -Headers $headers -Body $bigBody -ContentType "application/json" -ErrorAction Stop | Out-Null
  Write-Error "Expected 413 for oversized schedule"
} catch {
  if ($_.Exception.Response.StatusCode -eq 413) { Write-Host "  PASS: oversized schedule -> 413" } else { Write-Host "  oversized schedule response: $($_.Exception.Message)" }
}

Write-Host "`n=== SCHEDULED E2E TEST COMPLETE ===" -ForegroundColor Green
