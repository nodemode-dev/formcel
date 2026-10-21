from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import templates
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


@router.get("/workbooks/{wid}")
def get_workbook(wid: str) -> dict:
    try:
        return store().get(wid)
    except (KeyError, FileNotFoundError):
        raise missing(wid)


@router.post("/workbooks/{wid}/cells")
def edit_cells(wid: str, body: EditIn) -> dict:
    try:
        return store().edit(wid, body.sheet, body.cells)
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
def shift_cells(wid: str, body: ShiftIn) -> dict:
    try:
        return store().shift(wid, body.sheet, body.rows, body.at, body.n, body.insert)
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
    return templates.listing()
