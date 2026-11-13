@echo off
cd /d "%~dp0"
if not exist public\engine\formcel.wasm ( call ..\engine\build_wasm.bat || exit /b 1 )
npm run dev
