@echo off
title "BYOS Email Dev Environment & Public Website"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_dev.ps1" %*
echo.
pause
