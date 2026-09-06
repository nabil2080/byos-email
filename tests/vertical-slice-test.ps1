$ErrorActionPreference = "Stop"
$BASE = "http://localhost"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "BYOS Email - Vertical Slice Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nTest 1: Health Checks" -ForegroundColor Yellow

$ports = @("8080","8082","8083","8084")
foreach ($p in $ports) {
    $url = "${BASE}:${p}/health"
    try {
        $r = Invoke-RestMethod -Uri $url -TimeoutSec 5
        Write-Host "  OK port $p" -ForegroundColor Green
    } catch {
        Write-Host "  FAIL port $p" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`nTest 2: Encrypt" -ForegroundColor Yellow
$plain64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("From: test@ext.com`nTo: user@byos.local`nSubject: Test`n`nHello BYOS!"))
$eb = @{plaintext=$plain64; mailbox_id="test"} | ConvertTo-Json
$enc = Invoke-RestMethod -Uri "${BASE}:8084/api/encrypt" -Method Post -Body $eb -ContentType "application/json"
Write-Host "  OK key=$($enc.key_id)" -ForegroundColor Green

Write-Host "`nTest 3: Store" -ForegroundColor Yellow
$sb = @{object_key="test/msg-001.enc"; data=$enc.ciphertext; metadata=@{from="test@ext.com"}} | ConvertTo-Json
$st = Invoke-RestMethod -Uri "${BASE}:8083/api/store" -Method Post -Body $sb -ContentType "application/json"
Write-Host "  OK $($st.object_key)" -ForegroundColor Green

Write-Host "`nTest 4: Retrieve" -ForegroundColor Yellow
$rb = '{"object_key":"test/msg-001.enc"}'
$re = Invoke-RestMethod -Uri "${BASE}:8083/api/retrieve" -Method Post -Body $rb -ContentType "application/json"
Write-Host "  OK size=$($re.size)" -ForegroundColor Green

Write-Host "`nTest 5: Decrypt" -ForegroundColor Yellow
$db = @{ciphertext=$re.data; salt=$enc.salt; iv=$enc.iv; mailbox_id="test"} | ConvertTo-Json
$dc = Invoke-RestMethod -Uri "${BASE}:8084/api/decrypt" -Method Post -Body $db -ContentType "application/json"
$msg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($dc.plaintext))
Write-Host "  OK $msg" -ForegroundColor Green

Write-Host "`nTest 6: List" -ForegroundColor Yellow
$li = Invoke-RestMethod -Uri "${BASE}:8083/api/list" -Method Get
Write-Host "  OK $($li.count) objects" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "ALL TESTS PASSED" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
