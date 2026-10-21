# HASHOUT_LOG · frontend · formcel

Living log of comment content and rationale for the window. Source stays comment-free; it lives here.

Current build version: v0.2.0
Last updated: 2026-10-21 · canvas grid

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
    ├── grid/axis.ts            row heights and column widths with fast offsets
    ├── grid/a1.ts              column names, A1 text, Name Box parsing
    ├── grid/grid.ts            the canvas grid: paint, selection, keys, editing, clipboard, freeze
    ├── ui/commands.ts          command catalogue
    ├── ui/icons.ts             inline currentColor SVG icons
    ├── ui/shell.ts             top bar, toolbar, Name Box, formula bar, grid host, sheet tab
    └── styles/                 tokens, z-layers, base, shell, grid
```

## Table of contents

- [index.html](#index)
- [src/engine/worker.ts](#worker)
- [src/ui/shell.ts](#shell)
- [src/grid/grid.ts](#grid)
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

## src/grid/grid.ts {#grid}

### One canvas, clipped panes
- refers-to: src/grid/grid.ts :: paintNow, paintCells, paintSelection, paintHeaders
- kind: rationale
- logged: v0.2.0 · 2026-10-21

DEV_PLAN said one canvas per pane; the build uses one canvas and paints up to four clipped regions (frozen rows, frozen columns, both, the scrolled body). Same result, one backing store, one resize. Nothing in the DOM changes while scrolling; the only DOM writes are the editor's position and visibility, the Name Box and formula bar values, and the undo and redo buttons' disabled state.

### Viewport cache
- refers-to: src/grid/grid.ts :: ensureData
- kind: explainer
- logged: v0.2.0 · 2026-10-21

The grid keeps the text of a window two screens taller and one screen wider than what is visible, and asks the engine for a new window only when the visible area leaves it. A stale reply (the window moved again) is dropped. Edits patch the cache from the engine's change list.

### Ordered keys
- refers-to: src/grid/grid.ts :: enqueue, gridKey, editorKey, wants
- kind: rationale
- logged: v0.2.0 · 2026-10-21

Committing a cell waits for the engine, so a key pressed right after Enter used to run before the commit and land on the old cell (seen in a fast scripted walkthrough: Ctrl+Up and Tab acted from the wrong cell). Every grid key now joins one promise queue; `wants` decides synchronously which keys to take so preventDefault still happens in the event. A printable key that arrives while the editor is already open is appended to it.

### Number and boolean alignment
- refers-to: src/grid/grid.ts :: NUMERIC, paintCells
- kind: todo
- logged: v0.2.0 · 2026-10-21

Alignment is guessed from the display text (numbers right, TRUE and FALSE centred, text left). Phase 2 sends the value type with each cell and this guess goes.

### Not yet
- refers-to: src/grid/grid.ts
- kind: todo
- logged: v0.2.0 · 2026-10-21

Text overflow into empty neighbours, wrapped display and row autofit (Phase 3); the fill handle, insert and delete shifting cells, several sheets (later in Phase 1); a Go To dialog; touch input.

---

## package.json {#package}

### vite 8.3.4
- refers-to: package.json :: devDependencies.vite
- kind: warning-context
- logged: v0.1.0 · 2026-10-21

8.3.0 (the family pin) pulls a launch-editor with three advisories, one rated high; 8.3.4 clears them and `npm audit` reports 0. formdeck still pins 8.3.0.
