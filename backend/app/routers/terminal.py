import asyncio
import json
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from .. import config
from ..services import claude_code, terminal

router = APIRouter(prefix="/api/terminal", tags=["terminal"])


_LOOPBACK = {"localhost", "127.0.0.1", "::1", "tauri.localhost"}


def _loopback(netloc: str | None) -> bool:
    return bool(netloc) and (urlparse(f"//{netloc}").hostname or "") in _LOOPBACK


def origin_ok(origin: str | None, host: str | None) -> bool:
    if not _loopback(host):
        return False
    if not origin or origin in config.window_origins():
        return True
    parsed = urlparse(origin)
    return parsed.scheme in ("http", "https", "tauri") and (parsed.hostname or "") in _LOOPBACK


def require_local(request: Request) -> None:
    if not origin_ok(request.headers.get("origin"), request.headers.get("host")):
        raise HTTPException(status_code=403, detail="Only the FormCel window may use the terminals.")


MAX_SOCKETS = 24
_sockets = 0


def take_socket() -> bool:
    global _sockets
    if _sockets >= MAX_SOCKETS:
        return False
    _sockets += 1
    return True


def release_socket() -> None:
    global _sockets
    _sockets = max(0, _sockets - 1)


class OpenBody(BaseModel):
    cols: int = Field(100, ge=10, le=500)
    rows: int = Field(30, ge=4, le=200)
    title: str | None = Field(None, max_length=60)


class SizeBody(BaseModel):
    cols: int = Field(ge=10, le=500)
    rows: int = Field(ge=4, le=200)


class ClaudeBody(BaseModel):
    prompt: str | None = Field(None, max_length=100_000)
    resume: str | None = Field(None, max_length=200)
    cols: int | None = None
    rows: int | None = None
    fresh: bool = False


def server_port(request: Request) -> int:
    server = request.scope.get("server")
    return server[1] if server and server[1] else int(terminal.engine_port())


def document_folder() -> str | None:
    folder = config.DATA_DIR / "Workbooks"
    return str(folder) if folder.is_dir() else None


def _session(sid: str) -> terminal.Session:
    try:
        return terminal.get(sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="There is no such terminal.")


@router.get("")
def list_terminals(request: Request) -> dict:
    require_local(request)
    return {"terminals": terminal.listing()}


@router.post("")
def open_terminal(body: OpenBody, request: Request) -> dict:
    require_local(request)
    try:
        return terminal.open_session(cols=body.cols, rows=body.rows, title=body.title).describe()
    except (OSError, FileNotFoundError) as exc:
        raise HTTPException(status_code=500, detail=f"The shell could not start: {exc}")


@router.post("/claude")
def open_claude(body: ClaudeBody, request: Request) -> dict:
    require_local(request)
    try:
        return claude_code.open_terminal(server_port(request), body.prompt, body.resume, min(max(body.cols or 100, 10), 500), min(max(body.rows or 30, 4), 200), body.fresh, document_folder())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Claude Code could not start: {exc}")


@router.post("/{sid}/resize")
def resize_terminal(sid: str, body: SizeBody, request: Request) -> dict:
    require_local(request)
    _session(sid)
    terminal.resize(sid, body.cols, body.rows)
    return {"ok": True}


@router.post("/{sid}/restart")
def restart_terminal(sid: str, request: Request) -> dict:
    require_local(request)
    _session(sid)
    try:
        return terminal.restart(sid).describe()
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"The shell could not start: {exc}")


@router.delete("/{sid}")
def close_terminal(sid: str, request: Request) -> dict:
    require_local(request)
    terminal.close(sid)
    return {"ok": True}


@router.websocket("/{sid}/stream")
async def attach(ws: WebSocket, sid: str) -> None:
    if not origin_ok(ws.headers.get("origin"), ws.headers.get("host")):
        await ws.close(code=4403)
        return
    if not take_socket():
        await ws.close(code=4429)
        return
    await ws.accept()
    try:
        session = terminal.get(sid)
    except KeyError:
        release_socket()
        await ws.close(code=4404)
        return
    queue: asyncio.Queue = asyncio.Queue()
    session.subscribers.add(queue)

    async def outbound() -> None:
        backlog = session.scrollback()
        if backlog:
            await ws.send_text(backlog)
        if not session.alive and session.kind != "agent":
            await ws.send_bytes(json.dumps({"type": "exit"}).encode())
        while True:
            text = await queue.get()
            if text is None:
                await ws.send_bytes(json.dumps({"type": "exit"}).encode())
                continue
            await ws.send_text(text)

    sender = asyncio.create_task(outbound())
    try:
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "input" and session.alive and session.kind != "agent":
                terminal.write(sid, str(msg.get("data", "")))
            elif msg.get("type") == "resize":
                try:
                    terminal.resize(sid, int(msg.get("cols", 80)), int(msg.get("rows", 24)))
                except (TypeError, ValueError):
                    continue
    except WebSocketDisconnect:
        pass
    finally:
        release_socket()
        sender.cancel()
        session.subscribers.discard(queue)
