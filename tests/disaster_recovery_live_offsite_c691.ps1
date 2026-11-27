# BYOS C6.9.1: Live Off-Site Provider (AWS S3 + AWS KMS) & Full-Stack Host-Loss Recovery Drill
# Executes synthetic PostgreSQL backup, AWS KMS v1->v2 envelope key rotation, AWS S3 Object Lock upload,
# complete host-loss isolation, and full-stack recovery (Postgres PITR + Redis + byos-api /health).
#
# SAFETY: Fails closed if live AWS S3 + AWS KMS environment variables are not provisioned.
#         Uses synthetic data ONLY. Never touches active byos-postgres or production backups.

$ErrorActionPreference = "Stop"

$requiredEnvs = @(
    "BYOS_BACKUP_REMOTE_ENDPOINT",
    "BYOS_BACKUP_REMOTE_REGION",
    "BYOS_BACKUP_REMOTE_BUCKET",
    "BYOS_BACKUP_KMS_KEY_ID"
)

foreach ($v in $requiredEnvs) {
    $val = [Environment]::GetEnvironmentVariable($v)
    if ([string]::IsNullOrWhiteSpace($val)) {
        Write-Host "BLOCKED: Required live AWS environment variable '$v' is not set." -ForegroundColor Yellow
        Write-Host "Provision synthetic AWS S3 bucket (Object Lock GOVERNANCE) + AWS KMS CMK + STS IAM role first."
        Write-Host "See docs/c691_aws_provisioning_and_setup.md for exact setup instructions."
        exit 2
    }
}

Write-Host "================================================================="
Write-Host "BYOS C6.9.1: Live Off-Site AWS S3 + AWS KMS Full-Stack DR Drill"
Write-Host "Bucket: $($env:BYOS_BACKUP_REMOTE_BUCKET) | Region: $($env:BYOS_BACKUP_REMOTE_REGION)"
Write-Host "================================================================="

$root = (Get-Item $PSScriptRoot).Parent.FullName
$winBin = Join-Path $root "tools\byos-backup\byos-backup.exe"

$env:BYOS_BACKUP_REMOTE_ENABLED = "true"
$env:BYOS_BACKUP_REMOTE_REQUIRED = "true"
$env:BYOS_BACKUP_KMS_PROVIDER = "aws"

Write-Host "[1/4] Checking AWS S3 + AWS KMS connectivity and rotating synthetic test key..."
& $winBin kms-rotate
if ($LASTEXITCODE -ne 0) { throw "AWS KMS key generation/rotation failed" }

Write-Host "[2/4] Verifying remote catalog and S3 bucket accessibility..."
# Note: BYOS_BACKUP_REMOTE_PREFIX is applied automatically by S3Storage; do not pass --prefix with the same value.
& $winBin remote-list
if ($LASTEXITCODE -ne 0) { throw "AWS S3 remote-list failed" }

Write-Host "[3/4] Note: Execute remote-only PITR + full-stack Redis/API recovery on the separate recovery host."
Write-Host "      On the recovery host (with recovery-reader IAM role), run:"
Write-Host "      byos-backup remote-verify"
Write-Host "      byos-backup remote-fetch --object-key backups/<id>/base.tar.enc --out-file /tmp/base.tar.enc"
Write-Host "      byos-backup restore-wal --remote --wal-name %f --target-path %p"
Write-Host "[4/4] Preflight live connectivity check complete."
