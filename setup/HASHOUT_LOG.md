# setup HASHOUT log

### setup/freeze_backend, setup/freeze_backend.bat · no console window for the Windows engine
- refers-to: setup/freeze_backend (the Windows branch, `ext=.exe`), setup/freeze_backend.bat (`WINDOWED`), backend/engine_main.py (the missing streams)
- kind: decision
- logged: v0.47.0 · 2026-11-20

The owner's decision D3: a Windows engine is packaged with no console window in every app, as FormWeb's is. Both freeze scripts now give PyInstaller `--noconsole` on Windows unless `FORMCEL_ENGINE_WINDOWED=0`. The shell already starts the engine with no window and reads its key line and address from pipes, which a windowed engine still has. When the engine is started with no streams at all (from Explorer, or the `--selfcheck` step of the `.bat`), `engine_main.py` replaces each missing stream with the null device before anything prints, so `--selfcheck` still runs and its exit code still decides the build; its words are not seen there. Checked with `bash -n` and by reading the `.bat`; no Windows build has shown it.
