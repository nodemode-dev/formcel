# Demo credits

Nothing in the three demo pages is third-party media. There are no photographs, pictures, templates or sample files. The three workbooks are FormCel's own work, built from a fixed seed with FormCel's own engine by `scripts/demo-workbooks.py`; Harbour Bikes, its stores, products and orders, the loan and savings figures, the lab, its analysts and every reading are invented. `demo/assets/workbooks.js` holds the engine's answers that open them, recorded by `scripts/demo-record.py`.

The bundles in `demo/assets` contain FormCel's own code (Apache-2.0) and these components, each already listed in `NOTICE.md`:

| Component | Licence | In the page |
| --- | --- | --- |
| regex 1.13.1, fancy-regex 0.14.0 (with bit-set and bit-vec) | MIT or Apache-2.0, MIT | inside the window engine, `assets/engine.js` |
| TypeScript 5.9.3 (npm alias typescript5) | Apache-2.0 | the script editor's type checking, `assets/ts-worker.js` |
| xterm.js 6.0.0 and its fit addon 0.11.0 | MIT | `assets/demo.js` (the terminal dock, which needs the engine) |
| @tauri-apps/api 2 | MIT or Apache-2.0 | `assets/demo.js` (desktop only, unused in a browser) |
| Natural Earth admin 0 and admin 1 outlines | public domain | `assets/demo.js`, the map chart |
| Fontsource packages 5.3.0 of 23 families | SIL Open Font License 1.1 | the `assets/*.woff2` files, shared by the three pages |

The app opens the same three demos from Home > Demos, Help > Demos and the `demo-sales`, `demo-whatif` and `demo-lab` commands, from the same workbooks in `backend/app/templates/demos.json`, so this note covers them too.
