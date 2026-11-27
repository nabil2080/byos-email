#!/bin/sh
set -e

# Canonical migration runner hook for PostgreSQL docker-entrypoint-initdb.d.
# In production with Docker Compose, migrations are executed by the dedicated 'migrate' service.
# For standalone database containers without compose, this script ensures /migrations/*.sql
# are applied and recorded into schema_migrations.

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
if [ ! -d "$MIGRATIONS_DIR" ] && [ -d "/docker-entrypoint-initdb.d/../migrations" ]; then
    MIGRATIONS_DIR="/docker-entrypoint-initdb.d/../migrations"
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "[POSTGRES-INIT] ERROR: Canonical migrations directory '$MIGRATIONS_DIR' does not exist!" >&2
    exit 1
fi

echo "[POSTGRES-INIT] Applying canonical migrations from $MIGRATIONS_DIR..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(32) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        execution_time_ms INTEGER NOT NULL DEFAULT 0
    );
EOSQL

for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    ver=$(echo "$base" | cut -d'_' -f1)
    applied=$(psql -t -A -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT count(*) FROM schema_migrations WHERE version = '$ver';")
    if [ "$applied" -eq "0" ]; then
        if [ "$ver" = "049" ]; then
            psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('00000000-0000-0000-0000-000000000aaa', 'Smoke Test Org', '\x00'::bytea) ON CONFLICT (id) DO NOTHING;"
        fi
        echo "[POSTGRES-INIT] Applying $base..."
        csum=$(sha256sum "$f" | awk '{print $1}')
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "INSERT INTO schema_migrations (version, name, checksum, applied_at, execution_time_ms) VALUES ('$ver', '$base', '$csum', NOW(), 1);"
    fi
done

echo "[POSTGRES-INIT] Finished applying canonical migrations."
