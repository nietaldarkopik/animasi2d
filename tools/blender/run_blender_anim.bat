@echo off
setlocal enabledelayedexpansion
set "ROOT=%~dp0..\.."

echo ========================================================
echo     Blender 2.5D Character Animator (animasi2d)
echo ========================================================
echo.

rem Periksa apakah Blender MCP online di port 9876
netstat -ano | findstr /R /C:":9876 .*LISTENING" >nul
if errorlevel 1 (
    echo [*] Blender MCP socket (:9876) belum aktif.
    echo [*] Animasi akan dirender otomatis via Blender Background CLI.
) else (
    echo [✓] Terhubung ke Blender MCP Server (:9876).
)
echo.

if "%~1"=="" (
    echo Contoh penggunaan:
    echo   1. Dari file naskah:
    echo      run_blender_anim.bat --script naskah/uki-kesiangan.json --save-blend output/hasil.blend --render-still output/preview.jpg
    echo.
    echo   2. Dari prompt teks:
    echo      run_blender_anim.bat --prompt "Arum: Hah?! | Uki: Tenang!" --render-still output/dialog.jpg
    echo.
    echo Menjalankan contoh naskah default (uki-kesiangan)...
    python "%~dp0script_to_blender.py" --script "%ROOT%\naskah\uki-kesiangan.json" --save-blend "%~dp0output\contoh_naskah.blend" --render-still "%~dp0output\contoh_preview.jpg"
) else (
    python "%~dp0script_to_blender.py" %*
)

echo.
echo Selesai.
pause

