<#
.SYNOPSIS
Starts the BYOS Email development environment.

.DESCRIPTION
This script performs a clean startup of the local development environment:
1. Starts all backend services via Docker Compose
2. Ensures development ports (3000, 3001, 3002) are free
3. Launches the three frontend applications
#>

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Starting BYOS Development Environment" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Start Docker containers
Write-Host "`n1. Starting backend services (Docker)..." -ForegroundColor Yellow
cd "$PSScriptRoot"
docker compose -f infra/docker-compose.yml up -d

# Wait for API to be healthy
Write-Host "   Waiting for API to be ready..." -ForegroundColor DarkGray
Start-Sleep -Seconds 5

# 2. Clean up old dev servers
Write-Host "`n2. Checking for stale frontend processes..." -ForegroundColor Yellow
$ports = @(3000, 3001, 3002)
foreach ($port in $ports) {
    $procs = (netstat -ano | Select-String ":$port\s.*LISTEN") -replace '.*\s+(\d+)$','$1' | Select-Object -Unique
    foreach ($p in $procs) {
        $p = $p.Trim()
        if ($p -and $p -ne "0") {
            Write-Host "   Killing stale process $p on port $port" -ForegroundColor DarkGray
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
}
Start-Sleep -Seconds 2

# 3. Start Frontend Applications
Write-Host "`n3. Launching frontend applications..." -ForegroundColor Yellow
Write-Host "   Starting Public Site (Port 3002)..." -ForegroundColor DarkGray
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory "$PSScriptRoot\apps\public-site" -WindowStyle Minimized

Write-Host "   Starting Control Plane (Port 3000)..." -ForegroundColor DarkGray
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory "$PSScriptRoot\apps\control-plane" -WindowStyle Minimized

Write-Host "   Starting Webmail (Port 3001)..." -ForegroundColor DarkGray
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory "$PSScriptRoot\apps\webmail" -WindowStyle Minimized


Write-Host "`n=============================================" -ForegroundColor Green
Write-Host "Environment is ready!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Public Site (Login): http://127.0.0.1:3002" -ForegroundColor Cyan
Write-Host "Control Panel:       http://127.0.0.1:3000" -ForegroundColor Cyan
Write-Host "Webmail:             http://127.0.0.1:3001" -ForegroundColor Cyan
Write-Host ""
Write-Host "Demo Credentials:" -ForegroundColor Magenta
Write-Host "  Email:    admin@demo.local"
Write-Host "  Password: BYOSTest2026!"
Write-Host "=============================================" -ForegroundColor Green
if ([Environment]::UserInteractive) {
    Write-Host "`nPress any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
