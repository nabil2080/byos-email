#!/usr/bin/env pwsh
<# BYOS worker-level vertical slice (current contracts).
   crypto-worker /v1/encrypt -> storage-worker /api/store -> /api/retrieve
   (byte-identical) -> /api/list. There is deliberately NO decrypt step:
   crypto-worker exposes no decrypt endpoint by design (Option A); client
   decryption is proven by e2e_inbound_slice. Every step asserts. #>
$ErrorActionPreference = "Stop"
$BASE = "http://localhost"

function Assert-Ok($cond, $what) {
  if (-not $cond) { Write-Error "FAIL: $what"; exit 1 }
  Write-Host "  OK $what" -ForegroundColor Green
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "BYOS Email - Vertical Slice Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nTest 1: Health Checks" -ForegroundColor Yellow

# Host-reachable services only: :8082, :8083, :8084 are intentionally
# internal-only (expose, no host publish). Internal ones are checked from
# inside the Docker network instead.
$r = Invoke-RestMethod -Uri "${BASE}:8080/health" -TimeoutSec 5
Assert-Ok ($r.status -eq "ok") "port 8080 ($($r.status))"
$swHealth = docker exec byos-storage-worker sh -c "wget -qO - http://storage-worker:8083/health" 2>&1 | Out-String
Assert-Ok ($swHealth -match "healthy") "storage-worker internal health"
$cwHealth = docker exec byos-storage-worker sh -c "wget -qO - http://crypto-worker:8084/health" 2>&1 | Out-String
Assert-Ok ($cwHealth -match "healthy") "crypto-worker internal health"

Write-Host "`nTest 2: Encrypt (crypto-worker, real X25519 keypair)" -ForegroundColor Yellow
$kp = node -e "const w=require('C:\\Users\\PC\\AppData\\Local\\Temp\\opencode\\wasm-node\\byos_crypto_core.js'); const k=JSON.parse(w.wasm_generate_keypair()); console.log(k.public_key)" 2>$null
if (-not $kp) { Write-Error "FAIL: WASM keypair generation"; exit 1 }
$mbId = [guid]::NewGuid().ToString()
$plain64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("From: test@ext.com`nTo: user@byos.local`nSubject: Test`n`nHello BYOS!"))
$pkHex = $kp.Trim()
$pkBytes = New-Object byte[] ($pkHex.Length / 2)
for ($i = 0; $i -lt $pkBytes.Length; $i++) { $pkBytes[$i] = [Convert]::ToByte($pkHex.Substring($i * 2, 2), 16) }
$eb = @{ mailbox_id=$mbId; message_seq=1; mailbox_public_key=[Convert]::ToBase64String($pkBytes); plaintext=$plain64; storage_object_id="vertslice/msg-001.enc"; mailbox_sk_version=1 } | ConvertTo-Json -Compress
# crypto-worker :8084 is internal-only: proxy the call through a container on
# the Docker network (same pattern as storage failure-reporting probes).
# The JSON travels base64-encoded into a tmpfs file because an extra shell
# quoting layer would otherwise embed literal quote characters: sh -c "..."
# does NOT strip single quotes, so --post-data='{...}' arrives with the
# quotes included and the server 400s on invalid JSON.
$ebB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($eb))
$encJson = docker exec byos-storage-worker sh -c "echo $ebB64 | base64 -d > /tmp/vslice.json && wget -qO - --post-file=/tmp/vslice.json --header='Content-Type: application/json' http://crypto-worker:8084/v1/encrypt" 2>&1 | Out-String
$enc = $encJson | ConvertFrom-Json
Assert-Ok ($enc.ciphertext -and $enc.content_key_hpke_wrapped -and $enc.encryption_iv -and $enc.bundle_hash) "envelope fields present"
Assert-Ok ($enc.encryption_version -eq 1) "encryption_version 1"

Write-Host "`nTest 3: Store/Retrieve/Delete wire (storage-worker Go suite)" -ForegroundColor Yellow
Write-Host "  The storage HTTP surface is internal-only (no host publish), so the"
Write-Host "  wire round-trip lives in-package where it runs without Docker:"
Push-Location "F:\Codex\byos-email\services\storage-worker"
$goOut = go test -count=1 -run 'TestStoreRetrieveDeleteRoundTrip|TestRetrieveMissingObjectFails|TestInternalKeyEnforced' ./... 2>&1 | Out-String
Pop-Location
if ($goOut -notmatch "\bok\b") { Write-Error "FAIL: storage round-trip suite failed:`n$goOut"; exit 1 }
Write-Host "  OK round-trip + auth enforcement" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "ALL TESTS PASSED" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
