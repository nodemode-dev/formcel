# Changelog

## 0.17.0 · 2026-10-21

- Phase 2 (formula engine) is closed; Phase 3 (formatting) begins.
- Number format codes: the engine reads Excel's format codes. That covers sections for positive, negative, zero and text values, colours and conditions, digit placeholders, thousands separators and scaling, percent, scientific, fractions, dates, times and elapsed time, and quoted text.
- TEXT shows a value in any of those codes, for example `=TEXT(1234.567,"$#,##0.00")` gives $1,234.57 and `=TEXT(4.34,"# ?/?")` gives 4 1/3. 107 functions in all.
- The Function conformance template now matches Microsoft's pages in all 186 compared cases.
- Not yet: giving a cell a format code from the window. That is the next step.

## 0.16.0 · 2026-10-21

- New template, Function conformance: every example table on Microsoft's function pages for FormCel's functions. Each sheet holds the page's data, each formula, the page's result and a live TRUE/FALSE check, and a Summary sheet totals them. 181 of the 186 compared cases match. The 5 others need TEXT, and the cases not compared say why.
- New: ERROR.TYPE and EXACT (106 functions in all).
- Templates can carry workbook names, and a template whose first rows hold formulas shows computed values in its Home preview.
- Phase 2 exit check: one edit among 100,000 formulas recalculates in 3 to 10 ms in the window. A 100,000-step chain still takes 300 to 360 ms. The items still open are moved to later phases in the plan.

## 0.15.0 · 2026-10-21

- Array shaping: VSTACK and HSTACK, TOCOL and TOROW, TAKE and DROP, CHOOSECOLS and CHOOSEROWS, WRAPROWS and WRAPCOLS, and EXPAND. All spill, and gaps are padded with `#N/A` unless you give a pad value.
- TEXTSPLIT splits text into columns and rows at one or more delimiters, for example `=TEXTSPLIT(A1,",",";")`.
- 104 functions in all, and all of them are in autocomplete.
- Fixed: autocomplete missed letters typed very quickly right after moving to a cell, and Tab then committed the cell instead of inserting the function.
- The Microsoft pages for these functions show results only as pictures. All 44 of their examples were run on the pages' own data and checked against each example's description: 41 agree, and 3 contradict their own page.

## 0.14.0 · 2026-10-21

- Formula autocomplete: typing a formula lists the matching functions and workbook names, in the cell and in the formula bar. Up and Down choose, Tab inserts (with the opening bracket for a function), Escape closes the list, and Alt+Down turns it on or off.
- Argument help: inside a function, a tip shows its arguments with the current one highlighted, and what the function does.
- `docs/functions.json` lists all 92 functions with their arguments, a one-line summary, and whether Microsoft's and Google's function lists include each (all are on Microsoft's; SORTBY and XMATCH are not on Google's list as fetched).

## 0.13.0 · 2026-10-21

- FILTER, SORT, SORTBY and UNIQUE: results spill and can be nested, as in `=SORT(FILTER(A2:C99,B2:B99>3),2,-1)`. FILTER shows `#CALC!` when nothing matches, unless it is given a value for that case.
- LAMBDA helpers: MAP, REDUCE, SCAN, BYROW, BYCOL and MAKEARRAY, as in `=MAKEARRAY(3,3,LAMBDA(r,c,r*c))`.
- New: SUMSQ (92 functions in all).
- `r` and `c` now work as LET and LAMBDA parameter names (0.12.0 refused them). They are still not allowed as workbook names.
- Typing a table: after moving right with Tab, Enter goes to the next row in the column where you started.
- Conformance with Microsoft's function pages: 176 pass, and the same 5 still need TEXT. The pages for the ten new functions show their results only as pictures, so 29 cases for them were worked by hand and all pass.

## 0.12.0 · 2026-10-21

- Names: select cells, type a name in the Name Box and press Enter. Formulas can then use it (`=SUM(Sales)`), typing it in the Name Box jumps back to it, and the box shows the name whenever that range is selected. Names are saved with the workbook and follow inserted and deleted rows and renamed sheets. A name starts with a letter, underscore or backslash, has no spaces, and is not a cell address; the Name Box says why when one is refused.
- LET gives names to values inside one formula: `=LET(x,2,y,3,x*y)`.
- LAMBDA makes your own functions: `=LAMBDA(n,n+1)(41)` calls one straight away, and a LAMBDA saved as a name is called like a built-in function, recursion included. An uncalled LAMBDA shows `#CALC!`, the wrong number of arguments `#VALUE!`.
- New: SUBSTITUTE (81 functions in all).
- Conformance with Microsoft's function pages, now including LET, LAMBDA, SEQUENCE, TRANSPOSE and SUBSTITUTE, with the LAMBDA page's Name Manager definitions entered as the page gives them: 175 pass. The 5 that fail are one example that needs TEXT, which waits for number formats.

## 0.11.0 · 2026-10-21

- Dynamic arrays: a formula whose result is several cells (`=A1:A3*10`, `=SEQUENCE(4,2)`, `=TRANSPOSE(A1:C1)`) fills the cells to its right and below. If one of them is in use the formula shows `#SPILL!`; clearing that cell lets it spill again. Spilled cells are not saved as values and their formula bar is empty.
- Array constants such as `{1,2;3,4}`, usable in lookups (`=HLOOKUP(3,{1,2,3;"a","b","c"},2,TRUE)`) and arithmetic.
- INDEX takes row or column 0 for a whole column or row, a list of areas with an area number (`=INDEX((A1:C6,A8:C11),2,2,2)`), and INDEX, CHOOSE and IF can end a range (`=SUM(B2:INDEX(A2:C6,5,2))`).
- New: SEQUENCE, TRANSPOSE (78 functions in all).
- Conformance with Microsoft's function pages: all 159 runnable cases pass; 2 are inconsistent on the page itself, 9 depend on the day they run, 5 have their data only in a picture.

## 0.10.1 · 2026-10-21

- DATEVALUE and TIMEVALUE return plain serial numbers, as Microsoft's pages show (they were shown as a date and a time).
- A day and month without a year (`5-Jul`) is read as a date in the current year.
- Conformance, now including the 16 date and time pages: 153 pass, 6 need unbuilt features, 2 are inconsistent on the page itself, 9 depend on the day they run (TODAY and NOW), 5 have their data only in a picture.

## 0.10.0 · 2026-10-21

- Dates and times: type `2026-10-21`, `10/21/2026`, `12/8/08`, `October 21, 2026`, `21-Oct-2026`, `13:45`, `1:30 PM` or a date with a time, and the cell holds a date serial (Excel's 1900 system) shown as a date or time. Date arithmetic works (`=A1+30`).
- Currency and percent keep their look: `$1,234.50` and `15%` show as typed while holding numbers. Formulas pick up a date, time or currency look from what they compute.
- 16 date and time functions: DATE, YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, WEEKDAY, TODAY, NOW, TIME, DATEVALUE, TIMEVALUE, EDATE, EOMONTH, DAYS (76 functions in all). TODAY and NOW follow the computer's local clock and update on every change.
- The fill handle continues m/d/yyyy dates; dates, times, currency and percent line up on the right.
- Conformance with Microsoft's function pages: 125 pass (the date cases now run), 6 still need unbuilt features, 1 case is inconsistent on the page itself, 5 have their data only in a picture.

## 0.9.0 · 2026-10-21

- Conformance with Microsoft's function pages: every example table on the page of each function FormCel has was run through the engine as published. 123 cases pass; the 6 that fail need array constants, references returned by functions, multi-area references or INDEX with row 0, all still to come; 8 are skipped (dates, or data only in a picture). The report is in the planning sidecar.
- Typing `$1,234.50`, `-$5` or `50%` stores a number (1234.5, -5, 0.5); typing an error such as `#N/A` stores that error. (0.10.0 shows the `$` and `%` again.)
- New: ISNA, ISERR, ISLOGICAL, ISREF, ISNONTEXT (60 functions in all).

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
