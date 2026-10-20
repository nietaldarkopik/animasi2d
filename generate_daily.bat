@echo off
setlocal enabledelayedexpansion
set "ROOT=%~dp0"

echo ===================================================
echo     AI Cartoon Maker - Pembuat Kartun Otomatis
echo ===================================================
echo.

rem Periksa MySQL port 3306
netstat -ano | findstr /R /C:":3306 .*LISTENING" >nul
if errorlevel 1 (
  echo [!] MySQL belum hidup di port 3306. Pastikan WAMP sudah aktif.
  pause
  exit /b 1
)

rem Periksa apakah server backend berjalan di port 8000
netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul
if errorlevel 1 (
  echo [*] Menyalakan backend Laravel di latar belakang...
  start "Backend :8000" /min /D "%ROOT%backend" cmd /c php artisan serve
  timeout /t 3 /nobreak >nul
)

rem Periksa apakah queue worker berjalan
netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul
start "Queue Worker" /min /D "%ROOT%backend" cmd /c php artisan queue:work --tries=1

rem Periksa apakah frontend dev server berjalan di port 5173
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul
if errorlevel 1 (
  echo [*] Menyalakan frontend Vite di latar belakang...
  start "Frontend :5173" /min /D "%ROOT%frontend" cmd /c npm run dev
  timeout /t 5 /nobreak >nul
)

echo [*] Menjalankan generator kartun harian dan headless render...
echo.
pushd "%ROOT%backend"
php artisan cartoon:generate-daily --user=1 --export %*
popd

echo.
echo [*] Membuka folder hasil video...
if exist "%ROOT%daily_output" (
  start "" "%ROOT%daily_output"
)

echo.
echo Selesai! Tekan sembarang tombol untuk menutup jendela ini.
pause >nul
endlocal
