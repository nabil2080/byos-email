<#
.SYNOPSIS
Starts the BYOS Email development environment.

.DESCRIPTION
This script performs a clean startup of the local development environment:
1. Starts backend services via Docker Compose
2. Ensures development ports (3000, 3001, 3002, 3003, 8087) are free
3. Launches the four frontend applications and Admin API

.PARAMETER DockerOnly
When specified, builds and starts all backend and frontend services inside Docker containers.
#>

param(
    [switch]$DockerOnly
)

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Starting BYOS Development Environment" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Ensure Node.js, Git, and Go are available in PATH
$knownPaths = @("F:\ProgramFiles\nodejs", "F:\ProgramFiles\Git\cmd", "F:\Go\bin", "C:\Program Files\nodejs", "C:\Program Files\Git\cmd")
foreach ($p in $knownPaths) {
    if ((Test-Path $p) -and ($env:PATH -notlike "*$p*")) {
        $env:PATH = "$p;" + $env:PATH
    }
}
$npmPath = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmPath) {
    if (Test-Path "F:\ProgramFiles\nodejs\npm.cmd") {
        $npmPath = "F:\ProgramFiles\nodejs\npm.cmd"
    } else {
        $npmPath = "npm.cmd"
    }
}

# 1. Start Docker containers
Write-Host "`n1. Checking Docker backend services..." -ForegroundColor Yellow
$dockerReady = $false
try {
    $ver = docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $ver) { $dockerReady = $true }
} catch {}

if (-not $dockerReady) {
    Write-Host "   Docker daemon is not responding. Checking Docker Desktop..." -ForegroundColor Yellow
    $dockerExes = @(
        "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
        "C:\Program Files\Docker\Docker\Docker Desktop.exe",
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    )
    $foundExe = $dockerExes | Where-Object { Test-Path $_ } | Select-Object -First 1
    $backendExe = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\com.docker.backend.exe"

    $runningDocker = Get-Process -Name "Docker Desktop", "com.docker.backend" -ErrorAction SilentlyContinue
    if (-not $runningDocker) {
        if ($foundExe) {
            Write-Host "   Starting Docker Desktop ($foundExe)..." -ForegroundColor DarkGray
            Start-Process -FilePath $foundExe -WorkingDirectory (Split-Path -Parent $foundExe)
        } elseif (Test-Path $backendExe) {
            Write-Host "   Starting Docker backend ($backendExe)..." -ForegroundColor DarkGray
            Start-Process -FilePath $backendExe -WorkingDirectory (Split-Path -Parent $backendExe)
        }
    } else {
        Write-Host "   Docker process detected; waiting for engine to finish starting..." -ForegroundColor DarkGray
    }

    $timeout = 60
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeout) {
        Start-Sleep -Seconds 2
        try {
            $ver = docker info --format '{{.ServerVersion}}' 2>$null
            if ($LASTEXITCODE -eq 0 -and $ver) {
                $dockerReady = $true
                break
            }
        } catch {}
        $elapsed = [math]::Round($sw.Elapsed.TotalSeconds)
        Write-Host -NoNewline "`r   Waiting for Docker daemon to respond... (${elapsed}s/${timeout}s) "
    }
    Write-Host ""
}

if ($dockerReady) {
    cd "$PSScriptRoot"
    if ($DockerOnly) {
        Write-Host "   Starting ALL services (backend + 4 frontend apps + admin-api) via Docker Compose..." -ForegroundColor DarkGray
        docker compose -f infra/docker-compose.yml up -d
        Write-Host "   Waiting for services to be ready..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 6
    } else {
        Write-Host "   Starting backend services (Docker)..." -ForegroundColor DarkGray
        docker compose -f infra/docker-compose.yml up -d postgres redis minio api mail-router storage-worker crypto-worker outbound-worker inbound-bridge postfix rspamd minio-init mailpit
        Write-Host "   Waiting for API health check (http://127.0.0.1:8080/health)..." -ForegroundColor DarkGray
        $apiReady = $false
        for ($i = 0; $i -lt 30; $i++) {
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 2 -ErrorAction Stop
                if ($health.status -eq "ok") {
                    $apiReady = $true
                    break
                }
            } catch {}
            Start-Sleep -Seconds 1
        }
        if ($apiReady) {
            Write-Host "   Backend API is online and healthy!" -ForegroundColor Green
        } else {
            Write-Host "   [!] Backend API is not responding on port 8080 yet. Check 'docker compose logs api'." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "   [!] Docker daemon could not be reached after 60s." -ForegroundColor Red
    Write-Host "       Please ensure Docker Desktop is running before using backend services." -ForegroundColor Red
    Write-Host "       Continuing with frontend and admin services startup..." -ForegroundColor Yellow
}

if ($DockerOnly) {
    Write-Host "`n=============================================" -ForegroundColor Green
    Write-Host "Environment is ready (Docker Containers)!" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Public Site:   http://127.0.0.1:3002" -ForegroundColor Cyan
    Write-Host "Control Panel: http://127.0.0.1:3000" -ForegroundColor Cyan
    Write-Host "Webmail:       http://127.0.0.1:3001" -ForegroundColor Cyan
    Write-Host "Support CRM:   http://127.0.0.1:3003" -ForegroundColor Cyan
    Write-Host "Admin API:     http://127.0.0.1:8087" -ForegroundColor Cyan
    Write-Host "Mailpit:       http://127.0.0.1:8025" -ForegroundColor Cyan
    return
}

# 2. Clean up old dev servers
Write-Host "`n2. Checking for stale frontend & admin processes..." -ForegroundColor Yellow
$ports = @(3000, 3001, 3002, 3003, 8087)
foreach ($port in $ports) {
    $pids = @((Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess) | Select-Object -Unique
    foreach ($p in $pids) {
        if ($p -and $p -ne 0 -and $p -ne $PID) {
            Write-Host "   Stopping stale process $p on port $port" -ForegroundColor DarkGray
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
}
Start-Sleep -Seconds 2

# 3. Start Frontend Applications & Admin Services
Write-Host "`n3. Launching frontend applications & admin services..." -ForegroundColor Yellow

Write-Host "   Starting Admin API (Port 8087)..." -ForegroundColor DarkGray
$env:PORT = "8087"
$env:BYOS_DEV_MODE = "1"
$env:SUPPORT_DB_URL = "postgres://role_support_agent:support_crm_password@localhost:5432/byos"
Start-Process -FilePath "$PSScriptRoot\services\admin-api\admin-api.exe" -WorkingDirectory "$PSScriptRoot\services\admin-api" -WindowStyle Minimized

Write-Host "   Starting Public Site (Port 3002)..." -ForegroundColor DarkGray
$env:ASTRO_DEV_BACKGROUND = "false"
Start-Process -FilePath "cmd.exe" -ArgumentList "/k call `"$npmPath`" run dev" -WorkingDirectory "$PSScriptRoot\apps\public-site" -WindowStyle Minimized

Write-Host "   Starting Control Panel (Port 3000)..." -ForegroundColor DarkGray
Start-Process -FilePath "cmd.exe" -ArgumentList "/k call `"$npmPath`" run dev" -WorkingDirectory "$PSScriptRoot\apps\control-plane" -WindowStyle Minimized

Write-Host "   Starting Webmail (Port 3001)..." -ForegroundColor DarkGray
Start-Process -FilePath "cmd.exe" -ArgumentList "/k call `"$npmPath`" run dev" -WorkingDirectory "$PSScriptRoot\apps\webmail" -WindowStyle Minimized

Write-Host "   Starting Support CRM (Port 3003)..." -ForegroundColor DarkGray
Start-Process -FilePath "cmd.exe" -ArgumentList "/k call `"$npmPath`" run dev" -WorkingDirectory "$PSScriptRoot\apps\support-crm" -WindowStyle Minimized

Write-Host "`n=============================================" -ForegroundColor Green
Write-Host "Environment is ready!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Public Site:   http://127.0.0.1:3002" -ForegroundColor Cyan
Write-Host "Control Panel: http://127.0.0.1:3000" -ForegroundColor Cyan
Write-Host "Webmail:       http://127.0.0.1:3001" -ForegroundColor Cyan
Write-Host "Support CRM:   http://127.0.0.1:3003" -ForegroundColor Cyan
Write-Host "Admin API:     http://127.0.0.1:8087" -ForegroundColor Cyan
Write-Host "Mailpit:       http://127.0.0.1:8025" -ForegroundColor Cyan
Write-Host ""
Write-Host "Demo Credentials (Webmail / Control Panel):" -ForegroundColor Magenta
Write-Host "  Email:    alice@byos.local (or bob@byos.local)"
Write-Host "  Password: test-password-123"
Write-Host "Support CRM Dev Token: mock-support-agent" -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor Green
if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    Write-Host "`nPress any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
