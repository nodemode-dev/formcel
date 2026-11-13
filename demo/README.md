# FormCel demo: A year of bike sales

An offline demo of the FormCel spreadsheet that runs in a browser with no engine process, no desktop shell, no network and no CDN. There are three pages; the other two are `demos/whatif` (Loan and savings what-if) and `demos/lab` (Lab measurements), and each page links to the others from the status bar.

## Open it

- Double-click `demo/index.html` (it works from `file://`), or
- serve the repository with any static server, for example `python3 -m http.server 8000`, and open `/demo/`.

Every script, style and font is local to the repository. The large files are stored once, in `demo/assets`, and the two pages under `demos/` load them from there with relative paths, so keep the three folders together.

## What it shows

The page is the real FormCel window, not a look-alike: `frontend/index.html` and the application's own entry (`frontend/src/main.ts`, then `app.ts` and every module under `ui/`, `grid/`, `charts/`, `engine/` and `automation/`) are bundled as they are, with the window's calculation engine (the Rust `formcel-core` built for WebAssembly, the same build the app runs in its worker). When the window is ready the page clicks the A year of bike sales card on Home > Demos, the path the app uses, while `html[data-demo]` keeps the window hidden, then shows it once, complete.

"Harbour Bikes: a year of sales" has four sheets: a Dashboard of formulas with KPI tiles, a month by region table with a colour scale, data bars, icon sets and sparklines, a combo chart, stacked columns and a doughnut; Orders, 1,200 invented orders in a table; Pivot, a PivotTable by region and month; and Products. Edit an order on the Orders sheet (try a larger number of Units) and the Dashboard, its charts and sparklines recalculate in the page; the PivotTable follows when you refresh it from PivotTable Analyze > Refresh. Home lists the workbook under Recent, and its Demos cards open the other two demos here as well.

## What is live and what is recorded

- Live in the page: the whole window, editing, formulas and recalculation, formats, charts, sparklines, PivotTable refresh and the other work the window's own engine does, and type checking in the script editor.
- Recorded: when a demo opens, the window asks the engine process to create the workbook from its demo template and then reads the workbook and its floating objects. The page replays those three answers, captured from the real engine by `scripts/demo-record.py` into `demo/assets/workbooks.js`; the page only fills in a fresh id and the time.
- Needs the engine: everything else under `/api` (saving, the library, templates, import and export, print preview, the engine side of scripts and data types, sharing, agents and the terminal) answers with the app's own message that it needs the FormCel engine process. After an edit the title bar reads "Not saved" and its tooltip says why, and the status bar reads "Engine offline", as the app does without its engine. Nothing is kept after a reload.

## How the page works

- `src/shim/api.ts` stands in for the engine process: it replays the recorded answers, lists the workbooks opened in the page, answers the rest with the needs-the-engine message, and closes sockets and event streams to the engine quietly.
- `src/shim/workers.ts` hands the window engine its WebAssembly bytes (`assets/engine.js`, because `file://` cannot fetch a `.wasm` file) and starts the TypeScript worker from `assets/ts-worker.js`, loaded only when the script editor first needs it. The engine and script workers are inlined as Blob workers, because Chrome refuses module workers from `file://`.
- `src/session.ts` opens the demo through its Home card and reveals the window once; `src/links.ts` adds the Demos links to the status bar.
- Fonts are the app's bundled Fontsource families as woff2 files. The five variable families the app serves from `frontend/public/fonts/full` (Lora, Merriweather, Playfair Display, Raleway, Source Sans 3) are not in the page; text set in them uses a system font.

## Rebuild

The built files are committed. After changing the app, `demo/src` or the demo workbooks:

```sh
python -B scripts/demo-record.py     # with the engine's Python, only when the demo workbooks change
engine/build_wasm                    # or set FORMCEL_DEMO_WASM to a built formcel_wasm.wasm
cd frontend
npm ci
npm run demo
```

`npm run demo` runs `vite build --config vite.demo.config.ts` three times, with `--mode sales`, `whatif` and `lab`, writing `demo/`, `demos/whatif/` and `demos/lab/`. The three pages share `demo/src` and one bundle; the mode only chooses the demo and the folder. Only the sales build writes `demo/assets` (the bundle, its styles, fonts, `engine.js` and `ts-worker.js`); the other two builds write only their `index.html` and stop if their bundle would differ from the one in `demo/assets`, so build `sales` first (`npm run demo` does). `npx tsc --noEmit -p ../demo` type-checks the page code.

## Files

| File | Size | What it is |
| --- | --- | --- |
| `index.html` | 8.9 KB | the window's page with the demo's start bar |
| `assets/demo.js` | 2.7 MB | the window, one classic script, shared by the three pages |
| `assets/demo.css` | 0.2 MB | the window's styles, shared |
| `assets/engine.js` | 6.1 MB | the window engine's WebAssembly, base64, shared |
| `assets/ts-worker.js` | 4.1 MB | the script editor's TypeScript worker, shared, loaded on first use |
| `assets/workbooks.js` | 0.6 MB | the recorded engine answers for the three demos, shared |
| `assets/*.woff2` | 2.9 MB | 218 font files, shared |

The three pages together are about 16.6 MB.

Credits are in `CREDITS.md`.
