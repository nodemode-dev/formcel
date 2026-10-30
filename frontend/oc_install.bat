@echo off
cd /d "%~dp0"
call npm install || exit /b 1
where cargo >nul 2>nul
if errorlevel 1 (
  echo FormCel needs Rust to build its engine. Install it from https://rustup.rs, then run this again.
  exit /b 1
)
call ..\engine\build_wasm.bat || exit /b 1
exit /b 0
