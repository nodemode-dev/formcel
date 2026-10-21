from collections import Counter

import xlrd
from formcel_engine import reads_as_text

from . import xlsformula, xlsrecords
from .xlsstyle import Looks
from .xlsx.formulas import from_file

ERRORS = {0x00: "#NULL!", 0x07: "#DIV/0!", 0x0F: "#VALUE!", 0x17: "#REF!", 0x1D: "#NAME?", 0x24: "#NUM!", 0x2A: "#N/A"}
BUILTIN_DATE = {"mm-dd-yy": "m/d/yyyy", "M/D/YY": "m/d/yyyy"}


def _view(sh) -> dict:
    sizes = [(c, max(1, round(info.width / 256 * 7))) for c, info in sorted(sh.colinfo_map.items()) if info.width]
    hidden = [c for c, info in sorted(sh.colinfo_map.items()) if info.hidden]
    rows = [(r, round(info.height / 20 / 0.75)) for r, info in sorted(sh.rowinfo_map.items()) if info.has_default_height == 0 and info.height]
    view = {"cols": {"sizes": sizes, "hidden": hidden}, "rows": {"sizes": rows, "hidden": [r for r, info in sorted(sh.rowinfo_map.items()) if info.hidden]}}
    if sh.horz_split_pos or sh.vert_split_pos:
        view["fr"], view["fc"] = int(sh.horz_split_pos or 0), int(sh.vert_split_pos or 0)
    return view


def read(data: bytes) -> dict:
    book = xlrd.open_workbook(file_contents=data, formatting_info=True)
    notes: Counter = Counter()
    sheets = []
    kept = 0
    views = [_view(sh) for sh in book.sheets()]
    extra = xlsrecords.scan(data, book, views, [sh.name[:31] for sh in book.sheets()])
    formulas, lost = xlsformula.read(data, book, [e["covered"] for e in extra])
    looks = Looks(book)
    tables: list[str] = []
    for si, sh in enumerate(book.sheets()):
        here = dict(formulas[si]) if si < len(formulas) else {}
        more = extra[si] if si < len(extra) else {"rules": [], "validations": [], "arrays": [], "tables": [], "charts": [], "hollow": set(), "lost": 0}
        for r0, c0, _, _, text in more["arrays"]:
            here[(r0, c0)] = text
        cells, formats, merges, styles = [], [], [], []
        for r in range(sh.nrows):
            for c in range(sh.ncols):
                cell = sh.cell(r, c)
                t, v = cell.ctype, cell.value
                if t == xlrd.XL_CELL_EMPTY or t == xlrd.XL_CELL_BLANK:
                    raw = None
                elif t == xlrd.XL_CELL_NUMBER or t == xlrd.XL_CELL_DATE:
                    raw = repr(float(v)) if not float(v).is_integer() else str(int(v))
                elif t == xlrd.XL_CELL_BOOLEAN:
                    raw = "TRUE" if v else "FALSE"
                elif t == xlrd.XL_CELL_ERROR:
                    raw = ERRORS.get(v, "#N/A")
                else:
                    s = str(v)
                    raw = s if reads_as_text(s) else "'" + s
                xf = book.xf_list[cell.xf_index] if cell.xf_index is not None and cell.xf_index < len(book.xf_list) else None
                fmt = book.format_map.get(xf.format_key) if xf is not None else None
                code = fmt.format_str if fmt is not None else ""
                if (r, c) in here:
                    raw = "=" + from_file(here[(r, c)])
                elif (r, c) in more["hollow"]:
                    raw = None
                if raw is not None:
                    cells.append((r, c, raw))
                if code and code != "General":
                    formats.append((r, c, BUILTIN_DATE.get(code, code)))
                look = looks.tokens(cell.xf_index)
                if look:
                    styles.append((r, c, look))
        for r0, r1, c0, c1 in sh.merged_cells:
            merges.append((r0, c0, r1 - 1, c1 - 1))
        view = views[si]
        cell_notes = [(r, c, n.text or "", n.author or "") for (r, c), n in sorted(getattr(sh, "cell_note_map", {}).items()) if (n.text or "").strip()]
        objects = [{"id": f"xls{si}c{i}", **obj} for i, obj in enumerate(more["charts"])]
        sheets.append({"name": sh.name[:31], "cells": cells, "formats": formats, "styles": styles, "merges": merges, "links": [], "rules": more["rules"], "validations": more["validations"], "view": view, "notes": cell_notes,
                       "objects": objects, "arrays": [a[:4] for a in more["arrays"]]})
        tables.extend(more["tables"])
        if more["lost"]:
            notes["conditional formatting rules, data validation rules or charts FormCel could not read left out"] += more["lost"]
        kept += len(here)
    if kept:
        notes["formulas read from the legacy file's formula records"] = kept
    if lost:
        notes["formulas kept as their last saved values because FormCel could not read their tokens"] = lost
    if book.name_obj_list:
        notes["names left out"] = len(book.name_obj_list)
    return {"sheets": sheets, "names": [], "theme": None, "cellStyles": [], "vba": None, "whatif": tables, "notes": [f"{n} {what}" for what, n in sorted(notes.items())]}
