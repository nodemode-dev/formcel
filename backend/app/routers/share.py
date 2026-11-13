import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..services import collab as cb
from ..services.store import store

router = APIRouter()
PAGE = Path(__file__).resolve().parent.parent / "services" / "share_page.html"
RANK = {"view": 0, "comment": 1, "edit": 2}
HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}


class GuestEdit(BaseModel):
    sheet: int = 0
    cells: list[tuple[int, int, str]] = Field(max_length=5000)
    user: str = Field(default="", max_length=60)
    client: str = Field(default="", max_length=40)


class GuestThread(BaseModel):
    sheet: int = 0
    row: int = Field(ge=0)
    col: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=8000)
    user: str = Field(default="", max_length=60)


class GuestReply(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    user: str = Field(default="", max_length=60)


class GuestCursor(BaseModel):
    client: str = Field(max_length=40)
    user: str = Field(default="", max_length=60)
    sheet: int = 0
    row: int = 0
    col: int = 0


class GuestChat(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    user: str = Field(default="", max_length=60)
    client: str = Field(default="", max_length=40)


def grant(token: str, need: str = "view") -> tuple[str, object, dict]:
    found = store().find_share(token)
    if found is None:
        raise HTTPException(404, "This link is not published, has expired or was revoked.")
    wid, b, s = found
    have = s.get("perm", "view") if s.get("kind") == "share" else "view"
    if RANK[have] < RANK[need]:
        raise HTTPException(403, f"This link allows {have} only.")
    return wid, b, s


def ip_of(request: Request) -> str:
    return request.client.host if request.client else ""


def name_of(raw: str) -> str:
    return raw.strip()[:60] or "Guest"


def reach(s: dict, sheet: int, b) -> int:
    if not 0 <= sheet < len(b.sheet_names()):
        raise HTTPException(404, "No such sheet.")
    if s.get("scope", "sheet") != "book" and sheet != s["sheet"]:
        raise HTTPException(403, "This link covers one sheet.")
    return sheet


def work(wid: str, fn, client: str | None = None):
    try:
        return store().collab_edit(wid, fn, client)
    except KeyError:
        raise HTTPException(404, "That item is gone.")


@router.get("/published/{token}")
def published(token: str, request: Request) -> Response:
    wid, b, s = grant(token)
    opts = dict(request.query_params)
    embed = opts.get("embed") in ("1", "true")
    if s.get("kind") == "share" and RANK[s.get("perm", "view")] >= 1:
        store().record_access(wid, token, "", ip_of(request), "open")
        return HTMLResponse(PAGE.read_text("utf-8"), headers=HEADERS)
    out = store().render_share(b, s, embed, opts)
    if out is None:
        raise HTTPException(404, "That sheet is not part of this link.")
    store().record_access(wid, token, "", ip_of(request), "view")
    media, body = out
    return Response(body, media_type=media, headers=HEADERS)


@router.get("/s/{token}/api/state")
def state(token: str, request: Request, sheet: int | None = None, user: str = "") -> dict:
    wid, b, s = grant(token)
    s_store = store()
    i = reach(s, s["sheet"] if sheet is None else sheet, b)
    with b.lock:
        names = b.sheet_names()
        cells = [list(x) for x in b.engine.values(i)]
        styles = [list(x) for x in b.engine.styles(i)]
        threads = [t for t in b.collab["threads"] if t["sheet"] == i]
        notes = {k: v for k, v in b.collab["notes"].items() if k.startswith(f"{i}:")}
        chat = b.collab["chat"][-60:]
        chips = {k: v for k, v in b.collab["chips"].items() if k.startswith(f"{i}:")}
    if sheet is None:
        s_store.record_access(wid, token, user[:60], ip_of(request), "open")
    visible = list(range(len(names))) if s.get("scope") == "book" else [s["sheet"]]
    return {"title": b.title, "perm": s.get("perm", "view"), "sheet": i, "sheets": [[j, names[j]] for j in visible], "cells": cells, "styles": styles,
            "threads": threads, "notes": notes, "chips": chips, "chat": chat, "people": s_store.hub.people(wid)}


@router.get("/s/{token}/api/cell")
def cell(token: str, sheet: int, row: int, col: int) -> dict:
    wid, b, s = grant(token)
    i = reach(s, sheet, b)
    with b.lock:
        return {"input": b.engine.input(f"{cb.col_name(col)}{row + 1}", i)}


@router.post("/s/{token}/api/edit")
def edit(token: str, body: GuestEdit) -> dict:
    wid, b, s = grant(token, "edit")
    i = reach(s, body.sheet, b)
    try:
        return store().edit(wid, i, body.cells, name_of(body.user), body.client or None)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those cells could not be saved: {e}")


@router.post("/s/{token}/api/threads", status_code=201)
def thread(token: str, body: GuestThread) -> dict:
    wid, b, s = grant(token, "comment")
    i = reach(s, body.sheet, b)
    me = name_of(body.user)

    def go(book):
        t = cb.add_thread(book.collab, i, body.row, body.col, body.text, me)
        known = cb.people_of(book.collab) + [p["user"] for p in store().hub.people(wid) if p["user"]]
        cb.notify_thread(book.collab, t, body.text, me, known, False)
        return t

    return work(wid, go)


@router.post("/s/{token}/api/threads/{tid}/replies", status_code=201)
def reply(token: str, tid: str, body: GuestReply) -> dict:
    wid, b, s = grant(token, "comment")
    me = name_of(body.user)

    def go(book):
        t = cb.find_thread(book.collab, tid)
        reach(s, t["sheet"], book)
        t["messages"].append({"id": cb.uuid.uuid4().hex[:8], "author": me, "time": cb.stamp(), "text": body.text})
        known = cb.people_of(book.collab) + [p["user"] for p in store().hub.people(wid) if p["user"]]
        cb.notify_thread(book.collab, t, body.text, me, known, False)
        return t

    return work(wid, go)


@router.post("/s/{token}/api/presence")
def presence(token: str, body: GuestCursor) -> dict:
    wid, b, s = grant(token)
    hub = store().hub
    data = {"sheet": body.sheet, "row": body.row, "col": body.col}
    hub.cursor(wid, body.client, data)
    hub.publish(wid, {"type": "presence", "client": body.client, "user": name_of(body.user), **data}, body.client)
    return {"people": hub.people(wid)}


@router.post("/s/{token}/api/chat", status_code=201)
def chat(token: str, body: GuestChat) -> dict:
    wid, b, s = grant(token, "comment")
    me = name_of(body.user)
    holder: dict = {}

    def go(book):
        holder["m"] = cb.chat_add(book.collab, me, body.text)

    store().collab_edit(wid, go, body.client or None, event="chatsaved")
    store().hub.publish(wid, {"type": "chat", "message": holder["m"]}, body.client or None)
    return holder["m"]


@router.get("/s/{token}/api/events")
async def events(token: str, request: Request, client: str, user: str = "") -> StreamingResponse:
    wid, b, s = await asyncio.to_thread(grant, token)
    hub = store().hub
    q = hub.join(wid, client[:40], name_of(user), asyncio.get_running_loop())

    async def stream():
        try:
            yield "retry: 2000\n\n"
            yield f"data: {json.dumps({'type': 'hello', 'people': hub.people(wid)})}\n\n"
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    if ev.get("type") in ("edit", "presence", "join", "leave", "chat", "collab", "reload"):
                        yield f"data: {json.dumps({k: v for k, v in ev.items() if k != 'told'})}\n\n"
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield ": keepalive\n\n"
        finally:
            hub.leave(wid, client[:40], q)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
