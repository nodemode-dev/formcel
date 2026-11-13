# HASHOUT_LOG · frontend · formcel

Living log of comment content and rationale for the window. Source stays comment-free; it lives here.

Current build version: v0.43.0
Last updated: 2026-11-13 · v0.43.0: browser demo pages, the inline mark in the title bar and About, Home's side panel scrolls only its middle, a failed create says so (section below). Before: 2026-11-13 · the family release pass of v0.42.0 (Home, terminal dock and Claude Code, demos, no sparkle icon; section below). Before: 2026-11-13 · the engine bridge fixes of v0.41.1. Before: 2026-11-12 · the v0.41.0 review fixes (section below). Before: 2026-10-31 · no frontend change in 0.40.7 (version string only). Before: 2026-10-24 · Home credit reads by nodemode.ai (text only, `ui/home.ts` brand span); full fonts for the Reserved Font Name families

---

## Open items closed · v0.43.0 (2026-11-13)

### The demos as browser pages
- refers-to: frontend/vite.demo.config.ts (inlineWorkers, tsWorker, wasmFromPage, sharedEngine, quietFonts, sharedBundle, demoPage, classicScript, escapeSymbols); demo/src/shim/api.ts (route, create, QuietSocket, QuietSource); demo/src/shim/workers.ts (withWasm, sharedWorker, sharedScript); demo/src/session.ts (openSession); scripts/demo-record.py; demo/, demos/whatif, demos/lab
- kind: decision
- logged: v0.43.0 · 2026-11-13

Each page is the real window and its WebAssembly engine, opened from `file://`. The in-app demos get their workbook from the engine service (`POST /api/workbooks {template}`, then the workbook and its objects), so `scripts/demo-record.py` records exactly those three answers per demo into `demo/assets/workbooks.js` with an in-process client, and the shim replays them with a fresh id; a rerun writes identical bytes. Every other `/api` call answers 503 with the needs-the-engine message, so the title bar reads Not saved and the status bar Engine offline. Editing and recalculation are real: they run in the page's own engine. `file://` cannot fetch `.wasm`, so `workers.ts` hands the engine worker its bytes from `engine.js`; the TypeScript worker loads on first use through a queueing bootstrap worker. The bundle is byte-identical for the three modes, so everything large lives once in `demo/assets` and the whatif and lab builds write only `index.html`, failing if their bundle would differ. Fonts are woff2 only; the five full variable fonts are left out and fall back to a system font. The hide rule is `opacity: 0`, not `visibility: hidden`: a hidden grid cannot take focus and the session waits for `grid.focus()`. The build needs `frontend/public/engine/formcel.wasm` or `FORMCEL_DEMO_WASM`. About 16.6 MB committed. Seen in the page and not chased: after PivotTable Refresh the pivot values lost their currency format; not checked against the real app.

### The inline mark in the title bar and both About views
- refers-to: src/ui/shell.ts (mountShell); src/styles/titlebar.css (.fc-brand .fc-mark); src/ui/backstage.ts (buildAccount About block); src/ui/shell-mount.ts (aboutDialog)
- kind: hashed-out
- logged: v0.43.0 · 2026-11-13

All three draw `brandMark(size)` from `ui/brand.ts` (20, 32 and 72 px), written in the same step as their surroundings, so there is no image load. Removed from the title bar: `<img class="fc-brand-logo" src="/icons/logo-64.png" width="20" height="20" alt="" draggable="false">` and the rule `.fc-brand-logo { display: block; flex: none; width: 20px; height: 20px; }`. Removed from the backstage: `ic3.insertAdjacentHTML('afterbegin', '<img src="/icons/logo-64.png" width="32" height="32" alt="" draggable="false">');`. Removed from the About dialog: `const logo = el('img', 'fc-about-logo') as HTMLImageElement; logo.src = '/icons/logo-128.png'; logo.width = logo.height = 72; logo.alt = '';`. The icon files stay for the desktop shell and the README.

### Home's side panel scrolls only its middle
- refers-to: src/ui/home.ts (Home constructor markup, Home.sidePanel more()); src/styles/home.css (.fc-home-nav, .fc-home-nav-scroll, [data-more])
- kind: decision
- logged: v0.43.0 · 2026-11-13

The panel already ended at the terminal dock's top (grid rows), but its contents need 636 px and with the dock open the panel is shorter, and every scrollbar is hidden app-wide, so the foot and the Agents group looked cut off. Now the pages, Create and Agents are wrapped once at build time in `.fc-home-nav-scroll`, the only scrolling part; `.fc-home-nav` went from `overflow-y: auto` to `overflow: hidden`, so the brand and the foot stay in view. `more()` sets `data-more` (below, above, both, or absent) from a passive scroll listener and a ResizeObserver, and that switches a 28 px `mask-image` fade at the edge with hidden content. When everything fits the attribute is absent and nothing looks different. The region has a -4px -10px margin with matching padding so focus rings are not clipped. This was the orchestrator's choice among pin, tighter spacing or a thin scrollbar; none is in the references.

### A workbook that cannot be created says so
- refers-to: src/ui/home.ts (Home.make, onClick blank and use, templateCard); src/app.ts (Backstage create hook)
- kind: fix
- logged: v0.43.0 · 2026-11-13

New workbook, Use this template and the template preview called `hooks.create` and dropped its promise, and the backstage hook did the same, so a refusal from the engine showed nothing and logged an uncaught rejection. `make()` catches and shows the message in Home's status line; the backstage hook shows it in the save status. `openDemo` already had its own catch.

## Family release pass · v0.42.0 (2026-11-13)

Home, the terminal dock with Claude Code, demos and the sparkle ban, brought to the family standard of formvis and formdeck. Ported code names its source; the commit of the same subject has the detail.

### No sparkle icon
- ui/icons.ts :: `agent` replaces `assistant` on both Assistant ribbon buttons (ui/ribbon-tabs.ts). Removed: `assistant: svg('<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z"/><path d="M18.5 4v3M17 5.5h3"/>'),`
- ui/icons-ribbon.ts :: `analyze` is a bar chart with a rising arrow (removed star: `<path d="M17.500 4l1 2.500 2.500 1-2.500 1-1 2.500-1-2.500-2.500-1 2.500-1z"/>`) and `autoOutline` a small bolt (removed: `<path d="M19 3.500l.6 1.500 1.500.6-1.500.6L19 7.700l-.6-1.500-1.500-.6 1.500-.6z" ${F}/>`).
- The three-star sparkle is banned in every family app; this pass also removed the one-star and two-star glyphs so nothing reads as a sparkle. CI's scripts job has a "No sparkle icon" step (formvis's `SPARKLE_BANNED` pattern, plus the three removed paths). Agents, Claude Code and assistants use `agent`, `agentChat` and `terminal` (ui/icons.ts, the formvis glyphs); `send` is the paper plane.

### Home
- ui/home.ts :: `Home.sidePanel` is formdeck 0.26.1's: a 6 px resizer (180 to 420 px, collapses below 120), two chevron tabs to hide and show, state in `formcel.homeNav` and `formcel.homeNavHidden`, applied in the constructor before `revealApp`. In the narrow layout the resizer and tabs hide and the tab row takes over.
- ui/brand.ts :: `brandMark` is an inline SVG of the formcel mark; the brand block reads "formcel by nodemode.ai". Removed: the PNG `<img class="fc-home-logo" src="/icons/logo-64.png" ...>FormCel` and the rule `.fc-home-logo { flex: none; width: 24px; height: 24px; align-self: center; }`.
- The Agents group (Claude Code, Chat, Terminal) runs `claude-code`, `claude-chat` and `terminal-toggle` through `runCommand`, looked up at click time.
- styles/home.css maps the family tokens formcel lacks: surface-0 to bg-secondary, line-0 to border-color, line-2 to border-light.

### Demos
- demos/index.ts :: `DEMOS`, `registerDemoCommands`; ui/home.ts :: `Home.openDemo` (one at a time, `aria-busy` on the card). Three cards in Home > Start, Help > Demos (ui/menudefs.ts) and the commands `demo-sales`, `demo-whatif`, `demo-lab`. Covers are inline SVG drawn in token colours inside a 16:9 box reserved by CSS; no image files.
- Opening is `POST /api/workbooks {template: "demo-<id>"}`, so each is a new workbook. app.ts :: the `create` hook returns its promise so Home can wait.

### Terminal dock, Claude Code tabs, Chat
- ui/terminal-dock.ts :: `TerminalDock` and ui/chat-pane.ts :: `ChatPane` are formvis's, with formcel's classes (`fc-tool`, `fc-btn`, `fc-input`, `fc-note`), `rb-dom` helpers and tokens; ui/dock-api.ts holds the API methods and `socketTo`; ui/dock-mount.ts :: `mountDock` registers `terminal-toggle` (Mod+J, because Backquote is a number-format key here), `terminal-new`, `claude-code`, `claude-chat` and wires three title bar buttons (ui/shell.ts) that light with `aria-pressed`. Window menu entries in ui/menudefs.ts.
- styles/terminal.css puts the dock in grid row 3 of `#app`; index.html reserves the row before first paint from `formcel.terminal` (`data-ft-dock`, `data-ft-dock-h`, `--ft-dock-size`). Token mapping: fs-11/12/13 to text-xs/sm/md, line-2 to border-light, surface-raised and bg-input to bg-tertiary, accent-line to accent-color-dim, accent-ink to accent-color, danger to bad, radius-xs to radius-sm.
- Dependencies: `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0 (MIT, NOTICE row). Claude Code is the person's own install and is not bundled.

### Window bridge and consent
- automation/bridge.ts :: `connectBridge`, `run` answer the engine's `/api/live` socket (formtxt's message format: `{t:'run', id, command, params}` answered by `{t:'result', id, ok, result|error}`), mirror the catalogue on each connect and refuse unknown, disabled and window-only commands (`WINDOW_ONLY`, which must stay in step with backend routers/commands.py). automation/actor.ts :: `asAgent`, `agentActing`.
- ui/agents-allow.ts :: `agentsPanel`, `askConsent`; ui/settings.ts Trust Center gains "Outside agents". The bridge answers the engine's `__consent__` run with `{allowed}`; the dialog names the client and starts on Don't Allow.

### Checked and open
- Run end to end in headless Chrome against the engine: bridge, dock, shell echo, reload adoption, title bar lights, chat status, consent, each demo. Not run: a signed-in Claude Code session, the desktop shell, Windows, the light theme of the dock, dragging the resizer by hand.
- Open: with the dock open at 900 px window height the Home panel's bottom item is cut off (the panel should scroll); the title bar still shows the PNG and "FormCel" (`brandMark(20)` is ready for it); a demo opened from Help > Demos while a workbook is open reports a failure only in Home's subtitle; three array formulas fail in the engine and the demos avoid them (TRIM over an array, INDEX with a SEQUENCE index, IFERROR over an array).

## The engine bridge · v0.41.1 (2026-11-13)

- engine/worker.ts :: `load`, `dead`, `ready`, `self.onmessage` · every exported wasm function is wrapped; when a call into wasm throws, that instance is marked dead, the module is loaded again, the per-book state is cleared and the request answers "The engine stopped on an internal error and restarted. Open the workbook again to go on." After a trap the engine's book table stays borrowed and its stack pointer is not restored, so every later call failed until the page reloaded. The check is not by error class: a stack overflow inside wasm surfaces as a RangeError. Removed: `const ready: Promise<Exports> = WebAssembly.instantiateStreaming(...).then((r) => r.instance.exports as unknown as Exports);`
- engine/worker.ts :: `Exports.fc_workbook_drop`, `run` 'workbook.drop'; engine/protocol.ts; engine/index.ts :: `EngineClient.dropWorkbook`; app.ts :: `openWorkbook`, `showHome` · the previous workbook is dropped from wasm memory once the grid reads the new one, and on going Home. In a scratch run of twelve opens memory stayed at 20 MB instead of growing to 144 MB.
- engine/index.ts :: `EngineClient` · `onerror` and `onmessageerror` reject and clear every pending call.
- Checked with the real worker code in node against the built wasm; not run in a browser. Open: the window does not reopen the workbook by itself after an engine restart; edits not saved before the restart are lost and the message says to open it again.

## Review fixes · v0.41.0 (2026-11-12)

Each line names the file and symbol, then what changed and why. The commit of the same subject carries the full reasoning and what was run. None of these was run in a browser unless the line says so.

### Grid and app

- grid/grid.ts :: `setActive`, pointerdown · the edited cell is captured before the first await and the commit is queued ahead of the click's select; with a validation rule, a table or a non en-US formula the typed value landed in the clicked cell.
- grid/grid.ts :: `selectionTSV` · clamps to the used extent; Ctrl+A then Ctrl+C looped over the whole grid.
- grid/grid.ts :: `fillDownToData` · fills to the end of the neighbour's block only; an empty cell below made it fill to the last row.
- grid/grid.ts :: `copied`, `pasteWith`, `pasteLayers`, `copiedSource` · the copy records its workbook, and paste special from another workbook is refused instead of reading this one.
- grid/grid.ts :: `remember`, `pasteSpecial`, `moveSelection` · a cut is remembered, pastes with offset 0,0 and is cleared after one paste, so references are kept as in a move.
- grid/grid.ts :: `fill` · the two lines that reset `ar`/`ac` after a fill are removed; they shrank the selection back to the source for fills up and left.
- grid/grid.ts :: `wants`, `gridKey` · AltGr (ctrl and alt together) and Option characters count as typing.
- grid/grid.ts :: `resize` · re-arms a one-shot `matchMedia` resolution listener so a move to a screen of another pixel density re-sizes the canvas.
- app.ts :: `moveSheet`, `deleteSheet` · splice `pages` with the sheets and clear `grouped`.
- app.ts :: formula bar focus · takes the in-cell editor's text, so Enter there no longer writes the old value back.
- app.ts :: tab rename · duplicate names are compared without case and exclude the sheet itself.

### Panels

- ui/whatif.ts :: `pick`, `mergeForm` · option text is escaped and the merge list starts empty and is filled through `textContent`; a sheet name with markup ran script.
- ui/datatools.ts :: Replace · keeps its position across the rescan.
- ui/backstage.ts :: Info versions list · the stale empty-state text node is removed before patching.
- ui/collab.ts :: `password` · Escape resolves the promise.
- ui/collab.ts :: restore · reloads only when the restore succeeded.
- ui/review.ts, ui/backstage.ts :: share and publish controls · a refused change is reported and the state reloaded.
- ui/collab.ts :: `paintThreads` · cards are reconciled by thread id, so a remote event no longer replaces the reply box being typed in (law two).
- ui/datamodel.ts :: `drawLines` · relationship paths are kept per relationship and only their `d` is set while dragging (law two).

### Charts, scripts and VBA

- charts/svg.ts :: `color`, charts/shapes.ts :: `shapeSvg`, charts/layer.ts · series and shape colours must be hex and the three message strings are escaped before `innerHTML`.
- charts/svg.ts :: waterfall · totals are categories named total, net, sum or end as whole words, not any text containing them.
- charts/svg.ts :: `nice` · returns two ticks when the step no longer changes the value (values near 1e16).
- charts/svg.ts :: error bars · the point index is passed for line, area, scatter and bubble charts, so amounts from a column draw.
- automation/officeApi.ts :: `Range.copyFrom` · buffers the source before writing, so an overlapping copy or move keeps the source values.
- automation/index.ts :: `custom`, `customSoon` · script custom functions check `macroAllowed('function')` like VBA functions.
- automation/scripts.ts :: `ScriptRunner.call` · the `feed` listener is removed with `on`.
- vbalang/interp.ts :: `pulse`, `execDo`, `execFor` · every loop iteration checks the deadline and abort and yields; an empty loop body skipped all three.
- vbalang/interp.ts :: `\` and `Mod` · operands round half to even (`bankers`), as `CLng` does.
- vbalang/interp.ts :: `resume` · Resume and Resume Next after an error inside a loop continue inside that loop.
- vbalang/excel.ts :: `XRange.setValue` · an array fills only the target range and a single row or column repeats.
- vbalang/builtins.ts :: `InStrRev` · returns 0 when the match would end after start or start is past the text.
- backend/app/services/vba_runner.mjs · rebuilt from the vbalang sources with `npm run build:vba` in the same commits.

### Open, recorded and not changed in 0.41.0

- grid/grid.ts :: `writeClipboard` · a copy of a range outside the cached window writes the clipboard after a worker round trip, which WebKit may refuse outside the gesture.
- engine/worker.ts, engine/index.ts · a wasm trap leaves the module unusable until reload; workbooks are never dropped from wasm memory; the worker has no error handler.

---

## The window smoke (F7) · v0.40.5 (2026-10-26)

- refers-to: tests/window/test_window.py
- kind: test

`test_window.py` serves the built window (`frontend/dist`, via `FORMCEL_WINDOW_DIR`) from the engine on a free port with an empty data folder and home, opens `/` and `/splash.html` (the second HTML document, the desktop splash) in Chromium at 4x CPU slowdown and a slow network, and fails on a missing title, any request refused by the guard (403), any failed request or 4xx/5xx answer, any console or page error, or layout shift above 0 after load, network idle and a 3 s settle. Measured shift on both pages: 0. `IGNORED_REQUESTS` is empty. The build needs `engine/build_wasm` first, because the window fetches `/engine/formcel.wasm` from `public/engine` (git-ignored) and the engine process needs the formcel_engine module. Proven on a scratch copy: a late moved fixed element (shift 0.0082), a console error, a fetch of a missing route (404) and a guard refusing same-origin fetches (403 on the window's own requests) each fail it.

## Full fonts for the Reserved Font Name families · v0.39.6 (2026-10-23)

- refers-to: src/grid/fonts.ts :: loaders for Lora, Merriweather, Playfair Display, Raleway, Source Sans 3; src/grid/full-fonts/*.css; public/fonts/full/*
- kind: rationale
- logged: v0.39.6 · 2026-10-23

The family bundle audit found that the Fontsource packages of five families are subsets of fonts whose OFL declares a Reserved Font Name. A subset is a Modified Version under the OFL and may not keep the reserved name. The owner chose to ship the full fonts: the upstream variable TTFs from google/fonts (commit e7db6ca603fd4862010383ff17ffd6cc4ffac1c0) sit unmodified under `public/fonts/full/<dir>` with their OFL.txt, and each sheet in `src/grid/full-fonts` declares the normal and italic faces with the file's weight range. Vite prefixes the base path onto the absolute `/fonts/full/...` URLs. The five `@fontsource` packages were uninstalled; the other 23 families still come from Fontsource.

## Orange in place of Excel's greens · v0.39.2 (2026-10-23)

- refers-to: src/styles/tokens.css :: --cell-head-on, --cell-head-on-fg, --cell-head-full, --cell-select, --cell-select-edge; src/styles/backstage.css :: .fc-backstage --bs-rail, --bs-green and the light override; src/ui/a11y.ts :: PROFILES.light; src/ui/backstage.ts and src/ui/settings.ts :: the Theme options
- kind: rationale
- logged: v0.39.2 · 2026-10-23

The owner's trademark plan (trade dress, accent choice T4 a) removes Excel's brand greens. Dark: selected header #3b2414 on #fdba74, full header #c2410c with white text, selection rgba(249, 115, 22, 0.16) with a #f97316 edge, File view rail #7c2d12 and accent #f97316. Light profile and File view: accent #ea580c, hover and rail #c2410c, selected header #fed7aa on #7c2d12, selection rgba(234, 88, 12, 0.1) with an #ea580c edge. `--bs-green` keeps its name so no selector changed. The theme option "Light, like Excel" is now "Light". Removed values, for the record: dark #23382d, #6fd3a3, #107c41, rgba(33, 163, 102, 0.16), #21a366, #0e5c31; light #107c41, #107c4126, #0b6a37, #cae9d8, #0e5c31, rgba(16, 124, 65, 0.1). Do not bring back a green or a "like Excel" theme.

## The family's 28 themes · v0.39.0 (2026-10-22)

- refers-to: index.html boot script :: LIGHT, PROFILES; src/ui/family-themes.ts; src/ui/a11y.ts :: rebaseTheme; src/ui/settings.ts :: general
- kind: rationale

The boot table had the first 15 formvis profiles, so a family theme picked in another Form app (90s, Pro, Adwaita, Breeze, Soft and the rest) fell back to Studio here. The table now holds all 28 with the same LIGHT set, and the `formcel.options` accent is skipped on every light family theme, not only Light and Sand. `family-themes.ts` is the same table for the running window and must equal the boot one.

Preferences > General > Appearance gains Family theme. Picking one writes `nodemode_ui_settings` (theme, appearance 3, other keys kept) so every Form app opens with it. FormCel's own Theme row stays (its Light and High contrast are accessibility profiles laid over the family colours); its first option is renamed Form family theme because that is what it shows. The order on a pick matters: Theme goes back to the family one first so the light or contrast tokens are off, then the family colours are set, then `rebaseTheme` lets `applyPrefs` take its base from the new colours instead of the old ones.

## Form family icon rule · v0.39.0 (2026-10-22)

- refers-to: ../assets/formcel_icon_macos.png; public/favicon.svg, public/favicon.ico, public/icons/*, public/splash.html, public/sw.js; ../src-tauri/icons/*
- kind: rationale

`assets/formcel_icon_macos.png` (1024 px: an 824 px tile with a 100 px margin and shadow) is the one master. The macOS set (icon.icns, icon.png, 128 px and up, the web app icons) is the master as given. Every icon shown small or inside the page (64 px and below, the Square and Store logos, both .ico files, favicon.svg, the `icons/logo-*.png` used by the title bar, Home, About and the splash) is the tile, cropped at 100 to 923 and clipped to the rounded square, so it is not a shrunken tile with an empty margin. The opaque apple-touch icon and the maskable icon put the tile on #100f14 (the maskable one at 80 percent, inside its safe zone). The splash shows `icons/logo-256.png` like the rest of the family. The service worker cache name moved to `formcel-shell-2` so installed copies pick up the new files.

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

### Cell style gallery headings (0.39.5)
- refers-to: src/ui/ribbon-host.ts :: styles gallery sections
- kind: rationale
- logged: v0.39.5 · 2026-10-23

The family IP review's originality check (C5) found the cell style gallery's five section headings were the other suite's exact headings. They are now FormCel's own (Status, Inputs and results, Headings and totals, Accent colours, Number styles) and the styles inside are in FormCel's order. The style names themselves (Good, Bad, Neutral, Input, Heading 1, Accent 1, Comma and the rest) stay: they are the built-in cell style names of the .xlsx format, which a workbook must use for its styles to open as built-ins elsewhere. The templates (native, the five galleries and the form.md set) were checked and are FormCel's own descriptive names.

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
### Data tools menu, find panel, slicers and grouped sheets
- refers-to: src/ui/datatools.ts :: DataTools, src/app.ts :: dataMenu, mirror, hideSheet, src/grid/grid.ts :: runTool, paintCheck, suggest
- kind: explainer
- logged: v0.34.0 · 2026-10-21

The toolbar's Data tools button lists every data tool; each is also a command, so the palette finds them. `DataTools` builds each dialog once from a field list the first time it is opened and fills it before showing it; a tool that has something to report (rows removed, cells replaced) leaves its dialog open on that line and turns OK into Close. Engine work goes through `Grid.runTool`, which sends one `tool` request to the worker, applies the returned effect like any other (several shifts for a subtotal, then the cells) and refreshes undo. Ctrl+E is Flash Fill, Ctrl+F opens Find and Ctrl+H Find and replace; the panel has match case, entire cell, look in values or formulas, within sheet or workbook, a Find all list that jumps to a hit, Replace for the selected hit and Replace all as one undo step. Checkbox cells are the cells of a `checkbox` validation: the grid draws a box, a click on the box or Space toggles TRUE and FALSE. AutoComplete asks the engine for a completion after each typed character in a text cell and selects the added tail; Enter keeps it, Backspace or more typing drops it; the Data tools menu switches it off (kept in this browser). Filter views and slicers live in the sheet's saved view (`fviews`, `slicers`): a view is a filter text without its hidden rows, a slicer is a floating panel for one filter column whose buttons rewrite that column's value list through the sheet filter. Hidden sheets are `hidden` in the view and the tab is hidden; the tab menu hides and unhides, and one visible sheet always remains. Ctrl-click or Shift-click on tabs groups sheets; while grouped, each change made on the active sheet is written again to the same cells of the other grouped sheets as part of the same undo step (the displayed text is replayed, so a number shown rounded is replayed as shown). Undo and redo are not mirrored. A zoom slider sits beside the zoom buttons.

## v0.35.0 entries

### Calculation options, spill outline and error checking
- refers-to: src/ui/calc.ts, ui/errcheck.ts, ui/links.ts, engine/calc.ts, engine/worker.ts :: calc.run, rcBooks; grid/grid.ts :: calcDraw, setDecor, arrayHook
- kind: explainer
- logged: v0.35.0 · 2026-10-21

Calc owns the settings, the options dialog, F9 keys, the Calculate and Circular References cells in the sheet bar, Ctrl+Shift+Enter arrays, the spill outline and forwarding state-changing commands to the engine process. The worker keeps the set of R1C1 books and converts formulas in its shared cell parsers and typed input, so no other module knows the style. The grid's calculation overlay is `calcDraw` (set through setDecor), separate from `decor`, the cell decoration hook objects use. The error smart tag is one button repositioned on paint.

### Anchored objects, sparklines, pictures in cells, timeline, screen reader grid
- refers-to: src/charts/anchor.ts, layer.ts :: commit, shifted; charts/decor.ts, sparkgroup.ts, dialogs.ts; ui/timeline.ts, ui/srgrid.ts
- kind: explainer
- logged: v0.35.0 · 2026-10-21

ObjectLayer.commit is the single write path: anchor every object, send the anchors to the engine for undo, persist, notify the decor. shifted() reloads from the engine after a shift, undo or redo. Sparkline groups and pictures in cells are objects too, painted by Decor in the cell loop. The screen reader grid keeps an 80 by 30 window of ARIA nodes and patches text and aria-selected in place. The timeline rebuilds only its axis ticks on zoom; cards move by transform.

### Charts
- refers-to: src/charts/svg.ts :: renderChartAsync; chartfx.ts, map.ts, world.ts, pivotchart.ts, data.ts :: recommendRanked, resolveRange; editor.ts
- kind: explainer
- logged: v0.35.0 · 2026-10-21

renderChartAsync primes number formats from the engine (one call per chart) and then draws. Trendline fits, equation and R squared, and error bar amounts are in chartfx.ts. world.ts is generated from Natural Earth 1:110m (public domain), equirectangular. Pivot charts read the pivot's output through pivotChartData and draw a filter bar of selects. resolveRange is the one place that turns a typed range or a defined name into a sheet and range; the editor reads from the stored spec so fields it does not show survive.

### Names, functions and autocomplete
- refers-to: src/ui/names.ts, functions.ts, namedfn.ts, autocomplete.ts :: ENUMS, structuredMatches, KIND_LABEL; ui/audit.ts
- kind: explainer
- logged: v0.35.0 · 2026-10-21

The Name Manager, Insert Function and Function Arguments dialogs, and Named functions (LAMBDA names with argument placeholders and import from another workbook) sync through PUT names/tool. Autocomplete lists functions, names, LAMBDA names as functions, tables and structured items through the table hints, and enumerated argument values; the current argument in the tip is bold and opens the function help. The formula bar is a textarea so it can expand (Ctrl+Shift+U) and be dragged taller; the fx button opens Insert Function.

### Entry tools
- refers-to: src/ui/numberformat.ts, ui/datatools.ts (goto, series, rowheight, colwidth, stdwidth, movecopy, docprops); grid/axis.ts; grid/grid.ts :: ghost, peers, pasteLayers, autofitSelection
- kind: explainer
- logged: v0.35.0 · 2026-10-21

Dialogs use the DataTools Spec framework. Flash Fill ghosts are drawn italic at half opacity and accepted with Enter. Grouped sheets get formatting, insert and delete through grid.peers as one undo step.

### Data tools
- refers-to: src/ui/datatools.ts, filterx.ts, sortlists.ts; grid/tables.ts :: builtin; app.ts :: makeDesignForm
- kind: explainer
- logged: v0.35.0 · 2026-10-21

The 60 built-in table styles are built from theme slots (an approximation of Excel's tints) and custom styles drawn directly. Temporary filter views are a per-window map; while a sheet is in one, the filter and view are not saved. Personal views use localStorage keyed by workbook and sheet; shared view links carry the filter in `?view=`.

### Sharing, inbox, people and offline queue
- refers-to: src/ui/review.ts :: PeoplePane, NoticesPane, SharePane; ui/offline.ts; ui/action.ts; ui/collab.ts
- kind: explainer
- logged: v0.35.0 · 2026-10-21

Lists are patched by key; share cards rebuild only when their record changes, so a typed embed range survives refreshes. Network failures (TypeError or 5xx) queue saves in IndexedDB and replay in order; 4xx errors are shown, not queued. action.ts labels the next save (sorts) for the change history.

### Automation, assistant and app install
- refers-to: src/automation/tabData.ts, tabAssistant.ts, scriptCheck.ts, picture.ts, pwa.ts; public/manifest.webmanifest, public/sw.js
- kind: explainer
- logged: v0.35.0 · 2026-10-21

The assistant reaches charts and pivots only through the fc-ai-chart and fc-ai-pivot window events. Scripts with @customfunction are saved with compiled JS for the engine process. The service worker caches the shell only and never /api. PWA icons were drawn for the purpose.

### Analysis panels
- refers-to: src/ui/pivot.ts, ui/whatif.ts :: TOOLS, tableText
- kind: explainer
- logged: v0.35.0 · 2026-10-21

Value chips carry base field and item selects; the ToolPak dialogs come from one TOOLS table of fields and engine argument slots; the formula bar shows `{=TABLE(...)}` inside a data table.

## v0.36.0 entries

### Shapes, buttons, pivot chart bar, org, map, timeline
- refers-to: src/charts/shapes.ts, shapeui.ts, types.ts :: ShapeSpec, layer.ts :: fillShape; pivotbar.ts, orgedit.ts, regionmap.ts, regions.ts, annotated.ts
- kind: explainer
- logged: v0.36.0 · 2026-10-22

Shapes are a ShapeSpec drawn by shapes.ts as preset geometry scaled to the box; the gallery and Format shape dialog are in shapeui.ts. A button is a ShapeSpec with `button` set (roundRect), so it uses the same drawing, format and export path; scripts run on click from any object. The pivot field bar is patched in place and its height reserved so the plot does not jump. Org edits go through the engine inside one undo group. The map picks country or region level from the data; the geometry is data in regions.ts. The annotated timeline is used only for dated numeric data or the annotated mode.

### Scripts: ExcelScript runtime, TypeScript checking, Python editor, triggers
- refers-to: src/automation/officeApi.ts, officeTypes.ts, scriptWorker.ts, scripts.ts, tsWorker.ts, tsAssist.ts, customMeta.ts, tabServer.ts, pyCell.ts, recorder.ts
- kind: explainer
- logged: v0.36.0 · 2026-10-22

officeApi.ts is the worker-side ExcelScript runtime; it keeps a snapshot model and emits ops that scripts.ts applies through the grid and the engine. The recorder writes scripts against that API: Range.autoFill and Worksheet.getAutoFilter emit fill and filter ops, charts are recorded as addChart with a range and getTitle().setText. TypeScript 5 runs lazily in its own worker for checking and completions (TypeScript 7 has no JS API). The Triggers tab and the Python cell editor are their own modules.

### Names, functions and the editor's blur
- refers-to: src/grid/grid.ts (editor blur), src/ui/autocomplete.ts, ui/functions.ts, ui/names.ts, ui/calc.ts
- kind: explainer
- logged: v0.36.0 · 2026-10-22

The cell editor ignores blur while a modal is open and the modal returns focus when it closes, so Insert Function, Function Arguments and Paste Name work on a half-typed formula. Named function tips match names case-insensitively. Ctrl+Alt+F9 refetches web data.

### Chips, timeline view, paste data, spelling, table styles
- refers-to: src/ui/smartchips.ts, chippicker.ts, ui/timeline.ts, ui/pastedata.ts, ui/spell.ts, grid/tablestyledata.ts, grid/tables.ts
- kind: explainer
- logged: v0.36.0 · 2026-10-22

Chips are drawn as pills inside the cell text and committed with the text as one undo step; the @ picker inserts them. Timeline cards drag and resize to rewrite dates through the engine, and the view is saved. Built-in table styles are compact data with exact tints from the theme; text colour comes only from the style so dark mode keeps the foreground token; borders now draw on sheets with only tables.

### Queries, pictures and fixes from verification
- refers-to: src/automation/tabData.ts, tableFit.ts, picture.ts; charts/layer.ts; engine/worker.ts; ui/calc.ts :: syncArrays; app.ts
- kind: explainer
- logged: v0.36.0 · 2026-10-22

The query editor keeps a history stack for undo and redo and asks the engine process for the text view. After a load, the table lines before and after are compared and synced to the engine process. Ctrl+Z works with an object selected; the objects effect line is no longer read as a format change; undoing an array delete saves the array formula; Ctrl+Shift+U toggles the formula bar; the accessibility checker waits for pending object saves.

### Round three: recorder replay, maps, structured references, host cells
- refers-to: src/automation/officeApi.ts (shiftcells op, setPosition), recorder.ts, scripts.ts; src/charts/regions_more.ts, regionmap.ts; src/automation/hostCalls.ts
- kind: explainer
- logged: v0.36.0 · 2026-10-22

Partial-range Insert and Delete Cells from scripts go through the engine's shiftcells tool so formulas, formats and merges move; charts added by a script are stored before later sheet operations, and recorded charts keep their place through setPosition. Regions of 230 more countries are a lazy chunk (regions_more.ts) loaded only when a map needs them; tiny regions keep real outlines. Host cells are resolved again after custom function names register, so cached errors from before a reload go away. Selecting table cells while typing a formula writes structured references (point mode).

## v0.37.0 entries

### Window chrome: title row, menus, status bar, File view, Home
- refers-to: src/ui/desktop.ts, titlebar.ts, shell.ts, menubar.ts, menudefs.ts, native-menu.ts, shellcmds.ts, statusbar.ts, jobs.ts, jobs-list.ts, shell-mount.ts, sheetchrome.ts, backstage.ts, home.ts, home-files.ts, thumb.ts
- kind: explainer
- logged: v0.37.0 · 2026-10-22

The page calls Tauri through window.__TAURI_INTERNALS__.invoke for the title and reveal; only the native menu imports @tauri-apps/api, dynamically, so the web build never loads it at start. App.ready resolves after the first route and the Home list fetch, so the window is revealed with Home painted. --bar-h is 38 px. The menu bar sits in the title row's left group; menus are data (menudefs.ts) and an item whose command is not registered shows disabled, never hidden. Commands have optional enabled() and checked(), read when a menu opens; the native menu refreshes them 150 ms after pointer, key and focus events. The bottom is Excel's order: one .fc-bottom with the sheet bar (tab arrows, tabs, add, splitter, horizontal scroll) above the status bar, which holds the only zoom slider. Status bar stats read the selection's values after an 80 ms debounce and drop stale runs. Page Layout view reuses the Page Break Preview overlay; there is no margins canvas yet. The File view (backstage.ts) is a host interface in app.ts (current, settle, openWorkbook, create, importFile, page, setPage, closed) under --z-scrim so its modals open above it. Only the File view registers file.open (Ctrl+O opens its Open page, as in Excel); a second registration from the shell threw at start and was removed in the merge. Rows and columns default to 20 and 64 px; the theme body face Inter is drawn as Aptos Narrow at 11 pt until the engine theme default changes, and the ribbon font box shows that face. Show Home at launch (View menu) and Preferences, Startup are the same prefs.startScreen.

### Ribbon, Quick Access Toolbar, key tips
- refers-to: src/ui/ribbon.ts, ribbon-tabs.ts, ribbon-host.ts, ribbon-mount.ts, rb-dom.ts, rb-menu.ts, rb-state.ts, rb-icons.ts, icons-ribbon.ts, qat.ts, key-tips.ts, ribbon-customize.ts, responsive.ts
- kind: explainer
- logged: v0.37.0 · 2026-10-22

Ported from formdeck 0.27.1 with fd- renamed rb- and tokens mapped. Items are cmd, act, split, menu or slot; a menu button may carry cmdId so it still answers to data-cmd. The ribbon runs commands itself (the old toolbar click handler is gone, so nothing runs twice). ribbonButton(cmd) returns a button-like facade so older app.ts code that asked the toolbar for a button keeps one path; anchorRect(cmd) anchors popups to the visible ribbon button. Space is reserved with --rb-h and --rb-qat-h so collapsing or simplifying never moves the grid. The after-command hook refocuses the grid unless focus is inside #overlay-root, a ribbon menu or a modal; before the merge fix it stole focus from overlay popups such as the shape gallery, whose Escape then never fired. Preferences, Customize Ribbon and Quick Access Toolbar read live summaries through setLayoutSummary. Ribbon icons live in icons-ribbon.ts and are spread into icons.ts.

### Preferences and Trust Center
- refers-to: src/ui/settings.ts, prefs.ts, entry.ts, dialog.ts, controls.ts, settings-engine.ts, apply.ts; src/vba/trust.ts
- kind: explainer
- logged: v0.37.0 · 2026-10-22

Prefs live in formcel.options with a change event; index.html's pre-paint script reads accent, density, reduced motion and the formula and status bar switches from it so the first frame is right. Macro security has one home: prefs.macroPolicy (disable, notify, signed, enable). vba/trust.ts maps it to the editor's four levels and keeps only the trusted documents list; signed blocks everything because signatures are not verified yet.

### VBA: editor and runtime
- refers-to: src/vba/*, src/vbalang/*, src/automation/index.ts, styles/vba.css
- kind: explainer
- logged: v0.37.0 · 2026-10-22

vba/runtime.ts returns the language runtime registered by automation through vbalang/bridge, else a stub that explains macros can be edited but not run. The runtime runs on the main thread with periodic yields so its ops go through the same undo path as ExcelScript; WorksheetFunction and Evaluate call the engine's eval tool, so no rule lives in the window. Empty is undefined, Nothing null, Null a sentinel. UDF range arguments become virtual hidden sheets. The editor is a transparent textarea over a highlighted layer patched per line; Locals, Watches and Properties rebuild their small tables only when their content key changes. Form controls live in the workbook's automation settings and are not written into .xlsm drawing parts. Alt+F11 is captured at document level; some systems still claim it. Names shown to the user say FormCel, not Excel.

### Data Model, CUBE, data types
- refers-to: src/ui/datamodel.ts, styles/datamodel.css; src/datatypes/*, grid/typemarks.ts, styles/datatypes.css
- kind: explainer
- logged: v0.37.0 · 2026-10-22

The Data Model window talks to the engine through one command channel (model.run, model.lines, model.load). Data type cells carry a record id (not the record) and typemarks.ts draws the icon pad in the cell; the card, Insert Data and refresh fetch the record from the engine's record store by that id; the card, selector and Insert Data are DOM patched in place. Refresh all data also refreshes data types. Provider errors come back as #N/A with a note through the refusal banner.

## v0.38.0 entries

### Fonts
- refers-to: src/grid/fonts.ts, src/ui/fontpicker.ts, grid/grid.ts (faceOf, usedFonts, fontsArrived), ui/ribbon-host.ts, ui/settings.ts, charts/shapeui.ts, charts/svg.ts and layer.ts (setChartFont)
- kind: explainer
- logged: v0.38.0 · 2026-10-22

fonts.ts is formdeck's module: 28 @fontsource families loaded on demand (ensureFont), and the computer's families from the Tauri system_fonts command, else window.queryLocalFonts, else GET /api/fonts. The picker groups Theme, Recently used, Bundled, This computer and In this workbook (names cells use that are not installed, italic, kept in the file); a typed unknown name is applied anyway, as in Excel. The grid asks for each face it draws; when faces arrive it repaints once in a batch and refits auto-height rows, so a face never flickers in. Until a bundled face is cached the first frame uses the fallback. Charts draw in the workbook's body font. There is no Format Cells font tab or theme font editor yet, so the picker is on the ribbon, Preferences and shapes.

### Template gallery
- refers-to: src/ui/tplgallery.ts, styles/tplgallery.css, ui/home.ts, ui/backstage.ts
- kind: explainer
- logged: v0.38.0 · 2026-10-22

A card whose template lists visuals fetches /api/templates/{id}/thumb when it scrolls into view, gets chart specs and each range's raw matrix, and builds series with charts/data.ts, so the series rule lives in one place. The card's height is fixed and the chart fades in. Timelines, org charts, scatter and bubble charts read poorly at card size, so the card shows the first other chart; the preview (click) shows up to four. Double-click creates.

### Chart additions made while writing templates
- refers-to: src/charts/types.ts (y2Fmt, refs, error bar kind column), charts/svg.ts
- kind: explainer
- logged: v0.38.0 · 2026-10-22

y2Fmt formats the secondary axis of a combo chart and sizes its label column. refs draws reference lines on scatter and bubble charts at a number or at a cell's value. Error bars of kind column take each point's amount from a column of the chart's range. None of these three is written to .xlsx yet (the charts are; these details are dropped). A Gantt-mode timeline whose first column is a label draws one row per task coloured by that label. Bubble domains are padded 12 percent. Columns and lines whose category labels will tilt reserve 26 px at the bottom (two builders made the same fix; one was kept at merge).

## v0.40.0 entries

### Linked data types resolve through the record store
- refers-to: src/datatypes/index.ts, model.ts, src/grid/typemarks.ts, grid/grid.ts (linkedOf, pasteSpecial, applyEffect), engine/index.ts (recordOf, putRecords, loadRecords, takeRecords), app.ts (sendRecords, openWorkbook)
- kind: decision
- logged: v0.40.0 · 2026-10-23

TypedMark holds the record id, and resolved means the id is not empty. Converting a cell and choosing a match still pass the fetched record text in the chip line once; the engine takes it into the store and the cell keeps the id, so no cell holds a record. Refresh calls putRecords with the id read from the cell, one undo step through grouped. applyEffect drains the engine's record changes and app.ts posts them to the engine process in order with the chip changes. Copy collects a portable chip line (record text included) per linked cell in the range, and pasting all, formulas, or formulas and formats sets it on the destination, which takes the record into that workbook's store; the line exists only in the in-memory copy buffer, not on the system clipboard, so a paste from another window brings the cell's text only. Opening a workbook loads its records before its sheets.
