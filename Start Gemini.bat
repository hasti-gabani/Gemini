@echo off
rem Double-click to start Gemini in the background (data server on port 8100, app on port 3100).
rem It keeps running after this window closes. Parts that are already running are left alone.
cd /d "%~dp0"
"backend\venv\Scripts\python.exe" scripts\runner.py start
echo.
echo Gemini is running. On this computer: http://localhost:3100
echo On a phone on the same Wi-Fi, use the https address printed above. It changes when the Wi-Fi changes.
start "" http://localhost:3100
timeout /t 20 >nul
