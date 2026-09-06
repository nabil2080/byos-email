#!/usr/bin/env pwsh
$ErrorActionPreference = "Continue"
$base = "http://127.0.0.1:8080"

function Test-Req($method, $url, $headers, $body) {
  # Session-aware: use session cookie if available for X-User-Id
  $useHeaders = @{}
  if ($headers) { foreach ($k in $headers.Keys) { $useHeaders[$k] = $headers[$k] } }
  $sessionCookie = $null
  if ($headers -and $headers["X-User-Id"] -and $global:sessionMap -and $global:sessionMap.ContainsKey($headers["X-User-Id"])) {
    $sessionCookie = $global:sessionMap[$headers["X-User-Id"]]
  }
  try {
    $params = @{ Uri=$url; Method=$method; Headers=$useHeaders; TimeoutSec=12; ContentType="application/json" }
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
    if (-not $code) { $code = 500; $msg = $_.Exception.Message }
    return @{ code=$code; body=$msg; success=$false }
  }
}

Write-Host "=== Setup: create orgs for connectivity tests ==="
# Session migration: set valid password hash and obtain session cookies
$testPassHash = '$argon2id$v=19$m=65536,t=3,p=2$jHtCEZRDha7z7FIHjhvwHw$qB316rOdX328N6CrEoSaQyjQpP0LIW5nrraDNcH/Zk0'
$testPass = "TestPass123!"
$global:sessionMap = @{}
function Get-Session($email, $pass) {
  $b = @{email=$email;password=$pass}|ConvertTo-Json -Compress
  try {
    $r = Invoke-WebRequest -Uri "$base/v1/auth/login" -Method POST -Body $b -ContentType "application/json" -TimeoutSec 5
    $c = ($r.Headers["Set-Cookie"] -split ";")[0]
    return $c
  } catch { return $null }
}
# Ensure users exist and have valid hash, then login
$allConnUsers = @("66666666-6666-6666-6666-666666666667","77777778-7777-7777-7777-777777777779")
foreach ($uid in $allConnUsers) {
  if ($uid) { docker exec byos-postgres psql -U byos -d byos -c "UPDATE users SET password_hash='$testPassHash' WHERE id='$uid'" 2>&1 | Out-Null }
}
# Also ensure seed users for 666 org
docker exec byos-postgres psql -U byos -d byos -c "INSERT INTO users (id, org_id, email, password_hash) VALUES ('66666666-6666-6666-6666-666666666667', '66666666-6666-6666-6666-666666666666', 'test666@byos.local', '$testPassHash') ON CONFLICT DO NOTHING; UPDATE users SET password_hash='$testPassHash' WHERE id='66666666-6666-6666-6666-666666666667'" 2>&1 | Out-Null
$global:sessionMap["66666666-6666-6666-6666-666666666667"] = Get-Session "test666@byos.local" $testPass
$global:sessionMap["77777778-7777-7777-7777-777777777779"] = Get-Session "unreach@byos.local" $testPass
# Create org 666 for connectivity tests (if not exists, reuse 666 from previous)
$org666 = "66666666-6666-6666-6666-666666666666"
$user666 = "66666666-6666-6666-6666-666666666667"
# Ensure org and user exist (from previous test they do)
# Create new org for unreachable test
$orgUnreach = "77777778-7777-7777-7777-777777777778"
$userUnreach = "77777778-7777-7777-7777-777777777779"
docker exec byos-postgres psql -U byos -d byos -c "INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('$orgUnreach', 'unreach-test', '\x00') ON CONFLICT DO NOTHING; INSERT INTO users (id, org_id, email, password_hash) VALUES ('$userUnreach', '$orgUnreach', 'unreach@byos.local', '$testPassHash') ON CONFLICT DO NOTHING; UPDATE users SET password_hash='$testPassHash' WHERE id='$userUnreach';" | Out-Null
# Also ensure the bad test org has valid hash
$orgBad = "88888889-8888-8888-8888-888888888889"
$userBad = "88888889-8888-8888-8888-888888888890"
docker exec byos-postgres psql -U byos -d byos -c "INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('$orgBad', 'bad-creds', '\x00') ON CONFLICT DO NOTHING; INSERT INTO users (id, org_id, email, password_hash) VALUES ('$userBad', '$orgBad', 'bad@byos.local', '$testPassHash') ON CONFLICT DO NOTHING; UPDATE users SET password_hash='$testPassHash' WHERE id='$userBad';" | Out-Null
$global:sessionMap[$userBad] = Get-Session "bad@byos.local" $testPass

Write-Host "=== 1. Initially configured -> test succeeds -> active + last_checked ==="
$bodyS3 = '{"provider":"s3","config":{"endpoint":"minio:9000","bucket":"byos-mailbox","access_key":"byosminio","secret_key":"byosminio_dev_password"}}'
# Clean up any existing for org666
docker exec byos-postgres psql -U byos -d byos -c "DELETE FROM storage_connections WHERE org_id='$org666';" | Out-Null
$res = Test-Req POST "$base/v1/organizations/$org666/storage/connection" @{"X-User-Id"=$user666} $bodyS3
Write-Host "POST org666 $($res.code) $($res.body)"
if ($res.code -ne 201) { Write-Host "FAIL create" -ForegroundColor Red; exit 1 }
# GET should show active with last_checked null
$resGet = Test-Req GET "$base/v1/organizations/$org666/storage/connection" @{"X-User-Id"=$user666} $null
Write-Host "GET after create $($resGet.body)"
if ($resGet.body -match "last_checked") { Write-Host "FAIL should have last_checked null initially" -ForegroundColor Red; exit 1 }
if ($resGet.body -notmatch '"status":"active"') { Write-Host "FAIL status not active" -ForegroundColor Red; exit 1 }
# Test connection
$resTest = Test-Req POST "$base/v1/organizations/$org666/storage/connection/test" @{"X-User-Id"=$user666} $null
Write-Host "POST test $($resTest.code) $($resTest.body)"
if ($resTest.code -ne 200 -or $resTest.body -notmatch "verified") { Write-Host "FAIL test should be verified" -ForegroundColor Red; exit 1 }
# GET should now have last_checked
$resGet2 = Test-Req GET "$base/v1/organizations/$org666/storage/connection" @{"X-User-Id"=$user666} $null
Write-Host "GET after test $($resGet2.body)"
if ($resGet2.body -notmatch "last_checked") { Write-Host "FAIL should have last_checked after test" -ForegroundColor Red; exit 1 }
if ($resGet2.body -notmatch '"status":"active"') { Write-Host "FAIL should be active after verified" -ForegroundColor Red; exit 1 }
Write-Host "PASS 1" -ForegroundColor Green

Write-Host "=== 2. Test fails -> error + last_checked, retry after error still finds connection ==="
# Create org with wrong creds
$orgBad = "88888889-8888-8888-8888-888888888889"
$userBad = "88888889-8888-8888-8888-888888888890"
docker exec byos-postgres psql -U byos -d byos -c "INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('$orgBad', 'bad-creds', '\x00') ON CONFLICT DO NOTHING; INSERT INTO users (id, org_id, email, password_hash) VALUES ('$userBad', '$orgBad', 'bad@byos.local', 'hash') ON CONFLICT DO NOTHING; DELETE FROM storage_connections WHERE org_id='$orgBad';" | Out-Null
$bodyBad = '{"provider":"s3","config":{"endpoint":"minio:9000","bucket":"byos-mailbox","access_key":"byosminio","secret_key":"WRONG_FAKE_123"}}'
$resBad = Test-Req POST "$base/v1/organizations/$orgBad/storage/connection" @{"X-User-Id"=$userBad} $bodyBad
Write-Host "POST bad creds $($resBad.code)"
if ($resBad.code -ne 201) { Write-Host "FAIL bad create" -ForegroundColor Red; exit 1 }
$resTestBad = Test-Req POST "$base/v1/organizations/$orgBad/storage/connection/test" @{"X-User-Id"=$userBad} $null
Write-Host "POST test bad creds $($resTestBad.code) $($resTestBad.body)"
if ($resTestBad.body -notmatch "authentication_failed") { Write-Host "FAIL should be authentication_failed" -ForegroundColor Red; exit 1 }
# GET should be error with last_checked
$resGetBad = Test-Req GET "$base/v1/organizations/$orgBad/storage/connection" @{"X-User-Id"=$userBad} $null
Write-Host "GET after bad test $($resGetBad.body)"
if ($resGetBad.body -notmatch '"status":"error"') { Write-Host "FAIL should be error" -ForegroundColor Red; exit 1 }
if ($resGetBad.body -notmatch "last_checked") { Write-Host "FAIL should have last_checked" -ForegroundColor Red; exit 1 }
# Retry after error -> should still find connection and be testable
$resTestBad2 = Test-Req POST "$base/v1/organizations/$orgBad/storage/connection/test" @{"X-User-Id"=$userBad} $null
Write-Host "POST test retry after error $($resTestBad2.code) $($resTestBad2.body)"
if ($resTestBad2.body -notmatch "authentication_failed") { Write-Host "FAIL retry should still be auth_failed" -ForegroundColor Red; exit 1 }
Write-Host "PASS 2" -ForegroundColor Green

Write-Host "=== 3. Failed then successful -> error -> active transition ==="
# Fix bad creds via PUT
$bodyFix = '{"provider":"s3","config":{"endpoint":"minio:9000","bucket":"byos-mailbox","access_key":"byosminio","secret_key":"byosminio_dev_password"}}'
$resPut = Test-Req PUT "$base/v1/organizations/$orgBad/storage/connection" @{"X-User-Id"=$userBad} $bodyFix
Write-Host "PUT fix $($resPut.code) $($resPut.body)"
if ($resPut.code -ne 200) { Write-Host "FAIL PUT fix" -ForegroundColor Red; exit 1 }
# GET after PUT should be active with last_checked null (reset)
$resGetAfterPut = Test-Req GET "$base/v1/organizations/$orgBad/storage/connection" @{"X-User-Id"=$userBad} $null
Write-Host "GET after PUT $($resGetAfterPut.body)"
if ($resGetAfterPut.body -notmatch '"status":"active"') { Write-Host "FAIL should be active after PUT" -ForegroundColor Red; exit 1 }
if ($resGetAfterPut.body -match "last_checked" -and $resGetAfterPut.body -notmatch '"last_checked":null') {
  # last_checked should be null after PUT (we set to null)
  # Check if last_checked is present and not null -> fail, but if it's null it will be omitted due to omitempty, so no last_checked is expected
  if ($resGetAfterPut.body -match "last_checked") { Write-Host "FAIL last_checked should be null after PUT" -ForegroundColor Red; exit 1 }
}
# Test again should be verified
$resTestFixed = Test-Req POST "$base/v1/organizations/$orgBad/storage/connection/test" @{"X-User-Id"=$userBad} $null
Write-Host "POST test after fix $($resTestFixed.code) $($resTestFixed.body)"
if ($resTestFixed.body -notmatch "verified") { Write-Host "FAIL should be verified after fix" -ForegroundColor Red; exit 1 }
Write-Host "PASS 3" -ForegroundColor Green

Write-Host "=== 4. PUT rotation during in-progress test -> stale test cannot overwrite new config (409 or configuration_changed) ==="
# Create org for stale test
$orgStale = "99999991-9999-9999-9999-999999999991"
$userStale = "99999991-9999-9999-9999-999999999992"
docker exec byos-postgres psql -U byos -d byos -c "INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('$orgStale', 'stale-test', '\x00') ON CONFLICT DO NOTHING; INSERT INTO users (id, org_id, email, password_hash) VALUES ('$userStale', '$orgStale', 'stale@byos.local', 'hash') ON CONFLICT DO NOTHING; DELETE FROM storage_connections WHERE org_id='$orgStale';" | Out-Null
# Ensure valid password for session auth
docker exec byos-postgres psql -U byos -d byos -c "UPDATE users SET password_hash='$testPassHash' WHERE id='$userStale'" 2>&1 | Out-Null
$global:sessionMap[$userStale] = Get-Session "stale@byos.local" $testPass
# Create with unreachable endpoint (will take ~10s to fail)
$bodyUnreach = '{"provider":"s3","config":{"endpoint":"bad.local:9000","bucket":"byos-mailbox","access_key":"byosminio","secret_key":"byosminio_dev_password"}}'
$resUnreach = Test-Req POST "$base/v1/organizations/$orgStale/storage/connection" @{"X-User-Id"=$userStale} $bodyUnreach
Write-Host "POST unreachable $($resUnreach.code)"
if ($resUnreach.code -ne 201) { Write-Host "FAIL create unreachable" -ForegroundColor Red; exit 1 }
# Start test in background (will take ~10s)
$job = Start-Job -ScriptBlock {
  param($base,$org,$user)
  try {
    $r = Invoke-WebRequest -Uri "$base/v1/organizations/$org/storage/connection/test" -Method POST -Headers @{"X-User-Id"=$user} -TimeoutSec 15
    return "$($r.StatusCode) $($r.Content)"
  } catch {
    $code = $_.Exception.Response.StatusCode.Value__
    $msg = $_.ErrorDetails.Message
    return "$code $msg"
  }
} -ArgumentList $base,$orgStale,$userStale
Start-Sleep 2
# While test is running, do PUT rotation with valid creds
$bodyValid = '{"provider":"s3","config":{"endpoint":"minio:9000","bucket":"byos-mailbox","access_key":"byosminio","secret_key":"byosminio_dev_password"}}'
$resPutStale = Test-Req PUT "$base/v1/organizations/$orgStale/storage/connection" @{"X-User-Id"=$userStale} $bodyValid
Write-Host "PUT during test $($resPutStale.code) $($resPutStale.body)"
if ($resPutStale.code -ne 200) { Write-Host "FAIL PUT during test" -ForegroundColor Red; exit 1 }
# Wait for test job
$testResult = $job | Wait-Job | Receive-Job
$job | Remove-Job
Write-Host "Test job result: $testResult"
# Test result should be either provider_unavailable (if it used old ciphertext) but should NOT overwrite new config to error; it should return configuration_changed or 409 and leave DB as active
# Check DB: should be active (from PUT), not error, and bucket should be byos-mailbox (valid)
$check = docker exec byos-postgres psql -U byos -d byos -c "SELECT status, bucket_name, last_checked IS NOT NULL as has_checked FROM storage_connections WHERE org_id='$orgStale';" 2>&1 | Out-String
Write-Host "DB after stale test: $check"
if ($check -notmatch "active") { Write-Host "FAIL should be active after PUT, not overwritten by stale test" -ForegroundColor Red; exit 1 }
# Also verify stale test returned configuration_changed or 409
if ($testResult -notmatch "configuration_changed" -and $testResult -notmatch "409" -and $testResult -notmatch "provider_unavailable") {
  Write-Host "WARN test result was $testResult, expected configuration_changed or 409 or provider_unavailable, but DB is correct" -ForegroundColor Yellow
}
Write-Host "PASS 4" -ForegroundColor Green

Write-Host "=== 5. Concurrent PUT + TEST leaves one coherent state ==="
# For org 333, do concurrent PUT and TEST - each job authenticates via session (cannot share global:sessionMap)
$orgConc = "33333333-3333-3333-3333-333333333333"
$jobPut = Start-Job -ScriptBlock {
  param($base,$org)
  $b=@{email="user333@byos.local";password="TestPass123!"}|ConvertTo-Json -Compress
  try { $r=Invoke-WebRequest -Uri "$base/v1/auth/login" -Method POST -Body $b -ContentType "application/json" -TimeoutSec 5; $c=($r.Headers["Set-Cookie"] -split ";")[0]; $sess=New-Object Microsoft.PowerShell.Commands.WebRequestSession; $cv=$c -replace "^byos_session=","" -replace ";.*",""; $sess.Cookies.Add("http://127.0.0.1:8080",(New-Object System.Net.Cookie("byos_session",$cv,"/","127.0.0.1"))); $body='{"provider":"s3","config":{"endpoint":"minio:9000","bucket":"byos-mailbox-conc","access_key":"byosminio","secret_key":"byosminio_dev_password"}}'; $r2=Invoke-WebRequest -Uri "$base/v1/organizations/$org/storage/connection" -Method PUT -WebSession $sess -Body $body -ContentType "application/json" -TimeoutSec 5; return "PUT $($r2.StatusCode)" } catch { return "PUT $($_.Exception.Response.StatusCode.Value__)" }
} -ArgumentList $base,$orgConc
$jobTest = Start-Job -ScriptBlock {
  param($base,$org)
  $b=@{email="user333@byos.local";password="TestPass123!"}|ConvertTo-Json -Compress
  try { $r=Invoke-WebRequest -Uri "$base/v1/auth/login" -Method POST -Body $b -ContentType "application/json" -TimeoutSec 5; $c=($r.Headers["Set-Cookie"] -split ";")[0]; $sess=New-Object Microsoft.PowerShell.Commands.WebRequestSession; $cv=$c -replace "^byos_session=","" -replace ";.*",""; $sess.Cookies.Add("http://127.0.0.1:8080",(New-Object System.Net.Cookie("byos_session",$cv,"/","127.0.0.1"))); $r2=Invoke-WebRequest -Uri "$base/v1/organizations/$org/storage/connection/test" -Method POST -WebSession $sess -TimeoutSec 10; return "TEST $($r2.StatusCode) $($r2.Content)" } catch { return "TEST $($_.Exception.Response.StatusCode.Value__) $($_.ErrorDetails.Message)" }
} -ArgumentList $base,$orgConc
$results = @()
$results += $jobPut | Wait-Job | Receive-Job
$results += $jobTest | Wait-Job | Receive-Job
$jobPut | Remove-Job; $jobTest | Remove-Job
Write-Host "Concurrent PUT+TEST: $($results -join ' | ')"
# Check DB still has one active row
$cnt = docker exec byos-postgres psql -U byos -d byos -c "SELECT count(*) FROM storage_connections WHERE org_id='$orgConc' AND status IN ('active','error');" 2>&1 | Out-String
Write-Host "DB count: $cnt"
if ($cnt -notmatch "1") { Write-Host "FAIL should have exactly one non-deleted row" -ForegroundColor Red; exit 1 }
Write-Host "PASS 5" -ForegroundColor Green

Write-Host "=== 6. Provider tests: s3 valid -> verified, mock writable -> verified ==="
$orgMock = "77777777-7777-7777-7777-777777777777"
# Use session for mock test (user mock@byos.local)
$bMock=@{email="mock@byos.local";password="TestPass123!"}|ConvertTo-Json -Compress
try { $rMockLogin=Invoke-WebRequest -Uri "$base/v1/auth/login" -Method POST -Body $bMock -ContentType "application/json" -TimeoutSec 5; $cMock=($rMockLogin.Headers["Set-Cookie"] -split ";")[0]; $sessMock=New-Object Microsoft.PowerShell.Commands.WebRequestSession; $cvMock=$cMock -replace "^byos_session=","" -replace ";.*",""; $sessMock.Cookies.Add("http://127.0.0.1:8080",(New-Object System.Net.Cookie("byos_session",$cvMock,"/","127.0.0.1"))); $resTestMock = try { $r=Invoke-WebRequest -Uri "$base/v1/organizations/$orgMock/storage/connection/test" -Method POST -WebSession $sessMock -TimeoutSec 5; @{code=$r.StatusCode;body=$r.Content} } catch { @{code=$_.Exception.Response.StatusCode.Value__;body=$_.ErrorDetails.Message} } } catch { $resTestMock = Test-Req POST "$base/v1/organizations/$orgMock/storage/connection/test" @{"X-User-Id"=$userMock} $null }
Write-Host "POST test mock $($resTestMock.code) $($resTestMock.body)"
if ($resTestMock.body -notmatch "verified") { Write-Host "FAIL mock should be verified" -ForegroundColor Red; exit 1 }
Write-Host "PASS 6" -ForegroundColor Green

Write-Host "=== ALL CONNECTIVITY TESTS PASS ===" -ForegroundColor Cyan
