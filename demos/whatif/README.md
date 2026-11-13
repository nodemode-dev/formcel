# FormCel demo: Loan and savings what-if

The second of FormCel's three offline demo pages (the others are `demo/` and `demos/lab/`). It runs in a browser with no engine process, no desktop shell and no network: double-click `index.html`, or serve the repository with a static server and open `/demos/whatif/`. Its script, styles, fonts and the window engine are the ones stored once in `demo/assets`, loaded by relative path, so keep `demo/` beside `demos/`.

## What it shows

The real FormCel window, which opens the Loan and savings what-if demo as Home > Demos does in the app. The Loan sheet has named inputs in blue cells (home price, deposit, interest rate, term), results from LET, a LAMBDA name and SEQUENCE, XLOOKUP and BYROW spills, a two-variable data table of payments by rate and term, three scenarios in Data > What-If Analysis > Scenario Manager, a Goal Seek note and a chart of the balance and interest by year; Schedule holds the 30-year monthly amortisation schedule; Savings grows a savings plan with FV. Change an input on the Loan sheet and the payment, the schedule, the data table and the charts recalculate in the page.

## How the page works and how to rebuild it

See `demo/README.md`: the three pages share `demo/src`, one bundle and `frontend/vite.demo.config.ts`, the page replays the engine's recorded answers that open the workbook and answers everything else that needs the engine process with the app's own message, and `npm run demo` in `frontend/` rebuilds all three. This folder holds only `index.html`. Credits are in `CREDITS.md`.
