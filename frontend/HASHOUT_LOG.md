# HASHOUT_LOG · frontend · formcel

Living log of comment content and rationale for the window. Source stays comment-free; it lives here.

Current build version: v0.1.0
Last updated: 2026-10-21 · scaffold

---

## Org-navi-map

```
frontend/
├── index.html                  pre-paint theme boot (family profiles), overlay and toast roots
├── vite.config.ts              port 5199, host false, /api and /mcp proxied to 8199
├── public/favicon.svg          grid mark
├── public/engine/formcel.wasm  built by engine/build_wasm, not committed
└── src/
    ├── main.ts                 mounts the shell, checks both engines
    ├── version.ts              VERSION
    ├── engine/protocol.ts      request and response types for the worker
    ├── engine/worker.ts        loads the wasm engine, answers requests
    ├── engine/index.ts         EngineClient and engine()
    ├── extensions/registry.ts  register, activateAll, disposeAll
    ├── ui/icons.ts             inline currentColor SVG icons
    ├── ui/shell.ts             top bar, empty state, status pill
    └── styles/                 tokens, z-layers, base, shell
```

## Table of contents

- [index.html](#index)
- [src/engine/worker.ts](#worker)
- [src/ui/shell.ts](#shell)
- [package.json](#package)

---

## index.html {#index}

### Theme boot
- refers-to: index.html :: inline script in head
- kind: rationale
- logged: v0.1.0 · 2026-10-21

Ported from formdeck 0.23.0. Reads the shared `nodemode_ui_settings` key so FormCel opens in whatever theme, accent and density the person chose in any family app, and writes the tokens before the first paint so there is no theme flash. FormCel also sets `data-theme` light or dark for its own light-mode tokens.

---

## src/engine/worker.ts {#worker}

### Engine off the main thread
- refers-to: src/engine/worker.ts :: whole file
- kind: rationale
- logged: v0.1.0 · 2026-10-21

The engine runs in a module worker so recalculation never blocks painting. `withStrings` copies each argument into wasm memory and frees it after the call; `out` decodes the engine's shared out buffer straight away, before another call can overwrite it.

---

## src/ui/shell.ts {#shell}

### Status pill
- refers-to: src/ui/shell.ts :: mountShell, setStatus
- kind: explainer
- logged: v0.1.0 · 2026-10-21

The pill keeps a fixed minimum width and tabular numerals, and setStatus writes only its data-state, its one text node and its title, so the change from "Engine starting" to the result never moves anything. Verified at 4x CPU and a 400 ms, 50 KB/s network: layout shift 0, background correct from the first frame.

---

## package.json {#package}

### vite 8.3.4
- refers-to: package.json :: devDependencies.vite
- kind: warning-context
- logged: v0.1.0 · 2026-10-21

8.3.0 (the family pin) pulls a launch-editor with three advisories, one rated high; 8.3.4 clears them and `npm audit` reports 0. formdeck still pins 8.3.0.
