# Changelog

## 0.3.0 · 2026-10-21

- Home screen after formdeck: Start (greeting, Blank workbook, the four most recent workbooks, eight templates), Recent, Templates with category chips and search, and Trash with restore and a two-click delete. Every card shows a thumbnail of its first sheet.
- Workbooks save to `~/FormCel/Workbooks` as `.fcel` files (a zip holding `workbook.json`) as you type, through the Python build of the engine; the top bar shows Saving, Saved or Not saved. The workbook name is editable in the top bar.
- Several sheets per workbook: tabs to switch, a button to add one; undo across sheets returns to the sheet it changed.
- 34 templates: six spreadsheets made for FormCel (monthly budget, invoice, a 360-payment loan schedule, weekly schedule, task tracker, gradebook) and form.md's 14 Data and charts and 14 Example projects templates with their rows (84 sheets, 2,451 rows), exported from form.md 0.46.0.
- Engine: load without an undo step, add and rename sheets, list sheet names, read every cell of a sheet.
- `/api/workbooks`, `/api/trash`, `/api/templates` and `/api/commands` (the window publishes its 10 commands).

## 0.2.0 · 2026-10-21

- Engine: a chunked cell store (32 by 32 blocks), undo and redo of up to 500 steps, batched edits as one step, viewport reads, the used range, and Ctrl+arrow data-edge jumps with Excel's rules, in the WebAssembly and Python builds alike.
- Window: a canvas grid over the full 1,048,576 by 16,384 sheet with row and column headers, cell, range, row, column and whole-sheet selection, keyboard navigation, typing and F2 editing with Alt+Enter line breaks, the Name Box, a formula bar, undo and redo, clear, copy, cut and paste of tab-separated text, column and row resizing with column autofit, and freeze panes. Keys are handled in order, so fast typing never lands in the wrong cell.
- Scrolling 1,000,000 filled rows holds a 16.7 ms p95 frame at 4x CPU throttling.

## 0.1.0 · 2026-10-21

- Scaffold (DEV_PLAN Phase 0): Rust engine core with a WebAssembly build for the window and a Python build for the engine process; FastAPI engine process on 127.0.0.1:8199 with health and version routes; TypeScript and Vite window on localhost:5199 with the family theme boot, the engine in a Web Worker and an engine status check; install and boot scripts for macOS, Linux and Windows.
