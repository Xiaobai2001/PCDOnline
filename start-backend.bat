@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ========================================
echo   PCD Online Editor - Backend
echo ========================================
echo.

set "BASE_DIR=%~dp0"
set "BACKEND_DIR=%BASE_DIR%backend"

pushd "!BACKEND_DIR!"
if %errorlevel% neq 0 (
    echo [ERROR] Cannot enter backend directory: !BACKEND_DIR!
    goto :end
)

if not exist "PcdOnlineEditor.Api.csproj" (
    echo [ERROR] Project file not found in: !CD!
    goto :end
)

echo Starting .NET API server...
echo URL: http://localhost:5088
echo Press Ctrl+C to stop
echo.

dotnet run

set "EXIT_CODE=%errorlevel%"
if !EXIT_CODE! neq 0 (
    echo.
    echo [ERROR] Backend exited with code !EXIT_CODE!
    echo Please check if .NET SDK is installed: dotnet --version
)

:end
popd
echo.
pause
endlocal
