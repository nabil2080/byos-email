#!/usr/bin/env bash
# BYOS Encrypted Backup and Retention Automation Script
# Performs logical database backup, cluster globals export, AES-256-GCM encryption,
# integrity verification, and lifecycle retention management.

set -euo pipefail

DB_NAME="${1:-byos_disposable_fresh_c67}"
BACKUP_DIR="${2:-backups}"
KEY_FILE="${3:-}"
CONTAINER_NAME="${4:-byos-postgres}"
PRUNE="${5:-false}"

echo "=================================================="
echo "BYOS Encrypted Backup & Retention Procedure"
echo "Database:       ${DB_NAME}"
echo "Container:      ${CONTAINER_NAME}"
echo "Destination:    ${BACKUP_DIR}"
echo "=================================================="

# 1. Resolve and Validate Encryption Key
KEY_ARG=()
if [ -n "${KEY_FILE}" ]; then
    KEY_ARG=("--key-file" "${KEY_FILE}")
elif [ -z "${BYOS_BACKUP_ENCRYPTION_KEY:-}" ]; then
    echo "ERROR: Encryption key must be provided via argument 3 or BYOS_BACKUP_ENCRYPTION_KEY environment variable." >&2
    exit 1
fi

# 2. Setup Directories
mkdir -p "${BACKUP_DIR}"
TEMP_WORK_DIR="${BACKUP_DIR}/tmp_$(date +%s)_$$"
mkdir -p "${TEMP_WORK_DIR}"

TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
ENCRYPTED_FILE="${BACKUP_DIR}/byos_backup_${TIMESTAMP}.enc"
CONTAINER_GLOBALS="/tmp/byos_globals_${TIMESTAMP}.sql"
CONTAINER_DUMP="/tmp/byos_dump_${TIMESTAMP}.dump"
LOCAL_GLOBALS="${TEMP_WORK_DIR}/globals.sql"
LOCAL_DUMP="${TEMP_WORK_DIR}/database.dump"
LOCAL_MANIFEST="${TEMP_WORK_DIR}/manifest.json"

cleanup() {
    rm -rf "${TEMP_WORK_DIR}"
}
trap cleanup EXIT

# 3. Export Cluster-Global Objects inside Postgres Container
echo "[1/5] Exporting cluster-global objects (roles, grants, memberships)..."
docker exec "${CONTAINER_NAME}" pg_dumpall -U byos --globals-only -f "${CONTAINER_GLOBALS}"
docker cp "${CONTAINER_NAME}:${CONTAINER_GLOBALS}" "${LOCAL_GLOBALS}"
docker exec "${CONTAINER_NAME}" rm -f "${CONTAINER_GLOBALS}"

# 4. Export Consistent Database Custom Archive (-Fc)
echo "[2/5] Exporting database archive (${DB_NAME})..."
docker exec "${CONTAINER_NAME}" pg_dump -U byos -Fc -b -f "${CONTAINER_DUMP}" "${DB_NAME}"
docker cp "${CONTAINER_NAME}:${CONTAINER_DUMP}" "${LOCAL_DUMP}"
docker exec "${CONTAINER_NAME}" rm -f "${CONTAINER_DUMP}"

# 5. Create Manifest
cat <<EOF > "${LOCAL_MANIFEST}"
{
  "version": 1,
  "database": "${DB_NAME}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "cipher": "AES-256-GCM",
  "section23_compliant": true
}
EOF

# 6. Encrypt Archive into Single .enc Bundle with AES-256-GCM
echo "[3/5] Encrypting backup bundle with AES-256-GCM before egress..."
TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/byos-backup" && pwd)"
(cd "${TOOL_DIR}" && go build -o byos-backup .)

"${TOOL_DIR}/byos-backup" encrypt-bundle \
    --globals-file "${LOCAL_GLOBALS}" \
    --dump-file "${LOCAL_DUMP}" \
    --manifest-file "${LOCAL_MANIFEST}" \
    --out-file "${ENCRYPTED_FILE}" \
    "${KEY_ARG[@]}"

# 7. Authenticate and Verify Encrypted Archive
echo "[4/5] Verifying encrypted archive integrity and authentication tag..."
"${TOOL_DIR}/byos-backup" verify-encrypted \
    --in-file "${ENCRYPTED_FILE}" \
    "${KEY_ARG[@]}"

# 8. Optional Retention Lifecycle Pruning
if [ "${PRUNE}" = "true" ] || [ "${PRUNE}" = "1" ]; then
    echo "[5/5] Executing lifecycle retention pruning with last-known-good protection..."
    "${TOOL_DIR}/byos-backup" prune \
        --backup-dir "${BACKUP_DIR}" \
        --daily-days 7 \
        --weekly-weeks 4 \
        --monthly-months 12
else
    echo "[5/5] Pruning skipped."
fi

echo "=================================================="
echo "BACKUP SUCCESSFUL"
echo "Archive:  ${ENCRYPTED_FILE}"
echo "Size:     $(wc -c < "${ENCRYPTED_FILE}") bytes"
echo "=================================================="
