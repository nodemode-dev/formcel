# HASHOUT_LOG · engine · formcel

Living log of comment content and rationale for the Rust engine. Source stays near comment-free; it lives here.

Current build version: v0.3.0
Last updated: 2026-10-21 · load, sheets

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

An edit seeds a search for formulas that read the changed cells: single-cell references through a cell index, ranges by a scan of the formulas that use ranges. The dirty set is then ordered so each formula runs after the dirty formulas it reads (Kahn's algorithm; a range's precedents are found by walking its cells when it is smaller than the sheet's dirty set, by checking the dirty set otherwise). Formulas left over form a cycle and get `#REF!`. Opening, renaming, deleting or moving sheets and shifting rows recalculate everything (`recalc_all` skips the search). Every call rebuilds the dependency lists from the formulas; making that incremental is part of the Phase 2 exit target of 100 ms after one precedent changes in a 100,000-formula sheet, which has not been measured yet.

### References under insert, delete and rename
- refers-to: src/formula.rs :: shift_refs, rename_refs, offset; src/lib.rs :: do_shift, Tx::Shift
- kind: explainer
- logged: v0.7.0 · 2026-10-21

Inserting rows or columns moves every reference at or after the insert point, on any sheet, that points at the shifted sheet; a range that straddles it grows. Deleting moves references after the deleted band back, trims ranges that overlap it, and turns references wholly inside it into `#REF!`. `Tx::Shift` keeps the text of every formula it rewrote and the input of every cell it dropped, so undo restores them exactly. Renaming a sheet rewrites references to the old name. Deleting a sheet leaves references to it as names that no longer resolve, so they evaluate to `#REF!`. `offset` moves the relative parts of references (those without `$`) for the fill handle; a reference pushed off the grid becomes `#REF!`.

### Values and functions
- refers-to: src/eval.rs; src/lib.rs :: Value::Error, Display
- kind: explainer
- logged: v0.7.0 · 2026-10-21

`Value` gains `Error`. Numbers display rounded to 15 significant digits (`0.1+0.2` shows 0.3). Arithmetic turns empty cells into 0, booleans into 1 and 0, and number-like text into numbers; anything else is `#VALUE!`. Unary minus binds tighter than `^`, so `-2^2` is 4. Aggregates (SUM, AVERAGE, MIN, MAX, PRODUCT, COUNT) count only numbers inside ranges and also coerce directly typed arguments. Comparison orders numbers before text before booleans and compares text without case. First tranche: IF, IFERROR, IFNA, SUM, PRODUCT, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTBLANK, AND, OR, XOR, NOT, TRUE, FALSE, ABS, INT, SQRT, POWER, MOD, PI, ROUND, ROUNDUP, ROUNDDOWN, LEN, UPPER, LOWER, TRIM, LEFT, RIGHT, MID, CONCAT, CONCATENATE, ISBLANK, ISNUMBER, ISTEXT, ISERROR, NA. Unknown functions and names give `#NAME?`. A range used where one value is expected gives `#VALUE!` unless it is a single cell; spilling arrays come with dynamic arrays later in Phase 2. None of these behaviours has been checked against a vendor function page yet: that is the conformance workbook in the Phase 2 exit criterion.
