---
name: terminal-operator
description: The terminal dock, its Claude Code tabs and Chat tab, the engine's pseudo-terminals, the window bridge and the MCP endpoint in FormCel. Use when changing the dock in the window, the PTY or Claude Code services in the engine, the /api/live bridge, /mcp and its consent, or any code that starts a child process. Lists the real files and the rules process code must follow.
---

# terminal-operator

FormCel's terminal dock follows the Form family standard set by formvis: the engine owns every process, and the window only draws and sends keys. Claude Code is the person's own install; FormCel never bundles it and never reads or stores a credential.

## What exists

| Where | What it does |
| --- | --- |
| `backend/app/services/terminal.py`, `routers/terminal.py` | PTY sessions (`ptyprocess`, `pywinpty` on Windows) with a 256 KiB scrollback under `/api/terminal`: list, open, `/claude`, resize, restart, close; output on the WebSocket `/api/terminal/{id}/stream` as text frames, a binary frame `{"type": "exit"}` when the program ends; the window sends `{"type": "input", "data"}` and `{"type": "resize", "cols", "rows"}`. At most 24 sockets at once (close 4429) |
| `backend/app/services/claude_code.py`, `routers/claude_code.py` | Finds `claude` (`FORMCEL_CLAUDE_BIN`, PATH, the usual install folders, the login shell), reports it at `/api/claude-code/status` with the install line when it is missing, starts a Claude Code tab with `--mcp-config` for this engine's `/mcp`, `--allowedTools mcp__formcel` and the per-run token, and runs the Chat tab in stream-JSON under `/api/agent/claude` (start, send, stop, permission, WebSocket `/stream`) |
| `backend/app/services/agents.py` | The per-run in-app token (`FORMCEL_INAPP_TOKEN` in the tab's environment, header `x-formcel-inapp`) and the outside-agent switch kept in `settings.json` |
| `backend/app/services/bridge.py`, `routers/live.py` | The window bridge: the engine sends `{"t": "run", "id", "command", "params"}` on `/api/live` and waits for `{"t": "result", "id", "ok", "result" or "error"}` |
| `backend/app/routers/commands.py`, `routers/mcp.py` | The mirrored catalogue (`PUT /api/commands`), describe and run for the CLI, and `/mcp` with `list_commands`, `describe_command` and `run_command`; `GET` and `PUT /api/agents/allowed`; `GET /api/mcp/status` |
| `frontend/src/ui/terminal-dock.ts`, `chat-pane.ts`, `dock-api.ts`, `dock-mount.ts`, `styles/terminal.css` | The dock, the Chat tab, their engine calls and their commands (`terminal-toggle` Mod+J, `terminal-new`, `claude-code`, `claude-chat`) |
| `frontend/src/automation/bridge.ts`, `ui/agents-allow.ts` | The window side of `/api/live` and the consent question and switch |
| `setup/mcp_stdio.py` | `./formcel mcp`: stdio to `/mcp`, starting `backend/boot_backend` when no engine answers (`FORMCEL_MCP_AUTOSTART=0` turns that off) |

## Rules

1. Process control belongs to the engine. Page code never starts a process; it calls `/api` through `dock-api.ts`.
2. A PTY endpoint is remote code execution: every route and socket passes LocalGuard (it covers the WebSocket scope) and the router's own `origin_ok`. The engine binds 127.0.0.1 only.
3. Every child ends when its tab closes or the engine stops: `main.py` stops Claude Code and calls `close_all` on shutdown.
4. Windows uses ConPTY through `pywinpty`; a missing PTY package answers with the install line instead of stopping the engine.
5. The dock's commands are window-only: `WINDOW_ONLY` in `routers/commands.py` refuses them to the CLI and to every agent, the in-app Claude Code included. Keep it in step with `WINDOW_ONLY` in `frontend/src/automation/bridge.ts`.
6. Outside agents keep the consent flow; nothing auto-approves it. Only the in-app token skips the question.
7. The bridge message format is the family's (formtxt's `/api/live`); change both sides together or not at all.
8. Window changes obey the zero-flash law: the dock row is reserved before first paint, tabs and notes are patched in place.
9. Record the change in the side's `HASHOUT_LOG.md`.
