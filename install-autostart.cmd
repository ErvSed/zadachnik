@echo off
chcp 65001 >nul
cd /d "%~dp0"

for /f "delims=" %%i in ('where node') do set "NODEPATH=%%i"
if not defined NODEPATH (
  echo Node.js не найден. Установите его с https://nodejs.org
  pause
  exit /b 1
)

echo Добавляем задачу автозапуска «Zadachnik»…
schtasks /Create /TN "Zadachnik" /TR "\"%NODEPATH%\" \"%~dp0server.js\"" /SC ONLOGON /RL LIMITED /F

if errorlevel 1 (
  echo.
  echo Не удалось создать задачу автоматически.
  echo Откройте «Планировщик заданий» и создайте задачу вручную:
  echo   программа: %NODEPATH%
  echo   аргументы: "%~dp0server.js"
  echo   триггер: при входе в систему
) else (
  echo Готово: задачник будет запускаться при входе в Windows.
  echo Удалить автозапуск: schtasks /Delete /TN "Zadachnik" /F
)
pause
