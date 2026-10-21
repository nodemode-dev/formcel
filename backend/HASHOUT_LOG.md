# HASHOUT_LOG · backend · formcel

Living log of comment content and rationale for the engine process. Source stays comment-free; it lives here.

Current build version: v0.1.0
Last updated: 2026-10-21 · scaffold

---

## Org-navi-map

```
backend/
├── requirements.txt / requirements_macos.txt   fastapi, uvicorn, maturin
├── oc_install(.bat)        venv, requirements, then the Rust engine as formcel_engine
├── boot_backend(.bat)      uvicorn on FORMCEL_HOST:FORMCEL_PORT, default 127.0.0.1:8199
└── app/
    ├── main.py             FastAPI app, /api/health, /api/version
    ├── config.py           host, port, data folder
    └── version.py          VERSION
```

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
