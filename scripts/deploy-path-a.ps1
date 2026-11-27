# Rebuild and restart the services that must be in sync for Path A 
# scheduled delivery to work correctly.
# 
# DO NOT schedule Path A messages until this script completes.
#
# Order matters: the migration must be applied before the new code runs, 
# but the new worker must be running before any new Path A rows are 
# created.

$ErrorActionPreference = "Stop"

Write-Host "1. Applying migration 041..."
Get-Content infra/postgres/migrations/041_scheduled_path_a.sql | docker exec -i byos-postgres psql -U byos -d byos

Write-Host "2. Rebuilding api and outbound-worker..."
docker compose -f infra/docker-compose.yml up -d --build api outbound-worker

Write-Host "3. Waiting for containers to be healthy..."
Start-Sleep -Seconds 15
docker compose -f infra/docker-compose.yml ps api outbound-worker

Write-Host "4. Verifying API startup check passed..."
docker logs byos-api 2>&1 | Select-String "scheduled-path-a|is_path_a" | Select-Object -First 5

Write-Host "5. Verifying Rust worker logs mention the filter..."
docker logs byos-outbound-worker 2>&1 | Select-String "is_path_a" | Select-Object -First 3

Write-Host "Ready. You may now schedule Path A messages."
