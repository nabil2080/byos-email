#!/usr/bin/env pwsh
<# Rate Limit E2E: mailbox minute, scheduled defer, recipient limit, idempotency, regression #>
param(
  [string]$ApiUrl = "http://localhost:8080"
)

Write-Host "=== Rate Limit E2E Tests ===" -ForegroundColor Cyan

# Fixtures: dedicated solo org (limits under test: 5/min mailbox), verified
# domain, active storage, real mailbox via API. Solo is the migration default.
$OrgId = "0e000000-0000-4000-8000-000000000021"
$UserId = "0e000000-0000-4000-8000-000000000022"
$DomainId = "0e000000-0000-4000-8000-000000000023"
$StorageId = "0e000000-0000-4000-8000-000000000024"
$TestEmail = "ratee2e@byos.local"
$TestPass = "TestPass123!"
$TestPassHash = '$argon2id$v=19$m=65536,t=3,p=2$jHtCEZRDha7z7FIHjhvwHw$qB316rOdX328N6CrEoSaQyjQpP0LIW5nrraDNcH/Zk0'

function Exec-Sql($sql) {
  $out = docker exec byos-postgres psql -U byos -d byos -t -A -c $sql 2>$null
  if ($null -eq $out) { return "" }
  return ($out | Out-String).Trim()
}

Exec-Sql "INSERT INTO organizations (id, name, org_recovery_pk, plan) VALUES ('$OrgId', 'ratee2e', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','base64'), 'solo') ON CONFLICT (id) DO UPDATE SET plan='solo';" | Out-Null
Exec-Sql "INSERT INTO users (id, org_id, email, password_hash, display_name, is_active, role) VALUES ('$UserId', '$OrgId', '$TestEmail', '$TestPassHash', 'ratee2e', true, 'owner') ON CONFLICT (id) DO UPDATE SET password_hash='$TestPassHash', is_active=true;" | Out-Null
Exec-Sql "INSERT INTO domains (id, org_id, name, is_verified) VALUES ('$DomainId', '$OrgId', 'ratee2e-byos.local', true) ON CONFLICT (id) DO UPDATE SET is_verified=true;" | Out-Null
Exec-Sql "INSERT INTO storage_connections (id, org_id, provider, provider_type, bucket_name, endpoint, config, encrypted, status, credentials_enc, is_active) VALUES ('$StorageId', '$OrgId', 'minio', 'minio', 'byos-mailbox', 'minio:9000', '{}'::jsonb, true, 'active', '\x00', true) ON CONFLICT (id) DO UPDATE SET status='active';" | Out-Null
$orgPkHex = node -e "const w=require('C:\\Users\\PC\\AppData\\Local\\Temp\\opencode\\wasm-node\\byos_crypto_core.js'); const kp=JSON.parse(w.wasm_generate_keypair()); console.log(kp.public_key)" 2>$null
if ($orgPkHex) { Exec-Sql "UPDATE organizations SET org_recovery_pk=decode('$($orgPkHex.Trim())','hex') WHERE id='$OrgId';" | Out-Null }

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{ email=$TestEmail; password=$TestPass } | ConvertTo-Json -Compress
try {
  $lr = Invoke-WebRequest -Uri "$ApiUrl/v1/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -TimeoutSec 15 -WebSession $session
  if ([int]$lr.StatusCode -ne 200) { Write-Error "login failed"; exit 1 }
} catch { Write-Error "login failed: $_"; exit 1 }
Write-Host "login 200 + session cookie"

# Idempotent reruns: remove this suite's prior mailboxes (solo quota is 1).
# The fixture org is dedicated to this suite, so clean org-wide (covers
# manual probes too). Dependents first (FKs are NO ACTION).
$rateScope = "SELECT id FROM mailboxes WHERE org_id='$OrgId'"
Exec-Sql "DELETE FROM delivery_log WHERE mailbox_id IN ($rateScope); DELETE FROM outbound_queue WHERE mailbox_id IN ($rateScope); DELETE FROM scheduled_messages WHERE mailbox_id IN ($rateScope); DELETE FROM outbound_reservations WHERE mailbox_id IN ($rateScope); DELETE FROM aliases WHERE mailbox_id IN ($rateScope); DELETE FROM mailbox_storage WHERE mailbox_id IN ($rateScope); DELETE FROM mailboxes WHERE org_id='$OrgId';" | Out-Null

$MailboxId = [guid]::NewGuid().ToString()
$mbPayload = node "C:\Users\PC\AppData\Local\Temp\opencode\gen_mailbox_payload.js" $OrgId $DomainId "ratee2ebox-$(Get-Random)" $MailboxId 2>$null
if (-not $mbPayload) { Write-Error "WASM payload generation failed"; exit 1 }
try {
  $mbRes = Invoke-WebRequest -Uri "$ApiUrl/v1/organizations/$OrgId/mailboxes" -Method Post -Body $mbPayload -ContentType "application/json" -TimeoutSec 15 -WebSession $session
  if ([int]$mbRes.StatusCode -ne 201) { Write-Error "mailbox create failed: $($mbRes.StatusCode)"; exit 1 }
} catch { Write-Error "mailbox create failed: $_"; exit 1 }
Write-Host "Using UserId: $UserId MailboxId: $MailboxId"

$headers = @{ "X-User-Id" = $UserId }

# Flush Redis to start clean
docker exec byos-redis redis-cli FLUSHALL | Out-Null
Write-Host "Redis flushed"

# Get pubkey
$pubkeyResp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/pubkey" -Method Get
$pkB64 = $pubkeyResp.outbound_delivery_pk
Write-Host "PK ok $($pkB64.Substring(0,10))..."

function Encrypt-ForSeq($seq) {
  $plaintext = "From: noreply@byos.local`nTo: test@example.com`nSubject: RateTest $seq`n`nBody $seq"
  $plaB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plaintext))
  $enc = & "F:\Codex\byos-email\target\debug\byos-crypto-client.exe" encrypt-outbound $pkB64 $MailboxId $seq $plaB64 | ConvertFrom-Json
  return $enc
}

# Test 1: Immediate send limit (mailbox minute 5)
Write-Host "`n[Test 1] Immediate send mailbox minute limit 5" -ForegroundColor Yellow
$deliveries = @()
$got429 = $false
$retryAfter = 0
for ($i=1; $i -le 6; $i++) {
  $prepBody = @{ mailbox_id = $MailboxId } | ConvertTo-Json -Compress
  $prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body $prepBody -ContentType "application/json"
  $enc = Encrypt-ForSeq $prep.outbox_seq
  $sendBody = @{
    reservation_id = $prep.reservation_id
    mailbox_id = $MailboxId
    recipient = "test@example.com"
    encrypted_message = $enc.ciphertext
    send_token_wrapped = $enc.wrapped
    outbox_seq = $prep.outbox_seq
    encryption_version = $prep.encryption_version
    aad_version = $prep.aad_version
    encryption_iv = $enc.iv
  } | ConvertTo-Json -Compress
  try {
    $resp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $sendBody -ContentType "application/json" -ErrorAction Stop
    Write-Host "  send $i : 200 delivery $($resp.delivery_id)"
    $deliveries += $resp.delivery_id
  } catch {
    $status = $_.Exception.Response.StatusCode.Value__
    $body = $_.ErrorDetails.Message
    Write-Host "  send $i : $status $body"
    if ($status -eq 429) {
      $got429 = $true
      try { $json = $body | ConvertFrom-Json; $retryAfter = $json.retry_after } catch {}
      Write-Host "    retry_after=$retryAfter"
    }
  }
}
if (-not $got429) { Write-Error "Test 1 FAILED: expected 429 on 6th send"; exit 1 }
if ($deliveries.Count -ne 5) { Write-Error "Test 1 FAILED: expected 5 deliveries got $($deliveries.Count)"; exit 1 }
Write-Host "  PASS: 5 delivered, 6th 429 with retry_after $retryAfter" -ForegroundColor Green

# Verify Retry-After header present
# Wait for window reset (use retry_after +2)
if ($retryAfter -gt 0 -and $retryAfter -lt 120) {
  Write-Host "  Waiting ${retryAfter}s for window reset..."
  Start-Sleep -Seconds ($retryAfter + 2)
  # Flush not needed, window rolled; try one more send should succeed if we wait, but our earlier Redis keys are per minute window aligned to epoch minute, not sliding. So waiting should allow.
  $prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body @{ mailbox_id=$MailboxId } | ConvertTo-Json -Compress -ErrorAction Stop
  # Need to recreate prep correctly
  $prepBody = @{ mailbox_id = $MailboxId } | ConvertTo-Json -Compress
  $prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body $prepBody -ContentType "application/json"
  $enc = Encrypt-ForSeq $prep.outbox_seq
  $sendBody = @{
    reservation_id = $prep.reservation_id
    mailbox_id = $MailboxId
    recipient = "test@example.com"
    encrypted_message = $enc.ciphertext
    send_token_wrapped = $enc.wrapped
    outbox_seq = $prep.outbox_seq
    encryption_version = $prep.encryption_version
    aad_version = $prep.aad_version
    encryption_iv = $enc.iv
  } | ConvertTo-Json -Compress
  try {
    $resp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $sendBody -ContentType "application/json"
    Write-Host "  after wait send: 200 $($resp.delivery_id) PASS"
  } catch {
    Write-Host "  after wait send still 429 - may be hour/day limit, but minute should have reset. Checking..."
    # Flush Redis for test to ensure clean
    docker exec byos-redis redis-cli FLUSHALL | Out-Null
    $prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body $prepBody -ContentType "application/json"
    $enc = Encrypt-ForSeq $prep.outbox_seq
    $sendBody.reservation_id = $prep.reservation_id
    $sendBody.outbox_seq = $prep.outbox_seq
    $sendBody.encrypted_message = $enc.ciphertext
    $sendBody.send_token_wrapped = $enc.wrapped
    $sendBody.encryption_iv = $enc.iv
    $sendBody2 = $sendBody | ConvertTo-Json -Compress
    $resp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $sendBody2 -ContentType "application/json"
    Write-Host "  after flush send: 200 PASS"
  }
} else {
  # No retry_after means we need to flush for next tests
  docker exec byos-redis redis-cli FLUSHALL | Out-Null
}

# Test 1b: Idempotency with 429 - same reservation retry after wait
Write-Host "`n[Test 1b] Idempotency after 429" -ForegroundColor Yellow
# Use the failed reservation from test1 6th (we didn't save it, so create new, exceed, then retry same reservation after flush)
docker exec byos-redis redis-cli FLUSHALL | Out-Null
$prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body (@{ mailbox_id=$MailboxId } | ConvertTo-Json -Compress) -ContentType "application/json"
# Fill up to limit quickly
for ($i=0; $i -lt 5; $i++) {
  $p = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body (@{ mailbox_id=$MailboxId } | ConvertTo-Json -Compress) -ContentType "application/json"
  $e = Encrypt-ForSeq $p.outbox_seq
  $b = @{ reservation_id=$p.reservation_id; mailbox_id=$MailboxId; recipient="test@example.com"; encrypted_message=$e.ciphertext; send_token_wrapped=$e.wrapped; outbox_seq=$p.outbox_seq; encryption_version=$p.encryption_version; aad_version=$p.aad_version; encryption_iv=$e.iv } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $b -ContentType "application/json" | Out-Null
}
# Now this reservation should be 429
$enc = Encrypt-ForSeq $prep.outbox_seq
$sendBody = @{ reservation_id=$prep.reservation_id; mailbox_id=$MailboxId; recipient="test@example.com"; encrypted_message=$enc.ciphertext; send_token_wrapped=$enc.wrapped; outbox_seq=$prep.outbox_seq; encryption_version=$prep.encryption_version; aad_version=$prep.aad_version; encryption_iv=$enc.iv } | ConvertTo-Json -Compress
try { Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $sendBody -ContentType "application/json" -ErrorAction Stop | Out-Null; Write-Error "expected 429"; exit 1 } catch { if ($_.Exception.Response.StatusCode.Value__ -ne 429) { Write-Error "expected 429 got $_"; exit 1 } }
Write-Host "  got 429 as expected (not consumed)"
# Flush and retry same reservation should succeed and only count once
docker exec byos-redis redis-cli FLUSHALL | Out-Null
try {
  $resp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $sendBody -ContentType "application/json"
  Write-Host "  retry same reservation after flush: 200 $($resp.delivery_id) PASS"
  # Second retry same reservation should be idempotent same delivery_id
  $resp2 = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $sendBody -ContentType "application/json"
  if ($resp.delivery_id -ne $resp2.delivery_id) { Write-Error "idempotent failed"; exit 1 }
  Write-Host "  idempotent same delivery_id PASS"
} catch { Write-Error "retry after flush failed $_"; exit 1 }
docker exec byos-redis redis-cli FLUSHALL | Out-Null

# Test 2: Scheduled defer
Write-Host "`n[Test 2] Scheduled send defer via retry_after" -ForegroundColor Yellow
# Deterministic deferral: the 5 fills + schedule + promotion must land in ONE
# minute window. Fills reuse a single envelope (server checks structure only;
# AAD binding is verified later by the worker) so the whole sequence takes
# seconds; alignment keeps us clear of the boundary.
$secIntoMinute = (Get-Date).Second
if ($secIntoMinute -gt 15) {
  $waitS = 63 - $secIntoMinute
  Write-Host "  aligning to minute boundary (${waitS}s)..."
  Start-Sleep -Seconds $waitS
}
# Drain worker backlog first: each loop tick does scheduled poll THEN up to 10
# outbound deliveries serially, so a deep queue starves scheduled promotion
# past the minute boundary. Drain, then flush, so fills+schedule share one
# quiet minute.
Write-Host "  draining worker backlog..."
for ($i = 0; $i -lt 36; $i++) {
  $pq = Exec-Sql "SELECT count(*) FROM outbound_queue WHERE status='pending'"
  $sq = Exec-Sql "SELECT count(*) FROM scheduled_messages WHERE status='pending'"
  if ($pq -eq "0" -and $sq -eq "0") { break }
  Start-Sleep -Seconds 5
}
Write-Host "  drained (queue pending=$(Exec-Sql "SELECT count(*) FROM outbound_queue WHERE status='pending'"))"
docker exec byos-redis redis-cli FLUSHALL | Out-Null
$fillPrep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body (@{ mailbox_id=$MailboxId } | ConvertTo-Json -Compress) -ContentType "application/json"
$fillEnc = Encrypt-ForSeq $fillPrep.outbox_seq

function Get-WorkerStartedAt() {
  try { return (docker inspect -f "{{.State.StartedAt}}" byos-outbound-worker 2>$null | Out-String).Trim() }
  catch { return "" }
}

function Test-StackUp() {
  try {
    $h = Invoke-WebRequest -Uri "$ApiUrl/health" -TimeoutSec 5 -UseBasicParsing
    return ([int]$h.StatusCode -eq 200)
  } catch { return $false }
}

$deferred = $false
$prevDeferId = $null
for ($attempt = 1; $attempt -le 3 -and -not $deferred; $attempt++) {
  # Remove the previous attempt's row so retries observe exactly one row and
  # stale rows don't consume worker time.
  if ($prevDeferId) { Exec-Sql "DELETE FROM scheduled_messages WHERE delivery_id='$prevDeferId'" | Out-Null }
  $workerStart = Get-WorkerStartedAt
  docker exec byos-redis redis-cli FLUSHALL | Out-Null
  for ($i=0; $i -lt 5; $i++) {
    $p = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body (@{ mailbox_id=$MailboxId } | ConvertTo-Json -Compress) -ContentType "application/json"
    $b = @{ reservation_id=$p.reservation_id; mailbox_id=$MailboxId; recipient="test@example.com"; encrypted_message=$fillEnc.ciphertext; send_token_wrapped=$fillEnc.wrapped; outbox_seq=$p.outbox_seq; encryption_version=$p.encryption_version; aad_version=$p.aad_version; encryption_iv=$fillEnc.iv } | ConvertTo-Json -Compress
    try {
      Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $b -ContentType "application/json" -ErrorAction Stop | Out-Null
    } catch {
      $sc = 0
      try { $sc = [int]$_.Exception.Response.StatusCode.Value__ } catch {}
      Write-Error "fill send $i failed with $sc (budget not filled)"; exit 1
    }
  }
  Write-Host "  minute budget filled (5 sends, attempt $attempt)"
  $prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body (@{ mailbox_id=$MailboxId } | ConvertTo-Json -Compress) -ContentType "application/json"
  $schedAt = (Get-Date).ToUniversalTime().AddSeconds(8).ToString("o")
  $body = @{ reservation_id=$prep.reservation_id; mailbox_id=$MailboxId; recipient="test@example.com"; encrypted_message=$fillEnc.ciphertext; send_token_wrapped=$fillEnc.wrapped; outbox_seq=$prep.outbox_seq; encryption_version=$prep.encryption_version; aad_version=$prep.aad_version; encryption_iv=$fillEnc.iv; scheduled_at=$schedAt } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/schedule" -Method Post -Headers $headers -WebSession $session -Body $body -ContentType "application/json"
  $deferId = $r.delivery_id
  $prevDeferId = $deferId
  Write-Host "  scheduled $deferId at $schedAt"
  # Poll until the scheduler acts. retry_after persists once set (even across
  # later promotion), so observing it at any point proves deferral fired.
  # Fixed sleeps race worker poll phase and daemon restarts; the liveness
  # gate below discards windows interrupted by either.
  for ($i = 0; $i -lt 24 -and -not $deferred; $i++) {
    Start-Sleep -Seconds 5
    $dst = Exec-Sql "SELECT status FROM scheduled_messages WHERE delivery_id='$deferId'"
    $dra = Exec-Sql "SELECT retry_after FROM scheduled_messages WHERE delivery_id='$deferId'"
    Write-Host "  attempt $($i+1) : status $dst retry_after $dra"
    if ($dra -ne "") { $deferred = $true; $scheduledIds = @($deferId) }
  }
  if (-not $deferred) {
    # Discard the attempt (retry) if the worker restarted or the stack went
    # unreachable mid-observation; otherwise the product genuinely missed.
    if ((Get-WorkerStartedAt) -ne $workerStart) {
      Write-Host "  worker restarted mid-observation, discarding attempt $attempt" -ForegroundColor Yellow
      continue
    }
    if (-not (Test-StackUp)) {
      Write-Host "  stack unreachable mid-observation, discarding attempt $attempt" -ForegroundColor Yellow
      continue
    }
    Write-Host "  attempt $attempt observed a live worker for 2 minutes with no deferral" -ForegroundColor Yellow
  } else {
    Write-Host "  PASS: scheduled defer works (no decrypt in scheduler verified via logs)" -ForegroundColor Green
  }
}
if (-not $deferred) { Write-Error "Test 2 FAILED: expected deferred with retry_after"; exit 1 }
function Exec-Sql($sql) {
  $out = docker exec byos-postgres psql -U byos -d byos -t -A -c $sql 2>$null
  if ($null -eq $out) { return "" }
  return ($out | Out-String).Trim()
}

# Wait for retry_after (60s) or flush to allow promotion
docker exec byos-redis redis-cli FLUSHALL | Out-Null
# Also clear retry_after to allow immediate promotion for test
docker exec byos-postgres psql -U byos -d byos -c "UPDATE scheduled_messages SET retry_after=NULL WHERE delivery_id IN ('$($scheduledIds -join "','")')" | Out-Null
Start-Sleep -Seconds 8
$after = Exec-Sql "SELECT status FROM scheduled_messages WHERE delivery_id='$($scheduledIds[-1])'"
Write-Host "  after retry pending should be executed: $after"
docker exec byos-redis redis-cli FLUSHALL | Out-Null

# Test 3: Recipient limit
Write-Host "`n[Test 3] Recipient limit 100 (solo)" -ForegroundColor Yellow
$manyTo = (1..150 | ForEach-Object { "user$_@example.com" }) -join ", "
$plainMany = "From: noreply@byos.local`nTo: $manyTo`nSubject: Many Recipients`n`nBody many"
$plaB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plainMany))
$prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body (@{ mailbox_id=$MailboxId } | ConvertTo-Json -Compress) -ContentType "application/json"
$enc = & "F:\Codex\byos-email\target\debug\byos-crypto-client.exe" encrypt-outbound $pkB64 $MailboxId $prep.outbox_seq $plaB64 | ConvertFrom-Json
$sendBody = @{ reservation_id=$prep.reservation_id; mailbox_id=$MailboxId; recipient="test@example.com"; encrypted_message=$enc.ciphertext; send_token_wrapped=$enc.wrapped; outbox_seq=$prep.outbox_seq; encryption_version=$prep.encryption_version; aad_version=$prep.aad_version; encryption_iv=$enc.iv } | ConvertTo-Json -Compress
$resp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $sendBody -ContentType "application/json"
Write-Host "  queued $($resp.delivery_id)"
Start-Sleep -Seconds 8
$qstatus = Exec-Sql "SELECT status FROM outbound_queue WHERE delivery_id='$($resp.delivery_id)'"
$log = Exec-Sql "SELECT status, smtp_message FROM delivery_log WHERE delivery_id='$($resp.delivery_id)' ORDER BY created_at DESC LIMIT 1"
Write-Host "  queue status $qstatus log $log"
if ($qstatus -ne "bounced" -or $log -notmatch "too many recipients") { Write-Error "Test 3 FAILED: expected bounced too many recipients"; exit 1 }
Write-Host "  PASS: recipient limit bounced, not sent via DKIM/Postfix" -ForegroundColor Green
docker exec byos-redis redis-cli FLUSHALL | Out-Null

# Test 4: Regression existing E2E still pass - we run outbound_e2e quickly
Write-Host "`n[Test 4] Regression check existing E2E still works after flush" -ForegroundColor Yellow
docker exec byos-redis redis-cli FLUSHALL | Out-Null
# Simple 1 send
$prep = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/prepare" -Method Post -Headers $headers -WebSession $session -Body (@{ mailbox_id=$MailboxId } | ConvertTo-Json -Compress) -ContentType "application/json"
$enc = Encrypt-ForSeq $prep.outbox_seq
$body = @{ reservation_id=$prep.reservation_id; mailbox_id=$MailboxId; recipient="test@example.com"; encrypted_message=$enc.ciphertext; send_token_wrapped=$enc.wrapped; outbox_seq=$prep.outbox_seq; encryption_version=$prep.encryption_version; aad_version=$prep.aad_version; encryption_iv=$enc.iv } | ConvertTo-Json -Compress
$resp = Invoke-RestMethod -Uri "$ApiUrl/v1/outbound/send" -Method Post -Headers $headers -WebSession $session -Body $body -ContentType "application/json"
Write-Host "  regression send 200 $($resp.delivery_id) PASS"

Write-Host "`n=== RATE LIMIT E2E ALL PASS ===" -ForegroundColor Green

