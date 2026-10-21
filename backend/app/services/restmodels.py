import re

from . import ranges

LIST = "\x1f"
PART = "\x1e"
SHEET_REF = re.compile(r"^(?:'((?:[^']|'')+)'|([^!']+))!(.+)$")


class ModelError(ValueError):
    pass


def esc(s) -> str:
    return str(s).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def unesc(s: str) -> str:
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            out.append({"t": "\t", "n": "\n", "r": "\r"}.get(s[i + 1], s[i + 1]))
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def a1(area) -> str:
    r0, c0, r1, c1 = area
    first = f"{ranges.col_name(c0)}{r0 + 1}"
    return first if (r0, c0) == (r1, c1) else f"{first}:{ranges.col_name(c1)}{r1 + 1}"


def area_of(text: str) -> tuple[int, int, int, int]:
    try:
        return ranges.parse_area(text)
    except ValueError as e:
        raise ModelError(str(e))


def ints(text: str) -> list[int]:
    return [int(x) for x in text.split(",") if x.strip().lstrip("-").isdigit()]


def sheet_ref(ref: str, names: list[str], default: int = 0) -> tuple[int, tuple[int, int, int, int]]:
    ref = ref.strip()
    if "!" in ref:
        try:
            i, area = ranges.split_sheet(ref, names)
        except ValueError as e:
            raise ModelError(str(e))
        return i, area_of(area)
    return default, area_of(ref)


def sheet_name_ref(names: list[str], i: int, area) -> str:
    n = names[i]
    q = f"'{n}'" if re.search(r"[^A-Za-z0-9_]", n) else n
    return f"{q}!{a1(area)}"


def style_patch(style: dict | None) -> str:
    if not style:
        return ""
    parts = []
    for key, tok in (("bold", "b"), ("italic", "i"), ("underline", "u"), ("wrap", "wrap")):
        v = style.get(key)
        if v is not None:
            parts.append(tok if v else "!" + tok)
    for key, tok in (("fill", "bg"), ("color", "fc")):
        v = style.get(key)
        if v:
            parts.append(f"{tok}:{str(v).lstrip('#').lower()}")
    if style.get("size"):
        parts.append(f"sz:{int(style['size'])}")
    if style.get("font"):
        parts.append("ff:" + str(style["font"]).replace(";", ""))
    if style.get("align"):
        parts.append("ha:" + str(style["align"]))
    return ";".join(parts)


def style_dict(patch: str) -> dict:
    out: dict = {}
    for tok in [t for t in patch.split(";") if t]:
        neg = tok.startswith("!")
        t = tok.lstrip("!")
        if t in ("b", "i", "u", "wrap"):
            out[{"b": "bold", "i": "italic", "u": "underline", "wrap": "wrap"}[t]] = not neg
        elif ":" in t:
            k, v = t.split(":", 1)
            key = {"bg": "fill", "fc": "color", "sz": "size", "ff": "font", "ha": "align"}.get(k)
            if key:
                out[key] = int(v) if k == "sz" and v.isdigit() else v
    return out


def table_json(line: str, names: list[str]) -> dict:
    p = line.split("\t")
    n = int(p[5])
    area = ints(p[2])
    flags = p[3]
    cols = [unesc(x) for x in p[6:6 + n]]
    types = [unesc(x) for x in p[6 + 3 * n:6 + 4 * n]] if len(p) >= 6 + 4 * n else [""] * n
    i = int(p[0])
    return {
        "name": unesc(p[1]), "sheet": names[i] if i < len(names) else i, "range": a1(area), "totalsRow": "t" in flags,
        "bandedRows": "r" in flags, "bandedColumns": "c" in flags, "firstColumn": "f" in flags, "lastColumn": "l" in flags, "filterButton": "b" in flags,
        "style": unesc(p[4]), "columns": [{"name": c, "type": types[k] or "text"} for k, c in enumerate(cols)],
    }


def table_line(old: str, patch: dict) -> str:
    p = old.split("\t")
    n = int(p[5])
    flags = p[3]
    pairs = (("totalsRow", "t"), ("bandedRows", "r"), ("bandedColumns", "c"), ("firstColumn", "f"), ("lastColumn", "l"), ("filterButton", "b"))
    new_flags = "".join(ch for key, ch in pairs if (patch[key] if patch.get(key) is not None else ch in flags))
    area = ints(p[2])
    if patch.get("range"):
        area = list(area_of(patch["range"]))
    w = area[3] - area[1] + 1

    def fit(chunk: list[str]) -> list[str]:
        return (chunk + [""] * w)[:w]

    cols, calc, kept = p[6:6 + n], p[6 + n:6 + 2 * n], p[6 + 2 * n:6 + 3 * n]
    types = p[6 + 3 * n:6 + 4 * n] if len(p) >= 6 + 4 * n else []
    name = esc(patch["name"]) if patch.get("name") else p[1]
    style = esc(patch["style"]) if patch.get("style") else p[4]
    return "\t".join([name, ",".join(str(x) for x in area), new_flags, style, str(w)] + fit(cols) + fit(calc) + fit(kept) + (fit(types) if types else []))


FUNCS = ["sum", "count", "average", "max", "min", "product", "countnums", "stdev", "stdevp", "var", "varp"]
SHOWS = ["none", "grand", "col", "row", "of", "prow", "pcol", "parent", "diff", "pdiff", "run", "prun", "rankasc", "rankdesc", "index"]


def pivot_json(line: str, names: list[str]) -> dict:
    p = [unesc(x) for x in line.split("\t")]
    if len(p) < 13:
        raise ModelError("unreadable pivot")
    row, col = ints(p[2])
    src_sheet = int(p[3])
    out = None
    if p[7]:
        s, _, area = p[7].partition(":")
        out = {"sheet": names[int(s)] if int(s) < len(names) else int(s), "range": a1(ints(area))}
    vals = []
    for v in [x for x in p[10].split(LIST) if x]:
        q = v.split(PART)
        vals.append({"field": q[0], "function": q[1], "show": q[2], "name": q[3], "baseField": q[4] if len(q) > 4 else "", "baseItem": q[5] if len(q) > 5 else ""})
    filters = []
    for v in [x for x in p[11].split(LIST) if x]:
        q = v.split(PART)
        filters.append({"field": q[0], "items": q[1:]})
    calc = []
    for v in [x for x in p[12].split(LIST) if x]:
        n, _, f = v.partition(PART)
        calc.append({"name": n, "formula": f})
    i = int(p[1])
    return {
        "name": p[0], "sheet": names[i] if i < len(names) else i, "cell": f"{ranges.col_name(col)}{row + 1}",
        "source": sheet_name_ref(names, src_sheet, ints(p[4])) if src_sheet < len(names) else p[4], "table": p[5],
        "rowGrandTotals": "r" in p[6], "columnGrandTotals": "c" in p[6], "subtotals": "s" in p[6], "autoRefresh": "a" in p[6],
        "rows": [x for x in p[8].split(LIST) if x], "columns": [x for x in p[9].split(LIST) if x], "values": vals, "filters": filters, "calculatedFields": calc, "output": out,
    }


def pivot_line(body: dict, names: list[str], header: list[str], dest: int, cell: tuple[int, int], src: tuple[int, tuple[int, int, int, int]], table: str = "") -> str:
    low = {h.lower(): h for h in header}

    def field(name: str) -> str:
        f = low.get(str(name).lower())
        if f is None:
            raise ModelError(f"the source has no field {name}. Fields: {', '.join(header)}")
        return f

    rows = [field(x) for x in body.get("rows") or []]
    cols = [field(x) for x in body.get("columns") or []]
    vals = []
    for v in body.get("values") or []:
        fn = str(v.get("function") or "sum").lower()
        if fn not in FUNCS:
            raise ModelError(f"function must be one of {', '.join(FUNCS)}")
        show = v.get("show") or "none"
        if show not in SHOWS:
            raise ModelError(f"show must be one of {', '.join(SHOWS)}")
        f = field(v.get("field"))
        label = v.get("name") or f"{fn.capitalize()} of {f}"
        vals.append(PART.join([f, fn, show, label, v.get("baseField") or "", v.get("baseItem") or ""]))
    if not vals:
        raise ModelError("a pivot table needs at least one value field")
    flt = [PART.join([field(f["field"])] + [str(i) for i in f.get("items") or []]) for f in body.get("filters") or []]
    calc = [PART.join([c["name"], c["formula"]]) for c in body.get("calculatedFields") or []]
    flags = ("r" if body.get("rowGrandTotals", True) else "") + ("c" if body.get("columnGrandTotals", True) else "") + ("s" if body.get("subtotals", True) else "") + ("a" if body.get("autoRefresh") else "")
    sheet_i, area = src
    fields = [esc(body.get("name") or ""), str(dest), f"{cell[0]},{cell[1]}", str(sheet_i), ",".join(str(x) for x in area), esc(table), flags, "", LIST.join(rows), LIST.join(cols), LIST.join(vals), LIST.join(flt), LIST.join(calc), ""]
    return "\t".join(fields)


CF_OPS = ["gt", "lt", "ge", "le", "eq", "ne", "between", "notbetween"]
CF_DATES = ["yesterday", "today", "tomorrow", "last7", "lastweek", "thisweek", "nextweek", "lastmonth", "thismonth", "nextmonth"]
CF_TYPES = ["cell", "text", "date", "duplicates", "top", "average", "blanks", "formula", "colorScale", "dataBar", "iconSet"]


def hexc(s: str) -> str:
    s = str(s).lstrip("#").lower()
    if not re.fullmatch(r"[0-9a-f]{6}", s):
        raise ModelError(f"{s} is not a colour such as 3366cc")
    return s


def cf_line(body: dict) -> str:
    area = area_of(body.get("range") or "")
    t = body.get("type")
    stop = "1" if body.get("stopIfTrue") else "0"
    x = y = z = ""
    if t == "cell":
        x, y, z = body.get("operator") or "", str(body.get("value", "")), str(body.get("value2", "") if body.get("value2") is not None else "")
        if x not in CF_OPS:
            raise ModelError(f"operator must be one of {', '.join(CF_OPS)}")
        kind = "cell"
    elif t == "text":
        kind, x, y = "text", body.get("mode") or "contains", str(body.get("text", ""))
        if x not in ("contains", "notcontains", "begins", "ends"):
            raise ModelError("mode must be contains, notcontains, begins or ends")
    elif t == "date":
        kind, x = "date", body.get("period") or ""
        if x not in CF_DATES:
            raise ModelError(f"period must be one of {', '.join(CF_DATES)}")
    elif t == "duplicates":
        kind, x = "dup", "unique" if body.get("unique") else "dup"
    elif t == "top":
        kind, x, y, z = "top", "bottom" if body.get("bottom") else "top", str(body.get("n", 10)), "%" if body.get("percent") else ""
    elif t == "average":
        kind, x = "avg", "below" if body.get("below") else "above"
    elif t == "blanks":
        kind, x = "blank", body.get("mode") or "blank"
        if x not in ("blank", "noblank", "error", "noerror"):
            raise ModelError("mode must be blank, noblank, error or noerror")
    elif t == "formula":
        kind, x = "formula", str(body.get("formula") or "")
        if not x:
            raise ModelError("formula is required")
        if not x.startswith("="):
            x = "=" + x
    elif t == "colorScale":
        kind = "scale"
        pts = body.get("points") or ["low", "high"]
        cols = [hexc(c) for c in body.get("colors") or []]
        if len(pts) not in (2, 3) or len(cols) != len(pts):
            raise ModelError("a colour scale needs two or three points and the same number of colours")
        x, y = ",".join(pts), ",".join(cols)
    elif t == "dataBar":
        kind, x, y, z = "bar", hexc(body.get("color") or "638ec6"), body.get("min") or "low", body.get("max") or "high"
    elif t == "iconSet":
        kind, x = "icons", body.get("set") or "3arrows"
        y = ",".join(str(c) for c in body.get("cuts") or [])
        z = "rev" if body.get("reverse") else ""
    else:
        raise ModelError(f"type must be one of {', '.join(CF_TYPES)}")
    style = style_patch(body.get("style")) if isinstance(body.get("style"), dict) else str(body.get("style") or "")
    return f"{','.join(str(v) for v in area)}\t{stop}\t{kind}\t{esc(x)}\t{esc(y)}\t{esc(z)}\t{esc(style)}"


def cf_json(line: str) -> dict:
    p = line.split("\t")
    arg = lambda i: unesc(p[i]) if len(p) > i else ""
    out: dict = {"range": a1(ints(p[0])), "stopIfTrue": p[1] == "1"}
    k = p[2]
    if k == "cell":
        out.update(type="cell", operator=arg(3), value=arg(4), value2=arg(5))
    elif k == "text":
        out.update(type="text", mode=arg(3), text=arg(4))
    elif k == "date":
        out.update(type="date", period=arg(3))
    elif k == "dup":
        out.update(type="duplicates", unique=arg(3) == "unique")
    elif k == "top":
        out.update(type="top", bottom=arg(3) == "bottom", n=float(arg(4) or 10), percent=arg(5) == "%")
    elif k == "avg":
        out.update(type="average", below=arg(3) == "below")
    elif k == "blank":
        out.update(type="blanks", mode=arg(3))
    elif k == "formula":
        out.update(type="formula", formula=arg(3))
    elif k == "scale":
        out.update(type="colorScale", points=arg(3).split(","), colors=arg(4).split(","))
    elif k == "bar":
        out.update(type="dataBar", color=arg(3), min=arg(4), max=arg(5))
    elif k == "icons":
        out.update(type="iconSet", set=arg(3), cuts=[float(c) for c in arg(4).split(",") if c], reverse=arg(5) == "rev")
    out["style"] = style_dict(arg(6))
    return out


VALID_TYPES = ["any", "whole", "decimal", "list", "date", "time", "length", "custom", "checkbox"]
VALID_OPS = ["between", "notbetween", "eq", "ne", "gt", "lt", "ge", "le"]
ALERTS = ["stop", "warning", "info"]


def validation_line(body: dict) -> tuple[tuple[int, int, int, int], str]:
    area = area_of(body.get("range") or "")
    kind = body.get("type") or "any"
    if kind not in VALID_TYPES:
        raise ModelError(f"type must be one of {', '.join(VALID_TYPES)}")
    op = body.get("operator") or ("between" if kind in ("whole", "decimal", "date", "time", "length") else "")
    if op and op not in VALID_OPS:
        raise ModelError(f"operator must be one of {', '.join(VALID_OPS)}")
    a, b = body.get("value"), body.get("value2")
    if kind == "list" and isinstance(body.get("items"), list):
        a = ",".join(str(x) for x in body["items"])
    flags = ("b" if body.get("allowBlank", True) else "") + ("d" if body.get("dropdown", True) and kind == "list" else "") + ("p" if body.get("showPrompt") else "") + ("e" if body.get("showError", True) else "") + ("c" if body.get("chips") else "") + ("m" if body.get("multiple") else "")
    alert = body.get("alertStyle") or "stop"
    if alert not in ALERTS:
        raise ModelError(f"alertStyle must be one of {', '.join(ALERTS)}")
    fields = [kind, op if kind not in ("any", "list", "custom", "checkbox") else "", "" if a is None else str(a), "" if b is None else str(b), flags, alert, body.get("promptTitle") or "", body.get("promptText") or "", body.get("errorTitle") or "", body.get("errorText") or "", body.get("colors") or ""]
    return area, "\t".join(esc(f) for f in fields)


def validation_json(line: str) -> dict:
    p = [unesc(x) for x in line.split("\t")]
    g = lambda i: p[i] if len(p) > i else ""
    flags = g(5)
    return {
        "range": a1(ints(p[0])), "type": g(1), "operator": g(2), "value": g(3), "value2": g(4), "allowBlank": "b" in flags, "dropdown": "d" in flags, "showPrompt": "p" in flags,
        "showError": "e" in flags, "alertStyle": g(6), "promptTitle": g(7), "promptText": g(8), "errorTitle": g(9), "errorText": g(10), "chips": "c" in flags, "multiple": "m" in flags,
    }


CONDS = ["eq", "ne", "gt", "ge", "lt", "le", "begins", "notbegins", "ends", "notends", "contains", "notcontains"]


def filter_text(body: dict) -> str:
    area = area_of(body.get("range") or "")
    lines = [f"area\t{','.join(str(v) for v in area)}"]
    for c in body.get("columns") or []:
        col = c.get("column")
        if isinstance(col, str) and not col.isdigit():
            idx = ranges.col_index(col)
        else:
            idx = area[1] + int(col)
        if not area[1] <= idx <= area[3]:
            raise ModelError(f"column {col} is outside {a1(area)}")
        head = f"col\t{idx}"
        if "values" in c:
            lines.append("\t".join([head, "values", "1" if c.get("blanks") else "0"] + [esc(v) for v in c["values"]]))
        elif "conditions" in c:
            conds = c["conditions"][:2]
            if not conds:
                raise ModelError("conditions needs at least one entry")
            parts = [head, "cond", "or" if c.get("combine") == "or" else "and"]
            for cd in conds:
                if cd.get("operator") not in CONDS:
                    raise ModelError(f"operator must be one of {', '.join(CONDS)}")
                parts += [cd["operator"], esc(cd.get("value", ""))]
            lines.append("\t".join(parts))
        elif "top" in c:
            t = c["top"]
            lines.append("\t".join([head, "top", "bottom" if t.get("bottom") else "top", str(t.get("n", 10)), "%" if t.get("percent") else ""]))
        elif "average" in c:
            lines.append("\t".join([head, "avg", "below" if c["average"] == "below" else "above"]))
        elif "dynamic" in c:
            lines.append("\t".join([head, "dyn", str(c["dynamic"])]))
        else:
            raise ModelError("each filter column needs values, conditions, top, average or dynamic")
    return "\n".join(lines) + "\n"


def filter_json(text: str) -> dict | None:
    if not text.strip():
        return None
    out: dict = {"columns": [], "hiddenRows": []}
    for l in [x for x in text.split("\n") if x]:
        p = [unesc(x) for x in l.split("\t")]
        if p[0] == "area":
            out["range"] = a1(ints(p[1]))
        elif p[0] == "hidden":
            rows: list[int] = []
            for part in [x for x in p[1].split(",") if x]:
                lo, _, hi = part.partition("-")
                rows.extend(range(int(lo) + 1, int(hi or lo) + 2))
            out["hiddenRows"] = rows
        elif p[0] == "col":
            col = {"column": ranges.col_name(int(p[1]))}
            k = p[2]
            if k == "values":
                col.update(values=p[4:], blanks=p[3] == "1")
            elif k == "cond":
                conds = [{"operator": p[4], "value": p[5]}]
                if len(p) > 7:
                    conds.append({"operator": p[6], "value": p[7]})
                col.update(conditions=conds, combine="or" if p[3] == "or" else "and")
            elif k == "top":
                col["top"] = {"bottom": p[3] == "bottom", "n": float(p[4]), "percent": len(p) > 5 and p[5] == "%"}
            elif k == "avg":
                col["average"] = p[3]
            elif k == "dyn":
                col["dynamic"] = p[3]
            else:
                col["kind"] = k
            out["columns"].append(col)
    return out
