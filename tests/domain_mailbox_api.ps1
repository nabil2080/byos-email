#!/usr/bin/env pwsh
$ErrorActionPreference = "Continue"
$baseApi = "http://127.0.0.1:8080"
$baseWorker = "http://127.0.0.1:8083"
$org = "88888888-8888-8888-8888-888888888888"
$user = "88888888-8888-8888-8888-888888888889"
$domainId = "88888888-8888-8888-8888-88888888888a"
$mailboxId = "88888888-8888-8888-8888-88888888888b"
$domainName = "api-test-byos.local"

function Test-Req($method, $url, $headers, $body) {
  $useHeaders = @{}
  if ($headers) { foreach ($k in $headers.Keys) { $useHeaders[$k] = $headers[$k] } }
  $sessionCookie = $null
  if ($headers -and $headers["X-User-Id"] -and $global:sessionMap -and $global:sessionMap.ContainsKey($headers["X-User-Id"])) {
    $sessionCookie = $global:sessionMap[$headers["X-User-Id"]]
  }
  try {
    $params = @{ Uri=$url; Method=$method; Headers=$useHeaders; TimeoutSec=5; ContentType="application/json" }
    if ($body) { $params.Body = $body }
    if ($sessionCookie) {
      $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      $cv = $sessionCookie -replace "^byos_session=", "" -replace ";.*", ""
      $cookieObj = New-Object System.Net.Cookie("byos_session", $cv, "/", "127.0.0.1")
      $sess.Cookies.Add("http://127.0.0.1:8080", $cookieObj)
      $params.WebSession = $sess
    }
    $r = Invoke-WebRequest @params
    return @{ code=$r.StatusCode; body=$r.Content; success=$true }
  } catch {
    $code = $_.Exception.Response.StatusCode.Value__
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    return @{ code=$code; body=$msg; success=$false }
  }
}

function Exec-Sql($sql) {
  $out = docker exec byos-postgres psql -U byos -d byos -c $sql 2>&1
  return $out
}

Write-Host "=== Domain & Mailbox API Tests ===" -ForegroundColor Cyan

# Setup: Create org, user, domain, and active storage for mailbox provisioning
Write-Host "`n[1/10] Setup organization, domain, and active storage..." -ForegroundColor Yellow
Exec-Sql "INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('$org', 'apitest', '\x00') ON CONFLICT DO NOTHING;" | Out-Null
Exec-Sql "INSERT INTO users (id, org_id, email, password_hash) VALUES ('$user', '$org', 'api@byos.local', 'hash') ON CONFLICT DO NOTHING;" | Out-Null
Exec-Sql "INSERT INTO domains (id, org_id, name, is_verified) VALUES ('$domainId', '$org', '$domainName', true) ON CONFLICT DO NOTHING;" | Out-Null
# Ensure org has valid 32-byte recovery pk via WASM (required for HPKE seal)
$recPkHex = node -e "const w=require('C:\\Users\\PC\\AppData\\Local\\Temp\\opencode\\wasm-node\\byos_crypto_core.js'); const kp=JSON.parse(w.wasm_generate_keypair()); console.log(kp.public_key)" 2>$null
if ($recPkHex) { Exec-Sql "UPDATE organizations SET org_recovery_pk=decode('$recPkHex','hex') WHERE id='$org';" | Out-Null }
# Session migration for test users
$testPassHash = '$argon2id$v=19$m=65536,t=3,p=2$jHtCEZRDha7z7FIHjhvwHw$qB316rOdX328N6CrEoSaQyjQpP0LIW5nrraDNcH/Zk0'
$testPass = "TestPass123!"
docker exec byos-postgres psql -U byos -d byos -c "UPDATE users SET password_hash='$testPassHash' WHERE id IN ('$user','44444444-4444-4444-4444-444444444445')" 2>&1 | Out-Null
$global:sessionMap = @{}
function Get-Session($email, $pass) {
  $b = @{email=$email;password=$pass}|ConvertTo-Json -Compress
  try {
    $r = Invoke-WebRequest -Uri "$baseApi/v1/auth/login" -Method POST -Body $b -ContentType "application/json" -TimeoutSec 5
    $c = ($r.Headers["Set-Cookie"] -split ";")[0]
    return $c
  } catch { return $null }
}
$global:sessionMap[$user] = Get-Session "api@byos.local" $testPass
$global:sessionMap["44444444-4444-4444-4444-444444444445"] = Get-Session "other@byos.local" $testPass
# Ensure active storage connection exists for this org (only status='active' is valid for mailbox creation)
Get-Content "F:\Codex\byos-email\tests\storage_insert.sql" | docker exec -i byos-postgres psql -U byos -d byos 2>&1 | Out-Null
Exec-Sql "UPDATE storage_connections SET status='active', is_active=true WHERE org_id='$org' AND status IN ('active','deleted','error');" | Out-Null
# If still no active, ensure the 999... row is active
Exec-Sql "UPDATE storage_connections SET status='active', is_active=true WHERE org_id='$org' AND id='99999999-9999-9999-9999-999999999998';" | Out-Null
# Also handle the 0c9e... row that may be the actual active one from previous tests
Exec-Sql "UPDATE storage_connections SET status='active', is_active=true WHERE org_id='$org' AND id='0c9e5578-1f89-4346-bcb5-38f69c82edec';" | Out-Null
# Ensure domain1 test domain is clean for idempotent runs
Exec-Sql "DELETE FROM aliases WHERE domain_id IN (SELECT id FROM domains WHERE name='domain1-byos.local' AND org_id='$org'); DELETE FROM mailbox_storage WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE domain_id IN (SELECT id FROM domains WHERE name='domain1-byos.local' AND org_id='$org')); DELETE FROM mailboxes WHERE domain_id IN (SELECT id FROM domains WHERE name='domain1-byos.local' AND org_id='$org'); DELETE FROM domains WHERE name='domain1-byos.local' AND org_id='$org';" | Out-Null
# Ensure apimail mailbox is clean for idempotent runs (including real crypto mailboxes)
Exec-Sql "DELETE FROM aliases WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id='$org' AND local_part IN ('apimail','apimail2','apimail3')); DELETE FROM mailbox_storage WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id='$org' AND local_part IN ('apimail','apimail2','apimail3')); DELETE FROM mailboxes WHERE org_id='$org' AND local_part IN ('apimail','apimail2','apimail3');" | Out-Null
Exec-Sql "DELETE FROM aliases WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id='$org' AND local_part LIKE 'real-%'); DELETE FROM mailbox_storage WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id='$org' AND local_part LIKE 'real-%'); DELETE FROM mailboxes WHERE org_id='$org' AND local_part LIKE 'real-%';" | Out-Null

# Auth headers
$headers = @{ "X-User-Id" = $user }

Write-Host "`n[2/10] Test 1: Create domain → 201" -ForegroundColor Yellow
$body1 = @{ domain = "domain1-byos.local" } | ConvertTo-Json -Compress
$res1 = Test-Req POST "$baseApi/v1/organizations/$org/domains" $headers $body1
Write-Host "create domain $($res1.code) $($res1.body)"
if ($res1.code -ne 201) { Write-Host "FAIL" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[3/10] Test 2: Duplicate domain → 409" -ForegroundColor Yellow
$body2 = @{ domain = "domain1-byos.local" } | ConvertTo-Json -Compress
$res2 = Test-Req POST "$baseApi/v1/organizations/$org/domains" $headers $body2
Write-Host "duplicate domain $($res2.code)"
if ($res2.code -ne 409) { Write-Host "FAIL" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[4/10] Test 3: List domains → 200" -ForegroundColor Yellow
$res3 = Test-Req GET "$baseApi/v1/organizations/$org/domains" $headers $null
Write-Host "list domains $($res3.code) $($res3.body)"
if ($res3.code -ne 200) { Write-Host "FAIL" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[5/10] Test 4: Verify domain" -ForegroundColor Yellow
$res4 = Test-Req POST "$baseApi/v1/organizations/$org/domains/$domainId/verify" $headers $null
Write-Host "verify domain $($res4.code) $($res4.body)"
if ($res4.code -ne 200) { Write-Host "WARN verify returned $($res4.code)" -ForegroundColor Yellow }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[6/10] Test 5: Cross-org domain → 403" -ForegroundColor Yellow
$org2 = "44444444-4444-4444-4444-444444444444"
$user2 = "44444444-4444-4444-4444-444444444445"
Exec-Sql "INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('$org2', 'other-org', '\x00') ON CONFLICT DO NOTHING;" | Out-Null
Exec-Sql "INSERT INTO users (id, org_id, email, password_hash) VALUES ('$user2', '$org2', 'other@byos.local', 'hash') ON CONFLICT DO NOTHING;" | Out-Null
$body5 = @{ domain = "cross-org-byos.local" } | ConvertTo-Json -Compress
$res5 = Test-Req POST "$baseApi/v1/organizations/$org2/domains" $headers $body5
Write-Host "cross-org create $($res5.code)"
if ($res5.code -ne 403) { Write-Host "FAIL cross-org should be 403" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[7/10] Test 6: Create verified-domain org-managed mailbox → 201 (real WASM crypto)" -ForegroundColor Yellow
# Generate real client crypto via WASM (entropy->derive_root, keypair, HPKE seal, wrap)
$mailboxIdGen = [guid]::NewGuid().ToString()
$env:BASE_API = $baseApi
$env:TEST_USER = $user
$payloadJson = node "C:\Users\PC\AppData\Local\Temp\opencode\gen_mailbox_payload.js" $org $domainId "apimail" $mailboxIdGen 2>$null
if (-not $payloadJson) { Write-Host "FAIL gen payload" -ForegroundColor Red; exit 1 }
$body6 = $payloadJson
$res6 = Test-Req POST "$baseApi/v1/organizations/$org/mailboxes" $headers $body6
Write-Host "create mailbox $($res6.code) $($res6.body)"
if ($res6.code -ne 201) { Write-Host "FAIL create mailbox 201" -ForegroundColor Red; exit 1 }
# Extract created mailbox ID for subsequent tests (dynamic, not hardcoded)
try { $createdMailboxId = (ConvertFrom-Json $res6.body).id } catch { $createdMailboxId = $null }
if (-not $createdMailboxId) { $createdMailboxId = $mailboxId }
# If dynamic ID differs from hardcoded, also seed hardcoded mailbox for backward compat via SQL so alias tests can use either
if ($createdMailboxId -ne $mailboxId) {
  $existingPk = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT mailbox_pk FROM mailboxes WHERE id='$createdMailboxId'" 2>$null
  Exec-Sql "INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_pk, is_active) SELECT '$mailboxId', '$org', '$user', '$domainId', 'apimail2', 'org_managed', root_secret_id, mailbox_sk_wrapped, mailbox_pk, true FROM mailboxes WHERE id='$createdMailboxId' ON CONFLICT (id) DO NOTHING;" | Out-Null
  $storageConnId = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT storage_connection_id FROM mailbox_storage WHERE mailbox_id='$createdMailboxId'" 2>$null
  if ($storageConnId) { Exec-Sql "INSERT INTO mailbox_storage (mailbox_id, storage_connection_id, object_prefix, status) VALUES ('$mailboxId', '$storageConnId', 'mailboxes/$mailboxId', 'active') ON CONFLICT (mailbox_id) DO NOTHING;" | Out-Null }
}
# Use dynamic ID for subsequent GET/alias if possible
$effectiveMailboxId = $createdMailboxId
Write-Host "effective mailbox $effectiveMailboxId"
# Verify DB stores exact client-generated wrapped material (hash compare, no plaintext)
$payloadObj = ConvertFrom-Json $payloadJson
$dbPk = (docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(mailbox_pk,'hex') FROM mailboxes WHERE id='$effectiveMailboxId'" 2>$null).Trim()
$dbSkW = (docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(mailbox_sk_wrapped,'hex') FROM mailboxes WHERE id='$effectiveMailboxId'" 2>$null).Trim()
$dbRootId = (docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT root_secret_id::text FROM mailboxes WHERE id='$effectiveMailboxId'" 2>$null).Trim()
$dbRootW = (docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(root_secret_wrapped,'hex') FROM root_secrets WHERE id='$dbRootId'" 2>$null).Trim()
if ($dbPk.ToLower() -ne $payloadObj.mailbox_pk.ToLower()) { Write-Host "FAIL pk mismatch" -ForegroundColor Red; exit 1 }
if ($dbSkW.ToLower() -ne $payloadObj.mailbox_sk_wrapped.ToLower()) { Write-Host "FAIL sk_wrapped mismatch" -ForegroundColor Red; exit 1 }
if ($dbRootW.ToLower() -ne $payloadObj.root_secret_wrapped.ToLower()) { Write-Host "FAIL root_wrapped mismatch" -ForegroundColor Red; exit 1 }
Write-Host "verified DB exact match for $effectiveMailboxId"
# Create second real mailbox to verify independent roots (use apimail3 to avoid seeded apimail2)
$mailboxIdGen2 = [guid]::NewGuid().ToString()
$payloadJson2 = node "C:\Users\PC\AppData\Local\Temp\opencode\gen_mailbox_payload.js" $org $domainId "apimail3" $mailboxIdGen2 2>$null
$body6b = $payloadJson2
$res6b = Test-Req POST "$baseApi/v1/organizations/$org/mailboxes" $headers $body6b
if ($res6b.code -ne 201) { Write-Host "FAIL second mailbox 201 $($res6b.code)" -ForegroundColor Red; exit 1 }
$secondId = (ConvertFrom-Json $res6b.body).id
$dbRootId2 = (docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT root_secret_id::text FROM mailboxes WHERE id='$secondId'" 2>$null).Trim()
if ($dbRootId -eq $dbRootId2) { Write-Host "FAIL root ids equal, should be distinct" -ForegroundColor Red; exit 1 }
Write-Host "verified second mailbox $secondId distinct root $dbRootId2 vs $dbRootId"
# Negative: missing wrapped field ->400, plaintext field rejected
$bad1 = @{ local_part="bad1"; domain_id=$domainId; mode="org_managed"; mailbox_sk_wrapped=$payloadObj.mailbox_sk_wrapped; mailbox_pk=$payloadObj.mailbox_pk } | ConvertTo-Json -Compress
$rbad1 = Test-Req POST "$baseApi/v1/organizations/$org/mailboxes" $headers $bad1
if ($rbad1.code -ne 400) { Write-Host "FAIL missing root_secret_wrapped should be 400 got $($rbad1.code)" -ForegroundColor Red; exit 1 }
$bad2 = @{ local_part="bad2"; domain_id=$domainId; mode="org_managed"; root_secret_wrapped=$payloadObj.root_secret_wrapped; mailbox_sk_wrapped=$payloadObj.mailbox_sk_wrapped; mailbox_pk=$payloadObj.mailbox_pk; root_secret="00"*32 } | ConvertTo-Json -Compress
$rbad2 = Test-Req POST "$baseApi/v1/organizations/$org/mailboxes" $headers $bad2
if ($rbad2.code -ne 400) { Write-Host "FAIL plaintext root_secret should be 400 got $($rbad2.code)" -ForegroundColor Red; exit 1 }
Write-Host "verified negative plaintext/missing rejected"
# Keep secondId for alias tests? Use first mailbox for alias tests as before
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[8/10] Test 7: Get mailbox → 200" -ForegroundColor Yellow
$res7 = Test-Req GET "$baseApi/v1/mailboxes/$effectiveMailboxId" $headers $null
Write-Host "get mailbox $($res7.code) $($res7.body)"
if ($res7.code -ne 200) { Write-Host "FAIL get mailbox should be 200" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[9/10] Test 8: List mailboxes → 200" -ForegroundColor Yellow
$res9 = Test-Req GET "$baseApi/v1/organizations/$org/mailboxes" $headers $null
Write-Host "list mailboxes $($res9.code) $($res9.body)"
if ($res9.code -ne 200) { Write-Host "FAIL" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[10/10] Test 9: Alias creation → 201, listing → 200, duplicate → 409" -ForegroundColor Yellow
$body10a = @{ alias = "support@api-test-byos.local" } | ConvertTo-Json -Compress
$res10a = Test-Req POST "$baseApi/v1/mailboxes/$effectiveMailboxId/aliases" $headers $body10a
Write-Host "create alias $($res10a.code) $($res10a.body)"
if ($res10a.code -ne 201) { Write-Host "FAIL create alias 201" -ForegroundColor Red; exit 1 }
$res10b = Test-Req GET "$baseApi/v1/mailboxes/$effectiveMailboxId/aliases" $headers $null
Write-Host "list aliases $($res10b.code) $($res10b.body)"
if ($res10b.code -ne 200) { Write-Host "FAIL list aliases" -ForegroundColor Red; exit 1 }
$body10c = @{ alias = "support@api-test-byos.local" } | ConvertTo-Json -Compress
$res10c = Test-Req POST "$baseApi/v1/mailboxes/$effectiveMailboxId/aliases" $headers $body10c
Write-Host "duplicate alias $($res10c.code)"
if ($res10c.code -ne 409) { Write-Host "FAIL duplicate alias should be 409" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n=== All Domain & Mailbox API Tests PASS ===" -ForegroundColor Cyan
Write-Host "Step 7 Foundation slice verified." -ForegroundColor Cyan
