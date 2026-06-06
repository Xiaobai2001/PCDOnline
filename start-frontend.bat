@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ========================================
echo   PCD Online Editor - Frontend
echo ========================================
echo.

set "BASE_DIR=%~dp0"
set "FRONTEND_DIR=%BASE_DIR%frontend"

pushd "!FRONTEND_DIR!"
if %errorlevel% neq 0 (
    echo [ERROR] Cannot enter frontend directory: !FRONTEND_DIR!
    goto :end
)

echo [1/2] Installing dependencies...
call npm install

if %errorlevel% neq 0 (
    echo [ERROR] npm install failed
    echo Please check if Node.js is installed: node --version
    goto :end
)

echo.
echo [2/2] Starting dev server...
echo URL: http://localhost:5177
echo Press Ctrl+C to stop
echo.
call npm run dev

set "EXIT_CODE=%errorlevel%"
if !EXIT_CODE! neq 0 (
    echo.
    echo [ERROR] Frontend exited with code !EXIT_CODE!
)

:end
popd
echo.
pause
endlocal
