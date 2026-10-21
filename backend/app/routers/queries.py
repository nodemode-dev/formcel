from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import mtext, pquery, qgraph, scheduler, webdata
from ..services.store import store

router = APIRouter()


class TextIn(BaseModel):
    query: dict
    library: dict = Field(default_factory=dict)


class ParseIn(BaseModel):
    text: str = Field(max_length=500_000)
    library: dict = Field(default_factory=dict)


@router.post("/queries/text")
def query_text(body: TextIn) -> dict:
    try:
        return {"text": mtext.to_text(body.query, body.library)}
    except pquery.QueryError as e:
        raise HTTPException(422, str(e))


@router.post("/queries/parse")
def query_parse(body: ParseIn) -> dict:
    try:
        return mtext.from_text(body.text, body.library)
    except pquery.QueryError as e:
        raise HTTPException(422, str(e))


class GraphIn(BaseModel):
    library: dict


@router.post("/queries/graph")
def query_graph(body: GraphIn) -> dict:
    return qgraph.graph(body.library)


class RefreshIn(BaseModel):
    ids: list[str] | None = None


@router.post("/workbooks/{wid}/queries/refresh")
def refresh_queries(wid: str, body: RefreshIn) -> dict:
    try:
        b = store().book(wid)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid}. It may have been moved to the Trash.")
    with b.lock:
        library = {x["id"]: x for x in (b.auto.get("queries") or []) if x.get("id")}
    try:
        order = qgraph.refresh_order(library, body.ids)
    except ValueError as e:
        raise HTTPException(422, str(e))
    done, failed = [], []
    for qid in order:
        try:
            done.append({"id": qid, "name": library[qid].get("name"), **scheduler.refresh(wid, qid)})
        except (pquery.QueryError, webdata.FetchError, ValueError, KeyError, FileNotFoundError) as e:
            failed.append({"id": qid, "name": library[qid].get("name"), "error": str(e)})
    return {"refreshed": done, "failed": failed}
