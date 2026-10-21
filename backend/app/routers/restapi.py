import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import ranges, restmodels as rm
from ..services.store import now, store

v1 = APIRouter()

CHART_TYPES = [
    "column", "column-stacked", "column-100", "bar", "bar-stacked", "bar-100", "line", "area", "area-stacked", "area-100", "pie", "doughnut", "scatter", "bubble", "combo",
    "histogram", "box", "waterfall", "candlestick", "treemap", "sunburst", "funnel", "gauge", "scorecard", "radar", "timeline", "org", "map",
]
LEGENDS = ["right", "bottom", "top", "left", "none"]


def book_of(wid: str):
    try:
        return store().book(wid)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid}. It may have been moved to the Trash.")


def sheet_index(b, sheet: str) -> int:
    names = b.sheet_names()
    if sheet in names:
        return names.index(sheet)
    if sheet.isdigit() and int(sheet) < len(names):
        return int(sheet)
    raise HTTPException(404, f"No sheet {sheet}. Sheets: {', '.join(names)}.")


def commit(b) -> None:
    b.modified = now()
    store()._write(b)


def bad(e: Exception) -> HTTPException:
    return HTTPException(422, str(e))


class NameIn(BaseModel):
    refers: str = Field(min_length=1, max_length=8000, description="What the name stands for, such as =Sheet1!$A$1:$A$10 or =0.2")
    comment: str | None = Field(default=None, max_length=255)


@v1.get("/workbooks/{wid}/names", tags=["names"], summary="List defined names")
def list_names(wid: str) -> dict:
    b = book_of(wid)
    with b.lock:
        notes = {n.upper(): c for n, c in b.engine.name_notes()}
        out = []
        for name, refers in b.engine.names():
            try:
                value = b.engine.name_tool("eval", f"0\t0\t0\t{rm.esc(name)}\t0")
            except Exception:
                value = ""
            out.append({"name": name, "refers": refers, "comment": notes.get(name.upper(), ""), "value": value[1:] if value.startswith("o") else ""})
    return {"names": out}


@v1.put("/workbooks/{wid}/names/{name}", tags=["names"], summary="Create or change a defined name")
def put_name(wid: str, name: str, body: NameIn) -> dict:
    b = book_of(wid)
    with b.lock:
        try:
            b.engine.define_name(name, body.refers)
            if body.comment is not None:
                b.engine.set_name_comment(name, body.comment)
        except ValueError as e:
            raise bad(e)
        commit(b)
        return {"name": name, "refers": next((r for n, r in b.engine.names() if n.upper() == name.upper()), body.refers)}


@v1.delete("/workbooks/{wid}/names/{name}", status_code=204, tags=["names"], summary="Delete a defined name")
def delete_name(wid: str, name: str) -> None:
    b = book_of(wid)
    with b.lock:
        if not any(n.upper() == name.upper() for n, _ in b.engine.names()):
            raise HTTPException(404, f"No name {name}.")
        b.engine.define_name(name, "")
        commit(b)


class TableIn(BaseModel):
    sheet: str = Field(description="Sheet name or index")
    range: str = Field(description="A1 range of the table, header row included when header is true")
    name: str | None = None
    header: bool = True
    style: str | None = Field(default=None, description="For example TableStyleMedium2")
    totalsRow: bool | None = None
    bandedRows: bool | None = None
    bandedColumns: bool | None = None
    firstColumn: bool | None = None
    lastColumn: bool | None = None
    filterButton: bool | None = None


class TablePatch(BaseModel):
    name: str | None = None
    range: str | None = Field(default=None, description="New A1 range; the top-left cell stays")
    style: str | None = None
    totalsRow: bool | None = None
    bandedRows: bool | None = None
    bandedColumns: bool | None = None
    firstColumn: bool | None = None
    lastColumn: bool | None = None
    filterButton: bool | None = None


def table_lines(b) -> list[tuple[str, str]]:
    out = []
    for line in b.engine.tables():
        p = line.split("\t")
        out.append((rm.unesc(p[1]), line))
    return out


def find_table(b, name: str) -> tuple[str, str]:
    for n, line in table_lines(b):
        if n.lower() == name.lower():
            return n, line
    raise HTTPException(404, f"No table {name}.")


@v1.get("/workbooks/{wid}/tables", tags=["tables"], summary="List tables")
def list_tables(wid: str) -> dict:
    b = book_of(wid)
    with b.lock:
        names = b.sheet_names()
        return {"tables": [rm.table_json(line, names) for _, line in table_lines(b)]}


@v1.get("/workbooks/{wid}/tables/{name}", tags=["tables"], summary="Read one table")
def get_table(wid: str, name: str) -> dict:
    b = book_of(wid)
    with b.lock:
        return rm.table_json(find_table(b, name)[1], b.sheet_names())


@v1.post("/workbooks/{wid}/tables", status_code=201, tags=["tables"], summary="Create a table from a range")
def create_table(wid: str, body: TableIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, body.sheet)
    try:
        r0, c0, r1, c1 = rm.area_of(body.range)
    except rm.ModelError as e:
        raise bad(e)
    with b.lock:
        before = {n for n, _ in table_lines(b)}
        try:
            b.engine.create_table(f"{ranges.col_name(c0)}{r0 + 1}", f"{ranges.col_name(c1)}{r1 + 1}", body.header, i)
            made = next((n for n, _ in table_lines(b) if n not in before), None)
            patch = body.model_dump(exclude={"sheet", "range", "header"}, exclude_none=True)
            if made and patch:
                line = rm.table_line(find_table(b, made)[1], patch)
                b.engine.set_table(made, line)
                made = patch.get("name") or made
        except ValueError as e:
            raise bad(e)
        commit(b)
        return rm.table_json(find_table(b, made or "")[1], b.sheet_names())


@v1.patch("/workbooks/{wid}/tables/{name}", tags=["tables"], summary="Rename, restyle or resize a table")
def patch_table(wid: str, name: str, body: TablePatch) -> dict:
    b = book_of(wid)
    with b.lock:
        n, line = find_table(b, name)
        patch = body.model_dump(exclude_none=True)
        try:
            b.engine.set_table(n, rm.table_line(line, patch))
        except (ValueError, rm.ModelError) as e:
            raise bad(e)
        commit(b)
        return rm.table_json(find_table(b, patch.get("name") or n)[1], b.sheet_names())


@v1.delete("/workbooks/{wid}/tables/{name}", status_code=204, tags=["tables"], summary="Convert a table back to a plain range")
def delete_table(wid: str, name: str) -> None:
    b = book_of(wid)
    with b.lock:
        n, _ = find_table(b, name)
        b.engine.remove_table(n)
        commit(b)


class ChartIn(BaseModel):
    type: str = Field(description="One of " + ", ".join(CHART_TYPES))
    range: str = Field(description="Data range, such as A1:C10 on the same sheet or Sheet2!A1:C10")
    title: str = ""
    xTitle: str = ""
    yTitle: str = ""
    legend: str = "right"
    labels: bool = False
    byRows: bool = False
    secondary: list[int] = Field(default_factory=list)
    colors: list[str] | None = None
    min: float | None = None
    max: float | None = None
    logY: bool | None = None
    grid: bool | None = None
    pivot: str | None = None
    cell: str = Field(default="H2", description="Top-left cell of the chart")
    width: int = Field(default=480, ge=80, le=4000)
    height: int = Field(default=288, ge=60, le=4000)
    name: str | None = None
    alt: str | None = None


def chart_object(body: ChartIn, oid: str) -> dict:
    if body.type not in CHART_TYPES:
        raise HTTPException(422, f"type must be one of {', '.join(CHART_TYPES)}")
    if body.legend not in LEGENDS:
        raise HTTPException(422, f"legend must be one of {', '.join(LEGENDS)}")
    try:
        r, c = ranges.parse_cell(body.cell)
        if "!" not in body.range:
            rm.area_of(body.range)
    except (ValueError, rm.ModelError) as e:
        raise bad(e)
    spec = body.model_dump(exclude={"cell", "width", "height", "name", "alt"}, exclude_none=True)
    x, y = c * 100, r * 24
    cols = max(1, round(body.width / 100))
    rows = max(1, round(body.height / 24))
    obj = {"id": oid, "kind": "chart", "x": x, "y": y, "w": body.width, "h": body.height, "name": body.name or f"Chart {oid[:4]}", "chart": spec,
           "anchor": {"r0": r, "c0": c, "dy0": 0, "dx0": 0, "r1": r + rows, "c1": c + cols, "dy1": 0, "dx1": 0}}
    if body.alt:
        obj["alt"] = body.alt
    return obj


def chart_row(i: int, names: list[str], o: dict) -> dict:
    a = o.get("anchor") or {}
    return {"id": o["id"], "sheet": names[i], "name": o.get("name", ""), "cell": f"{ranges.col_name(a.get('c0', 0))}{a.get('r0', 0) + 1}", "width": o.get("w"), "height": o.get("h"), **(o.get("chart") or {})}


@v1.get("/workbooks/{wid}/charts", tags=["charts"], summary="List charts on every sheet")
def list_charts(wid: str) -> dict:
    b = book_of(wid)
    with b.lock:
        names = b.sheet_names()
        return {"charts": [chart_row(i, names, o) for i, objs in enumerate(b.fit_objects()) for o in objs if o.get("kind") == "chart"]}


@v1.post("/workbooks/{wid}/sheets/{sheet}/charts", status_code=201, tags=["charts"], summary="Add a chart")
def add_chart(wid: str, sheet: str, body: ChartIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        obj = chart_object(body, secrets.token_hex(4))
        b.fit_objects()[i].append(obj)
        commit(b)
        return chart_row(i, b.sheet_names(), obj)


def find_chart(b, i: int, cid: str) -> tuple[list, int]:
    objs = b.fit_objects()[i]
    for k, o in enumerate(objs):
        if o.get("id") == cid and o.get("kind") == "chart":
            return objs, k
    raise HTTPException(404, f"No chart {cid} on that sheet.")


@v1.get("/workbooks/{wid}/sheets/{sheet}/charts/{cid}", tags=["charts"], summary="Read a chart")
def get_chart(wid: str, sheet: str, cid: str) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        objs, k = find_chart(b, i, cid)
        return chart_row(i, b.sheet_names(), objs[k])


@v1.put("/workbooks/{wid}/sheets/{sheet}/charts/{cid}", tags=["charts"], summary="Replace a chart's settings")
def put_chart(wid: str, sheet: str, cid: str, body: ChartIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        objs, k = find_chart(b, i, cid)
        objs[k] = chart_object(body, cid)
        commit(b)
        return chart_row(i, b.sheet_names(), objs[k])


@v1.delete("/workbooks/{wid}/sheets/{sheet}/charts/{cid}", status_code=204, tags=["charts"], summary="Delete a chart")
def delete_chart(wid: str, sheet: str, cid: str) -> None:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        objs, k = find_chart(b, i, cid)
        del objs[k]
        commit(b)


class ValueFieldIn(BaseModel):
    field: str
    function: str = "sum"
    name: str | None = None
    show: str = "none"
    baseField: str = ""
    baseItem: str = ""


class FilterFieldIn(BaseModel):
    field: str
    items: list[str] = Field(default_factory=list, description="Items to keep")


class CalcFieldIn(BaseModel):
    name: str
    formula: str


class PivotIn(BaseModel):
    name: str | None = None
    sheet: str = Field(description="Sheet that receives the pivot table")
    cell: str = Field(default="A1", description="Top-left cell of the pivot table")
    source: str = Field(description="Source range with header row, such as Sales!A1:E500")
    table: str = ""
    rows: list[str] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    values: list[ValueFieldIn]
    filters: list[FilterFieldIn] = Field(default_factory=list)
    calculatedFields: list[CalcFieldIn] = Field(default_factory=list)
    rowGrandTotals: bool = True
    columnGrandTotals: bool = True
    subtotals: bool = True
    autoRefresh: bool = False


def pivot_lines(b) -> list[tuple[str, str]]:
    return [(rm.unesc(l.split("\t")[0]), l) for l in b.engine.pivots()]


def find_pivot(b, name: str) -> tuple[str, str]:
    for n, l in pivot_lines(b):
        if n.lower() == name.lower():
            return n, l
    raise HTTPException(404, f"No pivot table {name}.")


def header_of(b, sheet_i: int, area) -> list[str]:
    row = ranges.grid(b.engine, sheet_i, (area[0], area[1], area[0], area[3]), "typed")[0]
    return [("" if v is None else str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)) for v in row]


def build_pivot(b, body: PivotIn, default_name: str | None = None) -> str:
    names = b.sheet_names()
    dest = sheet_index(b, body.sheet)
    try:
        cell = ranges.parse_cell(body.cell)
        src_i, area = rm.sheet_ref(body.source, names, dest)
        data = body.model_dump()
        if default_name and not data.get("name"):
            data["name"] = default_name
        return rm.pivot_line(data, names, header_of(b, src_i, area), dest, cell, (src_i, area), body.table)
    except (ValueError, rm.ModelError) as e:
        raise bad(e)


@v1.get("/workbooks/{wid}/pivots", tags=["pivots"], summary="List pivot tables")
def list_pivots(wid: str) -> dict:
    b = book_of(wid)
    with b.lock:
        names = b.sheet_names()
        return {"pivots": [rm.pivot_json(l, names) for _, l in pivot_lines(b)]}


@v1.get("/workbooks/{wid}/pivots/{name}", tags=["pivots"], summary="Read one pivot table")
def get_pivot(wid: str, name: str) -> dict:
    b = book_of(wid)
    with b.lock:
        return rm.pivot_json(find_pivot(b, name)[1], b.sheet_names())


@v1.post("/workbooks/{wid}/pivots", status_code=201, tags=["pivots"], summary="Create a pivot table")
def create_pivot(wid: str, body: PivotIn) -> dict:
    b = book_of(wid)
    with b.lock:
        line = build_pivot(b, body)
        before = {n for n, _ in pivot_lines(b)}
        try:
            b.engine.create_pivot(line)
        except ValueError as e:
            raise bad(e)
        made = next((n for n, _ in pivot_lines(b) if n not in before), body.name or "")
        commit(b)
        return rm.pivot_json(find_pivot(b, made)[1], b.sheet_names())


@v1.put("/workbooks/{wid}/pivots/{name}", tags=["pivots"], summary="Change a pivot table's fields or options")
def put_pivot(wid: str, name: str, body: PivotIn) -> dict:
    b = book_of(wid)
    with b.lock:
        n, _ = find_pivot(b, name)
        line = build_pivot(b, body, n)
        try:
            b.engine.set_pivot(n, line)
        except ValueError as e:
            raise bad(e)
        commit(b)
        return rm.pivot_json(find_pivot(b, body.name or n)[1], b.sheet_names())


@v1.post("/workbooks/{wid}/pivots/{name}/refresh", tags=["pivots"], summary="Recalculate a pivot table from its source")
def refresh_pivot(wid: str, name: str) -> dict:
    b = book_of(wid)
    with b.lock:
        n, _ = find_pivot(b, name)
        try:
            b.engine.refresh_pivot(n)
        except ValueError as e:
            raise bad(e)
        commit(b)
        return rm.pivot_json(find_pivot(b, n)[1], b.sheet_names())


@v1.delete("/workbooks/{wid}/pivots/{name}", status_code=204, tags=["pivots"], summary="Delete a pivot table and its output")
def delete_pivot(wid: str, name: str) -> None:
    b = book_of(wid)
    with b.lock:
        n, _ = find_pivot(b, name)
        try:
            b.engine.remove_pivot(n)
        except ValueError as e:
            raise bad(e)
        commit(b)


class CfIn(BaseModel):
    range: str
    type: str = Field(description="One of " + ", ".join(rm.CF_TYPES))
    operator: str | None = Field(default=None, description="For type cell: " + ", ".join(rm.CF_OPS))
    value: str | float | None = None
    value2: str | float | None = None
    mode: str | None = None
    text: str | None = None
    period: str | None = None
    unique: bool | None = None
    bottom: bool | None = None
    n: float | None = None
    percent: bool | None = None
    below: bool | None = None
    formula: str | None = None
    points: list[str] | None = Field(default=None, description="Colour scale points: low, high, num:5, pct:50, pctl:90")
    colors: list[str] | None = None
    color: str | None = None
    min: str | None = None
    max: str | None = None
    set: str | None = None
    cuts: list[float] | None = None
    reverse: bool | None = None
    stopIfTrue: bool = False
    style: dict | None = Field(default=None, description="bold, italic, underline, fill, color (hex), size, font, align")


def cf_set(b, i: int, lines: list[str]) -> None:
    try:
        b.engine.set_rules(lines, i)
    except ValueError as e:
        raise bad(e)


@v1.get("/workbooks/{wid}/sheets/{sheet}/conditional-formats", tags=["conditional formats"], summary="List conditional formatting rules of a sheet")
def list_cf(wid: str, sheet: str) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        return {"rules": [{"index": k, **rm.cf_json(l)} for k, l in enumerate(b.engine.rules(i))]}


@v1.post("/workbooks/{wid}/sheets/{sheet}/conditional-formats", status_code=201, tags=["conditional formats"], summary="Add a conditional formatting rule")
def add_cf(wid: str, sheet: str, body: CfIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    try:
        line = rm.cf_line(body.model_dump(exclude_none=True))
    except rm.ModelError as e:
        raise bad(e)
    with b.lock:
        lines = list(b.engine.rules(i))
        cf_set(b, i, lines + [line])
        commit(b)
        return {"index": len(lines), **rm.cf_json(line)}


@v1.put("/workbooks/{wid}/sheets/{sheet}/conditional-formats/{index}", tags=["conditional formats"], summary="Replace a conditional formatting rule")
def put_cf(wid: str, sheet: str, index: int, body: CfIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    try:
        line = rm.cf_line(body.model_dump(exclude_none=True))
    except rm.ModelError as e:
        raise bad(e)
    with b.lock:
        lines = list(b.engine.rules(i))
        if not 0 <= index < len(lines):
            raise HTTPException(404, f"No rule {index}.")
        lines[index] = line
        cf_set(b, i, lines)
        commit(b)
        return {"index": index, **rm.cf_json(line)}


@v1.delete("/workbooks/{wid}/sheets/{sheet}/conditional-formats/{index}", status_code=204, tags=["conditional formats"], summary="Delete a conditional formatting rule")
def delete_cf(wid: str, sheet: str, index: int) -> None:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        lines = list(b.engine.rules(i))
        if not 0 <= index < len(lines):
            raise HTTPException(404, f"No rule {index}.")
        del lines[index]
        cf_set(b, i, lines)
        commit(b)


class ValidationIn(BaseModel):
    range: str
    type: str = Field(default="any", description="One of " + ", ".join(rm.VALID_TYPES))
    operator: str | None = Field(default=None, description="One of " + ", ".join(rm.VALID_OPS))
    value: str | float | None = Field(default=None, description="First limit, a list range such as =$H$1:$H$5, or a custom formula")
    value2: str | float | None = None
    items: list[str] | None = Field(default=None, description="For type list: the choices")
    allowBlank: bool = True
    dropdown: bool = True
    showPrompt: bool = False
    showError: bool = True
    alertStyle: str = "stop"
    promptTitle: str = ""
    promptText: str = ""
    errorTitle: str = ""
    errorText: str = ""
    chips: bool = False
    multiple: bool = False


class CheckIn(BaseModel):
    cell: str
    value: str


@v1.get("/workbooks/{wid}/sheets/{sheet}/validations", tags=["validation"], summary="List data validation rules of a sheet")
def list_validations(wid: str, sheet: str) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        return {"validations": [rm.validation_json(l) for l in b.engine.validations(i)]}


@v1.put("/workbooks/{wid}/sheets/{sheet}/validations", tags=["validation"], summary="Set the data validation rule of a range (replaces any rule on those cells)")
def put_validation(wid: str, sheet: str, body: ValidationIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    try:
        area, line = rm.validation_line(body.model_dump(exclude_none=True))
    except rm.ModelError as e:
        raise bad(e)
    with b.lock:
        try:
            b.engine.set_validation(f"{ranges.col_name(area[1])}{area[0] + 1}", f"{ranges.col_name(area[3])}{area[2] + 1}", line, i)
        except ValueError as e:
            raise bad(e)
        commit(b)
        return {"validations": [rm.validation_json(l) for l in b.engine.validations(i)]}


@v1.delete("/workbooks/{wid}/sheets/{sheet}/validations", status_code=204, tags=["validation"], summary="Remove data validation from a range")
def clear_validation(wid: str, sheet: str, range: str) -> None:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    try:
        area = rm.area_of(range)
    except rm.ModelError as e:
        raise bad(e)
    with b.lock:
        b.engine.set_validation(f"{ranges.col_name(area[1])}{area[0] + 1}", f"{ranges.col_name(area[3])}{area[2] + 1}", "", i)
        commit(b)


@v1.post("/workbooks/{wid}/sheets/{sheet}/validations/check", tags=["validation"], summary="Check whether a value would be accepted by a cell")
def check_validation(wid: str, sheet: str, body: CheckIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        try:
            broken = b.engine.check_input(body.cell, body.value, i)
        except ValueError as e:
            raise bad(e)
    return {"valid": broken is None, "rule": rm.validation_json(broken) if broken else None}


class FilterIn(BaseModel):
    range: str = Field(description="Header row plus the data rows, such as A1:D100")
    columns: list[dict] = Field(default_factory=list, description="Each: {column: 'B'} plus values [..], conditions [{operator, value}] with combine and/or, top {n, bottom, percent}, average above/below, or dynamic such as thismonth")


@v1.get("/workbooks/{wid}/sheets/{sheet}/filter", tags=["filters"], summary="Read the sheet's filter and the rows it hides")
def get_filter(wid: str, sheet: str) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        return {"filter": rm.filter_json(b.engine.filter(i))}


@v1.put("/workbooks/{wid}/sheets/{sheet}/filter", tags=["filters"], summary="Apply a filter to a range")
def put_filter(wid: str, sheet: str, body: FilterIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    try:
        text = rm.filter_text(body.model_dump())
    except (rm.ModelError, ValueError, KeyError) as e:
        raise bad(e)
    with b.lock:
        try:
            b.engine.set_filter(text, i)
        except ValueError as e:
            raise bad(e)
        commit(b)
        return {"filter": rm.filter_json(b.engine.filter(i))}


@v1.post("/workbooks/{wid}/sheets/{sheet}/filter/reapply", tags=["filters"], summary="Apply the filter again after the data changed")
def reapply_filter(wid: str, sheet: str) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        try:
            b.engine.reapply_filter(i)
        except ValueError as e:
            raise bad(e)
        commit(b)
        return {"filter": rm.filter_json(b.engine.filter(i))}


@v1.delete("/workbooks/{wid}/sheets/{sheet}/filter", status_code=204, tags=["filters"], summary="Clear the sheet's filter")
def clear_filter(wid: str, sheet: str) -> None:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    with b.lock:
        b.engine.set_filter("", i)
        commit(b)


class CopyIn(BaseModel):
    name: str | None = Field(default=None, max_length=31)
    position: int | None = Field(default=None, ge=0)
    workbook: str | None = Field(default=None, description="Another workbook id to copy into")


class MoveIn(BaseModel):
    position: int = Field(ge=0)


@v1.post("/workbooks/{wid}/sheets/{sheet}/copy", status_code=201, tags=["sheets"], summary="Copy a sheet")
def copy_sheet(wid: str, sheet: str, body: CopyIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    try:
        return store().copy_sheet(wid, i, body.workbook, body.name, body.position)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, "That destination workbook does not exist.")
    except (IndexError, ValueError) as e:
        raise bad(e)


@v1.put("/workbooks/{wid}/sheets/{sheet}/position", tags=["sheets"], summary="Move a sheet to another position")
def move_sheet(wid: str, sheet: str, body: MoveIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, sheet)
    if body.position >= len(b.sheet_names()):
        raise HTTPException(422, "position is past the last sheet.")
    try:
        return store().sheet_op(wid, "move", i, to=body.position)
    except (ValueError, IndexError) as e:
        raise bad(e)


class EvalIn(BaseModel):
    formula: str = Field(min_length=1, max_length=8000)
    sheet: str = "0"
    cell: str = "A1"


@v1.post("/workbooks/{wid}/formulas/evaluate", tags=["formulas"], summary="Evaluate a formula against this workbook without saving it")
def evaluate(wid: str, body: EvalIn) -> dict:
    b = book_of(wid)
    i = sheet_index(b, body.sheet)
    try:
        r, c = ranges.parse_cell(body.cell)
    except ValueError as e:
        raise bad(e)
    with b.lock:
        reply = b.engine.name_tool("eval", f"{i}\t{r}\t{c}\t{rm.esc(body.formula)}\t0")
    if reply.startswith("e"):
        raise HTTPException(422, reply[1:])
    return {"formula": body.formula, "value": reply[1:]}
