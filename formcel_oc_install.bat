@echo off
cd /d "%~dp0"

if exist backend (
  pushd backend
  call oc_install.bat
  if errorlevel 1 (
    popd
    echo [formcel] the engine install stopped at the step above
    exit /b 1
  )
  popd
)
if exist frontend (
  pushd frontend
  call oc_install.bat
  if errorlevel 1 (
    popd
    echo [formcel] the window install stopped at the step above
    exit /b 1
  )
  popd
)
exit /b 0
