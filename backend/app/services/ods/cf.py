import re
from collections import Counter
from xml.sax.saxutils import quoteattr

from formcel_engine import offset
from openpyxl.utils import get_column_letter as L

from ..xlsx.cf import _unesc, esc
from .formulas import from_file, to_file

OPS_IN = {"!=": "ne", ">=": "ge", "<=": "le", "=": "eq", ">": "gt", "<": "lt"}
OPS_OUT = {v: k for k, v in OPS_IN.items()}
TEXT_IN = {"contains-text": "contains", "not-contains-text": "notcontains", "begins-with": "begins", "ends-with": "ends"}
TEXT_OUT = {v: k for k, v in TEXT_IN.items()}
DATE_IN = {"today": "today", "yesterday": "yesterday", "tomorrow": "tomorrow", "last-7-days": "last7", "this-week": "thisweek", "last-week": "lastweek",
           "next-week": "nextweek", "this-month": "thismonth", "last-month": "lastmonth", "next-month": "nextmonth"}
DATE_OUT = {v: k for k, v in DATE_IN.items()}
ICONS_IN = {"3Arrows": "3arrows", "3TrafficLights1": "3traffic", "3Flags": "3flags", "3Symbols": "3symbols", "3Symbols2": "3symbols", "4Arrows": "4arrows", "5Arrows": "5arrows"}
ICONS_OUT = {"3arrows": "3Arrows", "3traffic": "3TrafficLights1", "3flags": "3Flags", "3symbols": "3Symbols", "4arrows": "4Arrows", "5arrows": "5Arrows"}
BLANK_OUT = {"blank": "LEN(TRIM({r}))=0", "noblank": "LEN(TRIM({r}))>0"}
CALCEXT = "urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"
C = f"{{{CALCEXT}}}"


def _cell(addr: str) -> tuple[int, int] | None:
    m = re.fullmatch(r"\$?([A-Z]{1,3})\$?(\d+)", addr)
    if not m:
        return None
    col = 0
    for ch in m.group(1):
        col = col * 26 + ord(ch) - 64
    return int(m.group(2)) - 1, col - 1


def _range(addr: str) -> tuple[int, int, int, int] | None:
    parts = [p.rpartition(".")[2] for p in addr.split(":")]
    a = _cell(parts[0])
    b = _cell(parts[-1]) if len(parts) > 1 else a
    return (a[0], a[1], b[0], b[1]) if a and b else None


def _split(s: str) -> list[str]:
    out, depth, cur, q = [], 0, "", False
    for ch in s:
        if ch == '"':
            q = not q
        if not q and ch in "([{":
            depth += 1
        elif not q and ch in ")]}":
            depth -= 1
        if ch in ",;" and depth == 0 and not q:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def _operand(s: str) -> str:
    s = s.strip()
    if re.fullmatch(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", s):
        return s
    if len(s) >= 2 and s[0] == s[-1] == '"':
        return s[1:-1].replace('""', '"')
    return from_file(s)


def _point_in(t: str, v: str) -> str:
    return {"minimum": "low", "maximum": "high", "number": f"num:{v}", "percent": f"pct:{v}", "percentile": f"pctl:{v}"}.get(t, "low")


def _kind(cond: str, notes: Counter) -> list[str] | None:
    m = re.fullmatch(r"(not-)?between\((.*)\)", cond, re.S)
    if m:
        a = _split(m.group(2))
        return ["cell", "notbetween" if m.group(1) else "between", _operand(a[0]), _operand(a[1]) if len(a) > 1 else ""]
    for op in ("!=", ">=", "<=", "=", ">", "<"):
        if cond.startswith(op):
            return ["cell", OPS_IN[op], _operand(cond[len(op):]), ""]
    m = re.fullmatch(r"([a-z-]+)\((.*)\)", cond, re.S)
    if m and m.group(1) in TEXT_IN:
        return ["text", TEXT_IN[m.group(1)], _operand(m.group(2)), ""]
    if m and m.group(1) in ("top-elements", "bottom-elements", "top-percent", "bottom-percent"):
        return ["top", "bottom" if m.group(1).startswith("bottom") else "top", m.group(2).strip(), "%" if m.group(1).endswith("percent") else ""]
    if m and m.group(1) == "formula-is":
        return ["formula", from_file(m.group(2)), "", ""]
    simple = {"duplicate": ["dup", "dup"], "unique": ["dup", "unique"], "above-average": ["avg", "above"], "below-average": ["avg", "below"],
              "is-error": ["blank", "error"], "is-no-error": ["blank", "noerror"]}
    if cond in simple:
        return simple[cond] + ["", ""]
    notes[f"conditional formatting conditions FormCel does not have left out ({cond.split('(')[0]})"] += 1
    return None


def rules_in(table, styles: dict[str, str], notes: Counter) -> list[str]:
    lines = []
    for cf in table.iter(f"{C}conditional-format"):
        rng = _range(cf.get(f"{C}target-range-address") or "")
        if not rng:
            continue
        r0, c0, r1, c1 = rng
        head = f"{r0},{c0},{r1},{c1}\t0\t"
        for el in cf:
            tag = el.tag.replace(C, "")
            if tag == "condition":
                k = _kind(el.get(f"{C}value") or "", notes)
                if k is None:
                    continue
                base = _cell((el.get(f"{C}base-cell-address") or "").rpartition(".")[2])
                if base and k[0] in ("formula", "cell") and base != (r0, c0):
                    for i in (1, 2, 3):
                        if k[i].startswith("="):
                            k[i] = offset(k[i], r0 - base[0], c0 - base[1])
                style = styles.get(el.get(f"{C}apply-style-name") or "", "")
                lines.append(head + "\t".join(esc(x) for x in k + [style]))
            elif tag == "date-is":
                d = DATE_IN.get(el.get(f"{C}date") or "")
                if d:
                    lines.append(head + "\t".join(["date", d, "", "", esc(styles.get(el.get(f"{C}style") or "", ""))]))
            elif tag == "color-scale":
                ents = list(el)
                pts = [_point_in(e.get(f"{C}type") or "", e.get(f"{C}value") or "0") for e in ents]
                cols = [(e.get(f"{C}color") or "#000000").lstrip("#").lower() for e in ents]
                if 2 <= len(pts) <= 3:
                    lines.append(head + "\t".join(["scale", ",".join(pts), ",".join(cols), "", ""]))
            elif tag == "data-bar":
                ents = list(el)
                pts = [_point_in(e.get(f"{C}type") or "", e.get(f"{C}value") or "0") for e in ents] + ["low", "high"]
                col = (el.get(f"{C}positive-color") or "#638ec6").lstrip("#").lower()
                lines.append(head + "\t".join(["bar", col, pts[0], pts[1], ""]))
            elif tag == "icon-set":
                s = ICONS_IN.get(el.get(f"{C}icon-set-type") or "")
                if not s:
                    notes["icon sets FormCel does not draw left out"] += 1
                    continue
                ents = list(el)[1:]
                cuts = ",".join(e.get(f"{C}value") or "0" for e in ents) if all(e.get(f"{C}type") == "percent" for e in ents) else ""
                lines.append(head + "\t".join(["icons", s, cuts, "", ""]))
    return lines


def rules_out(lines: list[str], sheet: str, style_name) -> str:
    q = f"'{sheet}'" if re.search(r"[^A-Za-z0-9_]", sheet) else sheet
    blocks = []
    for line in lines:
        p = [_unesc(x) for x in line.split("\t")]
        p += [""] * (7 - len(p))
        r0, c0, r1, c1 = (int(x) for x in p[0].split(","))
        a, b = f"{L(c0 + 1)}{r0 + 1}", f"{L(c1 + 1)}{r1 + 1}"
        target = f"{q}.{a}:{q}.{b}"
        kind, x, y, z, style = p[2], p[3], p[4], p[5], p[6]

        def val(v: str) -> str:
            if v.startswith("="):
                return to_file(v)[4:]
            if re.fullmatch(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", v):
                return v
            return '"' + v.replace('"', '""') + '"'

        cond = None
        if kind == "cell" and x in OPS_OUT:
            cond = OPS_OUT[x] + val(y)
        elif kind == "cell" and x in ("between", "notbetween"):
            cond = f"{'not-' if x == 'notbetween' else ''}between({val(y)},{val(z)})"
        elif kind == "text" and x in TEXT_OUT:
            cond = f"{TEXT_OUT[x]}({val(y)})"
        elif kind == "dup":
            cond = "unique" if x == "unique" else "duplicate"
        elif kind == "top":
            cond = f"{'bottom' if x == 'bottom' else 'top'}-{'percent' if z == '%' else 'elements'}({y or 10})"
        elif kind == "avg":
            cond = "below-average" if x == "below" else "above-average"
        elif kind == "blank" and x in ("error", "noerror"):
            cond = "is-error" if x == "error" else "is-no-error"
        elif kind == "blank" and x in BLANK_OUT:
            cond = "formula-is(" + to_file("=" + BLANK_OUT[x].format(r=a))[4:] + ")"
        elif kind == "formula":
            cond = f"formula-is({to_file(x)[4:]})"
        if cond is not None:
            blocks.append(f'<calcext:conditional-format calcext:target-range-address={quoteattr(target)}><calcext:condition calcext:apply-style-name={quoteattr(style_name(style))} calcext:value={quoteattr(cond)} calcext:base-cell-address={quoteattr(f"{q}.{a}")}/></calcext:conditional-format>')
        elif kind == "date" and x in DATE_OUT:
            blocks.append(f'<calcext:conditional-format calcext:target-range-address={quoteattr(target)}><calcext:date-is calcext:style={quoteattr(style_name(style))} calcext:date="{DATE_OUT[x]}"/></calcext:conditional-format>')
        elif kind == "scale":
            ents = []
            for pt, col in zip(x.split(","), y.split(",")):
                k, _, v = pt.partition(":")
                t = {"low": "minimum", "high": "maximum", "num": "number", "pct": "percent", "pctl": "percentile"}.get(k, "minimum")
                ents.append(f'<calcext:color-scale-entry calcext:value="{v or 0}" calcext:type="{t}" calcext:color="#{col}"/>')
            blocks.append(f'<calcext:conditional-format calcext:target-range-address={quoteattr(target)}><calcext:color-scale>{"".join(ents)}</calcext:color-scale></calcext:conditional-format>')
        elif kind == "bar":
            ents = []
            for pt in (y or "low", z or "high"):
                k, _, v = pt.partition(":")
                t = {"low": "minimum", "high": "maximum", "num": "number", "pct": "percent", "pctl": "percentile"}.get(k, "minimum")
                ents.append(f'<calcext:formatting-entry calcext:value="{v or 0}" calcext:type="{t}"/>')
            blocks.append(f'<calcext:conditional-format calcext:target-range-address={quoteattr(target)}><calcext:data-bar calcext:positive-color="#{x}" calcext:negative-color="#ff0000" calcext:axis-position="automatic" calcext:axis-color="#000000">{"".join(ents)}</calcext:data-bar></calcext:conditional-format>')
        elif kind == "icons" and x in ICONS_OUT:
            n = int(x[0])
            cuts = [c for c in y.split(",") if c] or [str(100 * i // n) for i in range(1, n)]
            ents = "".join(f'<calcext:formatting-entry calcext:value="{c}" calcext:type="percent"/>' for c in ["0"] + cuts)
            blocks.append(f'<calcext:conditional-format calcext:target-range-address={quoteattr(target)}><calcext:icon-set calcext:icon-set-type="{ICONS_OUT[x]}">{ents}</calcext:icon-set></calcext:conditional-format>')
    return f"<calcext:conditional-formats>{''.join(blocks)}</calcext:conditional-formats>" if blocks else ""
