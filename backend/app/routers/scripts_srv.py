import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..services import gasrun, gastriggers, jsfn
from ..services.store import store
from urllib.parse import unquote

router = APIRouter()


def book(wid: str):
    try:
        return store().book(wid)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid}. It may have been moved to the Trash.")


def who(request: Request) -> str:
    return unquote(request.headers.get("x-formcel-user", "")).strip()[:60]


@router.get("/workbooks/{wid}/server-scripts")
def overview(wid: str) -> dict:
    b = book(wid)
    with b.lock:
        auto = b.auto or {}
        st = gastriggers.state_of(dict(auto))
        return {
            "available": gasrun.available(),
            "runtime": jsfn.status()["runtime"],
            "functions": gasrun.functions(auto),
            "triggers": st["triggers"],
            "runs": st["runs"][-30:],
            "menus": st["menus"],
            "properties": {k: sorted(v) for k, v in st["props"].items()},
        }


class RunIn(BaseModel):
    fn: str = Field(min_length=1, max_length=120)
    args: list = Field(default_factory=list, max_length=20)


@router.post("/workbooks/{wid}/server-scripts/run")
def run_fn(wid: str, body: RunIn, request: Request) -> dict:
    book(wid)
    try:
        res = gasrun.run(wid, body.fn, body.args, {"type": "menu"}, who(request))
    except gasrun.RunError as e:
        raise HTTPException(422, str(e))
    gastriggers.record(wid, None, body.fn, "manual", res)
    return res


@router.post("/workbooks/{wid}/server-scripts/open")
def opened(wid: str) -> dict:
    book(wid)
    return gastriggers.opened(wid)


class TriggerIn(BaseModel):
    fn: str
    type: str
    every: int = 0
    daily: str = ""
    weekday: str = ""


@router.post("/workbooks/{wid}/server-triggers", status_code=201)
def add_trigger(wid: str, body: TriggerIn, request: Request) -> dict:
    book(wid)
    try:
        return gastriggers.create(wid, body.model_dump(), who(request))
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.delete("/workbooks/{wid}/server-triggers/{tid}", status_code=204)
def remove_trigger(wid: str, tid: str) -> None:
    book(wid)
    try:
        gastriggers.delete(wid, tid)
    except KeyError:
        raise HTTPException(404, "No such trigger.")


class EnableIn(BaseModel):
    enabled: bool


@router.patch("/workbooks/{wid}/server-triggers/{tid}")
def enable_trigger(wid: str, tid: str, body: EnableIn) -> dict:
    book(wid)
    try:
        return gastriggers.set_enabled(wid, tid, body.enabled)
    except KeyError:
        raise HTTPException(404, "No such trigger.")


@router.post("/workbooks/{wid}/server-triggers/{tid}/run")
def run_trigger(wid: str, tid: str) -> dict:
    b = book(wid)
    with b.lock:
        t = next((x for x in gastriggers.state_of(b.auto)["triggers"] if x["id"] == tid), None)
    if t is None:
        raise HTTPException(404, "No such trigger.")
    return gastriggers.execute(wid, t["fn"], t["type"], {"type": t["type"], "at": time.time(), "uid": tid}, tid)
