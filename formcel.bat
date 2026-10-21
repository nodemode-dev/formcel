@echo off
cd /d "%~dp0"

if exist backend (
  start "FormCel engine" cmd /k "cd backend && boot_backend.bat"
)
if exist frontend (
  start "FormCel window" cmd /k "cd frontend && boot_frontend.bat"
)
