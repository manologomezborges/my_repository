@echo off
rem =====================================================================
rem  WitnessONE Agent launcher - MG
rem  Works from BOTH layouts:
rem    - the unzipped repo (this file in packaging\ or the root)
rem    - the portable bundle (py\ runtime beside this file)
rem =====================================================================
setlocal
title WitnessONE Agent
set "HERE=%~dp0"

rem ---- find the agent script -----------------------------------------
set "AGENT=%HERE%agent\witnessone_agent.py"
if exist "%AGENT%" goto findpy
set "AGENT=%HERE%..\agent\witnessone_agent.py"
if exist "%AGENT%" goto findpy
set "AGENT=%HERE%witnessone_agent.py"
if exist "%AGENT%" goto findpy
echo [X] Cannot find witnessone_agent.py.
echo     Keep this .bat inside the unzipped WitnessONE folder.
goto fail

:findpy
rem ---- pick a Python: embedded runtime, then py launcher, then PATH ---
set "PYARG="
set "PYEXE=%HERE%py\python.exe"
if exist "%PYEXE%" goto run
set "PYEXE=%HERE%..\py\python.exe"
if exist "%PYEXE%" goto run
where py >nul 2>nul
if errorlevel 1 goto trypython
set "PYEXE=py"
set "PYARG=-3"
goto run
:trypython
where python >nul 2>nul
if errorlevel 1 goto nopython
set "PYEXE=python"
goto run

:nopython
echo.
echo [X] Python 3 was not found on this machine. Three ways forward:
echo     A. Install Python from https://www.python.org/downloads/
echo        and tick "Add python.exe to PATH" during setup.
echo     B. Zero-install: double-click make_portable_bundle.bat once
echo        on any online Windows PC, then use the bundle it creates.
echo     C. Demo only: open dist\WitnessONE.html directly - no agent needed.
goto fail

:run
echo Starting WitnessONE Agent on http://127.0.0.1:5710 ...
"%PYEXE%" %PYARG% "%AGENT%" %*
echo.
echo Agent stopped.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
