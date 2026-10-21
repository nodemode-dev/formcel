from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api")


class CommandIn(BaseModel):
    id: str
    title: str
    description: str
    changes: bool
    keys: str | None = None


_catalogue: list[dict] = []


@router.get("/commands")
def list_commands() -> dict:
    return {"commands": _catalogue, "count": len(_catalogue), "run": "Running a command needs the agent bridge (DEV_PLAN Phase 10)."}


@router.put("/commands")
def publish_commands(body: list[CommandIn]) -> dict:
    _catalogue[:] = [c.model_dump() for c in body]
    return {"count": len(_catalogue)}
