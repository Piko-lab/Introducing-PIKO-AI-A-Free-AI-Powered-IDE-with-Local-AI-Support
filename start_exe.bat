@echo off
setlocal
cd /d "%~dp0"

if not exist "outexe" mkdir "outexe"

echo [1/3] Generating kraken icons...
call npm run icon
if errorlevel 1 goto :fail

echo [2/3] Building app + NSIS installer...
call npm run dist:nsis
if errorlevel 1 goto :fail

echo [3/3] Copying fresh installer to outexe...
copy /Y "release\setup_piko.exe" "outexe\setup_piko.exe"
if errorlevel 1 goto :fail

echo.
echo Done: outexe\setup_piko.exe
pause
exit /b 0

:fail
echo.
echo BUILD FAILED - see output above.
pause
exit /b 1