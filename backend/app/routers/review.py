from fastapi import APIRouter, HTTPException, Request

from ..services import collab as cb
from ..services.sharing import lan_set, lan_state
from ..services.store import store
from .collab import ChatIn, ChipIn, LanIn, ReadIn, WatchIn, book, client_of, run, snapshot, who

router = APIRouter()


@router.post("/api/workbooks/{wid}/notifications/read")
def read_notifications(wid: str, body: ReadIn, request: Request) -> dict:
    me = who(request)

    def go():
        def work(b):
            for n in b.collab["notifications"]:
                if n["to"].lower() == me.lower() and (not body.ids or n["id"] in body.ids):
                    n["read"] = True

        store().collab_edit(wid, work, client_of(request), event="notices")
        return snapshot(wid, book(wid), me)

    return run(wid, go)


@router.post("/api/workbooks/{wid}/watch", status_code=201)
def watch_range(wid: str, body: WatchIn, request: Request) -> dict:
    me = who(request)
    if not me:
        raise HTTPException(422, "Set your name before asking to be told about changes.")

    def go():
        store().collab_edit(wid, lambda b: cb.add_watch(b.collab, me, body.sheet, body.r0, body.c0, body.r1, body.c1), client_of(request), event="notices")
        return snapshot(wid, book(wid), me)

    return run(wid, go)


@router.delete("/api/workbooks/{wid}/watch/{wat}")
def unwatch_range(wid: str, wat: str, request: Request) -> dict:
    me = who(request)

    def go():
        def work(b):
            b.collab["watch"] = [w for w in b.collab["watch"] if not (w["id"] == wat and w["user"] == me)]

        store().collab_edit(wid, work, client_of(request), event="notices")
        return snapshot(wid, book(wid), me)

    return run(wid, go)


@router.post("/api/workbooks/{wid}/chat", status_code=201)
def post_chat(wid: str, body: ChatIn, request: Request) -> dict:
    me = who(request) or "Someone"
    holder: dict = {}

    def go():
        def work(b):
            holder["m"] = cb.chat_add(b.collab, me, body.text)

        store().collab_edit(wid, work, client_of(request), event="chatsaved")
        store().hub.publish(wid, {"type": "chat", "message": holder["m"]}, client_of(request))
        return holder["m"]

    return run(wid, go)


@router.post("/api/workbooks/{wid}/chips", status_code=201)
def add_chip(wid: str, body: ChipIn, request: Request) -> dict:
    me = who(request)

    def go():
        store().collab_edit(wid, lambda b: cb.set_chip(b.collab, body.sheet, body.row, body.col, body.kind, body.label, body.value), client_of(request))
        return snapshot(wid, book(wid), me)

    return run(wid, go)


@router.delete("/api/workbooks/{wid}/chips/{sheet}/{row}/{col}/{cid}")
def remove_chip(wid: str, sheet: int, row: int, col: int, cid: str, request: Request) -> dict:
    me = who(request)

    def go():
        store().collab_edit(wid, lambda b: cb.drop_chip(b.collab, sheet, row, col, cid), client_of(request))
        return snapshot(wid, book(wid), me)

    return run(wid, go)


@router.get("/api/workbooks/{wid}/activity")
def get_activity(wid: str) -> dict:
    return run(wid, lambda: cb.activity(book(wid).collab, store().hub.people(wid)))


@router.get("/api/lan")
def get_lan() -> dict:
    return lan_state()


@router.put("/api/lan")
def put_lan(body: LanIn) -> dict:
    return lan_set(body.on)
