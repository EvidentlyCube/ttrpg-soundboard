@echo off
rem Starts the soundboard with the Node.js that comes with it. Options given to this file are passed on.
rem Released as "Start Soundboard.cmd", with Windows line endings.
cd /d "%~dp0"
"runtime\node.exe" "app\index.js" %*
set "code=%errorlevel%"
rem Double-clicked, the window closes as soon as this file ends, and takes the error message with it.
if not "%code%"=="0" (
	echo.
	set /p "_=Press Enter to close."
)
exit /b %code%
