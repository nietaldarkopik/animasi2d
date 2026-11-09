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

start "Backend :8010"  /D "%ROOT%backend"  cmd /k php artisan serve --host=127.0.0.1 --port=8010
start "Queue worker"   /D "%ROOT%backend"  cmd /k php artisan queue:work --queue=default --tries=1
rem worker kedua khusus cerita/film: satu film menunggu ekspor yang dikerjakan worker di atas, jadi tidak boleh satu worker saja
start "Queue cerita"   /D "%ROOT%backend"  cmd /k php artisan queue:work --queue=story --tries=1
start "Frontend :5173" /D "%ROOT%frontend" cmd /k npm run dev
rem Penjadwal Laravel: membuat film kartun harian otomatis tiap pagi jam 07:00 (lihat backend/routes/console.php) dan membersihkan data lama.
rem Hapus baris ini (atau tutup jendelanya) bila Anda TIDAK ingin film dibuat otomatis.
start "Scheduler (film harian 07:00)" /D "%ROOT%backend" cmd /k php artisan schedule:work

echo.
echo Menunggu server siap...
timeout /t 6 /nobreak >nul
start "" http://localhost:5173

echo Empat jendela terbuka (Backend, Queue worker, Frontend, Scheduler). Tutup jendela-jendela itu untuk berhenti.
endlocal
