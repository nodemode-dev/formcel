# HASHOUT_LOG · backend · formcel

Living log of comment content and rationale for the engine process. Source stays comment-free; it lives here.

Current build version: v0.3.0
Last updated: 2026-10-21 · store, templates, commands

---

## Org-navi-map

```
backend/
├── requirements.txt / requirements_macos.txt   fastapi, uvicorn, maturin
├── oc_install(.bat)        venv, requirements, then the Rust engine as formcel_engine
├── boot_backend(.bat)      uvicorn on FORMCEL_HOST:FORMCEL_PORT, default 127.0.0.1:8199
└── app/
    ├── main.py             FastAPI app, /api/health, /api/version, mounts the routers
    ├── config.py           host, port, data folder and its subfolders
    ├── version.py          VERSION
    ├── routers/workbooks.py   /api/workbooks, /api/trash, /api/templates
    ├── routers/commands.py    /api/commands, published by the window
    ├── services/store.py      .fcel files, open workbooks held in the Rust engine
    ├── services/templates.py  the template catalogue
    └── templates/             native.json (6 made for FormCel), formmd.json (28 from form.md)
```

## v0.3.0 entries

### services/store.py · the .fcel file
- refers-to: app/services/store.py :: Store._write, _read
- kind: explainer
- logged: v0.3.0 · 2026-10-21

A zip with `mimetype` and `workbook.json`: format "fcel", version 1, id, title, created, modified, template, an 8 by 6 preview of the first sheet for Home, and each sheet's name and cells as [row, col, text]. Written to a `.fcel.tmp` and moved over the old file, so a crash mid-write leaves the last good copy. Cells are stored as their display text until Phase 2 adds formulas and types.

### services/store.py · one engine per open workbook
- refers-to: app/services/store.py :: Store._load, edit
- kind: rationale
- logged: v0.3.0 · 2026-10-21

The engine process keeps each opened workbook in a `formcel_engine.Workbook` (the Rust core) and applies the window's edits with `load`, which records no undo step: history lives in the window. Every edit batch rewrites the file; the window batches keystrokes for 400 ms.

### services/store.py · ids and paths
- refers-to: app/services/store.py :: Store.path
- kind: warning-context
- logged: v0.3.0 · 2026-10-21

Ids are 12 hex characters; `path` refuses anything that is not alphanumeric, so no request can name a file outside `Workbooks` or `Trash`. Checked: `..%2F..%2Fetc` and `zz..zz` both answer 404.

### services/store.py · listing, not list
- refers-to: app/services/store.py :: Store.listing
- kind: warning-context
- logged: v0.3.0 · 2026-10-21

The method was first called `list`, which shadowed the built-in inside the class, so the later annotation `list[tuple[...]]` raised at import and the reloading server stopped answering. Renamed.

### templates/formmd.json · how it was made
- refers-to: app/templates/formmd.json
- kind: explainer
- logged: v0.3.0 · 2026-10-21

Exported from form.md 0.46.0 by a scratch exporter placed inside a copy of `internal/templates` (the package keeps rows unexported): 28 templates, 84 sheets, 2,451 rows. Kept columns: title, text, number, select, status, multi-select, date, checkbox, email, url, phone, place, relation. Dates given as day offsets resolve against 2026-10-21. Formula columns are left out of the rows and kept per sheet under `formulas` for Phase 2.

### routers/commands.py
- refers-to: app/routers/commands.py
- kind: todo
- logged: v0.3.0 · 2026-10-21

The window PUTs its command catalogue at start and GET lists it; running a command needs the agent bridge (Phase 10).

## v0.4.0 entries

### services/store.py · sheet views in the file
- refers-to: app/services/store.py :: Book.views, fit_views, _write, _load, sheet_op
- kind: explainer
- logged: v0.4.0 · 2026-10-21

Each sheet in `workbook.json` is now `{name, view, cells}`. The view holds what the window needs to show the sheet as it was left: row and column sizes, hidden rows and columns, frozen rows and columns, zoom and the tab colour. Files from v0.3.0 have no `view` and load with an empty one. `fit_views` keeps the list the same length as the sheets after any add, delete or move, and `sheet_op` moves a sheet's view with the sheet. A PATCH of a view merges into what is stored, so the window can send only the part it changed.

### services/store.py · shift
- refers-to: app/services/store.py :: Store.shift, routers/workbooks.py :: ShiftIn
- kind: rationale
- logged: v0.4.0 · 2026-10-21

Inserting or deleting rows or columns is sent as the operation (`POST /shift` with sheet, rows, at, n, insert), not as the thousands of cell edits it causes, and the engine process runs the same Rust shift as the window. The window chains the shift after any pending cell save, so the two never arrive in the wrong order.

### Threads
- refers-to: app/services/store.py :: Book.lock
- kind: warning-context
- logged: v0.4.0 · 2026-10-21

FastAPI runs these `def` routes on a thread pool, so one workbook is reached from several threads. Every call goes through `Book.lock`. Before v0.4.0 the Rust class refused cross-thread use and, with `panic = "abort"`, took the process down on the first request that landed on a new thread (see engine HASHOUT_LOG, #py). Checked after the fix: eight threads reading one workbook all answered.

## Table of contents

- [app/main.py](#main)
- [app/config.py](#config)

---

## app/main.py {#main}

### engine_info probe
- refers-to: app/main.py :: engine_info
- kind: explainer
- logged: v0.1.0 · 2026-10-21

Health writes "1,234.5" into XFD1048576, the last cell of the grid, and reads it back as 1234.5. That proves the Python build loaded, accepts the full grid and parses input, in one call. The window compares this engine version with its own wasm build.

### Optional import
- refers-to: app/main.py :: import formcel_engine
- kind: rationale
- logged: v0.1.0 · 2026-10-21

The process still starts when the Rust module is missing, so health can say so (`ok: false`) and the window can tell the person to rerun the installer, instead of the server failing to boot.

---

## app/config.py {#config}

### Local only
- refers-to: app/config.py :: HOST
- kind: rationale
- logged: v0.1.0 · 2026-10-21

Defaults to 127.0.0.1. A deployment that needs another address sets FORMCEL_HOST; the local default never listens on the network.
