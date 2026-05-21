@echo off
REM ===========================================================================
REM  TheJournal — Build the self-hosted web bundle (Windows)
REM ---------------------------------------------------------------------------
REM  Produces .next\standalone\ ready for `node server.js`.
REM
REM  Usage (from project root):
REM      scripts\build-web.bat
REM ===========================================================================

setlocal EnableDelayedExpansion

REM Resolve project root: parent of this script's directory.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.." || exit /b 1

echo.
echo === TheJournal: web build ===
echo Project root: %CD%
echo.

REM ---------------------------------------------------------------------------
REM Node version check (>= 22). The SQLCipher prebuilt binding ships for
REM napi-v6 which requires Node 22 or newer.
REM ---------------------------------------------------------------------------
where node >nul 2>nul || (
    echo [error] Node.js is not installed or not on PATH.
    echo         Install Node 22 from https://nodejs.org/
    popd & exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 22 (
    echo [error] Node %NODE_MAJOR% is too old. Install Node 22 or newer.
    popd & exit /b 1
)

REM ---------------------------------------------------------------------------
REM Install dependencies. `npm ci` is used over `npm install` so the lockfile
REM is authoritative — production builds must be reproducible.
REM ---------------------------------------------------------------------------
echo [1/2] Installing dependencies with npm ci...
call npm ci
if errorlevel 1 (
    echo [error] npm ci failed.
    popd & exit /b 1
)

REM ---------------------------------------------------------------------------
REM Build. `npm run build` runs `next build` then scripts/stage-standalone.js
REM which copies .next/static, public, and plugins into .next/standalone/.
REM ---------------------------------------------------------------------------
echo.
echo [2/2] Building Next.js standalone bundle...
call npm run build
if errorlevel 1 (
    echo [error] npm run build failed.
    popd & exit /b 1
)

REM ---------------------------------------------------------------------------
REM Sanity check the output.
REM ---------------------------------------------------------------------------
if not exist ".next\standalone\server.js" (
    echo [error] .next\standalone\server.js missing after build.
    popd & exit /b 1
)

echo.
echo === Web build complete ===
echo Output:        %CD%\.next\standalone\
echo Entry point:   node .next\standalone\server.js
echo Bundle size:
powershell -Command "$size = (Get-ChildItem '.next\standalone' -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB; [math]::Round($size, 1).ToString() + ' MB'"
echo.
echo To run locally (defaults to port 3000):
echo     set NODE_ENV=production
echo     set JOURNAL_DB_SECRET=^(64 hex chars - see docs\env-vars.md^)
echo     cd .next\standalone
echo     node server.js
echo.

popd
endlocal
exit /b 0
