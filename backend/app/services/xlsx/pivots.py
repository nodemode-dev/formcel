import re
import zipfile
from collections import Counter
from datetime import datetime
from io import BytesIO
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape as xml_escape

from openpyxl.pivot.cache import CacheDefinition, CacheField, CacheSource, FieldGroup, GroupItems, RangePr, SharedItems, WorksheetSource
from openpyxl.pivot.fields import Boolean, DateTimeField, Error, Index, Missing, Number, Text
from openpyxl.pivot.record import Record, RecordList
from openpyxl.pivot.table import DataField, FieldItem, Location, PageField, PivotField, RowColField, RowColItem, TableDefinition
from openpyxl.utils import get_column_letter, range_boundaries
from openpyxl.utils.datetime import from_excel, to_excel

from .cf import esc
from .tables import _unesc, parse as table_parse, ref_of

LIST = "\x1f"
PART = "\x1e"
UNITS = ["years", "quarters", "months", "days", "hours", "minutes", "seconds"]
FINE = ["seconds", "minutes", "hours", "days", "months", "quarters", "years"]
TITLES = {"years": "Years", "quarters": "Quarters", "months": "Months", "days": "Days", "hours": "Hours", "minutes": "Minutes", "seconds": "Seconds"}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
FUNCS = {"sum": "sum", "count": "count", "average": "average", "max": "max", "min": "min", "product": "product", "countnums": "countNums", "stdev": "stdDev", "stdevp": "stdDevp", "var": "var", "varp": "varp"}
FUNCS_IN = {v: k for k, v in FUNCS.items()}
NATIVE = {"none": "normal", "grand": "percentOfTotal", "col": "percentOfCol", "row": "percentOfRow", "of": "percent", "diff": "difference", "pdiff": "percentDiff", "run": "runTotal", "index": "index"}
EXTENDED = {"prow": "percentOfParentRow", "pcol": "percentOfParentCol", "parent": "percentOfParent", "prun": "percentOfRunningTotal", "rankasc": "rankAscending", "rankdesc": "rankDescending"}
NATIVE_IN = {v: k for k, v in NATIVE.items()}
EXTENDED_IN = {v: k for k, v in EXTENDED.items()}
PREVIOUS = 1048828
NEXT = 1048829
NONE_ITEM = 1048832
X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
EXT_URI = "{E15A36E0-9728-4e99-A89B-3F7291B0FE68}"


def _split(s: str, sep: str = LIST) -> list[str]:
    return s.split(sep) if s else []


def parse(line: str) -> dict | None:
    p = [_unesc(x) for x in line.split("\t")]
    if len(p) < 13:
        return None
    p += [""] * (14 - len(p))
    try:
        row, col = (int(x) for x in p[2].split(","))
        src = tuple(int(x) for x in p[4].split(","))
        out = None
        if p[7]:
            sh, area = p[7].split(":")
            out = (int(sh), tuple(int(x) for x in area.split(",")))
        values = []
        for v in _split(p[10]):
            q = v.split(PART) + [""] * 6
            if q[0]:
                values.append({"field": q[0], "func": q[1], "show": q[2], "name": q[3], "bf": q[4], "bi": q[5]})
        filters = [(q[0], q[1:]) for q in (f.split(PART) for f in _split(p[11])) if q[0]]
        calc = [tuple(c.split(PART, 1)) for c in _split(p[12]) if PART in c]
        groups = []
        for g in _split(p[13]):
            q = g.split(PART) + [""] * 6
            if q[0]:
                groups.append({"field": q[0], "date": q[1] == "d", "units": [u for u in q[2].split(",") if u in UNITS], "start": float(q[3]) if q[3] else None, "end": float(q[4]) if q[4] else None, "by": float(q[5] or 1)})
        return {"name": p[0], "sheet": int(p[1]), "row": row, "col": col, "src_sheet": int(p[3]), "src": src, "table": p[5], "flags": p[6], "out": out,
                "rows": _split(p[8]), "cols": _split(p[9]), "values": values, "filters": filters, "calc": calc, "groups": groups}
    except (ValueError, TypeError):
        return None


def _line(d: dict) -> str:
    vals = [PART.join([v["field"], v["func"], v["show"], v["name"], v["bf"], v["bi"]]) for v in d["values"]]
    filt = [PART.join([f, *items]) for f, items in d["filters"]]
    calc = [PART.join(c) for c in d["calc"]]
    groups = [PART.join([g["field"], "d" if g["date"] else "n", ",".join(g["units"]), "" if g["start"] is None else repr(g["start"]), "" if g["end"] is None else repr(g["end"]), repr(g["by"])]) for g in d["groups"]]
    out = "" if d["out"] is None else f"{d['out'][0]}:{','.join(str(x) for x in d['out'][1])}"
    parts = [d["name"], str(d["sheet"]), f"{d['row']},{d['col']}", str(d["src_sheet"]), ",".join(str(x) for x in d["src"]), d["table"], d["flags"], out,
             LIST.join(d["rows"]), LIST.join(d["cols"]), LIST.join(vals), LIST.join(filt), LIST.join(calc), LIST.join(groups)]
    return "\t".join(esc(x) for x in parts)


def _num(text: str) -> float | None:
    try:
        n = float(text)
    except ValueError:
        return None
    return n if n == n and abs(n) != float("inf") else None


def _fmt(n: float) -> str:
    return str(int(n)) if n == int(n) and abs(n) < 1e15 else repr(n)


def _unique(names: list[str], want: str) -> str:
    name, k = want, 2
    while any(n.lower() == name.lower() for n in names):
        name = f"{want} {k}"
        k += 1
    return name


def _grid(eng, sheet: int, area: tuple[int, int, int, int]):
    r0, c0, r1, c1 = area
    cells: dict = {}
    for r, c, kind, text in eng.typed(sheet):
        if r0 <= r <= r1 and c0 <= c <= c1 and kind != "f":
            cells[(r, c)] = (kind, text)
    for r, c, kind, text in eng.results(sheet):
        if r0 <= r <= r1 and c0 <= c <= c1:
            cells[(r, c)] = (kind, text)
    return cells


def _value(cell):
    if cell is None or (cell[0] == "t" and cell[1] == ""):
        return ("m", None)
    kind, text = cell
    if kind == "n":
        n = _num(text)
        return ("n", n) if n is not None else ("t", text)
    if kind == "b":
        return ("b", text == "TRUE")
    if kind == "e":
        return ("e", text)
    return ("t", text)


def _label(v) -> str:
    kind, x = v
    if kind == "m":
        return "(blank)"
    if kind == "n":
        return _fmt(x)
    if kind == "b":
        return "TRUE" if x else "FALSE"
    return str(x)


def _sortkey(v):
    kind, x = v
    if kind == "m":
        return (3, 0, "")
    if kind == "n":
        return (0, x, "")
    return (1, 0, _label(v).lower())


def _date(n: float) -> datetime | None:
    try:
        d = from_excel(n)
    except (ValueError, OverflowError, TypeError):
        return None
    return d if isinstance(d, datetime) else datetime(d.year, d.month, d.day)


def _day_slot(d: datetime) -> int:
    return sum(MONTH_DAYS[: d.month - 1]) + d.day - 1


def _date_items(unit: str, g: dict, lo: float, hi: float) -> tuple[list[str], object]:
    d0, d1 = _date(lo), _date(hi)
    pre = f"<{d0.month}/{d0.day}/{d0.year}" if d0 else "<"
    post = f">{d1.month}/{d1.day}/{d1.year}" if d1 else ">"
    multi = any(u in g["units"] for u in ("months", "years", "quarters"))
    if unit == "years":
        y0, y1 = d0.year, d1.year
        return [pre, *[str(y) for y in range(y0, y1 + 1)], post], lambda d: d.year - y0 + 1
    if unit == "quarters":
        return [pre, *[f"Qtr{q}" for q in range(1, 5)], post], lambda d: (d.month - 1) // 3 + 1
    if unit == "months":
        return [pre, *MONTHS, post], lambda d: d.month
    if unit == "days" and multi:
        names = [f"{day}-{MONTHS[m]}" for m, count in enumerate(MONTH_DAYS) for day in range(1, count + 1)]
        return [pre, *names, post], lambda d: _day_slot(d) + 1
    if unit == "days":
        base = int(lo)
        by = max(1, int(g["by"]))
        count = (int(hi) - base) // by + 1
        names = []
        for k in range(min(count, 5000)):
            a = _date(base + k * by)
            names.append(f"{a.day}-{MONTHS[a.month - 1]}" if by == 1 else f"{a.day}-{MONTHS[a.month - 1]}-{a.year}")
        return [pre, *names, post], lambda d: min((int(to_excel(d)) - base) // by + 1, len(names))
    if unit == "hours":
        return [pre, *[str(i) for i in range(24)], post], lambda d: d.hour + 1
    if unit == "minutes":
        return [pre, *[str(i) for i in range(60)], post], lambda d: d.minute + 1
    return [pre, *[str(i) for i in range(60)], post], lambda d: d.second + 1


class Model:
    def __init__(self, eng, d: dict, tables: list[dict]):
        self.d = d
        sheet, area = d["src_sheet"], d["src"]
        t = next((x for x in tables if x["name"].lower() == d["table"].lower()), None) if d["table"] else None
        if t is not None:
            sheet = t["sheet"]
            r0, c0, r1, c1 = t["area"]
            area = (r0, c0, r1 - (1 if "t" in t["flags"] else 0), c1)
        self.sheet, self.area, self.table = sheet, area, t
        r0, c0, r1, c1 = area
        grid = _grid(eng, sheet, area)
        self.headers: list[str] = []
        for c in range(c0, c1 + 1):
            h = _label(_value(grid.get((r0, c)))) if (r0, c) in grid else ""
            self.headers.append(_unique(self.headers, h or f"Column{c - c0 + 1}"))
        self.n = len(self.headers)
        self.rows = [[_value(grid.get((r, c))) for c in range(c0, c1 + 1)] for r in range(r0 + 1, r1 + 1)]
        self.names = list(self.headers)
        self.group_of: dict[int, dict] = {}
        self.chain: dict[int, list[str]] = {}
        self.alias: dict[str, int] = {}
        derived: list[tuple[str, int, str, dict]] = []
        for g in d["groups"]:
            f = next((i for i, h in enumerate(self.headers) if h.lower() == g["field"].lower()), None)
            if f is None:
                continue
            self.group_of[f] = g
            if g["date"]:
                units = [u for u in FINE if u in g["units"]]
                if not units:
                    continue
                self.chain[f] = units
                for u in [x for x in UNITS if x in units]:
                    name = _unique(self.names, TITLES[u])
                    self.names.append(name)
                    if u == units[0]:
                        self.alias[name.lower()] = f
                    else:
                        derived.append((name, f, u, g))
            else:
                name = _unique(self.names, f"{self.headers[f]} groups")
                self.names.append(name)
                self.alias[name.lower()] = f
        self.derived = derived
        self.fields = list(self.headers)
        self.unit_at: dict[int, tuple[int, str]] = {}
        for k, (name, f, u, g) in enumerate(derived):
            self.unit_at[len(self.fields)] = (f, u)
            self.alias[name.lower()] = len(self.fields)
            self.fields.append(name)
        self.calc_at: dict[int, tuple[str, str]] = {}
        for name, formula in d["calc"]:
            self.calc_at[len(self.fields)] = (name, formula.lstrip("="))
            self.alias[name.lower()] = len(self.fields)
            self.fields.append(name)
        for k, h in enumerate(self.headers):
            self.alias.setdefault(h.lower(), k)

    def index_of(self, name: str) -> int | None:
        return self.alias.get(name.lower())


def _field_group(m: Model, f: int, lo: float, hi: float):
    g = m.group_of[f]
    if g["date"]:
        unit = m.chain[f][0]
        items, pick = _date_items(unit, g, lo, hi)
        return unit, items, pick
    by = g["by"]
    count = int((hi - lo) // by) + 1
    whole = lo == int(lo) and by == int(by)
    names = [f"{_fmt(lo + k * by)}-{_fmt(lo + k * by + by - (1 if whole else 0))}" for k in range(count)]
    return "range", [f"<{_fmt(lo)}", *names, f">{_fmt(hi)}"], None


def _group_bounds(m: Model, f: int) -> tuple[float, float] | None:
    g = m.group_of[f]
    nums = [r[f][1] for r in m.rows if r[f][0] == "n"]
    if not nums:
        return None
    lo = g["start"] if g["start"] is not None else min(nums)
    hi = g["end"] if g["end"] is not None else max(nums)
    if g["date"]:
        lo, hi = float(int(lo)), float(int(hi))
    return lo, hi


def _slot(m: Model, f: int, unit: str, value, bounds, items, pick) -> int | None:
    kind, x = value
    if kind != "n":
        return None
    lo, hi = bounds
    g = m.group_of[f]
    if g["date"]:
        if x < lo:
            return 0
        if x >= hi + 1:
            return len(items) - 1
        d = _date(x)
        return None if d is None else min(pick(d), len(items) - 2)
    if x < lo:
        return 0
    if x > hi:
        return len(items) - 1
    return min(int((x - lo) // g["by"]) + 1, len(items) - 2)


def _shared_attrs(vals: list) -> dict:
    kinds = Counter(k for k, _ in vals)
    nums = [x for k, x in vals if k == "n"]
    out = {"containsSemiMixedTypes": bool(kinds["t"] or kinds["m"] or kinds["e"]), "containsString": bool(kinds["t"]), "containsBlank": bool(kinds["m"]) or None,
           "containsNumber": bool(kinds["n"]) or None, "containsMixedTypes": (len([k for k in ("t", "n", "b", "e") if kinds[k]]) > 1) or None}
    if nums:
        out["containsInteger"] = all(x == int(x) for x in nums) or None
        out["minValue"], out["maxValue"] = min(nums), max(nums)
    if kinds["b"] and not kinds["t"]:
        out["containsString"] = False
    return out


def _entry(v):
    kind, x = v
    if kind == "n":
        return Number(v=x)
    if kind == "b":
        return Boolean(v=x)
    if kind == "e":
        return Error(v=x)
    if kind == "m":
        return Missing()
    return Text(v=str(x))


def _items_obj(vals: list):
    return SharedItems(_fields=[_entry(v) for v in vals])


def build(eng, d: dict, tables: list[dict], cache_id: int, wb):
    m = Model(eng, d, tables)
    rows_idx = [m.index_of(n) for n in d["rows"]]
    cols_idx = [m.index_of(n) for n in d["cols"]]
    if any(i is None for i in rows_idx + cols_idx) or not m.rows:
        return None
    rows_idx = [i for i in rows_idx if i is not None]
    cols_idx = [i for i in cols_idx if i is not None]
    page_idx = []
    for name, items in d["filters"]:
        i = m.index_of(name)
        if i is not None and i not in rows_idx and i not in cols_idx:
            page_idx.append((i, items))
    hidden_filters = {m.index_of(n): items for n, items in d["filters"] if m.index_of(n) in rows_idx + cols_idx}
    axis_fields = set(rows_idx) | set(cols_idx) | {i for i, _ in page_idx} | set(hidden_filters)
    bounds = {f: _group_bounds(m, f) for f in m.group_of}
    group_info: dict[int, tuple] = {}
    for f, b in bounds.items():
        if b is None:
            continue
        unit, items, pick = _field_group(m, f, *b)
        group_info[f] = (unit, items, pick, b)
    dates = {f for f, g in m.group_of.items() if g["date"] and f in group_info}
    shared: dict[int, list] = {}
    shared_pos: dict[int, dict] = {}
    for f in range(m.n):
        if f in group_info:
            continue
        col = [r[f] for r in m.rows]
        kinds = {k for k, _ in col}
        if f in axis_fields or kinds & {"t", "b", "e"} or ("m" in kinds and "n" not in kinds):
            uniq: dict = {}
            for v in col:
                uniq.setdefault((v[0], v[1]), v)
            order = sorted(uniq.values(), key=_sortkey)
            shared[f] = order
            shared_pos[f] = {(v[0], v[1]): i for i, v in enumerate(order)}
    unit_info: dict[int, tuple] = {}
    for fi, (f, u) in m.unit_at.items():
        if f in group_info:
            g = m.group_of[f]
            items, pick = _date_items(u, g, *group_info[f][3])
            unit_info[fi] = (u, items, pick)
    cache_fields = []
    pivot_fields = []
    for f in range(m.n):
        col = [r[f] for r in m.rows]
        name = m.headers[f]
        cf = CacheField(name=name, numFmtId=14 if f in dates else 0)
        if f in group_info:
            unit, items, pick, (lo, hi) = group_info[f]
            g = m.group_of[f]
            if f in dates:
                nums = [x for k, x in col if k == "n"]
                attrs = {"containsSemiMixedTypes": False, "containsNonDate": False, "containsDate": True, "containsString": False}
                if any(k != "n" for k, _ in col):
                    attrs.update(containsSemiMixedTypes=True, containsBlank=True)
                lo_d, hi_d = _date(min(nums)), _date(max(nums))
                cf.sharedItems = SharedItems(minDate=lo_d, maxDate=hi_d, **attrs)
                par = next((fi for fi, (ff, u) in m.unit_at.items() if ff == f and u == m.chain[f][1]), None) if len(m.chain[f]) > 1 else None
                rp = RangePr(groupBy=unit, startDate=_date(lo), endDate=_date(hi), autoStart=g["start"] is None, autoEnd=g["end"] is None, groupInterval=int(g["by"]) if unit == "days" else 1)
                cf.fieldGroup = FieldGroup(par=par, base=f, rangePr=rp, groupItems=GroupItems(s=[Text(v=s) for s in items]))
            else:
                attrs = _shared_attrs(col)
                attrs.update(containsSemiMixedTypes=any(k != "n" for k, _ in col), containsString=False, containsNumber=True)
                cf.sharedItems = SharedItems(**attrs)
                rp = RangePr(startNum=lo, endNum=hi, autoStart=g["start"] is None, autoEnd=g["end"] is None, groupInterval=g["by"])
                cf.fieldGroup = FieldGroup(base=f, rangePr=rp, groupItems=GroupItems(s=[Text(v=s) for s in items]))
        elif f in shared:
            attrs = _shared_attrs(shared[f])
            si = _items_obj(shared[f])
            for k, v in attrs.items():
                setattr(si, k, v)
            cf.sharedItems = si
        else:
            cf.sharedItems = SharedItems(**_shared_attrs(col))
        cache_fields.append(cf)
    for fi in range(m.n, len(m.fields)):
        name = m.fields[fi]
        if fi in m.calc_at:
            cache_fields.append(CacheField(name=name, formula=m.calc_at[fi][1], numFmtId=0, databaseField=False, sharedItems=SharedItems()))
            continue
        cf = CacheField(name=name, numFmtId=0, databaseField=False, sharedItems=SharedItems())
        if fi in unit_info:
            u, items, pick = unit_info[fi]
            f = m.unit_at[fi][0]
            chain = m.chain[f]
            at = chain.index(u)
            nxt = next((j for j, (ff, uu) in m.unit_at.items() if ff == f and at + 1 < len(chain) and uu == chain[at + 1]), None)
            g = m.group_of[f]
            lo, hi = group_info[f][3]
            rp = RangePr(groupBy=u, startDate=_date(lo), endDate=_date(hi), autoStart=g["start"] is None, autoEnd=g["end"] is None)
            cf.fieldGroup = FieldGroup(par=nxt, base=f, rangePr=rp, groupItems=GroupItems(s=[Text(v=s) for s in items]))
        cache_fields.append(cf)

    def slot_of(fi: int, rec: int) -> int | None:
        if fi in unit_info:
            u, items, pick = unit_info[fi]
            f = m.unit_at[fi][0]
            return _slot(m, f, u, m.rows[rec][f], group_info[f][3], items, pick)
        if fi in group_info:
            unit, items, pick, b = group_info[fi]
            return _slot(m, fi, unit, m.rows[rec][fi], b, items, pick)
        if fi in shared_pos:
            v = m.rows[rec][fi]
            return shared_pos[fi][(v[0], v[1])]
        return None

    def item_labels(fi: int) -> list[str]:
        if fi in unit_info:
            return unit_info[fi][1]
        if fi in group_info:
            return group_info[fi][1]
        return [_label(v) for v in shared.get(fi, [])]

    keep = list(range(len(m.rows)))
    hidden_map: dict[int, set[str]] = {}
    for fi, items in [(i, it) for i, it in page_idx] + list(hidden_filters.items()):
        if items:
            hidden_map[fi] = {l for l in item_labels(fi) if l not in items and not (l.startswith("<") or l.startswith(">"))}
    for fi, hide in hidden_map.items():
        labels = item_labels(fi)
        keep = [r for r in keep if slot_of(fi, r) is None or labels[slot_of(fi, r)] not in hide]

    for fi in range(len(m.fields)):
        axis = "axisRow" if fi in rows_idx else "axisCol" if fi in cols_idx else "axisPage" if any(fi == i for i, _ in page_idx) else None
        is_data = any(m.index_of(v["field"]) == fi for v in d["values"])
        pf = PivotField(axis=axis, dataField=True if is_data else None, showAll=False, compact=True, outline=True, defaultSubtotal=True, sortType="ascending" if axis in ("axisRow", "axisCol") else "manual", multipleItemSelectionAllowed=True if fi in hidden_map and hidden_map[fi] and axis == "axisPage" else None)
        if fi in group_info or fi in unit_info or fi in shared:
            labels = item_labels(fi)
            hide = hidden_map.get(fi, set())
            pf.items = [FieldItem(x=i, h=True if labels[i] in hide else None) for i in range(len(labels))] + [FieldItem(t="default")]
        pivot_fields.append(pf)

    if m.table is not None:
        source = CacheSource(type="worksheet", worksheetSource=WorksheetSource(name=m.table["name"]))
    else:
        r0, c0, r1, c1 = m.area
        source = CacheSource(type="worksheet", worksheetSource=WorksheetSource(ref=ref_of(r0, c0, r1, c1), sheet=wb.worksheets[m.sheet].title))
    cache = CacheDefinition(refreshOnLoad=True, refreshedBy="FormCel", createdVersion=6, refreshedVersion=6, minRefreshableVersion=3, recordCount=len(m.rows),
                            cacheSource=source, cacheFields=cache_fields)
    records = []
    for r, row in enumerate(m.rows):
        fields = []
        for f in range(m.n):
            v = row[f]
            if f in dates:
                fields.append(DateTimeField(v=_date(v[1])) if v[0] == "n" and _date(v[1]) else Missing())
            elif f in shared_pos:
                fields.append(Index(v=shared_pos[f][(v[0], v[1])]))
            else:
                fields.append(_entry(v))
        records.append(Record(_fields=fields))
    cache.records = RecordList(r=records)

    nv = len(d["values"])
    row_fields = [RowColField(x=i) for i in rows_idx]
    col_fields = [RowColField(x=i) for i in cols_idx]
    if nv > 1:
        col_fields.append(RowColField(x=-2))
    taken = {n.lower() for n in m.fields}
    data_fields, extended = [], {}
    for v in d["values"]:
        fi = m.index_of(v["field"])
        if fi is None:
            continue
        name = v["name"] or f"{v['func'].title()} of {v['field']}"
        while name.lower() in taken:
            name += " "
        taken.add(name.lower())
        show = v["show"] or "none"
        bf, bi = -1, NONE_ITEM
        if v["bf"]:
            b = m.index_of(v["bf"])
            if b is not None:
                bf = b
                if v["bi"] == "(previous)":
                    bi = PREVIOUS
                elif v["bi"] == "(next)":
                    bi = NEXT
                elif v["bi"]:
                    labels = item_labels(b)
                    bi = labels.index(v["bi"]) if v["bi"] in labels else NONE_ITEM
                    if bi == NONE_ITEM:
                        bf = -1
        data_fields.append(DataField(name=name, fld=fi, subtotal=FUNCS.get(v["func"], "sum"), showDataAs=NATIVE.get(show, "normal"), baseField=bf, baseItem=bi))
        if show in EXTENDED:
            extended[name] = EXTENDED[show]

    def paths(fields: list[int]):
        seen = set()
        for r in keep:
            p = tuple(slot_of(f, r) for f in fields)
            if None not in p:
                seen.add(p)
        return sorted(seen)

    def entries(fields: list[int], grand: bool, with_values: bool, subtotals: bool):
        k = len(fields)
        out = []
        if not k:
            if with_values:
                return [RowColItem(i=i, x=[Index(v=i)]) for i in range(nv)]
            return [RowColItem()]
        ps = paths(fields)
        nested = subtotals and k > 1
        seq, seen = [], set()
        for p in ps:
            if not nested:
                seq.append(p)
                continue
            for depth in range(1, k + 1):
                if p[:depth] not in seen:
                    seen.add(p[:depth])
                    seq.append(p[:depth])
        prev: tuple = ()
        for p in seq:
            r = len(p) - 1
            if not nested:
                r = 0
                while r < len(p) - 1 and r < len(prev) and prev[r] == p[r]:
                    r += 1
            prev = p
            if with_values:
                for i in range(nv):
                    rr = r if i == 0 else len(p)
                    out.append(RowColItem(r=rr, i=i, x=[Index(v=x) for x in (*p[rr:], i)]))
            else:
                out.append(RowColItem(r=r, x=[Index(v=x) for x in p[r:]]))
        if grand:
            if with_values:
                out.extend(RowColItem(t="grand", i=i, x=[Index(v=i)]) for i in range(nv))
            else:
                out.append(RowColItem(t="grand", x=[Index(v=0)]))
        return out

    flags = d["flags"]
    subtotals = "s" in flags
    row_items = entries(rows_idx, "r" in flags, False, subtotals)
    col_items = entries(cols_idx, "c" in flags, nv > 1, subtotals)
    page_fields = []
    for i, items in page_idx:
        labels = item_labels(i)
        pick = labels.index(items[0]) if len(items) == 1 and items[0] in labels else None
        page_fields.append(PageField(fld=i, item=pick, hier=-1))
    ref = _location(d, len(page_idx))
    levels = len(col_fields)
    if cols_idx:
        loc = Location(ref=ref, firstHeaderRow=1, firstDataRow=1 + levels, firstDataCol=1)
    else:
        loc = Location(ref=ref, firstHeaderRow=0 if nv > 1 else 1, firstDataRow=1, firstDataCol=1)
    if page_idx:
        loc.rowPageCount, loc.colPageCount = len(page_idx), 1
    pt = TableDefinition(name=d["name"], cacheId=cache_id, dataCaption="Values", updatedVersion=6, minRefreshableVersion=3, createdVersion=6, useAutoFormatting=True, itemPrintTitles=True, indent=0,
                         outline=True, outlineData=True, multipleFieldFilters=False, rowGrandTotals="c" in flags, colGrandTotals="r" in flags, location=loc, pivotFields=pivot_fields,
                         rowFields=row_fields, colFields=col_fields, rowItems=row_items, colItems=col_items, pageFields=page_fields, dataFields=data_fields)
    pt.cache = cache
    return pt, extended


def _location(d: dict, pages: int) -> str:
    if d["out"] is None:
        return ref_of(d["row"] + (pages + 1 if pages else 0), d["col"], d["row"] + 1 + (pages + 1 if pages else 0), d["col"] + 1)
    r0, c0, r1, c1 = d["out"][1]
    if pages:
        r0 = min(r0 + pages + 1, r1)
    return ref_of(r0, c0, r1, c1)


def pivots_out(wb, eng) -> dict:
    tables = [table_parse(t) for t in eng.tables()]
    extras: dict[str, dict] = {}
    for k, line in enumerate(eng.pivots()):
        d = parse(line)
        if d is None or d["sheet"] >= len(wb.worksheets):
            continue
        try:
            made = build(eng, d, tables, k + 1, wb)
        except (ValueError, TypeError, KeyError, IndexError, AttributeError, ArithmeticError):
            made = None
        if made is None:
            continue
        pt, extended = made
        wb.worksheets[d["sheet"]].add_pivot(pt)
        if extended:
            extras[d["name"]] = extended
    return extras


def finish(blob: bytes, extras: dict[str, dict]) -> bytes:
    if not extras:
        return blob
    src = zipfile.ZipFile(BytesIO(blob))
    out = BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename.startswith("xl/pivotTables/pivotTable") and item.filename.endswith(".xml"):
                text = data.decode("utf-8")
                m = re.search(r'<pivotTableDefinition[^>]*?\sname="([^"]*)"', text)
                name = _xml_unescape(m.group(1)) if m else ""
                for field, show in extras.get(name, {}).items():
                    key = xml_escape(field, {'"': "&quot;"})
                    tail = f'><extLst><ext xmlns:x14="{X14}" uri="{EXT_URI}"><x14:dataField pivotShowAs="{show}"/></ext></extLst></dataField>'
                    text = re.sub(r'(<dataField name="' + re.escape(key) + r'"[^>]*?)\s*/>', lambda mm: mm.group(1) + tail, text, count=1)
                data = text.encode("utf-8")
            dst.writestr(item, data)
    return out.getvalue()


def _xml_unescape(s: str) -> str:
    return s.replace("&quot;", '"').replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def _ext_shows(data: bytes) -> dict[str, list[str | None]]:
    out: dict[str, list[str | None]] = {}
    try:
        with zipfile.ZipFile(BytesIO(data)) as z:
            for n in z.namelist():
                if not (n.startswith("xl/pivotTables/pivotTable") and n.endswith(".xml")):
                    continue
                root = ET.fromstring(z.read(n))
                shows: list[str | None] = []
                df = root.find(f"{{{MAIN}}}dataFields")
                for f in (df if df is not None else []):
                    hit = None
                    for e in f.iter(f"{{{X14}}}dataField"):
                        hit = e.get("pivotShowAs")
                    shows.append(hit)
                out[root.get("name", "")] = shows
    except (zipfile.BadZipFile, ET.ParseError, KeyError):
        pass
    return out


def _item_text(it) -> str:
    kind = it.tagname
    v = getattr(it, "v", None)
    if kind == "m":
        return "(blank)"
    if kind == "n":
        return _fmt(float(v))
    if kind == "b":
        return "TRUE" if v else "FALSE"
    if kind == "d":
        return v.isoformat() if hasattr(v, "isoformat") else str(v)
    return str(v)


def _items_of(cf) -> list[str]:
    if cf.fieldGroup is not None and cf.fieldGroup.groupItems is not None:
        gi = cf.fieldGroup.groupItems
        return [_item_text(x) for x in [*gi.m, *gi.n, *gi.b, *gi.e, *gi.s, *gi.d]]
    si = cf.sharedItems
    return [_item_text(x) for x in si._fields] if si is not None else []


def _source(wb, cache, sheet_index: dict):
    ws = cache.cacheSource.worksheetSource if cache.cacheSource is not None else None
    if ws is None or cache.cacheSource.type != "worksheet":
        return None
    if ws.name:
        for sh in wb.worksheets:
            t = sh.tables.get(ws.name)
            if t is not None:
                c0, r0, c1, r1 = range_boundaries(t.ref)
                if t.totalsRowCount:
                    r1 -= 1
                return sheet_index.get(sh.title), (r0 - 1, c0 - 1, r1 - 1, c1 - 1), t.displayName or t.name
        dn = wb.defined_names.get(ws.name)
        text = (dn.attr_text or "") if dn is not None else ""
        if "!" in text:
            name, ref = text.rsplit("!", 1)
            name = name.strip("'").replace("''", "'")
            try:
                c0, r0, c1, r1 = range_boundaries(ref.replace("$", ""))
            except (TypeError, ValueError):
                return None
            return sheet_index.get(name), (r0 - 1, c0 - 1, r1 - 1, c1 - 1), ""
        return None
    if ws.ref and ws.sheet:
        try:
            c0, r0, c1, r1 = range_boundaries(ws.ref.replace("$", ""))
        except (TypeError, ValueError):
            return None
        return sheet_index.get(ws.sheet), (r0 - 1, c0 - 1, r1 - 1, c1 - 1), ""
    return None


def pivot_in(wb, ws_index: int, pt, sheet_index: dict, shows: list, notes: Counter) -> str | None:
    cache = pt.cache
    if cache is None or not pt.location:
        notes["pivot tables FormCel could not read left out"] += 1
        return None
    src = _source(wb, cache, sheet_index)
    if src is None or src[0] is None:
        notes["pivot tables with data from outside the sheets left out"] += 1
        return None
    src_sheet, area, table = src
    cfs = list(cache.cacheFields)
    names = [cf.name for cf in cfs]
    engine_name = list(names)
    groups = []
    taken = [n for i, n in enumerate(names) if cfs[i].databaseField is not False]
    by_base: dict[int, list[int]] = {}
    for i, cf in enumerate(cfs):
        fg = cf.fieldGroup
        if fg is not None and fg.rangePr is not None and fg.rangePr.groupBy in UNITS:
            by_base.setdefault(fg.base if fg.base is not None else i, []).append(i)
    for base, members in by_base.items():
        rp = cfs[base].fieldGroup.rangePr if cfs[base].fieldGroup is not None else cfs[members[0]].fieldGroup.rangePr
        units = [cfs[i].fieldGroup.rangePr.groupBy for i in members]
        start = to_excel(rp.startDate) if rp.startDate is not None and not rp.autoStart else None
        end = to_excel(rp.endDate) if rp.endDate is not None and not rp.autoEnd else None
        by = float(rp.groupInterval or 1) if "days" in units else 1.0
        groups.append({"field": names[base], "date": True, "units": units, "start": start, "end": end, "by": by})
        for u in [x for x in UNITS if x in units]:
            nm = _unique(taken, TITLES[u])
            taken.append(nm)
            for i in members:
                if cfs[i].fieldGroup.rangePr.groupBy == u:
                    engine_name[i] = nm
    for i, cf in enumerate(cfs):
        fg = cf.fieldGroup
        if fg is not None and fg.rangePr is not None and fg.rangePr.groupBy == "range":
            rp = fg.rangePr
            groups.append({"field": cf.name, "date": False, "units": [], "start": rp.startNum if not rp.autoStart else None, "end": rp.endNum if not rp.autoEnd else None, "by": float(rp.groupInterval or 1)})
            nm = _unique(taken, f"{cf.name} groups")
            taken.append(nm)
            engine_name[i] = nm
    calc = [(cf.name, cf.formula) for cf in cfs if cf.formula]

    def nm(i: int) -> str | None:
        return engine_name[i] if 0 <= i < len(engine_name) else None

    pfs = list(pt.pivotFields)

    def visible(i: int) -> list[str] | None:
        pf = pfs[i] if i < len(pfs) else None
        if pf is None or not pf.items:
            return None
        labels = _items_of(cfs[i])
        hidden = [it for it in pf.items if it.h and it.x is not None and it.t == "data"]
        if not hidden:
            return None
        shown = [labels[it.x] for it in pf.items if it.t == "data" and not it.h and it.x is not None and it.x < len(labels)]
        return shown

    rows = [nm(f.x) for f in pt.rowFields if f.x >= 0]
    cols = [nm(f.x) for f in pt.colFields if f.x >= 0]
    filters = []
    for pg in pt.pageFields:
        labels = _items_of(cfs[pg.fld])
        vis = visible(pg.fld)
        if pg.item is not None and 0 <= pg.item < len(labels) and pg.item != 32767:
            filters.append((nm(pg.fld), [labels[pg.item]]))
        else:
            filters.append((nm(pg.fld), vis or []))
    for f in [*pt.rowFields, *pt.colFields]:
        if f.x >= 0:
            vis = visible(f.x)
            if vis is not None:
                filters.append((nm(f.x), vis))
    values = []
    for k, df in enumerate(pt.dataFields):
        extra = shows[k] if k < len(shows) else None
        show = EXTENDED_IN.get(extra) if extra else None
        show = show or NATIVE_IN.get(df.showDataAs, "none")
        bf, bi = "", ""
        if show not in ("none", "grand", "col", "row", "index") and df.baseField is not None and 0 <= df.baseField < len(cfs):
            bf = nm(df.baseField) or ""
            if df.baseItem == PREVIOUS:
                bi = "(previous)"
            elif df.baseItem == NEXT:
                bi = "(next)"
            elif df.baseItem is not None and df.baseItem != NONE_ITEM:
                labels = _items_of(cfs[df.baseField])
                bi = labels[df.baseItem] if 0 <= df.baseItem < len(labels) else ""
        values.append({"field": nm(df.fld) or "", "func": FUNCS_IN.get(df.subtotal, "sum"), "show": show, "name": df.name or "", "bf": bf, "bi": bi})
    if None in rows + cols or any(not v["field"] for v in values) or not values:
        notes["pivot tables FormCel could not read left out"] += 1
        return None
    try:
        c0, r0, c1, r1 = range_boundaries(pt.location.ref)
    except (TypeError, ValueError):
        notes["pivot tables FormCel could not read left out"] += 1
        return None
    pages = pt.location.rowPageCount or 0
    top = r0 - 1 - (pages + 1 if pages else 0)
    flags = ("r" if pt.colGrandTotals is not False else "") + ("c" if pt.rowGrandTotals is not False else "")
    flags += "s" if len(rows) > 1 and any(p.defaultSubtotal is not False for p in pfs) else ""
    d = {"name": pt.name, "sheet": ws_index, "row": max(top, 0), "col": c0 - 1, "src_sheet": src_sheet, "src": area, "table": table, "flags": flags,
         "out": (ws_index, (max(top, 0), c0 - 1, r1 - 1, c1 - 1)), "rows": rows, "cols": cols, "values": values, "filters": [(n, i) for n, i in filters if n], "calc": calc, "groups": groups}
    return _line(d)


def pivots_in(wb, data: bytes, sheet_index: dict, notes: Counter) -> list[str]:
    ext = _ext_shows(data)
    lines: list[str] = []
    for ws in wb.worksheets:
        i = sheet_index.get(ws.title)
        if i is None:
            continue
        for pt in getattr(ws, "_pivots", []):
            try:
                line = pivot_in(wb, i, pt, sheet_index, ext.get(pt.name, []), notes)
            except (ValueError, TypeError, KeyError, IndexError, AttributeError, ArithmeticError):
                line = None
                notes["pivot tables FormCel could not read left out"] += 1
            if line:
                lines.append(line)
    return lines
