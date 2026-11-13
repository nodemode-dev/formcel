import asyncio
import json
import logging
import os
import shlex
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from .. import config
from . import agents, terminal

log = logging.getLogger("formcel.claude_code")
KEEP_ENV = {"CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CONFIG_DIR"}
CANDIDATES = (".claude/local/claude", ".local/bin/claude", ".npm-global/bin/claude", ".bun/bin/claude", ".volta/bin/claude")
SYSTEM_PATHS = ("/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude")
MODES = {"ask": "manual", "auto-edits": "acceptEdits", "plan": "plan"}
INSTALL = "irm https://claude.ai/install.ps1 | iex" if sys.platform == "win32" else "curl -fsSL https://claude.ai/install.sh | bash"
MISSING = f"Claude Code is not installed. Install it with: {INSTALL}"
NOTE = ("You are answering in FormCel, a spreadsheet app, inside a panel next to the grid. Your working directory is the "
        "FormCel repository. To work on the open workbook use the formcel MCP server's tools; to change FormCel's own code, edit the files.")
PERMISSION_WAIT = 600
LOG_KEEP = 3000
_cache: dict = {"at": 0.0, "value": None}


def child_env() -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE") or k in KEEP_ENV}
    env["CLAUDE_PROJECT_DIR"] = str(config.REPO_DIR)
    env["PATH"] = str(config.REPO_DIR) + os.pathsep + env.get("PATH", "")
    return env


def cli() -> str | None:
    found = os.environ.get("FORMCEL_CLAUDE_BIN") or shutil.which("claude")
    if found:
        return found
    home = Path.home()
    for p in [home / c for c in CANDIDATES] + [Path(s) for s in SYSTEM_PATHS]:
        if p.is_file() and os.access(p, os.X_OK):
            return str(p)
    return _from_login_shell()


def _from_login_shell() -> str | None:
    if os.name == "nt":
        return None
    try:
        out = subprocess.run(terminal.login_shell() + ["-c", "command -v claude"], capture_output=True, text=True, timeout=10, env=child_env(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    found = out.stdout.strip().splitlines()[-1:] if out.returncode == 0 else []
    return found[0] if found and os.path.isabs(found[0]) else None


def _signed_in(path: str) -> bool | None:
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return True
    try:
        out = subprocess.run([path, "auth", "status"], capture_output=True, text=True, timeout=15, env=child_env())
    except (OSError, subprocess.SubprocessError):
        return None
    try:
        data = json.loads(out.stdout)
    except ValueError:
        return None
    return bool(data.get("loggedIn")) if isinstance(data, dict) and "loggedIn" in data else None


def info(fresh: bool = False) -> dict:
    if not fresh and _cache["value"] is not None and time.time() - _cache["at"] < 60:
        return _cache["value"]
    path, version, signed = cli(), None, None
    if path:
        try:
            out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=15, env=child_env())
            version = (out.stdout.strip().split() or [None])[0]
        except (OSError, subprocess.SubprocessError):
            path = None
    if path:
        signed = _signed_in(path)
    _cache["value"], _cache["at"] = {"installed": bool(path), "path": path, "version": version, "signedIn": signed, "install": INSTALL}, time.time()
    return _cache["value"]


class Agent:
    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.gen = 0
        self.mode = "ask"
        self.session: str | None = None
        self.state = "idle"
        self.log: list[dict] = []
        self.subscribers: set[asyncio.Queue] = set()
        self.lock = threading.Lock()
        self.waiting: dict[str, dict] = {}
        self.names: dict[str, str] = {}
        self.streamed: set[str] = set()
        self.message_id = ""
        self.stderr_tail: list[str] = []

    def describe(self) -> dict:
        return {"running": self.proc is not None and self.proc.poll() is None, "state": self.state, "mode": self.mode, "session": self.session}


AGENT = Agent()


def _deliver(msg: dict) -> None:
    for q in list(AGENT.subscribers):
        if q.qsize() < 4000:
            q.put_nowait(msg)


def publish(msg: dict, keep: bool = True) -> None:
    if keep:
        with AGENT.lock:
            AGENT.log.append(msg)
            del AGENT.log[:-LOG_KEEP]
    terminal.call_in_loop(_deliver, msg)


def set_state(state: str) -> None:
    AGENT.state = state
    publish({"type": "state", **AGENT.describe()}, keep=False)


def backlog() -> list[dict]:
    with AGENT.lock:
        return list(AGENT.log)


def _write(obj: dict) -> bool:
    proc = AGENT.proc
    if proc is None or proc.poll() is not None or proc.stdin is None or proc.stdin.closed:
        return False
    try:
        proc.stdin.write(json.dumps(obj) + "\n")
        proc.stdin.flush()
        return True
    except (BrokenPipeError, ValueError, OSError):
        return False


def _respond(request_id: str, body: dict) -> None:
    _write({"type": "control_response", "response": {"subtype": "success", "request_id": request_id, "response": body}})


def summary(name: str, inp: dict) -> str:
    if name == "Bash":
        return str(inp.get("command") or "")[:400]
    path = inp.get("file_path") or inp.get("notebook_path") or inp.get("path")
    if path:
        return str(path)[:400]
    if not inp:
        return ""
    return json.dumps(inp, ensure_ascii=False)[:240]


def _decide(request_id: str, req: dict, gen: int) -> None:
    name, inp = str(req.get("tool_name") or ""), req.get("input") or {}
    if AGENT.mode == "plan" or name == "ExitPlanMode":
        return _respond(request_id, {"behavior": "deny", "message": "Plan mode is on in FormCel: describe the plan and the person will switch modes to carry it out."})
    if name == "AskUserQuestion":
        return _respond(request_id, {"behavior": "deny", "message": "Questions cannot be shown here: ask in your reply instead."})
    gate = {"event": threading.Event(), "allow": False}
    AGENT.waiting[request_id] = gate
    publish({"type": "permission", "id": request_id, "tool": name, "summary": summary(name, inp)})
    gate["event"].wait(PERMISSION_WAIT)
    AGENT.waiting.pop(request_id, None)
    publish({"type": "permission_done", "id": request_id, "allowed": bool(gate["allow"])})
    if AGENT.gen != gen:
        return
    if gate["allow"]:
        _respond(request_id, {"behavior": "allow", "updatedInput": inp})
    else:
        _respond(request_id, {"behavior": "deny", "message": f"The person declined this {name} call. Do not retry it the same way; say what you would have done instead."})


def answer(request_id: str, allow: bool) -> bool:
    gate = AGENT.waiting.get(request_id)
    if gate is None:
        return False
    gate["allow"] = allow
    gate["event"].set()
    return True


def _text_of(c) -> str:
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(str(x.get("text") or "") for x in c if isinstance(x, dict) and x.get("type") == "text")
    return ""


def _on_stream(e: dict) -> None:
    t = e.get("type")
    if t == "message_start":
        AGENT.message_id = str((e.get("message") or {}).get("id") or time.time())
    elif t == "content_block_start":
        block = e.get("content_block") or {}
        kind = block.get("type")
        if kind in ("text", "thinking"):
            AGENT.streamed.add(AGENT.message_id)
            publish({"type": "block", "id": f"{AGENT.message_id}:{e.get('index', 0)}", "kind": kind})
    elif t == "content_block_delta":
        d = e.get("delta") or {}
        piece = d.get("text") if d.get("type") == "text_delta" else d.get("thinking") if d.get("type") == "thinking_delta" else None
        if piece:
            publish({"type": "delta", "id": f"{AGENT.message_id}:{e.get('index', 0)}", "text": piece})


def _on_assistant(message: dict) -> None:
    mid = str(message.get("id") or "")
    for i, b in enumerate(message.get("content") or []):
        if not isinstance(b, dict):
            continue
        if b.get("type") == "tool_use":
            name, inp, tid = str(b.get("name") or ""), b.get("input") or {}, str(b.get("id") or "")
            AGENT.names[tid] = name
            publish({"type": "tool", "id": tid, "name": name, "summary": summary(name, inp)})
            if name == "Bash":
                terminal.agent_write(f"\x1b[1;36m$\x1b[0m {inp.get('command') or ''}\n")
        elif b.get("type") in ("text", "thinking") and mid not in AGENT.streamed:
            key = "text" if b["type"] == "text" else "thinking"
            publish({"type": "block", "id": f"{mid}:{i}", "kind": b["type"]})
            publish({"type": "delta", "id": f"{mid}:{i}", "text": str(b.get(key) or "")})


def _on_results(message: dict) -> None:
    content = message.get("content")
    if not isinstance(content, list):
        return
    for b in content:
        if not isinstance(b, dict) or b.get("type") != "tool_result":
            continue
        tid, text, bad = str(b.get("tool_use_id") or ""), _text_of(b.get("content"))[:20_000], bool(b.get("is_error"))
        publish({"type": "tool_result", "id": tid, "text": text[:2000], "error": bad})
        if AGENT.names.get(tid) == "Bash" and text.strip():
            color = "\x1b[31m" if bad else "\x1b[2m"
            terminal.agent_write(f"{color}{text.rstrip()}\x1b[0m\n")


def _read(proc: subprocess.Popen, gen: int) -> None:
    for line in proc.stdout:
        if AGENT.gen != gen:
            return
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        t, parent = ev.get("type"), ev.get("parent_tool_use_id")
        if t == "stream_event" and not parent:
            _on_stream(ev.get("event") or {})
        elif t == "assistant":
            _on_assistant(ev.get("message") or {})
        elif t == "user" and not parent:
            _on_results(ev.get("message") or {})
        elif t == "system" and ev.get("subtype") == "init":
            AGENT.session = ev.get("session_id") or AGENT.session
            set_state("busy" if AGENT.state == "busy" else "ready")
        elif t == "control_request":
            req = ev.get("request") or {}
            if req.get("subtype") == "can_use_tool":
                threading.Thread(target=_decide, args=(ev.get("request_id"), req, gen), daemon=True).start()
            else:
                _respond(ev.get("request_id"), {})
        elif t == "result":
            AGENT.session = ev.get("session_id") or AGENT.session
            bad = bool(ev.get("is_error")) or ev.get("subtype") not in (None, "success")
            text = str(ev.get("result") or "")
            if bad and ("login" in text.lower() or "api key" in text.lower()):
                text += " Open a terminal, run claude and sign in with /login, then send again."
            publish({"type": "result", "ok": not bad, "text": text if bad else "", "costUsd": ev.get("total_cost_usd")})
            set_state("ready")
    if AGENT.gen != gen:
        return
    tail = " ".join(AGENT.stderr_tail[-3:]).strip()
    AGENT.proc = None
    publish({"type": "notice", "text": f"Claude Code stopped{': ' + tail if tail else '.'}"})
    set_state("exited")


def _drain(proc: subprocess.Popen, gen: int) -> None:
    for line in proc.stderr:
        if AGENT.gen != gen:
            return
        AGENT.stderr_tail.append(line.rstrip())
        del AGENT.stderr_tail[:-20]


def mcp_config() -> str | None:
    path = config.REPO_DIR / ".mcp.json"
    return str(path) if path.is_file() else None


def start(mode: str = "ask", fresh: bool = False, port: int | None = None) -> dict:
    if mode not in MODES:
        raise ValueError("The mode is ask, auto-edits or plan.")
    found = info()
    if not found["installed"]:
        raise LookupError(f"Claude Code is not installed. Install it with: {found['install']}")
    running = AGENT.proc is not None and AGENT.proc.poll() is None
    if running and AGENT.mode == mode and not fresh:
        return AGENT.describe()
    if running or AGENT.proc is not None:
        stop(quiet=True)
    if fresh:
        AGENT.session = None
        with AGENT.lock:
            AGENT.log.clear()
    AGENT.mode = mode
    args = [found["path"], "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
            "--permission-prompt-tool", "stdio", "--permission-mode", MODES[mode], "--append-system-prompt", NOTE]
    conf = mcp_config()
    if port:
        args += ["--mcp-config", inapp_mcp_config(port), "--strict-mcp-config"]
    elif conf:
        args += ["--mcp-config", conf]
    if AGENT.session:
        args += ["--resume", AGENT.session]
    AGENT.gen += 1
    gen = AGENT.gen
    AGENT.stderr_tail.clear()
    AGENT.streamed.clear()
    AGENT.names.clear()
    set_state("starting")
    try:
        proc = subprocess.Popen(args, cwd=str(config.REPO_DIR), env=child_env() | ({INAPP_VAR: agents.INAPP_TOKEN} if port else {}), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    except OSError as exc:
        set_state("exited")
        raise RuntimeError(f"Claude Code could not start: {exc}")
    AGENT.proc = proc
    threading.Thread(target=_read, args=(proc, gen), name="claude-read", daemon=True).start()
    threading.Thread(target=_drain, args=(proc, gen), name="claude-err", daemon=True).start()
    _write({"type": "control_request", "request_id": "formcel-init", "request": {"subtype": "initialize", "hooks": None}})
    set_state("ready")
    return AGENT.describe()


def send(text: str) -> None:
    if AGENT.proc is None or AGENT.proc.poll() is not None:
        raise LookupError("Claude Code is not running: start it first.")
    publish({"type": "user", "text": text})
    if not _write({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": text}]}, "parent_tool_use_id": None, "session_id": ""}):
        raise RuntimeError("Claude Code did not take the message.")
    set_state("busy")


def stop(quiet: bool = False) -> dict:
    proc = AGENT.proc
    AGENT.gen += 1
    AGENT.proc = None
    for gate in list(AGENT.waiting.values()):
        gate["allow"] = False
        gate["event"].set()
    if proc is not None:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        except OSError:
            pass
    if not quiet:
        publish({"type": "notice", "text": "Stopped."})
    set_state("stopped")
    return AGENT.describe()


TERMINAL_NOTE = ("You are Claude Code running in the terminal dock inside FormCel, the spreadsheet app open on this computer. "
                 "Work on the open workbook with the formcel MCP server's tools: list_commands finds a command, describe_command explains it "
                 "and run_command runs it in the window, where the person sees every change happen. "
                 "Use the formcel-driving skill when it is available.")
INAPP_VAR = agents.INAPP_VAR
_open_lock = threading.Lock()


def program() -> str | None:
    path = cli()
    return path if path and os.path.isfile(path) and os.access(path, os.X_OK) else None


def inapp_mcp_config(port: int) -> str:
    return json.dumps({"mcpServers": {"formcel": {"type": "http", "url": f"http://127.0.0.1:{port}/mcp", "headers": {agents.INAPP_HEADER: "${" + INAPP_VAR + "}"}}}})


def terminal_env() -> dict:
    return {k: v for k, v in terminal.base_env().items() if not k.startswith("CLAUDE") or k in KEEP_ENV} | {INAPP_VAR: agents.INAPP_TOKEN}


def terminal_argv(path: str, port: int, prompt: str | None, resume: str | None) -> list[str]:
    cmd = [path, "--mcp-config", inapp_mcp_config(port), "--allowedTools", "mcp__formcel", "--append-system-prompt", TERMINAL_NOTE]
    if resume:
        cmd += ["--strict-mcp-config", "--resume", resume]
    if prompt:
        cmd += ["--", prompt]
    if os.name == "nt":
        return cmd
    return terminal.login_shell() + ["-c", "exec " + shlex.join(cmd)]


def workdir(document_folder: str | None = None) -> str:
    return document_folder if document_folder and os.path.isdir(document_folder) else str(config.DATA_DIR)


def open_terminal(port: int, prompt: str | None = None, resume: str | None = None, cols: int = 100, rows: int = 30,
                  fresh: bool = False, document_folder: str | None = None) -> dict:
    with _open_lock:
        running = terminal.live_claude()
        if running is not None and not fresh and not resume:
            if prompt:
                terminal.write(running.id, prompt.replace("\r\n", "\n").replace("\r", "\n") + "\r")
            return running.describe()
        path = program()
        if path is None:
            raise LookupError(MISSING)
        title = "Claude Code (from Chat)" if resume else "Claude Code"
        folder = str(config.REPO_DIR) if resume else workdir(document_folder)
        return terminal.open_session(folder, cols, rows, title, terminal_argv(path, port, prompt, resume), terminal_env(), "claude").describe()
