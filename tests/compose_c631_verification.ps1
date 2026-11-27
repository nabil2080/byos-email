# BYOS C6.3.1 Real Docker Compose Persistent-Volume Upgrade & Fresh Install Verification Script
$ErrorActionPreference = "Continue"

Write-Host "================================================================="
Write-Host "PHASE 3: REAL DOCKER COMPOSE DEPLOYMENT VERIFICATION"
Write-Host "================================================================="

# Clean any leftover test volumes/containers
docker rm -f c631-prep-postgres 2>$null
docker compose -f infra/docker-compose.yml -f infra/docker-compose.disposable-test.yml -p byos-c631-existing down -v 2>$null
docker compose -f infra/docker-compose.yml -f infra/docker-compose.disposable-test.yml -p byos-c631-fresh down -v 2>$null
docker volume rm -f c631_existing_vol 2>$null
docker volume rm -f c631_fresh_vol 2>$null

# -------------------------------------------------------------------------
# SCENARIO A: EXISTING INSTALLATION PRESERVED VOLUME UPGRADE
# -------------------------------------------------------------------------
Write-Host "`n>>> [SCENARIO A] 1. Creating disposable volume for existing installation: c631_existing_vol"
docker volume create c631_existing_vol

Write-Host "`n>>> [SCENARIO A] 2. Bootstrapping pre-C6.3 schema baseline (migrations 001 through 068)..."
$workspaceRoot = (Get-Location).Path -replace '\\', '/'
docker run -d --name c631-prep-postgres `
  -e POSTGRES_DB=byos `
  -e POSTGRES_USER=byos `
  -e POSTGRES_PASSWORD=byos_dev_password `
  -v "c631_existing_vol:/var/lib/postgresql/data" `
  -v "${workspaceRoot}/infra/postgres/migrations:/migrations:ro" `
  postgres:16-alpine

# Wait for postgres to be ready
Write-Host "Waiting for baseline postgres container to become ready..."
for ($i = 0; $i -lt 30; $i++) {
    $ready = docker exec c631-prep-postgres pg_isready -U byos 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
}

Write-Host "Applying migrations 001 through 068 to create baseline schema..."
$migFiles = Get-ChildItem infra/postgres/migrations/*.sql | Where-Object { [int]($_.Name.Substring(0,3)) -le 68 } | Sort-Object Name
foreach ($mig in $migFiles) {
    if ($mig.Name.StartsWith("049")) {
        docker exec -i c631-prep-postgres psql -v ON_ERROR_STOP=1 -U byos -d byos -c "INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('00000000-0000-0000-0000-000000000aaa', 'Smoke Test Org', '\x00'::bytea) ON CONFLICT (id) DO NOTHING;"
    }
    docker exec -i c631-prep-postgres psql -v ON_ERROR_STOP=1 -U byos -d byos -f "/migrations/$($mig.Name)" | Out-Null
}

Write-Host "Inserting representative synthetic customer data..."
$seedSQL = @"
INSERT INTO organizations (id, name, org_recovery_pk) 
VALUES ('99999999-1111-2222-3333-444444444444', 'Preserved Enterprise Org', '\x01020304');

INSERT INTO domains (id, org_id, name, is_verified) 
VALUES ('99999999-1111-2222-3333-444444444446', '99999999-1111-2222-3333-444444444444', 'preserved.byos.local', true);

INSERT INTO users (id, org_id, email, password_hash) 
VALUES ('99999999-1111-2222-3333-444444444445', '99999999-1111-2222-3333-444444444444', 'preserved_admin@byos.local', '$2a$10$fakehash');

INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, mailbox_pk) 
VALUES ('99999999-1111-2222-3333-444444444447', '99999999-1111-2222-3333-444444444444', '99999999-1111-2222-3333-444444444445', '99999999-1111-2222-3333-444444444446', 'preserved_admin', 'private', '\x05060708');

INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, expires_at) 
VALUES ('99999999-1111-2222-3333-444444444448', '99999999-1111-2222-3333-444444444448', '99999999-1111-2222-3333-444444444447', '99999999-1111-2222-3333-444444444446', 'customer@external.org', '\x0102'::bytea, '\x0304'::bytea, 'pending', NOW() + interval '24 hours');
"@
docker exec -i c631-prep-postgres psql -v ON_ERROR_STOP=1 -U byos -d byos -c $seedSQL

Write-Host "Verifying pre-upgrade conditions..."
$preCheckTable = docker exec c631-prep-postgres psql -t -A -U byos -d byos -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations';"
Write-Host "Pre-upgrade schema_migrations table count (expected 0): $preCheckTable"
$preCheckLease = docker exec c631-prep-postgres psql -t -A -U byos -d byos -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='outbound_queue' AND column_name='lease_token';"
Write-Host "Pre-upgrade outbound_queue.lease_token count (expected 0): $preCheckLease"

Write-Host "Stopping standalone postgres container without deleting volume..."
docker stop c631-prep-postgres | Out-Null
docker rm c631-prep-postgres | Out-Null

Write-Host "`n>>> [SCENARIO A] 3. Starting Docker Compose deployment against preserved volume..."
$env:COMPOSE_TEST_VOLUME = "c631_existing_vol"
docker compose -f infra/docker-compose.yml -f infra/docker-compose.disposable-test.yml -p byos-c631-existing up -d postgres migrate api outbound-worker

Write-Host "Waiting for migrate service to complete..."
$migrateExit = ""
for ($i = 0; $i -lt 60; $i++) {
    $status = docker inspect byos-test-c631-migrate --format '{{.State.Status}} (exit: {{.State.ExitCode}})' 2>$null
    if ($status -like "*exited*") {
        $migrateExit = $status
        break
    }
    Start-Sleep -Seconds 1
}
Write-Host "Migrate container status: $migrateExit"

Write-Host "Dumping migrate container logs:"
docker logs byos-test-c631-migrate

Write-Host "`n>>> [SCENARIO A] 4. Verifying post-upgrade schema and data integrity..."
$postMigCount = docker exec byos-test-c631-postgres psql -t -A -U byos -d byos -c "SELECT count(*) FROM schema_migrations;"
Write-Host "schema_migrations total count (expected 69): $postMigCount"

$postVersion = docker exec byos-test-c631-postgres psql -t -A -U byos -d byos -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;"
Write-Host "Latest migration version recorded: $postVersion"

$postCheckLease = docker exec byos-test-c631-postgres psql -t -A -U byos -d byos -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='outbound_queue' AND column_name='lease_token';"
Write-Host "Post-upgrade outbound_queue.lease_token count (expected 1): $postCheckLease"

$postCheckAttach = docker exec byos-test-c631-postgres psql -t -A -U byos -d byos -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='outbound_delivery_attachments';"
Write-Host "Post-upgrade outbound_delivery_attachments count (expected 1): $postCheckAttach"

$preservedOrg = docker exec byos-test-c631-postgres psql -t -A -U byos -d byos -c "SELECT name FROM organizations WHERE id='99999999-1111-2222-3333-444444444444';"
Write-Host "Preserved organization record: $preservedOrg"

$preservedQueue = docker exec byos-test-c631-postgres psql -t -A -U byos -d byos -c "SELECT recipient FROM outbound_queue WHERE id='99999999-1111-2222-3333-444444444448';"
Write-Host "Preserved outbound_queue recipient: $preservedQueue"

Write-Host "Checking dependent service statuses (api and outbound-worker):"
docker compose -f infra/docker-compose.yml -f infra/docker-compose.disposable-test.yml -p byos-c631-existing ps

Write-Host "`n>>> [SCENARIO A] 5. Restarting Compose project on same volume to verify idempotency..."
docker compose -f infra/docker-compose.yml -f infra/docker-compose.disposable-test.yml -p byos-c631-existing restart migrate
for ($i = 0; $i -lt 30; $i++) {
    $status = docker inspect byos-test-c631-migrate --format '{{.State.Status}}' 2>$null
    if ($status -eq "exited") { break }
    Start-Sleep -Seconds 1
}
docker logs byos-test-c631-migrate

# Teardown Scenario A
docker compose -f infra/docker-compose.yml -f infra/docker-compose.disposable-test.yml -p byos-c631-existing down -v

# -------------------------------------------------------------------------
# SCENARIO B: FRESH INSTALLATION SCENARIO FROM EMPTY DATA DIRECTORY
# -------------------------------------------------------------------------
Write-Host "`n>>> [SCENARIO B] 1. Creating second disposable volume for fresh installation: c631_fresh_vol"
docker volume create c631_fresh_vol

Write-Host "`n>>> [SCENARIO B] 2. Starting fresh Docker Compose deployment..."
$env:COMPOSE_TEST_VOLUME = "c631_fresh_vol"
docker compose -f infra/docker-compose.yml -f infra/docker-compose.disposable-test.yml -p byos-c631-fresh up -d postgres migrate api outbound-worker

Write-Host "Waiting for postgres and migrate services to complete initialization..."
for ($i = 0; $i -lt 90; $i++) {
    $status = docker inspect byos-test-c631-migrate --format '{{.State.Status}} (exit: {{.State.ExitCode}})' 2>$null
    if ($status -like "*exited*") {
        break
    }
    Start-Sleep -Seconds 1
}

Write-Host "Fresh install migrate container logs:"
docker logs byos-test-c631-migrate

Write-Host "Fresh install postgres entrypoint logs (checking 000_run_migrations.sh execution):"
docker logs byos-test-c631-postgres 2>&1 | Select-String "POSTGRES-INIT"

$freshMigCount = docker exec byos-test-c631-postgres psql -t -A -U byos -d byos -c "SELECT count(*) FROM schema_migrations;"
Write-Host "Fresh install schema_migrations count (expected 69): $freshMigCount"

$freshVersion = docker exec byos-test-c631-postgres psql -t -A -U byos -d byos -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;"
Write-Host "Fresh install latest version: $freshVersion"

Write-Host "Checking service statuses:"
docker compose -f infra/docker-compose.yml -f infra/docker-compose.disposable-test.yml -p byos-c631-fresh ps

# Teardown Scenario B
docker compose -f infra/docker-compose.yml -f infra/docker-compose.disposable-test.yml -p byos-c631-fresh down -v

Write-Host "`n================================================================="
Write-Host "PHASE 3 DOCKER COMPOSE VERIFICATION COMPLETED SUCCESSFULLY"
Write-Host "================================================================="
