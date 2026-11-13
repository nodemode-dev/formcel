import asyncio
import json

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from ..services import claude_code, terminal
from .terminal import document_folder, origin_ok, release_socket, require_local, server_port, take_socket

router = APIRouter(prefix="/api/agent/claude", tags=["agent"])
window_router = APIRouter(prefix="/api/claude-code", tags=["agent"])


class StartBody(BaseModel):
    mode: str = Field("ask", max_length=20)
    fresh: bool = False


class SendBody(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)


class AnswerBody(BaseModel):
    id: str = Field(max_length=200)
    allow: bool


@router.get("/status")
def status(request: Request, fresh: bool = False) -> dict:
    require_local(request)
    return claude_code.info(fresh=fresh) | claude_code.AGENT.describe() | {"modes": list(claude_code.MODES)}


@window_router.get("/status")
def window_status(request: Request, fresh: bool = False) -> dict:
    require_local(request)
    tab = next((s.describe() for s in terminal.SESSIONS.values() if s.kind == "claude"), None)
    return claude_code.info(fresh=fresh) | {"folder": claude_code.workdir(document_folder()), "terminal": tab}


@router.post("/start")
def start(body: StartBody, request: Request) -> dict:
    require_local(request)
    try:
        return claude_code.start(body.mode, body.fresh, server_port(request))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except LookupError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/send")
def send(body: SendBody, request: Request) -> dict:
    require_local(request)
    try:
        claude_code.send(body.text)
    except LookupError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return claude_code.AGENT.describe()


@router.post("/stop")
def stop(request: Request) -> dict:
    require_local(request)
    return claude_code.stop()


@router.post("/permission")
def permission(body: AnswerBody, request: Request) -> dict:
    require_local(request)
    if not claude_code.answer(body.id, body.allow):
        raise HTTPException(status_code=404, detail="That question is no longer waiting.")
    return {"ok": True}


@router.websocket("/stream")
async def stream(ws: WebSocket) -> None:
    if not origin_ok(ws.headers.get("origin"), ws.headers.get("host")):
        await ws.close(code=4403)
        return
    if not take_socket():
        await ws.close(code=4429)
        return
    await ws.accept()
    queue: asyncio.Queue = asyncio.Queue()
    claude_code.AGENT.subscribers.add(queue)

    async def outbound() -> None:
        await ws.send_text(json.dumps({"type": "state", **claude_code.AGENT.describe()}))
        for msg in claude_code.backlog():
            await ws.send_text(json.dumps(msg))
        while True:
            await ws.send_text(json.dumps(await queue.get()))

    sender = asyncio.create_task(outbound())
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        release_socket()
        sender.cancel()
        claude_code.AGENT.subscribers.discard(queue)
