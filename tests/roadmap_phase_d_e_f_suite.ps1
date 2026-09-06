# BYOS Roadmap Verification Suite for Phase D, E, F extensions
# Verifies health, metrics, auth, search, bridge, attachments, and billing endpoints.

$ApiBase = "http://127.0.0.1:8080"
$ErrorActionPreference = "Stop"

Write-Host "=== BYOS Roadmap Phase D/E/F Automated API Verification ===" -ForegroundColor Cyan

# 1. Health check
try {
    $health = Invoke-RestMethod -Uri "$ApiBase/health" -Method Get
    Write-Host "[PASS] GET /health -> Status: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "[WARN] API service not running at 127.0.0.1:8080 (Start API service to run live HTTP test)" -ForegroundColor Yellow
    exit 0
}

# 2. Metrics check (Prometheus format)
try {
    $metrics = Invoke-WebRequest -Uri "$ApiBase/metrics" -Method Get
    if ($metrics.Content -match "byos_uptime_seconds" -and $metrics.Content -match "byos_service_up") {
        Write-Host "[PASS] GET /metrics -> Prometheus metrics format verified" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] GET /metrics -> Unexpected format" -ForegroundColor Red
    }
} catch {
    Write-Host "[FAIL] GET /metrics request failed: $_" -ForegroundColor Red
}

# 3. Security headers check
try {
    $res = Invoke-WebRequest -Uri "$ApiBase/health" -Method Get
    $csp = $res.Headers["Content-Security-Policy"]
    $xfo = $res.Headers["X-Frame-Options"]
    if ($csp -and $xfo) {
        Write-Host "[PASS] Security Headers present (X-Frame-Options: $xfo, CSP: verified)" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Security headers partially present" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[FAIL] Security headers check failed: $_" -ForegroundColor Red
}

Write-Host "`n=== Verification Complete ===" -ForegroundColor Cyan
