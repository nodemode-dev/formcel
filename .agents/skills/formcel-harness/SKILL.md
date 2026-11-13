---
name: formcel-harness
description: Change FormCel's own source code. Use whenever the task edits files in this repository, for example a calculation rule in the Rust engine, a route in the FastAPI engine process, a ribbon command, dialog or grid feature in the TypeScript window, the desktop shell, the launcher, a setup script, the agent kit or CI. Gives the layout, the hard rules (hand-made surgical edits, no flicker, tokens only, no emoji, no em dash in Markdown, near-zero comments, declined features) and routes to the area. Not for using the running app through MCP (use formcel-driving).
---

# formcel-harness

FormCel is the Form family's spreadsheet app. This skill is for changing its code. To use the running app through MCP, load `formcel-driving` instead. `CLAUDE.md` and `AGENTS.md` at the root are the source of truth; read them first.

## Layout

| Path | What lives there |
| --- | --- |
| `engine/` | Rust workspace. `formcel-core` holds every calculation rule; `formcel-wasm` and `formcel-py` only translate calls |
| `backend/` | FastAPI engine process on `127.0.0.1:8199` (`FORMCEL_PORT`), behind `app/local_guard.py`; routers in `app/routers`, services in `app/services` |
| `frontend/` | TypeScript and Vite window on `localhost:5199`, `/api` and `/mcp` proxied to the engine; commands in `src/ui/commands.ts` |
| `src-tauri/` | the desktop shell; it starts the frozen engine with `FORMCEL_PORT=0` |
| `setup/` | build and freeze helpers (`lib.sh`, functions prefixed `fc_`), and the agent kit: `mcp_stdio.py`, `agents.py`, `catalogue.py`, `mcpb.py` with `mcpb/manifest.json` |
| `.claude/skills`, `.agents/skills` | these skills; `.agents/skills` is a mirror written by `./formcel agents sync` |
| `formcel`, `formcel.bat` | the launcher; `./formcel help` lists its commands |

## Routing

| The change touches | Do this |
| --- | --- |
| A formula, function or calculation | `engine/crates/formcel-core`; a new function also goes in `docs/functions.json` in the same change. Rebuild with `engine/build_wasm` and the Python module |
| An engine route, a file format, MCP, the terminal or Claude Code | `backend/app`. Keep every route behind LocalGuard; register routers in `app/main.py`. Check with `cd backend && python -m pytest tests` |
| The window: ribbon, dialogs, grid, dock | `frontend/src`. Tokens for colour, z-index from `styles/z-layers.css`, inline `currentColor` SVG in `src/ui/icons.ts`, build once then patch in place. Check with `npx tsc --noEmit` |
| A window command agents can run | register it with `registerCommand` (id, title, description, `changes`); the window mirrors the catalogue to `PUT /api/commands` and runs it for `/api/live` |
| Terminals, Claude Code tabs, the Chat tab, child processes | load `sub-skills/terminal-operator/SUB-SKILL.md` |
| Skills, `.mcp.json`, `.cursor`, `.codex`, `.claude-plugin`, the extension | edit `.claude/skills`, then `./formcel agents sync`; check with `./formcel agents check` and `./formcel mcpb check` |

## Rules

1. Surgical, hand-made edits: one region per change. No sed, patch, codemod or generator that writes source.
2. Zero DOM flash, flicker or re-render: reserve space, render once, patch the node that changed.
3. Colours and z-index come from tokens only. Icons are inline `currentColor` SVG; no icon library and no sparkle glyph.
4. No emoji anywhere. No U+2014 in Markdown.
5. Near-zero comments in code. Explanations go in the side's `HASHOUT_LOG.md`.
6. Every new dependency gets a `NOTICE.md` row in the same commit, pinned to an exact version.
7. Other vendors' product names never name a command, menu, panel or tool. "Claude Code" and "Claude" name the person's own tool and are fine.
8. The features declined in `CLAUDE.md` stay declined.
9. Versions match across `frontend/package.json` and its lock, `frontend/src/version.ts`, `backend/app/version.py` and `engine/Cargo.toml`. The extension manifest has no version of its own: `./formcel mcpb build` writes the one in `frontend/package.json`.
10. Never edit `.claude/settings.json`; it keeps Claude Code's attribution off.

## Commits

One author and committer, `nodemode-ai <mackin@nodemode.ai>`. No `Co-Authored-By` or `Claude-Session` trailer and no "Generated with" line. Message style: `type(scope): plain sentence (X.Y.Z)`.

## Before finishing

Run the checks for the area you touched (`npx tsc --noEmit`, backend pytest, `bash -n` on shell scripts, `./formcel agents check`, `./formcel mcpb check`). Say plainly what was verified and what was not.
