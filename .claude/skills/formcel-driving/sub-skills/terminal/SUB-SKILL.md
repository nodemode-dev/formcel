---
name: terminal
description: Terminals, Claude Code and connecting to FormCel when an agent is driving it. Use when the person asks for a terminal inside FormCel, wants FormCel to start Claude Code, or asks how to start, stop or reconnect FormCel so the formcel MCP tools work. FormCel has a terminal dock for the person but no MCP terminal tool; this says what to ask the person to run and how to check the connection.
---

# terminal

The FormCel window has a terminal dock for the person: shell tabs, Claude Code tabs and a Chat tab, opened with Mod+J or the title bar buttons. The shells and Claude Code run in the FormCel engine, which owns every process. The MCP catalogue has no terminal tool, and the dock's commands (`terminal-toggle`, `terminal-new`, `claude-code`, `claude-chat`) are refused to agents. Do not claim to run shell commands inside FormCel.

## What the person may need to run

These are for the person to run in the FormCel folder, or for you to run in your own shell only when you have one and the person asked.

| Goal | Command |
| --- | --- |
| Start FormCel (engine and window) | `./formcel` |
| Connect Claude Code, Codex and Cursor to FormCel for this user | `./formcel agents install` (add `--dry-run` to see what it would do) |
| Run the MCP server as a client would (stdio) | `./formcel mcp` (it starts the engine if none is running) |
| Run a window command from a shell | `./formcel cli run ID` |
| Windows | the same commands through `formcel.bat` |

`./formcel mcp` is what `.mcp.json`, `.cursor/mcp.json` and `.codex/config.toml` run, so inside the FormCel repository the tools connect without setup. `GET http://127.0.0.1:8199/api/mcp/status` reports `window` (a window is connected), `allowed` (outside agents are on) and the number of commands the window mirrored.

## Reconnect checklist when the tools do not answer

1. Call `list_commands`. An empty list with a hint means no window has mirrored its catalogue yet: ask the person to open FormCel.
2. "No FormCel window is open": ask the person to run `./formcel` or open the app, then retry.
3. "did not allow outside agents": ask the person to answer the question in the FormCel window or turn on Allow outside agents in Preferences, Trust Center. A refusal holds for ten minutes.
4. No formcel tools at all: the server is not registered in this client. Ask the person to run `./formcel agents install`, then restart the client.
5. "did not answer within 60 seconds": the window is busy; wait and retry once.

## Inside the dock

A Claude Code tab runs the person's own `claude` with FormCel's MCP server attached and a per-run token, so its calls count as the window's own and are not asked the consent question. Its working folder is the Workbooks folder of FormCel's data folder. If Claude Code is not installed, the dock shows the install line.
