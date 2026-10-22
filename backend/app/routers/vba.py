from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.store import now, store
from ..services.vba import service

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
    header: list[str] = Field(default_factory=list, max_length=40)
    procAttrs: dict[str, list[str]] = Field(default_factory=dict)
    private: bool = False


class ProjectIn(BaseModel):
    modules: list[ModuleIn] = Field(max_length=500)


@router.get("/workbooks/{wid}/vba")
def get_project(wid: str) -> dict:
    b = book(wid)
    with b.lock:
        return service.read(b.vba, b.sheet_names())


@router.put("/workbooks/{wid}/vba")
def put_project(wid: str, body: ProjectIn) -> dict:
    b = book(wid)
    with b.lock:
        titles = b.sheet_names()
        mods = [m.model_dump() for m in body.modules]
        if not b.vba:
            have = {m["name"].lower() for m in mods}
            mods = [m for m in service.blank(titles) if m["name"].lower() not in have] + mods
        try:
            parts = service.write(b.vba, mods, titles)
        except ValueError as e:
            raise HTTPException(422, str(e))
        service.ensure_codenames(parts, titles)
        changed = parts.get(service.BIN) != (b.vba or {}).get(service.BIN)
        b.vba = parts
        if changed:
            b.modified = now()
            store()._write(b)
        return {**service.read(b.vba, titles), "changed": changed}
