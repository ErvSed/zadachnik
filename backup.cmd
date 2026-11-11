@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist data\db.json (
  echo База не найдена: data\db.json
  echo Сначала запустите сервер и создайте администратора.
  pause
  exit /b 1
)

if not exist backups mkdir backups

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"
copy /y "data\db.json" "backups\db-%STAMP%.json" >nul
if errorlevel 1 (
  echo Не удалось сделать копию.
) else (
  echo Копия сохранена: backups\db-%STAMP%.json
)
pause
