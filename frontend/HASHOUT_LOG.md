# HASHOUT_LOG · frontend · formcel

Living log of comment content and rationale for the window. Source stays comment-free; it lives here.

Current build version: v0.15.0
Last updated: 2026-10-21 · autocomplete under fast typing

---

## Autocomplete under fast typing · v0.15.0 (2026-10-21)

- refers-to: src/grid/grid.ts :: editorHook, startEdit, gridKey; src/ui/autocomplete.ts :: take, key; src/app.ts
- kind: fix

Keys typed before the cell editor has focus go through the grid's key queue (the typing-race fix from v0.5.0). That path appends them to the editor itself, which fires no `input` event, so autocomplete never saw them, and a queued Tab committed the cell instead of inserting. Found by a window check that typed `=TEXTS` straight after two arrow keys.

The grid now dispatches `input` on the editor wherever it writes the editor's text: `startEdit`, the queued editing keys, and typing into an open editor. It also offers each queued editing key to `editorHook` first. The app points that at the cell editor's `Autocomplete.take`, the same handling the field's own capture listener uses. Verified by typing straight after arrow keys (`shapewin.py`), plus the autocomplete, throttle, typing-race, FILTER, names and slice-three checks.

## Formula autocomplete and argument help · v0.14.0 (2026-10-21)

- refers-to: src/ui/autocomplete.ts :: scan, Autocomplete, FUNCTIONS; src/styles/autocomplete.css; src/app.ts (two instances, cell editor and formula bar); src/grid/grid.ts :: editor (now readonly public); vite.config.ts :: server.fs.allow; tsconfig.json :: resolveJsonModule; ../docs/functions.json
- kind: explainer

Both the cell editor and the formula bar get an `Autocomplete`. The rules come from Microsoft's "Use Formula AutoComplete" page:
- After `=`, the word being typed before the caret lists matching built-in functions and workbook names, alphabetically, with the first one selected. This works anywhere in a formula, and text after the caret is left alone.
- Up and Down, Home and End, and Page Up and Page Down move the selection. Tab or a double-click inserts the item and puts the caret after it, adding `(` after a function name. Escape closes the list; a second Escape cancels the edit as before. Alt+Down turns the list on or off.
- Enter is not taken over, so it still commits the formula.

Google's "Add formulas & functions" page describes a help box with the function's syntax while editing. That is the argument tip, shown when no list is open: the innermost open call's signature, with the current argument in the accent colour, and the function's one-line summary.

`scan` reads only the text before the caret and skips strings and quoted sheet names, so nothing is offered inside `"..."`. A word right after `$`, `!`, `:` or a digit is part of a reference and offers nothing.

The key listener is a capture listener on the field. At the target, capture listeners run before the grid's and the formula bar's own handlers, and it stops the event only for the keys it uses while its list is open.

Both popups are `position: fixed` in `#overlay-root` at `--z-popover`, placed with a transform before they are unhidden. Their heights are fixed in CSS (26 px rows, at most 8 visible; the tip is 52 px), so no measuring is needed and they never move the page. Rows and signature parts come from pools that only grow and are patched by `textContent`. At 4x CPU throttle with slow network: no layout shifts while typing, moving and inserting, and 7 elements created after the first list (the tip's span pool, once). A first run showed small shifts as the summary column moved with each name's width; the name column is now a fixed 12ch.

The function list is `docs/functions.json`, imported at build time. `server.fs.allow` adds `../docs` so the dev server may read it.

## Tab then Enter · v0.13.0 (2026-10-21)

- refers-to: src/grid/grid.ts :: tabStart, step, endEdit, editorKey, gridKey, select
- kind: explainer

Pressing Tab remembers the column where a run of Tabs began, and Enter then goes to the next row in that column instead of straight down. This holds whether or not a cell is being edited. Any other selection change (a click, an arrow key, the Name Box) clears the run, because `select` resets `tabStart`; `endEdit` keeps it across the commit, which reselects nothing. Shift+Enter and Shift+Tab move as before. This is FormCel's own rule for typing a table row by row: the only Microsoft page found for it is retired, and other write-ups are not vendor pages, so no Excel behaviour is claimed. Found while checking FILTER in the window, where rows typed with Tab drifted one column right on every line. Verified with the earlier typing-race and slice-three checks, and at 4x CPU throttle (no layout shifts).

## Names in the Name Box · v0.12.0 (2026-10-21)

- refers-to: src/app.ts :: nameBoxEnter, nameBoxResult, nameOf, refreshNames, sheetPrefix, absRange, Opened.names; src/grid/grid.ts :: patch; src/engine/protocol.ts, worker.ts, index.ts :: name.define, name.list
- kind: explainer

Enter in the Name Box tries three things in order. A cell or range jumps there. An existing name, matched without case, jumps to its range, switching sheet if it has to; a name that is not a plain range (a constant or a LAMBDA) is reported in the box's tooltip. Anything else is defined as a new workbook name for the current selection, with absolute references and the sheet written out (`=Sheet1!$A$1:$A$3`), as Microsoft's names page describes for the Name box. The engine's message for an invalid name goes in the box's tooltip, with the same red border as a bad reference. When the selection is exactly a named range, the box shows the name instead of the address.

`patch` updates only cached cells on the shown sheet whose text or formula changed, then paints once. Recalculation caused by a name does not count as an edit, so nothing is saved or put in undo for it. The window keeps its own copy of the name list and refreshes it after a sheet rename or a shift, because the engine rewrites names then. Verified at 4x CPU throttle with slow network: no layout shifts while defining, jumping and reporting an invalid name, or on reload.

## Spilled cells · v0.11.0 (2026-10-21)

- refers-to: src/grid/grid.ts :: fill; src/engine/worker.ts :: cells, changed
- kind: explainer

The engine sends a spilled cell with an empty formula field. The window keeps that empty string in `fx`, so the formula bar and the in-cell editor start empty on a spilled cell, and `queueSave` sends an empty input, so spilled values are never saved as typed values. `fill` reads `f || t` instead of `f ?? t`, so dragging the fill handle from spilled cells continues their values. Copy already uses shown values.

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

## src/app.ts {#number-formats}

### Number format menu, shortcuts and decimals
- refers-to: src/app.ts :: NUMBER_FORMATS, bumpCode, formatMenu, customFormat, sendFormats; src/grid/grid.ts :: SHORT_FORMATS, nums, setFormat, store
- kind: explainer
- logged: v0.18.0 · 2026-10-21

The shortcuts follow Microsoft's keyboard shortcuts page: Ctrl+Shift+~ General, ! Number, @ Time, # Date, $ Currency, % Percent, ^ Scientific. The page describes each format in words; the exact codes (`#,##0.00`, `h:mm AM/PM`, `d-mmm-yy`, `$#,##0.00_);($#,##0.00)`, `0%`, `0.00E+00`) and the menu's other entries are FormCel's choice. Keys match by `KeyboardEvent.code` so they work on any layout. Increase and decrease decimals read the active cell's code: General starts from the decimals shown, and a code gains or loses one place in each section, before any exponent. The custom box is built once into the overlay root and only shown and hidden; its hint line keeps its height so an error does not move the box. The grid keeps `nums`, the cells the engine flagged as numbers, and right-aligns those, so `007` under Text sits left like any text.

## src/grid/grid.ts {#cell-styles}

### Painting styles
- refers-to: src/grid/grid.ts :: paintCells, edge, fitRows, wrapLines, styles, colors, toggle, borders, TOGGLE_KEYS; src/grid/style.ts; src/app.ts :: formatBar, colorMenu, borderMenu, listMenu
- kind: explainer
- logged: v0.19.0 · 2026-10-21

`paintCells` paints in four passes: gridlines, fills (inset by a pixel so gridlines stay visible), text, borders. Text sits at the bottom of the cell unless the style says otherwise, as in Excel. Text that is not a number and does not wrap overflows into empty cells beside it (right for left-aligned, left for right-aligned, both ways when centered), up to 8 columns; the text pass starts 8 columns outside the pane so a heading whose cell is scrolled off still shows its overflow. Colour order: the style's text colour, then the number format's colour, then a dark or light colour chosen against the fill, then the theme. Black (`000000`) in a text or border colour paints as the theme's text colour, so automatic black stays readable in the dark theme; this is FormCel's choice. Font sizes are points, 10 by default (13 px). Turning on wrap, changing the size, or editing a wrapped or sized cell refits the rows it touches, up to 400 px; a row is fitted to its tallest styled cell, so a hand-set height on such a row is replaced. Ctrl+B, I, U and 5 (and Ctrl+2, 3, 4) toggle from the active cell's style, Ctrl+Shift+& draws an outline border and Ctrl+Shift+_ removes borders, from MS-KEYS. The toolbar's pressed states and font labels are written in place from `formatBar` on every active-cell change, only when they differ.

### Merges, painter, carried formats, rotation
- refers-to: src/grid/grid.ts :: merges, mergeAt, sel, select, move, activeArea, areaRect, textSpan, cellText, cellBorders, startPainter, applyPainter, formatsOf, tiled, remember, fill, paste; src/app.ts :: mergeMenu, sendMerges, ROTATIONS
- kind: explainer
- logged: v0.20.0 · 2026-10-21

A merged area paints as one cell: its inner gridlines are covered, its fill, text and borders come from the upper-left cell, and no other text overflows into it. The selection always grows to cover any merge it touches; clicking inside a merge selects it with the upper-left cell active; arrows leave a merge from its far edge. The format painter copies the selection's styles and codes (up to 100,000 cells) and tiles them over the next selection, or over a block the source's size when one cell is clicked; one click paints once, a double-click keeps it on until Escape or another click on the button; it does not copy merges yet. The fill handle and paste of a FormCel copy carry styles and codes with the values, grouped into one undo step; a paste of text copied elsewhere carries none. Rotated text anchors at the bottom left when turned up and the top left when turned down; vertical text stacks one character per line; rows refit to both.

### Cell styles, themes and paste special
- refers-to: src/app.ts :: stylesMenu, styleBox, themeMenu, pasteMenu, sendLook, colorMenu; src/grid/grid.ts :: pasteSpecial, remember, loadTheme, applyNamed, defineNamed, deleteNamed; src/grid/style.ts :: themeOf, paint, tint, Look
- kind: explainer
- logged: v0.21.0 · 2026-10-21

The grid paints the effective style the engine sends and resolves theme colour slots and tints and the `+heading` and `+body` fonts against the workbook theme; the theme's body font is the default for every cell, as GS-EDIT says of Sheets themes. The colour menus offer the theme's colours in a first row, as GS-EDIT describes. Paste special follows MS-PASTE's options: All, Formulas, Values, Formats, Formulas and number formats, Values and number formats, All except borders, Column widths and Transpose; it needs a copy made in FormCel, whose formulas, stored values, styles, codes and column widths are kept with the copy. A plain paste of a FormCel copy now pastes formulas with their relative references moved, as Excel does, instead of the shown text. Transposed formulas move by each cell's new offset; their references are not turned. Paste special's math operations and Skip blanks are not built. Two focus fixes: a toolbar command no longer takes focus back from the menu or box it opened, and Escape on the grid with nothing to cancel no longer starts an edit with the text "Escape".

### Conditional formatting in the window
- refers-to: src/grid/grid.ts :: cfs, refreshCf, loadRules, styleOf, drawIcon; src/app.ts :: cfMenu, ruleBox, openPanel, fillPanel, addRule, clearRules; src/ui/rules.ts
- kind: explainer
- logged: v0.22.0 · 2026-10-21

The grid asks the engine what rules paint in each data window it reads and again after every change on a sheet with rules, and lays the result over the cell's own style: a rule's colours replace the cell's, its bold and other flags add to them. Data bars paint under the text at a little over half opacity; icons sit at the left of the cell and push left-aligned text right. The menu follows MS-CF's Highlight Cells, Top/Bottom, Data Bars, Color Scales and Icon Sets groups. A new rule goes to the top of the list, as MS-CF says. The seven preset formats are named after Excel's quick formats but their colours are FormCel's. The Manage rules panel is built once and its rows are updated in place: text and checkboxes are written only when they differ, rows are added or removed at the end, never rebuilt. Colour scale names say which end is low and which high, since Excel's names list colours without saying which end is which.

### Links in the window
- refers-to: src/app.ts :: linkChip, linkBox, followLink, sendLinks; src/grid/grid.ts :: linked, activeLinked, linkTarget, setLink, removeLinks, activeRect, onOpenLink
- kind: explainer
- logged: v0.23.0 · 2026-10-21

Linked cells paint in the `--cell-link` colour and underlined, unless the cell has its own text colour (MS-HYPERLINK: the friendly name is shown blue and underlined). A plain click selects a linked cell; Ctrl+click (Cmd+click) opens it, and selecting one shows a small chip under the cell with the target and Open, Edit and Remove. This is FormCel's choice between Excel desktop's click-to-open and Excel for the web's pointer rule (MS-HYPERLINK remarks), so selecting never navigates by accident. The chip and the link box are built once in the overlay root and only shown, moved and hidden; the chip hides on scroll. Ctrl+K opens the link box (MS-LINKS, GS-LINKS); on a HYPERLINK cell it says to edit the formula instead, as MS-LINKS does. Web links open in a new tab without an opener; `#` links switch sheet if needed and select the cell or name.

### Dark text on the dark grid
- refers-to: src/grid/grid.ts :: cellText
- kind: explainer
- logged: v0.24.0 · 2026-10-21

Styles made for a white sheet set dark text colours, for example the headings and Title use the theme's dark 2. On the dark grid such text was unreadable. A cell with no fill whose text colour is dark (no channel above 127) on a dark grid, or light on a light grid, is painted 60 percent toward the other end; black still paints as the grid's text colour. Text on a fill keeps its colour, since the fill is what it was chosen against. The stored colour does not change.

### Open a file and Download as .xlsx
- refers-to: src/ui/home.ts :: say, importFile hook, drop handlers; src/app.ts :: importFile, downloadXlsx, openWorkbook; src/ui/shell.ts :: file.download-xlsx button
- kind: explainer
- logged: v0.25.0 · 2026-10-21

Home's Open a file button and dropping a file anywhere on Home send the file to `/api/import`. While a file is over Home the page gets a dashed outline drawn with `outline`, so nothing moves. Messages (opening, refused file types) replace the Start page's subtitle text instead of adding a line. When the workbook opens, the save indicator says how many kinds of content were left out, and its tooltip lists them. Download as .xlsx saves pending edits first, then follows a link to the export, so the browser names the file from the workbook title.

Fixed: opening a workbook never renamed the window engine's first sheet, so it stayed Sheet1 there while the engine process had the real name. A formula or name pointing at the first sheet by name (`=Data!B2`) showed #REF! in the window. Found by the .xlsx check, whose first sheet is Data.

### Opening a text file, and the Download menu
- refers-to: src/app.ts :: csvBox, csvPreview, fillCsv, makeCsvForm, importFile, downloadMenu, download
- kind: explainer
- logged: v0.26.0 · 2026-10-21

A .csv, .tsv or .txt file opens a dialog first: the separator (sniffed, and changeable), the row count and encoding, and the first 12 rows under a header row where each column can be General or Text, with the engine process's guess of what the column holds. The dialog is built once in the overlay root; its table sits in a box of fixed height, and a new separator replaces only the table's head and body, so the dialog does not move or resize. Open sends the file again with the choices; nothing is kept on the server between the two calls. Escape and Cancel close it.

The toolbar's download button opens a menu: the workbook as .xlsx, or the current sheet as .csv or .tsv. Each is also a command (`file.download-xlsx`, `file.download-csv`, `file.download-tsv`).

v0.27.0: the menu adds .ods, and .xlsm when the workbook was opened from a file with macros (`macros` in the workbook's meta). Open a file accepts .xls and .ods. The save indicator now says "Opened, with N notes on what changed", since a note can also say what was kept.

### Passwords and PDF in the window
- refers-to: src/app.ts :: passwordBox, makePasswordForm, importFile, downloadLocked, download
- kind: explainer
- logged: v0.28.0 · 2026-10-21

One password dialog, built once in the overlay root, serves both ways: opening a protected file (one field; a wrong password keeps the dialog open with the message) and Download with a password (two fields that must match). The password is sent once and the fields are cleared when the dialog closes. A locked download is fetched with POST, so the password is not in an address, and saved through an object URL. The Download menu adds This sheet as PDF and Every sheet as one PDF.

### Sort buttons and the Sort dialog
- refers-to: src/grid/grid.ts :: sortTarget, sortRange, quickSort, activeColumn; src/app.ts :: sortBox, addSortLevel, makeSortForm, sorted; src/engine :: sort, region, guessHeader
- kind: explainer
- logged: v0.30.0 · 2026-10-21

Three toolbar buttons: Sort A to Z and Sort Z to A by the active column, and Sort, which opens the dialog. With one cell selected the sort takes the data region around it and guesses the header row; with a range selected it sorts that range. The dialog lists levels (Sort by, then Then by), each a column (named from the header row when My data has headers is ticked) and A to Z or Z to A, with Add level, remove, My data has headers and Case sensitive. Ticking or clearing the header box renames the column choices in place. The dialog is built once; opening it replaces only its list of levels before it is shown. After a sort the sorted range is selected.

### Filter buttons and the filter panel
- refers-to: src/grid/axis.ts :: filtered, setFiltered, isFiltered, gone; src/grid/grid.ts :: filterInfo, setFilter, reapplyFilter, sortFilterColumn, filterButton, loadFilter, paintFilterButtons, onFilterButton; src/app.ts :: toggleFilter, filterWith, filterBox, filterSync, makeFilterForm, sendFilter, FILTER_OPS; src/engine :: filter, setFilter, loadFilter, reapplyFilter, filterValues
- kind: explainer
- logged: v0.31.0 · 2026-10-21

The rows axis keeps a second set, the rows a filter hides, beside the rows hidden by hand: both take no height and are skipped by the arrow keys, but Unhide only touches the hand-hidden set, and the view saved with the sheet holds only that one. The grid draws a small button at the right of each header cell of the filter, painted on the canvas with the cells: a down arrow, or a funnel in the accent colour when that column has a criterion. Row numbers inside a filter with criteria are drawn in the link colour, as Excel shows filtered rows.

Filter on the toolbar, or Ctrl+Shift+L (MS-KEYS), turns the filter on for the data region around the active cell (or the selection) and off again. A button, or Alt+Down on a header cell, opens the panel: Sort A to Z and Z to A (the whole filter range by that column with its header kept, then the filter reapplied, one undo step), By fill colour and By text colour when the column has more than one, By condition (one or two conditions joined by And or Or; Top and Bottom N items or percent; Above and Below average), and By values with search and Select all. OK applies a condition if one is chosen, else the ticked values; with a search typed only the ticked values shown are kept. Clear removes that column's criterion. A colour swatch applies at once. The panel is built once; opening it fills the value list and settings before it is shown under the button, and the list has a fixed height so nothing moves while it fills.

### Data validation, dropdowns and alerts
- refers-to: src/grid/grid.ts :: loadValid, loadRule, activeRule, setValidation, listItems, listArrow, paintListArrow, listButton, onListArrow, setActive, cellRect; src/app.ts :: validBox, validTab, validSync, makeValidForm, invalidBox, makeAlertForm, showPrompt, dropList, sendValid; src/engine :: validations, loadValidations, setValidation, validationAt, listItems, checkInput
- kind: explainer
- logged: v0.32.0 · 2026-10-21

Data validation on the toolbar opens a dialog with MS-VALID's three tabs: Settings (Allow, Data, the value boxes named for what was chosen, such as Start date and End date, Ignore blank, In-cell dropdown), Input message and Error alert, with Clear all, Cancel and OK. Boxes that do not apply are greyed rather than removed and every tab keeps the same height, so nothing moves while choices change. A Custom formula typed without `=` gets one.

The grid asks the engine for the rule under the active cell whenever the selection moves and the sheet has rules. A list rule with In-cell dropdown draws a small arrow just right of the active cell; the arrow or Alt+Down opens the items, and picking one enters it. An input message shows beside the cell while it is selected and hides while the list is open. Typing into a cell with a rule is checked before it is entered: with Show error alert off the value goes in; Stop offers Retry (the editor opens again with the text selected) and Cancel; Warning asks Continue? with Yes, No (back to editing) and Cancel; Information offers OK and Cancel. An alert with no title or message uses "FormCel" and "The value you entered is not allowed in this cell." Clearing cells and pasting are not checked.

### Tables
- refers-to: src/grid/tables.ts :: TABLE_STYLES, parseTable, tablePaint; src/grid/grid.ts :: tabled, tables, activeTable, loadTables, tablesMoved, createTable, setTable, removeTable, totalsCell, hasList; src/app.ts :: tableBox, makeTableForm, designBox, makeDesignForm, dropList, sendTables, TOTALS
- kind: explainer
- logged: v0.33.0 · 2026-10-21

The Table button (and Ctrl+T, which a browser may keep for itself) asks for the range, prefilled with the data around the active cell, and My table has headers. Inside a table the same button opens Table design: name, style, a resize range that keeps the top-left cell, Total row, Banded rows, Banded columns, First column, Last column, Filter button, and Convert to range. Converting keeps the table's colours by writing them as cell formatting in the same undo step (MS-TOCONVERT keeps the style).

Table styles are drawn under cell formatting: a cell's own fill, text colour and bold win. Each style takes a theme colour (Medium 2 accent 1, Medium 4 accent 3, Medium 9 accent 1 deeper bands, Medium 14 accent 6, Light 1, Light 9, Light 15, Dark 1) for a filled or plain bold header and tinted bands. These are FormCel's drawings under Excel's style names, which files carry; Excel shows its own versions. In the total row the list arrow offers None, Average, Count, Count Numbers, Max, Min, Sum, StdDev and Var, which enter `=SUBTOTAL(n,[Column])` with 101, 103, 102, 104, 105, 109, 107 and 110. After each typed entry in a sheet with tables the window reads the tables again, so growth from typing below or beside a table shows at once, with the filter range.

### Charts, pictures, shapes and text boxes over the grid
- refers-to: frontend/src/charts/ :: Charts, ObjectLayer, ChartEditor, renderChart, drawSpark
- kind: explainer
- logged: v0.34.0 · 2026-10-21

Floating objects live in a layer (`ObjectLayer`) appended to the grid element, one list per sheet, positioned in sheet pixels (x, y, w, h) and drawn at the grid's scroll and zoom through `Grid.objectFrame()`; the grid calls `objectsHook.paint` after each paint, `data` after each edit and `sheet` when a sheet is shown. Charts are inline SVG strings from `svg.ts`; the data range is read with `readValues` through the engine client, so a chart redraws when its cells change (debounced, and the node is patched only when the markup differs). Dragging a body moves, the eight handles resize, Delete removes, arrow keys nudge, double-click edits (chart editor, or text for shapes and text boxes). Objects are saved per sheet by `PUT /objects` inside the .fcel.

Data shape (FormCel's reading, MS-CHARTSTART and GS-CHARTEDIT describe the editor but not the detection): a first row of text over numbers is the header, a first column of text (or increasing date serials) is the categories, each remaining column is a series; "Series are in rows" transposes first. Recommended types come from that shape (few categories and one series suggests pie; dates suggest line; two numeric columns suggest scatter; four series suggest candlestick). Chart types: column, stacked column, bar, stacked bar, line, area, pie, doughnut, scatter, bubble, combo (secondary axis series chosen in the editor, default the last series), histogram (Sturges-style bin count), box and whisker (quartiles, 1.5 IQR whiskers, outliers), waterfall (a category named total, net, sum or end becomes a total bar), candlestick (open, high, low, close by name or order), treemap (binary split by size), sunburst (categories inside, series outside), funnel, gauge (last value against the axis maximum), scorecard (last value, change from the one before, small trend), radar, timeline (task, start, end), and org chart (name, manager). Map charts are not offered: no license-safe map data is bundled.

Sparklines: the engine function SPARKLINE returns text starting with U+E000 and "SPK"; the grid draws that cell as a line, column, bar or win-loss mini chart instead of text (GS-SPARKLINE options charttype, color, negcolor, ymin, ymax, max, min, linewidth). The cell's value is that marker text, so CSV export and copy of values carry it.

### Review, protection and sharing in the window
- refers-to: src/ui/collab.ts :: Collab; src/grid/grid.ts :: setMarks, setOthers, setMasked, paintMarks, onError, onHover, Presence; src/engine/worker.ts :: guardOf, protect; src/styles/collab.css
- kind: explainer
- logged: v0.34.0 · 2026-10-21

The toolbar gains Notes, Comment, a side panel button, Protection and Share. The side panel is one fixed aside with five panes built once: Comments (new thread box, @name buttons, assign box, each thread with replies, Resolve or Reopen, an assignee list and Delete), Changes (the engine's edit log for the active cell, selection, sheet or workbook), Versions (save, name, preview, restore), Share (publish or share a sheet, copy link, copy embed code, open, revoke) and Activity (edits by other windows, kept in this window only). A red corner marks a cell with a note and a purple corner one with an open comment thread; pointing at a noted cell shows the note beside the pointer. Another window's active cell is drawn as a coloured box with its user name.

The window asks the engine before every changing request (the worker's `guardOf`) and shows the engine's own message in a banner when it refuses, including refusals that surface as errors from any button. Your name is a setting kept in this browser (`formcel.user`, Protection menu); it is sent with each save so the engine can check protected ranges and log edits. Cell protection and Hidden formulas are set from the Protection menu; a hidden formula shows the value in the formula bar and editor while the sheet is protected. Mark as final shows a banner with Edit anyway. Offline use: the window and engine run on this computer without a network, and saves that fail while the engine is unreachable are retried on the next change but are held in the window's memory only.

### Page layout, Page Break Preview, accessibility and themes
- refers-to: src/ui/pagesetup.ts :: PageSetupDialog, layoutOf; src/ui/a11y.ts :: initPrefs, applyPrefs, Shortcuts, Checker, liveRegion; src/ui/modal.ts :: makeModal; src/grid/grid.ts :: paintBreaks, setBreakView, shownAt; src/app.ts :: pageMenu, pageSetup, pageBreak, printArea, accessMenu, setLocale; src/styles/a11y.css
- kind: explainer
- logged: v0.34.0 · 2026-10-21

Two toolbar buttons open menus: Page layout (Page Setup, Page Break Preview, insert, remove and reset breaks, set and clear print area) and Accessibility (checker, shortcuts, theme, text size, locale). The page setup lives in `App.open.pages`, saved with a view PATCH. Page Break Preview adds no new grid mode: `layoutOf` works out page boundaries from the grid's own row and column sizes, the paper, margins and scale, and the grid paints the printed area tinted with blue edges, solid for manual breaks and dashed for automatic ones, and a faint page number per page. It is an approximation of what pdf.py lays out (it ignores row growth from wrapped text), and the break lines are not draggable; breaks are set from the active cell. Dialogs made by `makeModal` have role dialog, aria-modal, a label, a Tab trap, Escape to close and focus returned to where it was. Older dialogs in app.ts were not changed. The grid announces the active cell through an aria-live status region (address, shown value, formula). Themes: the page's inline script sets the colour variables on the root, so `applyPrefs` records those values once and overrides them inline for the light and high contrast themes, restoring them for dark; choices are kept in localStorage (`formcel.prefs`) together with text size (normal, large, extra large, which scale the text tokens and toolbar size) and your own shortcuts. A shortcut you add runs its command when the focus is on the grid or the page, never in a text field or while a dialog is open. Ctrl+/ and F1 open the shortcut list. The cell editor has the browser's spell check turned on; there is no Check Spelling command and no bundled word list, because no list was fetched and checked for its licence here.
### PivotTable dialog and fields panel
- refers-to: src/ui/pivot.ts :: PivotDialog, PivotPanel, parsePivot, formatPivot, describe; src/app.ts :: pivotBox, pivotCreate, pivotShow, pivotApply, pivotSync, pivotAuto, pivotFollow, pivotRefresh; src/engine/worker.ts :: pivotOut
- kind: explainer
- logged: v0.34.0 · 2026-10-21

The PivotTable toolbar button (after Table) opens Create PivotTable (MS-PIVOTCREATE): the source prefilled with the data around the active cell as Sheet1!A1:D20, or the table name when the cell is in a table, New worksheet or Existing worksheet with a cell, and Recommended PivotTables, a short list of layouts the engine proposes from the text and number columns; clicking one creates it at once. A new worksheet starts the PivotTable in A3 (MS-PIVOTCREATE puts it on a new sheet; the row gap is FormCel's). Inside a PivotTable the same button opens the fields panel instead; Refresh PivotTable beside it refreshes the one under the active cell, or all when the cell is not in one. The commands are pivot.create, pivot.fields, pivot.refresh and pivot.refresh-all.

The PivotTable fields panel (MS-FIELDLIST) floats at the right. The top lists the source's fields and calculated fields: tick one to add it where Excel puts it by default (numbers to Values, text to Rows), untick to remove it, drag it into Filters, Columns, Rows or Values, or choose an area from its small list. Each area lists its fields with Up, Down and Remove (a drag moves a field between Rows, Columns and Filters; the same field can sit in Values several times). Each value has Summarize by (Sum, Count, Average, Max, Min, Product, Count Numbers, StdDev, StdDevp, Var, Varp), Show values as (No calculation, % of grand total, % of column total, % of row total) and a custom name. A filter has an Items list with (All); unticking items leaves them out and the cell above the table reads the chosen item or (Multiple Items). Calculated fields are a name and a formula over field names. Options: grand totals for rows and columns, subtotals, and refresh when the source data changes. Refresh and Delete are at the foot. Every change goes to the engine as one undo step and the panel follows the active cell into another PivotTable. The panel keeps its rows and patches only the changed ones.

With refresh when the source data changes on, the window waits 350 ms after an edit on the source sheet, refreshes the PivotTable and joins the refresh to that edit's undo step, so one Ctrl+Z undoes both. The panel and PivotTable commands use `tables` in the engine's effect, so no new wire tag was added; after an effect that carries it the window reads the PivotTable lines again and saves them when they changed.
### What-If menu, analysis dialogs and the Analyze Data panel
- refers-to: frontend/src/ui/whatif.ts :: WhatIf, Box; app.ts :: whatIfMenu, makeSheet, sendWhatif
- kind: explainer
- logged: v0.34.0 · 2026-10-21

One toolbar button (`data.whatif`) opens a menu of Goal Seek, Data Table, Scenario Manager, Solver, Forecast Sheet, Descriptive Statistics, Regression, Analyze Data and Recalculate data tables, each also a registered command. Every dialog is built once on first use and filled before it shows; messages go in a hint line with reserved height. All maths lives in the engine: the window only sends a `whatif.run` command and reads the reply. Reports that make a new sheet first send the request with `-` as the sheet (an engine dry run that checks everything and writes nothing), then add the sheet through the same path as the plus button, then send it again, so a refused request leaves no empty sheet. The what-if definitions (data tables, scenarios, saved solver model) are read back with the `state` request after each change, and after every history change, and pushed with `PUT /api/workbooks/{id}/whatif`; open reads them from the workbook and loads them into the engine. Data tables are recalculated 200 ms after any edit (`dt.run`), which rewrites only results that changed so it settles after one pass. The Analyze Data panel is a docked list that reuses its rows between refreshes; clicking an insight selects the cells it describes.
### Formula auditing and the Watch Window
- refers-to: src/ui/audit.ts :: Audit, parseCells; src/grid/grid.ts :: setOverlay, overlay, paintNow; src/styles/audit.css; src/app.ts :: audit commands, openWorkbook; src/engine :: trace, evalSteps
- kind: explainer
- logged: v0.34.0 · 2026-10-21

Trace precedents and Trace dependents draw arrows over the grid through one overlay hook in the grid's paint: a dot at the source, an arrowhead at the target, a box round a range source, and a dashed line to a small sheet icon when the other end is on another sheet. Clicking the same button again on the same cell asks the engine for one more level. Arrows stay while the selection moves and go when a cell changes or Remove arrows is pressed (MS-TRACEPREC, MS-TRACEDEP).

Evaluate Formula is built once in the overlay root and shows the cell reference, the formula with the part about to be evaluated underlined, and Step n of m. Evaluate moves one step, Restart goes back, Close or Escape closes. Only the text nodes change between steps (MS-EVALFORMULA).

The Watch Window is a panel the person can drag by its header and resize. Add watch takes a cell, a range or Sheet!Cell, or the active cell when the box is empty. Rows are kept and only their value and formula text nodes change after each edit. Click selects a row, Ctrl+click adds, Delete or Delete watch removes, double-click goes to the cell. The list is saved with PUT /api/workbooks/{id}/watches.
