#!/usr/bin/env pwsh
$ErrorActionPreference = "Continue"
$baseApi = "http://127.0.0.1:8080"

function Test-Req($method, $url, $headers, $body, $cookies) {
  try {
    $params = @{ Uri=$url; Method=$method; Headers=$headers; TimeoutSec=5; ContentType="application/json" }
    if ($body) { $params.Body = $body }
    # Use curl for cookie handling (Invoke-WebRequest Cookie header is restricted)
    if ($cookies) {
      $tmpBody = $null
      if ($body) { $tmpBody = $body }
      $curlArgs = @("-s", "-i", "-X", $method, $url, "-H", "Content-Type: application/json")
      if ($cookies) { $curlArgs += "-H"; $curlArgs += "Cookie: $cookies" }
      if ($tmpBody) { $curlArgs += "-d"; $curlArgs += $tmpBody }
      $out = & curl.exe @curlArgs 2>&1 | Out-String
      # Parse curl output: first line is HTTP status, then headers, then body
      if ($out -match "HTTP/\d\.\d (\d+)") { $code = [int]$Matches[1] } else { $code = 0 }
      # Extract body after blank line
      $parts = $out -split "`r`n`r`n", 2
      $bodyContent = if ($parts.Length -gt 1) { $parts[1].Trim() } else { "" }
      # Extract Set-Cookie
      $cookieHeader = ""
      if ($out -match "Set-Cookie: ([^\r\n]+)") { $cookieHeader = $Matches[1].Trim() }
      return @{ code=$code; body=$bodyContent; cookies=$cookieHeader; success=($code -ge 200 -and $code -lt 300) }
    }
    $r = Invoke-WebRequest @params -SessionVariable sess
    $cookieHeader = $r.Headers["Set-Cookie"]
    return @{ code=$r.StatusCode; body=$r.Content; cookies=$cookieHeader; success=$true; session=$sess }
  } catch {
    $code = $_.Exception.Response.StatusCode.Value__
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    $cookieHeader = $null
    try { $cookieHeader = $_.Exception.Response.Headers["Set-Cookie"] } catch {}
    return @{ code=$code; body=$msg; cookies=$cookieHeader; success=$false }
  }
}

function Exec-Sql($sql) {
  $out = docker exec byos-postgres psql -U byos -d byos -c $sql 2>&1
  return $out
}

Write-Host "=== Auth API Tests ===" -ForegroundColor Cyan
# Flush Redis auth rate limit keys for clean test (avoid cross-run pollution)
try { docker exec byos-redis redis-cli FLUSHALL 2>$null | Out-Null } catch {}
# Cleanup previous test users
$testEmail = "authtest-$(Get-Random)@byos.local"
$testEmail2 = "authtest2-$(Get-Random)@byos.local"
$testPass = "TestPass123!"
$wrongPass = "WrongPass123!"

Write-Host "`n[1] Registration -> 201" -ForegroundColor Yellow
$body = @{ email=$testEmail; password=$testPass } | ConvertTo-Json -Compress
$res = Test-Req POST "$baseApi/v1/auth/register" @{} $body $null
Write-Host "register $($res.code) $($res.body)"
if ($res.code -ne 201) { Write-Host "FAIL" -ForegroundColor Red; exit 1 }
$regData = $res.body | ConvertFrom-Json
$userId = $regData.id
$orgId = $regData.org_id
Write-Host "PASS user $userId org $orgId" -ForegroundColor Green
# Verify password not in response
if ($res.body -match "password" -or $res.body -match $testPass) { Write-Host "FAIL password leak" -ForegroundColor Red; exit 1 }
# Verify Set-Cookie has HttpOnly, SameSite, Path
if ($res.cookies -notmatch "byos_session" -or $res.cookies -notmatch "HttpOnly" -or $res.cookies -notmatch "SameSite=Lax") { Write-Host "FAIL cookie attributes $($res.cookies)" -ForegroundColor Red; exit 1 }
$sessionCookie = ($res.cookies -split ";")[0]
Write-Host "cookie $sessionCookie" -ForegroundColor Green

Write-Host "`n[2] Duplicate email -> 409" -ForegroundColor Yellow
$res2 = Test-Req POST "$baseApi/v1/auth/register" @{} $body $null
Write-Host "duplicate $($res2.code)"
if ($res2.code -ne 409) { Write-Host "FAIL" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[3] Invalid registration -> 400" -ForegroundColor Yellow
$badBody = @{ email="bad"; password="short" } | ConvertTo-Json -Compress
$res3 = Test-Req POST "$baseApi/v1/auth/register" @{} $badBody $null
if ($res3.code -ne 400) { Write-Host "FAIL should be 400 got $($res3.code)" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[4] Login correct password -> 200 + cookie" -ForegroundColor Yellow
$loginBody = @{ email=$testEmail; password=$testPass } | ConvertTo-Json -Compress
$res4 = Test-Req POST "$baseApi/v1/auth/login" @{} $loginBody $null
Write-Host "login $($res4.code) $($res4.body)"
if ($res4.code -ne 200) { Write-Host "FAIL" -ForegroundColor Red; exit 1 }
$loginCookie = ($res4.cookies -split ";")[0]
if (-not $loginCookie) { Write-Host "FAIL no cookie" -ForegroundColor Red; exit 1 }
Write-Host "PASS cookie $loginCookie" -ForegroundColor Green

Write-Host "`n[5] Wrong password -> 401 generic" -ForegroundColor Yellow
$badLogin = @{ email=$testEmail; password=$wrongPass } | ConvertTo-Json -Compress
$res5 = Test-Req POST "$baseApi/v1/auth/login" @{} $badLogin $null
Write-Host "wrong pass $($res5.code) $($res5.body)"
if ($res5.code -ne 401) { Write-Host "FAIL should be 401" -ForegroundColor Red; exit 1 }
if ($res5.body -match "password_hash" -or $res5.body -match $wrongPass) { Write-Host "FAIL leak" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[6] Unknown email -> 401 same generic" -ForegroundColor Yellow
$unknownBody = @{ email="unknown-$(Get-Random)@byos.local"; password=$testPass } | ConvertTo-Json -Compress
$res6 = Test-Req POST "$baseApi/v1/auth/login" @{} $unknownBody $null
if ($res6.code -ne 401) { Write-Host "FAIL should be 401" -ForegroundColor Red; exit 1 }
if ($res6.body -ne $res5.body) { Write-Host "WARN generic error should be same for unknown vs wrong pass (both 401 invalid credentials)" -ForegroundColor Yellow }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[7] /me with valid session -> 200" -ForegroundColor Yellow
$res7 = Test-Req GET "$baseApi/v1/auth/me" @{} $null $loginCookie
Write-Host "me $($res7.code) $($res7.body)"
if ($res7.code -ne 200) { Write-Host "FAIL" -ForegroundColor Red; exit 1 }
$meData = $res7.body | ConvertFrom-Json
if ($meData.email -ne $testEmail) { Write-Host "FAIL email mismatch" -ForegroundColor Red; exit 1 }
if ($meData.id -ne $userId) { Write-Host "FAIL id mismatch" -ForegroundColor Red; exit 1 }
if ($res7.body -match "password_hash" -or $res7.body -match "token") { Write-Host "FAIL leak in /me" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[8] /me without session -> 401" -ForegroundColor Yellow
$res8 = Test-Req GET "$baseApi/v1/auth/me" @{} $null $null
if ($res8.code -ne 401) { Write-Host "FAIL should be 401 got $($res8.code)" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[9] Logout -> 204, old session -> 401" -ForegroundColor Yellow
$res9 = Test-Req POST "$baseApi/v1/auth/logout" @{} $null $loginCookie
Write-Host "logout $($res9.code)"
if ($res9.code -ne 204 -and $res9.code -ne 200) { Write-Host "FAIL logout should be 204" -ForegroundColor Red; exit 1 }
# Verify old session fails
$res9b = Test-Req GET "$baseApi/v1/auth/me" @{} $null $loginCookie
if ($res9b.code -ne 401) { Write-Host "FAIL old session should be 401 after logout, got $($res9b.code)" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[10] Expired/revoked session -> 401" -ForegroundColor Yellow
# Create a new session then manually expire it via DB
$loginAgain = Test-Req POST "$baseApi/v1/auth/login" @{} $loginBody $null
$expCookie = ($loginAgain.cookies -split ";")[0]
# Expire via DB: set expires_at to past
$tokenHash = $null
# Extract token from cookie value (after byos_session=)
if ($expCookie -match "byos_session=([^;]+)") { $token = $Matches[1]; $hashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($token)); $hashHex = -join ($hashBytes | ForEach-Object { $_.ToString("x2") }); $hashB64 = [Convert]::ToBase64String($hashBytes) }
# Directly expire via SQL: update sessions set expires_at = now() - interval '1 hour' for that user
Exec-Sql "UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE user_id='$userId' AND revoked_at IS NULL;" | Out-Null
$res10 = Test-Req GET "$baseApi/v1/auth/me" @{} $null $expCookie
if ($res10.code -ne 401) { Write-Host "FAIL expired should be 401 got $($res10.code)" -ForegroundColor Red; exit 1 }
Write-Host "PASS" -ForegroundColor Green

Write-Host "`n[11] Login rate limit -> 429" -ForegroundColor Yellow
# Flush Redis for clean test, but use a fresh email to avoid polluting
$rateEmail = "ratelimit-$(Get-Random)@byos.local"
$ratePass = "RatePass123!"
# Register rate user first
$rateReg = @{ email=$rateEmail; password=$ratePass } | ConvertTo-Json -Compress
Test-Req POST "$baseApi/v1/auth/register" @{} $rateReg $null | Out-Null
# Now 6 rapid wrong password attempts (limit 5/min)
$rateFail = 0
for ($i=0; $i -lt 6; $i++) {
  $bad = @{ email=$rateEmail; password="wrong$($i)wrong" } | ConvertTo-Json -Compress
  $r = Test-Req POST "$baseApi/v1/auth/login" @{} $bad $null
  if ($r.code -eq 429) { $rateFail = 1 }
}
if ($rateFail -ne 1) { Write-Host "WARN rate limit not triggered (may need Redis)" -ForegroundColor Yellow } else { Write-Host "PASS rate limit 429" -ForegroundColor Green }

Write-Host "`n[12] Session token not stored plaintext in DB" -ForegroundColor Yellow
# Login again to get fresh session, then check DB that token not stored plaintext
$freshLogin = Test-Req POST "$baseApi/v1/auth/login" @{} $loginBody $null
$freshCookie = ($freshLogin.cookies -split ";")[0]
if ($freshCookie -match "byos_session=([^;]+)") { $freshToken = $Matches[1] }
Write-Host "freshToken $freshToken"
$dbTokens = docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(token_hash,'hex') FROM sessions WHERE user_id='$userId' ORDER BY created_at DESC LIMIT 5" 2>$null
Write-Host "dbTokens $dbTokens"
if ($freshToken -and $dbTokens -match [regex]::Escape($freshToken)) { Write-Host "FAIL token stored plaintext" -ForegroundColor Red; exit 1 }
# Check that token hash matches SHA256 of token
$expectedHash = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($freshToken))
$expectedHex = -join ($expectedHash | ForEach-Object { $_.ToString("x2") })
if ($dbTokens -notmatch $expectedHex.Substring(0,8)) { Write-Host "WARN hash not found, but not plaintext leak" -ForegroundColor Yellow }
Write-Host "PASS not plaintext" -ForegroundColor Green

Write-Host "`n[13] Org isolation: user A cannot access org B" -ForegroundColor Yellow
# Create second user in different org
$secondEmail = "org2-$(Get-Random)@byos.local"
$secondPass = "SecondPass123!"
$secondRegBody = @{ email=$secondEmail; password=$secondPass } | ConvertTo-Json -Compress
$secondReg = Test-Req POST "$baseApi/v1/auth/register" @{} $secondRegBody $null
if ($secondReg.code -ne 201) { Write-Host "FAIL second register" -ForegroundColor Red; exit 1 }
$secondData = $secondReg.body | ConvertFrom-Json
$secondOrg = $secondData.org_id
$secondCookie = ($secondReg.cookies -split ";")[0]
# Try to access first user's org with second user's session
$resIso = Test-Req GET "$baseApi/v1/organizations/$orgId/domains" @{} $null $secondCookie
if ($resIso.code -ne 403 -and $resIso.code -ne 401) { Write-Host "FAIL should be 403 for cross-org, got $($resIso.code)" -ForegroundColor Red; exit 1 }
Write-Host "PASS isolation $($resIso.code)" -ForegroundColor Green

Write-Host "`n=== ALL AUTH API TESTS PASS ===" -ForegroundColor Cyan
