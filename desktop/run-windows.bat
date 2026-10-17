@echo off
title Pain — Windows Companion
echo ========================================================
echo  Pain — Minimalist Audio Player and Sync Companion
echo ========================================================
echo.
cd /d "%~dp0"
if exist "Pain.exe" (
    echo Launching Pain standalone application...
    start "" "Pain.exe"
    exit /b 0
)
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Error: Node.js is required when running from raw source.
    echo Please install Node.js from https://nodejs.org/ or use Pain.exe.
    pause
    exit /b 1
)

echo Starting Pain Windows Companion...
node src/server.js
pause
