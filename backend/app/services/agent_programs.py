import json
import os
import re
import shlex
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from .. import config
from . import agents, claude_code, terminal

PROGRAMS = {
    "codex": {"bin": "codex", "title": "Codex", "install": "npm install -g @openai/codex", "keys": ("OPENAI_API_KEY", "CODEX_API_KEY"), "ask": ("login", "status")},
    "cursor": {"bin": "cursor-agent", "title": "Cursor", "install": "curl https://cursor.com/install -fsS | bash", "keys": ("CURSOR_API_KEY",), "ask": ("status",)},
}
MCP_URL_VAR = "FORMCEL_MCP_URL"
TAB_SERVER = "formcel_tab"
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_cache: dict = {"at": 0.0, "value": None}


def find(kind: str) -> str | None:
    binary = PROGRAMS[kind]["bin"]
    found = shutil.which(binary, path=terminal.base_env().get("PATH"))
    if found or os.name == "nt":
        return found
    try:
        out = subprocess.run(terminal.login_shell() + ["-c", f"command -v {shlex.quote(binary)}"], capture_output=True, text=True, timeout=10,
                             env=claude_code.child_env(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    lines = out.stdout.strip().splitlines()[-1:] if out.returncode == 0 else []
    return lines[0] if lines and os.path.isabs(lines[0]) and os.access(lines[0], os.X_OK) else None


def status() -> dict:
    out = {}
    for kind, p in PROGRAMS.items():
        path = find(kind)
        out[kind] = {"installed": path is not None, "path": path, "version": None, "signedIn": None, "install": "" if path else p["install"], "title": p["title"]}
    return out


def _say(path: str, args: tuple) -> tuple[int, str]:
    try:
        out = subprocess.run([path, *args], capture_output=True, text=True, timeout=10, env=claude_code.child_env(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return 1, ""
    return out.returncode, _ANSI.sub("", out.stdout)


def _version(path: str) -> str | None:
    code, said = _say(path, ("--version",))
    return next((w for w in said.split() if w[:1].isdigit()), None) if code == 0 else None


def _signed_in(kind: str, path: str) -> bool | None:
    p = PROGRAMS[kind]
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
        path = find(kind)
        out[kind] = {"installed": path is not None, "path": path, "version": _version(path) if path else None,
                     "signedIn": _signed_in(kind, path) if path else None, "install": p["install"], "title": p["title"]}
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
    if kind not in PROGRAMS:
        raise ValueError(f"No agent program called {kind}")
    path = find(kind)
    if path is None:
        raise LookupError(f"{PROGRAMS[kind]['title']} is not installed on this computer.")
    command = tab_command(kind, path, port)
    argv = command if os.name == "nt" else terminal.login_shell() + ["-c", "exec " + shlex.join(command)]
    token = agents.mint(uuid.uuid4().hex)
    env = terminal.base_env() | {agents.INAPP_VAR: token, MCP_URL_VAR: f"http://127.0.0.1:{port}/mcp"}
    folder = claude_code.workdir(document_folder) if document_folder else str(config.DATA_DIR)
    if kind == "cursor":
        cursor_config(folder, port)
    try:
        session = terminal.open_session(folder, cols, rows, PROGRAMS[kind]["title"], argv, env, kind)
    except Exception:
        agents.revoke(token)
        raise
    return session.describe()
