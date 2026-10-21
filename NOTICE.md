# NOTICE

FormCel
Copyright 2026 nodemode-ai

Licensed under the Apache License, Version 2.0. See `LICENSE`.

## Code from the form family

FormCel ports code from two sibling repositories by the same owner, both Apache-2.0:

| Source | Version | What FormCel uses |
| --- | --- | --- |
| formdeck (nodemode-ai/formdeck) | 0.23.0 | the pre-paint theme profiles in `frontend/index.html`, the Vite proxy layout, the script suite shape; later the home screen, ribbon, command catalogue, terminal dock, sharing and MCP router |
| form.md (nodemode-ai/form.md) | 0.46.0 | `backend/app/templates/formmd.json`: the rows of its 14 Data and charts and 14 Example projects templates, exported from `internal/templates` with dates resolved to 2026-10-21 and option ids turned into their names; `backend/app/services/csvio.py`: the separator sniffing of `internal/collection/csv.go`; later: chart kinds and drawing, large-table windowing |

## Third-party components

| Component | Licence | Where |
| --- | --- | --- |
| Vite | MIT | frontend build tool |
| TypeScript | Apache-2.0 | frontend build tool |
| FastAPI | MIT | engine process |
| Uvicorn | BSD-3-Clause | engine process |
| PyO3 | MIT or Apache-2.0 | Python build of the engine |
| maturin | MIT or Apache-2.0 | builds the Python module |
| openpyxl 3.1.5 | MIT | engine process: reading and writing .xlsx (`backend/app/services/xlsx`) |
| et_xmlfile 2.0.0 | MIT | engine process: XML writing for openpyxl |
| xlrd 2.0.1 | BSD-3-Clause | engine process: reading legacy .xls (`backend/app/services/xls.py`) |
| reportlab 4.2.5 | BSD | engine process: PDF export (`backend/app/services/pdf.py`) |
| Pillow | MIT-CMU (HPND) | engine process: image support for reportlab |
| chardet | LGPL-2.1 | engine process: a reportlab dependency, installed unmodified as its own package |
| msoffcrypto-tool 5.4.2 | MIT | engine process: password-protected files (`backend/app/services/crypto.py`) |
| cryptography | Apache-2.0 or BSD-3-Clause | engine process: used by msoffcrypto-tool |
| olefile | BSD-2-Clause | engine process: used by msoffcrypto-tool |
| regex 1.13.1 | MIT or Apache-2.0 | engine: REGEXMATCH, REGEXEXTRACT, REGEXREPLACE, REGEXTEST (`engine/crates/formcel-core/src/fx_regex.rs`); with regex-automata 0.4.18, regex-syntax 0.8.11, aho-corasick 1.1.5 and memchr 2.8.3 |
| fancy-regex 0.14.0 | MIT | engine: lookaround and backreferences in the regular expression functions; with bit-set 0.8.0 and bit-vec 0.8.0 (MIT or Apache-2.0) |
| rayon 1.12.0 | MIT or Apache-2.0 | engine process only (cargo feature `parallel`, enabled by formcel-py): multi-threaded calculation; with rayon-core, crossbeam-deque, crossbeam-epoch, crossbeam-utils and either (MIT or Apache-2.0). The window's WebAssembly build does not include them |
| PyMySQL 1.2.3 | MIT | engine process: MySQL query sources (`backend/app/services/pqx.py`) |
| psycopg 3.3.6 (with psycopg-binary) | LGPL-3.0 | engine process only, installed unmodified as its own package and imported at run time: PostgreSQL query sources. Never shipped inside the window or a desktop bundle |
| Natural Earth 1:110m admin 0 countries | public domain | `frontend/src/charts/world.ts`: simplified country outlines for the map chart, from naturalearthdata.com |
| Tesseract OCR (system binary, not bundled) | Apache-2.0 | engine process: Data from picture calls a `tesseract` already installed on the computer, if any (`backend/app/services/ocr.py`) |
