import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from ..services import aiclient, extbooks, extpkg, hostcalls, offline_ai, pquery, ranges, webdata
from ..services.store import store
from . import automation_x, queries, restapi, settings_app, settings_x

router = APIRouter(prefix="/api")


def books(wid: str):
    return store().book(wid)


def missing(wid: str) -> HTTPException:
    return HTTPException(404, f"No workbook {wid}. It may have been moved to the Trash.")


class AutomationIn(BaseModel):
    scripts: list[dict] = Field(default_factory=list, max_length=200)
    queries: list[dict] = Field(default_factory=list, max_length=100)
    buttons: list[dict] = Field(default_factory=list, max_length=200)
    settings: dict = Field(default_factory=dict)


@router.put("/workbooks/{wid}/automation")
def put_automation(wid: str, body: AutomationIn) -> dict:
    try:
        auto = body.model_dump()
        kept = (books(wid).auto or {}).get("server")
        if kept:
            auto["server"] = kept
        return store().set_automation(wid, auto)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


class ResolveIn(BaseModel):
    keys: list[str] = Field(max_length=500)
    fresh: bool = False
    workbook: str = ""


@router.post("/host/resolve")
def resolve(body: ResolveIn) -> dict:
    out = {}
    keys = body.keys
    b = None
    if body.workbook:
        try:
            b = books(body.workbook)
            hostcalls.prepare(b)
            keys = hostcalls.py_order(b, keys)
        except (KeyError, FileNotFoundError):
            b = None
    for k in keys:
        data, note = hostcalls.resolve(k, books, body.fresh, None, body.workbook)
        out[k] = {"data": data, "note": note}
        if b is not None and k.startswith("PY\x1f"):
            with b.lock:
                b.engine.host_set(k, data)
    return {"results": out}


class QueryRunIn(BaseModel):
    query: dict
    fresh: bool = True
    library: dict = Field(default_factory=dict)


@router.post("/queries/run")
def run_query(body: QueryRunIn) -> dict:
    try:
        return pquery.run(body.query, books, body.fresh, body.library)
    except (pquery.QueryError, webdata.FetchError, ValueError, KeyError, FileNotFoundError) as e:
        raise HTTPException(422, f"The query could not run: {e}")


class WebIn(BaseModel):
    url: str


@router.post("/web/tables")
def web_tables(body: WebIn) -> dict:
    try:
        tables = webdata.html_tables(body.url, True)
    except webdata.FetchError as e:
        raise HTTPException(422, f"That page could not be read: {e}")
    return {"tables": [{"rows": len(t), "cols": len(t[0]) if t else 0, "preview": t[:6]} for t in tables]}


class AiSettingsIn(BaseModel):
    kind: str = "openai"
    url: str = ""
    model: str = ""
    key: str | None = None


@router.get("/settings/ai")
def get_ai() -> dict:
    return aiclient.public()


@router.put("/settings/ai")
def put_ai(body: AiSettingsIn) -> dict:
    try:
        return aiclient.update(body.kind, body.url, body.model, body.key)
    except ValueError as e:
        raise HTTPException(422, str(e))


class AssistIn(BaseModel):
    workbook: str
    prompt: str = Field(min_length=1, max_length=20000)
    sheet: str = ""
    selection: str = ""
    selected: str = ""


@router.post("/ai/assist")
def assist(body: AssistIn) -> dict:
    try:
        b = books(body.workbook)
    except (KeyError, FileNotFoundError):
        raise missing(body.workbook)

    def read(ref: str) -> str:
        with b.lock:
            names = b.sheet_names()
            sheet, area = ranges.split_sheet(ref, names)
            a = ranges.parse_area(area)
            if (a[2] - a[0] + 1) * (a[3] - a[1] + 1) > 5000:
                raise ValueError("read at most 5000 cells at a time")
            vals = ranges.grid(b.engine, sheet, a, "typed")
            forms = ranges.grid(b.engine, sheet, a, "input")
        return "\n".join("\t".join(("" if v is None else str(f) if isinstance(f, str) and f.startswith("=") else str(v)) for v, f in zip(rv, rf)) for rv, rf in zip(vals, forms))

    with b.lock:
        sheets = b.sheet_names()
    ctx = {"sheets": sheets, "sheet": body.sheet, "selection": body.selection, "selected": body.selected}
    try:
        return aiclient.assist(body.prompt, ctx, read)
    except aiclient.NotConfigured:
        try:
            return {**offline_ai.plan(body.prompt, ctx, read), "offline": True}
        except ValueError as e:
            raise HTTPException(422, str(e))
    except aiclient.ModelError as e:
        raise HTTPException(502, str(e))


class TokenIn(BaseModel):
    token: str | None = None
    generate: bool = False


@router.get("/settings/api")
def get_api() -> dict:
    return {"enabled": bool(aiclient.api_token())}


@router.put("/settings/api")
def put_api(body: TokenIn) -> dict:
    token = secrets.token_urlsafe(24) if body.generate else (body.token or "").strip()
    aiclient.set_api_token(token)
    return {"enabled": bool(token), "token": token if body.generate else ""}


@router.get("/extensions")
def list_extensions() -> list[dict]:
    return extpkg.listing()


bearer = HTTPBearer(auto_error=False, description="The token made under More, REST API. Calls are open when no token is set.")


def guard(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> None:
    token = aiclient.api_token()
    if token and not secrets.compare_digest((cred.credentials if cred else "").encode(), token.encode()):
        raise HTTPException(401, "Send the API token as Authorization: Bearer TOKEN.", headers={"WWW-Authenticate": "Bearer"})


v1 = APIRouter(prefix="/api/v1", tags=["rest"], dependencies=[Depends(guard)])


def settle(b) -> None:
    hostcalls.prepare(b)
    linked = False
    for _ in range(4):
        with b.lock:
            keys = b.engine.host_pending()
        if not keys:
            break
        for k in hostcalls.py_order(b, keys):
            data, _ = hostcalls.resolve(k, books, auto=b.auto, wid=b.id)
            with b.lock:
                b.engine.host_set(k, data)
            linked = linked or k.startswith("XREF")
    if linked:
        extbooks.persist(b)


def locate(wid: str, sheet: str):
    try:
        b = books(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    names = b.sheet_names()
    if sheet in names:
        return b, names.index(sheet)
    if sheet.isdigit() and int(sheet) < len(names):
        return b, int(sheet)
    raise HTTPException(404, f"No sheet {sheet}. Sheets: {', '.join(names)}.")


@v1.get("/workbooks")
def v1_workbooks() -> list[dict]:
    return [{"id": w["id"], "title": w["title"], "modified": w["modified"], "sheets": w["sheets"]} for w in store().listing()]


@v1.get("/workbooks/{wid}/sheets")
def v1_sheets(wid: str) -> list[dict]:
    try:
        b = books(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    with b.lock:
        return [{"index": i, "name": n, "used": (ranges.used_area(b.engine, i) and f"A1:{ranges.col_name(ranges.used_area(b.engine, i)[3])}{ranges.used_area(b.engine, i)[2] + 1}")} for i, n in enumerate(b.sheet_names())]


@v1.get("/workbooks/{wid}/sheets/{sheet}/values")
def v1_get_values(wid: str, sheet: str, range: str = "", formulas: bool = False) -> dict:
    b, i = locate(wid, sheet)
    settle(b)
    with b.lock:
        try:
            area = ranges.parse_area(range) if range else ranges.used_area(b.engine, i)
        except ValueError as e:
            raise HTTPException(422, str(e))
        if area is None:
            return {"range": "", "values": []}
        if (area[2] - area[0] + 1) * (area[3] - area[1] + 1) > 1_000_000:
            raise HTTPException(422, "Ask for at most 1,000,000 cells at a time.")
        vals = ranges.grid(b.engine, i, area, "input" if formulas else "typed")
    addr = f"{ranges.col_name(area[1])}{area[0] + 1}:{ranges.col_name(area[3])}{area[2] + 1}"
    return {"range": addr, "values": [["" if v is None else v for v in r] for r in vals]}


class ValuesIn(BaseModel):
    values: list[list[str | int | float | bool | None]] = Field(max_length=100_000)


@v1.put("/workbooks/{wid}/sheets/{sheet}/values")
def v1_put_values(wid: str, sheet: str, body: ValuesIn, range: str = "A1") -> dict:
    b, i = locate(wid, sheet)
    try:
        r0, c0, *_ = ranges.parse_area(range)
    except ValueError as e:
        raise HTTPException(422, str(e))
    cells = []
    for dr, row in enumerate(body.values):
        for dc, v in enumerate(row):
            raw = "" if v is None else ("TRUE" if v is True else "FALSE" if v is False else str(v))
            cells.append((r0 + dr, c0 + dc, raw))
    try:
        store().edit(wid, i, cells)
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those cells could not be saved: {e}")
    w = max((len(r) for r in body.values), default=0)
    return {"updated": len(cells), "range": f"{ranges.col_name(c0)}{r0 + 1}:{ranges.col_name(c0 + max(w, 1) - 1)}{r0 + max(len(body.values), 1)}"}


router.include_router(automation_x.router)
router.include_router(queries.router)
router.include_router(settings_x.router)
router.include_router(settings_app.router)
v1.include_router(automation_x.v1)
v1.include_router(restapi.v1)
