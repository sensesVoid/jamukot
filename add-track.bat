@echo off
cd /d "%~dp0"
python scripts\add_track.py %1 --title %2 --artist %3 --push
if errorlevel 1 (echo Failed. & pause & exit /b 1)
echo Done! Refresh https://sensesvoid.github.io/jamukot/ in ~1 min.
pause
