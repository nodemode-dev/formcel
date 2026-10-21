# HASHOUT_LOG · frontend · formcel

Living log of comment content and rationale for the window. Source stays comment-free; it lives here.

Current build version: v0.10.0
Last updated: 2026-10-21 · formulas

---

## App icon · v0.5.0 (2026-10-21)

- refers-to: public/favicon.svg
- kind: rationale
- The outlined grid with an orange cell becomes the form family icon: the dark tile with bloom, rim and drop shadow; a dark glass sheet with a formula bar groove and a 4 x 4 grid; filled cells raised in one diagonal spectrum gradient (#3A7BFF, #9A5CFF, #FF4F7A, #FFAE2B) with gloss, a soft blurred highlight and a light inset rim, empty cells sunk into the sheet; the selected cell raised highest with a white selection frame and fill handle. favicon.svg is the vector source. There is no desktop shell yet; 1024 px full bleed and macOS-margin PNGs for one live in the owner's icon set.
- Landed from the owner's branch `feat/app-icon-redesign` (979b629, cut from v0.3.0). The bundle was read, not applied: the SVG is the owner's artwork and was copied in byte for byte (checked identical to the bundle's and to `formcel_icon_files.zip`), and this entry was retyped against the v0.4.0 log. The SVG has no scripts and no outside references. The top bar keeps the single-colour `sheet` icon from `src/ui/icons.ts`, which follows the theme accent.

## Org-navi-map

```
frontend/
├── index.html                  pre-paint theme boot (family profiles), overlay and toast roots
├── vite.config.ts              port 5199, host false, /api and /mcp proxied to 8199
├── public/favicon.svg          the app icon, 1024 by 1024 vector (owner's artwork)
├── public/engine/formcel.wasm  built by engine/build_wasm, not committed
└── src/
    ├── main.ts                 mounts the shell, checks both engines, starts App
    ├── app.ts                  routing, opening workbooks, autosave, tabs, commands
    ├── ui/home.ts              Start, Recent, Templates, Trash; keyed cards with thumbnails
    ├── version.ts              VERSION
    ├── engine/protocol.ts      request and response types for the worker
    ├── engine/worker.ts        loads the wasm engine, answers requests
    ├── engine/index.ts         EngineClient and engine()
    ├── extensions/registry.ts  register, activateAll, disposeAll
    ├── grid/axis.ts            row heights and column widths, hidden rows and columns, fast offsets
    ├── grid/a1.ts              column names, A1 text, Name Box parsing
    ├── grid/fill.ts            fillSeries: what the fill handle writes
    ├── grid/grid.ts            the canvas grid: paint, selection, keys, editing, clipboard, freeze, zoom, fill, insert, hide
    ├── ui/menu.ts              context menus in the overlay root
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
- [src/app.ts and src/ui/home.ts](#app)
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

Text overflow into empty neighbours, wrapped display and row autofit (Phase 3); touch input; saving each pane's scroll position with the view. Done in v0.5.0: grouping and outlines. Done in v0.6.0: split panes. Done in v0.4.0: the fill handle, insert and delete shifting cells, hide and unhide, zoom, Go To (F5 and Ctrl+G focus the Name Box, as Excel's Go To box does for a reference).

### Zoom
- refers-to: src/grid/grid.ts :: Grid.setZoom, local, placeEditor
- kind: explainer
- logged: v0.4.0 · 2026-10-21

The canvas keeps its CSS size; the drawing transform is `dpr * zoom` and the grid's logical width and height are the CSS size divided by zoom, so every paint and hit-test stays in unzoomed sheet units. Pointer positions are divided by zoom in `local`; the cell editor, which is a DOM node, is placed and font-scaled by zoom. Steps run from 50% to 200% (`ZOOMS`); a zoom box that takes typed values comes later. Ctrl+wheel moves one step.

### Fill handle
- refers-to: src/grid/grid.ts :: onFillHandle, fill, fillDownToData; src/grid/fill.ts
- kind: explainer
- logged: v0.4.0 · 2026-10-21

Dragging the square at the bottom right of the selection draws a dashed preview and fills on release, as one undo step. Double-clicking it fills down to the end of the data in the column to the left (the column to the right when the selection starts in A). `fillSeries` follows Excel's AutoFill: one number copies, two or more continue their step, ISO dates step by the difference (a single date by a day), weekday, month and quarter names continue in the case they were typed, text ending in a number counts on, anything else repeats.

### Insert, delete, hide
- refers-to: src/grid/grid.ts :: insert, remove, hide, applyEffect, afterShift
- kind: rationale
- logged: v0.4.0 · 2026-10-21

The engine moves the cells; the grid moves its own row and column sizes and hidden marks with `Axis.shift`, then drops its viewport cache and repaints once. Undo and redo return an effect that names any shift, so the axes move back before the cells are repainted. Hidden rows and columns have zero size, are skipped by arrow keys and by paint, and are kept in the sheet's saved view.

### axis.ts rewritten (declared)
- refers-to: src/grid/axis.ts
- kind: warning-context
- logged: v0.4.0 · 2026-10-21

axis.ts was replaced whole with the Write tool in v0.4.0 rather than edited region by region, against the repo's surgical-edit rule. The public parts (`size`, `setSize`, `offset`, `indexAt`, `count`) keep their signatures; added are the hidden set, `shift`, `state`/`restore` and `nextVisible`. Review the file as new.

### Outline groups
- refers-to: src/grid/axis.ts :: group, runs, fold, showLevel; src/grid/grid.ts :: paintOutline, outlineHit, group
- kind: explainer
- logged: v0.5.0 · 2026-10-21

Each axis keeps an outline level per row or column (1 to 7, `MAX_LEVEL`) and, per summary row, a bit for each level that is collapsed. Microsoft's outline page (MS-OUTLINE in the research kit) allows "an outline of up to eight levels"; FormCel reads that as 8 level buttons, the first showing only ungrouped rows, which leaves 7 nested groups. If Excel turns out to nest 8 groups, raise `MAX_LEVEL`. A group is a run of neighbours at a level or deeper; its button sits on the row below the run (or the column to its right), because "by default, Excel looks for summary rows below the details they summarize" (same page). Summary rows above detail are not offered yet. Collapsing hides the run through the same hidden set as Ctrl+9, so arrow keys, paint and saving need nothing new; expanding shows the run again except rows inside an inner group that is still collapsed. The level buttons show every row whose level is below the number pressed. Levels and collapsed bits move with inserted and deleted rows (`Axis.shift`) and are saved in the sheet view as `levels` and `folded`.

The gutters are a second canvas (`.fc-outline`) behind the grid canvas, which is moved right and down by the gutter sizes; all cell and header maths keep their header-relative coordinates. A gutter appears when the first group is made and goes when the last is removed, as Excel's outline symbols do; on open the grid is laid out with its gutters before the first frame (checked at 4x CPU and a slow network: one canvas position seen, layout shift 0). Grouping is a view change, like hiding, and is not on the undo stack yet.

### Formulas in the window
- refers-to: src/grid/grid.ts :: fx, ensureData, commitEdits, announce, startEdit, fill; src/engine/worker.ts :: cells, changed, offset; src/app.ts :: queueSave
- kind: explainer
- logged: v0.7.0 · 2026-10-21

Cells and changes from the engine carry an optional formula text after the value. The grid keeps it in `fx` beside the value cache: the canvas paints values, the formula bar and the cell editor show the formula, and autosave sends the formula. Filling from a formula copies it to each target cell with its relative references moved by the distance from its source cell (the engine's `offset`); a fill lane that mixes formulas and constants repeats the sources in order instead of continuing a series. Error values are centred like TRUE and FALSE. Copy and cut still put values on the clipboard; copying formulas between cells waits for the clipboard work in Phase 3.

### Dates in the window
- refers-to: src/engine/worker.ts :: localSerial, fc_set_clock; src/grid/fill.ts :: US_DATE, us; src/grid/grid.ts :: NUMERIC
- kind: explainer
- logged: v0.10.0 · 2026-10-21

The worker gives the engine the browser's local time as a serial date before every request, so TODAY and NOW match the person's clock. The engine shows dates as m/d/yyyy, so the fill handle continues m/d/yyyy series as well as ISO ones, in the style they were typed. Right alignment now also covers values shown as currency, percent, dates and times.

### Split panes
- refers-to: src/grid/grid.ts :: toggleSplit, y, x, hit, reveal, bands, splitBar
- kind: explainer
- logged: v0.6.0 · 2026-10-21

A split keeps two scroll positions per axis: `syT` and `sy` for the top and bottom panes, `sxL` and `sx` for the left and right. Panes in the same row share a vertical scroll and panes in the same column share a horizontal one. `y(r, pane)` and `x(c, pane)` take the pane, because under a split one row can be on screen twice; painting sets the pane for each band it draws, and everything else uses the active pane (the one last clicked), which is where keys move, `reveal` scrolls and the cell editor opens. The wheel scrolls the pane under the pointer.

Splitting at the active cell puts the bars above and left of it, at its current screen position, and moves no cell on screen (the bottom pane's scroll is set to the old scroll plus the split height); Microsoft's split page (MS-SPLIT in the research kit) describes the same rule: select the cell below and to the right of where the split goes, and select Split again to remove it. At A1, or with the active cell off screen, the split goes through the middle of the sheet; that case is FormCel's choice, not checked against Excel. Dragging a bar moves it; double-clicking removes it; removing keeps the top-left pane's position. Split and freeze turn each other off. The split sizes are saved in the view (`split`, `null` when off: the engine process merges a view PATCH into what it holds, so a field left out would never be cleared); the panes' scroll positions are not saved, like the unsplit scroll.

### One cache window per pane
- refers-to: src/grid/grid.ts :: ensureData, dropWindows, wins
- kind: rationale
- logged: v0.6.0 · 2026-10-21

The viewport cache read one window around the visible cells and cleared everything else on each read. With panes on rows 1 to 10 and 900,000 onwards, one window would have to cover both. There are now up to four windows, one per pane (frozen bands count as panes, which replaces the old stretch of the window up to row 1); a new read for a pane drops only the cells of that pane's old window that no other window covers. When a read lands that covers the active cell, the Name Box and formula bar are refreshed: before, a jump to a cell outside the cache showed an empty formula bar until the next move (found by the Phase 1 exit check: A5000 read blank after reopening, though the cell held 5000). Measured with 1,000,000 filled rows at 4x CPU: p95 frame 16.7 ms unsplit and split, max 33.3 and 16.8 ms.

### Pointer input joins the key queue
- refers-to: src/grid/grid.ts :: bind (pointerdown, pointermove, outline pointerdown)
- kind: warning-context
- logged: v0.5.0 · 2026-10-21

Keys are processed in order through `enqueue`, but a click selected at once. Typing ten values and clicking a row header straight after put the queued keys in the clicked rows: r8 to r10 landed in rows 4 to 6 and r4 to r6 were lost. Click, drag and outline-gutter selections now go through the same queue, so they take effect after every key pressed before them. Checked: typing then grouping with no pause keeps every value in place.

### Undo that changes sheet keeps the sheet's view
- refers-to: src/grid/grid.ts :: commitEdits, afterShift; GridEvents.onSheet
- kind: warning-context
- logged: v0.5.0 · 2026-10-21

When undo or redo touched another sheet, the grid showed that sheet with an empty view and then saved it, wiping its sizes, hidden rows and columns, frozen panes, zoom and outline (since v0.3.0). `onSheet` now returns the stored view and the grid shows the sheet with it. Checked: zoom 125% and a hidden column survive an undo that jumps back to their sheet, on screen and on disk.

### Selecting whole rows does not scroll sideways
- refers-to: src/grid/grid.ts :: extendTo, reveal
- kind: warning-context
- logged: v0.5.0 · 2026-10-21

Shift-clicking a row header extended the selection to column XFD and scrolled the sheet out to it. A selection that spans every column (or every row) now leaves that direction's scroll where it was; `reveal` takes -1 for a direction to leave alone.

### Context menus
- refers-to: src/ui/menu.ts :: Menu
- kind: explainer
- logged: v0.4.0 · 2026-10-21

One menu node lives in `#overlay-root` at the `--z-dropdown` layer token and is refilled per open, so opening never shifts layout. Arrow keys, Home, End, Enter and Escape work; a dangerous item asks for a second click instead of a dialog (the viewer of an artifact, and the family's rule, both rule out `confirm()`).

---

## src/app.ts and src/ui/home.ts {#app}

### Routing and views
- refers-to: src/app.ts :: App.route, showHome, openWorkbook
- kind: explainer
- logged: v0.3.0 · 2026-10-21

`#w-<id>` opens a workbook, anything else shows Home, so a reload reopens what was open. Home and the sheet view are both mounted once and swapped with `hidden`; the grid is one instance that `show(book, sheet)` points at another workbook or sheet.

### Autosave
- refers-to: src/app.ts :: queueSave, flush
- kind: explainer
- logged: v0.3.0 · 2026-10-21

Changes collect per sheet, keyed by cell so the last value wins, and go out 400 ms after the last edit, one POST per sheet, chained so they arrive in order. Leaving a workbook, opening another and closing the tab flush first. A failed save keeps the cells for the next try and shows "Not saved" with the reason on hover.

### Keyed cards
- refers-to: src/ui/home.ts :: patch
- kind: rationale
- logged: v0.3.0 · 2026-10-21

Lists are patched by key: cards that stay are updated in place, new ones are inserted where they belong, gone ones removed. Start reserves one row of recent cards and two rows of templates with skeletons, so nothing below moves when data arrives (measured: layout shift 0 at 4x CPU on a slow network).

### Cards built in the live document
- refers-to: src/ui/home.ts :: el
- kind: warning-context
- logged: v0.3.0 · 2026-10-21

`el` first parsed markup inside a `<template>`, whose content belongs to an inert document. Thumbnails drawn on those canvases before insertion came out blank (grid lines only, the text pass lost). Parsing in a detached `div` of the live document fixed it; every thumbnail now shows its cells.

### Not yet
- refers-to: src/app.ts
- kind: todo
- logged: v0.3.0 · 2026-10-21

Dropping a closed workbook from the window's engine memory; Open file and drop to import (Phase 4). Done in v0.4.0: renaming (double-click a tab), reordering, colouring and deleting sheets from the tab menu.

### Sheet views
- refers-to: src/app.ts :: saveView, showSheet, Opened.views
- kind: explainer
- logged: v0.4.0 · 2026-10-21

Each sheet's view (sizes, hidden, frozen, zoom, tab colour) is saved 500 ms after it last changed and restored when the sheet is shown, so a reload puts every sheet back as it was left. Checked: zoom 125%, a green tab and hidden column B on the second sheet survive a reload, and the arrow key still skips B.

---

## package.json {#package}

### vite 8.3.4
- refers-to: package.json :: devDependencies.vite
- kind: warning-context
- logged: v0.1.0 · 2026-10-21

8.3.0 (the family pin) pulls a launch-editor with three advisories, one rated high; 8.3.4 clears them and `npm audit` reports 0. formdeck still pins 8.3.0.
