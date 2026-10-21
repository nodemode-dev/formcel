# FormCel

Spreadsheets in the form family. An open alternative to Excel and Google Sheets, built so that Claude Code, Codex or Cursor can read and edit a live workbook while you watch.

Version 0.1.0 · Apache-2.0 · macOS, Windows, Linux (browser now, Tauri desktop later)

**Stack.** Vanilla TypeScript and Vite · Python 3.12 and FastAPI · one calculation engine in Rust, compiled to WebAssembly for the window and to a Python module for the engine process · Tauri 2 later.

## Status

0.1.0 is the scaffold (Phase 0 of `DEV_PLAN.md`). The window, the engine process and both builds of the Rust engine install and run, and the window confirms that both report the same engine version. Workbooks, the grid and the home screen arrive in 0.2.0 (Phase 1).

| Area | In 0.1.0 |
| --- | --- |
| Engine | Rust core with a sparse cell store sized for 1,048,576 rows by 16,384 columns, A1 addresses, typed input (numbers, text, TRUE and FALSE) |
| Window | Shell with the family theme profiles applied before the first frame, engine status, the engine running in a Web Worker |
| Engine process | FastAPI on 127.0.0.1:8199, `/api/health` and `/api/version`, data folder `~/FormCel` |

## Quick start

Needs Python 3.12+, Node 20.19+ and Rust (https://rustup.rs).

```
./formcel_oc_install    # engine venv, Rust engine for Python, npm packages, Rust engine for the window
./formcel               # engine on 127.0.0.1:8199, window on http://localhost:5199
```

Windows: `formcel_oc_install.bat` then `formcel.bat`.

Data lives in `~/FormCel` (override with `FORMCEL_DATA_DIR`): Workbooks, Templates, Media, Exports.

## Ports

| Service | Address | Set by |
| --- | --- | --- |
| Window (Vite) | http://localhost:5199 | `frontend/vite.config.ts`, `server.host` false |
| Window preview | http://localhost:5299 | same file |
| Engine (FastAPI) | http://127.0.0.1:8199 | `FORMCEL_HOST`, `FORMCEL_PORT` |

Nothing listens beyond this computer.

## Layout

```
engine/     Rust workspace: formcel-core (the engine), formcel-wasm (window build), formcel-py (Python build)
backend/    FastAPI engine process: app/main.py, app/config.py, app/version.py
frontend/   Vanilla TypeScript and Vite window: src/engine (worker and client), src/ui, src/styles, src/extensions
```

## Licence

Apache-2.0. See `LICENSE` and `NOTICE.md`.
