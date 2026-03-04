@echo off
title tact-intensity-OSC
echo tact-intensity-OSC - VRChat OSC to bHaptics
echo.
echo Installing dependencies...
call npm install
if errorlevel 1 (
  echo Failed to install. Check Node.js: https://nodejs.org/
  pause
  exit /b 1
)
echo.
echo Dashboard: http://localhost:1969
echo Opening browser in 4 seconds...
start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:1969"
npm start
