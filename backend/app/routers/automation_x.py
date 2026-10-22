import base64

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import extpkg, jsfn, offline_ai, ocr, pqx, pysand, ranges
from ..services.store import now, store

router = APIRouter()
v1 = APIRouter(tags=["rest"])


def books(wid: str):
    return store().book(wid)


def missing(wid: str) -> HTTPException:
    return HTTPException(404, f"No workbook {wid}. It may have been moved to the Trash.")


class PythonIn(BaseModel):
    enabled: bool


@router.get("/settings/python")
def get_python() -> dict:
    return pysand.status()


@router.put("/settings/python")
def put_python(body: PythonIn) -> dict:
    return pysand.set_enabled(body.enabled)


@router.get("/runtime")
def runtime() -> dict:
    return {"ocr": ocr.status(), "javascript": jsfn.status(), "python": pysand.status(), "databases": pqx.drivers()}


class PictureIn(BaseModel):
    data: str = Field(max_length=16 * 1024 * 1024)
    lang: str = "eng"


@router.post("/ocr")
def read_picture(body: PictureIn) -> dict:
    raw = body.data.split(",", 1)[1] if body.data.startswith("data:") else body.data
    try:
        data = base64.b64decode(raw, validate=False)
    except ValueError:
        raise HTTPException(422, "The picture could not be decoded.")
    try:
        return ocr.read_picture(data, body.lang)
    except ocr.OcrUnavailable as e:
        raise HTTPException(501, str(e))
    except ocr.OcrError as e:
        raise HTTPException(422, f"The picture could not be read: {e}")


class SourceIn(BaseModel):
    source: dict


@router.post("/db/schema")
def db_schema(body: SourceIn) -> dict:
    try:
        return {"tables": pqx.schema(body.source)}
    except pqx.QueryError as e:
        raise HTTPException(422, f"The database could not be read: {e}")


class InstallIn(BaseModel):
    path: str | None = None
    zip: str | None = Field(default=None, max_length=8 * 1024 * 1024)


@router.post("/extensions/install", status_code=201)
def install_extension(body: InstallIn) -> dict:
    try:
        if body.zip:
            return extpkg.from_zip(base64.b64decode(body.zip.split(",", 1)[-1]))
        if body.path:
            return extpkg.from_folder(body.path)
    except extpkg.PackageError as e:
        raise HTTPException(422, f"The package was not installed: {e}")
    raise HTTPException(422, "Send a folder or zip path, or a zip.")


@router.delete("/extensions/{pid}", status_code=204)
def remove_extension(pid: str) -> None:
    try:
        extpkg.remove(pid)
    except extpkg.PackageError as e:
        raise HTTPException(404, str(e))


class CleanIn(BaseModel):
    workbook: str
    sheet: str = ""
    range: str
    header: bool = True


@router.post("/ai/clean")
def clean(body: CleanIn) -> dict:
    try:
        b = books(body.workbook)
    except (KeyError, FileNotFoundError):
        raise missing(body.workbook)
    with b.lock:
        names = b.sheet_names()
        ref = body.range
        sheet, area = ranges.split_sheet(ref, names) if "!" in ref else (names.index(body.sheet) if body.sheet in names else 0, ref)
        try:
            a = ranges.parse_area(area)
        except ValueError as e:
            raise HTTPException(422, str(e))
        if (a[2] - a[0] + 1) * (a[3] - a[1] + 1) > 200_000:
            raise HTTPException(422, "Select at most 200,000 cells to check.")
        rows = ranges.grid(b.engine, sheet, a, "typed")
        forms = ranges.grid(b.engine, sheet, a, "input")
        real = frozenset((i[0] - a[0], i[1] - a[1]) for i in b.engine.typed(sheet) if i[2] == "n" and a[0] <= i[0] <= a[2] and a[1] <= i[1] <= a[3])
    live = [[f if isinstance(f, str) and f.startswith("=") else v for v, f in zip(rv, rf)] for rv, rf in zip(rows, forms)]
    found = offline_ai.suggestions(live, body.header, real)
    for s in found:
        s["edits"] = [e for e in s["edits"] if not (isinstance(forms[e[0]][e[1]], str) and forms[e[0]][e[1]].startswith("="))]
        s["count"] = len(s["edits"])
    found = [s for s in found if s["edits"]]
    return {"sheet": names[sheet], "origin": [a[0], a[1]], "suggestions": found}


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


class WorkbookIn(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    template: str | None = None


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class SheetNameIn(BaseModel):
    name: str = Field(min_length=1, max_length=31)


@v1.post("/workbooks", status_code=201, summary="Create a workbook")
def v1_create(body: WorkbookIn) -> dict:
    try:
        return store().create(body.title, body.template)
    except KeyError:
        raise HTTPException(404, f"No template {body.template}.")


@v1.get("/workbooks/{wid}", summary="Read a workbook's summary")
def v1_get(wid: str) -> dict:
    try:
        b = books(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    with b.lock:
        return {"id": b.id, "title": b.title, "created": b.created, "modified": b.modified, "sheets": b.sheet_names()}


@v1.patch("/workbooks/{wid}", summary="Rename a workbook")
def v1_rename(wid: str, body: TitleIn) -> dict:
    try:
        return store().rename(wid, title=body.title)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@v1.delete("/workbooks/{wid}", status_code=204, summary="Move a workbook to the Trash")
def v1_trash(wid: str) -> None:
    try:
        store().to_trash(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@v1.post("/workbooks/{wid}/sheets", status_code=201, summary="Add a sheet")
def v1_add_sheet(wid: str, body: SheetNameIn) -> dict:
    try:
        return store().add_sheet(wid, body.name)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@v1.patch("/workbooks/{wid}/sheets/{sheet}", summary="Rename a sheet")
def v1_rename_sheet(wid: str, sheet: str, body: SheetNameIn) -> dict:
    _, i = locate(wid, sheet)
    try:
        return store().sheet_op(wid, "update", i, name=body.name)
    except (ValueError, IndexError) as e:
        raise HTTPException(422, f"That sheet change was refused: {e}")


@v1.delete("/workbooks/{wid}/sheets/{sheet}", summary="Delete a sheet")
def v1_delete_sheet(wid: str, sheet: str) -> dict:
    b, i = locate(wid, sheet)
    if len(b.sheet_names()) < 2:
        raise HTTPException(422, "A workbook keeps at least one sheet.")
    try:
        return store().sheet_op(wid, "delete", i)
    except (ValueError, IndexError) as e:
        raise HTTPException(422, f"That sheet change was refused: {e}")


def area_of(b, i: int, rng: str) -> tuple[int, int, int, int]:
    try:
        a = ranges.parse_area(rng) if rng else ranges.used_area(b.engine, i)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if a is None:
        raise HTTPException(422, "The sheet is empty; give a range.")
    if (a[2] - a[0] + 1) * (a[3] - a[1] + 1) > 1_000_000:
        raise HTTPException(422, "Use at most 1,000,000 cells at a time.")
    return a


@v1.delete("/workbooks/{wid}/sheets/{sheet}/values", summary="Clear a range of cells")
def v1_clear(wid: str, sheet: str, range: str) -> dict:
    b, i = locate(wid, sheet)
    with b.lock:
        a = area_of(b, i, range)
    cells = [(r, c, "") for r in range(a[0], a[2] + 1) for c in range(a[1], a[3] + 1)]
    try:
        store().edit(wid, i, cells)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    return {"cleared": len(cells)}


@v1.get("/workbooks/{wid}/sheets/{sheet}/formulas", summary="List the formulas in a range with their values")
def v1_formulas(wid: str, sheet: str, range: str = "") -> dict:
    b, i = locate(wid, sheet)
    with b.lock:
        a = area_of(b, i, range)
        forms = ranges.grid(b.engine, i, a, "input")
        vals = ranges.grid(b.engine, i, a, "typed")
    out = []
    for r, (fr, vr) in enumerate(zip(forms, vals)):
        for c, (f, v) in enumerate(zip(fr, vr)):
            if isinstance(f, str) and f.startswith("="):
                out.append({"cell": f"{ranges.col_name(a[1] + c)}{a[0] + r + 1}", "formula": f, "value": "" if v is None else v})
    return {"formulas": out}


class FormulasIn(BaseModel):
    formulas: dict[str, str] = Field(max_length=100_000)


@v1.put("/workbooks/{wid}/sheets/{sheet}/formulas", summary="Write formulas by cell address")
def v1_put_formulas(wid: str, sheet: str, body: FormulasIn) -> dict:
    _, i = locate(wid, sheet)
    cells = []
    for addr, f in body.formulas.items():
        try:
            r, c = ranges.parse_cell(addr)
        except ValueError as e:
            raise HTTPException(422, str(e))
        cells.append((r, c, f if f.startswith("=") else "=" + f))
    try:
        store().edit(wid, i, cells)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those formulas could not be saved: {e}")
    return {"updated": len(cells)}


class StyleIn(BaseModel):
    bold: bool | None = None
    italic: bool | None = None
    underline: bool | None = None
    wrap: bool | None = None
    fill: str | None = Field(default=None, pattern=r"^#?[0-9a-fA-F]{6}$")
    color: str | None = Field(default=None, pattern=r"^#?[0-9a-fA-F]{6}$")
    size: int | None = Field(default=None, ge=1, le=400)
    font: str | None = Field(default=None, max_length=64)
    align: str | None = Field(default=None, pattern=r"^(left|center|right|general)$")


class FormatIn(BaseModel):
    range: str
    number_format: str | None = Field(default=None, max_length=255)
    style: StyleIn | None = None


def patch_of(s: StyleIn) -> str:
    parts = []
    for key, tok in (("bold", "b"), ("italic", "i"), ("underline", "u"), ("wrap", "wrap")):
        v = getattr(s, key)
        if v is not None:
            parts.append(tok if v else "!" + tok)
    if s.fill:
        parts.append("bg:" + s.fill.lstrip("#").lower())
    if s.color:
        parts.append("fc:" + s.color.lstrip("#").lower())
    if s.size:
        parts.append(f"sz:{s.size}")
    if s.font:
        parts.append("ff:" + s.font.replace(";", ""))
    if s.align:
        parts.append("ha:" + s.align)
    return ";".join(parts)


@v1.get("/workbooks/{wid}/sheets/{sheet}/formats", summary="Read number formats and styles in a range")
def v1_get_formats(wid: str, sheet: str, range: str = "") -> dict:
    b, i = locate(wid, sheet)
    with b.lock:
        a = area_of(b, i, range)
        nf = {(r, c): code for r, c, code in b.engine.formats(i) if a[0] <= r <= a[2] and a[1] <= c <= a[3]}
        st = {(r, c): s for r, c, s in b.engine.styles(i) if a[0] <= r <= a[2] and a[1] <= c <= a[3]}
    keys = sorted(set(nf) | set(st))
    return {"formats": [{"cell": f"{ranges.col_name(c)}{r + 1}", "number_format": nf.get((r, c)), "style": st.get((r, c))} for r, c in keys]}


@v1.put("/workbooks/{wid}/sheets/{sheet}/formats", summary="Set a number format or style on a range")
def v1_put_formats(wid: str, sheet: str, body: FormatIn) -> dict:
    b, i = locate(wid, sheet)
    try:
        r0, c0, r1, c1 = ranges.parse_area(body.range)
    except ValueError as e:
        raise HTTPException(422, str(e))
    top, bottom = f"{ranges.col_name(c0)}{r0 + 1}", f"{ranges.col_name(c1)}{r1 + 1}"
    with b.lock:
        try:
            if body.number_format is not None:
                b.engine.set_format(top, bottom, body.number_format, i)
            if body.style is not None:
                patch = patch_of(body.style)
                if patch:
                    b.engine.set_style(top, bottom, patch, i)
        except ValueError as e:
            raise HTTPException(422, f"That format was refused: {e}")
        b.modified = now()
        store()._write(b)
    return {"range": body.range, "number_format": body.number_format, "style": patch_of(body.style) if body.style else None}
