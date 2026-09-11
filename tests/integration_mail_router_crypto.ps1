#!/usr/bin/env pwsh
<# SUPERSEDED — do not extend.
   This suite predates the hardened topology (internal-only :8081/:8083/:8084)
   and session enforcement, and its coverage is now subsumed by stronger live
   suites that run green:
     - e2e_inbound_slice.ps1: SMTP -> bridge -> Rspamd -> router ->
       crypto-worker encrypt -> storage put -> metadata insert -> MinIO read ->
       client decrypt (full router+crypto+storage+DB path, end to end).
     - vertical-slice-test.ps1: crypto-worker /v1/encrypt response shape +
       storage-worker store/retrieve/delete wire (Go round-trip suite).
   Kept as a signpost so old references resolve with an explanation instead
   of a confusing failure. If router+crypto coverage beyond the above is ever
   needed again, write it against current contracts — do not revive this file.
#>
Write-Host "SUPERSEDED: coverage lives in e2e_inbound_slice.ps1 + vertical-slice-test.ps1" -ForegroundColor Yellow
exit 0
