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

.PARAMETER NoTunnel
When specified, skips launching the public Cloudflare tunnel.

.PARAMETER TunnelPort
Port to expose via the public Cloudflare tunnel (default: 3001 for Webmail & Calendar).
#>

param(
    [switch]$DockerOnly,
    [switch]$NoTunnel,
    [int]$TunnelPort = 3001
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

# Detect local network IP address (for Wi-Fi / LAN mobile testing)
$localIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {$_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254*" -and $_.IPAddress -notlike "172.31.*"} | Select-Object -First 1).IPAddress
if (-not $localIp) { $localIp = "192.168.0.101" }

$env:VITE_HOST = "0.0.0.0"
$env:ASTRO_HOST = "0.0.0.0"
$env:BYOS_ALLOWED_ORIGINS = "http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:3002,http://localhost:3002,http://127.0.0.1:3003,http://localhost:3003,http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4321,http://localhost:4321,http://127.0.0.1:5173,http://localhost:5173,http://${localIp}:3000,http://${localIp}:3001,http://${localIp}:3002,http://${localIp}:3003"
$env:ADMIN_ALLOWED_ORIGINS = "http://127.0.0.1:3003,http://localhost:3003,http://${localIp}:3003"

function Get-FileContentShared([string]$filePath) {
    try {
        if (-not (Test-Path $filePath)) { return $null }
        $fileStream = [System.IO.File]::Open($filePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $streamReader = New-Object System.IO.StreamReader($fileStream)
        $text = $streamReader.ReadToEnd()
        $streamReader.Close()
        $fileStream.Close()
        return $text
    } catch {
        return $null
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

    $timeout = 90
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
        cmd.exe /c "docker compose -f infra/docker-compose.yml up -d 2>nul"
        Write-Host "   Waiting for services to be ready..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 6
    } else {
        Write-Host "   Ensuring Docker frontend containers are stopped (dev mode uses host Vite/Node)..." -ForegroundColor DarkGray
        cmd.exe /c "docker compose -f infra/docker-compose.yml stop webmail control-plane public-site support-crm admin-api 2>nul"
        Write-Host "   Starting backend services (Docker)..." -ForegroundColor DarkGray
        cmd.exe /c "docker compose -f infra/docker-compose.yml up -d postgres redis minio api mail-router storage-worker crypto-worker outbound-worker inbound-bridge postfix rspamd minio-init mailpit 2>nul"
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
    Write-Host "   [!] Docker daemon could not be reached after ${timeout}s." -ForegroundColor Red
    Write-Host "       The backend authentication API (port 8080) requires Docker Desktop to be running." -ForegroundColor Red
    Write-Host "       Please make sure Docker Desktop is launched and the whale icon indicates running." -ForegroundColor Yellow
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

# 2. Clean up old dev servers and tunnels
Write-Host "`n2. Checking for stale frontend, admin, & tunnel processes..." -ForegroundColor Yellow
$ports = @(3000, 3001, 3002, 3003, 8087)
$dockerProcessNames = @("com.docker.backend", "com.docker.service", "Docker Desktop", "wslhost", "wsl", "vmwp", "docker", "docker-proxy", "vpnkit")
foreach ($port in $ports) {
    $pids = @((Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess) | Select-Object -Unique
    foreach ($p in $pids) {
        if ($p -and $p -ne 0 -and $p -ne $PID) {
            $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
            if ($proc -and ($dockerProcessNames -contains $proc.ProcessName)) {
                Write-Host "   Port $port is held by Docker ($($proc.ProcessName)); skipping process termination." -ForegroundColor DarkGray
                continue
            }
            Write-Host "   Stopping stale dev process $p ($($proc.ProcessName)) on port $port" -ForegroundColor DarkGray
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
}
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $env:TEMP -Filter "byos_tunnel*.log" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
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

# 4. Launch Cloudflare Public Tunnel (for phone / external testing)
$publicTunnelUrl = $null
if (-not $NoTunnel) {
    Write-Host "`n4. Starting Public HTTPS Tunnel (Port $TunnelPort)..." -ForegroundColor Yellow
    Write-Host "   Waiting for local dev server on Port $TunnelPort to start listening..." -ForegroundColor DarkGray
    for ($i = 0; $i -lt 15; $i++) {
        $conn = Get-NetTCPConnection -LocalPort $TunnelPort -State Listen -ErrorAction SilentlyContinue
        if ($conn) { break }
        Start-Sleep -Seconds 1
    }

    $cloudflaredPath = Join-Path $PSScriptRoot "cloudflared.exe"
    if (-not (Test-Path $cloudflaredPath)) {
        $existing = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
        if ($existing) {
            $cloudflaredPath = $existing
        } else {
            Write-Host "   Downloading cloudflared.exe for public tunnel..." -ForegroundColor DarkGray
            try {
                Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cloudflaredPath -UseBasicParsing -TimeoutSec 30
            } catch {
                Write-Host "   [!] Cloudflared download failed: $_" -ForegroundColor Yellow
            }
        }
    }

    if (Test-Path $cloudflaredPath) {
        $tunnelLog = Join-Path $env:TEMP ("byos_tunnel_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".log")

        $null = Start-Process -FilePath $cloudflaredPath -ArgumentList "tunnel --url http://127.0.0.1:$TunnelPort" -RedirectStandardError $tunnelLog -PassThru -WindowStyle Hidden
        Write-Host "   Connecting to Cloudflare edge..." -ForegroundColor DarkGray
        
        # Poll using non-blocking shared read for up to 25 seconds
        for ($i = 0; $i -lt 50; $i++) {
            Start-Sleep -Milliseconds 500
            $logContent = Get-FileContentShared $tunnelLog
            if ($logContent) {
                $urlMatches = [regex]::Matches($logContent, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
                if ($urlMatches.Count -gt 0) {
                    $publicTunnelUrl = $urlMatches[$urlMatches.Count - 1].Value
                    break
                }
            }
        }

        if (-not $publicTunnelUrl) {
            Write-Host "   [!] Cloudflare tunnel connection timed out or is still negotiating." -ForegroundColor Yellow
            Write-Host "       Check log: $tunnelLog" -ForegroundColor DarkGray
        }
    }
}

Write-Host "`n=============================================" -ForegroundColor Green
Write-Host "Environment is ready!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
if ($publicTunnelUrl) {
    Set-Content -Path (Join-Path $PSScriptRoot "CURRENT_TUNNEL_URL.txt") -Value $publicTunnelUrl -Encoding utf8
    try { Set-Clipboard -Value $publicTunnelUrl } catch {}
    Write-Host "🌐 PUBLIC HTTPS LINK: $publicTunnelUrl" -ForegroundColor Yellow
    Write-Host "   (Copied to clipboard! Access anywhere on mobile phone without Wi-Fi router isolation)" -ForegroundColor DarkGray
    Write-Host "   (Saved to CURRENT_TUNNEL_URL.txt for easy reference)" -ForegroundColor DarkGray
    Write-Host ""
} else {
    $currentSaved = $null
    $savedPath = Join-Path $PSScriptRoot "CURRENT_TUNNEL_URL.txt"
    if (Test-Path $savedPath) {
        $currentSaved = (Get-Content $savedPath -Raw -ErrorAction SilentlyContinue)
        if ($currentSaved) { $currentSaved = $currentSaved.Trim() }
    }
    if ($currentSaved) {
        Write-Host "🌐 LAST KNOWN TUNNEL LINK: $currentSaved" -ForegroundColor Yellow
        Write-Host "   (From CURRENT_TUNNEL_URL.txt)" -ForegroundColor DarkGray
        Write-Host ""
    }
}
Write-Host "Public Site:   http://127.0.0.1:3002  (Network: http://${localIp}:3002)" -ForegroundColor Cyan
Write-Host "Control Panel: http://127.0.0.1:3000  (Network: http://${localIp}:3000)" -ForegroundColor Cyan
Write-Host "Webmail:       http://127.0.0.1:3001  (Network: http://${localIp}:3001)" -ForegroundColor Cyan
Write-Host "Support CRM:   http://127.0.0.1:3003  (Network: http://${localIp}:3003)" -ForegroundColor Cyan
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
