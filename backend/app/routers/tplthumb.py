from fastapi import APIRouter, HTTPException, Response

from ..services import tplthumb

router = APIRouter(prefix="/api")


@router.get("/templates/{tid}/thumb")
def template_thumb(tid: str, response: Response) -> dict:
    out = tplthumb.thumb(tid)
    if out is None:
        raise HTTPException(404, f"No document template {tid}.")
    response.headers["Cache-Control"] = "public, max-age=3600"
    return out
