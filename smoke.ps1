param(
    [switch]$SkipClean
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "                       BYOS SUITE SMOKE VERIFICATION                            " -ForegroundColor Cyan
Write-Host "================================================================================`n" -ForegroundColor Cyan

# 1. Clean test data (unless -SkipClean is provided)
if (-not $SkipClean) {
    Write-Host "[1/3] Resetting environment to clean seed state..." -ForegroundColor Yellow
    $env:BYOS_LOCAL_DEV = "1"
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptDir\clean-test-data.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "clean-test-data.ps1 failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} else {
    Write-Host "[1/3] Skipping cleanup (-SkipClean specified for uncleaned run)..." -ForegroundColor Yellow
}

# 2. Ensure all containers are running
Write-Host "`n[2/3] Checking Docker container health and status..." -ForegroundColor Yellow
docker compose -f "$scriptDir\infra\docker-compose.yml" up -d
if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose up failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

# 3. Browser test suite execution
Write-Host "`n[3/3] Executing Browser Test Suite..." -ForegroundColor Yellow

$tests = @(
    "tests/browser/test_session_isolation.mjs",
    "tests/browser/test_sidebar_restructure.mjs",
    "tests/browser/test_unified_inbox_browser.mjs",
    "tests/browser/test_account_switch_crypto.mjs",
    "tests/browser/test_masked_email.mjs",
    "tests/browser/test_alias_custom.mjs",
    "tests/browser/test_compose_default_account.mjs",
    "tests/browser/test_wire_integrity.mjs",
    "tests/browser/test_focused_inbox.mjs",
    "tests/browser/test_offline.mjs",
    "tests/browser/test_composer.mjs",
    "tests/browser/test_contacts.mjs",
    "tests/browser/test_import.mjs"
)

$results = @{}
$failedTests = @()

foreach ($t in $tests) {
    if (-not $SkipClean) {
        $env:BYOS_LOCAL_DEV = "1"
        & powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptDir\clean-test-data.ps1" | Out-Null
    }
    $testPath = Join-Path $scriptDir $t
    $testName = [System.IO.Path]::GetFileName($t)
    Write-Host "`n>>> RUNNING: $t" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    
    & node --experimental-wasm-modules $testPath
    $code = $LASTEXITCODE
    $sw.Stop()
    
    if ($code -eq 0) {
        $results[$testName] = "PASS ($([math]::Round($sw.Elapsed.TotalSeconds, 1))s)"
        Write-Host ">>> RESULT: PASS ($testName) in $([math]::Round($sw.Elapsed.TotalSeconds, 1))s`n" -ForegroundColor Green
    } else {
        $results[$testName] = "FAIL (exit code $code)"
        $failedTests += $testName
        Write-Host ">>> RESULT: FAIL ($testName) with exit code $code`n" -ForegroundColor Red
    }
}

# 4. Summary report
Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "                            SMOKE TEST SUMMARY                                  " -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

foreach ($t in $tests) {
    $testName = [System.IO.Path]::GetFileName($t)
    $res = $results[$testName]
    if ($res -like "PASS*") {
        Write-Host ("  [PASS] {0,-35} {1}" -f $testName, $res) -ForegroundColor Green
    } else {
        Write-Host ("  [FAIL] {0,-35} {1}" -f $testName, $res) -ForegroundColor Red
    }
}

Write-Host "================================================================================`n" -ForegroundColor Cyan

if ($failedTests.Count -gt 0) {
    Write-Host "SMOKE SUITE FAILED: $($failedTests.Count) test(s) failed." -ForegroundColor Red
    exit 1
} else {
    Write-Host "SMOKE SUITE PASSED: All $($tests.Count) tests passed cleanly." -ForegroundColor Green
    exit 0
}
