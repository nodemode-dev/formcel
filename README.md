# FormCel

Spreadsheets in the form family. An open alternative to Excel and Google Sheets, built so that Claude Code, Codex or Cursor can read and edit a live workbook while you watch.

Version 0.3.0 · Apache-2.0 · macOS, Windows, Linux (browser now, Tauri desktop later)

**Stack.** Vanilla TypeScript and Vite · Python 3.12 and FastAPI · one calculation engine in Rust, compiled to WebAssembly for the window and to a Python module for the engine process · Tauri 2 later.

## Status

0.3.0 completes the second part of Phase 1 in `DEV_PLAN.md`: the home screen, saving and templates, on top of the 0.2.0 grid.

| Area | In 0.3.0 |
| --- | --- |
| Home | Start, Recent, Templates (category chips and search) and Trash, after formdeck; thumbnails of each workbook's first sheet |
| Saving | `.fcel` files in `~/FormCel/Workbooks`, saved as you type; rename in the top bar; Trash with restore |
| Sheets | Several per workbook, tabs to switch, a button to add one |
| Templates | 34: six made for FormCel and 28 from form.md 0.46.0 with their data |
| Engine | Rust core, one build for the window (WebAssembly) and one for the engine process (Python): a chunked cell store for 1,048,576 rows by 16,384 columns, typed input (numbers, text, TRUE and FALSE), undo and redo of 500 steps, batched edits, viewport reads, the used range and Ctrl+arrow data edges |
| Grid | Canvas grid with headers and selection of cells, ranges, rows, columns and the whole sheet; arrows, Ctrl+arrows, Ctrl+Home, Ctrl+End, Home, Page Up and Down; typing, F2 and Alt+Enter; Name Box and formula bar; undo, redo, clear; copy, cut and paste of tab-separated text; resizing rows and columns, autofit columns; freeze top row, first column or panes at the active cell |
| Speed | 1,000,000 filled rows scroll at a 16.7 ms p95 frame with the CPU slowed 4x |
| Window | Family theme profiles applied before the first frame, engine status, the engine running in a Web Worker |
| Engine process | FastAPI on 127.0.0.1:8199: `/api/health`, `/api/version`, `/api/workbooks`, `/api/trash`, `/api/templates`, `/api/commands`; data folder `~/FormCel` |

## Keys

| Keys | Does |
| --- | --- |
| Arrows, Shift+arrows | Move, extend the selection |
| Ctrl+arrows (Cmd on a Mac) | Jump to the edge of the data |
| Ctrl+Home, Ctrl+End | A1, the last cell of the used range |
| Enter, Tab (Shift to reverse) | Commit and move |
| F2, or start typing | Edit the cell; Alt+Enter adds a line |
| Delete | Clear the selection |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+C, Ctrl+X, Ctrl+V | Copy, cut, paste as tab-separated text |
| Double-click a column border | Autofit the column |

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
