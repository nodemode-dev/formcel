@echo off
cd /d "%~dp0"
if /i "%~1"=="mcp" goto :mcp
if /i "%~1"=="agents" goto :agents
if /i "%~1"=="cli" goto :cli
if /i "%~1"=="mcpb" goto :mcpb

if exist backend (
  start "FormCel engine" cmd /k "cd backend && boot_backend.bat"
)
if exist frontend (
  start "FormCel window" cmd /k "cd frontend && boot_frontend.bat"
)
exit /b 0

:mcp
python setup\mcp_stdio.py %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%
:agents
python setup\agents.py %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%
:cli
python setup\catalogue.py %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%
:mcpb
if /i "%~2"=="build" goto :mcpb_build
python setup\mcpb.py --check
exit /b %errorlevel%
:mcpb_build
python setup\mcpb.py --build "%~3"
exit /b %errorlevel%
