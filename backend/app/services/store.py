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
                "sheets": self.sheet_names(), "views": self.views, "template": self.template, "preview": self.preview()}


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
               "names": [list(n) for n in b.engine.names()],
               "sheets": [{"name": n, "view": b.views[i] if i < len(b.views) else {}, "cells": b.engine.cells(i), "formats": b.engine.formats(i), "styles": b.engine.styles(i)} for i, n in enumerate(b.sheet_names())]}
        target = self.path(b.id)
        tmp = target.with_suffix(".fcel.tmp")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("mimetype", "application/vnd.formcel+zip")
            z.writestr("workbook.json", json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        os.replace(tmp, target)

    @staticmethod
    def _read(p: Path) -> dict:
        with zipfile.ZipFile(p) as z:
            doc = json.loads(z.read("workbook.json"))
        if doc.get("format") != FORMAT:
            raise ValueError(f"{p.name} is not a FormCel workbook")
        return doc

    def _load(self, wid: str) -> Book:
        with self.guard:
            if wid in self.open:
                return self.open[wid]
            doc = self._read(self.path(wid))
            eng = formcel_engine.Workbook()
            for i, s in enumerate(doc["sheets"]):
                if i:
                    eng.add_sheet(s["name"])
                else:
                    eng.rename_sheet(0, s["name"])
                eng.load_formats([tuple(c) for c in s.get("formats", [])], i)
                eng.load_styles([tuple(c) for c in s.get("styles", [])], i)
                eng.load([tuple(c) for c in s["cells"]], i)
            for name, refers in doc.get("names", []):
                try:
                    eng.define_name(name, refers)
                except ValueError:
                    continue
            b = Book(wid, doc["title"], doc["created"], doc["modified"], eng, doc.get("template"), [s.get("view") or {} for s in doc["sheets"]])
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
            for i, (sname, cells) in enumerate(sheets):
                if i:
                    eng.add_sheet(sname)
                else:
                    eng.rename_sheet(0, sname)
                eng.load(cells, i)
            for n, refers in templates.names_of(template_id):
                eng.define_name(n, refers)
            name = name or templates.catalog()[template_id]["name"]
        stamp = now()
        b = Book(uuid.uuid4().hex[:12], (name or "Untitled workbook")[:120], stamp, stamp, eng, template_id)
        with self.guard:
            self.open[b.id] = b
        self._write(b)
        return b.meta()

    def get(self, wid: str) -> dict:
        b = self._load(wid)
        with b.lock:
            n = len(b.sheet_names())
            return {**b.meta(), "names": [list(x) for x in b.engine.names()], "cells": [b.engine.cells(i) for i in range(n)], "formats": [b.engine.formats(i) for i in range(n)], "styles": [b.engine.styles(i) for i in range(n)]}

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
