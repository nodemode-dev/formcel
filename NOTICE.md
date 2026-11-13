# NOTICE

FormCel
Copyright 2026 NodeAgentc, Inc.

Licensed under the Apache License, Version 2.0. See `LICENSE`.

## Code from the form family

FormCel ports code from three sibling repositories by the same owner, all Apache-2.0:

| Source | Version | What FormCel uses |
| --- | --- | --- |
| formvis (nodemode-ai/formvis) | 1.96.4 | from 0.37.0: the splash and reveal (`src-tauri/src/reveal.rs`, `frontend/public/splash.html`, `revealApp` in `frontend/src/ui/desktop.ts`), macOS traffic lights and title (`src-tauri/src/traffic_lights.rs`), the packaged engine folder (`src-tauri/src/packaged.rs`, `setup/freeze_backend`, `backend/engine_main.py`), caption buttons and title tools (`frontend/src/ui/titlebar.ts`), the Preferences dialog layout and prefs store (`frontend/src/ui/settings.ts`, `prefs.ts`), the Home screen and file browser (`frontend/src/ui/home.ts`, `home-files.ts`), menus (`menubar.ts`, `native-menu.ts`, `src-tauri/src/text_edit.rs`), the status bar and jobs list (`statusbar.ts`, `jobs-list.ts`) and their styles |
| formdeck (nodemode-ai/formdeck) | 0.23.0, 0.27.1 | the pre-paint theme profiles in `frontend/index.html`, the Vite proxy layout, the script suite shape; later the home screen, command catalogue, terminal dock, sharing and MCP router; from 0.27.1 (in 0.37.0) the ribbon, Quick Access Toolbar, Customize dialogs, key tips, responsive groups, ribbon styles and icon style (`frontend/src/ui/ribbon.ts`, `qat.ts`, `ribbon-customize.ts`, `key-tips.ts`, `responsive.ts`, `icons-ribbon.ts`, `styles/ribbon.css`); in 0.38.0 the font module (`frontend/src/grid/fonts.ts`, from `frontend/src/render/fonts.ts`) and the system font command (`src-tauri/src/system_fonts.rs`) |
| form.md (nodemode-ai/form.md) | 0.46.0 | `backend/app/templates/formmd.json`: the rows of its 14 Data and charts and 14 Example projects templates, exported from `internal/templates` with dates resolved to 2026-10-21 and option ids turned into their names; `backend/app/services/csvio.py`: the separator sniffing of `internal/collection/csv.go`; later: chart kinds and drawing, large-table windowing |

## Third-party components

| Component | Licence | Where |
| --- | --- | --- |
| Vite | MIT | frontend build tool |
| TypeScript | Apache-2.0 | frontend build tool |
| pytest 9.1.1, httpx 0.28.1 (`backend/requirements-test.txt`) | MIT, BSD-3-Clause | the test suite in `backend/tests` and CI only, never shipped |
| Playwright 1.63.0 (Python) | Apache-2.0 | the window smoke in `frontend/tests/window` and CI only, never installed in the app |
| FastAPI | MIT | engine process |
| Uvicorn | BSD-3-Clause | engine process |
| PyO3 | MIT or Apache-2.0 | Python build of the engine |
| maturin | MIT or Apache-2.0 | builds the Python module |
| openpyxl 3.1.5 | MIT | engine process: reading and writing .xlsx (`backend/app/services/xlsx`) |
| et_xmlfile 2.0.0 | MIT | engine process: XML writing for openpyxl |
| xlrd 2.0.1 | BSD-3-Clause | engine process: reading legacy .xls (`backend/app/services/xls.py`) |
| reportlab 4.2.5 | BSD | engine process: PDF export (`backend/app/services/pdf.py`) |
| Pillow | MIT-CMU (HPND) | engine process: image support for reportlab |
| Libraries inside the Pillow wheel | libjpeg, libpng, libtiff, libwebp, libavif, OpenJPEG, Little CMS, HarfBuzz, Brotli, zstd, xz, libxcb: permissive (see the wheel's LICENSE); FreeType 2.14.3 used under the FreeType License | engine process. Portions of this software are copyright (c) 2026 The FreeType Project (www.freetype.org). All rights reserved. |
| chardet | 0BSD (7.7.0) | development install only: a dependency of a dependency; the desktop freeze excludes it (`--exclude-module chardet`) |
| msoffcrypto-tool 5.4.2 | MIT | engine process: password-protected files (`backend/app/services/crypto.py`) |
| cryptography | Apache-2.0 or BSD-3-Clause | engine process: used by msoffcrypto-tool |
| olefile | BSD-2-Clause | engine process: used by msoffcrypto-tool |
| regex 1.13.1 | MIT or Apache-2.0 | engine: REGEXMATCH, REGEXEXTRACT, REGEXREPLACE, REGEXTEST (`engine/crates/formcel-core/src/fx_regex.rs`); with regex-automata 0.4.18, regex-syntax 0.8.11, aho-corasick 1.1.5 and memchr 2.8.3 |
| fancy-regex 0.14.0 | MIT | engine: lookaround and backreferences in the regular expression functions; with bit-set 0.8.0 and bit-vec 0.8.0 (MIT or Apache-2.0) |
| rayon 1.12.0 | MIT or Apache-2.0 | engine process only (cargo feature `parallel`, enabled by formcel-py): multi-threaded calculation; with rayon-core, crossbeam-deque, crossbeam-epoch, crossbeam-utils and either (MIT or Apache-2.0). The window's WebAssembly build does not include them |
| PyMySQL 1.2.3 | MIT | engine process: MySQL query sources (`backend/app/services/pqx.py`) |
| psycopg 3.3.6 (with psycopg-binary) | LGPL-3.0 | engine process only, installed unmodified as its own package and imported at run time: PostgreSQL query sources when the engine runs from source. Never shipped inside the window or a desktop bundle: the freeze excludes it (`--exclude-module psycopg --exclude-module psycopg_binary`) |
| Natural Earth 1:110m admin 0 countries | public domain | `frontend/src/charts/world.ts`: simplified country outlines for the map chart, from naturalearthdata.com |
| pdfplumber 0.11.10 | MIT | engine process: tables from PDF files (start a workbook from PDF tables); with pdfminer.six (MIT) and pypdfium2 (Apache-2.0 or BSD-3-Clause, bundling PDFium under BSD-3-Clause) |
| pandas 2.3.3 and numpy 2.5.4 | BSD-3-Clause | engine process: Python cells (=PY), run in a separate restricted process |
| TypeScript 5.9.3 (npm alias typescript5) | Apache-2.0 | window: type checking in the Office Scripts editor, loaded on demand in a worker |
| xterm.js (@xterm/xterm 6.0.0) and its fit addon (@xterm/addon-fit 0.11.0) | MIT | window: the terminal dock (Window > Terminal) |
| hunspell en_US dictionary (SCOWL) | permissive, see `backend/app/dictionaries/LICENSE-en_US.txt` | engine process: spell check word list |
| ECMA-376 preset table styles (presetTableStyles, taken from Apache POI's copy) | Apache-2.0 for POI's file; the style definitions are from the published ECMA-376 standard | `frontend/src/grid/tablestyledata.ts`: Excel's built-in table style colours |
| Natural Earth 1:50m and 1:10m admin 1 states and provinces | public domain | `frontend/src/charts/regions.ts` and `regions_more.ts`: regions for the map chart, from naturalearthdata.com |
| pypdfium2 5.14.0 (with PDFium) | Apache-2.0 or BSD-3-Clause (PDFium BSD-3-Clause) | engine process: page images for the File view's print preview (`backend/app/routers/printpreview.py`) |
| keyring 25.6.0 | MIT | engine process: keys and tokens in the system password store when one is available (`backend/app/services/secrets` via settings) |
| @tauri-apps/api 2 | MIT or Apache-2.0 | window, desktop only: native menus, loaded on demand |
| objc2, objc2-app-kit, objc2-foundation | MIT | desktop shell on macOS only: traffic lights, title and text editing commands |
| Fontsource packages 5.3.0 of 23 families (Archivo, Bebas Neue, Caveat, Cormorant Garamond, DM Sans, DM Serif Display, Figtree, Fraunces, IBM Plex Sans, Inter, JetBrains Mono, Libre Baskerville, Manrope, Montserrat, Nunito, Oswald, Outfit, Plus Jakarta Sans, Poppins, Sora, Space Grotesk, Syne, Work Sans) | SIL Open Font License 1.1 (the fonts); MIT (the packaging) | window: bundled fonts (`frontend/src/grid/fonts.ts`); PDF export converts them for embedding |
| Lora, Merriweather, Playfair Display, Raleway and Source Sans 3, the upstream variable fonts unmodified from github.com/google/fonts at e7db6ca603fd4862010383ff17ffd6cc4ffac1c0, each with its OFL.txt | SIL Open Font License 1.1, with Reserved Font Names | `frontend/public/fonts/full`: these families carry a Reserved Font Name, so FormCel ships the complete original files under their own names instead of renamed subsets. PDF export takes a static instance of the weight in use (`backend/app/services/full_fonts.py`) to embed in the exported document only |
| fontTools 4.66.1 | MIT | engine process: static instances of the full fonts above for PDF embedding |
| fontdb 0.24 | MIT | desktop shell: lists installed fonts (`src-tauri/src/system_fonts.rs`) |
| Tesseract OCR (system binary, not bundled) | Apache-2.0 | engine process: Data from picture calls a `tesseract` already installed on the computer, if any (`backend/app/services/ocr.py`) |
| ptyprocess 0.7.0 | ISC | engine process, the pseudo-terminals behind the terminal dock on macOS and Linux (`backend/app/services/terminal.py`) |
| pywinpty 3.0.5 | MIT | engine process, the same on Windows (ConPTY) |
| Claude Code (the person's own install, not bundled) | the person's own licence with its maker | engine process: the terminal dock's Claude Code tabs and Chat tab start a `claude` program already installed on the computer, if any (`backend/app/services/claude_code.py`); FormCel reads and stores no credential |
| Other Python packages frozen into the engine | MIT: annotated-doc, annotated-types, anyio, charset-normalizer, h11, httptools, jaraco.classes, jaraco.context, jaraco.functools, jeepney, more-itertools, pydantic, pydantic-core, pytz, pyyaml, six, typing-inspection, watchfiles; MIT-0: cffi; BSD-3-Clause: click, idna, pycparser, python-dotenv, secretstorage, starlette, websockets; BSD: python-dateutil (with Apache-2.0 parts); Apache-2.0: tzdata; MIT OR Apache-2.0: uvloop; PSF-2.0: typing-extensions and the CPython runtime; cryptography's wheel bundles OpenSSL 3 (Apache-2.0) | read from the installed metadata of `backend/requirements.txt`, 2026-10-23 |

## Desktop shell: crates under other licences

Tauri links these crates unedited (no `[patch]` and no vendored copy):

| Crate | Licence | Why it is there |
| --- | --- | --- |
| cssparser, selectors, dtoa-short, option-ext | MPL-2.0 | Tauri's HTML handling (tauri-utils); used unmodified, source at crates.io |
| r-efi | MIT OR Apache-2.0 OR LGPL-2.1-or-later | used under MIT |

The Linux AppImage also carries the build machine's WebKitGTK, GTK and GLib (LGPL-2.1-or-later) as separate shared libraries. The installers carry this file and `LICENSE`.

## Trademarks

Microsoft, Excel and Office are trademarks of the Microsoft group of companies. Google Sheets is a trademark of Google LLC. FormCel is not affiliated with or endorsed by Microsoft or Google; the names describe file formats and compatibility only.
