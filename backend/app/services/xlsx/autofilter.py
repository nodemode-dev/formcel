from collections import Counter

from openpyxl.styles import Font, PatternFill
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.utils import get_column_letter, range_boundaries
from openpyxl.worksheet.filters import ColorFilter, CustomFilter, CustomFilters, DynamicFilter, FilterColumn, Filters, Top10

from .cf import esc
from .styles import colour_in, colour_out

OPS_IN = {"equal": "eq", "notEqual": "ne", "greaterThan": "gt", "greaterThanOrEqual": "ge", "lessThan": "lt", "lessThanOrEqual": "le"}
OPS_OUT = {v: k for k, v in OPS_IN.items()}
WILD_OUT = {"begins": ("eq", "{}*"), "notbegins": ("ne", "{}*"), "ends": ("eq", "*{}"), "notends": ("ne", "*{}"),
            "contains": ("eq", "*{}*"), "notcontains": ("ne", "*{}*")}


def _plain(s: str) -> bool:
    return not any(ch in s for ch in "*?~")


def _cond_in(op: str, val: str) -> tuple[str, str]:
    op = OPS_IN.get(op or "equal", "eq")
    if op in ("eq", "ne") and len(val) > 1:
        neg = "not" if op == "ne" else ""
        if val.startswith("*") and val.endswith("*") and len(val) > 2 and _plain(val[1:-1]):
            return neg + "contains", val[1:-1]
        if val.endswith("*") and _plain(val[:-1]):
            return neg + "begins", val[:-1]
        if val.startswith("*") and _plain(val[1:]):
            return neg + "ends", val[1:]
    return op, val


def _column_in(fc: FilterColumn, dxfs, notes: Counter) -> list[str] | None:
    if fc.filters is not None:
        if fc.filters.dateGroupItem:
            notes["date group filters left out"] += 1
            return None
        return ["values", "1" if fc.filters.blank else "0", *[str(f) for f in fc.filters.filter]]
    if fc.customFilters is not None:
        parts = fc.customFilters.customFilter[:2]
        if not parts:
            return None
        out = ["cond", "and" if fc.customFilters._and else "or"]
        for cf in parts:
            out.extend(_cond_in(cf.operator, "" if cf.val is None else str(cf.val)))
        return out
    if fc.top10 is not None:
        return ["top", "top" if fc.top10.top is not False else "bottom", str(int(fc.top10.val or 10)), "%" if fc.top10.percent else ""]
    if fc.dynamicFilter is not None and fc.dynamicFilter.type in ("aboveAverage", "belowAverage"):
        return ["avg", "above" if fc.dynamicFilter.type == "aboveAverage" else "below"]
    if fc.colorFilter is not None:
        dxf = dxfs[fc.colorFilter.dxfId] if fc.colorFilter.dxfId is not None and fc.colorFilter.dxfId < len(dxfs) else None
        if fc.colorFilter.cellColor is False:
            c = colour_in(dxf.font.color) if dxf is not None and dxf.font is not None else None
            return ["font", c or "auto"]
        fill = dxf.fill if dxf is not None else None
        c = (colour_in(fill.fgColor) or colour_in(fill.bgColor)) if fill is not None else None
        return ["fill", c or "none"]
    notes["filters FormCel cannot read left out"] += 1
    return None


def filter_in(ws, wb, view: dict, notes: Counter) -> str:
    af = ws.auto_filter
    if af is None or not af.ref:
        return ""
    try:
        c0, r0, c1, r1 = range_boundaries(af.ref)
    except (TypeError, ValueError):
        return ""
    r0, c0, r1, c1 = r0 - 1, c0 - 1, r1 - 1, c1 - 1
    lines = [f"area\t{r0},{c0},{r1},{c1}"]
    dxfs = list(wb._differential_styles.dxf) if wb._differential_styles else []
    for fc in af.filterColumn:
        parts = _column_in(fc, dxfs, notes)
        if parts:
            lines.append(f"col\t{c0 + int(fc.colId)}\t" + "\t".join(esc(p) for p in parts))
    if af.sortState is not None:
        notes["saved sort states left out"] += 1
    rows = view.get("rows") or {}
    hidden = rows.get("hidden", [])
    if len(lines) > 1:
        mine = [r for r in hidden if r0 < r <= r1]
        rows["hidden"] = [r for r in hidden if not r0 < r <= r1]
        lines.append("hidden\t" + ",".join(str(r) for r in mine))
    return "\n".join(lines) + "\n"


def _parse(text: str) -> tuple[tuple[int, int, int, int] | None, list[tuple[int, list[str]]], list[int]]:
    area, cols, hidden = None, [], []
    for line in text.split("\n"):
        p = line.split("\t")
        if p[0] == "area" and len(p) > 1:
            area = tuple(int(x) for x in p[1].split(","))
        elif p[0] == "col" and len(p) > 2:
            cols.append((int(p[1]), [_unesc(x) for x in p[2:]]))
        elif p[0] == "hidden" and len(p) > 1:
            for part in filter(None, p[1].split(",")):
                a, _, b = part.partition("-")
                hidden.extend(range(int(a), int(b or a) + 1))
    return area, cols, hidden


def filtered_rows(text: str) -> set[int]:
    return set(_parse(text)[2]) if text.strip() else set()


def _unesc(s: str) -> str:
    out, it = [], iter(s)
    for ch in it:
        if ch != "\\":
            out.append(ch)
            continue
        nx = next(it, "")
        out.append({"t": "\t", "n": "\n", "r": "\r"}.get(nx, nx))
    return "".join(out)


def filter_out(ws, wb, text: str) -> list[int]:
    if not text.strip():
        return []
    area, cols, hidden = _parse(text)
    if area is None:
        return []
    r0, c0, r1, c1 = area
    ws.auto_filter.ref = f"{get_column_letter(c0 + 1)}{r0 + 1}:{get_column_letter(c1 + 1)}{r1 + 1}"
    for col, p in cols:
        fc = FilterColumn(colId=col - c0)
        kind = p[0]
        if kind == "values":
            fc.filters = Filters(blank=p[1] == "1" or None, filter=p[2:])
        elif kind == "cond":
            parts = []
            for op, val in zip(p[2::2], p[3::2]):
                if op in WILD_OUT:
                    op, pat = WILD_OUT[op]
                    val = pat.format(val)
                parts.append(CustomFilter(operator=OPS_OUT.get(op, "equal"), val=val))
            fc.customFilters = CustomFilters(_and=(p[1] == "and" and len(parts) > 1) or None, customFilter=parts)
        elif kind == "top":
            fc.top10 = Top10(top=p[1] != "bottom", percent=len(p) > 3 and p[3] == "%" or None, val=float(p[2]))
        elif kind == "avg":
            fc.dynamicFilter = DynamicFilter(type="aboveAverage" if p[1] == "above" else "belowAverage")
        elif kind in ("fill", "font"):
            if kind == "fill":
                c = colour_out(p[1]) if p[1] != "none" else None
                dxf = DifferentialStyle(fill=PatternFill(patternType="solid", fgColor=c, bgColor=c) if c else PatternFill())
            else:
                dxf = DifferentialStyle(font=Font(color=colour_out(p[1])) if p[1] != "auto" else Font())
            fc.colorFilter = ColorFilter(dxfId=wb._differential_styles.add(dxf), cellColor=kind == "fill")
        else:
            continue
        ws.auto_filter.filterColumn.append(fc)
    return hidden
