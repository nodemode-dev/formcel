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
pip install ..\engine\crates\formcel-py
