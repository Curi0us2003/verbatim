@echo off
rem Double-click to start Verbatim. The browser opens by itself when the app is ready.
rem Keep this window open while you use the app; close it to stop Verbatim.
title Verbatim
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found. Run "Setup Verbatim" first.
  echo.
  pause
  exit /b 1
)
node scripts\start.mjs
if errorlevel 1 pause
