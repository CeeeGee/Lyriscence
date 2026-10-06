@echo off
echo === Installing Python packages ===
python -m pip install -r helper\requirements.txt
echo.
echo === Installing app packages (takes a minute) ===
cd app
call npm install
echo.
echo Done. Now double-click start.bat
pause
