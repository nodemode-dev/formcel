from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import spell

router = APIRouter(prefix="/api/spell")


class CheckIn(BaseModel):
    cells: list[tuple[int, int, str]] = Field(max_length=spell.MAX_CELLS)


class WordIn(BaseModel):
    word: str = Field(min_length=1, max_length=64)


@router.post("/check")
def check(body: CheckIn) -> dict:
    return {"issues": spell.check(body.cells), "checked": len(body.cells)}


@router.post("/suggest")
def suggest(body: WordIn) -> dict:
    return {"word": body.word, "suggestions": spell.suggest(body.word)}


@router.get("/dictionary")
def dictionary() -> dict:
    return {"words": spell.listed()}


@router.post("/dictionary")
def add_word(body: WordIn) -> dict:
    try:
        return {"words": spell.add(body.word)}
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.delete("/dictionary/{word}")
def remove_word(word: str) -> dict:
    return {"words": spell.remove(word)}
