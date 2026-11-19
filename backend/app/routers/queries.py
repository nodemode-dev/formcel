import asyncio
import json
import os
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import mtext, pquery, qgraph, scheduler, trust, webdata
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
        except (pquery.QueryError, webdata.FetchError, ValueError, KeyError, FileNotFoundError, PermissionError) as e:
            failed.append({"id": qid, "name": library[qid].get("name"), "error": str(e)})
    return {"refreshed": done, "failed": failed}


class DbIn(BaseModel):
    path: str = Field(max_length=4096)
    sql: str = Field(max_length=100_000)
    params: dict | None = None


def _auto(wid: str) -> dict:
    try:
        b = store().book(wid)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid}. It may have been moved to the Trash.")
    with b.lock:
        return dict(b.auto or {})


@router.post("/workbooks/{wid}/db/query")
def db_query(wid: str, body: DbIn) -> dict:
    _auto(wid)
    try:
        t = pquery.sqlite_table(body.path, body.sql, body.params)
    except pquery.QueryError as e:
        raise HTTPException(422, str(e))
    return {"columns": t.cols, "rows": t.rows}


@router.post("/workbooks/{wid}/db/exec")
def db_exec(wid: str, body: DbIn) -> dict:
    if not pquery.write_allowed(_auto(wid), body.path, wid):
        raise HTTPException(403, pquery.WRITE_REFUSED)
    try:
        return pquery.sqlite_exec(body.path, body.sql, body.params)
    except pquery.QueryError as e:
        raise HTTPException(422, str(e))


class DbAllowIn(BaseModel):
    path: str = Field(max_length=4096)
    allow: bool


@router.get("/workbooks/{wid}/db/allowed")
def db_allowed(wid: str, path: str = "") -> dict:
    return {"allowed": pquery.write_allowed(_auto(wid), path, wid)}


@router.put("/workbooks/{wid}/db/allowed")
def db_allow(wid: str, body: DbAllowIn) -> dict:
    _auto(wid)
    try:
        pquery.record_allow(wid, body.path, body.allow)
    except pquery.QueryError as e:
        raise HTTPException(422, str(e))
    return {"allowed": body.allow}


class TrustIn(BaseModel):
    external: bool | None = None
    scripts: bool | None = None


@router.get("/workbooks/{wid}/trust")
def get_trust(wid: str) -> dict:
    return {"external": None, "scripts": None, **trust.get(wid), "asked": wid in trust.wanting}


@router.put("/workbooks/{wid}/trust")
def put_trust(wid: str, body: TrustIn) -> dict:
    _auto(wid)
    return {"external": None, "scripts": None, **trust.put(wid, body.model_dump())}


class PyRunIn(BaseModel):
    name: str = Field(max_length=200)
    event: dict | None = None
    record: dict | None = None


@router.post("/workbooks/{wid}/py/run")
def py_run(wid: str, body: PyRunIn) -> dict:
    from ..services import pysand, pyxl

    auto = _auto(wid)
    if not pysand.enabled():
        raise HTTPException(403, "Python is off. Turn on Python cells in Preferences to run Python handlers.")
    settings = auto.get("settings") or {}
    code = (settings.get("pyHandlers") or {}).get(body.name)
    if not isinstance(code, str):
        raise HTTPException(404, f"No Python handler is named {body.name}.")
    b = store().book(wid)
    try:
        out = pysand.run(code, [], lambda ref: pyxl.read(b, ref), db={"path": settings.get("dbPath") or "", "auto": auto, "wid": wid}, handler=True, context={"event": body.event or {}, "record": body.record})
    except pysand.PyError as e:
        raise HTTPException(422, f"{body.name}: {e}")
    reply = {"value": out["value"], "printed": out["print"], "writes": out["writes"]}
    if body.record is not None:
        reply["record"] = out["record"] if isinstance(out.get("record"), dict) else body.record
    return reply


FORMTXT_DOWN = "FormTxt is not running. Open it and try again."


class ReportIn(BaseModel):
    template: str = Field(min_length=1, max_length=200)
    sql: str = Field(max_length=100_000)
    out: str | None = Field(default=None, max_length=4096)


def formtxt_port() -> int:
    try:
        return int(os.environ.get("FORMTXT_ENGINE_PORT") or 8210)
    except ValueError:
        return 8210


@router.post("/workbooks/{wid}/report")
async def run_report(wid: str, body: ReportIn) -> dict:
    path = str(((_auto(wid).get("settings") or {}).get("dbPath")) or "")
    if not path:
        raise HTTPException(422, "This workbook has no database yet. Run data.dbAllowWrite or data.dbQuery with a full path first.")
    payload = {"template": body.template, "data": {"path": path, "sql": body.sql}, "mode": "list", "format": "pdf", "out": body.out}
    req = urllib.request.Request(f"http://127.0.0.1:{formtxt_port()}/api/reports/run", data=json.dumps(payload).encode("utf-8"), headers={"content-type": "application/json"}, method="POST")

    def send() -> dict:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8") or "{}")

    try:
        return await asyncio.to_thread(send)
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8") or "{}").get("detail") or str(e)
        except ValueError:
            detail = str(e)
        raise HTTPException(502, f"FormTxt could not make the report: {detail}")
    except (urllib.error.URLError, ConnectionError, TimeoutError):
        raise HTTPException(503, FORMTXT_DOWN)
    except ValueError:
        raise HTTPException(502, "FormTxt answered with something that is not JSON.")
