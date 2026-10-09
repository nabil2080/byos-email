@echo off
if "%1"=="clean-test-data" (
    powershell -ExecutionPolicy Bypass -File "%~dp0clean-test-data.ps1"
) else if "%1"=="smoke" (
    powershell -ExecutionPolicy Bypass -File "%~dp0smoke.ps1" %2 %3
) else (
    echo Unknown target: %1
    exit /b 1
)
