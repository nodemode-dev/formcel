from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import bridge

router = APIRouter(prefix="/api")


class CommandIn(BaseModel):
    id: str
    title: str
    description: str
    changes: bool
    keys: str | None = None


class Run(BaseModel):
    params: dict = Field(default_factory=dict)


_catalogue: list[dict] = []
WINDOW_ONLY = ("terminal-", "terminal.", "claude-", "claude.", "chat.", "agent.claude", "agent.chat")
EMPTY = "The catalogue is empty: open the FormCel window (./formcel), wait a few seconds, then ask again."


def find(cid: str) -> dict | None:
    return next((c for c in _catalogue if c.get("id") == cid), None)


def search(text: str = "") -> list[dict]:
    words = text.strip().lower().split()
    return [c for c in _catalogue if all(w in f"{c.get('id', '')} {c.get('title', '')} {c.get('description', '')}".lower() for w in words)]


def window_only(cid: str) -> str | None:
    return f"{cid} is only available in the FormCel window, so a person runs it. Do not retry." if cid.strip().lower().startswith(WINDOW_ONLY) else None


async def execute(cid: str, params: dict) -> dict:
    refusal = window_only(cid)
    if refusal:
        return {"ok": False, "error": refusal}
    if _catalogue and find(cid) is None:
        return {"ok": False, "error": f"No command has the id {cid}. Search with GET /api/commands?text=word."}
    return await bridge.call(cid, params)


@router.get("/commands")
def list_commands(text: str = "") -> dict:
    rows = search(text)
    return {"commands": rows, "count": len(_catalogue), "shown": len(rows), "hint": "" if _catalogue else EMPTY}


@router.put("/commands")
def publish_commands(body: list[CommandIn]) -> dict:
    _catalogue[:] = [c.model_dump() for c in body]
    return {"count": len(_catalogue)}


@router.get("/commands/{cid}")
def describe_command(cid: str) -> dict:
    found = find(cid)
    if found is None:
        raise HTTPException(404, f"No command has the id {cid}. Search with GET /api/commands?text=word.")
    return found


@router.post("/commands/{cid}")
async def run_command(cid: str, body: Run | None = None) -> dict:
    return await execute(cid, body.params if body else {})
