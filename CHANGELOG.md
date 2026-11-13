# Changelog

## 0.41.0 · 2026-11-12

A full review of the engine process, the file formats, the grid, the panels, charts, scripts, VBA and the build scripts. Fixes only; nothing new.

- Editing: a value typed in one cell is no longer saved into the cell you click next; copying the whole sheet no longer freezes the window; double-clicking the fill handle stops at the end of the neighbouring data; cut then paste keeps formula references; AltGr and Option characters can be typed straight into a cell; filling up or left keeps the filled cells selected; sheet names cannot repeat in another letter case; page setups follow a sheet that is moved or deleted.
- Opening files safely: a sheet name, chart colour or shape colour from an opened workbook can no longer inject markup into the window; script custom functions run only when macros are allowed for the workbook; packed .xlsx and .ods files that unpack to gigabytes, or expand to millions of repeated cells, are refused.
- Saving as .xlsx and .ods: sheet and workbook passwords still work after a save; formulas that name sheets such as 'Filter (2)' keep the name; 1904-system dates open on the right day; text with control characters saves; IMAGE addresses are not fetched when external content is blocked; macro sheets no longer shift other sheets' comments and shapes.
- The engine process: opening a workbook during an import no longer freezes everything; imports and live streams no longer stall other requests; a published CSV link with a huge range answers at once; Delete forever also deletes saved versions; two settings changed at once no longer lose one; Python cells and the scheduled refresh work in the desktop app; the engine stops when the desktop window's process ends.
- Formulas: WEEKDAY return types 12 to 16 are right; EXPAND and MAKEARRAY with enormous sizes give an error instead of ending the engine; REPLACE with a huge count replaces to the end.
- Charts and scripts: waterfall totals match whole words only; very large close values no longer hang a chart; error bars from a column draw on line and scatter charts; overlapping range copies keep their values; VBA loops with an empty body can be stopped, Resume continues inside a loop, array assignment fills only its target, and `\`, Mod and InStrRev follow VBA.
- Panels: comments keep the reply you are typing when someone else comments; Replace moves on from the match it replaced; Escape ends the password prompts; sharing controls report a refused change.
- Scripts and builds: `./formcel` stops both processes on exit; `formcel.bat` starts the window after a first engine build; `build_app --clean` really rebuilds the engines and uses the Python it found; `build_wasm` honours CARGO_TARGET_DIR; the installers carry the licence.

## 0.40.9 · 2026-11-03

- The README follows the Form family layout and ships real screenshots of a workbook, its summary sheet, the Insert ribbon and the template gallery.

## 0.40.8 · 2026-11-03

- The app icon is the unified family icon on the desktop, the web app and the splash, and the browser tab icon is a PNG instead of the old SVG.
- The repository names its owners in `.github/CODEOWNERS`.

## 0.40.7 · 2026-10-31

- The Windows desktop app no longer opens to a blank window on PCs where an installer set the `.js` file type to `text/plain` in the registry: the engine now serves scripts and stylesheets with their real types.

## 0.40.6 · 2026-10-30

- On Windows, `formcel_oc_install.bat` no longer stops when Tesseract is missing; Data from a picture stays optional. A step that does fail (the Python packages, the engine module, npm or the window's engine) now stops the install with an error, and `build_app.bat` with it.
- The macOS app's engine folder is signed with the Developer ID, hardened runtime and a secure timestamp, so the app can be notarized. The app and its engine carry an entitlements file that lets the bundled Python runtime load its own libraries.
- Line endings are fixed in the repository, so Windows checkouts get CRLF batch files and LF everywhere else.

## 0.40.5 · 2026-10-26

- A test opens the built window under a slow network and a slow processor and fails if it shifts, logs an error, or has a request fail or refused; it runs on every change.

## 0.40.4 · 2026-10-26

- Scripts in a workbook (Apps Script, JavaScript cell functions and VBA macros) now run with no access to your files, programs or the network beyond what the workbook offers them. Before this, an Apps Script or cell function could reach outside the workbook, and an onOpen script ran when the workbook opened. Scripts need Node.js 22 or later.
- A test suite checks the engine's guard, formulas, opening and saving .xlsx and .fcel files, and the script runners; it runs on every change.

## 0.40.3 · 2026-10-25

- A web page can no longer reach the engine through an image or a link.

## 0.40.2 · 2026-10-25

- The engine answers only this computer's own FormCel window and agents. A web page open in a browser can no longer import a workbook into your library or read your workbooks.

## 0.40.1 · 2026-10-24

- The copyright holder in LICENSE, NOTICE.md and the README is NodeAgentc, Inc.
- The Home screen credit reads "by nodemode.ai".

## 0.40.0 · 2026-10-23

- Stocks and Currencies data types keep their records in a workbook record store instead of inside each cell. A cell holds only its record id and the label it shows; the card, Insert Data, field formulas such as `=A2.Price`, refresh, and copy and paste all work as before. Cells that share a company or pair share one record, so a refresh updates them together.
- Workbooks saved by earlier versions open as before: the records in their cells move into the store as the workbook loads, and the next save writes the new form (file format version 2).
- Copying a linked cell into another workbook brings its record along. Excel export and import keep the display text, the field formulas and the data type part, which now lists each record once.

## 0.39.6 · 2026-10-23

- Lora, Merriweather, Playfair Display, Raleway and Source Sans 3 ship as their complete original font files instead of subsets, and PDF export embeds them from those files.
- The desktop engine no longer carries psycopg or chardet, and the installers carry LICENSE and NOTICE.md.
- NOTICE.md lists the frozen Python packages, the libraries inside Pillow with the FreeType credit, fontTools and the desktop shell crates under other licences.

## 0.39.5 · 2026-10-23

- The cell style gallery's sections have FormCel's own headings: Status, Inputs and results, Headings and totals, Accent colours and Number styles. Style names are unchanged, so workbooks keep their styles.

## 0.39.4 · 2026-10-23

- The Function conformance template covers every example table: 332 example sheets with 743 cases, up from 67, regenerated by the same generator that leaves out the function pages' descriptions.

## 0.39.3 · 2026-10-23

- The Function conformance template no longer carries the function pages' descriptions: column AE is gone from every example sheet, and the template's description and the Summary note are in FormCel's own words. The Summary still links each function page.

## 0.39.2 · 2026-10-23

- A trademark notice in the README and NOTICE: Microsoft, Excel and Office belong to the Microsoft group of companies, Google Sheets to Google LLC, and FormCel is not affiliated with either.
- The light theme and the File view use the family orange instead of green, and the theme option is called "Light".
- CLAUDE.md carries the trademark, copyright and licence rules for agents.

## 0.39.1 · 2026-10-22

- The repository's GitHub Actions now run basic checks (frontend, backend and scripts) on main, on pull requests and on `compile_vX.Y.Z` branches.
- Releases are built by formcompiler (`nodemode-ai/formcompiler`) and published on its release page as `formcel-vX.Y.Z`.
- There is no change to the app itself.

## 0.39.0 · 2026-10-22

- All 28 Form family themes. Preferences > General > Appearance has a Family theme list; the one you pick is shared with every Form app on this computer, and a theme picked in another Form app now opens here too instead of falling back to Studio.
- The FormCel icon follows the family rule: small icons, the favicon, the title bar, Home, About and the splash show the icon's tile edge to edge instead of a shrunken copy with an empty margin. The maskable web app icon is rebuilt.

## 0.38.0 · 2026-10-22

- Every font: the font box lists 28 bundled typefaces and every font installed on the computer (through the desktop app, the browser, or the engine process for Safari and Firefox), grouped as Theme, Recently used, Bundled, This computer and In this workbook, each name in its own face, with type-to-filter. Cells, shapes and charts draw the real face; fonts a file names but this computer lacks are kept and listed. PDF export embeds the fonts the sheet uses.
- 76 templates in seven categories. 40 are new, ten each in Finance, Sales & marketing, Operations and Personal & education, and the 14 Data & charts templates are rebuilt. Each is a finished workbook: a data sheet with real rows, a dashboard of formulas over it, and charts, sparklines and conditional formatting tied to its cells, so editing the data changes the dashboard. Chart kinds include combo with a secondary axis, waterfall, funnel, Pareto, treemap, sunburst, filled maps, Gantt timeline, org chart, box and whisker, histogram, scatter and bubble with trendlines, gauge, scorecard, radar and 100% stacked.
- The template gallery draws each template's first chart from its own data on the card, names its visuals, and opens a preview with larger charts before you create it.
- Charts: a separate number format for the secondary axis, reference lines on scatter charts linked to cells, error bars from a column, a Gantt timeline with one row per task coloured by phase, bubbles no longer clipped, room for tilted labels.
- The real FormCel logo everywhere: title bar, Home, About, File view, favicon, web app icons and the desktop app icons.
- Fixed: the REST API, Apps Script, Python cells, Power Query from a range and links to other workbooks read formatted numbers as text (for example "$912,200"); they now get numbers.

## 0.37.1 · 2026-10-22

- Fixed: on macOS 27 the engine process stopped at start with "mis-aligned LINKEDIT string pool", so the window showed no workbooks or templates. Release builds of the engine and the desktop app are no longer stripped (rustc before 1.98 strips Mac libraries in a way macOS 27 refuses). `./formcel_oc_install` now rebuilds the engine every time and stops with a clear message if it cannot load it.
- New: `./build_app` (macOS and Linux) and `build_app.bat` (Windows) at the top of the folder build the desktop app start to finish, as in formvis and formdeck: FormCel.app in Applications and a .dmg on macOS, a .deb on Linux, .msi and setup .exe on Windows.

## 0.37.0 · 2026-10-22

- FormCel now opens as a full spreadsheet window in the form family: a rounded splash with a loading bar, then the window appears whole; a 38 px title row with the workbook name, a command search box (Alt+Q), share, account and settings; on Windows and Linux optional custom minimize, maximize and close buttons.
- A ribbon replaces the flat toolbar: File, Home, Insert, Draw, Page Layout, Formulas, Data, Review, View, Automate, Developer and Help, with contextual tabs for tables, PivotTables, charts, shapes, pictures and sparklines. Groups shrink as the window narrows, Ctrl+F1 collapses the ribbon, Alt shows key tips, and the Quick Access Toolbar and Customize the Ribbon can be changed.
- A menu bar (File to Help) in the window, or in the macOS menu bar; a status bar with Ready, Enter, Edit and Point, Sum, Average, Count, Min and Max of the selection, accessibility status, view buttons and the zoom slider; drop a spreadsheet anywhere to open it.
- A File view: New, Open, Info, Save As, Save a Copy, Print with a real page preview, Share, Export, Publish, Close, Account and Options. The grid: 20 px rows, Aptos Narrow 11, a coloured selection, highlighted headers, cancel and enter beside the formula bar, sheet tab arrows and a tab splitter.
- A new Home screen with a greeting, Start from a file, recent workbooks as thumbnails or a list, and new workbook presets.
- Preferences (Ctrl+,) gather Excel's Options: general, formulas, data, proofing, save, language, accessibility, advanced, Customize Ribbon, Quick Access Toolbar, add-ins and the Trust Center with macro settings, trusted locations and an external content switch. Keys and tokens go to the system password store when one is available.
- VBA macros: a Visual Basic Editor (Alt+F11) with Project Explorer, code windows, Properties, Immediate, Locals, Watches, breakpoints and stepping; a Macros dialog (Alt+F8); Record Macro writes VBA; form controls; events and VBA functions in cells. .xlsm files keep their VBA project, open it in the editor and save edits back into vbaProject.bin. Macros are off until you enable them, as in Excel.
- The Data Model: tables, relationships, calculated columns, measures, hierarchies and KPIs in a Data Model window; the seven CUBE functions over it; PivotTables from the model and Convert to Formulas.
- Stocks and Currencies data types with cards, Insert Data and field formulas (=A2.Price, FIELDVALUE); GOOGLEFINANCE and STOCKHISTORY from a market data provider you choose with your own key, and free ECB exchange rates. 438 functions.

## 0.36.0 · 2026-10-22

- Start a workbook by pasting comma or tab separated text or an HTML table, or by dropping a PDF with tables. Check Spelling (F7) with a bundled English word list and your own dictionary.
- Excel's own colours for all 60 built-in table styles; tables without a header row, in the window and in .xlsx; nine more spreadsheet locales with their separators.
- Name Manager, Insert Function, Function Arguments and named LAMBDA functions checked end to end, with sheet-scoped names and LAMBDA names saved in .xlsx; all 18 checks on Microsoft's LAMBDA page pass. Web functions fetch for real; references to other workbooks read files on disk and keep cached values.
- .xlsx: slicers, chart sheets, print areas and titles, pivot charts with field buttons, pictures in cells as Excel stores them, and 100 shapes with fill, line, rotation and text formatting. .ods keeps filters and data validation. .xls brings in conditional formatting, validation, array and table formulas and charts.
- Charts: drag boxes in an org chart to change who reports to whom; annotated timelines; maps of states and provinces.
- Smart chips inside cells with the @ picker; drag and resize timeline cards; buttons on any shape or picture run scripts.
- Solver's Evolutionary engine and Options; ToolPak chart outputs; Analyze Data inserts its PivotTables and charts.
- Power Query as editable text with step undo, dependencies and tables that resize on refresh; PostgreSQL and MySQL queries with parameters; scheduled refresh with or without FormCel open; a better Data from picture; an extensions marketplace with signed packages; the REST API covers names, tables, charts, pivots, rules, validation and filters.
- Apps Script scripts and triggers run in the engine process, also with the window closed; Office Scripts get TypeScript checking and completions; Python cells use pandas and spill DataFrames; add-in functions show their help.
- Fixes found by driving every 0.35.0 feature in the window: scatter charts in .xlsx, undo with a chart selected, sparkline ranges growing, the Scenario PivotTable report, undoing an array delete, Ctrl+Shift+U, the accessibility checker's alt text.
- A last round drove the remaining rows in the window: Power Query tables saved to .xlsx as query tables; IMAGE results stored as Excel in-cell pictures; Python cells share variables top to bottom; streaming custom functions update in the engine process; maps for regions of 230 more countries; a bare table name, unions and point mode in structured references; recorded macros replay cell shifts, charts and sheet changes exactly.

## 0.35.0 · 2026-10-21

- Calculation: Automatic, Automatic except data tables and Manual with F9, Shift+F9 and Ctrl+Alt+F9; iterative calculation with maximum iterations and change, and a circular reference warning when it is off; the R1C1 reference style; Ctrl+Shift+Enter array formulas over a fixed range; the blue spill outline and `#SPILL!` reasons; error checking with green triangles, the smart tag and the Error Checking dialog; references to other workbooks with Edit Links; the engine process calculates on several threads. All of it is saved in .fcel and .xlsx.
- Names and functions: Name Manager with sheet-scoped names and comments, Create from Selection, Apply Names and Paste List; Insert Function and Function Arguments; named LAMBDA functions with import from another workbook; Evaluate Formula Step In and Step Out; XLOOKUP binary search and several-column results; regular expressions with lookaround; CELL and INFO in full; QUERY pivot, format and options; IMPORTFEED and full XPath; IMAGE, ISOMITTED, ISBETWEEN, ISDATE, ISEMAIL and ISURL. 428 functions.
- Charts: every kind is saved in .xlsx, the newer ones (histogram, box and whisker, waterfall, funnel, treemap, sunburst) as chartex parts; stacked and 100% variants; series colours, axis formats, limits, log scale, gridlines, legend position, label formats and fills; trendlines with equation and R squared; error bars; ranked recommended charts with previews; pivot charts with filter buttons; a country map chart.
- Objects: charts, pictures, shapes and text boxes are anchored to cells, follow inserted and deleted rows and columns, and every change is one undo step; shapes, text boxes and alt text are saved in .xlsx; sparkline groups (line, column, win/loss) in .xlsx; pictures in cells; a timeline view of dated rows; dragging page breaks.
- PivotTables and what-if: every Show Values As choice, grouping of dates and numbers, ranked suggestions, real pivot caches in .xlsx; Goal Seek options, Scenario Manager merge and summary PivotTable, data tables kept as TABLE formulas, Solver Sensitivity and Limits reports, the Analysis ToolPak tools, questions in Analyze Data.
- Entry and data tools: Go To with Go To Special, Insert and Delete Cells rewriting references, Series, Auto Outline, row height and column width dialogs, the expandable formula bar, Flash Fill preview, Paste Special in full, the Format Cells number dialog, de-DE and fr-FR formula separators, special formats, copy or move sheets to another workbook, grouped-sheet formatting, document properties; 60 table styles plus custom ones, column types, custom sort lists and sort by colour or icon, date and dynamic filters, filter views per person, slicers with several selections, dropdown chips, consolidate with links, advanced filter with formula criteria.
- Sharing: view, comment and edit links on the local network when you turn sharing on, an activity log of viewers, notifications and an inbox, chat beside the sheet, change history with sorts and inserts, threaded comments and protected ranges in .xlsx, an offline queue that replays saves, and publish and embed options. .xls files bring in formulas and formatting.
- Automation: more Power Query steps and sources, PostgreSQL and MySQL queries, data from a picture through an installed Tesseract, Python cells (off until you turn them on), custom functions computed by the engine process, extension packages, a fuller REST API, assistant chart and pivot proposals and offline data cleaning, and an installable web app.

## 0.34.0 · 2026-10-21

- Functions: 421 in all (was 112). Financial, math and trigonometry, statistical and every distribution, the D database functions, engineering and complex numbers, more text, date, lookup and information functions, REGEXMATCH and friends, QUERY, GROUPBY and PIVOTBY, FORECAST and FORECAST.ETS, LINEST and TREND, SPARKLINE, the web functions and AI. 632 of 669 judged examples on Microsoft's pages give the page's result (CONFORMANCE.md in the planning docs).
- Charts: insert a chart from the selection and edit it (type, range, titles, axes, legend, labels): column, bar, line, area, pie, scatter, combo, histogram, box, waterfall, stock, treemap, sunburst, funnel, gauge, scorecard, radar, org and timeline. Common kinds are saved in .xlsx. Pictures, shapes and text boxes float over the grid.
- PivotTables with Rows, Columns, Values and Filters, summaries, percent of totals, calculated fields, suggested layouts and refresh as the source changes.
- What-if: Goal Seek, Data Table, Scenario Manager, Solver, Forecast Sheet, Descriptive Statistics, Regression and Analyze Data.
- Data tools: remove duplicates, text to columns, trim and cleanup, checkboxes, consolidate, subtotals, advanced filter, Flash Fill (Ctrl+E), filter views, slicers, table column types, grouped sheets, hidden sheets, find and replace (Ctrl+F, Ctrl+H), AutoComplete, personal templates and a zoom slider.
- Review: notes, threaded comments with mentions, sheet, range and workbook protection, hidden formulas, Mark as final, version history, a change log per cell, share and publish links, and live editing between windows on this computer.
- Formula auditing: trace precedents and dependents, Evaluate Formula and the Watch Window.
- Automation: a script editor with a sandboxed workbook API, recorded macros, custom functions, triggers, script buttons, a REST API at /api/v1, data connections and queries, and an assistant that works with a model endpoint you set up.
- Print and access: Page Setup (orientation, paper, margins, print area, titles, scaling, headers and footers, breaks, gridlines) in PDF and .xlsx, web page export, an accessibility checker, light and high-contrast themes, a shortcuts reference, larger text and five spreadsheet locales. A Tauri 2 desktop shell is in `src-tauri/`, not yet built on Windows or macOS.

## 0.33.0 · 2026-10-21

- Tables: the Table button (or Ctrl+T) turns the data around the active cell into a table with a header row, filter buttons and banded rows. Inside a table the same button opens Table design: name, style (eight to choose from), resize, Total row, banded rows and columns, first and last column, filter button, and Convert to range.
- Structured references: `=SUM(DeptSales[Sales Amount])`, `=[@Qty]*[@Price]`, `DeptSales[[#Headers],[Region]]`, `#All`, `#Data`, `#Totals` and column ranges. Renaming the table or a header updates every formula that uses it; Convert to range turns them into cell references.
- Calculated columns: a formula typed into an empty table column fills the whole column, and new rows get it too. Typing just below or beside a table makes it bigger.
- Total row: a list on each total cell gives Sum, Average, Count, Count Numbers, Max, Min, StdDev and Var as SUBTOTAL formulas. New function SUBTOTAL, which leaves out rows a filter hides. 112 functions.
- Tables are saved in .xlsx files and read from them; LibreOffice opens them and computes the totals. In .ods files table formulas are written with plain cell references. Not yet: tables without a header row, Excel's exact style colours, and SUBTOTAL 101 to 111 leaving out rows hidden by hand.

## 0.32.0 · 2026-10-21

- Data validation: the Data validation button opens a dialog with Settings, Input message and Error alert. Allow whole numbers, decimals, a list, dates, times, a text length or a custom formula, between or beyond limits that can be values or formulas such as `=TODAY()+3`.
- Lists: items typed with commas or taken from a range. A cell with a list shows an arrow when selected; the arrow or Alt+Down opens the items.
- An input message shows beside the selected cell. Typing a value that is not allowed brings up the alert: Stop (Retry or Cancel), Warning (Continue? Yes, No or Cancel) or Information (OK or Cancel).
- Rules are saved in .xlsx files and read from them. Clearing cells and pasting are not checked yet, and rules in .ods files are left out with a note.
- New functions: FIND (matching case) and SEARCH (ignoring case, with `?` and `*`). 111 functions.

## 0.31.0 · 2026-10-21

- Filters: Filter on the toolbar, or Ctrl+Shift+L, puts a button on each header of the data around the active cell. A button, or Alt+Down on a header, opens the filter panel: sort by that column, filter by values (with search, Select all and Blanks), by one or two conditions joined by And or Or (equals, begins with, contains, greater than and the rest, with `?` and `*` wildcards), top or bottom N items or percent, above or below average, or by fill or text colour.
- A column with a filter shows a funnel on its button, and the row numbers turn blue. Reapply filter runs it again over changed data and takes in new rows below; Clear filter shows every row and keeps the buttons. Each change is a step to undo.
- Rows a filter hides are kept apart from rows hidden by hand, so Unhide does not undo a filter.
- Filters are saved in .xlsx files (and read from them) as Excel's AutoFilter. PDF leaves out the rows a filter hides; .ods files save those rows hidden. Not yet: date filters, icon filters and filters in .ods files.

## 0.30.0 · 2026-10-21

- Sorting: Sort A to Z and Sort Z to A by the active column from the toolbar, and a Sort dialog for several levels (Then by), a header row and case-sensitive order. With one cell selected, FormCel sorts the block of data around it and guesses whether its first row is a header.
- Whole rows move together, with their formatting, links and formulas; blank cells stay at the end. Sorting is one step to undo.
- Merged cells in the range stop a sort, with a message to unmerge them first.

## 0.29.0 · 2026-10-21

- Conditional formatting now travels in .ods files both ways, in the form LibreOffice uses. Stop If True and reversed icons are not part of that form and are dropped.
- ARRAYFORMULA from Google Sheets, for example `=ARRAYFORMULA(A1:A3+B1:B3)`, so formulas from Sheets work. 109 functions. In .xlsx and .ods files the formula inside it is written instead, since Excel and LibreOffice have no ARRAYFORMULA.

## 0.28.0 · 2026-10-21

- PDF: download this sheet or every sheet as a PDF, laid out on Letter pages with the cells' formatting, merges, conditional formatting colours and data bars. Wide sheets are scaled to fit.
- Passwords: password-protected .xlsx (and .xls) files ask for their password when opened, and Download can save an .xlsx that needs a password to open.
- Formulas: the spilled range operator, `=SUM(A1#)`, refers to everything a formula in A1 spills, and the implicit intersection operator, `=@A1:A10`, picks the value on the formula's own row. Both are kept in .xlsx files.
- Not yet: rotated text, icon sets and pictures in PDFs; page setup (margins, orientation, print areas) comes with Phase 12.

## 0.27.0 · 2026-10-21

- OpenDocument spreadsheets: open and download .ods, with values, formulas, number formats, cell formatting, merges, links, names, column widths and row heights. Files open in LibreOffice with their values.
- Legacy Excel .xls files open with their last saved values, number formats, merges and sizes. Formulas in .xls files come in as values.
- Macros: a .xlsm file's macros are kept, and Download offers .xlsm to save them back. FormCel does not run macros.
- Not yet: conditional formatting in .ods files, fraction and scaled number formats in .ods (written in a simpler form).

## 0.26.0 · 2026-10-21

- Conditional formatting now travels in .xlsx files both ways: every kind FormCel has, with its order and Stop If True.
- Open CSV, TSV and text files from Home. A preview shows the first rows, the separator (comma, semicolon, tab or vertical bar, guessed and changeable) and, for each column, what it holds; set a column to Text to keep values such as 00123 exactly. Formulas in a text file stay text.
- The download button now offers the workbook as .xlsx or the current sheet as .csv or .tsv.
- Fixed: text starting with `=`, such as `'=1+1`, became a formula after the workbook was reopened.

## 0.25.0 · 2026-10-21

- Open Excel workbooks: Open a file on Home, or drop a .xlsx or .xlsm file onto Home. The workbook opens as a new FormCel workbook; the save indicator says if anything was left out, and its tooltip lists what.
- Download as .xlsx, from the end of the toolbar.
- Both ways keep values, formulas, number formats, fonts, fills, borders, alignment, indent, wrap, rotation, cell styles, the theme, merges, links, names, frozen panes, column widths, row heights, hidden and grouped rows and columns, zoom and tab colours. Newer functions such as XLOOKUP, FILTER, LET and LAMBDA are written the way Excel files store them.
- Not yet: conditional formatting, data validation, comments, pictures, charts and pivot tables from a file; names that belong to one sheet; .xls, .ods and CSV.
- Fixed: a formula pointing at the first sheet by its name, such as `=Data!B2`, showed #REF! after reopening a workbook whose first sheet was not called Sheet1.
- Fixed: the version in the top bar had stayed at 0.10.1.

## 0.24.0 · 2026-10-21

- New template, Formatting check (Example projects):
  - 51 number format cases from Microsoft's format pages, each with the page's result, the cell shown with that format, and `TEXT` of the same code. All 51 match.
  - Every cell style setting, the 24 built-in cell styles, a merge, one conditional formatting rule of each kind, and the link examples, each row saying what it should look like.
- Templates can now carry number formats, styles, merges, conditional formatting and links.
- Fixed: a time with a fraction of a second, such as `[ss].00`, lost the fraction when the workbook was saved.
- Fixed: dark text colours from heading and title styles were unreadable on the dark grid; they are now lightened where the cell has no fill.
- Formatting (Phase 3) is complete. Checking against a workbook made in Excel moves to Phase 4, which brings .xlsx import.

## 0.23.0 · 2026-10-21

- Links in cells:
  - HYPERLINK(link_location, [friendly_name]), for example `=HYPERLINK("https://example.com/report","Report")`. 108 functions in all.
  - Typing a web address or an email address makes it a link.
  - Insert link or Edit link with Ctrl+K or right-click: text to display and a web page, an email address, or a place in the workbook such as `#Sheet2!A1`.
  - Selecting a linked cell shows its target with Open, Edit and Remove. Ctrl+click opens it. Remove link keeps the text; Delete removes both.
- Links are blue and underlined, saved with the workbook, undo, and move with inserted and deleted rows and columns.
- Only web, email, ftp and in-workbook links are made; other kinds of address stay plain text.

## 0.22.0 · 2026-10-21

- Conditional formatting, from the new toolbar button:
  - Highlight rules: greater than, less than, between, equal to, text that contains (with `?` and `*` wildcards), a date occurring, and duplicate or unique values.
  - Top and bottom rules: top or bottom N items or N percent, above or below average.
  - Data bars, two- and three-colour scales, and icon sets (3 arrows, traffic lights, flags, symbols, 5 arrows).
  - Formula rules, written for the first cell of the selection, for example `=$B1="Yes"` to format whole rows.
- Manage rules: see every rule on the sheet with where it applies, move rules up and down, turn on Stop If True, delete. When two rules set the same thing the higher one wins.
- Rules update as you type, are saved with the workbook, undo, and move with inserted and deleted rows and columns.
- Not yet: editing a rule after it is made, custom icon cut-offs and bar colours from the window, and references inside rule formulas moving when rows are inserted.

## 0.21.0 · 2026-10-21

- Cell styles: a gallery of 24 built-in styles, from Good, Bad and Neutral to headings, Total, Input and Output, accents and number styles. Applying a style resets the parts of the formatting it covers. Make your own from the selection, choosing which parts it includes (number, alignment, font, border, fill), then update or delete it. Changing a style changes every cell that uses it.
- Themes: FormCel, Slate, Forest, Ember and Mono, each with ten colours and a heading and a body font. Styles that use theme colours, and the default text font, follow the theme. The colour menus show the theme's colours first.
- Paste Special (Ctrl+Alt+V, or right-click): All, Formulas, Values, Formats, Formulas and number formats, Values and number formats, All except borders, Column widths, and Transpose.
- Pasting cells copied in FormCel now pastes their formulas, with relative references moved, instead of the text they showed.
- A leading apostrophe now keeps typed input as text, for example `'007`.
- Fixed: a menu opened from the toolbar lost keyboard focus right after opening, and Escape on a cell started an edit.
- Not yet: Paste Special's math operations and Skip blanks; custom themes.

## 0.20.0 · 2026-10-21

- Merged cells: Merge and center, Merge across, Merge cells and Unmerge cells. As in Excel, only the upper-left value is kept. A merged cell selects, moves and edits as one cell, and merges follow inserted and deleted rows and columns.
- Text rotation: angle counterclockwise or clockwise, rotate text up or down, and vertical text. Rows grow to fit.
- Format painter: copies the formatting of the selection onto the next cells you select. Double-click it to paint several times, and press Escape to stop.
- The fill handle and paste of cells copied in FormCel now carry fonts, colours, borders and number formats, in one undo step.
- Inserted rows and columns take the formatting of the row above or the column to the left.
- Fixed: undoing a row or column delete brought back the values but not their formatting.
- Clear formats now undoes in one step.
- Not yet: named cell styles and workbook themes; the format painter does not copy merges.

## 0.19.0 · 2026-10-21

- Cell styles from the toolbar: font and size, bold, italic, underline, strikethrough, text colour, fill colour, borders, left, center and right alignment, top, middle and bottom alignment, indent, wrap text, and Clear formats.
- Borders: all, outside, inside, top, bottom, left, right or none, in thin, medium, thick, dashed, dotted or double lines. Outside borders undo in one step.
- Excel's shortcuts: Ctrl+B, Ctrl+I, Ctrl+U and Ctrl+5 (also Ctrl+2, 3, 4) turn bold, italic, underline and strikethrough on or off; Ctrl+Shift+& draws an outline border and Ctrl+Shift+_ removes borders.
- Text now sits at the bottom of its cell, as in Excel, and long text spills into empty cells beside it.
- Rows grow to fit wrapped text and larger fonts.
- Colours in number format codes, such as `[Red]` or `[Blue]`, now show.
- Styles are saved in the workbook, undo and redo, and move with inserted and deleted rows and columns.
- Not yet: merged cells, rotation, cell styles, themes and the format painter; copying, filling and pasting do not carry styles yet.

## 0.18.0 · 2026-10-21

- Number formats per cell. The new Number format button lists General, Number, Currency, Accounting, Percent, Scientific, Fraction, Short date, Day month year, Long date, Time, Time with seconds and Text, and Custom format takes any format code.
- Excel's shortcuts: Ctrl+Shift+~ General, ! Number, @ Time, # Date, $ Currency, % Percent, ^ Scientific.
- Increase and decrease decimal places, from the toolbar.
- Formats are saved in the workbook, undo and redo, and move with inserted and deleted rows and columns. Formatting whole columns or the whole sheet covers the used range.
- The cell and the formula bar keep what you typed: 0.256 under Percent shows 26% in the cell and 25.6% in the bar. Under Text, `007` stays `007`.
- Numbers now align right because they are numbers, not because their text looks like one.
- Not yet: colours from a format code such as `[Red]`. They arrive with font and fill colours.

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
