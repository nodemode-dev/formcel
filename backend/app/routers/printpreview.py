import io
import json
import uuid
import zipfile

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..services.store import FORMAT, now, store

router = APIRouter(prefix="/api")


class CopyIn(BaseModel):
    title: str | None = Field(default=None, max_length=120)


def rewrite(source: zipfile.ZipFile, title: str | None) -> dict:
    doc = json.loads(source.read("workbook.json"))
    if doc.get("format") != FORMAT:
        raise ValueError("not a FormCel workbook")
    wid = uuid.uuid4().hex[:12]
    stamp = now()
    doc.update({"id": wid, "title": (title or f"{doc.get('title', 'Workbook')} copy")[:120], "created": stamp, "modified": stamp})
    target = store().path(wid)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as out:
        out.writestr("mimetype", "application/vnd.formcel+zip")
        out.writestr("workbook.json", json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        for name in source.namelist():
            if name not in ("mimetype", "workbook.json"):
                out.writestr(name, source.read(name))
    return store()._load(wid).meta()


@router.post("/workbooks/{wid}/copy", status_code=201)
def copy_workbook(wid: str, body: CopyIn) -> dict:
    try:
        with zipfile.ZipFile(store().path(wid)) as z:
            return rewrite(z, body.title)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid}.")


@router.post("/import-fcel", status_code=201)
async def import_fcel(request: Request, name: str = "Workbook.fcel") -> dict:
    data = await request.body()
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return await run_in_threadpool(rewrite, z, name.rpartition(".")[0] or name)
    except (KeyError, ValueError, zipfile.BadZipFile):
        raise HTTPException(422, f"FormCel could not read {name}.")


@router.get("/workbooks/{wid}/print-preview.png")
def print_preview(wid: str, sheet: int = 0, scope: str = "sheet", page: int = 0, scale: float = 1.4) -> Response:
    import pypdfium2 as pdfium

    try:
        _, data = store().export_pdf(wid, None if scope == "all" else sheet)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, f"No workbook {wid}.")
    except IndexError:
        raise HTTPException(404, f"No sheet {sheet}.")
    doc = pdfium.PdfDocument(data)
    count = len(doc)
    if not count:
        raise HTTPException(404, "Nothing to print on that sheet.")
    pg = doc[min(max(page, 0), count - 1)]
    image = pg.render(scale=min(max(scale, 0.5), 3.0)).to_pil()
    out = io.BytesIO()
    image.save(out, "PNG")
    return Response(out.getvalue(), media_type="image/png", headers={"X-Pages": str(count), "Cache-Control": "no-store", "Access-Control-Expose-Headers": "X-Pages"})
