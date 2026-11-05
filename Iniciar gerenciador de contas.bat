@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Instale as dependencias com npm install antes de iniciar.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
