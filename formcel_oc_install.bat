@echo off
cd /d "%~dp0"

if exist backend (
  pushd backend && call oc_install.bat && popd
)
if exist frontend (
  pushd frontend && call oc_install.bat && popd
)
