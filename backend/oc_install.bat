@echo off
cd /d "%~dp0"

python -m venv venv || exit /b 1
call venv\Scripts\activate.bat || exit /b 1
python -m pip install --upgrade pip || exit /b 1
python -m pip install -r requirements.txt || exit /b 1

where cargo >nul 2>nul
if errorlevel 1 (
  echo FormCel needs Rust to build its engine. Install it from https://rustup.rs, then run this again.
  exit /b 1
)
python -m pip install --force-reinstall --no-deps ..\engine\crates\formcel-py || exit /b 1
python -c "import formcel_engine" || (
  echo The FormCel engine module was built but does not load. Run: rustup update stable, then formcel_oc_install.bat again.
  exit /b 1
)

where tesseract >nul 2>nul
if errorlevel 1 (
  echo Data from a picture needs the Tesseract program ^(Apache-2.0^).
  where winget >nul 2>nul
  if errorlevel 1 (
    echo Install Tesseract from https://github.com/UB-Mannheim/tesseract/wiki and add its folder to PATH. FormCel works without it; only Data from a picture is unavailable.
  ) else (
    winget install --id UB-Mannheim.TesseractOCR -e --accept-package-agreements --accept-source-agreements
    echo If Tesseract was just installed, open a new window so PATH includes it. FormCel works without it; only Data from a picture is unavailable.
  )
) else (
  echo Tesseract found.
)
exit /b 0
