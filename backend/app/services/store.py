import json
import os
import shutil
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import formcel_engine

from .. import config
from . import calcstate
from . import collab as cb
from . import gastriggers
from . import records as linked
from . import templates
from .xlsx.props import clean as clean_props

FORMAT = "fcel"
FORMAT_VERSION = 2
PREVIEW_ROWS = 8
PREVIEW_COLS = 6


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


ENGINE = threading.RLock()
LOCALES = ("en-US", "en-GB", "de-DE", "fr-FR", "ja-JP", "es-ES", "it-IT", "pt-BR", "nl-NL", "sv-SE", "pl-PL", "ru-RU", "zh-CN", "ko-KR")


class BookLock:
    def __init__(self, book: "Book"):
        self.book = book

    def __enter__(self):
        ENGINE.acquire()
        formcel_engine.set_locale(self.book.locale)
        return self

    def __exit__(self, *exc):
        ENGINE.release()


@dataclass
class Book:
    id: str
    title: str
    created: str
    modified: str
    engine: "formcel_engine.Workbook"
    template: str | None = None
    views: list[dict] = field(default_factory=list)
    vba: dict[str, bytes] | None = None
    objects: list[list[dict]] = field(default_factory=list)
    props: dict = field(default_factory=dict)

    def fit_objects(self) -> list[list[dict]]:
        n = len(self.sheet_names())
        self.objects = (self.objects + [[] for _ in range(n)])[:n]
        return self.objects

    collab: dict = field(default_factory=cb.empty)

    def protection(self) -> dict:
        n = len(self.sheet_names())
        return {"book": self.engine.protection(), "sheets": [self.engine.protection(i) for i in range(n)]}

    locale: str = "en-US"

    @property
    def lock(self) -> BookLock:
        return BookLock(self)

    auto: dict = field(default_factory=dict)
    whatif: list[str] = field(default_factory=list)
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
        return {"id": self.id, "title": self.title, "created": self.created, "modified": self.modified, "locale": self.locale,
                "sheets": self.sheet_names(), "views": self.views, "template": self.template, "preview": self.preview(), "macros": bool(self.vba), "props": self.props}


def neutral(fn):
    def run(*a, **k):
        with ENGINE:
            formcel_engine.set_locale("en-US")
            return fn(*a, **k)

    return run


class Store:
    def __init__(self, root: Path):
        self.dir = root / "Workbooks"
        self.trash = root / "Trash"
        self.open: dict[str, Book] = {}
        self.guard = threading.Lock()
        self.versions = cb.Versions(root)
        self.hub = cb.Hub()
        self.share_index: dict[str, str] = {}
        self.flushed: dict[str, float] = {}

    def path(self, wid: str, trashed: bool = False) -> Path:
        if not wid.isalnum():
            raise KeyError(wid)
        return (self.trash if trashed else self.dir) / f"{wid}.fcel"

    def _write(self, b: Book) -> None:
        doc = {"format": FORMAT, "version": FORMAT_VERSION, "id": b.id, "title": b.title, "created": b.created,
               "modified": b.modified, "template": b.template, "locale": b.locale, "preview": b.preview(),
               "names": [list(n) for n in b.engine.names()], "nameNotes": [list(n) for n in b.engine.name_notes()], "tables": b.engine.tables(), "pivots": b.engine.pivots(), "model": b.engine.model_lines(), "whatif": b.whatif,
               "theme": b.engine.theme(), "cellStyles": b.engine.cell_styles(), "collab": b.collab, "protection": b.protection(), "records": linked.to_doc(b.engine.records()),
               "sheets": [{"name": n, "view": b.views[i] if i < len(b.views) else {}, "cells": b.engine.cells(i), "formats": b.engine.formats(i), "styles": b.engine.styles(i), "merges": [list(m) for m in b.engine.merges(i)], "rules": b.engine.rules(i), "filter": b.engine.filter(i), "validations": b.engine.validations(i), "links": b.engine.links(i), "chips": b.engine.chips(i), "objects": b.fit_objects()[i]} for i, n in enumerate(b.sheet_names())]}
        doc["watches"] = b.watches
        doc["props"] = b.props
        doc.update(calcstate.save(b.engine, len(b.sheet_names())))
        target = self.path(b.id)
        tmp = target.with_suffix(".fcel.tmp")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("mimetype", "application/vnd.formcel+zip")
            z.writestr("workbook.json", json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
            for name, blob in (b.vba or {}).items():
                z.writestr(f"macros/{name}", blob)
            if b.auto:
                scripts = b.auto.get("scripts") or []
                for s in scripts:
                    z.writestr(f"scripts/{s['id']}.ts", s.get("code", ""))
                z.writestr("automation.json", json.dumps({**b.auto, "scripts": [{k: v for k, v in s.items() if k != "code"} for s in scripts]}, ensure_ascii=False, separators=(",", ":")))
        for attempt in range(10):
            try:
                os.replace(tmp, target)
                break
            except PermissionError as e:
                if attempt == 9:
                    raise OSError(f"{target.name} is in use and could not be saved: {e}") from None
                time.sleep(0.05)
        try:
            self.versions.snapshot(b.id, target)
        except OSError:
            pass

    @staticmethod
    def _automation(p: Path) -> dict:
        with zipfile.ZipFile(p) as z:
            names = set(z.namelist())
            if "automation.json" not in names:
                return {}
            auto = json.loads(z.read("automation.json"))
            for s in auto.get("scripts") or []:
                part = f"scripts/{s['id']}.ts"
                s["code"] = z.read(part).decode("utf-8") if part in names else ""
        return auto

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
        b = self.open.get(wid)
        if b is not None:
            return b
        with ENGINE:
            with self.guard:
                if wid in self.open:
                    return self.open[wid]
                doc = self._read(self.path(wid))
                formcel_engine.set_locale(doc.get("locale") or "en-US")
                return self._build(wid, doc)

    def _build(self, wid: str, doc: dict) -> Book:
        if True:
            eng = formcel_engine.Workbook()
            if doc.get("theme"):
                eng.load_theme(doc["theme"])
            if doc.get("cellStyles"):
                eng.load_cell_styles(doc["cellStyles"])
            eng.load_records(linked.from_doc(doc.get("records")))
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
                eng.load_chips([tuple(c) for c in s.get("chips", [])], i)
            for name, refers in doc.get("names", []):
                try:
                    eng.define_name(name, refers)
                except ValueError:
                    continue
            for name, note in doc.get("nameNotes", []):
                try:
                    eng.set_name_comment(name, note)
                except ValueError:
                    continue
            if doc.get("tables"):
                eng.load_tables(doc["tables"])
            if doc.get("pivots"):
                eng.load_pivots(doc["pivots"])
            if doc.get("model"):
                eng.load_model(doc["model"])
            calcstate.restore(eng, doc, doc.get("arrays") or [])
            b = Book(wid, doc["title"], doc["created"], doc["modified"], eng, doc.get("template"), [s.get("view") or {} for s in doc["sheets"]])
            b.objects = [list(s.get("objects") or []) for s in doc["sheets"]]
            b.vba = self._macros(self.path(wid))
            b.props = clean_props(doc.get("props"))
            b.collab = cb.fit(doc.get("collab"))
            prot = doc.get("protection") or {}
            eng.load_protection(prot.get("book") or [])
            for i, lines in enumerate(prot.get("sheets") or []):
                if i < len(doc["sheets"]):
                    eng.load_protection(lines, i)
            b.locale = doc.get("locale") or "en-US"
            try:
                b.auto = self._automation(self.path(wid))
            except (KeyError, ValueError, zipfile.BadZipFile):
                b.auto = {}
            b.whatif = list(doc.get("whatif", []))
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

    def template_path(self, tid: str) -> Path:
        if not tid.startswith("my-") or not tid[3:].isalnum():
            raise KeyError(tid)
        return self.dir.parent / "Templates" / f"{tid[3:]}.fcel"

    def save_template(self, wid: str, name: str, description: str) -> dict:
        b = self._load(wid)
        with b.lock:
            self._write(b)
            tid = uuid.uuid4().hex[:12]
            target = self.template_path(f"my-{tid}")
            target.parent.mkdir(parents=True, exist_ok=True)
            doc = self._read(self.path(wid))
            doc.update({"title": name[:120], "templateDescription": description[:300], "templateName": name[:120]})
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr("mimetype", "application/vnd.formcel+zip")
                z.writestr("workbook.json", json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        return self.personal_summary(f"my-{tid}")

    def personal_summary(self, tid: str) -> dict:
        doc = self._read(self.template_path(tid))
        return {"id": tid, "name": doc.get("templateName") or doc["title"], "description": doc.get("templateDescription") or "Saved from one of your workbooks.", "category": "Personal", "tags": ["personal"], "featured": False,
                "source": "personal", "sheets": [s["name"] for s in doc["sheets"]], "rows": sum(len(s["cells"]) for s in doc["sheets"]), "preview": doc.get("preview", [])}

    def personal_templates(self) -> list[dict]:
        out = []
        folder = self.dir.parent / "Templates"
        for p in sorted(folder.glob("*.fcel"), key=lambda q: q.stat().st_mtime, reverse=True):
            try:
                out.append(self.personal_summary(f"my-{p.stem}"))
            except (OSError, ValueError, KeyError, zipfile.BadZipFile):
                continue
        return out

    def delete_template(self, tid: str) -> None:
        self.template_path(tid).unlink()

    def create_from_personal(self, title: str | None, tid: str) -> dict:
        doc = self._read(self.template_path(tid))
        stamp = now()
        wid = uuid.uuid4().hex[:12]
        doc.update({"id": wid, "title": (title or doc.get("templateName") or doc["title"])[:120], "created": stamp, "modified": stamp, "template": None})
        target = self.path(wid)
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("mimetype", "application/vnd.formcel+zip")
            z.writestr("workbook.json", json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        return self._load(wid).meta()

    def create_from_doc(self, title: str | None, tid: str) -> dict:
        doc = templates.doc_of(tid)
        stamp = now()
        wid = uuid.uuid4().hex[:12]
        doc.update({"id": wid, "title": (title or templates.catalog()[tid]["name"])[:120], "created": stamp, "modified": stamp, "template": tid})
        with zipfile.ZipFile(self.path(wid), "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("mimetype", "application/vnd.formcel+zip")
            z.writestr("workbook.json", json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        b = self._load(wid)
        self._write(b)
        return b.meta()

    @neutral
    def create(self, title: str | None, template_id: str | None) -> dict:
        if template_id and template_id.startswith("my-"):
            return self.create_from_personal(title, template_id)
        if template_id and templates.doc_of(template_id) is not None:
            return self.create_from_doc(title, template_id)
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

    @neutral
    def import_xlsx(self, data: bytes, title: str, kind: str = "xlsx") -> dict:
        from . import ods, xls, xlsx

        book = xls.read(data) if kind == "xls" else ods.read(data) if kind == "ods" else xlsx.read(data)
        notes = list(book["notes"])
        eng = formcel_engine.Workbook()
        if book["theme"] and not eng.load_theme(book["theme"]):
            notes.append("1 theme left out")
        if book["cellStyles"]:
            eng.load_cell_styles(eng.cell_styles() + book["cellStyles"])
        eng.load_records(book.get("records", []))
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
            if s.get("chips"):
                eng.load_chips(s["chips"], i)
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
        for name, note in book.get("nameNotes", []):
            try:
                eng.set_name_comment(name, note)
            except ValueError:
                continue
        if dropped:
            notes.append(f"{dropped} names FormCel could not read left out")
        if book.get("tables"):
            kept = eng.load_tables(book["tables"])
            if kept < len(book["tables"]):
                notes.append(f"{len(book['tables']) - kept} tables FormCel could not read brought in as plain ranges")
        if book.get("pivots"):
            kept = eng.load_pivots(book["pivots"])
            if kept < len(book["pivots"]):
                notes.append(f"{len(book['pivots']) - kept} pivot tables FormCel could not read left out")
        if book.get("model"):
            eng.load_model(book["model"])
        calcstate.restore(eng, book, [s.get("arrays") or [] for s in book["sheets"]])
        stamp = now()
        b = Book(uuid.uuid4().hex[:12], (title or "Imported workbook")[:120], stamp, stamp, eng, None, [s["view"] for s in book["sheets"]])
        b.objects = [list(s.get("objects") or []) for s in book["sheets"]]
        b.whatif = list(book.get("whatif") or [])
        b.vba = book.get("vba")
        b.props = clean_props(book.get("props"))
        for i, s in enumerate(book["sheets"]):
            for r, c, text, author in s.get("notes", []):
                cb.set_note(b.collab, i, r, c, text, author)
            for t in s.get("threads", []):
                cb.import_thread(b.collab, i, t)
            if s.get("protection"):
                eng.load_protection(s["protection"], i)
        if book.get("protection"):
            eng.load_protection(book["protection"])
        if b.vba:
            notes.append("1 macro project kept for saving as .xlsm; open it in the Visual Basic Editor with Alt+F11")
        with self.guard:
            self.open[b.id] = b
        self._write(b)
        return {**b.meta(), "notes": notes}

    @neutral
    def import_csv(self, data: bytes, title: str, delimiter: str | None, text_cols: set[int], max_rows: int = 0) -> dict:
        from . import csvio

        cells, info = csvio.cells(data, title, delimiter, text_cols, max_rows)
        eng = formcel_engine.Workbook()
        eng.rename_sheet(0, (title.rpartition(".")[0] or title)[:31] or "Sheet1")
        eng.load(cells, 0)
        notes = []
        if info["cut"]:
            notes.append(f"only the first {info['cut']:,} of {info['rows']:,} rows were read, as set in Preferences")
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

    def import_tables(self, data: bytes, title: str, kind: str) -> dict:
        from . import tabular

        sheets, notes = tabular.read(data, kind)
        eng = formcel_engine.Workbook()
        for i, (name, cells) in enumerate(sheets):
            if i:
                eng.add_sheet(name)
            else:
                eng.rename_sheet(0, name)
            eng.load(cells, i)
        stamp = now()
        stem = (title.rpartition(".")[0] or title)[:120]
        b = Book(uuid.uuid4().hex[:12], stem, stamp, stamp, eng, None, [{} for _ in sheets])
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

    def export_pdf(self, wid: str, sheet: int | None, notes: list[str] | None = None) -> tuple[str, bytes]:
        from . import pdf

        b = self._load(wid)
        with b.lock:
            b.fit_views()
            n = len(b.sheet_names())
            if sheet is not None and not 0 <= sheet < n:
                raise IndexError(sheet)
            return b.title, pdf.write(b.engine, b.views, [sheet] if sheet is not None else list(range(n)), b.title, notes)

    def export_ods(self, wid: str) -> tuple[str, bytes]:
        from . import ods

        b = self._load(wid)
        with b.lock:
            b.fit_views()
            return b.title, ods.write(b.engine, b.views)[0]

    def export_fcel(self, wid: str) -> tuple[str, bytes]:
        b = self._load(wid)
        with b.lock:
            self._write(b)
            return b.title, self.path(wid).read_bytes()

    def export_xlsx(self, wid: str, macros: bool = False) -> tuple[str, bytes]:
        from . import xlsx

        b = self._load(wid)
        with b.lock:
            b.fit_views()
            if macros and not b.vba:
                raise LookupError(wid)
            return b.title, xlsx.write(b.engine, b.views, b.vba if macros else None, b.fit_objects(), b.collab["notes"], b.collab["threads"], b.props, (b.created, b.modified), whatif=b.whatif, queries=b.auto.get("queries"))

    def properties(self, wid: str) -> dict:
        b = self._load(wid)
        with b.lock:
            n = len(b.sheet_names())
            cells = [b.engine.cells(i) for i in range(n)]
            formulas = sum(1 for sheet in cells for c in sheet if str(c[2]).startswith("="))
            return {"props": b.props, "title": b.title, "created": b.created, "modified": b.modified,
                    "stats": {"sheets": n, "cells": sum(len(s) for s in cells), "formulas": formulas, "names": len(b.engine.names()), "tables": len(b.engine.tables()), "notes": len(b.collab["notes"])}}

    def set_properties(self, wid: str, props: dict) -> dict:
        b = self._load(wid)
        with b.lock:
            b.props = clean_props(props)
            b.modified = now()
            self._write(b)
        return self.properties(wid)

    def get(self, wid: str) -> dict:
        b = self._load(wid)
        with b.lock:
            n = len(b.sheet_names())
            return {**b.meta(), "watches": b.watches, "names": [list(x) for x in b.engine.names()], "nameNotes": [list(x) for x in b.engine.name_notes()], "theme": b.engine.theme(), "cellStyles": b.engine.cell_styles(), "cells": [b.engine.cells(i) for i in range(n)], "formats": [b.engine.formats(i) for i in range(n)], "styles": [b.engine.styles(i) for i in range(n)], "merges": [[list(m) for m in b.engine.merges(i)] for i in range(n)], "rules": [b.engine.rules(i) for i in range(n)], "filters": [b.engine.filter(i) for i in range(n)], "validations": [b.engine.validations(i) for i in range(n)], "tables": b.engine.tables(), "pivots": b.engine.pivots(), "model": b.engine.model_lines(), "whatif": b.whatif, "links": [b.engine.links(i) for i in range(n)], "chips": [b.engine.chips(i) for i in range(n)], "records": [list(x) for x in b.engine.record_payloads()], "collab": {"notes": b.collab["notes"], "threads": b.collab["threads"]}, "protection": b.protection(), "automation": b.auto, **calcstate.save(b.engine, n)}

    def calc_command(self, wid: str, cmd: str) -> dict:
        b = self._load(wid)
        with b.lock:
            reply = calcstate.run(b.engine, cmd)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified, "reply": reply}

    def get_objects(self, wid: str) -> list[list[dict]]:
        b = self._load(wid)
        with b.lock:
            return [list(x) for x in b.fit_objects()]

    def set_objects(self, wid: str, sheet: int, objects: list[dict]) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            b.fit_objects()[sheet] = objects
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_locale(self, wid: str, tag: str) -> dict:
        if tag not in LOCALES:
            raise ValueError(f"FormCel has no {tag} locale")
        b = self._load(wid)
        with b.lock:
            b.locale = tag
            formcel_engine.set_locale(tag)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified, "locale": tag}

    def accessibility(self, wid: str) -> list[dict]:
        from . import a11y

        b = self._load(wid)
        with b.lock:
            b.fit_views()
            return a11y.check(b.engine, b.views, b.fit_objects())

    def export_html(self, wid: str, sheet: int | None) -> tuple[str, str]:
        from . import html

        b = self._load(wid)
        with b.lock:
            b.fit_views()
            n = len(b.sheet_names())
            if sheet is not None and not 0 <= sheet < n:
                raise IndexError(sheet)
            return b.title, html.write(b.engine, b.views, [sheet] if sheet is not None else list(range(n)), b.title)

    def book(self, wid: str) -> Book:
        return self._load(wid)

    def set_automation(self, wid: str, auto: dict) -> dict:
        b = self._load(wid)
        with b.lock:
            b.auto = auto
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_whatif(self, wid: str, lines: list[str]) -> dict:
        b = self._load(wid)
        with b.lock:
            b.whatif = list(lines)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_links(self, wid: str, sheet: int, cells: list[tuple[int, int, str]]) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            b.engine.load_links(cells, sheet)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_chips(self, wid: str, sheet: int, cells: list[tuple[int, int, str]], records: list[tuple[str, str, str]] | None = None) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            if records:
                b.engine.load_record_payloads(records)
            b.engine.load_chips(cells, sheet)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_records(self, wid: str, records: list[tuple[str, str, str]]) -> dict:
        b = self._load(wid)
        with b.lock:
            b.engine.load_record_payloads(records)
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

    def set_pivots(self, wid: str, lines: list[str]) -> dict:
        b = self._load(wid)
        with b.lock:
            b.engine.load_pivots(lines)
            b.modified = now()
            self._write(b)
            return {"id": b.id, "modified": b.modified}

    def set_model(self, wid: str, lines: list[str]) -> dict:
        b = self._load(wid)
        with b.lock:
            b.engine.load_model(lines)
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

    def name_tool(self, wid: str, op: str, args: str) -> dict:
        b = self._load(wid)
        with b.lock:
            reply = b.engine.name_tool(op, args)
            if reply.startswith("e"):
                raise ValueError(reply[1:])
            b.modified = now()
            self._write(b)
            return {"names": [list(n) for n in b.engine.names()], "nameNotes": [list(n) for n in b.engine.name_notes()]}

    def edit(self, wid: str, sheet: int, cells: list[tuple[int, int, str]], user: str = "", client: str | None = None, why: str = "") -> dict:
        b = self._load(wid)
        with b.lock:
            names = b.sheet_names()
            if sheet >= len(names):
                raise IndexError(sheet)
            b.engine.set_user(user)
            b.engine.guard_cells(sheet, [(r, c) for r, c, _ in cells])
            before = [b.engine.input(f"{cb.col_name(c)}{r + 1}", sheet) for r, c, _ in cells]
            b.engine.load(cells, sheet)
            moved = []
            for (r, c, raw), was in zip(cells, before):
                after = b.engine.input(f"{cb.col_name(c)}{r + 1}", sheet)
                if after != was:
                    cb.log_edit(b.collab, user, sheet, names[sheet], r, c, was, after, why)
                    moved.append((r, c))
            told = cb.notify_edit(b.collab, user, sheet, names[sheet], moved) if moved and b.collab["watch"] else []
            b.modified = now()
            self._write(b)
            self.hub.publish(wid, {"type": "edit", "sheet": sheet, "cells": [list(x) for x in cells], "user": user, "told": told}, client)
            if moved:
                gastriggers.on_edit(wid, names[sheet], moved, {(r, c): was for (r, c, _), was in zip(cells, before)}, lambda r, c: b.engine.input(f"{cb.col_name(c)}{r + 1}", sheet))
            return {"id": b.id, "modified": b.modified}

    def collab_edit(self, wid: str, fn, client: str | None = None, event: str = "collab"):
        b = self._load(wid)
        with b.lock:
            out = fn(b)
            b.modified = now()
            self._write(b)
        self.hub.publish(wid, {"type": event}, client)
        return out

    def set_protection(self, wid: str, sheet: int | None, lines: list[str], client: str | None = None) -> dict:
        b = self._load(wid)
        with b.lock:
            if sheet is not None and sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            b.engine.load_protection(lines, sheet)
            b.modified = now()
            self._write(b)
        self.hub.publish(wid, {"type": "protection"}, client)
        return b.protection()

    def snapshot_now(self, wid: str, name: str, user: str) -> dict:
        b = self._load(wid)
        with b.lock:
            self._write(b)
            return self.versions.snapshot(wid, self.path(wid), name=name, user=user, force=True, why="saved by request") or {}

    def restore_version(self, wid: str, vid: str, user: str, client: str | None = None) -> dict:
        b = self._load(wid)
        src = self.versions.path(wid, vid)
        with b.lock:
            self._write(b)
            self.versions.snapshot(wid, self.path(wid), name="Before restore", user=user, force=True, why="before restore")
        shutil.copyfile(src, self.path(wid))
        with self.guard:
            self.open.pop(wid, None)
        b = self._load(wid)
        with b.lock:
            b.modified = now()
            self._write(b)
            made = self.versions.snapshot(wid, self.path(wid), name=f"Restored from {self.versions.find(wid, vid)['time']}", user=user, force=True, why="restore")
        self.hub.publish(wid, {"type": "reload"}, client)
        return made or {}

    def publish_sheet(self, wid: str, sheet: int, kind: str, perm: str = "view", scope: str = "sheet", fmt: str = "html", live: bool = True, days: int | None = None) -> dict:
        def run(b):
            if sheet >= len(b.sheet_names()):
                raise IndexError(sheet)
            if perm not in ("view", "comment", "edit"):
                raise ValueError("A link gives view, comment or edit access.")
            t = cb.token()
            expires = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(timespec="seconds") if days else ""
            s = {"sheet": sheet, "kind": kind, "perm": perm, "scope": scope if scope in ("sheet", "book") else "sheet", "format": fmt if fmt in ("html", "csv") else "html", "live": bool(live), "expires": expires, "created": cb.stamp(), "revoked": False, "wid": wid}
            if not live:
                s["frozen"] = self._freeze(b, s)
            b.collab["shares"][t] = s
            return {"token": t, **{k: v for k, v in s.items() if k != "frozen"}}
        return self.collab_edit(wid, run, event="shares")

    def republish(self, wid: str, t: str) -> dict:
        def run(b):
            s = b.collab["shares"][t]
            if not s["live"]:
                s["frozen"] = self._freeze(b, s)
            s["republished"] = cb.stamp()
            return {"token": t, **{k: v for k, v in s.items() if k != "frozen"}}
        return self.collab_edit(wid, run, event="shares")

    def share_options(self, wid: str, t: str, live: bool | None, perm: str | None) -> dict:
        def run(b):
            s = b.collab["shares"][t]
            if perm in ("view", "comment", "edit"):
                s["perm"] = perm
            if live is not None and live != s["live"]:
                s["live"] = live
                if live:
                    s.pop("frozen", None)
                else:
                    s["frozen"] = self._freeze(b, s)
            return {"token": t, **{k: v for k, v in s.items() if k != "frozen"}}
        return self.collab_edit(wid, run, event="shares")

    @staticmethod
    def _freeze(b: Book, s: dict) -> dict:
        names = b.sheet_names()
        keep = range(len(names)) if s["scope"] == "book" else [s["sheet"]]
        return {"title": b.title, "names": names, "values": {str(i): [list(x) for x in b.engine.values(i)] for i in keep}, "styles": {str(i): [list(x) for x in b.engine.styles(i)] for i in keep}}

    def revoke_share(self, wid: str, t: str) -> dict:
        def run(b):
            s = b.collab["shares"][t]
            s["revoked"] = True
            return {"token": t, **s}
        return self.collab_edit(wid, run, event="shares")

    def find_share(self, t: str) -> tuple[str, Book, dict] | None:
        wid = self.share_index.get(t)
        order = [self.dir / f"{wid}.fcel"] if wid else []
        order += [p for p in sorted(self.dir.glob("*.fcel")) if p.stem != wid]
        for p in order:
            try:
                b = self.open.get(p.stem)
                shares = b.collab["shares"] if b else (self._read(p).get("collab") or {}).get("shares", {})
                if t not in shares:
                    continue
                b = self._load(p.stem)
            except (OSError, ValueError, KeyError, zipfile.BadZipFile):
                continue
            s = b.collab["shares"][t]
            if s["revoked"]:
                return None
            if s.get("expires") and (cb.when_of(s["expires"]) or datetime.now(timezone.utc)) < datetime.now(timezone.utc):
                return None
            self.share_index[t] = p.stem
            return p.stem, b, s
        return None

    def render_share(self, b: Book, s: dict, embed: bool, opts: dict) -> tuple[str, str] | None:
        with b.lock:
            if s.get("frozen"):
                f = s["frozen"]
                title, names = f["title"], f["names"]
                values = lambda i: [tuple(x) for x in f["values"].get(str(i), [])]
                styles = lambda i: {(r, c): st for r, c, st in f["styles"].get(str(i), [])}
            else:
                title, names = b.title, b.sheet_names()
                values = lambda i: b.engine.values(i)
                styles = lambda i: {(r, c): st for r, c, st in b.engine.styles(i)}
            book_wide = s.get("scope") == "book"
            try:
                i = int(opts.get("sheet", s["sheet"])) if book_wide else s["sheet"]
            except ValueError:
                i = s["sheet"]
            if not 0 <= i < len(names) or (s.get("frozen") and str(i) not in s["frozen"]["values"]):
                return None
            area = cb.area_of(opts.get("range", ""))
            if s.get("format") == "csv":
                return "text/csv; charset=utf-8", cb.csv_of(values(i), area)
            return "text/html; charset=utf-8", cb.render_sheet(title, names[i], values(i), styles(i), embed, opts.get("gridlines", "1") != "0", opts.get("headers", "1") != "0", area, names if book_wide else None, i)

    def record_access(self, wid: str, token: str, who: str, ip: str, what: str) -> None:
        b = self._load(wid)
        with b.lock:
            cb.log_access(b.collab, token, who, ip, what)
            if time.time() - self.flushed.get(wid, 0) > 15:
                self.flushed[wid] = time.time()
                self._write(b)
        self.hub.publish(wid, {"type": "access"}, None)

    def add_sheet(self, wid: str, name: str) -> dict:
        b = self._load(wid)
        with b.lock:
            idx = b.engine.add_sheet(name[:31])
            b.modified = now()
            self._write(b)
            gastriggers.on_change(wid, "INSERT_GRID")
            return {"index": idx, "sheets": b.sheet_names()}

    def shift(self, wid: str, sheet: int, rows: bool, at: int, n: int, insert: bool, user: str = "") -> dict:
        b = self._load(wid)
        with b.lock:
            b.engine.shift(sheet, rows, at, n, insert)
            cb.shift_keys(b.collab, sheet, rows, at, n if insert else -n)
            cb.log_shift(b.collab, user, sheet, b.sheet_names()[sheet], rows, at, n, insert)
            b.modified = now()
            self._write(b)
            gastriggers.on_change(wid, ("INSERT_" if insert else "REMOVE_") + ("ROW" if rows else "COLUMN"))
            return {"id": b.id, "modified": b.modified}

    def sheet_op(self, wid: str, op: str, sheet: int, to: int | None = None, name: str | None = None, view: dict | None = None) -> dict:
        b = self._load(wid)
        with b.lock:
            b.fit_views()
            b.fit_objects()
            if op == "delete":
                b.engine.delete_sheet(sheet)
                del b.views[sheet]
                del b.objects[sheet]
                cb.remap_sheets(b.collab, lambda s: None if s == sheet else s - 1 if s > sheet else s)
            elif op == "move" and to is not None:
                b.engine.move_sheet(sheet, to)
                b.views.insert(to, b.views.pop(sheet))
                b.objects.insert(to, b.objects.pop(sheet))
                order = list(range(len(b.views)))
                order.insert(to, order.pop(sheet))
                cb.remap_sheets(b.collab, lambda s: order.index(s) if s in order else s)
            elif op == "update":
                if name:
                    b.engine.rename_sheet(sheet, name.strip()[:31])
                if view is not None:
                    b.views[sheet] = {**b.views[sheet], **view}
            b.modified = now()
            self._write(b)
            return {"sheets": b.sheet_names(), "views": b.views}

    @staticmethod
    def _free_name(taken: list[str], want: str) -> str:
        used = {t.lower() for t in taken}
        base = want[:31]
        if base.lower() not in used:
            return base
        stem = base
        n = 2
        while True:
            tail = f" ({n})"
            cand = stem[: 31 - len(tail)] + tail
            if cand.lower() not in used:
                return cand
            n += 1

    def copy_sheet(self, wid: str, sheet: int, dest: str | None = None, name: str | None = None, to: int | None = None) -> dict:
        src = self._load(wid)
        target = self._load(dest) if dest and dest != wid else src
        with src.lock:
            src.fit_views()
            src.fit_objects()
            names = src.sheet_names()
            if not 0 <= sheet < len(names):
                raise IndexError(sheet)
            eng = src.engine
            part = {"cells": eng.cells(sheet), "formats": eng.formats(sheet), "styles": eng.styles(sheet), "merges": eng.merges(sheet), "rules": eng.rules(sheet), "filter": eng.filter(sheet),
                    "validations": eng.validations(sheet), "links": eng.links(sheet), "chips": eng.chips(sheet), "records": eng.records(sheet), "view": json.loads(json.dumps(src.views[sheet])), "objects": json.loads(json.dumps(src.objects[sheet]))}
            notes = [(int(k.split(":")[1]), int(k.split(":")[2]), v["text"], v.get("author", "")) for k, v in src.collab["notes"].items() if int(k.split(":")[0]) == sheet]
            original = names[sheet]
        with target.lock:
            target.fit_views()
            target.fit_objects()
            clean = "".join(ch for ch in (name or original) if ch not in "\\/?*[]:").strip() or original
            title = self._free_name(target.sheet_names(), f"{clean[:27]} (2)" if target is src and not name else clean)
            e = target.engine
            idx = e.add_sheet(title)
            e.load_formats([tuple(c) for c in part["formats"]], idx)
            e.load_styles([tuple(c) for c in part["styles"]], idx)
            e.load_merges([tuple(m) for m in part["merges"]], idx)
            e.load_rules(part["rules"], idx)
            e.load_filter(part["filter"], idx)
            e.load_validations(part["validations"], idx)
            e.load_links([tuple(c) for c in part["links"]], idx)
            e.load([tuple(c) for c in part["cells"]], idx)
            e.load_records(part["records"])
            e.load_chips([tuple(c) for c in part["chips"]], idx)
            target.views.append({**part["view"], "hidden": None})
            target.objects.append(part["objects"])
            for r, c, text, author in notes:
                cb.set_note(target.collab, idx, r, c, text, author)
            target.modified = now()
            self._write(target)
        if to is not None and 0 <= to < idx:
            self.sheet_op(target.id, "move", idx, to=to)
            idx = to
        return {"dest": target.id, "index": idx, "name": title, "sheets": target.sheet_names()}

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
