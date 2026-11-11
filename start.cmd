@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите его с https://nodejs.org и запустите снова.
  pause
  exit /b 1
)

if not exist data mkdir data
title Задачник
node server.js

echo.
echo Сервер остановлен.
pause
