import datetime as dt
import io
import re
from collections import Counter

from formcel_engine import Workbook, reads_as_text
from openpyxl import load_workbook
from openpyxl.utils.datetime import to_excel
from openpyxl.worksheet.formula import ArrayFormula, DataTableFormula

from .. import page
from .autofilter import filter_in
from .cf import rules_in
from .drawings import objects_in
from .formulas import from_file
from .protect import book_in, flags_in, notes_in, sheet_in
from .styles import tokens_in
from .tables import tables_in
from .theme import theme_in
from .validation import validations_in

ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
BUILTIN_DATE = {"mm-dd-yy": "m/d/yyyy"}
WIDE_TO = 26


def _px_width(w: float) -> int:
    return max(1, round(w * 7))


def _value(cell, epoch, notes: Counter) -> str | None:
    v = cell.value
    if v is None:
        return None
    if isinstance(v, ArrayFormula):
        if v.ref and ":" in str(v.ref):
            notes["array formulas brought in as single formulas that spill"] += 1
        return from_file(v.text or "")
    if isinstance(v, DataTableFormula):
        notes["what-if data tables left out"] += 1
        return None
    if cell.data_type == "f" or (isinstance(v, str) and v.startswith("=") and cell.data_type != "s"):
        return from_file(str(v))
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (dt.datetime, dt.date, dt.time)):
        return repr(float(to_excel(v, epoch)))
    if isinstance(v, dt.timedelta):
        return repr(v.total_seconds() / 86400)
    if isinstance(v, (int, float)):
        return repr(v) if isinstance(v, float) else str(v)
    if cell.data_type == "e":
        return str(v)
    s = str(v)
    return s if "@" in (cell.number_format or "") or reads_as_text(s) else "'" + s


def _axis(dims, px_of, default_px: int | None, upto: int, notes: Counter) -> dict:
    sizes: dict[int, int] = {}
    hidden: list[int] = []
    levels: dict[int, int] = {}
    for key, d in dims.items():
        lo = getattr(d, "min", None) or key
        hi = getattr(d, "max", None) or key
        lo, hi = int(lo), int(hi)
        if hi - lo > 16384:
            hi = lo + 16384
        size = px_of(d)
        for i in range(lo - 1, hi):
            if size:
                sizes[i] = size
            if d.hidden:
                hidden.append(i)
            if d.outlineLevel:
                levels[i] = min(7, int(d.outlineLevel))
    if default_px:
        for i in range(upto):
            sizes.setdefault(i, default_px)
    out: dict = {"sizes": sorted(sizes.items()), "hidden": sorted(set(hidden))}
    if levels:
        out["levels"] = sorted(levels.items())
    return out


MACRO_PARTS = re.compile(r"xl/vba|xl/drawings/.*vmlDrawing\d\.vml|xl/ctrlProps|customUI|xl/activeX|xl/media/.*\.emf")
KEEP_WITH_MACROS = ("[Content_Types].xml", "_rels/.rels")


def macro_parts(archive) -> dict[str, bytes] | None:
    if archive is None:
        return None
    names = archive.namelist()
    if "xl/vbaProject.bin" not in names:
        return None
    return {n: archive.read(n) for n in names if MACRO_PARTS.match(n) or n in KEEP_WITH_MACROS}


def style_name_in(name: str) -> str:
    return f"Accent {name[-1]}" if len(name) == 7 and name.startswith("Accent") and name[-1].isdigit() else name


def _named(wb, default_font) -> tuple[dict[str, tuple[set[str], str]], list[str]]:
    known: dict[str, tuple[set[str], str]] = {}
    for line in Workbook().cell_styles():
        p = line.split("\t")
        known[p[0]] = (set(t for t in p[1].split(";") if t), p[2])
    custom: list[str] = []
    for ns in getattr(wb, "_named_styles", []):
        name = style_name_in(ns.name or "")
        if not name or name in known or "\t" in name:
            continue
        toks = tokens_in(ns, default_font)
        code = ns.number_format if ns.number_format and ns.number_format != "General" else ""
        known[name] = (set(t for t in toks.split(";") if t), code)
        custom.append(f"{name}\t{toks}\t{code}\tnafbp\t0")
    return known, custom


def read(data: bytes) -> dict:
    wb = load_workbook(io.BytesIO(data), data_only=False, rich_text=False, keep_links=False, keep_vba=True)
    vba = macro_parts(wb.vba_archive)
    if wb.vba_archive is not None:
        wb.vba_archive.close()
        wb.vba_archive = None
    notes: Counter = Counter()
    default_font = ("Calibri", 11.0)
    try:
        f = wb._fonts[0]
        default_font = (f.name or "Calibri", float(f.sz or 11))
    except (AttributeError, IndexError, TypeError):
        pass
    known, custom = _named(wb, default_font)
    sheets = []
    for ws in wb.worksheets:
        cells, formats, styles, links = [], [], [], []
        flagged: dict[tuple[int, int], int] = {}
        max_c = 0
        for (r, c), cell in list(ws._cells.items()):
            r0, c0 = r - 1, c - 1
            v = _value(cell, wb.epoch, notes)
            if v is not None and v != "'":
                cells.append((r0, c0, v))
                max_c = max(max_c, c)
            code = cell.number_format
            sname = style_name_in(cell.style or "Normal") if cell.has_style else "Normal"
            base = known.get(sname) if sname != "Normal" else None
            if code and code != "General" and not (base and code == base[1]):
                formats.append((r0, c0, BUILTIN_DATE.get(code, code)))
            if cell.has_style:
                pf = flags_in(cell)
                if pf:
                    flagged[(r0, c0)] = pf
                toks = [t for t in tokens_in(cell, default_font).split(";") if t]
                if base:
                    toks = [f"cs:{sname}"] + [t for t in toks if t not in base[0]]
                if toks:
                    styles.append((r0, c0, ";".join(toks)))
            if cell.hyperlink is not None and not (isinstance(v, str) and v.upper().startswith("=HYPERLINK(")):
                target = cell.hyperlink.target or (f"#{cell.hyperlink.location}" if cell.hyperlink.location else "")
                if target:
                    links.append((r0, c0, target))
        merges = [(m.min_row - 1, m.min_col - 1, m.max_row - 1, m.max_col - 1) for m in ws.merged_cells.ranges]
        view: dict = {}
        fp = ws.freeze_panes
        if fp:
            cell = ws[fp]
            view["fr"], view["fc"] = cell.row - 1, cell.column - 1
        base = ws.sheet_format.defaultColWidth or ((ws.sheet_format.baseColWidth or 8) + 1.140625)
        view["cols"] = _axis(ws.column_dimensions, lambda d: _px_width(d.width) if d.customWidth or d.width else None,
                             _px_width(base), max(WIDE_TO, max_c), notes)
        view["rows"] = _axis(ws.row_dimensions, lambda d: round(d.ht / 0.75) if d.ht and d.customHeight else None, None, 0, notes)
        z = (ws.sheet_view.zoomScale or 100) / 100
        view["zoom"] = min(ZOOMS, key=lambda x: abs(x - z))
        setup = page.from_xlsx(ws)
        if setup:
            view["page"] = setup
        tab = ws.sheet_properties.tabColor
        if tab is not None and isinstance(tab.rgb, str) and len(tab.rgb) >= 6:
            view["color"] = "#" + tab.rgb[-6:].lower()
        rules = rules_in(ws, notes)
        autofilter = filter_in(ws, wb, view, notes)
        valid = validations_in(ws, notes)
        objects = objects_in(ws, view, notes)
        if getattr(ws, "_pivots", None):
            notes["pivot tables left out"] += len(ws._pivots)
        if not autofilter:
            for t in ws.tables.values():
                if t.autoFilter is not None and t.autoFilter.filterColumn:
                    autofilter = filter_in(ws, wb, view, notes, af=t.autoFilter)
                    break
        if ws.defined_names:
            notes["names scoped to one sheet left out"] += len(ws.defined_names)
        sheets.append({"name": ws.title[:31], "cells": cells, "formats": formats, "styles": styles, "merges": merges, "links": links, "rules": rules, "filter": autofilter, "validations": valid, "view": view, "objects": objects, "notes": notes_in(ws), "protection": sheet_in(ws, flagged)})
    for cs in wb.chartsheets:
        notes["chart sheets left out"] += 1
    names = []
    for name, dn in wb.defined_names.items():
        if name.startswith("_xlnm.") or dn.hidden:
            notes["print areas and hidden names left out"] += 1
            continue
        text = dn.attr_text or ""
        names.append((name, "=" + from_file(text.lstrip("="))))
    tables = tables_in(wb, {ws.title: i for i, ws in enumerate(wb.worksheets)}, notes)
    return {"sheets": sheets, "names": names, "tables": tables, "theme": theme_in(wb.loaded_theme), "cellStyles": custom, "vba": vba, "protection": book_in(wb), "notes": [f"{n} {what}" for what, n in sorted(notes.items())]}
