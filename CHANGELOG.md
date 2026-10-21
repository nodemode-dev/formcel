# Changelog

## 0.2.0 · 2026-10-21

- Engine: a chunked cell store (32 by 32 blocks), undo and redo of up to 500 steps, batched edits as one step, viewport reads, the used range, and Ctrl+arrow data-edge jumps with Excel's rules, in the WebAssembly and Python builds alike.
- Window: a canvas grid over the full 1,048,576 by 16,384 sheet with row and column headers, cell, range, row, column and whole-sheet selection, keyboard navigation, typing and F2 editing with Alt+Enter line breaks, the Name Box, a formula bar, undo and redo, clear, copy, cut and paste of tab-separated text, column and row resizing with column autofit, and freeze panes. Keys are handled in order, so fast typing never lands in the wrong cell.
- Scrolling 1,000,000 filled rows holds a 16.7 ms p95 frame at 4x CPU throttling.

## 0.1.0 · 2026-10-21

- Scaffold (DEV_PLAN Phase 0): Rust engine core with a WebAssembly build for the window and a Python build for the engine process; FastAPI engine process on 127.0.0.1:8199 with health and version routes; TypeScript and Vite window on localhost:5199 with the family theme boot, the engine in a Web Worker and an engine status check; install and boot scripts for macOS, Linux and Windows.
