import asyncio
import os
import shutil
import threading
import uuid
from collections import deque

from .. import config

try:
    if os.name == "nt":
        from winpty import PtyProcess
    else:
        from ptyprocess import PtyProcessUnicode as PtyProcess
except ImportError:
    PtyProcess = None

SCROLLBACK = 256 * 1024
MIN_COLS, MIN_ROWS = 10, 4
MISSING_PTY = "The terminal needs ptyprocess (pywinpty on Windows): run ./formcel_oc_install, then restart FormCel."


class Session:
    def __init__(self, sid: str, title: str, cwd: str, proc, kind: str = "shell", argv: list[str] | None = None, env: dict | None = None) -> None:
        self.id = sid
        self.title = title
        self.cwd = cwd
        self.proc = proc
        self.chunks: deque[str] = deque()
        self.size = 0
        self.alive = proc is not None
        self.subscribers: set[asyncio.Queue] = set()
        self.lock = threading.Lock()
        self.gen = 0
        self.cols = 100
        self.rows = 30
        self.kind = kind
        self.argv = argv
        self.env = env

    def describe(self) -> dict:
        return {"id": self.id, "title": self.title, "cwd": self.cwd, "alive": self.alive, "kind": self.kind}

    def keep(self, text: str) -> None:
        with self.lock:
            self.chunks.append(text)
            self.size += len(text)
            while self.size > SCROLLBACK and len(self.chunks) > 1:
                self.size -= len(self.chunks.popleft())

    def scrollback(self) -> str:
        with self.lock:
            return "".join(self.chunks)


SESSIONS: dict[str, Session] = {}
_loop: asyncio.AbstractEventLoop | None = None


def bind(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def call_in_loop(fn, *args) -> None:
    if _loop is not None and not _loop.is_closed():
        _loop.call_soon_threadsafe(fn, *args)


def login_shell() -> list[str]:
    if os.name == "nt":
        return [os.environ.get("COMSPEC", "cmd.exe")]
    shell = os.environ.get("SHELL") or shutil.which("bash") or "/bin/sh"
    return [shell, "-l"]


def engine_port() -> str:
    return os.environ.get("FORMCEL_PORT") or str(config.PORT)


def base_env() -> dict:
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["FORMCEL_TERMINAL"] = "1"
    env["FORMCEL_ENGINE_URL"] = f"http://127.0.0.1:{engine_port()}"
    env["PATH"] = str(config.REPO_DIR) + os.pathsep + env.get("PATH", "")
    return env


def _deliver(session: Session, text: str | None) -> None:
    for q in list(session.subscribers):
        if q.qsize() < 4000:
            q.put_nowait(text)


def _send(session: Session, text: str | None) -> None:
    if _loop is not None and not _loop.is_closed():
        _loop.call_soon_threadsafe(_deliver, session, text)


def _pump(session: Session, proc, gen: int) -> None:
    while True:
        try:
            text = proc.read(65536)
        except (EOFError, OSError):
            break
        if not text:
            continue
        if session.gen != gen:
            return
        session.keep(text)
        _send(session, text)
    if session.gen != gen:
        return
    session.alive = False
    _send(session, None)


def _spawn(cwd: str, cols: int, rows: int, argv: list[str] | None = None, env: dict | None = None):
    if PtyProcess is None:
        raise OSError(MISSING_PTY)
    return PtyProcess.spawn(argv or login_shell(), cwd=cwd, env=env or base_env(), dimensions=(max(MIN_ROWS, rows), max(MIN_COLS, cols)))


def open_session(cwd: str | None = None, cols: int = 100, rows: int = 30, title: str | None = None,
                 argv: list[str] | None = None, env: dict | None = None, kind: str = "shell") -> Session:
    where = cwd or str(config.REPO_DIR)
    if not os.path.isdir(where):
        raise FileNotFoundError(f"There is no folder {where}.")
    proc = _spawn(where, cols, rows, argv, env)
    sid = uuid.uuid4().hex[:12]
    shells = sum(1 for s in SESSIONS.values() if s.kind == "shell")
    session = Session(sid, title or f"Terminal {shells + 1}", where, proc, kind, argv, env)
    session.cols, session.rows = max(MIN_COLS, cols), max(MIN_ROWS, rows)
    SESSIONS[sid] = session
    threading.Thread(target=_pump, args=(session, proc, 0), name=f"pty-{sid}", daemon=True).start()
    return session


def restart(sid: str) -> Session:
    session = get(sid)
    if session.kind not in ("shell", "claude"):
        raise ValueError("The Claude terminal has no shell to restart.")
    old = session.proc
    session.gen += 1
    gen = session.gen
    try:
        old.terminate(force=True)
    except Exception:
        pass
    where = session.cwd if os.path.isdir(session.cwd) else str(config.REPO_DIR)
    proc = _spawn(where, session.cols, session.rows, session.argv, session.env)
    with session.lock:
        session.chunks.clear()
        session.size = 0
    session.proc = proc
    session.alive = True
    _send(session, "\x1bc")
    threading.Thread(target=_pump, args=(session, proc, gen), name=f"pty-{sid}-{gen}", daemon=True).start()
    return session


def agent_session() -> Session:
    session = next((s for s in SESSIONS.values() if s.kind == "agent"), None)
    if session is None:
        sid = uuid.uuid4().hex[:12]
        session = Session(sid, "Claude", str(config.REPO_DIR), None)
        session.kind = "agent"
        SESSIONS[sid] = session
    return session


def agent_write(text: str) -> None:
    session = agent_session()
    text = text.replace("\r\n", "\n").replace("\n", "\r\n")
    session.keep(text)
    _send(session, text)


def write(sid: str, data: str) -> None:
    session = get(sid)
    if session.proc is not None and session.alive:
        session.proc.write(data)


def resize(sid: str, cols: int, rows: int) -> None:
    session = get(sid)
    session.cols, session.rows = max(MIN_COLS, cols), max(MIN_ROWS, rows)
    if session.alive and session.proc is not None:
        session.proc.setwinsize(session.rows, session.cols)


def close(sid: str) -> None:
    session = SESSIONS.pop(sid, None)
    if session is None:
        return
    session.gen += 1
    if session.proc is not None:
        try:
            session.proc.terminate(force=True)
        except Exception:
            pass
    _send(session, None)


def get(sid: str) -> Session:
    session = SESSIONS.get(sid)
    if session is None:
        raise KeyError(sid)
    return session


def live_claude() -> Session | None:
    return next((s for s in SESSIONS.values() if s.kind == "claude" and s.alive), None)


def listing() -> list[dict]:
    return [s.describe() for s in SESSIONS.values()]


def close_all() -> None:
    for sid in list(SESSIONS):
        close(sid)
