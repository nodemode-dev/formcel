import json
import os
import shutil
import threading
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import formcel_engine

from .. import config
from . import templates

FORMAT = "fcel"
FORMAT_VERSION = 1
PREVIEW_ROWS = 8
PREVIEW_COLS = 6


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Book:
    id: str
    title: str
    created: str
    modified: str
    engine: "formcel_engine.Workbook"
    template: str | None = None
    views: list[dict] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    vba: dict[str, bytes] | None = None
    watches: list[list[int]] = field(default_factory=list)

    def fit_views(self) -> None:
        n = len(self.sheet_names())
        self.views = (self.views + [{} for _ in range(n)])[:n]

    def sheet_names(self) -> list[str]:
        return self.engine.sheet_names()

    def preview(self) -> list[list[str]]:
        grid = [["" for _ in range(PREVIEW_COLS)] for _ in range(PREVIEW_ROWS)]
        for r, c, v in self.engine.values(0):
            if r < PREVIEW_ROWS and c < PREVIEW_COLS:
                grid[r][c] = v
        return grid

    def meta(self) -> dict:
        self.fit_views()
        return {"id": self.id, "title": self.title, "created": self.created, "modified": self.modified,
                "sheets": self.sheet_names(), "views": self.views, "template": self.template, "preview": self.preview(), "macros": bool(self.vba)}


class Store:
    def __init__(self, root: Path):
        self.dir = root / "Workbooks"
        self.trash = root / "Trash"
        self.open: dict[str, Book] = {}
        self.guard = threading.Lock()

    def path(self, wid: str, trashed: bool = False) -> Path:
        if not wid.isalnum():
            raise KeyError(wid)
        return (self.trash if trashed else self.dir) / f"{wid}.fcel"

    def _write(self, b: Book) -> None:
        doc = {"format": FORMAT, "version": FORMAT_VERSION, "id": b.id, "title": b.title, "created": b.created,
               "modified": b.modified, "template": b.template, "preview": b.preview(),
               "names": [list(n) for n in b.engine.names()], "tables": b.engine.tables(),
               "theme": b.engine.theme(), "cellStyles": b.engine.cell_styles(),
               "sheets": [{"name": n, "view": b.views[i] if i < len(b.views) else {}, "cells": b.engine.cells(i), "formats": b.engine.formats(i), "styles": b.engine.styles(i), "merges": [list(m) for m in b.engine.merges(i)], "rules": b.engine.rules(i), "filter": b.engine.filter(i), "validations": b.engine.validations(i), "links": b.engine.links(i)} for i, n in enumerate(b.sheet_names())]}
        doc["watches"] = b.watches
        target = self.path(b.id)
        tmp = target.with_suffix(".fcel.tmp")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("mimetype", "application/vnd.formcel+zip")
            z.writestr("workbook.json", json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
            for name, blob in (b.vba or {}).items():
                z.writestr(f"macros/{name}", blob)
        os.replace(tmp, target)

    @staticmethod
    def _read(p: Path) -> dict:
        with zipfile.ZipFile(p) as z:
            doc = json.loads(z.read("workbook.json"))
        if doc.get("format") != FORMAT:
            raise ValueError(f"{p.name} is not a FormCel workbook")
        return doc

    @staticmethod
    def _macros(p: Path) -> dict[str, bytes] | None:
        with zipfile.ZipFile(p) as z:
            parts = {n[len("macros/"):]: z.read(n) for n in z.namelist() if n.startswith("macros/")}
        return parts or None

    def _load(self, wid: str) -> Book:
        with self.guard:
            if wid in self.open:
                return self.open[wid]
            doc = self._read(self.path(wid))
            eng = formcel_engine.Workbook()
            if doc.get("theme"):
                eng.load_theme(doc["theme"])
            if doc.get("cellStyles"):
                eng.load_cell_styles(doc["cellStyles"])
            for i, s in enumerate(doc["sheets"]):
                if i:
                    eng.add_sheet(s["name"])
                else:
                    eng.rename_sheet(0, s["name"])
                eng.load_formats([tuple(c) for c in s.get("formats", [])], i)
                eng.load_styles([tuple(c) for c in s.get("styles", [])], i)
                eng.load_merges([tuple(m) for m in s.get("merges", [])], i)
                eng.load_rules(s.get("rules", []), i)
                eng.load_filter(s.get("filter", ""), i)
                eng.load_validations(s.get("validations", []), i)
                eng.load_links([tuple(c) for c in s.get("links", [])], i)
                eng.load([tuple(c) for c in s["cells"]], i)
            for name, refers in doc.get("names", []):
                try:
                    eng.define_name(name, refers)
                except ValueError:
                    continue
            if doc.get("tables"):
                eng.load_tables(doc["tables"])
            b = Book(wid, doc["title"], doc["created"], doc["modified"], eng, doc.get("template"), [s.get("view") or {} for s in doc["sheets"]])
            b.vba = self._macros(self.path(wid))
            b.watches = [list(w) for w in doc.get("watches", []) if isinstance(w, list) and len(w) == 3]
            self.open[wid] = b
            return b

    def listing(self, trashed: bool = False) -> list[dict]:
        out = []
        folder = self.trash if trashed else self.dir
        for p in folder.glob("*.fcel"):
            try:
                doc = self._read(p)
            except (OSError, ValueError, KeyError, zipfile.BadZipFile):
                continue
            out.append({"id": doc["id"], "title": doc["title"], "created": doc["created"], "modified": doc["modified"],
                        "sheets": [s["name"] for s in doc["sheets"]], "template": doc.get("template"), "preview": doc.get("preview", [])})
        out.sort(key=lambda d: d["modified"], reverse=True)
        return out

    def create(self, title: str | None, template_id: str | None) -> dict:
        eng = formcel_engine.Workbook()
        name = title
        if template_id:
            sheets = templates.sheets_of(template_id)
            if sheets is None:
                raise KeyError(template_id)
            extras = templates.extras_of(template_id)
            for i, (sname, cells) in enumerate(sheets):
                if i:
                    eng.add_sheet(sname)
                else:
                    eng.rename_sheet(0, sname)
                x = extras[i] if i < len(extras) else {}
                eng.load_formats([tuple(c) for c in x.get("formats", [])], i)
                eng.load_styles([tuple(c) for c in x.get("styles", [])], i)
                eng.load(cells, i)
                eng.load_merges([tuple(m) for m in x.get("merges", [])], i)
                eng.load_rules(x.get("rules", []), i)
                eng.load_links([tuple(c) for c in x.get("links", [])], i)
            for n, refers in templates.names_of(template_id):
                eng.define_name(n, refers)
            name = name or templates.catalog()[template_id]["name"]
        stamp = now()
        b = Book(uuid.uuid4().hex[:12], (name or "Untitled workbook")[:120], stamp, stamp, eng, template_id)
        with self.guard:
            self.open[b.id] = b
        self._write(b)
        return b.meta()

    def import_xlsx(self, data: bytes, title: str, kind: str = "xlsx") -> dict:
        from . import ods, xls, xlsx

        book = xls.read(data) if kind == "xls" else ods.read(data) if kind == "ods" else xlsx.read(data)
        notes = list(book["notes"])
        eng = formcel_engine.Workbook()
        if book["theme"] and not eng.load_theme(book["theme"]):
            notes.append("1 theme left out")
        if book["cellStyles"]:
            eng.load_cell_styles(eng.cell_styles() + book["cellStyles"])
        for i, s in enumerate(book["sheets"] or [{"name": "Sheet1", "cells": [], "formats": [], "styles": [], "merges": [], "links": [], "view": {}}]):
            if i:
                eng.add_sheet(s["name"])
            else:
                eng.rename_sheet(0, s["name"])
            eng.load_formats(s["formats"], i)
            eng.load_styles(s["styles"], i)
            eng.load(s["cells"], i)
            eng.load_merges(s["merges"], i)
            eng.load_links(s["links"], i)
            if s.get("rules"):
                kept = eng.load_rules(s["rules"], i)
                if kept < len(s["rules"]):
                    notes.append(f"{len(s['rules']) - kept} conditional formatting rules FormCel could not read left out")
            if s.get("filter") and not eng.load_filter(s["filter"], i):
                notes.append("1 filter FormCel could not read left out")
            if s.get("validations"):
                kept = eng.load_validations(s["validations"], i)
                if kept < len(s["validations"]):
                    notes.append(f"{len(s['validations']) - kept} data validation rules FormCel could not read left out")
        dropped = 0
        for name, refers in book["names"]:
            try:
                eng.define_name(name, refers)
            except ValueError:
                dropped += 1
        if dropped:
            notes.append(f"{dropped} names FormCel could not read left out")
        if book.get("tables"):
            kept = eng.load_tables(book["tables"])
            if kept < len(book["tables"]):
                notes.append(f"{len(book['tables']) - kept} tables FormCel could not read brought in as plain ranges")
        stamp = now()
        b = Book(uuid.uuid4().hex[:12], (title or "Imported workbook")[:120], stamp, stamp, eng, None, [s["view"] for s in book["sheets"]])
        b.vba = book.get("vba")
        if b.vba:
            notes.append("1 macro project kept for saving as .xlsm (FormCel does not run macros)")
        with self.guard:
            self.open[b.id] = b
        self._write(b)
        return {**b.meta(), "notes": notes}

    def import_csv(self, data: bytes, title: str, delimiter: str | None, text_cols: set[int]) -> dict:
        from . import csvio

        cells, info = csvio.cells(data, title, delimiter, text_cols)
        eng = formcel_engine.Workbook()
        eng.rename_sheet(0, (title.rpartition(".")[0] or title)[:31] or "Sheet1")
        eng.load(cells, 0)
        notes = []
        if any(v.startswith("'=") for _, _, v in cells):
            notes.append(f"{sum(1 for _, _, v in cells if v.startswith(chr(39) + '='))} formulas kept as text")
        if info["encoding"] != "UTF-8":
            notes.append(f"1 file read as {info['encoding']}")
        stamp = now()
        b = Book(uuid.uuid4().hex[:12], (title.rpartition(".")[0] or title)[:120], stamp, stamp, eng, None, [{}])
        with self.guard:
            self.open[b.id] = b
        self._write(b)
        return {**b.meta(), "notes": notes}

    def export_text(self, wid: str, sheet: int, delimiter: str) -> tuple[str, str, str]:
        from . import csvio

        b = self._load(wid)
        with b.lock:
            names = b.sheet_names()
            if not 0 <= sheet < len(names):
                raise IndexError(sheet)
            return b.title, names[sheet], csvio.write(b.engine.values(sheet), delimiter)

    def export_pdf(self, wid: str, sheet: int | None) -> tuple[str, bytes]:
        from . import pdf

        b = self._load(wid)
        with b.lock:
            b.fit_views()
            n = len(b.sheet_names())
            if sheet is not None and not 0 <= sheet < n:
                raise IndexError(sheet)
            return b.title, pdf.write(b.engine, b.views, [sheet] if sheet is not None else list(range(n)), b.title)

    def export_ods(self, wid: str) -> tuple[str, bytes]:
        from . import ods

        b = self._load(wid)
        with b.lock:
            b.fit_views()
            return b.title, ods.write(b.engine, b.views)[0]

    def export_xlsx(self, wid: str, macros: bool = False) -> tuple[str, bytes]:
        from . import xlsx

        b = self._load(wid)
        with b.lock:
            b.fit_views()
            if macros and not b.vba:
                raise LookupError(wid)
            return b.title, xlsx.write(b.engine, b.views, b.vba if macros else None)

    def get(self, wid: str) -> dict:
        b = self._load(wid)
        with b.lock:
            n = len(b.sheet_names())
            return {**b.meta(), "watches": b.watches, "names": [list(x) for x in b.engine.names()], "theme": b.engine.theme(), "cellStyles": b.engine.cell_styles(), "cells": [b.engine.cells(i) for i in range(n)], "formats": [b.engine.formats(i) for i in range(n)], "styles": [b.engine.styles(i) for i in range(n)], "merges": [[list(m) for m in b.engine.merges(i)] for i in range(n)], "rules": [b.engine.rules(i) for i in range(n)], "filters": [b.engine.filter(i) for i in range(n)], "validations": [b.engine.validations(i) for i in range(n)], "tables": b.engine.tables(), "links": [b.engine.links(i) for i in range(n)]}

    def set_links(self, wid: str, sheet: int, cells: list[tuple[int, int, str]]) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            b.engine.load_links(cells, sheet)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_rules(self, wid: str, sheet: int, lines: list[str]) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            b.engine.load_rules(lines, sheet)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_watches(self, wid: str, watches: list[list[int]]) -> dict:
        b = self._load(wid)
        with b.lock:
            n = len(b.sheet_names())
            b.watches = [w for w in watches if len(w) == 3 and 0 <= w[0] < n]
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_tables(self, wid: str, lines: list[str]) -> dict:
        b = self._load(wid)
        with b.lock:
            b.engine.load_tables(lines)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_validations(self, wid: str, sheet: int, lines: list[str]) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            b.engine.load_validations(lines, sheet)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_filter(self, wid: str, sheet: int, text: str) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            if not b.engine.load_filter(text, sheet) and text.strip():
                raise ValueError("the filter did not read")
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_look(self, wid: str, theme: str | None = None, cell_styles: list[str] | None = None) -> dict:
        b = self._load(wid)
        with b.lock:
            if theme is not None and not b.engine.load_theme(theme):
                raise ValueError("not a theme FormCel can read")
            if cell_styles is not None:
                b.engine.load_cell_styles(cell_styles)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_merges(self, wid: str, sheet: int, areas: list[tuple[int, int, int, int]]) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            b.engine.load_merges(areas, sheet)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_formats(self, wid: str, sheet: int, cells: list[tuple[int, int, str]], styles: bool = False) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            if styles:
                b.engine.load_styles(cells, sheet)
            else:
                b.engine.load_formats(cells, sheet)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_name(self, wid: str, name: str, refers: str) -> dict:
        b = self._load(wid)
        with b.lock:
            b.engine.define_name(name, refers)
            b.modified = now()
            self._write(b)
            return {"names": [list(n) for n in b.engine.names()]}

    def edit(self, wid: str, sheet: int, cells: list[tuple[int, int, str]]) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            b.engine.load(cells, sheet)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def add_sheet(self, wid: str, name: str) -> dict:
        b = self._load(wid)
        with b.lock:
            idx = b.engine.add_sheet(name[:31])
            b.modified = now()
            self._write(b)
            return {"index": idx, "sheets": b.sheet_names()}

    def shift(self, wid: str, sheet: int, rows: bool, at: int, n: int, insert: bool) -> dict:
        b = self._load(wid)
        with b.lock:
            b.engine.shift(sheet, rows, at, n, insert)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def sheet_op(self, wid: str, op: str, sheet: int, to: int | None = None, name: str | None = None, view: dict | None = None) -> dict:
        b = self._load(wid)
        with b.lock:
            b.fit_views()
            if op == "delete":
                b.engine.delete_sheet(sheet)
                del b.views[sheet]
            elif op == "move" and to is not None:
                b.engine.move_sheet(sheet, to)
                b.views.insert(to, b.views.pop(sheet))
            elif op == "update":
                if name:
                    b.engine.rename_sheet(sheet, name.strip()[:31])
                if view is not None:
                    b.views[sheet] = {**b.views[sheet], **view}
            b.modified = now()
            self._write(b)
            return {"sheets": b.sheet_names(), "views": b.views}

    def rename(self, wid: str, title: str | None = None, sheet: int | None = None, sheet_name: str | None = None) -> dict:
        b = self._load(wid)
        with b.lock:
            if title is not None:
                b.title = title.strip()[:120] or b.title
            if sheet is not None and sheet_name:
                b.engine.rename_sheet(sheet, sheet_name.strip()[:31])
            b.modified = now()
            self._write(b)
            return b.meta()

    def to_trash(self, wid: str) -> None:
        with self.guard:
            self.open.pop(wid, None)
        shutil.move(self.path(wid), self.path(wid, trashed=True))

    def restore(self, wid: str) -> None:
        shutil.move(self.path(wid, trashed=True), self.path(wid))

    def purge(self, wid: str) -> None:
        self.path(wid, trashed=True).unlink()


_store: Store | None = None


def store() -> Store:
    global _store
    if _store is None:
        _store = Store(config.DATA_DIR)
    return _store
