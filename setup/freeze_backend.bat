@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
pushd "%ROOT%\backend" || exit /b 1
call venv\Scripts\activate.bat || ( echo [formcel] backend venv missing, run formcel_oc_install.bat & exit /b 1 )
python -c "import PyInstaller" 2>nul || ( echo [formcel] PyInstaller missing: pip install -r requirements_desktop.txt & exit /b 1 )
if not exist "%ROOT%\frontend\dist\index.html" ( pushd "%ROOT%\frontend" & call npm run build & popd )
for /f "tokens=2" %%T in ('rustc -vV ^| findstr /b "host:"') do set "TRIPLE=%%T"
if defined FORMCEL_TARGET set "TRIPLE=%FORMCEL_TARGET%"
if exist build\pyinstaller rmdir /s /q build\pyinstaller
if exist dist-engine rmdir /s /q dist-engine
pyinstaller --noconfirm --clean --onefile --name formcel-engine ^
  --distpath dist-engine --workpath build\pyinstaller --specpath build\pyinstaller ^
  --add-data "%ROOT%\frontend\dist;frontend_dist" ^
  --add-data "%ROOT%\backend\app\dictionaries;app\dictionaries" ^
  --add-data "%ROOT%\backend\app\templates;app\templates" ^
  --add-data "%ROOT%\backend\app\services\xlsx\future.json;app\services\xlsx" ^
  --add-data "%ROOT%\backend\app\services\pyrun_child.py;app\services" ^
  --add-data "%ROOT%\backend\app\services\gas_runner.js;app\services" ^
  --collect-submodules app --collect-submodules uvicorn --hidden-import formcel_engine ^
  --exclude-module psycopg --exclude-module psycopg_binary --exclude-module chardet ^
  "%ROOT%\backend\engine_main.py" || exit /b 1
if not exist "%ROOT%\src-tauri\binaries" mkdir "%ROOT%\src-tauri\binaries"
copy /y dist-engine\formcel-engine.exe "%ROOT%\src-tauri\binaries\formcel-engine-%TRIPLE%.exe" >nul || exit /b 1
"%ROOT%\src-tauri\binaries\formcel-engine-%TRIPLE%.exe" --selfcheck || exit /b 1
echo [formcel] sidecar ready: src-tauri\binaries\formcel-engine-%TRIPLE%.exe
popd
exit /b 0
