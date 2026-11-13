import asyncio
import json
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..services import collab as cb
from ..services.sharing import lan_state
from ..services.store import store

router = APIRouter()


def who(request: Request) -> str:
    return unquote(request.headers.get("x-formcel-user", "")).strip()[:60]


def client_of(request: Request) -> str | None:
    return request.headers.get("x-formcel-client")


def run(wid: str, fn):
    try:
        return fn()
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid}, or that item is gone.")
    except IndexError:
        raise HTTPException(404, "No such sheet.")
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))


class NoteIn(BaseModel):
    sheet: int = 0
    row: int = Field(ge=0)
    col: int = Field(ge=0)
    text: str = Field(default="", max_length=32_000)


class ThreadIn(BaseModel):
    sheet: int = 0
    row: int = Field(ge=0)
    col: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=8000)
    assign: bool = False


class ReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    assign: bool = False


class ThreadPatch(BaseModel):
    status: str | None = None
    assignee: str | None = Field(default=None, max_length=60)


class ProtectIn(BaseModel):
    sheet: int | None = None
    lines: list[str] = Field(default_factory=list, max_length=200_000)


class VersionIn(BaseModel):
    name: str = Field(default="", max_length=120)


class ShareIn(BaseModel):
    sheet: int = 0
    kind: str = "share"
    perm: str = "view"
    scope: str = "sheet"
    format: str = "html"
    live: bool = True
    days: int | None = Field(default=None, ge=1, le=3650)


class SharePatch(BaseModel):
    live: bool | None = None
    perm: str | None = None


class ChipIn(BaseModel):
    sheet: int = 0
    row: int = Field(ge=0)
    col: int = Field(ge=0)
    kind: str
    label: str = Field(default="", max_length=200)
    value: str = Field(default="", max_length=2000)


class WatchIn(BaseModel):
    sheet: int = 0
    r0: int = Field(ge=0)
    c0: int = Field(ge=0)
    r1: int = Field(ge=0)
    c1: int = Field(ge=0)


class ReadIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=2000)


class ChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class LanIn(BaseModel):
    on: bool


class CursorIn(BaseModel):
    client: str
    user: str = ""
    sheet: int = 0
    row: int = 0
    col: int = 0


def book(wid: str):
    return store()._load(wid)


def people(wid: str, b, extra: str = "") -> list[str]:
    out = cb.people_of(b.collab)
    for p in store().hub.people(wid):
        if p["user"] and p["user"] not in out:
            out.append(p["user"])
    if extra and extra not in out:
        out.append(extra)
    return out


def snapshot(wid: str, b, me: str = "") -> dict:
    mine = [n for n in b.collab["notifications"] if n["to"].lower() == me.lower()] if me else []
    return {"notes": b.collab["notes"], "threads": b.collab["threads"], "people": people(wid, b, me), "protection": b.protection(),
            "notifications": mine[-200:], "chat": b.collab["chat"][-100:], "chips": b.collab["chips"],
            "watch": [w for w in b.collab["watch"] if w["user"].lower() == me.lower()]}


@router.get("/api/workbooks/{wid}/collab")
def get_collab(wid: str, request: Request) -> dict:
    return run(wid, lambda: snapshot(wid, book(wid), who(request)))


@router.put("/api/workbooks/{wid}/notes")
def put_note(wid: str, body: NoteIn, request: Request) -> dict:
    me = who(request)

    def go():
        s = store()
        s.collab_edit(wid, lambda b: cb.set_note(b.collab, body.sheet, body.row, body.col, body.text, me), client_of(request))
        return snapshot(wid, book(wid), me)

    return run(wid, go)


def assign_from(t: dict, text: str, people_list: list[str]) -> None:
    found = cb.mentions(text, people_list)
    if found:
        t["assignee"] = found[0]


@router.post("/api/workbooks/{wid}/threads", status_code=201)
def new_thread(wid: str, body: ThreadIn, request: Request) -> dict:
    me = who(request)

    def go():
        s = store()

        def work(b):
            t = cb.add_thread(b.collab, body.sheet, body.row, body.col, body.text, me)
            known = people(wid, b, me)
            if body.assign:
                assign_from(t, body.text, known)
            cb.notify_thread(b.collab, t, body.text, me, known, body.assign)
            return t

        s.collab_edit(wid, work, client_of(request))
        return snapshot(wid, book(wid), me)

    return run(wid, go)


@router.post("/api/workbooks/{wid}/threads/{tid}/replies", status_code=201)
def reply(wid: str, tid: str, body: ReplyIn, request: Request) -> dict:
    me = who(request)

    def go():
        def work(b):
            t = cb.find_thread(b.collab, tid)
            t["messages"].append({"id": cb.uuid.uuid4().hex[:8], "author": me, "time": cb.stamp(), "text": body.text})
            known = people(wid, b, me)
            if body.assign:
                assign_from(t, body.text, known)
            cb.notify_thread(b.collab, t, body.text, me, known, body.assign)
            return t

        store().collab_edit(wid, work, client_of(request))
        return snapshot(wid, book(wid), me)

    return run(wid, go)


@router.patch("/api/workbooks/{wid}/threads/{tid}")
def patch_thread(wid: str, tid: str, body: ThreadPatch, request: Request) -> dict:
    me = who(request)

    def go():
        def work(b):
            t = cb.find_thread(b.collab, tid)
            if body.status in ("open", "resolved"):
                t["status"] = body.status
            if body.assignee is not None:
                if body.assignee and body.assignee not in people(wid, b, me):
                    raise ValueError("Assign a comment to a person who has taken part in the workbook, or type their name with @ in a message.")
                t["assignee"] = body.assignee
                if body.assignee:
                    cb.notify(b.collab, body.assignee, me, "assign", t["messages"][0]["text"], t["sheet"], t["row"], t["col"], t["id"])

        store().collab_edit(wid, work, client_of(request))
        return snapshot(wid, book(wid), me)

    return run(wid, go)


@router.delete("/api/workbooks/{wid}/threads/{tid}")
def delete_thread(wid: str, tid: str, request: Request) -> dict:
    me = who(request)

    def go():
        def work(b):
            b.collab["threads"].remove(cb.find_thread(b.collab, tid))

        store().collab_edit(wid, work, client_of(request))
        return snapshot(wid, book(wid), me)

    return run(wid, go)


@router.put("/api/workbooks/{wid}/protection")
def put_protection(wid: str, body: ProtectIn, request: Request) -> dict:
    return run(wid, lambda: store().set_protection(wid, body.sheet, body.lines, client_of(request)))


@router.get("/api/workbooks/{wid}/history")
def get_history(wid: str, sheet: int | None = None, r0: int | None = None, c0: int | None = None, r1: int | None = None, c1: int | None = None, user: str | None = None, since: str | None = None, until: str | None = None) -> dict:
    area = (min(r0, r1), min(c0, c1), max(r0, r1), max(c0, c1)) if None not in (r0, c0, r1, c1) else None
    return run(wid, lambda: {"changes": cb.changes(book(wid).collab, sheet, area, 500, user, since, until), "people": cb.history_people(book(wid).collab)})


@router.get("/api/workbooks/{wid}/versions")
def list_versions(wid: str) -> dict:
    return run(wid, lambda: (book(wid), {"versions": [{k: v for k, v in x.items() if k != "epoch"} for x in reversed(store().versions.index(wid))]})[1])


@router.post("/api/workbooks/{wid}/versions", status_code=201)
def save_version(wid: str, body: VersionIn, request: Request) -> dict:
    return run(wid, lambda: store().snapshot_now(wid, body.name.strip(), who(request)))


@router.patch("/api/workbooks/{wid}/versions/{vid}")
def name_version(wid: str, vid: str, body: VersionIn) -> dict:
    return run(wid, lambda: store().versions.rename(wid, vid, body.name))


@router.get("/api/workbooks/{wid}/versions/{vid}/preview")
def preview_version(wid: str, vid: str, sheet: int = 0) -> dict:
    return run(wid, lambda: store().versions.preview(wid, vid, sheet))


@router.post("/api/workbooks/{wid}/versions/{vid}/restore")
def restore_version(wid: str, vid: str, request: Request) -> dict:
    return run(wid, lambda: store().restore_version(wid, vid, who(request), client_of(request)))


def share_view(request: Request, s: dict) -> dict:
    s = {k: v for k, v in s.items() if k != "frozen"}
    lan = lan_state()
    base = lan["base"] if lan["on"] else str(request.base_url).rstrip("/")
    url = f"{base}/published/{s['token']}"
    return {**s, "url": url, "reach": "lan" if lan["on"] else "local", "embed": f'<iframe src="{url}?embed=1" width="640" height="400" style="border:1px solid #ccc" loading="lazy"></iframe>'}


@router.get("/api/workbooks/{wid}/shares")
def list_shares(wid: str, request: Request) -> dict:
    return run(wid, lambda: {"shares": [share_view(request, {"token": t, **s}) for t, s in book(wid).collab["shares"].items() if not s["revoked"]], "lan": lan_state()})


@router.post("/api/workbooks/{wid}/shares", status_code=201)
def make_share(wid: str, body: ShareIn, request: Request) -> dict:
    kind = body.kind if body.kind in ("share", "publish") else "share"
    perm = body.perm if kind == "share" else "view"
    return run(wid, lambda: share_view(request, store().publish_sheet(wid, body.sheet, kind, perm, body.scope, body.format, body.live, body.days)))


@router.patch("/api/workbooks/{wid}/shares/{token}")
def patch_share(wid: str, token: str, body: SharePatch, request: Request) -> dict:
    return run(wid, lambda: share_view(request, store().share_options(wid, token, body.live, body.perm)))


@router.post("/api/workbooks/{wid}/shares/{token}/republish")
def republish_share(wid: str, token: str, request: Request) -> dict:
    return run(wid, lambda: share_view(request, store().republish(wid, token)))


@router.delete("/api/workbooks/{wid}/shares/{token}")
def revoke_share(wid: str, token: str, request: Request) -> dict:
    return run(wid, lambda: share_view(request, store().revoke_share(wid, token)))


@router.post("/api/workbooks/{wid}/presence")
def presence(wid: str, body: CursorIn) -> dict:
    def go():
        book(wid)
        hub = store().hub
        data = {"sheet": body.sheet, "row": body.row, "col": body.col}
        hub.cursor(wid, body.client, data)
        hub.publish(wid, {"type": "presence", "client": body.client, "user": body.user, **data}, body.client)
        return {"people": hub.people(wid)}

    return run(wid, go)


@router.get("/api/workbooks/{wid}/events")
async def events(wid: str, request: Request, client: str, user: str = "") -> StreamingResponse:
    try:
        await asyncio.to_thread(book, wid)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid}.")
    hub = store().hub
    q = hub.join(wid, client, user[:60], asyncio.get_running_loop())

    async def stream():
        try:
            yield "retry: 2000\n\n"
            yield f"data: {json.dumps({'type': 'hello', 'people': hub.people(wid)})}\n\n"
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield ": keepalive\n\n"
        finally:
            hub.leave(wid, client)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
