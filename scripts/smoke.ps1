param(
    [switch]$SkipClean
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir

if ($SkipClean) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$rootDir\smoke.ps1" -SkipClean
} else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$rootDir\smoke.ps1"
}
exit $LASTEXITCODE
