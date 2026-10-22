@echo off
cd /d "%~dp0"

python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt

where cargo >nul 2>nul
if errorlevel 1 (
  echo FormCel needs Rust to build its engine. Install it from https://rustup.rs, then run this again.
  exit /b 1
)
pip install --force-reinstall --no-deps ..\engine\crates\formcel-py || exit /b 1
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
