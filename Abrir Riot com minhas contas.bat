@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Instalando dependencias pela primeira vez...
  call npm install || goto :error
  node node_modules\electron\install.js || goto :error
)
start "" "node_modules\electron\dist\electron.exe" . --riot-login
exit /b 0

:error
echo.
echo Falha ao instalar. Verifique se o Node.js esta instalado.
pause
