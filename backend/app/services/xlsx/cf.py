from collections import Counter

from formcel_engine import offset
from openpyxl.formatting.rule import ColorScale, DataBar, FormatObject, IconSet, Rule
from openpyxl.styles import Border, Font, PatternFill, Side
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.utils import get_column_letter

from .formulas import from_file, to_file
from .styles import EDGES, LINES_IN, colour_in, colour_out

OPS_IN = {"greaterThan": "gt", "lessThan": "lt", "greaterThanOrEqual": "ge", "lessThanOrEqual": "le", "equal": "eq", "notEqual": "ne", "between": "between", "notBetween": "notbetween"}
OPS_OUT = {v: k for k, v in OPS_IN.items()}
TEXT_IN = {"containsText": "contains", "notContainsText": "notcontains", "beginsWith": "begins", "endsWith": "ends"}
TEXT_OUT = {v: k for k, v in TEXT_IN.items()}
DATE_IN = {"today": "today", "yesterday": "yesterday", "tomorrow": "tomorrow", "last7Days": "last7", "thisWeek": "thisweek", "lastWeek": "lastweek",
           "nextWeek": "nextweek", "thisMonth": "thismonth", "lastMonth": "lastmonth", "nextMonth": "nextmonth"}
DATE_OUT = {v: k for k, v in DATE_IN.items()}
BLANK_IN = {"containsBlanks": "blank", "notContainsBlanks": "noblank", "containsErrors": "error", "notContainsErrors": "noerror"}
BLANK_OUT = {v: k for k, v in BLANK_IN.items()}
ICONS_IN = {"3Arrows": "3arrows", "3TrafficLights1": "3traffic", "3Flags": "3flags", "3Symbols": "3symbols", "3Symbols2": "3symbols", "4Arrows": "4arrows", "5Arrows": "5arrows"}
ICONS_OUT = {"3arrows": "3Arrows", "3traffic": "3TrafficLights1", "3flags": "3Flags", "3symbols": "3Symbols", "4arrows": "4Arrows", "5arrows": "5Arrows"}


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def dxf_tokens(dxf: DifferentialStyle | None) -> str:
    if dxf is None:
        return ""
    out: list[str] = []
    f = dxf.font
    if f is not None:
        if f.b:
            out.append("b")
        if f.i:
            out.append("i")
        if f.u and f.u != "none":
            out.append("u")
        if f.strike:
            out.append("s")
        fc = colour_in(f.color)
        if fc:
            out.append(f"fc:{fc}")
    fill = dxf.fill
    if fill is not None:
        bg = colour_in(fill.bgColor) or colour_in(fill.fgColor)
        if bg:
            out.append(f"bg:{bg}")
    b = dxf.border
    if b is not None:
        for tok, edge in EDGES:
            side = getattr(b, edge)
            if side is not None and side.style in LINES_IN:
                out.append(f"{tok}:{LINES_IN[side.style]}:{colour_in(side.color) or '000000'}")
    return ";".join(out)


def dxf_out(text: str) -> DifferentialStyle | None:
    font: dict = {}
    fill = None
    sides: dict = {}
    for tok in text.split(";"):
        k, _, v = tok.partition(":")
        if k in ("b", "i"):
            font[k] = True
        elif k == "u":
            font["u"] = "single"
        elif k == "s":
            font["strike"] = True
        elif k == "fc" and v:
            font["color"] = colour_out(v)
        elif k == "bg" and v:
            fill = PatternFill(bgColor=colour_out(v))
        elif k in ("bt", "br", "bb", "bl"):
            line, _, col = v.partition(":")
            sides[dict(EDGES)[k]] = Side(style=line if line in ("thin", "medium", "thick", "dashed", "dotted", "double") else "thin", color=colour_out(col or "000000"))
    if not (font or fill or sides):
        return None
    return DifferentialStyle(font=Font(**font) if font else None, fill=fill, border=Border(**sides) if sides else None)


def _operand_in(f: str) -> str:
    f = from_file(f)
    try:
        float(f)
        return f
    except ValueError:
        pass
    if len(f) >= 2 and f[0] == '"' and f[-1] == '"' and '"' not in f[1:-1].replace('""', ""):
        return f[1:-1].replace('""', '"')
    return "=" + f


def _operand_out(v: str) -> str:
    if v.startswith("="):
        return to_file(v[1:])
    try:
        float(v)
        return v
    except ValueError:
        return '"' + v.replace('"', '""') + '"'


def _point_in(o: FormatObject, notes: Counter) -> str:
    t, v = o.type, o.val
    if t == "min":
        return "low"
    if t == "max":
        return "high"
    try:
        n = float(v)
    except (TypeError, ValueError):
        notes["colour scale or data bar points from formulas read as lowest or highest"] += 1
        return "low" if t != "max" else "high"
    return {"num": f"num:{n:g}", "percent": f"pct:{n:g}", "percentile": f"pctl:{n:g}"}.get(t, "low")


def _point_out(p: str) -> FormatObject:
    k, _, v = p.partition(":")
    if k == "low":
        return FormatObject(type="min")
    if k == "high":
        return FormatObject(type="max")
    return FormatObject(type={"num": "num", "pct": "percent", "pctl": "percentile"}.get(k, "min"), val=v)


def _kind_in(r: Rule, top: str, notes: Counter) -> list[str] | None:
    t = r.type
    f = list(r.formula or [])
    if t == "cellIs" and r.operator in OPS_IN and f:
        return ["cell", OPS_IN[r.operator], _operand_in(f[0]), _operand_in(f[1]) if len(f) > 1 else ""]
    if t in TEXT_IN:
        return ["text", TEXT_IN[t], r.text or "", ""]
    if t == "timePeriod" and r.timePeriod in DATE_IN:
        return ["date", DATE_IN[r.timePeriod], "", ""]
    if t in ("duplicateValues", "uniqueValues"):
        return ["dup", "dup" if t == "duplicateValues" else "unique", "", ""]
    if t == "top10" and r.rank:
        return ["top", "bottom" if r.bottom else "top", str(int(r.rank)), "%" if r.percent else ""]
    if t == "aboveAverage":
        if r.stdDev or r.equalAverage:
            notes["above or below average rules with deviations or equal values read as plain above or below"] += 1
        return ["avg", "below" if r.aboveAverage is False else "above", "", ""]
    if t in BLANK_IN:
        return ["blank", BLANK_IN[t], "", ""]
    if t == "expression" and f:
        return ["formula", "=" + from_file(f[0]), "", ""]
    if t == "colorScale" and r.colorScale is not None:
        cs = r.colorScale
        pts = [_point_in(o, notes) for o in cs.cfvo]
        cols = [(colour_in(c) or "000000") for c in cs.color]
        if all(not c.startswith("t:") for c in cols) and len(pts) == len(cols) and 2 <= len(pts) <= 3:
            return ["scale", ",".join(pts), ",".join(cols), ""]
    if t == "dataBar" and r.dataBar is not None:
        db = r.dataBar
        col = colour_in(db.color) or "638ec6"
        if col.startswith("t:"):
            col = "638ec6"
        pts = [_point_in(o, notes) for o in db.cfvo] + ["low", "high"]
        return ["bar", col, pts[0], pts[1]]
    if t == "iconSet" and r.iconSet is not None and r.iconSet.iconSet in ICONS_IN:
        s = r.iconSet
        cuts = []
        for o in list(s.cfvo)[1:]:
            if o.type != "percent":
                notes["icon set cut-offs other than percent read as even percent steps"] += 1
                cuts = []
                break
            cuts.append(f"{float(o.val):g}")
        return ["icons", ICONS_IN[s.iconSet], ",".join(cuts), "rev" if s.reverse else ""]
    notes[f"conditional formatting rules of a kind FormCel does not have left out ({t})"] += 1
    return None


def rules_in(ws, notes: Counter) -> list[str]:
    found = []
    for cf in ws.conditional_formatting:
        ranges = list(cf.sqref.ranges)
        if not ranges:
            continue
        first = ranges[0]
        for r in cf.rules:
            kind = _kind_in(r, first.coord, notes)
            if kind is None:
                continue
            style = dxf_tokens(r.dxf)
            for rg in ranges:
                k = list(kind)
                if k[0] == "formula" and rg is not first:
                    k[1] = offset(k[1], rg.min_row - first.min_row, rg.min_col - first.min_col)
                if k[0] == "cell":
                    for i in (2, 3):
                        if k[i].startswith("="):
                            k[i] = offset(k[i], rg.min_row - first.min_row, rg.min_col - first.min_col)
                line = f"{rg.min_row - 1},{rg.min_col - 1},{rg.max_row - 1},{rg.max_col - 1}\t{1 if r.stopIfTrue else 0}\t" + "\t".join(esc(x) for x in k + [style])
                found.append((r.priority or 0, line))
    found.sort(key=lambda x: x[0])
    return [line for _, line in found]


def _unesc(s: str) -> str:
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            out.append({"t": "\t", "n": "\n", "r": "\r"}.get(s[i + 1], s[i + 1]))
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def _text_formula(mode: str, text: str, ref: str) -> str:
    q = '"' + text.replace('"', '""') + '"'
    return {"contains": f"NOT(ISERROR(SEARCH({q},{ref})))", "notcontains": f"ISERROR(SEARCH({q},{ref}))",
            "begins": f"LEFT({ref},LEN({q}))={q}", "ends": f"RIGHT({ref},LEN({q}))={q}"}[mode]


def _date_formula(d: str, ref: str) -> str:
    day = f"FLOOR({ref},1)"
    low = f"ROUNDDOWN({ref},0)"
    return {
        "today": f"{day}=TODAY()", "yesterday": f"{day}=TODAY()-1", "tomorrow": f"{day}=TODAY()+1",
        "last7": f"AND(TODAY()-{day}<=6,{day}<=TODAY())",
        "thismonth": f"AND(MONTH({ref})=MONTH(TODAY()),YEAR({ref})=YEAR(TODAY()))",
        "lastmonth": f"AND(MONTH({ref})=MONTH(EDATE(TODAY(),0-1)),YEAR({ref})=YEAR(EDATE(TODAY(),0-1)))",
        "nextmonth": f"AND(MONTH({ref})=MONTH(EDATE(TODAY(),0+1)),YEAR({ref})=YEAR(EDATE(TODAY(),0+1)))",
        "thisweek": f"AND(TODAY()-{low}<=WEEKDAY(TODAY())-1,{low}-TODAY()<=7-WEEKDAY(TODAY()))",
        "lastweek": f"AND(TODAY()-{low}>=(WEEKDAY(TODAY())),TODAY()-{low}<(WEEKDAY(TODAY())+7))",
        "nextweek": f"AND({low}-TODAY()>(7-WEEKDAY(TODAY())),{low}-TODAY()<(15-WEEKDAY(TODAY())))",
    }[d]


def _blank_formula(b: str, ref: str) -> str:
    return {"blank": f"LEN(TRIM({ref}))=0", "noblank": f"LEN(TRIM({ref}))>0", "error": f"ISERROR({ref})", "noerror": f"NOT(ISERROR({ref}))"}[b]


def rules_out(ws, lines: list[str]) -> None:
    for line in lines:
        p = [_unesc(x) for x in line.split("\t")]
        if len(p) < 7:
            p += [""] * (7 - len(p))
        r0, c0, r1, c1 = (int(x) for x in p[0].split(","))
        rng = f"{get_column_letter(c0 + 1)}{r0 + 1}:{get_column_letter(c1 + 1)}{r1 + 1}"
        ref = f"{get_column_letter(c0 + 1)}{r0 + 1}"
        stop = p[1] == "1" or None
        kind, x, y, z, style = p[2], p[3], p[4], p[5], p[6]
        dxf = dxf_out(style)
        rule = None
        if kind == "cell" and x in OPS_OUT:
            f = [_operand_out(y)] + ([_operand_out(z)] if x in ("between", "notbetween") else [])
            rule = Rule(type="cellIs", operator=OPS_OUT[x], formula=f, dxf=dxf, stopIfTrue=stop)
        elif kind == "text" and x in TEXT_OUT:
            rule = Rule(type=TEXT_OUT[x], operator="notContains" if x == "notcontains" else TEXT_OUT[x], text=y, formula=[_text_formula(x, y, ref)], dxf=dxf, stopIfTrue=stop)
        elif kind == "date" and x in DATE_OUT:
            rule = Rule(type="timePeriod", timePeriod=DATE_OUT[x], formula=[_date_formula(x, ref)], dxf=dxf, stopIfTrue=stop)
        elif kind == "dup":
            rule = Rule(type="duplicateValues" if x != "unique" else "uniqueValues", dxf=dxf, stopIfTrue=stop)
        elif kind == "top":
            rule = Rule(type="top10", rank=int(float(y or 10)), percent=(z == "%") or None, bottom=(x == "bottom") or None, dxf=dxf, stopIfTrue=stop)
        elif kind == "avg":
            rule = Rule(type="aboveAverage", aboveAverage=False if x == "below" else None, dxf=dxf, stopIfTrue=stop)
        elif kind == "blank" and x in BLANK_OUT:
            rule = Rule(type=BLANK_OUT[x], formula=[_blank_formula(x, ref)], dxf=dxf, stopIfTrue=stop)
        elif kind == "formula":
            rule = Rule(type="expression", formula=[to_file(x.lstrip("="))], dxf=dxf, stopIfTrue=stop)
        elif kind == "scale":
            pts, cols = x.split(","), y.split(",")
            rule = Rule(type="colorScale", colorScale=ColorScale(cfvo=[_point_out(q) for q in pts], color=[colour_out(c) for c in cols]))
        elif kind == "bar":
            rule = Rule(type="dataBar", dataBar=DataBar(cfvo=[_point_out(y or "low"), _point_out(z or "high")], color=colour_out(x)))
        elif kind == "icons" and x in ICONS_OUT:
            n = int(x[0])
            cuts = [c for c in y.split(",") if c] or [f"{100 * i // n}" for i in range(1, n)]
            rule = Rule(type="iconSet", iconSet=IconSet(iconSet=ICONS_OUT[x], cfvo=[FormatObject(type="percent", val=0)] + [FormatObject(type="percent", val=c) for c in cuts], reverse=(z == "rev") or None))
        if rule is not None:
            ws.conditional_formatting.add(rng, rule)
