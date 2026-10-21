# Changelog

## 0.8.0 · 2026-10-21

- Faster recalculation: the engine keeps its dependency graph between edits. Changing one value in a sheet of 100,000 formulas recalculates in 2.5 to 7 ms in the window (it took about 45 ms before). A single 100,000-step chain still takes about 300 ms.
- Functions with criteria: SUMIF, SUMIFS, COUNTIF, COUNTIFS, AVERAGEIF, AVERAGEIFS, with `<`, `>`, `<=`, `>=`, `<>`, `=`, the wildcards `*` and `?` and `~` to escape them.
- Lookups: VLOOKUP, HLOOKUP, INDEX, MATCH, XLOOKUP (with if-not-found, match mode and search mode) and XMATCH.
- IFS, SWITCH and CHOOSE. 55 functions in all.

## 0.7.0 · 2026-10-21

- Formulas (Phase 2, first slice): type `=` to enter a formula. References to cells, ranges, whole columns and rows, other sheets (`Sheet2!A1`, `'My sheet'!A1:B4`), `$` anchors, the operators `+ - * / ^ & = <> < > <= >= %`, and 40 functions: IF, IFERROR, IFNA, SUM, PRODUCT, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTBLANK, AND, OR, XOR, NOT, TRUE, FALSE, ABS, INT, SQRT, POWER, MOD, PI, ROUND, ROUNDUP, ROUNDDOWN, LEN, UPPER, LOWER, TRIM, LEFT, RIGHT, MID, CONCAT, CONCATENATE, ISBLANK, ISNUMBER, ISTEXT, ISERROR, NA.
- Dependent cells recalculate after every edit, undo and redo; circular references show `#REF!`; errors show as `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#N/A`, `#NUM!`, `#ERROR!`.
- Inserting and deleting rows and columns adjusts references on every sheet (deleted ones become `#REF!`, and undo restores them); renaming a sheet updates references to it.
- The fill handle copies formulas with their relative references moved.
- The formula bar and the cell editor show the formula; the cell shows its result. Numbers display to 15 significant digits.
- Workbooks save formulas as typed and recalculate on open.
- Tracker: five more Phase 2 cells checked against vendor pages (R1C1 in Sheets, recalculation mode, autocomplete in both, named ranges in Sheets).

## 0.6.0 · 2026-10-21

- Split panes: the toolbar's split button divides the sheet above and left of the active cell into two or four panes. Panes scroll on their own (side-by-side panes share their rows, stacked panes share their columns), the wheel scrolls the pane under the pointer, and keys move in the pane last clicked. Drag a split bar to move it, double-click it or press the button again to remove the split. Split and freeze turn each other off. The split is saved with the sheet.
- Each pane, and each frozen band, keeps its own window of cells, so panes far apart on a large sheet show their data without reloading each other's.
- Fixed: after jumping to a far cell (Name Box, Go To, Ctrl+End) the formula bar could stay empty until you moved again; it now fills in when the cells arrive.
- Phase 1 is complete: its exit check (a workbook from Home, 10,000 typed values, the last cell XFD1048576, row 1 frozen, reopened from Recent with everything there; 1,000,000 filled rows scrolling at a 16.7 ms p95 frame with the CPU slowed 4x) passes.

## 0.5.0 · 2026-10-21

- The form family app icon (the owner's artwork): a dark glass sheet with spectrum-gradient cells and a selected cell with its fill handle, as the window's icon.
- Outline groups: group and ungroup rows or columns (Alt+Shift+Right and Left, or the header menu), up to 7 levels. A gutter shows each group's bracket with a button to collapse or expand it, and numbered buttons show one level at a time. Groups move with inserted and deleted rows and are saved with the sheet.
- Fixed: clicking soon after typing could put the typed values in the clicked cells, because clicks did not wait for keys still being processed.
- Fixed: an undo that switched to another sheet reset that sheet's column widths, hidden rows and columns, frozen panes and zoom.
- Fixed: shift-clicking a row header scrolled the sheet out to column XFD.

## 0.4.0 · 2026-10-21

- Insert and delete rows and columns (Ctrl+Plus, Ctrl+Minus, or the header menu); cells, sizes and hidden marks move with them, and each is one undo step in the window and the engine process alike.
- Hide and unhide rows and columns (Ctrl+9, Ctrl+0, Shift to unhide); arrow keys skip hidden ones.
- Fill handle: drag to fill down or across, double-click to fill down to the end of the neighbouring data. Copies single numbers, continues number and date steps, weekday, month and quarter names, and text ending in a number.
- Zoom from 50% to 200% in the bottom bar or with Ctrl+wheel.
- Go To: F5 and Ctrl+G put the cursor in the Name Box.
- Sheet tabs: double-click to rename; a menu to rename, move left or right, pick a colour and delete (with a second click to confirm).
- Right-click menus on cells, row headers and column headers.
- Each sheet's sizes, hidden rows and columns, frozen panes, zoom and tab colour are saved in the `.fcel` file and restored on open.
- Fixed: the engine process could stop answering after its first request on a second thread (the Rust module refused cross-thread use and aborted the process).

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
