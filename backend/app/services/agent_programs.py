import json
import os
import re
import subprocess
import time
import uuid
from pathlib import Path

from .. import config
from . import agent_lookup, agents, claude_code, terminal

PROGRAMS = {
    "codex": {"bin": "codex", "title": "Codex", "install": "npm install -g @openai/codex", "keys": ("OPENAI_API_KEY", "CODEX_API_KEY"), "ask": ("login", "status")},
    "cursor": {"bin": "cursor-agent", "title": "Cursor", "install": "curl https://cursor.com/install -fsS | bash", "keys": ("CURSOR_API_KEY",), "ask": ("status",)},
    "antigravity": {"bin": "agy", "title": "Antigravity", "install": agent_lookup.install("antigravity"), "keys": (), "ask": ()},
}
TABS = ("codex", "cursor")
MCP_URL_VAR = "FORMCEL_MCP_URL"
TAB_SERVER = "formcel_tab"
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_cache: dict = {"at": 0.0, "value": None}


def find(kind: str) -> str | None:
    return claude_code.located(kind).path


def status(fresh: bool = False) -> dict:
    out = {}
    for kind, p in PROGRAMS.items():
        found = claude_code.located(kind, fresh)
        out[kind] = agent_lookup.answer(found, p["install"], claude_code.OTHERWISE) | {"signedIn": None, "install": "" if found.state == "runs" else p["install"], "title": p["title"]}
    return out


def _say(path: str, args: tuple) -> tuple[int, str]:
    try:
        out = agent_lookup.run([path, *args], claude_code.child_env(path), 10)
    except (OSError, subprocess.SubprocessError):
        return 1, ""
    return out.returncode, _ANSI.sub("", out.stdout)


def _signed_in(kind: str, path: str) -> bool | None:
    p = PROGRAMS[kind]
    if not p["ask"]:
        return None
    if any(os.environ.get(k) for k in p["keys"]):
        return True
    said = _say(path, p["ask"])[1].lower()
    if "not logged in" in said or "not signed in" in said:
        return False
    return True if "logged in" in said or "signed in" in said else None


def report(fresh: bool = False) -> dict:
    if not fresh and _cache["value"] is not None and time.time() - _cache["at"] < 60:
        return _cache["value"]
    out = {"claude": {**claude_code.info(fresh=fresh), "title": "Claude Code"}}
    for kind, p in PROGRAMS.items():
        found = claude_code.located(kind, fresh)
        out[kind] = agent_lookup.answer(found, p["install"], claude_code.OTHERWISE) | {
            "signedIn": _signed_in(kind, found.path) if found.state == "runs" else None, "install": p["install"], "title": p["title"]}
    _cache["value"], _cache["at"] = out, time.time()
    return out


def tab_command(kind: str, path: str, port: int) -> list[str]:
    if kind != "codex":
        return [path]
    return [path, "-c", f'mcp_servers.{TAB_SERVER}.url="http://127.0.0.1:{port}/mcp"',
            "-c", f'mcp_servers.{TAB_SERVER}.env_http_headers={{"{agents.INAPP_HEADER}"="{agents.INAPP_VAR}"}}']


def cursor_config(folder: str, port: int) -> None:
    path = Path(folder) / ".cursor" / "mcp.json"
    try:
        held = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        servers = held.get("mcpServers", {}) if isinstance(held, dict) else None
        if not isinstance(servers, dict):
            return
        held["mcpServers"] = servers | {TAB_SERVER: {"url": f"http://127.0.0.1:{port}/mcp", "headers": {agents.INAPP_HEADER: "${env:" + agents.INAPP_VAR + "}"}}}
        path.parent.mkdir(exist_ok=True)
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
            json.dump(held, f, indent=2)
        os.chmod(path, 0o600)
    except (OSError, ValueError):
        return


def open_terminal(kind: str, port: int, cols: int, rows: int, document_folder: str | None = None) -> dict:
    if kind not in TABS:
        raise ValueError(f"No agent program called {kind}")
    found = claude_code.usable(kind)
    if found.state != "runs":
        raise LookupError(claude_code.said(found))
    path = found.path
    argv = agent_lookup.start_argv(tab_command(kind, path, port))
    token = agents.mint(uuid.uuid4().hex)
    env = claude_code.terminal_env(path, token, {MCP_URL_VAR: f"http://127.0.0.1:{port}/mcp"})
    folder = claude_code.workdir(document_folder) if document_folder else str(config.DATA_DIR)
    if kind == "cursor":
        cursor_config(folder, port)
    try:
        session = terminal.open_session(folder, cols, rows, PROGRAMS[kind]["title"], argv, env, kind)
    except Exception:
        agents.revoke(token)
        raise
    return session.describe()
