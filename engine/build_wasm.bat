@echo off
setlocal
cd /d "%~dp0"
rustup target add wasm32-unknown-unknown >nul 2>nul
cargo build -p formcel-wasm --release --target wasm32-unknown-unknown || exit /b 1
if not exist ..\frontend\public\engine mkdir ..\frontend\public\engine
set "TD=target"
if defined CARGO_TARGET_DIR set "TD=%CARGO_TARGET_DIR%"
copy /y "%TD%\wasm32-unknown-unknown\release\formcel_wasm.wasm" ..\frontend\public\engine\formcel.wasm >nul || exit /b 1
