@echo off
setlocal
set "ROOT=%~dp0"

echo === AI Cartoon Maker ===

rem MySQL (WAMP) harus sudah hidup di port 3306
netstat -ano | findstr /R /C:":3306 .*LISTENING" >nul
if errorlevel 1 (
  echo [!] MySQL tidak terdeteksi di port 3306. Nyalakan WAMP dulu, lalu jalankan ulang.
  pause
  exit /b 1
)

if not exist "%ROOT%frontend\node_modules" (
  echo Memasang dependensi frontend...
  pushd "%ROOT%frontend" && call npm install && popd
)

echo Menjalankan migrasi database...
pushd "%ROOT%backend" && php artisan migrate --force && popd
if errorlevel 1 (
  echo [!] Migrasi gagal. Periksa DB_* di backend\.env
  pause
  exit /b 1
)

start "Backend :8000"  /D "%ROOT%backend"  cmd /k php artisan serve
start "Queue worker"   /D "%ROOT%backend"  cmd /k php artisan queue:work --tries=1
start "Frontend :5173" /D "%ROOT%frontend" cmd /k npm run dev

echo.
echo Menunggu server siap...
timeout /t 6 /nobreak >nul
start "" http://localhost:5173

echo Tiga jendela terbuka (Backend, Queue worker, Frontend). Tutup jendela-jendela itu untuk berhenti.
endlocal
