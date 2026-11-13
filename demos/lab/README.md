# FormCel demo: Lab measurements

The third of FormCel's three offline demo pages (the others are `demo/` and `demos/whatif/`). It runs in a browser with no engine process, no desktop shell and no network: double-click `index.html`, or serve the repository with a static server and open `/demos/lab/`. Its script, styles, fonts and the window engine are the ones stored once in `demo/assets`, loaded by relative path, so keep `demo/` beside `demos/`.

## What it shows

The real FormCel window, which opens the Lab measurements demo as Home > Demos does in the app. Import holds a messy meter export split apart with TEXTSPLIT and MAP; Clean is the cleaned table of 160 invented water readings with validation lists; Summary has the mean, standard deviation, standard error, median and range of each measure, a scatter of conductivity against temperature with a trendline, its equation and R squared, a histogram of pH, a box plot by analyst, and three outliers flagged red by a formula rule on Clean; Batches feeds the box plot. Change a reading on Clean and the statistics, the flags and the charts recalculate in the page.

## How the page works and how to rebuild it

See `demo/README.md`: the three pages share `demo/src`, one bundle and `frontend/vite.demo.config.ts`, the page replays the engine's recorded answers that open the workbook and answers everything else that needs the engine process with the app's own message, and `npm run demo` in `frontend/` rebuilds all three. This folder holds only `index.html`. Credits are in `CREDITS.md`.
