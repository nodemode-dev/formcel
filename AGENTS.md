# AGENTS.md · FormCel

Read `CLAUDE.md` first; it holds the layout, commands and rules. This file repeats the part agents must not undo.

## Declined for patent risk, 2026-10-23

- Linked records (Stocks, Currencies) live in the workbook record store, never inside the cell. The cell keeps the record id and its label only.
- No per-field show or hide properties on linked records.
- Sparklines have no in-app group edit or ungroup.
- Data Model relationships are always explicit and never inferred from a formula.
- Flash Fill stays a single synthesis pass: no relaxed second pass, no loops.
- No action that collapses a range into one cell as an array.
- No blur, sharpen or glow image functions driven by cells.
- Ribbon groups collapse whole; never move part of a group into an overflow pane.

Commits are authored as `nodemode-ai <mackin@nodemode.ai>` with no attribution lines, as `CLAUDE.md` says.
