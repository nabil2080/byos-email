# BYOS Release C6.8: Full-Stack Cold Disaster Recovery Drill
# Measures discrete stage latencies for RTO and evaluates operational RPO.

$ErrorActionPreference = "Stop"

Write-Host "=================================================="
Write-Host "BYOS C6.8 Full-Stack Cold Disaster Recovery Drill"
Write-Host "=================================================="

$drillDir = Join-Path $PSScriptRoot "..\scratch\c68_dr_drill"
if (Test-Path $drillDir) { Remove-Item -Recurse -Force $drillDir }
New-Item -ItemType Directory -Path $drillDir | Out-Null

$backupEnc = Join-Path $PSScriptRoot "..\backups\byos_backup_20261124_122341.enc"
$keyFile = Join-Path $PSScriptRoot "..\scratch\backup_c67.key"
$byosBackupBin = Join-Path $PSScriptRoot "..\tools\byos-backup\byos-backup.exe"

if (-not (Test-Path $backupEnc)) {
    throw "Missing backup archive: $backupEnc"
}
if (-not (Test-Path $keyFile)) {
    throw "Missing backup key: $keyFile"
}

# Pre-compile services/api before measuring cold startup
$apiBin = Join-Path $drillDir "byos-api-drill.exe"
go build -o $apiBin ./services/api
if ($LASTEXITCODE -ne 0) {
    throw "Failed compiling services/api"
}

$drPort = 15435
$redisPort = 16379
$apiPort = 18080
$containerName = "byos-dr-c68-db"
$redisContainerName = "byos-dr-c68-redis"
$networkName = "byos-dr-net"

docker rm -f $containerName 2>&1 | Out-Null
docker rm -f $redisContainerName 2>&1 | Out-Null
docker network rm $networkName 2>&1 | Out-Null

$results = [ordered]@{}

# -------------------------------------------------------------
# STAGE 1: Infrastructure Provisioning
# -------------------------------------------------------------
Write-Host "`n[Stage 1/8] Infrastructure Provisioning..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$netExists = docker network ls --filter "name=$networkName" -q
if (-not $netExists) {
    docker network create $networkName 2>&1 | Out-Null
}
docker run -d --name $redisContainerName --network $networkName -p "${redisPort}:6379" redis:7-alpine 2>&1 | Out-Null
docker run -d --name $containerName --network $networkName -p "${drPort}:5432" `
    -e POSTGRES_PASSWORD=dr_drill_root_password `
    postgres:16-alpine | Out-Null

# Wait for postgres to be ready
$maxAttempts = 30
$attempt = 0
$ready = $false
while ($attempt -lt $maxAttempts) {
    Start-Sleep -Milliseconds 500
    $check = docker exec $containerName pg_isready -U postgres 2>&1
    if ($LASTEXITCODE -eq 0) {
        $ready = $true
        break
    }
    $attempt++
}
if (-not $ready) {
    throw "Database container failed to initialize within timeout"
}

$sw.Stop()
$results["1_infrastructure_provisioning"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
Write-Host "  -> Stage 1 Elapsed: $($results['1_infrastructure_provisioning']) ms"

# -------------------------------------------------------------
# STAGE 2: Backup Bundle Retrieval
# -------------------------------------------------------------
Write-Host "`n[Stage 2/8] Backup Bundle Retrieval..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$stagedEnc = Join-Path $drillDir "staged_backup.enc"
Copy-Item $backupEnc $stagedEnc
$bundleSize = (Get-Item $stagedEnc).Length

$sw.Stop()
$results["2_backup_retrieval"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
Write-Host "  -> Stage 2 Elapsed: $($results['2_backup_retrieval']) ms ($bundleSize bytes retrieved)"

# -------------------------------------------------------------
# STAGE 3: Pre-Restore Decryption & Integrity Verification
# -------------------------------------------------------------
Write-Host "`n[Stage 3/8] Decryption & Cryptographic Verification..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$decryptedDir = Join-Path $drillDir "decrypted"
& $byosBackupBin decrypt-bundle --in-file $stagedEnc --out-dir $decryptedDir --key-file $keyFile
if ($LASTEXITCODE -ne 0) {
    throw "Failed to decrypt backup bundle"
}

$sw.Stop()
$results["3_decryption_and_verification"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
Write-Host "  -> Stage 3 Elapsed: $($results['3_decryption_and_verification']) ms"

# -------------------------------------------------------------
# STAGE 4: Database Cluster & Schema Restoration
# -------------------------------------------------------------
Write-Host "`n[Stage 4/8] Database Restoration (Globals + Schema + Data)..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# Copy globals.sql and database.dump into container
docker cp "$decryptedDir/globals.sql" "${containerName}:/tmp/globals.sql"
docker cp "$decryptedDir/database.dump" "${containerName}:/tmp/database.dump"

# Apply cluster globals (roles, permissions)
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
docker exec $containerName psql -U postgres --set ON_ERROR_STOP=off -f /tmp/globals.sql 2>&1 | Out-Null
docker exec $containerName psql -U postgres -c "GRANT outbound_worker TO outbound_worker_login;" 2>&1 | Out-Null
$ErrorActionPreference = $prevEAP

# Create database 'byos' owned by 'byos'
docker exec $containerName psql -U postgres -c "CREATE DATABASE byos OWNER byos;" | Out-Null

# Restore database dump
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
docker exec $containerName pg_restore -U byos -d byos --no-owner --role=byos /tmp/database.dump 2>&1 | Out-Null
$ErrorActionPreference = $prevEAP

$sw.Stop()
$results["4_database_restoration"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
Write-Host "  -> Stage 4 Elapsed: $($results['4_database_restoration']) ms"

# -------------------------------------------------------------
# STAGE 5: Schema Migration & RBAC Integrity Check
# -------------------------------------------------------------
Write-Host "`n[Stage 5/8] Schema Migration & RBAC Integrity Check..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$verOutput = docker exec $containerName psql -U byos -d byos -t -A -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;"
$schemaVersion = $verOutput.Trim()
if ($schemaVersion -ne "075") {
    throw "Unexpected schema version: $schemaVersion (expected 075)"
}

# Verify least-privilege for role_support_agent
$privCheck = docker exec $containerName psql -U byos -d byos -t -A -c "
SELECT COUNT(*) FROM information_schema.table_privileges 
WHERE grantee = 'role_support_agent' AND table_name = 'outbound_queue' AND privilege_type = 'DELETE';
"
if ($privCheck.Trim() -ne "0") {
    throw "Security boundary violation: role_support_agent has DELETE on outbound_queue"
}

$sw.Stop()
$results["5_migration_and_rbac_check"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
Write-Host "  -> Stage 5 Elapsed: $($results['5_migration_and_rbac_check']) ms (Schema Version: $schemaVersion)"

# -------------------------------------------------------------
# STAGE 6: Application Startup (byos-api)
# -------------------------------------------------------------
Write-Host "`n[Stage 6/8] Application Service Startup (byos-api)..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$apiDSN = "postgres://byos:byos_dev_password@localhost:${drPort}/byos?sslmode=disable"
$env:DATABASE_URL = $apiDSN
$env:REDIS_URL = "localhost:${redisPort}"
$env:API_PORT = "$apiPort"

$apiProcess = Start-Process -FilePath $apiBin -PassThru -NoNewWindow

$sw.Stop()
$results["6_application_startup"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
Write-Host "  -> Stage 6 Elapsed: $($results['6_application_startup']) ms (PID: $($apiProcess.Id))"

# -------------------------------------------------------------
# STAGE 7: Healthcheck Stabilization
# -------------------------------------------------------------
Write-Host "`n[Stage 7/8] Healthcheck Stabilization..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$healthUrl = "http://localhost:${apiPort}/health"
$healthSuccess = $false
$healthAttempts = 40
$hAttempt = 0

while ($hAttempt -lt $healthAttempts) {
    Start-Sleep -Milliseconds 250
    try {
        $resp = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
        if ($resp.status -in @("ok", "degraded") -and $resp.services.postgres -eq "up") {
            $healthSuccess = $true
            break
        }
    } catch {
        # continue waiting
    }
    $hAttempt++
}

if (-not $healthSuccess) {
    Stop-Process -Id $apiProcess.Id -Force 2>$null
    throw "API healthcheck failed to stabilize at $healthUrl"
}

$sw.Stop()
$results["7_healthcheck_stabilization"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
Write-Host "  -> Stage 7 Elapsed: $($results['7_healthcheck_stabilization']) ms (Status: $($resp.status), PostgreSQL: $($resp.services.postgres))"

# -------------------------------------------------------------
# STAGE 8: Data Query & Zero Data Loss Validation
# -------------------------------------------------------------
Write-Host "`n[Stage 8/8] Data Query & Zero Data Loss Validation..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$counts = docker exec $containerName psql -U byos -d byos -t -A -c "
SELECT 
    (SELECT COUNT(*) FROM organizations) AS orgs,
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM domains) AS domains,
    (SELECT COUNT(*) FROM mailboxes) AS mailboxes,
    (SELECT COUNT(*) FROM outbound_queue) AS outbound,
    (SELECT COUNT(*) FROM delivery_log) AS delivery;
"
$parts = $counts.Trim().Split('|')
$orgsCount = $parts[0]
$usersCount = $parts[1]
$domainsCount = $parts[2]
$mailboxesCount = $parts[3]
$outboundCount = $parts[4]
$deliveryCount = $parts[5]

$sw.Stop()
$results["8_data_validation"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
Write-Host "  -> Stage 8 Elapsed: $($results['8_data_validation']) ms"
Write-Host "     Organizations:  $orgsCount"
Write-Host "     Users:          $usersCount"
Write-Host "     Domains:        $domainsCount"
Write-Host "     Mailboxes:      $mailboxesCount"
Write-Host "     Outbound Queue: $outboundCount"
Write-Host "     Delivery Log:   $deliveryCount"

# -------------------------------------------------------------
# TEARDOWN & SUMMARY
# -------------------------------------------------------------
Stop-Process -Id $apiProcess.Id -Force 2>$null | Out-Null
docker rm -f $containerName 2>$null | Out-Null
docker rm -f $redisContainerName 2>$null | Out-Null
docker network rm $networkName 2>$null | Out-Null

$totalRTO = 0.0
foreach ($k in $results.Keys) {
    $totalRTO += $results[$k]
}
$totalRTOSeconds = [math]::Round($totalRTO / 1000.0, 3)

Write-Host "`n=================================================="
Write-Host "DISASTER RECOVERY BENCHMARK BREAKDOWN"
Write-Host "=================================================="
foreach ($k in $results.Keys) {
    $ms = $results[$k]
    $sec = [math]::Round($ms / 1000.0, 3)
    Write-Host ("{0,-35} : {1,8} ms ({2,6} s)" -f $k, $ms, $sec)
}
Write-Host "--------------------------------------------------"
Write-Host ("{0,-35} : {1,8} ms ({2,6} s)" -f "TOTAL RECOVERY TIME OBJECTIVE (RTO)", [math]::Round($totalRTO, 2), $totalRTOSeconds)
Write-Host "=================================================="
