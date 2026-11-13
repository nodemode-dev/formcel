# AGENTS.md · FormCel

Read `CLAUDE.md` first; it holds the layout, commands and rules. This file repeats the part agents must not undo.

## Working in the open window (MCP)

When the person wants something done in FormCel (a workbook saved or opened, a ribbon or menu action, anything the window can do), use the `formcel` MCP server, guided by the `formcel-driving` skill in `.agents/skills/formcel-driving` (the same skill sits in `.claude/skills`). `list_commands` finds a command in the window's catalogue, `describe_command` explains it, and `run_command` runs it in the open window, where the person sees the change. `./formcel cli list`, `describe` and `run` reach the same catalogue from a shell.

`.mcp.json`, `.codex/config.toml` and `.cursor/mcp.json` run `./formcel mcp`, which starts the engine when it is not running. From any other folder, `./formcel agents install` sets up Claude Code, Codex and Cursor for the user account. The first command an outside agent runs asks the person once, in the window, to allow outside agents (Preferences, Trust Center keeps the switch). The terminal, Claude Code and chat commands (`terminal-toggle`, `terminal-new`, `claude-code`, `claude-chat`) are the person's own and are refused to every agent.

## Changing FormCel's code

Read `CLAUDE.md` and `.agents/skills/formcel-harness/SKILL.md` first; its `terminal-operator` sub-skill covers the terminal dock, Claude Code, the window bridge and `/mcp`. Edit skills in `.claude/skills`, then run `./formcel agents sync`; `./formcel agents check` and `./formcel mcpb check` must pass (CI runs both).

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
