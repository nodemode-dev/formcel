# HASHOUT_LOG · engine · formcel

Living log of comment content and rationale for the Rust engine. Source stays near comment-free; it lives here.

Current build version: v0.17.0
Last updated: 2026-10-21 · number format codes, TEXT

### Number format codes and TEXT
- refers-to: src/fmtcode.rs :: parse, section, Code::render, number, fraction, date, literal, text; src/eval.rs :: call ("TEXT"); src/formula.rs :: FUNCTIONS (107)
- kind: explainer
- logged: v0.17.0 · 2026-10-21

`fmtcode` reads the format codes described on Microsoft's "Review guidelines for customizing a number format" page (MS-NUMGUIDE) and renders a value with them:
- Sections and selection: up to four sections (positive, negative, zero, text), split on `;` outside quotes. With two or more sections a negative number uses the second section and is shown without its minus sign (`$-0.00" Shortage"` writes its own). With three or more, zero uses the third. The text section is the fourth, or a section that has `@` and no digit placeholders.
- Brackets: `[Red]` and the other seven colours are parsed and returned for later cell display. Conditions such as `[<=9999999]` pick the section that holds; when none holds, the next section without a condition is used. `[$€-407]` shows its symbol.
- Literals: quoted text, `\x`, and any other character are shown as written. `_x` gives one space; `*x` is skipped, since there is no column to fill.
- Numbers: `0`, `#` and `?` digit placeholders on both sides of `.`, with extra integer digits shown. A comma between placeholders adds thousands separators, and commas after the last placeholder each divide by 1,000. `%` multiplies by 100.
- Scientific: `E+` or `E-` with exponent digits. With `#` in the integer part, the exponent steps by the number of integer placeholders (`#0.0E+0` gives `12.2E+6`).
- Fractions: `# ?/?` and `# ???/???` use the closest fraction whose denominator has that many digits, and a fixed denominator such as `?/8` is also read.
- Dates and times: `y`, `m` and `d` runs, `h`, `m` and `s`. `m` or `mm` is minutes right after an hour code or right before seconds, and months otherwise, as the page's note says. AM/PM and A/P switch to a 12-hour clock. `.00` after seconds shows hundredths. `[h]`, `[mm]` and `[ss]` show elapsed time.
- `General` shows the usual display.

Rounding is half away from zero. A single-section code shows a minus sign before a negative number only when a nonzero digit is shown, so `-0.001` in `0.00` shows `0.00`; that is FormCel's own choice.

TEXT(value, format_text) renders with the code. Number-like text is read as a number (`TEXT("5","0.0")` is 5.0), a blank is 0, TRUE and FALSE show as written, errors pass through, and an unreadable code (unbalanced quote, unknown bracket, five sections) gives `#VALUE!`. A date code on a negative number also gives `#VALUE!` (FormCel's choice; there is no column for `####`).

Checks (`fmtcheck.py` in the sidecar's tools): every "To display / As / Use this code" row on MS-NUMGUIDE, the sections, literal and text examples in its prose, and TEXT's examples that do not depend on today (51 cases, aligned output compared with runs of spaces squashed). Dates and times were checked on 4 March 2026 16:36:03.75, a value chosen here, with the expected text worked by hand. The conformance run is now 186 pass, 0 fail: THANKSGIVINGDATE on the LAMBDA page needed TEXT.

Not done yet: cells cannot take a format code (they still use the automatic `Fmt`); the format is not applied to cell display; locale-specific codes (`[$-409]` dates, decimal commas) are not built.

### ERROR.TYPE and EXACT
- refers-to: src/eval.rs :: call ("ERROR.TYPE", "EXACT"); src/formula.rs :: FUNCTIONS (106)
- kind: explainer
- logged: v0.16.0 · 2026-10-21

Both were added so the conformance workbook can test each case inside the sheet: ERROR.TYPE tells error kinds apart, and EXACT compares text with case. ERROR.TYPE follows its Microsoft page: `#NULL!` 1, `#DIV/0!` 2, `#VALUE!` 3, `#REF!` 4, `#NAME?` 5, `#NUM!` 6, `#N/A` 7, and `#N/A` for anything that is not an error. FormCel's own `#SPILL!`, `#CALC!` and `#ERROR!` are not on the page, so they also give `#N/A`; that is FormCel's choice. EXACT is case-sensitive, as its page says. Both pages' examples pass in the conformance run (181 pass, 5 fail).

### Workbook::load, clear_history, rename_sheet (v0.3.0)
- refers-to: crates/formcel-core/src/lib.rs :: load, clear_history, rename_sheet; formcel-wasm fc_load, fc_add_sheet, fc_sheet_names; formcel-py load, cells, rename_sheet
- kind: explainer
- logged: v0.3.0 · 2026-10-21

`load` writes cells without an undo step: the window uses it to open a saved workbook (so Ctrl+Z cannot empty it) and the engine process uses it to mirror the window's edits. `cells` in the Python build reads a whole sheet, from A1 to the used range, for saving.

---

## Org-navi-map

```
engine/
├── Cargo.toml                       workspace, release profile sized for wasm
├── build_wasm(.bat)                 builds formcel-wasm, copies it to frontend/public/engine/formcel.wasm
└── crates/
    ├── formcel-core/src/lib.rs      Value, Addr, A1 parsing, Sheet, Workbook, history
    ├── formcel-core/src/store.rs    chunked cell store, Dir, data-edge search
    ├── formcel-core/src/wire.rs     text format for cell lists shared by both wrappers
    ├── formcel-wasm/src/lib.rs      C ABI exports for the window worker
    └── formcel-py/                  PyO3 module formcel_engine (pyproject.toml for maturin)
```

## Table of contents

- [crates/formcel-core/src/lib.rs and store.rs](#core)
- [crates/formcel-core/src/wire.rs](#wire)
- [crates/formcel-wasm/src/lib.rs](#wasm)
- [crates/formcel-py/src/lib.rs](#py)

---

## crates/formcel-core/src/lib.rs {#core}

### Workbook · one engine, two hosts
- refers-to: crates/formcel-core/src/lib.rs :: Workbook
- kind: rationale
- logged: v0.1.0 · 2026-10-21

The owner chose option (c) for DEV_PLAN Q1: the calculation engine is written once in Rust and runs in the window (WebAssembly) and in the engine process (Python module). Every rule lives in this crate; the two wrappers only translate calls, so the window and an agent working headless can never disagree on a value.

### Sheet.cells · sparse store
- refers-to: crates/formcel-core/src/lib.rs :: Sheet
- kind: explainer
- logged: v0.1.0 · 2026-10-21

A HashMap keyed by Addr. Setting a cell to empty input removes the key, so the store only holds filled cells. Phase 1 replaces it with chunked blocks for scroll-order iteration; the public API stays.

Replaced in v0.2.0 by `store.rs` (next entry); the HashMap import was removed from lib.rs.

### Store · 32 by 32 blocks
- refers-to: crates/formcel-core/src/store.rs :: Store
- kind: rationale
- logged: v0.2.0 · 2026-10-21

A BTreeMap keyed by (row block, column block), each block a sorted Vec of (index in block, Value). A viewport read walks only the blocks it overlaps, in row order, and an empty block is removed, so sparse sheets cost nothing and a 61 by 26 read takes about 0.07 ms with a million rows filled. Measured from Python: 1,000,000 cells written in 1.3 s.

### Store::edge · Excel's Ctrl+arrow rule
- refers-to: crates/formcel-core/src/store.rs :: edge, next_filled
- kind: explainer
- logged: v0.2.0 · 2026-10-21

From a filled cell whose neighbour is filled, walk to the last filled cell of the run. Otherwise jump to the next filled cell in that direction, or to the sheet's edge when there is none. next_filled skips whole empty blocks, so a jump across a million empty rows checks at most 32,768 block keys.

### Workbook history
- refers-to: crates/formcel-core/src/lib.rs :: Workbook::apply, undo, redo, replay
- kind: explainer
- logged: v0.2.0 · 2026-10-21

Every apply is one undoable step holding each changed cell's before and after values; cells that did not change are left out of the step but still reported, so the window repaints them. A new edit clears redo. The undo stack keeps the last HISTORY_LIMIT (500) steps. Undo replays a step backwards, redo forwards.

---

## crates/formcel-core/src/wire.rs {#wire}

### Text lines instead of JSON
- refers-to: crates/formcel-core/src/wire.rs :: whole file
- kind: rationale
- logged: v0.2.0 · 2026-10-21

Cell lists cross the WebAssembly boundary as `row\tcol\ttext` lines (changes add a leading sheet), with backslash, tab, newline and carriage return escaped. No serde, no JSON parser in the module, and the window decodes it with one split per line. Defined once here so the wrappers cannot drift.

### Value::parse_input
- refers-to: crates/formcel-core/src/lib.rs :: Value::parse_input
- kind: todo
- logged: v0.1.0 · 2026-10-21

Thousands separators are stripped with a plain comma replace; locale-aware parsing (decimal comma, currency, percent, dates) belongs to Phase 3 with the number format engine.

---

## crates/formcel-wasm/src/lib.rs {#wasm}

### C ABI instead of wasm-bindgen
- refers-to: crates/formcel-wasm/src/lib.rs :: whole file
- kind: rationale
- logged: v0.1.0 · 2026-10-21

Plain `extern "C"` exports with one shared out buffer: no generated JS glue, no wasm-bindgen CLI version to keep in lockstep, no dependency. Strings go in through fc_alloc and fc_free; results come back as a length plus fc_out_ptr. The worker copies the result before the next call overwrites the buffer. Revisit in Phase 2 if the call surface grows past a few dozen functions.

### `# Safety` doc comments
- refers-to: crates/formcel-wasm/src/lib.rs :: fc_free, fc_set, fc_get
- kind: warning-context
- logged: v0.1.0 · 2026-10-21

Kept in source bc clippy requires a Safety section on public unsafe functions; they are the only comments in the crate.

---

## crates/formcel-py/src/lib.rs {#py}

### abi3-py312, and why Workbook is sendable
- refers-to: crates/formcel-py/Cargo.toml, src/lib.rs :: Workbook
- kind: rationale
- logged: v0.1.0 · 2026-10-21 · revised v0.4.0

abi3 for Python 3.12 builds one wheel that loads on 3.12 and later. Through v0.3.0 the class was `unsendable`. FastAPI runs plain `def` routes on a thread pool, so a workbook created on one thread was used from another, and PyO3 panics on that. The backend already serialises every call to a workbook with its own lock (`Book.lock` in backend/app/services/store.py), so the class is now an ordinary sendable pyclass and PyO3 holds a borrow flag on each call.

### No panic = "abort"
- refers-to: Cargo.toml :: profile.release
- kind: warning-context
- logged: v0.4.0 · 2026-10-21

The release profile used to set `panic = "abort"` to shrink the wasm. In the Python build, abort turns any panic into the death of the whole engine process, which is how the unsendable panic above surfaced: the window saw health time out with no error. With the default unwind, PyO3 turns a panic into a Python `PanicException` and the request fails on its own. The wasm grows by a few KB.

---

## crates/formcel-core/src/lib.rs · shifting rows and columns {#shift}

### Insert and delete are one history step each
- refers-to: src/lib.rs :: Workbook::insert, Workbook::delete, Tx, Effect
- kind: rationale
- logged: v0.4.0 · 2026-10-21

History holds `Tx` entries: either a list of cell changes or a shift. A delete records the cells it dropped, so undo replays the reverse shift and puts those cells back; the effect it returns names both, so the window can move its row and column sizes before it repaints the cells. Deleting, moving or renaming a sheet clears history, because the stored sheet indices would point at the wrong sheet.

### Store::shift reinserts filled cells
- refers-to: src/store.rs :: Store::shift
- kind: rationale
- logged: v0.4.0 · 2026-10-21

The shift drains the store and reinserts each cell at its new address. That costs one pass over filled cells, not over the 1,048,576-row grid: inserting a row into a 1,000,000-cell column took 0.10 s and its undo 0.09 s in the Python build (release, opt-level s).

---

## Formulas {#formulas}

### Where formulas live
- refers-to: src/lib.rs :: Workbook.formulas, set_raw, input, inputs; Formula
- kind: explainer
- logged: v0.7.0 · 2026-10-21

The cell store keeps each formula cell's computed value, so display, reads, the used range and Ctrl+arrow edges treat formula cells like any other filled cell. The formula itself (its parsed tree, and the typed text when it does not parse) sits in `Workbook.formulas`, keyed by sheet and cell. `input` gives what the person typed (`=` plus the canonical formula text) and `inputs` gives every cell's input for saving; history records inputs, not values, so undo brings a formula back. A formula whose result is empty shows 0; text that does not parse shows `#ERROR!` and keeps the typed text.

### Recalculation
- refers-to: src/lib.rs :: recalc, recalc_with, evaluate, recalc_all
- kind: rationale
- logged: v0.7.0 · 2026-10-21

An edit seeds a search for formulas that read the changed cells: single-cell references through a cell index, ranges by a scan of the formulas that use ranges. The dirty set is then ordered so each formula runs after the dirty formulas it reads (Kahn's algorithm; a range's precedents are found by walking its cells when it is smaller than the sheet's dirty set, by checking the dirty set otherwise). Formulas left over form a cycle and get `#REF!`. Opening, renaming, deleting or moving sheets and shifting rows recalculate everything (`recalc_all` skips the search).

### Criteria and lookups
- refers-to: src/eval.rs :: matching, aggregate, find, crit_of, crit_matches, wild_match, lookup_eq
- kind: explainer
- logged: v0.8.0 · 2026-10-21

Criteria take a leading `<=`, `>=`, `<>`, `<`, `>` or `=`; the rest is read as a number, boolean or text, and text matches without case with `*`, `?` and `~` for a literal. An empty criterion matches blank cells and empty text. Number criteria also match number-like text for `=` and `<>`. `matching` walks only the filled cells of the first criteria range, unless the criterion matches blanks and the range has at most 200,000 cells, then filters by the other ranges at the same offsets; the *IFS functions need every range the same shape (`#VALUE!` otherwise), SUMIF and AVERAGEIF read their optional sum range from its top-left cell in the criteria range's shape.

`find` is the one search behind VLOOKUP, HLOOKUP, MATCH, XMATCH and XLOOKUP. Modes: exact; exact with wildcards (VLOOKUP and MATCH exact, XLOOKUP and XMATCH mode 2); sorted ascending, largest at or below the key, stopping at the first larger value (VLOOKUP approximate, MATCH 1); sorted descending (MATCH -1); and exact or next smaller or larger by a full scan (XLOOKUP and XMATCH -1 and 1). Values of another type never match. XLOOKUP returns a single cell, so its return range must be one row or column of the lookup's length; spilling a multi-column result waits for dynamic arrays. Added with them: IFS, SWITCH, CHOOSE. As with the first tranche, results are FormCel's reading and are not yet checked against vendor function pages.

### Dates, times and automatic formats
- refers-to: src/numfmt.rs; src/lib.rs :: Workbook.fmts, parse_with_fmt, shown, present, infer, value; src/eval.rs :: date functions, date_arg
- kind: explainer
- logged: v0.10.0 · 2026-10-21

Dates are serial numbers in the 1900 system: 1 is 1/1/1900, and 60 is the 29 February 1900 that never existed, kept so serials line up with Excel's (checked: 1/1/2025 is 45658, 3/1/1900 is 61, 10/21/2026 is 46316). Times are the fraction of a day. Typed input reads ISO dates, US m/d/yy(yy) (two-digit years 00 to 29 are 2000s), "October 21, 2026", "21-Oct-2026", 24-hour and AM/PM times with optional seconds, and a date followed by a time. A day and month with no year (`5-Jul`, since v0.10.1) takes the current year. An impossible date (2/30/2026) stays text.

The cell keeps the number and `fmts` keeps how it was typed: currency with 0 or 2 decimals, percent, date, time, date with time. It is the smallest piece of number formatting that typing needs; the full format system (Phase 3) will replace it. Formulas take a format from what they compute (DATE, TODAY, EDATE and EOMONTH give a date, NOW a date and time, TIME a time; DATEVALUE and TIMEVALUE give a plain number, as their Microsoft pages show results 40850 and 0.10; a reference copies its cell's format, a date plus or minus a number stays a date, currency survives arithmetic). Every value that leaves the engine (reads, changes, undo, `get`) is shown through its format; `value` gives the bare number; `input` gives the shown text, which parses back to the same number and format, so saving and history need nothing new. Formats move with inserted and deleted rows and with sheet moves and deletes.

TODAY, NOW, RAND and RANDBETWEEN make a formula volatile: every recalculation includes it. The clock comes from the host: the window's worker sets it before each request from the browser's local time, because a WebAssembly build has no system clock; the Python build falls back to the system clock in UTC, which only affects thumbnails. Functions added: DATE, YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, WEEKDAY (types 1, 2, 3, 11 to 17), TODAY, NOW, TIME, DATEVALUE, TIMEVALUE, EDATE, EOMONTH, DAYS.

### Typed input: currency, percent, errors
- refers-to: src/lib.rs :: Value::parse_input
- kind: explainer
- logged: v0.9.0 · 2026-10-21

Besides plain numbers with thousands commas, input now reads `$1,234.50`, `-$5` and `$-5` as numbers, `50%` as 0.5, and an error literal (`#N/A`, `#REF!` and the rest) as that error value. Microsoft's function pages give their example data in these forms and tell the reader to paste it into a sheet, so the conformance run depended on it. The cell keeps only the number; since v0.10.0 the automatic format below brings back the `$` or `%` look.

### Conformance against Microsoft's function pages
- refers-to: src/eval.rs (all functions); sidecar comparison/conformance/
- kind: explainer
- logged: v0.9.0 · 2026-10-21

Every example table on Microsoft's page for each function (data pasted at A1 as the pages say, formula, stated result) was run through this engine: 123 pass, 6 fail, 8 skipped (3 need dates, 5 have their data only in a picture). The 6 failures all need features not built yet: array constants (2), a function returning a reference used as a range end (2), multi-area references (1), INDEX with row 0 (1). The run found two real gaps, both fixed in v0.9.0: typed error values stayed text, and ISNA, ISERR, ISLOGICAL, ISREF and ISNONTEXT were missing. The extraction and runner live in the sidecar (they are research tools, not repo tests); `CONFORMANCE.md` there lists every case.

### The dependency graph is kept between edits
- refers-to: src/graph.rs :: Graph, Fx; src/lib.rs :: ensure_graph, set_raw, recalc_with, evaluate
- kind: rationale
- logged: v0.8.0 · 2026-10-21

`Graph` holds each formula's resolved areas, an index from single cells to the formulas that read them, and 64-row by 16-column buckets for ranges; a range spanning more than 256 buckets (a whole column, say) goes in a short list checked on every change. `set_raw` updates it in place. Anything that can change what a reference points at (adding, renaming, deleting or moving a sheet, a shift) marks it stale and the next recalculation rebuilds it. Maps on this path use `Fx`, a small multiply-rotate hasher, because the standard hasher dominated the profile.

Measured (scratch harness and the window's engine, not shipped): one precedent in a sheet of 100,000 row formulas plus one SUM over them went from 47 ms to 1 to 2 ms native and 2.5 to 6 ms through the window's worker, against the Phase 2 target of 100 ms. A 100,000-step chain (each cell adds 1 to the one above) recalculates all 100,000 cells in 130 ms native and 306 ms through the worker, including sending every changed cell back; that worst case is over the target.

### Array shaping and TEXTSPLIT
- refers-to: src/eval.rs :: call_arg (VSTACK, HSTACK, TOCOL, TOROW, TAKE, DROP, CHOOSECOLS, CHOOSEROWS, WRAPROWS, WRAPCOLS, EXPAND, TEXTSPLIT), split_on; src/formula.rs :: FUNCTIONS (104)
- kind: explainer
- logged: v0.15.0 · 2026-10-21

Rules from each function's Microsoft page:
- VSTACK and HSTACK pad narrower or shorter arrays with `#N/A`.
- TOCOL and TOROW take ignore 0 to 3 (blanks, errors, both) and scan_by_column.
- TAKE and DROP count from the end for negative numbers. Either one with rows or columns of 0 gives `#CALC!`. DROP's page says this too, though it reads as if copied from TAKE's; FormCel follows the page.
- CHOOSECOLS and CHOOSEROWS give `#VALUE!` for 0 or beyond the size, and count from the end for negatives. The numbers may be arrays (`{1,3}`).
- WRAPROWS and WRAPCOLS give `#VALUE!` for a two-dimensional vector and `#NUM!` for wrap_count below 1, and pad with pad_with or `#N/A`.
- EXPAND gives `#VALUE!` when asked to shrink, and pads with pad_with or `#N/A`.
- TEXTSPLIT takes column and row delimiters (text or array constants), ignore_empty, match_mode 1 for case-insensitive, and pad_with (`#N/A` by default). The longest delimiter wins at each position, and results are text.

FormCel's own choices, where the pages say nothing:
- TOCOL and TOROW with ignore outside 0 to 3 give `#VALUE!`; when everything is ignored they give `#CALC!`.
- TAKE beyond the size returns the whole array.
- DROP of everything gives `#CALC!`.
- TEXTSPLIT with an empty delimiter, or neither delimiter given, gives `#VALUE!`.

The pages show results as pictures, so the conformance run gains no cases. Instead, all 44 examples on the twelve pages were run on the page's own data with its formula (`stackexamples.py` in the sidecar's tools), and each result was compared with the sentence describing it. 41 agree. Three contradict their own pages:
- VSTACK and HSTACK example 1 reference `E2:G3` while the data sits in D:F.
- WRAPCOLS example 1 wraps `A2:F2` (six values) while the description speaks of two `#N/A` pads, which seven values would give.

18 error cases from the pages' Errors sections pass (`stackerrors.py`).

### FILTER, SORT, SORTBY, UNIQUE and the LAMBDA helpers
- refers-to: src/eval.rs :: call_arg (FILTER, SORT, SORTBY, UNIQUE, MAP, REDUCE, SCAN, BYROW, BYCOL, MAKEARRAY), lambda, apply, transposed, pick_rows, sort_key; SUMSQ in call
- kind: explainer
- logged: v0.13.0 · 2026-10-21

All ten return arrays through `call_arg`, so they spill, and they nest (`SUM(SORT(FILTER(...)))`). The arguments and the error cases come from each function's Microsoft page:
- FILTER gives `#CALC!` when nothing is included and there is no if_empty. An error in include is returned, and include must match the array's height (it keeps rows) or width (it keeps columns), otherwise `#VALUE!`.
- SORT takes sort_index, sort_order (1 or -1, anything else `#VALUE!`) and by_col. SORTBY takes pairs of by_array and order; every by_array must be one column of the array's height, or one row of its width, all the same way.
- UNIQUE takes by_col and exactly_once.
- MAP needs one LAMBDA parameter per array and takes its shape from the first array. REDUCE and SCAN take an optional initial value.
- BYROW and BYCOL give `#CALC!` when the second argument is not a LAMBDA or a row's result is more than one value, and `#VALUE!` for a LAMBDA with the wrong number of parameters. MAKEARRAY gives `#VALUE!` for a size below 1 or not a number.

Choices that are FormCel's own, not checked against Excel:
- Sorting is stable and uses the comparison operators' order (numbers, then text without case, then TRUE and FALSE), with blanks and then errors last.
- UNIQUE compares cells as `=` does, case-insensitively.
- `REDUCE(, A1:C2, ...)` (a blank first argument) starts from an empty value, which counts as 0, while `REDUCE(A1:C2, ...)` (two arguments) starts from the first element, as the page's note says. The page's own "sum the squared values" example needs the blank to count as 0.
- SORT with an array of sort indexes is not built.

None of the ten pages has a Formula and Result table (their results are pictures), so the conformance run gains only SUMSQ's case. Instead, 29 cases were worked by hand and checked in a scratch harness (`arraycheck.py` in the sidecar's tools): filters by row and by column, empty results with and without if_empty, wrong-size include, sorts by index and direction, SORTBY on two keys, UNIQUE by rows, columns and exactly once, MAP over one and two arrays, REDUCE with a value, a blank and no initial value, SCAN on numbers and text, BYROW and BYCOL with each error case, MAKEARRAY and its size error, and a FILTER inside SUM.

### Names, LET and LAMBDA
- refers-to: src/formula.rs :: Expr::Invoke, FUNCTIONS, names, valid_name, is_r1c1; src/eval.rs :: Ctx::name, Lambda, Arg::F, Eval::new, local, user, routed, deeper, named, invoke, scoped; src/lib.rs :: names, define_name, names(), expr_areas; formcel-wasm fc_define_name, fc_names; formcel-py define_name, names
- kind: explainer
- logged: v0.12.0 · 2026-10-21

Workbook names map a name to a formula (`=Sheet1!$A$1:$A$3`, `=0.2`, `=LAMBDA(x,x*x)`). Name rules follow Microsoft's "Names in formulas" page: the first character is a letter, underscore or backslash; the rest are letters, digits, periods and underscores; at most 255 characters; not C or R; not a cell reference in A1 or R1C1 form; case-insensitive. TRUE and FALSE are refused too, from Google's named-range page. Every name is workbook-scoped; sheet-scoped names are not built. LET and LAMBDA parameters use the same rule except that C and R are allowed (`valid_local`), because Microsoft's MAKEARRAY page itself writes `LAMBDA(r,c,r*c)` (corrected in v0.13.0; v0.12.0 refused them).

A name is looked up when a formula uses it as a value or calls it. Lookup order is LET and LAMBDA locals (innermost first), then workbook names, then `#NAME?`. Built-in functions win over both: a call to a name in `FUNCTIONS` (sorted, binary-searched) never looks anything up, so names cost nothing on ordinary formulas. A name's formula is evaluated with no locals in scope, on the calling formula's sheet. LAMBDA builds a function value (`Arg::F`) that captures the locals it was made in. Calling it with the wrong number of arguments gives `#VALUE!`, a formula whose result is an uncalled LAMBDA gives `#CALC!` (both as Microsoft's LAMBDA page says), and recursion deeper than 200 calls gives `#NUM!` (the page says too many recursive calls can return `#NUM!`; the limit of 200 is FormCel's). `LAMBDA(x,x+1)(1)` parses as `Expr::Invoke`.

The parser now uppercases only the names of built-in functions, so `=Sq(3)` keeps the case it was typed in and `=sum(a1)` still becomes `=SUM(A1)`. A formula that uses a name depends on the cells the name's formula reads, including names used inside it (`expr_areas`, with a seen list against loops). Defining, changing or removing a name rebuilds the graph and recalculates the workbook. Inserting or deleting rows and columns rewrites references inside names, and so does renaming a sheet. Names are not part of undo, and a shift's undo moves them back only by shifting again.

Measured on the Python build (scratch harness): with 100,000 `=ABS(A1)*2` formulas, one edit takes 6.5 ms with or without names defined. Defining a name recalculates everything: 216 ms with no other names, 348 ms with two (the graph rebuild walks every formula for names). Recalculating 100,000 calls to a named LAMBDA took 369 ms.

Conformance: the runner now reads "Define the following in the Name Manager: Name: ... Refers to: ..." blocks on a page and defines those names before running its tables. With the LET, LAMBDA, SEQUENCE, TRANSPOSE and SUBSTITUTE pages added: 175 pass, 5 fail. All 5 are THANKSGIVINGDATE, which needs TEXT, which needs the Phase 3 number formats.

### Dynamic arrays and spilling
- refers-to: src/formula.rs :: Expr::Array, Expr::Range, Expr::Union, ErrKind::Spill, ErrKind::Calc; src/eval.rs :: Array, Out, Arg::A, Src, grid, lift, call_arg; src/lib.rs :: spills, spilled, touched, recalc_with, recalc_pass, spill, unspill, unspill_all
- kind: explainer
- logged: v0.11.0 · 2026-10-21

The parser reads array constants (`{1,2;3,4}`), the range operator between any two references (`A2:INDEX(...)`, `A2:CHOOSE(...)`) and a parenthesised union (`(A1:C6, A8:C11)`, used by INDEX's area number). The evaluator passes one of three things: a value, a reference, or an array. Operators and unary minus or percent applied to a range or array work element by element, broadcasting a single row or column, with `#N/A` where the shapes do not cover each other. IF, CHOOSE and INDEX return references (so `SUM(A2:INDEX(A2:C6,5,2))` sums a range), INDEX takes row or column 0 for a whole column or row and four arguments with an area number, and SEQUENCE and TRANSPOSE build arrays. Lookups (VLOOKUP, HLOOKUP, MATCH, XMATCH, XLOOKUP) read either a range or an array through `Src`.

A formula whose result has more than one cell spills: the anchor holds the top-left value and the rest go into the cells to the right and below. If any of those holds a value or a formula, or the block runs off the grid, the anchor shows `#SPILL!` and nothing spills; clearing the blocker spills it again, because each recalculation looks up the spill blocks that contain the changed cells and reseeds their anchors. Spilled cells are not inputs: `input` and `inputs` skip them (so they are not saved and undo does not record them), and `formula_text` gives them an empty formula so the window shows an empty formula bar and saves nothing. Spill cells are not in the dependency graph, so `recalc_with` repeats a pass seeded with the cells a spill wrote or cleared, up to 8 passes (a spill that feeds itself stops there). Shifting rows or columns and deleting or moving a sheet clear every spill first and the full recalculation that follows rebuilds them, so a shift never records spilled values as dropped input. Arrays over 2,000,000 cells give `#VALUE!`; SEQUENCE with zero rows or columns gives `#CALC!`.

Known limits: the graph only knows a range-operator reference by its two ends, so `A1:INDEX(C5:D6,...)` is not recalculated when a cell between them (B2, say) changes; finding the anchors for a changed cell scans every spill block, which is fine for tens of spills and slow for thousands. Conformance after this slice: 159 pass, 0 fail (the 6 earlier failures were the cases this slice covers; the runner now strips the U+2060 word joiners Microsoft's INDEX page puts inside formulas).

### References under insert, delete and rename
- refers-to: src/formula.rs :: shift_refs, rename_refs, offset; src/lib.rs :: do_shift, Tx::Shift
- kind: explainer
- logged: v0.7.0 · 2026-10-21

Inserting rows or columns moves every reference at or after the insert point, on any sheet, that points at the shifted sheet; a range that straddles it grows. Deleting moves references after the deleted band back, trims ranges that overlap it, and turns references wholly inside it into `#REF!`. `Tx::Shift` keeps the text of every formula it rewrote and the input of every cell it dropped, so undo restores them exactly. Renaming a sheet rewrites references to the old name. Deleting a sheet leaves references to it as names that no longer resolve, so they evaluate to `#REF!`. `offset` moves the relative parts of references (those without `$`) for the fill handle; a reference pushed off the grid becomes `#REF!`.

### Values and functions
- refers-to: src/eval.rs; src/lib.rs :: Value::Error, Display
- kind: explainer
- logged: v0.7.0 · 2026-10-21

`Value` gains `Error`. Numbers display rounded to 15 significant digits (`0.1+0.2` shows 0.3). Arithmetic turns empty cells into 0, booleans into 1 and 0, and number-like text into numbers; anything else is `#VALUE!`. Unary minus binds tighter than `^`, so `-2^2` is 4. Aggregates (SUM, AVERAGE, MIN, MAX, PRODUCT, COUNT) count only numbers inside ranges and also coerce directly typed arguments. Comparison orders numbers before text before booleans and compares text without case. First tranche: IF, IFERROR, IFNA, SUM, PRODUCT, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTBLANK, AND, OR, XOR, NOT, TRUE, FALSE, ABS, INT, SQRT, POWER, MOD, PI, ROUND, ROUNDUP, ROUNDDOWN, LEN, UPPER, LOWER, TRIM, LEFT, RIGHT, MID, CONCAT, CONCATENATE, ISBLANK, ISNUMBER, ISTEXT, ISERROR, NA. Unknown functions and names give `#NAME?`. A range used where one value is expected gives `#VALUE!` unless it is a single cell; since v0.11.0 a formula that is a range or array spills instead (see Dynamic arrays and spilling). None of these behaviours has been checked against a vendor function page yet: that is the conformance workbook in the Phase 2 exit criterion.

### Per-cell number formats
- refers-to: src/lib.rs :: set_format, codes, meta, const_text, Tx::Formats; src/wire.rs :: encode_formats; src/fmtcode.rs :: Class
- kind: explainer
- logged: v0.18.0 · 2026-10-21

A cell's format code lives in `codes`, keyed like a cell and holding the parsed code behind an `Arc` so a range shares one parse (the Python build needs `Send`, hence not `Rc`). An empty code or `General` clears it. `set_format` clips a whole-column or whole-sheet selection to the used range plus 1,000 rows and 26 columns, refuses more than 1,000,000 cells, and records `Tx::Formats` with the old codes so undo restores them. Codes move with insert and delete like cells do. A cell with a Text-class code (`@`) keeps what was typed as text, formulas included. `const_text` gives the input of a formatted constant in a form that reads back to the same value: a date or time code gives the date typed in the usual form, a percent code gives the number times 100 and `%`. `meta` sends that input in the wire's formula field for formatted constants, so the window's editor, formula bar and saves get the input and never the shown text (saving `26%` for 0.256 would lose digits). The wire's third field is now flags, `n` for a number, which the window uses for right alignment instead of guessing from the text. Effects carry `%` lines, one per changed code. Colours in a code (`[Red]`) are parsed and returned by `render` but not sent yet.

### Cell styles
- refers-to: src/style.rs :: Style, apply, text; src/lib.rs :: set_styles, apply_styles, styles_in, load_styles, clip, Tx::Styles, meta; src/wire.rs :: encode_styles, Meta
- kind: explainer
- logged: v0.19.0 · 2026-10-21

A style is font (bold, italic, underline, strikethrough, size in points, family, colour), fill, horizontal and vertical alignment, indent (0 to 15 steps), wrap, and four borders (thin, medium, thick, dashed, dotted, double, each with a colour). It is written as `;`-separated tokens in one fixed order, so equal styles have equal text: `b;i;sz:14;fc:ff0000;bg:ffff00;ha:center;va:top;wrap;in:2;bt:thin:000000`. A patch uses the same tokens; `!b` turns a flag off, an empty value (`fc:`) clears a setting, `in:+1` and `in:-1` step the indent, and `clear` resets the style. `set_styles` takes several rectangles with patches and applies them in order as one undo step, so Outside borders (four edge patches) undoes at once. Rectangles are clipped like number formats. A style that ends up plain is removed. Styles move with insert, delete and sheet changes like codes. The window reads styles for a rectangle with `styles_in`, separately from values, because an empty cell can have a fill or borders. Effects carry `&` lines. The flags field of a value line now also carries `c` and six hex digits when the cell's number format gives the value a colour. The eight code colours use the plain RGB values (`[Green]` is 00ff00); MS-NUMGUIDE names them but gives no values, so the values are FormCel's.

### Merges, grouped undo and carried formats
- refers-to: src/lib.rs :: Sheet.merges, merge, MergeMode, shift_area, Tx::Merges, Tx::Group, group_since, undo_mark, undo_group, put_formats, formats_in, inherit, Lost; src/style.rs :: rot, vertical
- kind: explainer
- logged: v0.20.0 · 2026-10-21

Merged areas live on their sheet, so moving and deleting sheets carries them. `merge` keeps only the upper-left value, as MS-MERGE states, clears the rest, replaces any merge it overlaps, and for Merge and Center also centers the upper-left cell; the clearing, the merge and the style land as one undo step through `Tx::Group`. Merge Across makes one merge per row. A one-cell result is never stored. Inserting inside a merge grows it, deleting through it shrinks it, and a merge cut to one cell is dropped. `Tx::Shift` now keeps the sheet's merges and the codes and styles of deleted rows or columns (`Lost`), so undoing a delete brings formatting back; before v0.20.0 it brought back only values. Inserted rows and columns take the codes and styles of the row above or the column to the left (FormCel's rule, after Excel's default; no vendor page fetched states it). `put_formats` sets style and code cell by cell as one step, for the format painter, the fill handle and paste. `undo_mark` and `undo_group` let the window join the steps of one action (fill plus its formats, Clear formats); if the 500-step history drops its oldest step in between, the group takes one step more than it should. Effects carry `=\tsheet` when a sheet's merges changed. Rotation is `rot:N` for -90 to 90 degrees (positive turns up, as MS-ROTATE states) or `rot:v` for stacked vertical text; the ±90 limit is FormCel's, since the page names a degrees box without its range.

### Cell styles, themes and paste support
- refers-to: src/theme.rs; src/style.rs :: Paint, Cats, named, normalize, clear, overlay; src/lib.rs :: define_style, delete_style, apply_style, effective_style, code_of, set_theme, Tx::Theme, Tx::Named, values_in, encode, parse_plain
- kind: explainer
- logged: v0.21.0 · 2026-10-21

A named cell style is a style plus an optional number format and the parts it includes (number, alignment, font, border, fill), as MS-STYLE describes. A cell links to one with `cs:Name`; what the cell shows is the named style with the cell's own settings on top (`effective_style`), and its number format falls back to the style's (`code_of`), so changing a style changes every cell that uses it. Applying a style clears the cell's own settings in the parts the style includes and keeps the rest; Normal clears everything and the link. Bold, italic, underline, strikethrough and wrap are now three-state, so a cell can turn bold off over a bold style (`!b`); without a link the off state is dropped. New and updated styles are taken from one cell by example. Deleting a style removes it from every cell, in one undo step; Normal cannot be deleted. The built-in set (Good, Bad, Neutral, Title, Heading 1 to 4, Total, Input, Output, Calculation, Note, Warning Text, Accent 1 to 6, Comma, Currency, Percent) is modelled on Excel's gallery; MS-STYLE names only Normal and Good, Bad and Neutral, so the set, its colours and its formats are FormCel's. A theme has ten colours (dk1, lt1, dk2, lt2, accent1 to 6) and heading and body fonts; colours in styles can name a slot with a tint (`t:accent1:40`), and the five built-in themes (FormCel, Slate, Forest, Ember, Mono) are FormCel's. Theme and style changes undo. Effects carry `^` for a theme change and `@` for a style list change, and style lines carry the effective style after the stored one. A leading apostrophe now makes typed input text, as in Excel, and the input of a text cell that would otherwise read as a number keeps it. `values_in` gives stored values for Paste Values, text marked with the apostrophe.

### Conditional formatting
- refers-to: src/cf.rs :: Rule, Kind, Point, cf_in, set_rules, load_rules; src/lib.rs :: Sheet.rules, Tx::Rules, shift_span, Lost.rules; src/eval.rs :: compare
- kind: explainer
- logged: v0.22.0 · 2026-10-21

Rules live on their sheet in precedence order, highest first, as MS-CF's Rules Manager lists them. Kinds: cell value comparisons (greater, less, at least, at most, equal, not equal, between and not between, inclusive; a value starting with `=` is a formula moved like the cell), text contains, does not contain, begins and ends with the `?` and `*` wildcards from GS-CF, ten date periods, duplicate and unique values (ignoring case), top and bottom N items or percent, above and below average, blanks and errors, formula rules written for the first cell of the range with references moved for the rest (GS-CF's two examples are in the engine check), two- and three-colour scales with lowest, highest, number, percent and percentile points from MS-CF, data bars that start from an axis when the range has negatives, and icon sets of 3 to 5 icons cut at equal percents of the range. `cf_in` paints a rectangle: rules run in order; when two set the same property the higher one wins, when they do not both apply, and Stop If True ends the cell's evaluation, as MS-CF describes. Cells holding an error get no formatting except from error and formula rules (MS-CF's tip). Percent cut-offs for icons and the top-N percent rounding down with a minimum of one are FormCel's choices. Rules move with inserted and deleted rows and columns and come back on undo; references inside rule formulas do not move yet. Each paint scans the rule's whole range for the rules that need it (duplicates, ranks, averages, scales, bars, icons): about 70 ms for a duplicate rule on 100,000 rows, which Phase 8 can cache.

### Links
- refers-to: src/link.rs :: clean, detect, set_link, remove_links, auto_links, link_at, has_link, take_link_changes; src/eval.rs :: HYPERLINK; src/lib.rs :: links, Tx::Links, apply, meta
- kind: explainer
- logged: v0.23.0 · 2026-10-21

HYPERLINK(link_location, [friendly_name]) shows the friendly name, or the link when it is left out (MS-HYPERLINK); a friendly name that is an error shows the error; one that points at an empty cell shows the link, and an empty string shows nothing but keeps the link (GS-HYPERLINK). Its target is read from the formula when asked (`link_at`), so a link built from another cell follows that cell. A cell can also hold a link of its own, set with Insert link (text to display plus target, one undo step), or made when a web address or an email address is typed, as MS-LINKS and GS-HYPERLINK describe; typing over a linked cell keeps the link, clearing it removes the link (MS-LINKS: Delete), and Remove link keeps the text (MS-LINKS: Remove Hyperlink). FormCel links http, https, mailto and ftp addresses and places in the workbook written `#Sheet2!A1`, `#A10` or `#Name`; any other scheme is not linked, after GS-HYPERLINK's allowed list; `www.` and bare domains get http, addresses with `@` get mailto. Links move with inserted and deleted rows and columns and come back on undo. The wire's flags gain `l` for a linked cell. `take_link_changes` hands the window every link change since the last call, so it can save them; the engine process never detects links itself, so a reload never brings back a link that was removed.

### Saved text of dated cells
- refers-to: src/lib.rs :: const_text
- kind: explainer
- logged: v0.24.0 · 2026-10-21

A number in a cell with a date or time code is saved and edited as date or time text (`3/4/2026 4:36:03 PM`), as Excel's formula bar shows it. That text keeps whole seconds only, so a value with a fraction of a second, such as an elapsed `[ss].00` time, came back rounded after a save. The text is now used only when reading it back gives the same number; otherwise the plain number is kept. Found by the Formatting check template.

### Typed cells for writing files
- refers-to: src/lib.rs :: typed, auto_formats; crates/formcel-py/src/lib.rs :: typed, auto_formats, reads_as_text
- kind: explainer
- logged: v0.25.0 · 2026-10-21

`typed` lists each stored cell with its kind (`f` formula, `n` number, `t` text, `b` TRUE or FALSE, `e` error) and its plain text, numbers in full precision, so a file writer never has to read numbers back from shown text. `auto_formats` gives the codes for the formats FormCel picked up from typing (currency and percent with their decimals, date, time, date and time), for cells with no code of their own. `reads_as_text` says whether FormCel would keep a typed string as text.

### Text that starts with =
- refers-to: src/lib.rs :: const_text, meta
- kind: explainer
- logged: v0.26.0 · 2026-10-21

Text that starts with `=` (typed as `'=1+1`, or from a CSV file) was saved and shown in the edit bar without its apostrophe, so reopening the workbook turned it into a formula. Such text now gets the apostrophe back, like text that would read as a number.

### Formula results for file writers
- refers-to: src/lib.rs :: results; crates/formcel-py/src/lib.rs :: results
- kind: explainer
- logged: v0.27.0 · 2026-10-21

`results` lists each formula's current value with its kind, the way `typed` lists stored cells, so the .ods writer can store a formula's result next to it.

### The spilled range operator and implicit intersection
- refers-to: src/formula.rs :: Tok::Hash, Tok::At, Expr::Spill, Expr::Single, lex, unary, print, children, walk_mut; src/eval.rs :: Ctx::spill, Eval::placed, single, arg; src/lib.rs :: Ctx::spill, the recalc loop
- kind: explainer
- logged: v0.28.0 · 2026-10-21

`A1#` is the whole spill of the formula in A1 (MS-SPILLOP), with or without a sheet name; `#` after a cell reference is the operator, while `#` followed by a letter still starts an error such as #REF!. When A1 does not hold a spill the result is #REF!. A formula using `A1#` depends on A1, so it recalculates when the spill grows or shrinks, and the reference moves with inserted and deleted rows like any other.

`@` is implicit intersection, after MS-IMPLICIT: a single value stays itself; a range gives the cell on the formula's own row (for a column range) or column (for a row range), and #VALUE! when there is none; an array gives its top-left value. To know its own row and column, evaluation now carries the formula's cell (`Eval::placed`); rules, links and names evaluate without one, so a range under `@` there needs to be a single cell.

### ARRAYFORMULA
- refers-to: src/formula.rs :: FUNCTIONS; src/eval.rs :: ARRAY_FNS, call_arg
- kind: explainer
- logged: v0.29.0 · 2026-10-21

ARRAYFORMULA(array_formula) (GS-ARRAYFORMULA) returns its argument. Its job in Sheets is to let a formula work over ranges and show the result in neighbouring cells; every FormCel formula does that already, so it adds nothing but keeps formulas from Sheets working. 109 functions.

### Sorting rows
- refers-to: src/sort.rs :: SortKey, rank, order, region, guess_header, sort; crates/formcel-wasm/src/lib.rs :: fc_sort, fc_region, fc_guess_header; crates/formcel-py/src/lib.rs :: sort, region
- kind: explainer
- logged: v0.30.0 · 2026-10-21

`sort` reorders the rows of a rectangle by one or more columns (MS-SORT: Add Level, Then by; Sort A to Z and Z to A; My data has headers; case sensitive under Options), as one undo step. Whole rows of the rectangle move: values, formulas, number format codes, cell styles and links. A formula's relative references move with its row, as a pasted formula's would, so `=B2*2` sorted into row 5 reads `=B5*2`. Conditional formatting stays where it is, as it belongs to the range, not the row. Ties keep their order (a stable sort), so sorting by one column and then by another gives the second as the main order.

Order, smallest first: numbers, then text (case blind, unless case sensitive is asked, when a lowercase letter comes before its capital), then FALSE and TRUE, then errors, and blank cells last in both directions. MS-SORT does not state this order; it is the one FormCel's SORT function already uses, with logical values after text, and blanks always last as Excel shows them. A rectangle that holds merged cells is refused (the window says to unmerge first). A whole-column selection is cut to the sheet's used range.

`region` is the block of data around a cell: the rectangle grows while any cell touching its edge, corners included, holds a value. A one-cell selection sorts its region. `guess_header` says the first row is a header when its filled cells are all text and something below it is not, or when it is bold and the next row is not; FormCel's rule, which the custom sort dialog shows as a ticked box that can be changed. Sorting 100,000 rows of five columns by two keys takes about 2.5 seconds in the engine process's build.

### Filters
- refers-to: src/filter.rs :: Crit, Filter, parse, text, shifted, cond, set_filter, load_filter, reapply_filter, passes, hidden_by, filter_values, filter_colors; src/lib.rs :: Sheet.filter, Tx::Filter, Effect.filter, do_shift; src/wire.rs :: `~` line; crates/formcel-wasm/src/lib.rs :: fc_filter, fc_set_filter, fc_load_filter, fc_reapply_filter, fc_filter_values; crates/formcel-py/src/lib.rs :: filter, load_filter, set_filter, reapply_filter, filter_values
- kind: explainer
- logged: v0.31.0 · 2026-10-21

A sheet has at most one filter: a rectangle whose first row holds the filter buttons, a criterion per column, and the rows the filter hides. The hidden rows are worked out when a filter is set or reapplied and kept, not recomputed when values change; MS-FILTER says to reapply a filter after the data changes, and FormCel follows that. Rows a filter hides are kept apart from rows hidden by hand.

Criteria (MS-FILTER: values, Text Filters, Number Filters, Filter by Color; GS-SORT: by values, by condition, by colour):
- values: keep rows whose shown text (as formatted) is in the list, case blind, and blank rows when Blanks is ticked.
- cond: one or two conditions joined by And or Or. eq and ne match the shown text with `?`, `*` and `~` wildcards, or a number exactly when both sides are numbers; gt, ge, lt and le compare numbers with numbers and text with text, and never match a blank; begins, ends, contains and their negations are wildcard matches with `*` added.
- top: the largest or smallest N items or N percent of the numbers in the column, ties kept.
- avg: numbers above or below the column's mean.
- fill and font: the cell's fill or text colour as a paint (`ffff00`, `t:accent1:-25`), with conditional formatting colours on top; `none` and `auto` for no fill and automatic text.

The text form is `area\tr0,c0,r1,c1`, then `col\tC\tkind\t...` lines (fields escaped as on the wire), then `hidden\t1,4-9`. The value list for a column comes from the rows the other columns' criteria let through, sorted as Sort sorts, and stops at 10,000 different entries (MS-FILTER: the first 10,000 unique entries); `m` says it stopped. Reapply also takes in rows added directly below the rectangle. Inserting or deleting rows and columns moves the filter, its columns and its hidden rows; deleting the last column with a criterion shows every row. Setting, clearing and reapplying are undo steps. Filtering 100,000 rows on a condition takes about 0.1 seconds.

### Data validation
- refers-to: src/valid.rs :: Validation, parse, line, With, carve, set_validation, load_validations, validation_at, check_input, allowed, list_items, invalid_in; src/eval.rs :: Eval::listed; src/lib.rs :: Sheet.valid, Tx::Valid, Effect.valid, do_shift; src/wire.rs :: `?` line; crates/formcel-wasm/src/lib.rs :: fc_validations, fc_set_validation, fc_load_validations, fc_validation_at, fc_check_input, fc_list_items, fc_invalid_in; crates/formcel-py/src/lib.rs :: validations, load_validations, set_validation, check_input, list_items, invalid_in
- kind: explainer
- logged: v0.32.0 · 2026-10-21

A rule covers a rectangle and holds what MS-VALID's three tabs hold: Allow (any, whole, decimal, list, date, time, length, custom), Data (between, notbetween, eq, ne, gt, lt, ge, le), the two values, Ignore blank, In-cell dropdown, the input message with its title, and the error alert with its style (stop, warning, info), title and message; messages are cut at 225 characters (MS-DROPDOWN). The line form is `r0,c0,r1,c1\tkind\top\ta\tb\tflags\tstyle\tprompt title\tprompt\terror title\terror` with flags `b`, `d`, `p`, `e`. Giving a rectangle a rule (or none) first cuts the rectangle out of every other rule, so a cell has at most one; it is one undo step, and rules move with inserted and deleted rows and columns.

Values may be formulas (`=$F$1`, `=TODAY()+3`, `=E1*6%`). Relative references are written for the rule's top-left cell and move with each cell, as MS-VALID's COUNTIF example says ("enter the data validation formula for cell A2 first"). A blank value counts as 0. `check_input` works out the value an input would have (formulas computed, text-formatted cells kept as text, a leading apostrophe kept as text) and tests it: whole needs a number with no fraction, decimal, date and time a number, length the length of the value as text, list a match with an item (numbers as numbers, text case blind; FormCel's reading), custom a formula that is TRUE or a non-zero number, evaluated with the new value standing in its own cell so `=COUNTIF($A$2:$A$10,A2)=1` and `=ISNUMBER(FIND("@",B4))` work as on the page. An empty input is not checked, and blank values pass when Ignore blank is ticked. A list's items come from comma-separated text or a range or formula, blanks left out, repeated items once, at most 10,000.

### FIND and SEARCH
- refers-to: src/eval.rs :: call "FIND" | "SEARCH"; src/formula.rs :: FUNCTIONS
- kind: explainer
- logged: v0.32.0 · 2026-10-21

FIND(find_text, within_text, [start_num]) and SEARCH(find_text, within_text, [start_num]) give the position of the first match at or after start_num. FIND matches case (Microsoft's FIND page is retired; its syntax and behaviour are on MS-FINDERR, "How to correct a #VALUE! error in FIND/FINDB and SEARCH/SEARCHB functions", and Google's FIND page); SEARCH ignores case and takes `?`, `*` and `~` (MS-SEARCH). Not found, start_num below 1 or past the end of the text give #VALUE!. An empty find_text gives start_num; FormCel's reading. 111 functions. The Microsoft SEARCH examples pass except one that also needs REPLACE, which FormCel does not have yet.

### Tables and structured references
- refers-to: src/table.rs :: Table, STYLES, unique_names, tables, load_tables, table_at, resolve_table, file_formula, plain_formula, create_table, set_table, remove_table, table_hook, rename_table_refs, rename_col_refs, shift_tables, quiet_apply; src/formula.rs :: Tok::Bracket, Expr::Table, TableSpec, ITEM_*, parse_spec, print_spec, tables_in, has_table; src/eval.rs :: Ctx::table_ref, Ctx::filtered, Ctx::subtotal_at; src/lib.rs :: Workbook.tables, table_quiet, Tx::Tables, Effect.tables, areas_of, apply, do_shift; src/wire.rs :: `*` line
- kind: explainer
- logged: v0.33.0 · 2026-10-21

A table (MS-TABLES) is a named rectangle on a sheet: a header row, data rows and an optional total row, with column names, a style and the Table Style Options of MS-TABLEFMT (banded rows and columns, first and last column, filter button). Names follow MS-STRUCTREF's rules (`formula::valid_name`, unique across tables and workbook names, case blind); new tables are Table1, Table2 and so on. Column names come from the header cells, blanks become ColumnN and repeats get 2, 3 added (FormCel's reading of how Excel numbers them). With "My table has headers" cleared, FormCel inserts a row above the range for Column1, Column2 headers. A table keeps a header row in this release.

Structured references are lexed as a bracket group and parsed into `TableSpec`: the items #All, #Data, #Headers, #Totals and #This Row (`@`), and a column or column range, with `'` escaping `[ ] # ' @` in names, as MS-STRUCTREF and GS-TABLEREF give them. A reference without a table name means the table the formula is in. They print back in the short form, `[@[Sales Amount]]`, `DeptSales[Sales Amount]`, `Table1[[#Headers],[Region]:[Total]]`; `file_formula` writes the long, fully qualified form `Table1[[#This Row],[Qty]]` that files carry. #This Row outside the data rows is #VALUE!; #Totals or #Headers a table lacks is #REF!; MS-STRUCTREF's "returns null" is read as #REF!. The dependency graph resolves each reference to its range when it is built, and every table change rebuilds it.

Typing in the row directly below a table without a total row, or the column directly right of it, takes that row or column into the table (MS-RESIZE); a new column is named from what was typed in the header row, else ColumnN. A formula typed into a column whose other data cells are empty, or into a calculated column, fills the whole column and is remembered, so new rows get it (MS-CALCCOL). Editing a header renames the column in every structured reference; renaming the table does the same (MS-STRUCTREF). Turning the total row on uses the row below, inserting one if it is not empty, and puts Total in the first column; turning it off clears the row and remembers its formulas for next time (MS-TOTALROW). Convert to range rewrites the table's references as absolute A1 references (MS-STRUCTREF, MS-TOCONVERT). A new table also gets the sheet's filter buttons when the sheet has no filter. All of these are one undo step each; internal edits run with `table_quiet` so they do not set off the growth and calculated-column rules themselves.

SUBTOTAL(function_num, ref1, ...) follows MS-SUBTOTAL: 1 to 11 and 101 to 111 for AVERAGE, COUNT, COUNTA, MAX, MIN, PRODUCT, STDEV, STDEVP, SUM, VAR, VARP; rows hidden by a filter are always left out, as are cells holding SUBTOTAL themselves. The engine does not know rows hidden by hand, so 101 to 111 count them like 1 to 11 for now. 112 functions.

### SPARKLINE
- refers-to: engine/crates/formcel-core/src/fx_chart.rs :: call_chart, sparkline
- kind: explainer
- logged: v0.34.0 · 2026-10-21

`SPARKLINE(data, [options])` follows the Google Sheets function (GS-SPARKLINE): options are a two-column array of name and value ("charttype" line, bar, column or winloss; "color", "negcolor", "ymin", "ymax", "max", "min", "linewidth"). The value is a text marker, U+E000 then SPK and tab-separated fields, that the window draws as a mini chart in the cell. Non-numbers in the data are gaps; a range with no numbers is #VALUE!. FormCel's reading: colour names are a small fixed set plus hex.
