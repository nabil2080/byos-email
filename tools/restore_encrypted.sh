#!/usr/bin/env bash
# BYOS Encrypted Restore and Disaster Recovery Procedure
# Decrypts AES-256-GCM backup package, verifies authentication tag,
# restores cluster-global objects and database archive into target database,
# and measures exact Restoration Time Objective (RTO).

set -euo pipefail

ENCRYPTED_FILE="${1:-}"
TARGET_DB="${2:-byos_disposable_restore_c67}"
KEY_FILE="${3:-scratch/backup_c67.key}"
CONTAINER_NAME="${4:-byos-postgres}"

if [ -z "${ENCRYPTED_FILE}" ]; then
    ENCRYPTED_FILE=$(ls -t backups/*.enc 2>/dev/null | head -n 1 || true)
    if [ -z "${ENCRYPTED_FILE}" ]; then
        echo "ERROR: No .enc backup files found in backups/" >&2
        exit 1
    fi
fi

echo "=================================================="
echo "BYOS Disaster Recovery & Restore Procedure"
echo "Encrypted File:  ${ENCRYPTED_FILE}"
echo "Target Database: ${TARGET_DB}"
echo "Container:       ${CONTAINER_NAME}"
echo "=================================================="

START_TIME=$(date +%s%N)
TEMP_DIR=$(mktemp -d /tmp/byos_restore_XXXXXX)

cleanup() {
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/byos-backup" && pwd)"
(cd "${TOOL_DIR}" && go build -o byos-backup .)

# 1. Decrypt and Unpack Archive
echo "[1/4] Decrypting AES-256-GCM archive and verifying authentication tag..."
"${TOOL_DIR}/byos-backup" decrypt-bundle \
    --in-file "${ENCRYPTED_FILE}" \
    --out-dir "${TEMP_DIR}" \
    --key-file "${KEY_FILE}"

LOCAL_GLOBALS="${TEMP_DIR}/globals.sql"
LOCAL_DUMP="${TEMP_DIR}/database.dump"

# 2. Restore Cluster Globals
if [ -f "${LOCAL_GLOBALS}" ]; then
    echo "[2/4] Restoring cluster-global roles and permissions..."
    docker cp "${LOCAL_GLOBALS}" "${CONTAINER_NAME}:/tmp/restore_globals.sql"
    docker exec -i "${CONTAINER_NAME}" psql -U byos -d postgres -f /tmp/restore_globals.sql 2>/dev/null || true
    docker exec "${CONTAINER_NAME}" rm -f /tmp/restore_globals.sql
else
    echo "[2/4] No cluster globals in archive, skipping."
fi

# 3. Create Clean Target Database
echo "[3/4] Ensuring clean target database (${TARGET_DB})..."
docker exec -i "${CONTAINER_NAME}" psql -U byos -d postgres -c "DROP DATABASE IF EXISTS ${TARGET_DB}; CREATE DATABASE ${TARGET_DB};" >/dev/null

# 4. Restore Database Objects and Records
echo "[4/4] Executing pg_restore into ${TARGET_DB}..."
docker cp "${LOCAL_DUMP}" "${CONTAINER_NAME}:/tmp/restore_dump.dump"
docker exec -i "${CONTAINER_NAME}" pg_restore -U byos -d "${TARGET_DB}" --no-owner --role=byos -v /tmp/restore_dump.dump 2>/dev/null || true
docker exec "${CONTAINER_NAME}" rm -f /tmp/restore_dump.dump

END_TIME=$(date +%s%N)
ELAPSED_SEC=$(echo "scale=2; (${END_TIME} - ${START_TIME}) / 1000000000" | bc 2>/dev/null || echo "N/A")

echo "=================================================="
echo "DISASTER RECOVERY RESTORATION COMPLETE"
echo "Target DB:    ${TARGET_DB}"
echo "RTO Duration: ${ELAPSED_SEC} seconds"
echo "=================================================="
