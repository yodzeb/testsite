@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py -3 tools\editor\run.py) || (python tools\editor\run.py)
if errorlevel 1 (
  echo.
  echo Si Python n'est pas installe : https://www.python.org/downloads/ ^(cochez "Add Python to PATH"^)
)
pause
