@echo off
cd /d "%~dp0"
rustup target add wasm32-unknown-unknown >nul 2>nul
cargo build -p formcel-wasm --release --target wasm32-unknown-unknown || exit /b 1
if not exist ..\frontend\public\engine mkdir ..\frontend\public\engine
copy /y target\wasm32-unknown-unknown\release\formcel_wasm.wasm ..\frontend\public\engine\formcel.wasm >nul
