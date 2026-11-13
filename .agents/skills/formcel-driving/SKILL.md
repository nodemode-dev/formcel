---
name: formcel-driving
description: Work in FormCel, the spreadsheet app open on this computer, through its MCP server (list_commands, describe_command, run_command) or its command line (./formcel cli). Use whenever the person wants something done in the open FormCel window, for example save or open a workbook, change the ribbon, sort or filter, insert a chart, run a ribbon or menu action, or asks what FormCel can do, and formcel tools are available or FormCel is mentioned. Routes terminal and connection questions to the terminal sub-skill. Not for changing FormCel's own source code (use formcel-harness).
---

# formcel-driving

FormCel is a spreadsheet app. Its engine runs on `127.0.0.1:8199` and its window on `localhost:5199` (or in the desktop app). Every action in the window (ribbon buttons, menus, the Quick Access Toolbar, Preferences) is a command with an id, and the window mirrors its catalogue to the engine. The MCP server, named `formcel`, hands a command to the open window and returns the window's answer, so each change happens in front of the person.

## Tools

| Tool | What it does |
| --- | --- |
| `list_commands` | The catalogue: `id`, `title` and `description` of each command; `text` keeps only commands whose id, title or description hold every word |
| `describe_command` | One command: its title, what it does, whether it changes the workbook (`changes`) and its keys |
| `run_command` | Runs one command by `id` in the open window and returns the window's answer or its error |

Command ids are dotted, for example `ribbon.collapse`, `ribbon.customize`, `qat.customize` and `app.settings`. Always find an id with `list_commands` first; never guess one.

## How to work

1. `list_commands` with a word from the person's request (`text: "sort"`).
2. `describe_command` on the best match. If `changes` is true, the command edits the workbook; say what you are about to do.
3. `run_command`. The answer is the window's own: an error names what to fix (a command that cannot run now, an unknown id).
4. After a change, tell the person what happened in the window in one sentence.

## Rules

- The terminal, Claude Code and chat commands (`terminal-toggle`, `terminal-new`, `claude-code`, `claude-chat`) are the person's own and are refused to every agent. Do not retry them; tell the person where to find them in the window.
- Outside agents need the person's consent. The first `run_command` from an outside agent asks once in the FormCel window; if the person says no, the refusal holds for ten minutes and the person can turn on Allow outside agents in Preferences, Trust Center. The Claude Code that the window's own terminal dock starts is never asked.
- Reading the catalogue (`list_commands`, `describe_command`) needs no window; running a command does.
- FormCel's calculation rules live in its engine. Do not compute a workbook's values yourself when a command or the window can show them.

## From a shell

The same catalogue answers on the command line while the engine runs:

```
./formcel cli list sort
./formcel cli describe ribbon.collapse
./formcel cli run ribbon.collapse
```

## Sub-skills

Each sub-skill is `sub-skills/[name]/SUB-SKILL.md` next to this file.

| The person wants | Load |
| --- | --- |
| A terminal or Claude Code inside FormCel, to start or reconnect FormCel, or the tools do not answer | `terminal` |
