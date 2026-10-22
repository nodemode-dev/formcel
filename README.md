<img src="assets/formcel_icon.png" alt="FormCel" width="128" height="128">

# FormCel

Spreadsheets in the form family. An open alternative to Excel and Google Sheets, built so that Claude Code, Codex or Cursor can read and edit a live workbook while you watch.

Version 0.38.0 · Apache-2.0 · macOS, Windows, Linux (browser now, Tauri desktop shell in `src-tauri`)

**Stack.** Vanilla TypeScript and Vite · Python 3.12 and FastAPI · one calculation engine in Rust, compiled to WebAssembly for the window and to a Python module for the engine process · Tauri 2 later.

## Status

0.38.0 brings every font (28 bundled and all those installed on the computer, as in formdeck) and 76 templates: 40 new finished workbooks across Finance, Sales & marketing, Operations and Personal & education, and the 14 Data & charts templates rebuilt, each with a formula dashboard and charts tied to its data, shown in a gallery that draws each template's own chart. 0.37.0 makes the window look and work like Excel in the form family: a formvis-style splash and title row, an Excel ribbon with contextual tabs, Quick Access Toolbar and key tips (from formdeck), a menu bar, a status bar, a File view like Excel's Backstage, a new Home screen and Preferences laid out like Excel's Options. It also builds the three former non-goals the owner asked for: VBA macros with a Visual Basic Editor, the Data Model with the CUBE functions, and Stocks and Currencies data types with GOOGLEFINANCE and STOCKHISTORY (438 functions). 0.36.0 closes nearly all of the rest and drives every feature in the window: pasted and PDF data, spelling, Excel's table style colours, more locales, slicers, chart sheets, print areas, pictures in cells and 100 shapes in .xlsx, filters and validation in .ods, .xls conditional formatting and charts, org chart editing, region maps, smart chips, Solver's Evolutionary engine, Power Query text and database queries, scheduled refresh, Apps Script and Office Scripts with type checking, Python cells with pandas, an extensions marketplace and a fuller REST API (see CHANGELOG.md). 0.35.0 closed most of those partial rows: every chart kind in .xlsx (including the chartex kinds), trendlines, error bars, pivot charts and a country map; PivotTables written to .xlsx as real pivot caches with every Show Values As choice and date and number grouping; Solver Sensitivity and Limits reports and the Analysis ToolPak tools; manual and iterative calculation, R1C1, Ctrl+Shift+Enter arrays, error checking, links to other workbooks and multi-threaded calculation in the engine process; Name Manager, Insert Function and named functions; Go To Special, Insert Cells, Series, Paste Special in full, number format dialog and document properties; objects anchored to cells with undo; sharing on the local network with view, comment and edit links, chat, inbox and an offline queue; and 428 functions. 0.34.0 started Phases 6 to 12 at once: charts, pictures and shapes; PivotTables, GROUPBY and PIVOTBY; what-if analysis and Solver; the rest of the data tools; notes, comments, protection and version history; scripts, a REST API and data connections; page setup, web page export and accessibility; and the function library grows to 421 (see CHANGELOG.md for what each still lacks). 0.33.0 added tables to Phase 5 (tables and data tools) in `DEV_PLAN.md`: header rows, banding, total rows, calculated columns, tables that grow as you type, and structured references such as `DeptSales[Sales Amount]` and `[@Qty]`, saved in .xlsx files, plus SUBTOTAL. 0.32.0 added data validation, FIND and SEARCH. 0.31.0 added filters by values, conditions and colour. 0.30.0 started the phase with sorting, by the active column or by several columns in the Sort dialog. 0.29.0 finished the building work of Phase 4 (exchange) with conditional formatting in .ods and ARRAYFORMULA from Sheets. Since 0.25.0: .xlsx with formatting and conditional formatting both ways, CSV, TSV and text with a preview, .ods both ways, .xls opened with its values, .xlsm macros kept for saving back, PDF export, password-protected .xlsx, and the `A1#` and `@` operators. Phase 4's exit check waits for a set of workbooks made in Excel. Comments, pictures, charts and pivot tables are not brought in from files yet; FormCel says what it left out. Phase 3 (formatting) closed at 0.24.0, Phase 2 (the formula engine) at 0.16.0; FormCel has 421 functions.

| Area | In 0.26.0 |
| --- | --- |
| Home | Start, Recent, Templates (category chips and search) and Trash, after formdeck; thumbnails of each workbook's first sheet |
| Saving | `.fcel` files in `~/FormCel/Workbooks`, saved as you type; rename in the top bar; Trash with restore |
| Excel files | Open a file or drop one on Home: .xlsx and .xlsm, with a note of anything left out; save as .xlsx from File, Save As or Export. Files keep values, formulas (newer functions with the prefixes Excel expects), number formats, fonts, fills, borders, alignment, rotation, cell styles, the theme, conditional formatting, merges, links, names, frozen panes, column widths, row heights, hidden and grouped rows and columns, zoom and tab colours |
| Other files | .ods opens and downloads (values, formulas, number formats, cell formatting, merges, links, names, sizes); .xls opens with its last saved values; .xlsm keeps its macros (not run) and downloads as .xlsm; password-protected .xlsx opens with its password and downloads with a new one; PDF of a sheet or the whole workbook |
| Text files | .csv, .tsv and .txt open with a preview: separator, encoding, and General or Text for each column (leading zeros kept); formulas in the file stay text. Download the current sheet as .csv or .tsv (UTF-8) |
| Sheets | Several per workbook, tabs to switch, a button to add one; double-click a tab to rename it; the tab menu moves, colours and deletes; each sheet keeps its sizes, hidden rows and columns, frozen panes and zoom |
| Templates | 36: six made for FormCel, 28 from form.md 0.46.0 with their data, Function conformance (Microsoft's function examples, checked live) and Formatting check (number formats, styles, rules and links, checked live) |
| Formulas | `=` formulas with cell, range, column, row and cross-sheet references, `$` anchors, arithmetic, text and comparison operators, dates and times typed in common forms, array constants such as `{1,2;3,4}`, results of several cells that spill into the cells beside them (`#SPILL!` when something is in the way), the spilled range operator (`=SUM(A1#)`) and implicit intersection (`=@A1:A10`), workbook names typed in the Name Box and used in formulas (`=SUM(Sales)`), LET for local names and LAMBDA for your own functions (`=LAMBDA(x,x*x)(4)`, or saved under a name and called as `=Square(4)`), structured references to tables (`DeptSales[Sales Amount]`, `[@Qty]`, `Table1[[#Totals],[Total]]`), 428 functions (financial, statistical, database, engineering, regular expressions, QUERY, GROUPBY, FORECAST.ETS, ARRAYFORMULA from Sheets, FIND and SEARCH, SUBTOTAL, HYPERLINK, math, date and time, aggregation, criteria such as SUMIFS and COUNTIFS, lookups such as VLOOKUP, INDEX, MATCH and XLOOKUP, arrays such as FILTER, SORT, UNIQUE, SEQUENCE, VSTACK, TAKE, DROP and WRAPROWS, LAMBDA helpers such as MAP, REDUCE and BYROW, logic, text including TEXTSPLIT, EXACT and TEXT with Excel's number format codes (`=TEXT(A1,"$#,##0.00")`, `"0.0%"`, `"# ?/?"`, `"mmmm d, yyyy"`, `"[h]:mm"`), information including ERROR.TYPE), recalculation of dependents through a kept dependency graph (one edit in a 100,000-formula sheet in a few milliseconds), `#REF!` for circular references, references kept right through insert, delete and sheet rename, and the fill handle moving relative references |
| Engine | Rust core, one build for the window (WebAssembly) and one for the engine process (Python): a chunked cell store for 1,048,576 rows by 16,384 columns, typed input (numbers, text, TRUE and FALSE), undo and redo of 500 steps, batched edits, viewport reads, the used range, Ctrl+arrow data edges, and inserting and deleting rows and columns as one undo step |
| Grid | Canvas grid with headers and selection of cells, ranges, rows, columns and the whole sheet; arrows, Ctrl+arrows, Ctrl+Home, Ctrl+End, Home, Page Up and Down; typing, F2 and Alt+Enter; Name Box and formula bar; formula autocomplete with argument tips in the cell and the formula bar; undo, redo, clear; copy, cut and paste of tab-separated text; resizing rows and columns, autofit columns; freeze top row, first column or panes at the active cell; insert, delete, hide and unhide rows and columns; the fill handle (copies, number and date steps, weekday and month names, numbered text) and double-click to fill down; zoom 50% to 200%; right-click menus on cells and headers; outline groups of rows and columns up to 7 levels, with collapse and expand buttons and level buttons; split panes at the active cell that scroll on their own, with draggable split bars |
| Data tools | Sort A to Z or Z to A by the active column, and the Sort dialog with several levels, a header row and case-sensitive order; one cell selected sorts the data around it. Filter (Ctrl+Shift+L) puts buttons on the header row: filter by values with search, by one or two conditions with And or Or and `?` `*` wildcards, top or bottom N, above or below average, or by fill or text colour; Reapply and Clear; rows a filter hides stay apart from rows hidden by hand. Data validation: whole numbers, decimals, lists, dates, times, text length or a custom formula, with limits that may be formulas; a dropdown arrow on list cells; an input message when a cell is selected; and a Stop, Warning or Information alert when a typed value is not allowed. Tables (Ctrl+T): a header row with filter buttons, eight styles with banded rows and columns, a total row with Sum, Average, Count and more, calculated columns that fill themselves, growth when you type below or beside the table, Table design (name, style, resize, options) and Convert to range |
| Links | HYPERLINK with a friendly name; web and email addresses typed into a cell become links; Insert link and Edit link (Ctrl+K) to a web page, an email address or a place in the workbook (`#Sheet2!A1`); a chip under a linked cell to open, edit or remove it; Ctrl+click opens; Remove link keeps the text |
| Formatting | Conditional formatting: greater than, less than, between, equal to, text contains, a date occurring, duplicate and unique values, top and bottom items or percent, above and below average, formula rules, data bars, two- and three-colour scales and five icon sets; a rules manager with order, Stop If True and delete; rules follow edits live and move with inserted and deleted rows. Cell styles: a gallery of 24 (Normal, Good, Bad, Neutral, Title, Heading 1 to 4, Total, Input, Output, Calculation, Note, Warning Text, Accent 1 to 6, Comma, Currency, Percent), new styles from the selection, update and delete; five themes (FormCel, Slate, Forest, Ember, Mono) whose colours and fonts styles and the default text follow, and theme colours in the colour menus; Paste Special (Ctrl+Alt+V). Merge and center, merge across, merge cells and unmerge; text rotation (angle up or down, rotate up or down, vertical); format painter (double-click to keep it on); formatting carried by the fill handle, paste and inserted rows and columns. Font (7 typefaces), size in points, bold, italic, underline, strikethrough, text colour and fill colour; borders (all, outside, inside, each edge, none) in thin, medium, thick, dashed, dotted or double lines; left, center and right, top, middle and bottom alignment, indent, wrap text; clear formats; text overflows into empty neighbouring cells; rows grow to fit wrapped and larger text; all undoable and saved. Number formats per cell: General, Number, Currency, Accounting, Percent, Scientific, Fraction, three dates, two times, Text, and custom codes typed in a box that says when a code cannot be read; increase and decrease decimals; numbers align right by value, so `007` under Text stays left; whole columns and the whole sheet format the used range |
| Speed | 1,000,000 filled rows scroll at a 16.7 ms p95 frame with the CPU slowed 4x |
| Window | Family theme profiles applied before the first frame, engine status, the engine running in a Web Worker |
| Engine process | FastAPI on 127.0.0.1:8199: `/api/health`, `/api/version`, `/api/workbooks`, `/api/trash`, `/api/templates`, `/api/commands`, `/api/import`, `/api/import/preview`, `/api/workbooks/{id}/export.xlsx`, `.xlsm`, `.ods`, `.csv` and `.tsv`; data folder `~/FormCel` |

## Keys

| Keys | Does |
| --- | --- |
| Arrows, Shift+arrows | Move, extend the selection |
| Ctrl+arrows (Cmd on a Mac) | Jump to the edge of the data |
| Ctrl+Home, Ctrl+End | A1, the last cell of the used range |
| Enter, Tab (Shift to reverse) | Commit and move; Enter after a run of Tabs goes back to the run's first column |
| Typing a formula | A list of matching functions and names: Up and Down to choose, Tab to insert, Escape to close, Alt+Down to turn it off; inside a function, a tip shows its arguments |
| F2, or start typing | Edit the cell; Alt+Enter adds a line |
| Delete | Clear the selection |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+C, Ctrl+X, Ctrl+V | Copy, cut, paste as tab-separated text |
| Double-click a column border | Autofit the column |
| Ctrl+Plus, Ctrl+Minus | Insert, delete the selected rows or columns (cells: rows) |
| Ctrl+9, Ctrl+0 (Shift to unhide) | Hide rows, hide columns |
| Ctrl+Shift+~ ! @ # $ % ^ | General, Number, Time, Date, Currency, Percent, Scientific format |
| Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+5 (or Ctrl+2, 3, 4) | Bold, italic, underline, strikethrough, on or off |
| Ctrl+Shift+&, Ctrl+Shift+_ | Outline border, remove borders |
| Ctrl+Alt+V | Paste Special |
| Ctrl+wheel | Zoom |
| F5, Ctrl+G | Go To: type a reference in the Name Box |
| Drag or double-click the fill handle | Fill the series down or across |
| Alt+Shift+Right, Alt+Shift+Left | Group, ungroup the selected rows (columns when whole columns are selected) |

## Quick start

Needs Python 3.12+, Node 20.19+ and Rust (https://rustup.rs).

```
./formcel_oc_install    # engine venv, Rust engine for Python, npm packages, Rust engine for the window
./formcel               # engine on 127.0.0.1:8199, window on http://localhost:5199
```

Windows: `formcel_oc_install.bat` then `formcel.bat`.

### Desktop app

```
./build_app             # macOS and Linux: installs what is missing, builds the window, freezes the engine, builds the app
./build_app --open      # and opens it; --clean rebuilds from nothing; --no-install keeps it out of Applications
```

On macOS this leaves `FormCel.app` in Applications and a `.dmg` beside the build; on Linux a `.deb` (`--install` installs it). Windows: `build_app.bat` makes the .msi and setup .exe. The Rust build goes to `~/Library/Caches/formcel` or `~/.cache/formcel` (set `FORMCEL_CARGO_TARGET` to move it), and every step is logged to `build_app.log`.

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
docs/       functions.json: every function FormCel computes, its arguments, and whether Excel's and Google Sheets' function lists include it
```

## Licence

Apache-2.0. See `LICENSE` and `NOTICE.md`.
