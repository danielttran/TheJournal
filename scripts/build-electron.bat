@echo off
REM ===========================================================================
REM  TheJournal — Build the Electron desktop installer (Windows NSIS)
REM ---------------------------------------------------------------------------
REM  Produces dist\TheJournal Setup vX.Y.Z.exe + latest.yml.
REM
REM  Usage (from project root):
REM      scripts\build-electron.bat
REM ===========================================================================

setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.." || exit /b 1

echo.
echo === TheJournal: Electron build ===
echo Project root: %CD%
echo.

REM ---------------------------------------------------------------------------
REM Prerequisites: Node, npm.
REM ---------------------------------------------------------------------------
where node >nul 2>nul || (
    echo [error] Node.js not on PATH. Install Node 22 from https://nodejs.org/
    popd & exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 22 (
    echo [error] Node %NODE_MAJOR% too old. Need Node 22+.
    popd & exit /b 1
)

REM ---------------------------------------------------------------------------
REM Install. Electron + electron-builder + the native SQLCipher binding
REM live in devDependencies; npm ci installs everything from the lockfile.
REM ---------------------------------------------------------------------------
echo [1/3] Installing dependencies with npm ci...
call npm ci
if errorlevel 1 (
    echo [error] npm ci failed.
    popd & exit /b 1
)

REM ---------------------------------------------------------------------------
REM Compile Next.js. build:electron runs `next build` without the standalone
REM staging — the Electron build embeds Next.js programmatically and reads
REM .next/ directly, so the standalone bundle would only add weight.
REM ---------------------------------------------------------------------------
echo.
echo [2/3] Compiling Next.js for Electron...
call npm run build:electron
if errorlevel 1 (
    echo [error] npm run build:electron failed.
    popd & exit /b 1
)

REM ---------------------------------------------------------------------------
REM Build installer. build:installer runs scripts/install-sqlite.js (rebuilds
REM @journeyapps/sqlcipher's native binding against the Electron runtime's
REM V8 ABI) and then electron-builder, which honours electron-builder.yml
REM (Windows NSIS target, publish: github).
REM
REM electron-builder needs GH_TOKEN to publish to GitHub Releases. When run
REM locally without GH_TOKEN it builds the installer but doesn't upload.
REM ---------------------------------------------------------------------------
echo.
echo [3/3] Building NSIS installer (this can take several minutes)...
call npm run build:installer
if errorlevel 1 (
    echo [error] npm run build:installer failed.
    popd & exit /b 1
)

REM ---------------------------------------------------------------------------
REM Surface where the artifacts landed.
REM ---------------------------------------------------------------------------
echo.
echo === Electron build complete ===
echo Installer dir: %CD%\dist\
echo.
echo Generated artifacts:
for %%f in (dist\*.exe dist\latest.yml) do (
    if exist "%%f" echo     %%f
)
echo.
echo To publish to GitHub Releases: set GH_TOKEN before running this script,
echo OR push a v*.*.* tag — the .github\workflows\release.yml workflow runs
echo this same build on a windows-latest runner and uploads automatically.
echo.

popd
endlocal
exit /b 0
