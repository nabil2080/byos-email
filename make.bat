@echo off
if "%1"=="clean-test-data" (
    powershell -ExecutionPolicy Bypass -File "%~dp0clean-test-data.ps1"
) else if "%1"=="smoke" (
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\smoke.ps1" %2 %3
) else if "%1"=="test-crypto" (
    docker run --rm -v "%~dp0:/workspace" -w /workspace rustlang/rust:nightly-slim cargo test --manifest-path packages/crypto-core/Cargo.toml
) else if "%1"=="lint-webmail" (
    cmd /c "cd %~dp0apps\webmail && npm run lint"
) else (
    echo Unknown target: %1
    exit /b 1
)
