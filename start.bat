@echo off
setlocal ENABLEEXTENSIONS
pushd "%~dp0" || exit /b 1

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm was not found on PATH.
  echo Searching common installation paths...

  if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%PATH%;%ProgramFiles%\nodejs"
  if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "PATH=%PATH%;%ProgramFiles(x86)%\nodejs"

  where npm >nul 2>nul
  if errorlevel 1 (
    echo Install Node.js 20+ from https://nodejs.org and rerun this script.
    pause
    exit /b 1
  )
)

echo Installing dependencies...
call npm install
if errorlevel 1 exit /b %errorlevel%

echo Building app...
call npm run build
if errorlevel 1 exit /b %errorlevel%

echo Launching PIKO AI...
call npm start
exit /b %errorlevel%
