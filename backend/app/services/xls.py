from collections import Counter

import xlrd
from formcel_engine import reads_as_text

ERRORS = {0x00: "#NULL!", 0x07: "#DIV/0!", 0x0F: "#VALUE!", 0x17: "#REF!", 0x1D: "#NAME?", 0x24: "#NUM!", 0x2A: "#N/A"}
BUILTIN_DATE = {"mm-dd-yy": "m/d/yyyy", "M/D/YY": "m/d/yyyy"}


def read(data: bytes) -> dict:
    book = xlrd.open_workbook(file_contents=data, formatting_info=True)
    notes: Counter = Counter()
    sheets = []
    for sh in book.sheets():
        cells, formats, merges = [], [], []
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
                if raw is not None:
                    cells.append((r, c, raw))
                if code and code != "General":
                    formats.append((r, c, BUILTIN_DATE.get(code, code)))
        for r0, r1, c0, c1 in sh.merged_cells:
            merges.append((r0, c0, r1 - 1, c1 - 1))
        sizes = [(c, max(1, round(info.width / 256 * 7))) for c, info in sorted(sh.colinfo_map.items()) if info.width]
        hidden = [c for c, info in sorted(sh.colinfo_map.items()) if info.hidden]
        rows = [(r, round(info.height / 20 / 0.75)) for r, info in sorted(sh.rowinfo_map.items()) if info.has_default_height == 0 and info.height]
        view = {"cols": {"sizes": sizes, "hidden": hidden}, "rows": {"sizes": rows, "hidden": [r for r, info in sorted(sh.rowinfo_map.items()) if info.hidden]}}
        if sh.horz_split_pos or sh.vert_split_pos:
            view["fr"], view["fc"] = int(sh.horz_split_pos or 0), int(sh.vert_split_pos or 0)
        sheets.append({"name": sh.name[:31], "cells": cells, "formats": formats, "styles": [], "merges": merges, "links": [], "rules": [], "view": view})
    notes["sheets read with their last saved values: formulas, cell formatting and conditional formatting in .xls files are not read"] = len(sheets)
    if book.name_obj_list:
        notes["names left out"] = len(book.name_obj_list)
    return {"sheets": sheets, "names": [], "theme": None, "cellStyles": [], "vba": None, "notes": [f"{n} {what}" for what, n in sorted(notes.items())]}
