import re
from collections import Counter

from openpyxl.styles import Font, PatternFill
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.styles.table import TableStyle, TableStyleElement
from openpyxl.utils import get_column_letter, range_boundaries
from openpyxl.worksheet.filters import AutoFilter
from openpyxl.worksheet.table import Table, TableColumn, TableFormula, TableStyleInfo

from .cf import esc
from .formulas import from_file

_BUILTIN = re.compile(r"^TableStyle(?:Light(?:[1-9]|1\d|2[01])|Medium(?:[1-9]|1\d|2[0-8])|Dark(?:[1-9]|1[01]))$")


def valid_style(name: str) -> bool:
    return bool(_BUILTIN.match(name)) or name == "None"


def _hex(color) -> str | None:
    rgb = getattr(color, "rgb", None)
    return rgb[-6:].upper() if isinstance(rgb, str) and len(rgb) >= 6 else None


def _custom_in(wb, name: str) -> str | None:
    lst = getattr(wb, "_table_styles", None)
    ts = next((x for x in (lst.tableStyle if lst is not None else []) if x.name == name), None)
    if ts is None:
        return None
    dxfs = wb._differential_styles.styles
    pick: dict = {}
    for el in ts.tableStyleElement:
        if el.dxfId is not None and 0 <= el.dxfId < len(dxfs):
            pick[el.type] = dxfs[el.dxfId]
    head, band = pick.get("headerRow"), pick.get("firstRowStripe")
    fill = lambda d: _hex(d.fill.bgColor) or _hex(d.fill.fgColor) if d is not None and d.fill is not None else None
    h, b = fill(head), fill(band)
    if h is None and b is None:
        return None
    text = _hex(head.font.color) if head is not None and head.font is not None and head.font.color is not None else None
    safe = name.replace(":", " ").replace("\t", " ").strip()[:40] or "Custom"
    return f"Custom:{safe}:{h or '1F6FEB'}:{b or 'DBE7FB'}:{text or 'FFFFFF'}"


def _custom_out(wb, ident: str) -> str:
    _, name, head, band, text = ident.split(":")
    lst = wb._table_styles
    if not any(x.name == name for x in lst.tableStyle):
        def dx(fill=None, font=None):
            wb._differential_styles.add(DifferentialStyle(fill=fill, font=font))
            return len(wb._differential_styles.styles) - 1
        solid = lambda h: PatternFill(patternType="solid", fgColor="FF" + h, bgColor="FF" + h)
        els = [TableStyleElement(type="headerRow", dxfId=dx(solid(head), Font(bold=True, color="FF" + text))),
               TableStyleElement(type="firstRowStripe", dxfId=dx(solid(band)))]
        lst.tableStyle.append(TableStyle(name=name, pivot=False, count=len(els), tableStyleElement=els))
    return name


def _unesc(s: str) -> str:
    out, it = [], iter(s)
    for ch in it:
        if ch != "\\":
            out.append(ch)
            continue
        nx = next(it, "")
        out.append({"t": "\t", "n": "\n", "r": "\r"}.get(nx, nx))
    return "".join(out)


def parse(line: str) -> dict:
    p = [_unesc(x) for x in line.split("\t")]
    n = int(p[5])
    r0, c0, r1, c1 = (int(x) for x in p[2].split(","))
    return {"sheet": int(p[0]), "name": p[1], "area": (r0, c0, r1, c1), "flags": p[3], "style": p[4],
            "cols": p[6:6 + n], "calc": p[6 + n:6 + 2 * n], "kept": p[6 + 2 * n:6 + 3 * n]}


def ref_of(r0: int, c0: int, r1: int, c1: int) -> str:
    return f"{get_column_letter(c0 + 1)}{r0 + 1}:{get_column_letter(c1 + 1)}{r1 + 1}"


def tables_in(wb, sheet_index: dict, notes: Counter) -> list[str]:
    lines: list[str] = []
    for ws in wb.worksheets:
        i = sheet_index.get(ws.title)
        if i is None:
            continue
        for t in ws.tables.values():
            try:
                c0, r0, c1, r1 = range_boundaries(t.ref)
            except (TypeError, ValueError):
                notes["tables FormCel could not read brought in as plain ranges"] += 1
                continue
            if not t.headerRowCount:
                notes["tables without a header row brought in as plain ranges"] += 1
                continue
            r0, c0, r1, c1 = r0 - 1, c0 - 1, r1 - 1, c1 - 1
            cols = [c.name for c in t.tableColumns]
            if len(cols) != c1 - c0 + 1:
                notes["tables FormCel could not read brought in as plain ranges"] += 1
                continue
            calc = ["=" + from_file(c.calculatedColumnFormula.attr_text if hasattr(c.calculatedColumnFormula, "attr_text") else str(c.calculatedColumnFormula)) if c.calculatedColumnFormula is not None else "" for c in t.tableColumns]
            si = t.tableStyleInfo
            style = si.name if si is not None and valid_style(si.name) else (_custom_in(wb, si.name) if si is not None and si.name else None) or "TableStyleMedium2"
            if si is not None and si.name and style == "TableStyleMedium2" and si.name != style:
                notes["table styles FormCel could not read shown as Medium 2"] += 1
            flags = ("t" if t.totalsRowCount else "") + ("r" if si is None or si.showRowStripes else "") + ("c" if si is not None and si.showColumnStripes else "")
            flags += ("f" if si is not None and si.showFirstColumn else "") + ("l" if si is not None and si.showLastColumn else "") + ("b" if t.autoFilter is not None else "")
            n = len(cols)
            parts = [str(i), t.displayName or t.name or f"Table{len(lines) + 1}", f"{r0},{c0},{r1},{c1}", flags, style, str(n), *cols, *calc, *[""] * n]
            lines.append("\t".join(esc(x) for x in parts))
    return lines


def tables_out(wb, eng) -> dict:
    sheets = wb.worksheets
    by_sheet: dict = {}
    for k, line in enumerate(eng.tables()):
        t = parse(line)
        if t["sheet"] >= len(sheets):
            continue
        ws = sheets[t["sheet"]]
        r0, c0, r1, c1 = t["area"]
        flags = t["flags"]
        tb = Table(id=k + 1, displayName=t["name"], name=t["name"], ref=ref_of(r0, c0, r1, c1),
                   totalsRowCount=1 if "t" in flags else None, totalsRowShown=False if "t" not in flags else None)
        tb.tableStyleInfo = TableStyleInfo(name=_custom_out(wb, t["style"]) if t["style"].startswith("Custom:") else (None if t["style"] == "None" else t["style"]), showFirstColumn="f" in flags, showLastColumn="l" in flags, showRowStripes="r" in flags, showColumnStripes="c" in flags)
        for j, name in enumerate(t["cols"]):
            col = TableColumn(id=j + 1, name=name)
            first = ws.cell(row=r0 + 2, column=c0 + j + 1).value
            if t["calc"][j] and isinstance(first, str) and first.startswith("="):
                col.calculatedColumnFormula = TableFormula(attr_text=first[1:])
            if "t" in flags:
                cell = ws.cell(row=r1 + 1, column=c0 + j + 1)
                v = cell.value
                if isinstance(v, str) and v.startswith("="):
                    col.totalsRowFunction = "custom"
                    col.totalsRowFormula = TableFormula(attr_text=v[1:])
                elif v not in (None, ""):
                    col.totalsRowLabel = str(v)
            tb.tableColumns.append(col)
            hdr = ws.cell(row=r0 + 1, column=c0 + j + 1)
            hdr.value = name
            hdr.data_type = "s"
        if "b" in flags:
            tb.autoFilter = AutoFilter(ref=ref_of(r0, c0, r1 - (1 if "t" in flags else 0), c1))
        ws.add_table(tb)
        by_sheet.setdefault(t["sheet"], []).append((tb, (r0, c0, r1 - (1 if "t" in flags else 0), c1)))
    return by_sheet
