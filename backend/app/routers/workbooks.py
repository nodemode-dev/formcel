import zipfile
from urllib.parse import quote, unquote

import xlrd

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..services import crypto, csvio, templates
from ..services.store import store

router = APIRouter(prefix="/api")


class CreateIn(BaseModel):
    title: str | None = None
    template: str | None = None


class EditIn(BaseModel):
    sheet: int = 0
    cells: list[tuple[int, int, str]] = Field(default_factory=list)


class RenameIn(BaseModel):
    title: str | None = None
    sheet: int | None = None
    sheet_name: str | None = None


class SheetIn(BaseModel):
    name: str


class ShiftIn(BaseModel):
    sheet: int = 0
    rows: bool = True
    at: int = Field(ge=0)
    n: int = Field(ge=1, le=1_048_576)
    insert: bool = True


class SheetUpdateIn(BaseModel):
    name: str | None = None
    view: dict | None = None


class SheetMoveIn(BaseModel):
    to: int = Field(ge=0)


class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    refers: str = ""


class NameToolIn(BaseModel):
    op: str = Field(pattern="^(comment|rename|select|apply)$")
    args: str = Field(max_length=20000)


def missing(wid: str) -> HTTPException:
    return HTTPException(404, f"No workbook {wid}. It may have been moved to the Trash.")


@router.get("/workbooks")
def list_workbooks() -> list[dict]:
    return store().listing()


@router.post("/workbooks", status_code=201)
def create_workbook(body: CreateIn) -> dict:
    try:
        return store().create(body.title, body.template)
    except KeyError:
        raise HTTPException(404, f"No template {body.template}.")


MAX_IMPORT = 100 * 1024 * 1024


TEXT_FILES = ("csv", "tsv", "txt")


@router.post("/import/preview")
async def preview_file(request: Request, name: str, delimiter: str | None = None) -> dict:
    data = await request.body()
    if len(data) > MAX_IMPORT:
        raise HTTPException(413, "That file is over 100 MB.")
    if name.rpartition(".")[2].lower() not in TEXT_FILES:
        raise HTTPException(415, "A preview is only for .csv, .tsv and .txt files.")
    return csvio.preview(data, name, delimiter)


@router.post("/import", status_code=201)
async def import_file(request: Request, name: str = "Imported workbook.xlsx", delimiter: str | None = None, text: str = "") -> dict:
    data = await request.body()
    if len(data) > MAX_IMPORT:
        raise HTTPException(413, "That file is over 100 MB.")
    stem, _, ext = name.rpartition(".")
    ext = ext.lower()
    if ext in TEXT_FILES:
        cols = {int(x) for x in text.split(",") if x.strip().isdigit()}
        return store().import_csv(data, name, delimiter, cols)
    if ext not in ("xlsx", "xlsm", "xls", "ods"):
        raise HTTPException(415, "FormCel opens .xlsx, .xlsm, .xls, .ods, .csv, .tsv and .txt files.")
    try:
        data = crypto.unlock(data, request.headers.get("x-formcel-password"))
    except crypto.PasswordNeeded:
        raise HTTPException(401, f"{name} is protected with a password.")
    except crypto.WrongPassword:
        raise HTTPException(403, "That password does not open the file.")
    try:
        return store().import_xlsx(data, stem or name, "xlsx" if ext == "xlsm" else ext)
    except (KeyError, ValueError, OSError, zipfile.BadZipFile, xlrd.XLRDError) as e:
        raise HTTPException(422, f"FormCel could not read {name}: {e}")


@router.get("/workbooks/{wid}/export.xlsx")
def export_xlsx(wid: str) -> Response:
    try:
        title, data = store().export_xlsx(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    fname = "".join(ch for ch in title if ch not in '\\/:*?"<>|').strip() or "Workbook"
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}.xlsx"})


class LockIn(BaseModel):
    password: str = Field(min_length=1, max_length=255)


@router.post("/workbooks/{wid}/export.xlsx")
def export_locked(wid: str, body: LockIn) -> Response:
    try:
        title, data = store().export_xlsx(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    fname = "".join(ch for ch in title if ch not in '\\/:*?"<>|').strip() or "Workbook"
    return Response(crypto.lock(data, body.password), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}.xlsx"})


@router.get("/workbooks/{wid}/accessibility")
def accessibility(wid: str) -> list[dict]:
    try:
        return store().accessibility(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


class LocaleIn(BaseModel):
    locale: str = Field(max_length=10)


@router.put("/workbooks/{wid}/locale")
def set_locale(wid: str, body: LocaleIn) -> dict:
    try:
        return store().set_locale(wid, body.locale)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("/workbooks/{wid}/export.{kind}")
def export_text(wid: str, kind: str, sheet: int = 0, scope: str = "sheet") -> Response:
    if kind in ("html", "htm"):
        try:
            title, text = store().export_html(wid, None if scope == "all" else sheet)
        except (KeyError, FileNotFoundError):
            raise missing(wid)
        except IndexError:
            raise HTTPException(404, f"No sheet {sheet}.")
        fname = "".join(ch for ch in title if ch not in '\\/:*?"<>|').strip() or "Workbook"
        return Response(text.encode("utf-8"), media_type="text/html; charset=utf-8", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}.html"})
    if kind == "pdf":
        try:
            title, data = store().export_pdf(wid, None if scope == "all" else sheet)
        except (KeyError, FileNotFoundError):
            raise missing(wid)
        except IndexError:
            raise HTTPException(404, f"No sheet {sheet}.")
        fname = "".join(ch for ch in title if ch not in '\\/:*?"<>|').strip() or "Workbook"
        return Response(data, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}.pdf"})
    if kind in ("xlsm", "ods"):
        try:
            title, data = store().export_xlsx(wid, macros=True) if kind == "xlsm" else store().export_ods(wid)
        except (KeyError, FileNotFoundError):
            raise missing(wid)
        except LookupError:
            raise HTTPException(404, "This workbook has no macros to save as .xlsm.")
        fname = "".join(ch for ch in title if ch not in '\\/:*?"<>|').strip() or "Workbook"
        media = "application/vnd.ms-excel.sheet.macroEnabled.12" if kind == "xlsm" else "application/vnd.oasis.opendocument.spreadsheet"
        return Response(data, media_type=media, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}.{kind}"})
    if kind not in ("csv", "tsv"):
        raise HTTPException(404, f"FormCel does not export .{kind}.")
    try:
        title, name, text = store().export_text(wid, sheet, "\t" if kind == "tsv" else ",")
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except IndexError:
        raise HTTPException(404, f"No sheet {sheet}.")
    fname = "".join(ch for ch in (title if name == title else f"{title} - {name}") if ch not in '\\/:*?"<>|').strip() or "Sheet"
    return Response(text.encode("utf-8-sig"), media_type="text/csv" if kind == "csv" else "text/tab-separated-values",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}.{kind}"})


@router.get("/workbooks/{wid}")
def get_workbook(wid: str) -> dict:
    try:
        return store().get(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@router.post("/workbooks/{wid}/cells")
def edit_cells(wid: str, body: EditIn, request: Request, why: str = "") -> dict:
    try:
        return store().edit(wid, body.sheet, body.cells, unquote(request.headers.get("x-formcel-user", "")).strip()[:60], request.headers.get("x-formcel-client"), why)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those cells could not be saved: {e}")


@router.post("/workbooks/{wid}/sheets", status_code=201)
def add_sheet(wid: str, body: SheetIn) -> dict:
    try:
        return store().add_sheet(wid, body.name)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@router.post("/workbooks/{wid}/shift")
def shift_cells(wid: str, body: ShiftIn, request: Request) -> dict:
    try:
        return store().shift(wid, body.sheet, body.rows, body.at, body.n, body.insert, unquote(request.headers.get("x-formcel-user", "")).strip()[:60])
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except ValueError as e:
        raise HTTPException(422, f"Rows or columns could not be shifted: {e}")


@router.post("/workbooks/{wid}/formats")
def set_formats(wid: str, body: EditIn) -> dict:
    try:
        return store().set_formats(wid, body.sheet, body.cells)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those formats could not be saved: {e}")


@router.post("/workbooks/{wid}/styles")
def set_styles(wid: str, body: EditIn) -> dict:
    try:
        return store().set_formats(wid, body.sheet, body.cells, styles=True)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those styles could not be saved: {e}")


class MergesIn(BaseModel):
    sheet: int = 0
    areas: list[tuple[int, int, int, int]] = Field(default_factory=list)


class LookIn(BaseModel):
    theme: str | None = Field(default=None, max_length=2000)
    cell_styles: list[str] | None = Field(default=None, max_length=2000)


@router.put("/workbooks/{wid}/look")
def set_look(wid: str, body: LookIn) -> dict:
    try:
        return store().set_look(wid, body.theme, body.cell_styles)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except ValueError as e:
        raise HTTPException(422, f"That theme or cell style could not be saved: {e}")


@router.post("/workbooks/{wid}/links")
def set_links(wid: str, body: EditIn) -> dict:
    try:
        return store().set_links(wid, body.sheet, body.cells)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those links could not be saved: {e}")


class RulesIn(BaseModel):
    sheet: int = 0
    lines: list[str] = Field(default_factory=list, max_length=5000)


@router.put("/workbooks/{wid}/rules")
def set_rules(wid: str, body: RulesIn) -> dict:
    try:
        return store().set_rules(wid, body.sheet, body.lines)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those conditional formatting rules could not be saved: {e}")


class WatchIn(BaseModel):
    watches: list[list[int]] = Field(default_factory=list, max_length=500)


@router.put("/workbooks/{wid}/watches")
def set_watches(wid: str, body: WatchIn) -> dict:
    try:
        return store().set_watches(wid, body.watches)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@router.put("/workbooks/{wid}/tables")
def set_tables(wid: str, body: RulesIn) -> dict:
    try:
        return store().set_tables(wid, body.lines)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except ValueError as e:
        raise HTTPException(422, f"Those tables could not be saved: {e}")


@router.put("/workbooks/{wid}/pivots")
def set_pivots(wid: str, body: RulesIn) -> dict:
    try:
        return store().set_pivots(wid, body.lines)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except ValueError as e:
        raise HTTPException(422, f"Those PivotTables could not be saved: {e}")


@router.put("/workbooks/{wid}/whatif")
def set_whatif(wid: str, body: RulesIn) -> dict:
    try:
        return store().set_whatif(wid, body.lines)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


class CalcIn(BaseModel):
    cmd: str = Field(max_length=2_000_000)


@router.post("/workbooks/{wid}/calc")
def calc_command(wid: str, body: CalcIn) -> dict:
    try:
        return store().calc_command(wid, body.cmd)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.put("/workbooks/{wid}/validations")
def set_validations(wid: str, body: RulesIn) -> dict:
    try:
        return store().set_validations(wid, body.sheet, body.lines)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those data validation rules could not be saved: {e}")


class ObjectsIn(BaseModel):
    sheet: int = 0
    objects: list[dict] = Field(default_factory=list, max_length=5000)


@router.get("/workbooks/{wid}/objects")
def get_objects(wid: str) -> dict:
    try:
        return {"objects": store().get_objects(wid)}
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@router.put("/workbooks/{wid}/objects")
def set_objects(wid: str, body: ObjectsIn) -> dict:
    try:
        return store().set_objects(wid, body.sheet, body.objects)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except IndexError as e:
        raise HTTPException(422, f"Those charts and pictures could not be saved: {e}")


class FilterIn(BaseModel):
    sheet: int = 0
    text: str = Field(default="", max_length=2_000_000)


@router.put("/workbooks/{wid}/filter")
def set_filter(wid: str, body: FilterIn) -> dict:
    try:
        return store().set_filter(wid, body.sheet, body.text)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"That filter could not be saved: {e}")


@router.put("/workbooks/{wid}/merges")
def set_merges(wid: str, body: MergesIn) -> dict:
    try:
        return store().set_merges(wid, body.sheet, body.areas)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (IndexError, ValueError) as e:
        raise HTTPException(422, f"Those merged cells could not be saved: {e}")


@router.put("/workbooks/{wid}/names")
def set_name(wid: str, body: NameIn) -> dict:
    try:
        return store().set_name(wid, body.name, body.refers)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except ValueError as e:
        raise HTTPException(422, f"That name could not be saved: {e}")


class PropsIn(BaseModel):
    title: str = ""
    subject: str = ""
    author: str = ""
    tags: str = ""
    categories: str = ""
    comments: str = ""
    company: str = ""
    manager: str = ""
    status: str = ""


@router.get("/workbooks/{wid}/properties")
def get_properties(wid: str) -> dict:
    try:
        return store().properties(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@router.put("/workbooks/{wid}/properties")
def put_properties(wid: str, body: PropsIn) -> dict:
    try:
        return store().set_properties(wid, body.model_dump())
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@router.put("/workbooks/{wid}/names/tool")
def name_tool(wid: str, body: NameToolIn) -> dict:
    try:
        return store().name_tool(wid, body.op, body.args)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except ValueError as e:
        raise HTTPException(422, f"That name change was refused: {e}")


def sheet_call(wid: str, *args, **kw) -> dict:
    try:
        return store().sheet_op(wid, *args, **kw)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (ValueError, IndexError) as e:
        raise HTTPException(422, f"That sheet change was refused: {e}")


@router.patch("/workbooks/{wid}/sheets/{sheet}")
def update_sheet(wid: str, sheet: int, body: SheetUpdateIn) -> dict:
    return sheet_call(wid, "update", sheet, name=body.name, view=body.view)


class SheetCopyIn(BaseModel):
    dest: str | None = None
    name: str | None = None
    to: int | None = None


@router.post("/workbooks/{wid}/sheets/{sheet}/copy")
def copy_sheet(wid: str, sheet: int, body: SheetCopyIn) -> dict:
    try:
        return store().copy_sheet(wid, sheet, body.dest, body.name, body.to)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except (ValueError, IndexError) as e:
        raise HTTPException(422, f"That sheet could not be copied: {e}")


@router.post("/workbooks/{wid}/sheets/{sheet}/move")
def move_sheet(wid: str, sheet: int, body: SheetMoveIn) -> dict:
    return sheet_call(wid, "move", sheet, to=body.to)


@router.delete("/workbooks/{wid}/sheets/{sheet}")
def delete_sheet(wid: str, sheet: int) -> dict:
    return sheet_call(wid, "delete", sheet)


@router.patch("/workbooks/{wid}")
def rename_workbook(wid: str, body: RenameIn) -> dict:
    try:
        return store().rename(wid, body.title, body.sheet, body.sheet_name)
    except (KeyError, FileNotFoundError):
        raise missing(wid)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.delete("/workbooks/{wid}", status_code=204)
def trash_workbook(wid: str) -> None:
    try:
        store().to_trash(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@router.get("/trash")
def list_trash() -> list[dict]:
    return store().listing(trashed=True)


@router.post("/trash/{wid}/restore")
def restore_workbook(wid: str) -> dict:
    try:
        store().restore(wid)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid} in the Trash.")
    return {"id": wid}


@router.delete("/trash/{wid}", status_code=204)
def purge_workbook(wid: str) -> None:
    try:
        store().purge(wid)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid} in the Trash.")


@router.get("/templates")
def list_templates() -> dict:
    out = templates.listing()
    mine = store().personal_templates()
    if mine:
        out["categories"].append({"name": "Personal", "count": len(mine)})
        out["templates"] = mine + out["templates"]
    return out


class TemplateIn(BaseModel):
    name: str
    description: str = ""


@router.post("/workbooks/{wid}/template", status_code=201)
def save_as_template(wid: str, body: TemplateIn) -> dict:
    if not body.name.strip():
        raise HTTPException(422, "Give the template a name.")
    try:
        return store().save_template(wid, body.name.strip(), body.description.strip())
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@router.delete("/templates/{tid}", status_code=204)
def delete_template(tid: str) -> None:
    try:
        store().delete_template(tid)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No personal template {tid}.")
