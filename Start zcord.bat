@echo off
rem Double-click to start zcord from this folder (Windows).
rem The first run installs zcord's parts and puts a zcord shortcut on your Desktop.
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo zcord needs Node.js. Opening the download page - install the LTS version, then double-click "Start zcord" again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing zcord. This takes a minute or two...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1"

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0
