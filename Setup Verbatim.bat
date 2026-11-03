@echo off
rem Double-click to install Verbatim on this computer (one time only).
title Verbatim setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1" %*
if errorlevel 1 (
  echo.
  echo   Setup did not finish. Read the message above, fix it, and run Setup Verbatim again.
)
echo.
pause
