from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import vbarun
from ..services.store import store

router = APIRouter()


def book(wid: str):
    try:
        return store().book(wid)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid}. It may have been moved to the Trash.")


class ModuleIn(BaseModel):
    name: str = Field(max_length=31)
    kind: str
    code: str = Field(default="", max_length=2_000_000)
    sheet: str | None = None


class RunIn(BaseModel):
    proc: str = Field(min_length=1, max_length=120)
    args: list = Field(default_factory=list, max_length=20)
    modules: list[ModuleIn] | None = Field(default=None, max_length=500)
    trigger: str = "user"


class EventIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    sheet: str | None = None
    target: dict | None = None
    args: list = Field(default_factory=list, max_length=8)
    modules: list[ModuleIn] | None = Field(default=None, max_length=500)


@router.get("/workbooks/{wid}/vba/runtime")
def status(wid: str) -> dict:
    b = book(wid)
    mods, _ = vbarun.modules_of(b)
    return {"available": vbarun.available(), "security": vbarun.level(b), "modules": len(mods), "functions": vbarun.functions(b)}


@router.post("/workbooks/{wid}/vba/run")
def run(wid: str, body: RunIn) -> dict:
    book(wid)
    mods = [m.model_dump() for m in body.modules] if body.modules is not None else None
    try:
        return vbarun.run(wid, body.proc, body.args, mods, body.trigger if body.trigger in ("user", "event", "function") else "user")
    except vbarun.VbaError as e:
        raise HTTPException(422, str(e))


@router.post("/workbooks/{wid}/vba/event")
def event(wid: str, body: EventIn) -> dict:
    book(wid)
    mods = [m.model_dump() for m in body.modules] if body.modules is not None else None
    spec = {"name": body.name, "sheet": body.sheet, "target": body.target, "args": body.args}
    try:
        return vbarun.fire(wid, spec, mods)
    except vbarun.VbaError as e:
        raise HTTPException(422, str(e))
