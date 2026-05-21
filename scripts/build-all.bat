@echo off
REM ===========================================================================
REM  TheJournal — Build BOTH the web bundle AND the Electron installer.
REM ---------------------------------------------------------------------------
REM  Convenience wrapper that calls scripts\build-web.bat then
REM  scripts\build-electron.bat. Each step exits non-zero on failure so the
REM  wrapper propagates the error.
REM
REM  Usage (from project root):
REM      scripts\build-all.bat
REM ===========================================================================

setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.." || exit /b 1

echo.
echo === TheJournal: building BOTH targets ===
echo Project root: %CD%
echo.

call "%SCRIPT_DIR%build-web.bat"
if errorlevel 1 (
    echo [error] Web build failed; not attempting Electron build.
    popd & exit /b 1
)

call "%SCRIPT_DIR%build-electron.bat"
if errorlevel 1 (
    echo [error] Electron build failed.
    popd & exit /b 1
)

echo.
echo === All builds complete ===
echo Web:      %CD%\.next\standalone\
echo Electron: %CD%\dist\
echo.

popd
endlocal
exit /b 0
