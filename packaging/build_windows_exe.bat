@echo off
rem ============================================================
rem  WitnessONE Agent - standalone Windows .exe builder  (MG)
rem  Run this ONCE on any Windows machine that has Python 3.9+.
rem  Output: dist\WitnessONE.exe  (~12 MB, needs NOTHING
rem  installed on the target laptops - no Python, no admin).
rem ============================================================
setlocal
cd /d "%~dp0"

set "PY=py -3"
where py >nul 2>nul
if not errorlevel 1 goto havepy
set "PY=python"
where python >nul 2>nul
if not errorlevel 1 goto havepy
echo [X] Python was not found. Install it from https://www.python.org/downloads/
echo     and tick "Add python.exe to PATH", then run this .bat again.
echo     No Python at all? Use make_portable_bundle.bat instead - zero install.
pause
exit /b 1
:havepy

%PY% -m pip install --upgrade pyinstaller
if errorlevel 1 goto pipfail
%PY% -m PyInstaller --onefile --console --name WitnessONE ^
  --add-data "..\devices;devices" ^
  --add-data "..\pointslists;pointslists" ^
  --add-data "..\dist\WitnessONE.html;." ^
  ..\agent\witnessone_agent.py
if errorlevel 1 goto buildfail
echo.
echo Done. Ship dist\WitnessONE.exe to the Cx laptops - double-click = full app.
echo Ask IT to code-sign it so SmartScreen and AV stay quiet.
pause
exit /b 0

:pipfail
echo [X] Could not install PyInstaller - corporate proxy blocking pip?
echo     Zero-network alternative: make_portable_bundle.bat needs only
echo     one 11 MB download from python.org.
pause
exit /b 1
:buildfail
echo [X] PyInstaller build failed - scroll up for the error.
pause
exit /b 1
