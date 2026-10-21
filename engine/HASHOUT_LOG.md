# HASHOUT_LOG · engine · formcel

Living log of comment content and rationale for the Rust engine. Source stays near comment-free; it lives here.

Current build version: v0.1.0
Last updated: 2026-10-21 · scaffold

---

## Org-navi-map

```
engine/
├── Cargo.toml                       workspace, release profile sized for wasm
├── build_wasm(.bat)                 builds formcel-wasm, copies it to frontend/public/engine/formcel.wasm
└── crates/
    ├── formcel-core/src/lib.rs      Value, Addr, A1 parsing, Sheet, Workbook
    ├── formcel-wasm/src/lib.rs      C ABI exports for the window worker
    └── formcel-py/                  PyO3 module formcel_engine (pyproject.toml for maturin)
```

## Table of contents

- [crates/formcel-core/src/lib.rs](#core)
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

### abi3-py312 and unsendable
- refers-to: crates/formcel-py/Cargo.toml, src/lib.rs :: Workbook
- kind: rationale
- logged: v0.1.0 · 2026-10-21

abi3 for Python 3.12 builds one wheel that loads on 3.12 and later. The class is unsendable: the engine process will own each open workbook on one thread and hand work to it, rather than locking the core.
