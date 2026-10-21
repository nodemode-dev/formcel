@echo off
cd /d "%~dp0"
call venv\Scripts\activate.bat
if "%FORMCEL_HOST%"=="" set FORMCEL_HOST=127.0.0.1
if "%FORMCEL_PORT%"=="" set FORMCEL_PORT=8199
uvicorn app.main:app --reload --host %FORMCEL_HOST% --port %FORMCEL_PORT%
