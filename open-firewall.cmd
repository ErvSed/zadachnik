@echo off
chcp 65001 >nul

net session >nul 2>&1
if errorlevel 1 (
  echo Нужны права администратора.
  echo Щёлкните файл правой кнопкой мыши и выберите «Запуск от имени администратора».
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="Zadachnik TCP 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Zadachnik TCP 3000" dir=in action=allow protocol=TCP localport=3000 profile=private,domain >nul

if errorlevel 1 (
  echo Не удалось добавить правило брандмауэра.
) else (
  echo Готово: порт 3000 открыт для устройств в локальной сети.
  echo Если сервер уже запущен, откройте его адрес с телефона: http://IP-компьютера:3000
)
pause
