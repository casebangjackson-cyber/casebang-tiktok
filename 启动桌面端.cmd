@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron missing, running npm install...
  call npm install
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
endlocal
