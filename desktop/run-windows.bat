@echo off
title Pain — Windows Companion
echo ========================================================
echo  Pain — Minimalist Audio Player and Sync Companion
echo ========================================================
echo.
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Error: Node.js is required to run the Windows companion.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Starting Pain Windows Companion...
cd /d "%~dp0"
node src/server.js
pause
