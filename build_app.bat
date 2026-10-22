@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "OPEN=0"
for %%A in (%*) do (
  if /i "%%~A"=="--open" ( set "OPEN=1" ) else if /i "%%~A"=="--help" ( goto :usage ) else if /i "%%~A"=="-h" ( goto :usage ) else ( call :usage & exit /b 2 )
)

echo.
echo [formcel] == checking the tools
where python >nul 2>nul || ( echo [formcel] Python 3.12 or newer is needed: https://www.python.org/downloads/ & exit /b 1 )
where node >nul 2>nul || ( echo [formcel] Node 20.19 or newer is needed: https://nodejs.org & exit /b 1 )
where cargo >nul 2>nul || ( echo [formcel] Rust is needed: https://rustup.rs & exit /b 1 )
rustup target add wasm32-unknown-unknown >nul 2>nul

echo.
echo [formcel] == installing the engine and the window
call formcel_oc_install.bat || goto :failed

echo.
echo [formcel] == installing the desktop packages (PyInstaller, the Tauri command line)
call backend\venv\Scripts\activate.bat || goto :failed
pip install -r backend\requirements_desktop.txt || goto :failed
if not exist frontend\node_modules\.bin\tauri.cmd ( pushd frontend & call npm install & popd )

echo.
echo [formcel] == building the window
pushd frontend
call npm run build || ( popd & goto :failed )
popd

echo.
echo [formcel] == freezing the engine into the app
call setup\freeze_backend.bat || goto :failed

echo.
echo [formcel] == building the desktop app
echo [formcel] the first build compiles several hundred Rust crates
call frontend\node_modules\.bin\tauri.cmd build --bundles msi,nsis || goto :failed

echo.
echo [formcel] done. The installers are in src-tauri\target\release\bundle (msi and nsis)
if "%OPEN%"=="1" start "" "src-tauri\target\release\bundle"
exit /b 0

:failed
echo.
echo [formcel] the build stopped at the step above; fix what it says and run build_app.bat again
exit /b 1

:usage
echo build_app.bat           build the FormCel desktop app on Windows, start to finish
echo   --open                open the folder with the installers when the build is done
exit /b 0
