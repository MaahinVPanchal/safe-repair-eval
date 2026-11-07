@echo off
rem Safe Repair Agent - one-click launcher
rem Starts the control server (port 8000) and the dashboard (port 5173),
rem then opens the browser. Close the windows to stop everything.

cd /d "%~dp0"

echo Starting control server...
start "SRA control server (keep open)" cmd /k python tools\eval_server.py

echo Starting dashboard...
start "SRA dashboard (keep open)" cmd /k cmd /c "cd dashboard-app && npm run dev"

timeout /t 4 >nul
start http://localhost:5173
echo Done - dashboard should be open at http://localhost:5173
