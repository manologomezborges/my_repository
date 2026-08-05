@echo off
rem =====================================================================
rem  WitnessONE - build the ZERO-INSTALL portable Agent bundle - MG
rem  Run this ONCE on any Windows 10/11 PC with internet. It automates
rem  every step of make_portable_zip.txt:
rem    downloads the python.org "embeddable" runtime (~11 MB, no install,
rem    no admin), and packs it with the Agent + templates + UI.
rem =====================================================================
setlocal
title WitnessONE portable bundle builder
set "HERE=%~dp0"

rem ---- locate the repo (this file lives in packaging\ or the root) ----
set "SRC=%HERE%.."
if exist "%SRC%\agent\witnessone_agent.py" goto havesrc
set "SRC=%HERE%"
if exist "%SRC%\agent\witnessone_agent.py" goto havesrc
echo [X] Run this .bat from inside the unzipped WitnessONE folder.
goto fail
:havesrc

set "OUT=%HERE%WitnessONE-Agent-portable"
set "PYVER=3.12.8"
set "PYZIP=python-%PYVER%-embed-amd64.zip"

where curl >nul 2>nul
if errorlevel 1 goto notools
where tar >nul 2>nul
if errorlevel 1 goto notools

echo [1/4] Downloading Python %PYVER% embeddable runtime - about 11 MB ...
curl -L --fail -o "%TEMP%\%PYZIP%" "https://www.python.org/ftp/python/%PYVER%/%PYZIP%"
if errorlevel 1 goto dlfail

echo [2/4] Unpacking runtime ...
if not exist "%OUT%\py" mkdir "%OUT%\py"
tar -xf "%TEMP%\%PYZIP%" -C "%OUT%\py"
if errorlevel 1 goto unpackfail

echo [3/4] Copying agent + templates + UI + launcher ...
if not exist "%OUT%\agent" mkdir "%OUT%\agent"
if not exist "%OUT%\dist" mkdir "%OUT%\dist"
copy /y "%SRC%\agent\witnessone_agent.py" "%OUT%\agent\" >nul
xcopy /e /i /y "%SRC%\devices" "%OUT%\devices" >nul
xcopy /e /i /y "%SRC%\pointslists" "%OUT%\pointslists" >nul
copy /y "%SRC%\dist\WitnessONE.html" "%OUT%\dist\" >nul
copy /y "%HERE%run_agent.bat" "%OUT%\" >nul

echo [4/4] Done!
echo.
echo Bundle ready:  %OUT%
echo Copy that whole folder to any Cx laptop - USB stick works - and
echo double-click run_agent.bat inside it. No install, no admin rights.
echo.
pause
exit /b 0

:notools
echo [X] This Windows is missing curl or tar - both ship with Win10 1803+.
echo     Follow the manual steps in make_portable_zip.txt instead.
goto fail
:dlfail
echo [X] Download failed - check internet access, or download the
echo     "Windows embeddable package 64-bit" manually per make_portable_zip.txt.
goto fail
:unpackfail
echo [X] Could not unpack the runtime zip.
goto fail
:fail
echo.
pause
exit /b 1
