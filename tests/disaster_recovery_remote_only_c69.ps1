# BYOS C6.9: Remote-Only Disaster Recovery Drill & RPO/RTO Benchmark
# Simulates complete loss of the original PostgreSQL host, data volume, local WAL archive, and local keys.
# Recovers purely from an independent S3-compatible object store (disposable MinIO container)
# and independently retrieved disposable test keys.
#
# STORAGE-DOMAIN CLASSIFICATION: SAME_HOST_OBJECT_STORAGE_TEST (Local integration only; NOT live off-site).
# NON-NEGOTIABLE: Never touches active byos-postgres (port 5432) or production backups.

$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$root = (Get-Item $PSScriptRoot).Parent.FullName
$winBin = Join-Path $root "tools\byos-backup\byos-backup.exe"
$linuxBinHost = (Join-Path $root "tools\byos-backup\byos-backup-linux").Replace('\', '/')

$drillDir = Join-Path $root "scratch\c69_remote_drill"
if (Test-Path $drillDir) { Remove-Item -Recurse -Force $drillDir }
New-Item -ItemType Directory -Force -Path $drillDir | Out-Null

$srcKeyDir = Join-Path $drillDir "src_keys"
$recKeyDir = Join-Path $root "scratch\c69_independent_keys"
if (Test-Path $recKeyDir) { Remove-Item -Recurse -Force $recKeyDir }
New-Item -ItemType Directory -Force -Path $srcKeyDir, $recKeyDir | Out-Null

# Generate disposable 256-bit hex test key (stored in both host key dir and independent recovery key store)
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$keyBytes = New-Object byte[] 32
$rng.GetBytes($keyBytes)
$testKeyHex = ($keyBytes | ForEach-Object { $_.ToString("x2") }) -join ""
$srcKeyFile = Join-Path $srcKeyDir "c69_test_v1.key"
$recKeyFile = Join-Path $recKeyDir "c69_test_v1.key"
[System.IO.File]::WriteAllText($srcKeyFile, $testKeyHex)
[System.IO.File]::WriteAllText($recKeyFile, $testKeyHex)

$srcKeyHost = $srcKeyFile.Replace('\', '/')
$recKeyHost = $recKeyFile.Replace('\', '/')

$netName = "byos_c69_remote_net"
$minioContainer = "byos-c69-minio"
$minioVol = "byos_c69_minio_vol"
$minioPort = 19000
$bucketName = "byos-c69-dr-bucket"
$prefixName = "c69-drill"
$accessKey = "c69testaccess"
$secretKey = "c69testsecretkey12345"

$srcPgContainer = "byos-c69-src-pg"
$srcDataVol = "byos_c69_src_pgdata"
$srcArchiveVol = "byos_c69_src_archive"
$srcPort = 15450

$recPgContainer = "byos-c69-rec-pg"
$recDataVol = "byos_c69_rec_pgdata"
$recRedisContainer = "byos-c69-rec-redis"
$recPort = 15451
$recRedisPort = 16385

function Cleanup-C69 {
    docker rm -f $srcPgContainer $recPgContainer $recRedisContainer $minioContainer 2>$null | Out-Null
    docker volume rm -f $srcDataVol $srcArchiveVol $recDataVol $minioVol 2>$null | Out-Null
    docker network rm $netName 2>$null | Out-Null
}

Cleanup-C69

Write-Host "================================================================="
Write-Host "BYOS C6.9: Remote-Only Disaster Recovery Drill"
Write-Host "Classification: SAME_HOST_OBJECT_STORAGE_TEST (Disposable MinIO)"
Write-Host "================================================================="

try {
    # -------------------------------------------------------------------------
    # STEP 1: Provision Disposable MinIO S3 Endpoint & Bucket
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 1] Starting disposable MinIO S3 endpoint on port $minioPort..."
    docker network create $netName | Out-Null
    docker volume create $minioVol | Out-Null
    docker run -d --name $minioContainer --network $netName -p "127.0.0.1:${minioPort}:9000" `
        -e "MINIO_ROOT_USER=$accessKey" `
        -e "MINIO_ROOT_PASSWORD=$secretKey" `
        -v "${minioVol}:/data" `
        minio/minio:latest server /data | Out-Null

    $minioReady = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:${minioPort}/minio/health/live" -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200) { $minioReady = $true; break }
        } catch {}
    }
    if (-not $minioReady) { throw "MinIO failed to become ready" }

    docker run --rm --network $netName --entrypoint sh quay.io/minio/mc:latest -c "mc alias set dr http://${minioContainer}:9000 ${accessKey} ${secretKey} && mc mb dr/${bucketName}" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed creating MinIO bucket $bucketName" }
    Write-Host "  -> MinIO bucket '$bucketName' ready."

    # -------------------------------------------------------------------------
    # STEP 2: Start Disposable Source PostgreSQL with Remote-Required WAL Archiving
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 2] Starting disposable source PostgreSQL with BYOS_BACKUP_REMOTE_REQUIRED=true..."
    docker volume create $srcDataVol | Out-Null
    docker volume create $srcArchiveVol | Out-Null

    $entryScriptPath = Join-Path $drillDir "entrypoint.sh"
    $entryScript = @"
#!/bin/sh
mkdir -p /var/byos/archive
chown -R postgres:postgres /var/byos/archive
chmod 700 /var/byos/archive
exec docker-entrypoint.sh postgres \
  -c wal_level=replica \
  -c archive_mode=on \
  -c "archive_command=/usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key" \
  -c archive_timeout=300
"@
    [System.IO.File]::WriteAllText($entryScriptPath, $entryScript.Replace("`r`n", "`n"))
    $entryHost = $entryScriptPath.Replace('\', '/')

    docker run -d --name $srcPgContainer --network $netName -p "127.0.0.1:${srcPort}:5432" `
        -e POSTGRES_DB=byos_dr_test `
        -e POSTGRES_USER=byos `
        -e POSTGRES_PASSWORD=byos_dr_password `
        -e BYOS_BACKUP_REMOTE_ENABLED=true `
        -e BYOS_BACKUP_REMOTE_REQUIRED=true `
        -e BYOS_BACKUP_ALLOW_INSECURE_LOCAL_HTTP=true `
        -e "BYOS_BACKUP_REMOTE_ENDPOINT=http://${minioContainer}:9000" `
        -e BYOS_BACKUP_REMOTE_REGION=us-east-1 `
        -e "BYOS_BACKUP_REMOTE_BUCKET=$bucketName" `
        -e "BYOS_BACKUP_REMOTE_PREFIX=$prefixName" `
        -e BYOS_BACKUP_REMOTE_PATH_STYLE=true `
        -e "BYOS_BACKUP_REMOTE_ACCESS_KEY=$accessKey" `
        -e "BYOS_BACKUP_REMOTE_SECRET_KEY=$secretKey" `
        -v "${srcDataVol}:/var/lib/postgresql/data" `
        -v "${srcArchiveVol}:/var/byos/archive" `
        -v "${linuxBinHost}:/usr/local/bin/byos-backup:ro" `
        -v "${srcKeyHost}:/etc/byos/keys/backup.key:ro" `
        -v "${entryHost}:/entrypoint.sh:ro" `
        --entrypoint sh `
        postgres:16-alpine /entrypoint.sh | Out-Null

    $srcReady = $false
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        $null = docker exec $srcPgContainer psql -U byos -d byos_dr_test -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) { $srcReady = $true; break }
    }
    if (-not $srcReady) { throw "Source PostgreSQL failed to become ready" }
    Write-Host "  -> Source PostgreSQL ready on port $srcPort."

    # -------------------------------------------------------------------------
    # STEP 3: Seed Baseline Records, Capture Base Backup, & Publish to Remote
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 3] Seeding synthetic baseline & publishing physical base backup to remote S3..."
    $runId = [System.Guid]::NewGuid().ToString("N").Substring(0, 12)
    $seedSql = @"
CREATE TABLE c69_synthetic_dr_ledger (
    id SERIAL PRIMARY KEY,
    run_id TEXT NOT NULL,
    seq_no INT NOT NULL,
    tx_label TEXT NOT NULL,
    committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO c69_synthetic_dr_ledger (run_id, seq_no, tx_label) VALUES ('$runId', 1, 'BASELINE_SEED_RECORD');
SELECT pg_switch_wal();
"@
    docker exec $srcPgContainer psql -U byos -d byos_dr_test -c $seedSql | Out-Null

    docker exec $srcPgContainer sh -c "rm -rf /tmp/c69_base && mkdir -p /tmp/c69_base && pg_basebackup -h 127.0.0.1 -U byos -D /tmp/c69_base -Ft -z -X none"
    if ($LASTEXITCODE -ne 0) { throw "pg_basebackup failed" }

    $localBaseDir = Join-Path $drillDir "src_base"
    New-Item -ItemType Directory -Force -Path $localBaseDir | Out-Null
    docker cp "${srcPgContainer}:/tmp/c69_base/base.tar.gz" (Join-Path $localBaseDir "base.tar.gz")
    docker cp "${srcPgContainer}:/tmp/c69_base/backup_manifest" (Join-Path $localBaseDir "backup_manifest")
    docker exec $srcPgContainer rm -rf /tmp/c69_base

    $manifestObj = Get-Content (Join-Path $localBaseDir "backup_manifest") -Raw | ConvertFrom-Json
    $startLSN = $manifestObj.'WAL-Ranges'[0].'Start-LSN'
    $stopLSN = $manifestObj.'WAL-Ranges'[0].'End-LSN'

    $encBaseFile = Join-Path $localBaseDir "base.tar.enc"
    & $winBin encrypt-bundle `
        --dump-file (Join-Path $localBaseDir "base.tar.gz") `
        --manifest-file (Join-Path $localBaseDir "backup_manifest") `
        --out-file $encBaseFile `
        --key-file $srcKeyFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "encrypt-bundle failed" }

    # Wait for WAL archive queue to drain to 0
    for ($w = 0; $w -lt 20; $w++) {
        $pending = (docker exec $srcPgContainer sh -c "ls -1 /var/lib/postgresql/data/pg_wal/archive_status/*.ready 2>/dev/null | wc -l").Trim()
        if ([int]$pending -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }

    # Discover archived WAL names inside source container
    $archivedWals = (docker exec $srcPgContainer sh -c "ls -1 /var/byos/archive/wal/*.enc | xargs -n1 basename | sed 's/\.enc$//' | grep -v '\.backup$'")
    $walCsv = ($archivedWals.Trim().Split("`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }) -join ","
    $bkpHist = (docker exec $srcPgContainer sh -c "ls -1 /var/byos/archive/wal/*.backup.enc 2>/dev/null | head -n1 | xargs -r basename | sed 's/\.enc$//'").Trim()

    # Set host env vars for remote CLI targeting MinIO on localhost:19000
    $env:BYOS_BACKUP_REMOTE_ENABLED = "true"
    $env:BYOS_BACKUP_ALLOW_INSECURE_LOCAL_HTTP = "true"
    $env:BYOS_BACKUP_REMOTE_ENDPOINT = "http://127.0.0.1:${minioPort}"
    $env:BYOS_BACKUP_REMOTE_REGION = "us-east-1"
    $env:BYOS_BACKUP_REMOTE_BUCKET = $bucketName
    $env:BYOS_BACKUP_REMOTE_PREFIX = $prefixName
    $env:BYOS_BACKUP_REMOTE_PATH_STYLE = "true"
    $env:BYOS_BACKUP_REMOTE_ACCESS_KEY = $accessKey
    $env:BYOS_BACKUP_REMOTE_SECRET_KEY = $secretKey

    # Publish atomic recovery point via container (with access to local /var/byos/archive) or host after copying encBase
    docker cp $encBaseFile "${srcPgContainer}:/tmp/base.tar.enc"
    docker cp (Join-Path $localBaseDir "backup_manifest") "${srcPgContainer}:/tmp/backup_manifest"
    $backupId = "c69-base-$runId"
    docker exec $srcPgContainer /usr/local/bin/byos-backup recovery-catalog `
        --action publish `
        --archive-dir /var/byos/archive `
        --backup-id $backupId `
        --system-id "c69-disposable" `
        --pg-version "16.15" `
        --start-lsn $startLSN `
        --stop-lsn $stopLSN `
        --timeline 1 `
        --required-wals $walCsv `
        --backup-history $bkpHist `
        --key-version "v1" `
        --key-file /etc/byos/keys/backup.key `
        --base-file /tmp/base.tar.enc `
        --manifest-file /tmp/backup_manifest
    if ($LASTEXITCODE -ne 0) { throw "recovery-catalog publish failed" }

    # -------------------------------------------------------------------------
    # STEP 4: Post-Backup Valid TX -> Target Timestamp -> Disaster TX
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 4] Committing TX1 (valid), capturing PITR target, and committing TX2 (disaster)..."
    docker exec $srcPgContainer psql -U byos -d byos_dr_test -c "INSERT INTO c69_synthetic_dr_ledger (run_id, seq_no, tx_label) VALUES ('$runId', 2, 'TX1_VALID_POST_BACKUP');" | Out-Null
    $t1Time = (docker exec $srcPgContainer psql -U byos -d byos_dr_test -t -A -c "SELECT committed_at::text FROM c69_synthetic_dr_ledger WHERE seq_no = 2;").Trim()
    $targetTime = ([DateTimeOffset]::Parse($t1Time)).AddSeconds(1).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + " UTC"
    Write-Host "  -> TX1 Committed: $t1Time | PITR Target: $targetTime"

    Start-Sleep -Seconds 2
    docker exec $srcPgContainer psql -U byos -d byos_dr_test -c "INSERT INTO c69_synthetic_dr_ledger (run_id, seq_no, tx_label) VALUES ('$runId', 3, 'TX2_DISASTER_POST_TARGET');" | Out-Null
    docker exec $srcPgContainer psql -U byos -d byos_dr_test -c "CREATE TABLE post_disaster_marker (id INT); SELECT pg_switch_wal();" | Out-Null

    for ($w = 0; $w -lt 20; $w++) {
        $pending = (docker exec $srcPgContainer sh -c "ls -1 /var/lib/postgresql/data/pg_wal/archive_status/*.ready 2>/dev/null | wc -l").Trim()
        if ([int]$pending -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }

    # Verify remote completeness & remote status before destroying source host
    & $winBin remote-verify --backup-id $backupId --key-file $recKeyFile
    if ($LASTEXITCODE -ne 0) { throw "remote-verify failed" }

    & $winBin remote-status --key-file $recKeyFile
    if ($LASTEXITCODE -ne 0) { throw "remote-status failed" }

    # Negative security check: wrong credentials must fail closed
    $savedAK = $env:BYOS_BACKUP_REMOTE_ACCESS_KEY
    $env:BYOS_BACKUP_REMOTE_ACCESS_KEY = "invalid-access-key"
    $null = & $winBin remote-list 2>&1
    $badCredExit = $LASTEXITCODE
    $env:BYOS_BACKUP_REMOTE_ACCESS_KEY = $savedAK
    Write-Host "  -> Wrong credentials remote-list exit code: $badCredExit (expected != 0)"
    if ($badCredExit -eq 0) { throw "remote-list unexpectedly succeeded with invalid credentials!" }

    # -------------------------------------------------------------------------
    # STEP 4b: Measure Remote Outage & Backlog Drain RPO
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 4b] Simulating remote destination outage & measuring backlog drain..."
    docker stop $minioContainer | Out-Null
    $outageStart = Get-Date
    docker exec $srcPgContainer psql -U byos -d byos_dr_test -c "SELECT pg_create_restore_point('c69_outage_marker'); SELECT pg_switch_wal();" | Out-Null
    $failDuringOutage = "0"
    for ($w = 0; $w -lt 25; $w++) {
        Start-Sleep -Seconds 1
        $failDuringOutage = (docker exec $srcPgContainer psql -U byos -d byos_dr_test -t -A -c "SELECT failed_count FROM pg_stat_archiver;").Trim()
        if ([int]$failDuringOutage -ge 1) { break }
    }
    $localPendingEnc = (docker exec $srcPgContainer sh -c "ls -1 /var/byos/archive/wal/*.enc | wc -l").Trim()
    Write-Host "  -> During outage: pg_stat_archiver.failed_count=$failDuringOutage, local archived .enc count=$localPendingEnc"
    if ([int]$failDuringOutage -lt 1) { throw "Expected failed_count >= 1 during remote outage in remote-required mode!" }

    docker start $minioContainer | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:${minioPort}/minio/health/live" -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200) { break }
        } catch {}
    }
    $outageEnd = Get-Date
    $outageSec = [math]::Round(($outageEnd - $outageStart).TotalSeconds, 2)

    $drainSw = [System.Diagnostics.Stopwatch]::StartNew()
    $drained = $false
    for ($w = 0; $w -lt 40; $w++) {
        $pending = (docker exec $srcPgContainer sh -c "ls -1 /var/lib/postgresql/data/pg_wal/archive_status/*.ready 2>/dev/null | wc -l").Trim()
        if ([int]$pending -eq 0) { $drained = $true; break }
        Start-Sleep -Milliseconds 500
    }
    $drainSw.Stop()
    $drainSec = [math]::Round($drainSw.Elapsed.TotalSeconds, 2)
    Write-Host "  -> Outage duration: ${outageSec}s | Backlog drain time after MinIO recovery: ${drainSec}s (drained=$drained)"
    if (-not $drained) { throw "Remote backlog did not drain after MinIO recovered" }

    # -------------------------------------------------------------------------
    # STEP 5: SIMULATE COMPLETE HOST LOSS (Destroy Source Container, Data Vol, Archive Vol, Source Keys)
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 5] Simulating complete loss of original host (destroying source container, volumes, and source keys)..."
    docker rm -f $srcPgContainer | Out-Null
    docker volume rm -f $srcDataVol $srcArchiveVol | Out-Null
    Remove-Item -Recurse -Force $srcKeyDir, $localBaseDir

    # Strict isolation assertions
    $null = docker volume inspect $srcDataVol 2>&1
    if ($LASTEXITCODE -eq 0) { throw "ISOLATION FAILURE: $srcDataVol still exists!" }
    $null = docker volume inspect $srcArchiveVol 2>&1
    if ($LASTEXITCODE -eq 0) { throw "ISOLATION FAILURE: $srcArchiveVol still exists!" }
    if (Test-Path $srcKeyFile) { throw "ISOLATION FAILURE: $srcKeyFile still exists!" }
    Write-Host "  -> Strict isolation confirmed: source container, data volume, archive volume, and host keys destroyed."

    # -------------------------------------------------------------------------
    # STEP 6: Timed Remote-Only Cold Physical PITR Recovery (No Local Storage Access)
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 6] Executing timed remote-only cold recovery using ONLY MinIO S3 + independent recovery key..."
    $rtoStages = [ordered]@{}
    $totalSw = [System.Diagnostics.Stopwatch]::StartNew()

    # Stage A: Provision recovery infra & Redis
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    docker volume create $recDataVol | Out-Null
    docker run -d --name $recRedisContainer --network $netName -p "127.0.0.1:${recRedisPort}:6379" redis:7-alpine | Out-Null
    $sw.Stop()
    $rtoStages["1_infra_and_redis_ms"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)

    # Stage B: Fetch encrypted base backup from remote S3
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $fetchedBase = Join-Path $drillDir "fetched_base.tar.enc"
    & $winBin remote-fetch --object-key "backups/$backupId/base.tar.enc" --out-file $fetchedBase | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "remote-fetch base.tar.enc failed" }
    $sw.Stop()
    $rtoStages["2_base_backup_fetch_ms"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)

    # Stage C: Decrypt & verify base backup with independent recovery key
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $recDecDir = Join-Path $drillDir "rec_decrypted"
    New-Item -ItemType Directory -Force -Path $recDecDir | Out-Null
    & $winBin decrypt-bundle --in-file $fetchedBase --out-dir $recDecDir --key-file $recKeyFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "decrypt-bundle failed" }
    $sw.Stop()
    $rtoStages["3_decrypt_and_verify_ms"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)

    # Stage D: Physical extraction & PITR configuration (restore_command uses --remote ONLY!)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $recDirSlash = $recDecDir.Replace('\', '/')
    $setupSh = @"
tar -xzf /tmp_dec/database.dump -C /var/lib/postgresql/data
mkdir -p /var/lib/postgresql/data/pg_wal
touch /var/lib/postgresql/data/recovery.signal
cat << 'EOF' >> /var/lib/postgresql/data/postgresql.auto.conf
restore_command = '/usr/local/bin/byos-backup restore-wal --remote --wal-name %f --target-path %p --key-file /etc/byos/recovery_keys/key_v1.key'
recovery_target_time = '$targetTime'
recovery_target_action = 'promote'
EOF
chown -R 70:70 /var/lib/postgresql/data
chmod 700 /var/lib/postgresql/data
"@
    $setupB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($setupSh.Replace("`r`n", "`n")))
    docker run --rm `
        -v "${recDataVol}:/var/lib/postgresql/data" `
        -v "${recDirSlash}:/tmp_dec:ro" `
        alpine:latest `
        sh -c "echo '$setupB64' | base64 -d | sh"
    if ($LASTEXITCODE -ne 0) { throw "Failed extracting base backup" }
    $sw.Stop()
    $rtoStages["4_extract_and_pitr_conf_ms"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)

    # Stage E: Boot recovery container & replay encrypted WALs directly from MinIO S3
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    docker run -d --name $recPgContainer --network $netName -p "127.0.0.1:${recPort}:5432" `
        -e POSTGRES_PASSWORD=byos_dr_password `
        -e BYOS_BACKUP_REMOTE_ENABLED=true `
        -e BYOS_BACKUP_ALLOW_INSECURE_LOCAL_HTTP=true `
        -e "BYOS_BACKUP_REMOTE_ENDPOINT=http://${minioContainer}:9000" `
        -e BYOS_BACKUP_REMOTE_REGION=us-east-1 `
        -e "BYOS_BACKUP_REMOTE_BUCKET=$bucketName" `
        -e "BYOS_BACKUP_REMOTE_PREFIX=$prefixName" `
        -e BYOS_BACKUP_REMOTE_PATH_STYLE=true `
        -e "BYOS_BACKUP_REMOTE_ACCESS_KEY=$accessKey" `
        -e "BYOS_BACKUP_REMOTE_SECRET_KEY=$secretKey" `
        -v "${recDataVol}:/var/lib/postgresql/data" `
        -v "${linuxBinHost}:/usr/local/bin/byos-backup:ro" `
        -v "${recKeyHost}:/etc/byos/recovery_keys/key_v1.key:ro" `
        postgres:16-alpine postgres | Out-Null

    $recReady = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        $null = docker exec $recPgContainer psql -U byos -d byos_dr_test -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $inRec = (docker exec $recPgContainer psql -U byos -d byos_dr_test -t -A -c "SELECT pg_is_in_recovery();" 2>&1).Trim()
            if ($inRec -eq "f") { $recReady = $true; break }
        }
    }
    $sw.Stop()
    $rtoStages["5_remote_wal_replay_and_promote_ms"] = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    $totalSw.Stop()
    $totalRtoSec = [math]::Round($totalSw.Elapsed.TotalSeconds, 3)

    if (-not $recReady) {
        $logs = docker logs $recPgContainer 2>&1
        Write-Host "Recovery logs:`n$logs"
        throw "Remote-only recovery container failed to promote"
    }

    # -------------------------------------------------------------------------
    # STEP 7: Assert Recovered Data Integrity & Timeline Promotion
    # -------------------------------------------------------------------------
    Write-Host "`n[Step 7] Validating remote-only recovered database state..."
    $rows = docker exec $recPgContainer psql -U byos -d byos_dr_test -c "SELECT id, run_id, seq_no, tx_label FROM c69_synthetic_dr_ledger ORDER BY seq_no;"
    Write-Host "$rows"

    $hasBase = (docker exec $recPgContainer psql -U byos -d byos_dr_test -t -A -c "SELECT count(*) FROM c69_synthetic_dr_ledger WHERE seq_no = 1;").Trim()
    $hasT1 = (docker exec $recPgContainer psql -U byos -d byos_dr_test -t -A -c "SELECT count(*) FROM c69_synthetic_dr_ledger WHERE seq_no = 2;").Trim()
    $hasT2 = (docker exec $recPgContainer psql -U byos -d byos_dr_test -t -A -c "SELECT count(*) FROM c69_synthetic_dr_ledger WHERE seq_no = 3;").Trim()
    $tlId = (docker exec $recPgContainer psql -U byos -d byos_dr_test -t -A -c "SELECT timeline_id FROM pg_control_checkpoint();").Trim()

    if ($hasBase -ne "1" -or $hasT1 -ne "1" -or $hasT2 -ne "0") {
        throw "PITR data mismatch: base=$hasBase t1=$hasT1 t2=$hasT2"
    }
    if ([int]$tlId -lt 2) {
        throw "Expected timeline promotion >= 2, got $tlId"
    }

    # Stage F: Remote Outage + Retry Resilience Test (on source before host loss) -> moved to Step 4b
    # Also test Latest-State Recovery (without recovery_target_time) using the same remote objects
    Write-Host "`n[Step 7b] Testing Latest-State Remote-Only Recovery (including TX2)..."
    docker rm -f $recPgContainer | Out-Null
    docker volume rm -f $recDataVol | Out-Null
    docker volume create $recDataVol | Out-Null
    $setupLatestSh = @"
tar -xzf /tmp_dec/database.dump -C /var/lib/postgresql/data
mkdir -p /var/lib/postgresql/data/pg_wal
touch /var/lib/postgresql/data/recovery.signal
cat << 'EOF' >> /var/lib/postgresql/data/postgresql.auto.conf
restore_command = '/usr/local/bin/byos-backup restore-wal --remote --wal-name %f --target-path %p --key-file /etc/byos/recovery_keys/key_v1.key'
recovery_target_action = 'promote'
EOF
chown -R 70:70 /var/lib/postgresql/data
chmod 700 /var/lib/postgresql/data
"@
    $setupLatestB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($setupLatestSh.Replace("`r`n", "`n")))
    docker run --rm -v "${recDataVol}:/var/lib/postgresql/data" -v "${recDirSlash}:/tmp_dec:ro" alpine:latest sh -c "echo '$setupLatestB64' | base64 -d | sh"
    docker run -d --name $recPgContainer --network $netName -p "127.0.0.1:${recPort}:5432" `
        -e POSTGRES_PASSWORD=byos_dr_password `
        -e BYOS_BACKUP_REMOTE_ENABLED=true `
        -e BYOS_BACKUP_ALLOW_INSECURE_LOCAL_HTTP=true `
        -e "BYOS_BACKUP_REMOTE_ENDPOINT=http://${minioContainer}:9000" `
        -e BYOS_BACKUP_REMOTE_REGION=us-east-1 `
        -e "BYOS_BACKUP_REMOTE_BUCKET=$bucketName" `
        -e "BYOS_BACKUP_REMOTE_PREFIX=$prefixName" `
        -e BYOS_BACKUP_REMOTE_PATH_STYLE=true `
        -e "BYOS_BACKUP_REMOTE_ACCESS_KEY=$accessKey" `
        -e "BYOS_BACKUP_REMOTE_SECRET_KEY=$secretKey" `
        -v "${recDataVol}:/var/lib/postgresql/data" `
        -v "${linuxBinHost}:/usr/local/bin/byos-backup:ro" `
        -v "${recKeyHost}:/etc/byos/recovery_keys/key_v1.key:ro" `
        postgres:16-alpine postgres | Out-Null

    $latestReady = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        $null = docker exec $recPgContainer psql -U byos -d byos_dr_test -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $inRec = (docker exec $recPgContainer psql -U byos -d byos_dr_test -t -A -c "SELECT pg_is_in_recovery();" 2>&1).Trim()
            if ($inRec -eq "f") { $latestReady = $true; break }
        }
    }
    if (-not $latestReady) { throw "Latest-state remote recovery failed to promote" }
    $latestCount = (docker exec $recPgContainer psql -U byos -d byos_dr_test -t -A -c "SELECT count(*) FROM c69_synthetic_dr_ledger;").Trim()
    Write-Host "  -> Latest-state recovered ledger rows: $latestCount (expected: 3)"
    if ($latestCount -ne "3") { throw "Expected 3 rows in latest-state recovery, got $latestCount" }

    Write-Host "`n[Step 8] Remote Recovery RTO Breakdown (Total: ${totalRtoSec}s):"
    foreach ($k in $rtoStages.Keys) {
        Write-Host ("  - {0,-38}: {1} ms" -f $k, $rtoStages[$k])
    }
    Write-Host "  - Promoted Timeline ID                : $tlId"
    Write-Host "  - Storage-Domain Classification       : SAME_HOST_OBJECT_STORAGE_TEST"
    Write-Host "================================================================="
    Write-Host "REMOTE-ONLY DISASTER RECOVERY DRILL: CRITERIA MET"
    Write-Host "================================================================="
}
finally {
    Remove-Item Env:BYOS_BACKUP_REMOTE_ENABLED, Env:BYOS_BACKUP_ALLOW_INSECURE_LOCAL_HTTP, Env:BYOS_BACKUP_REMOTE_ENDPOINT, Env:BYOS_BACKUP_REMOTE_REGION, Env:BYOS_BACKUP_REMOTE_BUCKET, Env:BYOS_BACKUP_REMOTE_PREFIX, Env:BYOS_BACKUP_REMOTE_PATH_STYLE, Env:BYOS_BACKUP_REMOTE_ACCESS_KEY, Env:BYOS_BACKUP_REMOTE_SECRET_KEY -ErrorAction SilentlyContinue
    Cleanup-C69
}
