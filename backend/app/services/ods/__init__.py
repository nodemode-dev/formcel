import datetime as dt
import io
import re
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape, quoteattr

from formcel_engine import reads_as_text
from openpyxl.utils import get_column_letter

from ..xlsx.autofilter import filtered_rows
from . import cf, numfmt
from .formulas import from_file, range_in, to_file

NS = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "style": "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
    "fo": "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
    "xlink": "http://www.w3.org/1999/xlink",
    "number": numfmt.NUMBER,
}
O, T, X, S, F, L = (f"{{{NS[k]}}}" for k in ("office", "table", "text", "style", "fo", "xlink"))
EPOCH = dt.datetime(1899, 12, 30)
MAX_REPEAT = 1000
UNITS = {"in": 96.0, "cm": 96 / 2.54, "mm": 96 / 25.4, "pt": 96 / 72, "pc": 16.0, "px": 1.0}
LINES = {"solid": "thin", "dashed": "dashed", "dotted": "dotted", "double": "double"}


def _px(v: str | None) -> float | None:
    m = re.fullmatch(r"\s*([\d.]+)\s*([a-z]+)\s*", v or "")
    return float(m.group(1)) * UNITS[m.group(2)] if m and m.group(2) in UNITS else None


def _colour(v: str | None) -> str | None:
    return v[1:].lower() if v and re.fullmatch(r"#[0-9a-fA-F]{6}", v) else None


def _border(v: str | None) -> str | None:
    if not v or v == "none":
        return None
    parts = v.split()
    w = _px(parts[0]) or 1.0
    kind = next((LINES[p] for p in parts if p in LINES), "thin")
    if kind == "thin" and w >= 2.5:
        kind = "thick" if w >= 3.5 else "medium"
    col = next((_colour(p) for p in parts if _colour(p)), "000000")
    return f"{kind}:{col}"


def _cell_style(st, data_codes: dict[str, str]) -> tuple[str, str | None]:
    toks: list[str] = []
    tp = st.find(f"{S}text-properties")
    if tp is not None:
        if tp.get(f"{F}font-weight") == "bold":
            toks.append("b")
        if tp.get(f"{F}font-style") == "italic":
            toks.append("i")
        if tp.get(f"{S}text-underline-style") not in (None, "none"):
            toks.append("u")
        if tp.get(f"{S}text-line-through-style") not in (None, "none"):
            toks.append("s")
        sz = tp.get(f"{F}font-size")
        if sz and sz.endswith("pt") and float(sz[:-2]) != 10:
            toks.append(f"sz:{float(sz[:-2]):g}")
        fn = tp.get(f"{S}font-name")
        if fn and fn not in ("Liberation Sans", "Arial"):
            toks.append(f"ff:{fn}")
        fc = _colour(tp.get(f"{F}color"))
        if fc and fc != "000000":
            toks.append(f"fc:{fc}")
    cp = st.find(f"{S}table-cell-properties")
    if cp is not None:
        bg = _colour(cp.get(f"{F}background-color"))
        if bg:
            toks.append(f"bg:{bg}")
        allb = _border(cp.get(f"{F}border"))
        for tok, side in (("bt", "top"), ("br", "right"), ("bb", "bottom"), ("bl", "left")):
            b = _border(cp.get(f"{F}border-{side}")) or allb
            if b:
                toks.append(f"{tok}:{b}")
        va = {"top": "top", "middle": "middle"}.get(cp.get(f"{S}vertical-align") or "")
        if va:
            toks.append(f"va:{va}")
        if cp.get(f"{F}wrap-option") == "wrap":
            toks.append("wrap")
        rot = cp.get(f"{S}rotation-angle")
        if rot and rot.replace(".", "").isdigit() and float(rot):
            a = int(float(rot)) % 360
            toks.append(f"rot:{a if a <= 90 else a - 360}" if a <= 90 or a >= 270 else "rot:90")
    pp = st.find(f"{S}paragraph-properties")
    if pp is not None:
        ha = {"start": "left", "left": "left", "center": "center", "end": "right", "right": "right"}.get(pp.get(f"{F}text-align") or "")
        if ha:
            toks.append(f"ha:{ha}")
        ind = _px(pp.get(f"{F}margin-left"))
        if ind and ind >= 8:
            toks.append(f"in:{round(ind / 9)}")
    return ";".join(toks), data_codes.get(st.get(f"{S}data-style-name") or "")


def _text(p) -> tuple[str, str | None]:
    out: list[str] = []
    link = None

    def walk(el):
        nonlocal link
        if el.text:
            out.append(el.text)
        for ch in el:
            if ch.tag == f"{X}s":
                out.append(" " * int(ch.get(f"{X}c", "1")))
            elif ch.tag == f"{X}tab":
                out.append("\t")
            elif ch.tag == f"{X}line-break":
                out.append("\n")
            else:
                if ch.tag == f"{X}a" and link is None:
                    link = ch.get(f"{L}href")
                walk(ch)
            if ch.tail:
                out.append(ch.tail)

    walk(p)
    return "".join(out), link


def _rows(el):
    for ch in el:
        if ch.tag == f"{T}table-row":
            yield ch
        elif ch.tag in (f"{T}table-header-rows", f"{T}table-rows", f"{T}table-row-group"):
            yield from _rows(ch)


def _cols(el):
    for ch in el:
        if ch.tag == f"{T}table-column":
            yield ch
        elif ch.tag in (f"{T}table-header-columns", f"{T}table-columns", f"{T}table-column-group"):
            yield from _cols(ch)


def _serial(v: str) -> float:
    d = dt.datetime.fromisoformat(v[:26])
    return (d - EPOCH).total_seconds() / 86400


def _duration(v: str) -> float:
    m = re.fullmatch(r"-?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?", v)
    if not m:
        return 0.0
    d, h, mi, s = (float(x or 0) for x in m.groups())
    return d + h / 24 + mi / 1440 + s / 86400


def _num(n: float) -> str:
    return str(int(n)) if float(n).is_integer() and abs(n) < 2**53 else repr(float(n))


def read(data: bytes) -> dict:
    z = zipfile.ZipFile(io.BytesIO(data))
    root = ET.fromstring(z.read("content.xml"))
    styles_root = ET.fromstring(z.read("styles.xml")) if "styles.xml" in z.namelist() else None
    notes: Counter = Counter()
    data_codes: dict[str, str] = {}
    for r in (styles_root, root):
        if r is None:
            continue
        for el in r.iter():
            if el.tag.startswith(numfmt.N) and el.tag.endswith("-style") and el.get(f"{S}name"):
                code = numfmt.from_style(el)
                if code:
                    data_codes[el.get(f"{S}name")] = code
    cell_styles: dict[str, tuple[str, str | None]] = {}
    col_px: dict[str, float] = {}
    row_px: dict[str, float] = {}
    for st in root.iter(f"{S}style"):
        name, fam = st.get(f"{S}name"), st.get(f"{S}family")
        if fam == "table-cell":
            cell_styles[name] = _cell_style(st, data_codes)
        elif fam == "table-column":
            p = st.find(f"{S}table-column-properties")
            w = _px(p.get(f"{S}column-width")) if p is not None else None
            if w:
                col_px[name] = w
        elif fam == "table-row":
            p = st.find(f"{S}table-row-properties")
            if p is not None and p.get(f"{S}use-optimal-row-height") == "false":
                h = _px(p.get(f"{S}row-height"))
                if h:
                    row_px[name] = h
    sheets = []
    cf_styles: dict[str, str] = {}
    if styles_root is not None:
        for st in styles_root.iter(f"{S}style"):
            if st.get(f"{S}family") == "table-cell":
                toks = _cell_style(st, data_codes)[0]
                for key in (st.get(f"{S}name"), st.get(f"{S}display-name")):
                    if key:
                        cf_styles[key] = toks
    for tb in root.iter(f"{T}table"):
        cells, formats, styles, merges, links = [], [], [], [], []
        sizes, hidden_cols = [], []
        c = 0
        for col in _cols(tb):
            n = int(col.get(f"{T}number-columns-repeated", "1"))
            w = col_px.get(col.get(f"{T}style-name") or "")
            for i in range(min(n, 16384 - c)):
                if w and abs(w - 96 * 0.889) > 0.5:
                    sizes.append((c + i, round(w)))
                if col.get(f"{T}visibility") == "collapse":
                    hidden_cols.append(c + i)
            c += n
        rsizes, hidden_rows = [], []
        r = 0
        for row in _rows(tb):
            rep = int(row.get(f"{T}number-rows-repeated", "1"))
            filled = any(ch.get(f"{O}value-type") or ch.get(f"{T}formula") or len(ch) for ch in row)
            copies = min(rep, MAX_REPEAT) if filled else 0
            h = row_px.get(row.get(f"{T}style-name") or "")
            for k in range(min(rep, MAX_REPEAT)):
                if h:
                    rsizes.append((r + k, round(h)))
                if row.get(f"{T}visibility") == "collapse":
                    hidden_rows.append(r + k)
            if rep > MAX_REPEAT and filled:
                notes["repeated rows beyond 1,000 left out"] += rep - MAX_REPEAT
            for k in range(copies):
                cc = 0
                for cell in row:
                    if cell.tag not in (f"{T}table-cell", f"{T}covered-table-cell"):
                        continue
                    crep = int(cell.get(f"{T}number-columns-repeated", "1"))
                    has = cell.get(f"{O}value-type") or cell.get(f"{T}formula") or len(cell) or cell.get(f"{T}style-name")
                    for j in range(min(crep, MAX_REPEAT) if has else 0):
                        rr, ccol = r + k, cc + j
                        if cell.tag == f"{T}table-cell":
                            raw, code, link = _cell(cell, notes)
                            st = cell_styles.get(cell.get(f"{T}style-name") or "")
                            if st:
                                if st[0]:
                                    styles.append((rr, ccol, st[0]))
                                code = st[1] or code
                            if raw is not None:
                                cells.append((rr, ccol, raw))
                            if code and code != "General":
                                formats.append((rr, ccol, code))
                            if link:
                                links.append((rr, ccol, link))
                            cs, rs = int(cell.get(f"{T}number-columns-spanned", "1")), int(cell.get(f"{T}number-rows-spanned", "1"))
                            if (cs > 1 or rs > 1) and k == 0:
                                merges.append((rr, ccol, rr + rs - 1, ccol + cs - 1))
                    cc += crep
            r += rep
            if r >= 1048576:
                break
        view = {"cols": {"sizes": sizes, "hidden": hidden_cols}, "rows": {"sizes": rsizes, "hidden": hidden_rows}}
        sheets.append({"name": (tb.get(f"{T}name") or f"Sheet{len(sheets) + 1}")[:31], "cells": cells, "formats": formats, "styles": styles,
                       "merges": merges, "links": links, "rules": cf.rules_in(tb, cf_styles, notes), "view": view})
    names = []
    for nr in root.iter(f"{T}named-range"):
        names.append((nr.get(f"{T}name"), range_in(nr.get(f"{T}cell-range-address") or "")))
    for ne in root.iter(f"{T}named-expression"):
        names.append((ne.get(f"{T}name"), from_file(ne.get(f"{T}expression") or "")))
    if any(True for _ in root.iter(f"{O}annotation")):
        notes["comments left out"] += sum(1 for _ in root.iter(f"{O}annotation"))
    filters = sum(1 for _ in root.iter(f"{T}filter"))
    if filters:
        notes["filters left out"] += filters
    return {"sheets": sheets, "names": names, "theme": None, "cellStyles": [], "vba": None, "notes": [f"{n} {what}" for what, n in sorted(notes.items())]}


def _cell(cell, notes: Counter) -> tuple[str | None, str | None, str | None]:
    vt = cell.get(f"{O}value-type")
    f = cell.get(f"{T}formula")
    texts = [_text(p) for p in cell.findall(f"{X}p")]
    link = next((lk for _, lk in texts if lk), None)
    if f:
        if not f.startswith("of:") and ":=" in f[:8]:
            notes["formulas in a dialect other than OpenFormula read as written"] += 1
        return from_file(f), None, link
    if vt in ("float", "percentage", "currency"):
        n = float(cell.get(f"{O}value", "0"))
        code = None
        if vt == "percentage":
            code = "0%" if round(n * 100, 9).is_integer() else "0.00%"
        elif vt == "currency":
            code = "$#,##0.00" if cell.get(f"{O}currency") in (None, "USD") else "#,##0.00"
        return _num(n), code, link
    if vt == "date":
        v = cell.get(f"{O}date-value", "")
        n = _serial(v)
        return _num(n), ("m/d/yyyy h:mm" if "T" in v and not v.endswith("T00:00:00") else "m/d/yyyy"), link
    if vt == "time":
        return repr(_duration(cell.get(f"{O}time-value", ""))), "h:mm:ss", link
    if vt == "boolean":
        return ("TRUE" if cell.get(f"{O}boolean-value") == "true" else "FALSE"), None, link
    if vt == "string" or texts:
        s = cell.get(f"{O}string-value") or "\n".join(t for t, _ in texts)
        if not s:
            return None, None, link
        if cell.get(f"{{{CALCEXT}}}value-type") == "error":
            return s, None, link
        return (s if reads_as_text(s) else "'" + s), None, link
    return None, None, None


MANIFEST = """<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
 <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
"""
CALCEXT = "urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"
ROOT_NS = " ".join(f'xmlns:{k}="{v}"' for k, v in NS.items()) + f' xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" xmlns:calcext="{CALCEXT}"'
STYLES = f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles {ROOT_NS} office:version="1.3"><office:styles><style:default-style style:family="table-cell"><style:text-properties style:font-name="{{font}}" fo:font-size="10pt"/></style:default-style><style:style style:name="Default" style:family="table-cell"/>{{named}}</office:styles></office:document-styles>
"""
META = f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta {ROOT_NS} xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"><office:meta><meta:generator>FormCel</meta:generator></office:meta></office:document-meta>
"""
LINES_OUT = {"thin": "0.75pt solid", "medium": "1.75pt solid", "thick": "2.5pt solid", "dashed": "0.75pt dashed", "dotted": "0.75pt dotted", "double": "2.25pt double"}


def _style_props(tokens: str, look) -> str:
    text, cell, para = [], [], []
    for tok in tokens.split(";"):
        k, _, v = tok.partition(":")
        if k == "b":
            text.append('fo:font-weight="bold"')
        elif k == "i":
            text.append('fo:font-style="italic"')
        elif k == "u":
            text.append('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"')
        elif k == "s":
            text.append('style:text-line-through-style="solid"')
        elif k == "sz" and v:
            text.append(f'fo:font-size="{v}pt"')
        elif k == "ff" and v:
            text.append(f"style:font-name={quoteattr(look(v, font=True))}")
        elif k == "fc" and v:
            text.append(f'fo:color="#{look(v)}"')
        elif k == "bg" and v:
            cell.append(f'fo:background-color="#{look(v)}"')
        elif k in ("bt", "br", "bb", "bl"):
            line, _, col = v.partition(":")
            side = {"bt": "top", "br": "right", "bb": "bottom", "bl": "left"}[k]
            cell.append(f'fo:border-{side}="{LINES_OUT.get(line, "0.75pt solid")} #{look(col or "000000")}"')
        elif k == "ha" and v:
            para.append(f'fo:text-align="{ {"left": "start", "center": "center", "right": "end"}[v] }"')
            cell.append('style:text-align-source="fix"')
        elif k == "va" and v:
            cell.append(f'style:vertical-align="{v}"')
        elif k == "wrap":
            cell.append('fo:wrap-option="wrap"')
        elif k == "in" and v.isdigit():
            para.append(f'fo:margin-left="{int(v) * 9 * 0.75}pt"')
        elif k == "rot" and v and v != "v":
            cell.append(f'style:rotation-angle="{int(v) % 360}"')
    out = ""
    if cell:
        out += f"<style:table-cell-properties {' '.join(dict.fromkeys(cell))}/>"
    if para:
        out += f"<style:paragraph-properties {' '.join(para)}/>"
    if text:
        out += f"<style:text-properties {' '.join(text)}/>"
    return out


def write(eng, views: list[dict]) -> tuple[bytes, list[str]]:
    notes: Counter = Counter()
    theme = eng.theme().split(";")
    slots = dict(zip(["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"], (theme[1] if len(theme) > 1 else "").split(",")))
    heading = theme[2] if len(theme) > 2 and theme[2] else "Inter"
    body_font = theme[3] if len(theme) > 3 and theme[3] else "Inter"

    def look(v: str, font: bool = False) -> str:
        if font:
            return heading if v == "+heading" else body_font if v == "+body" else v
        if v.startswith("t:"):
            p = v.split(":")
            base = slots.get(p[1], "000000")
            t = int(p[2]) if len(p) > 2 and p[2].lstrip("-").isdigit() else 0
            n = int(base, 16)
            ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
            ch = [round(x + (255 - x) * t / 100) if t >= 0 else round(x * (1 + t / 100)) for x in ch]
            return "".join(f"{x:02x}" for x in ch)
        return v[-6:]

    data_styles: dict[str, tuple[str, str]] = {}
    cell_styles: dict[tuple[str, str], str] = {}
    auto: list[str] = []
    fonts = {body_font, heading}

    def data_style(code: str) -> tuple[str, str]:
        if code not in data_styles:
            name = f"N{len(data_styles) + 1}"
            kind, xml, exact = numfmt.to_style(name, code)
            if not exact:
                notes["number formats written in a simpler form"] += 1
            auto.append(xml)
            data_styles[code] = (name, kind)
        return data_styles[code]

    def cell_style(tokens: str, code: str) -> str:
        key = (tokens, code)
        if key not in cell_styles:
            name = f"ce{len(cell_styles) + 1}"
            ds = f' style:data-style-name="{data_style(code)[0]}"' if code else ""
            for tok in tokens.split(";"):
                if tok.startswith("ff:"):
                    fonts.add(look(tok[3:], font=True))
            auto.append(f'<style:style style:name="{name}" style:family="table-cell" style:parent-style-name="Default"{ds}>{_style_props(tokens, look)}</style:style>')
            cell_styles[key] = name
        return cell_styles[key]

    named_styles: list[str] = []
    cf_names: dict[str, str] = {}

    def cf_style(tokens: str) -> str:
        if tokens not in cf_names:
            cf_names[tokens] = f"FormCel_Rule_{len(cf_names) + 1}"
            named_styles.append(f'<style:style style:name="{cf_names[tokens]}" style:family="table-cell" style:parent-style-name="Default">{_style_props(tokens, look)}</style:style>')
        return cf_names[tokens]

    tables = []
    col_styles: dict[int, str] = {}
    row_styles: dict[int, str] = {}
    for i, name in enumerate(eng.sheet_names()):
        view = views[i] if i < len(views) else {}
        vals = {(r, c): (k, t) for r, c, k, t in eng.typed(i)}
        res = {(r, c): (k, t) for r, c, k, t in eng.results(i)}
        codes = {(r, c): code for r, c, code in eng.auto_formats(i) + eng.formats(i)}
        sts = {}
        for r, c, _ in eng.styles(i):
            st = eng.effective_style(f"{get_column_letter(c + 1)}{r + 1}", i)
            sts[(r, c)] = ";".join(t for t in st.split(";") if not t.startswith("cs:"))
        merges = {(r0, c0): (r1 - r0 + 1, c1 - c0 + 1) for r0, c0, r1, c1 in eng.merges(i)}
        covered = {(r, c) for (r0, c0), (h, w) in merges.items() for r in range(r0, r0 + h) for c in range(c0, c0 + w) if (r, c) != (r0, c0)}
        links = {(r, c): t for r, c, t in eng.links(i)}
        keys = set(vals) | set(codes) | set(sts) | set(merges) | covered
        nrows = max((r for r, _ in keys), default=-1) + 1
        ncols = max((c for _, c in keys), default=-1) + 1
        cols = dict((view.get("cols") or {}).get("sizes", []))
        hidden_c = set((view.get("cols") or {}).get("hidden", []))
        rows = dict((view.get("rows") or {}).get("sizes", []))
        hidden_r = set((view.get("rows") or {}).get("hidden", [])) | filtered_rows(eng.filter(i))
        parts = [f"<table:table table:name={quoteattr(name)}>"]
        for c in range(max(ncols, 1)):
            px = cols.get(c, 100)
            if px not in col_styles:
                col_styles[px] = f"co{len(col_styles) + 1}"
                auto.append(f'<style:style style:name="{col_styles[px]}" style:family="table-column"><style:table-column-properties style:column-width="{px / 96:.4f}in"/></style:style>')
            vis = ' table:visibility="collapse"' if c in hidden_c else ""
            parts.append(f'<table:table-column table:style-name="{col_styles[px]}"{vis}/>')
        by_row: dict[int, list[int]] = {}
        for r, c in keys:
            by_row.setdefault(r, []).append(c)
        for r in range(nrows):
            attrs = ""
            if r in rows:
                px = rows[r]
                if px not in row_styles:
                    row_styles[px] = f"ro{len(row_styles) + 1}"
                    auto.append(f'<style:style style:name="{row_styles[px]}" style:family="table-row"><style:table-row-properties style:row-height="{px / 96:.4f}in" style:use-optimal-row-height="false"/></style:style>')
                attrs += f' table:style-name="{row_styles[px]}"'
            if r in hidden_r:
                attrs += ' table:visibility="collapse"'
            cs = sorted(by_row.get(r, []))
            if not cs:
                parts.append(f"<table:table-row{attrs}><table:table-cell/></table:table-row>")
                continue
            parts.append(f"<table:table-row{attrs}>")
            at = 0
            for c in cs:
                if c > at:
                    parts.append(f'<table:table-cell table:number-columns-repeated="{c - at}"/>' if c - at > 1 else "<table:table-cell/>")
                parts.append(_cell_xml(r, c, vals, res, codes, sts, merges, covered, links, cell_style, data_style))
                at = c + 1
            parts.append("</table:table-row>")
        parts.append(cf.rules_out(eng.rules(i), name, cf_style))
        parts.append("</table:table>")
        tables.append("".join(parts))
    named = []
    for n, refers in eng.names():
        named.append(f"<table:named-expression table:name={quoteattr(n)} table:expression={quoteattr(to_file(refers))}/>")
    face_decls = "".join(f"<style:font-face style:name={quoteattr(f)} svg:font-family={quoteattr(f)}/>" for f in sorted(fonts))
    content = (f'<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content {ROOT_NS} xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3">'
               f"<office:font-face-decls>{face_decls}</office:font-face-decls>"
               f"<office:automatic-styles>{''.join(auto)}</office:automatic-styles><office:body><office:spreadsheet>{''.join(tables)}"
               + (f"<table:named-expressions>{''.join(named)}</table:named-expressions>" if named else "")
               + "</office:spreadsheet></office:body></office:document-content>")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.oasis.opendocument.spreadsheet", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/manifest.xml", MANIFEST)
        z.writestr("content.xml", content)
        z.writestr("styles.xml", STYLES.replace("{font}", body_font).replace("{named}", "".join(named_styles)))
        z.writestr("meta.xml", META)
    return out.getvalue(), [f"{n} {what}" for what, n in sorted(notes.items())]


def _value_attrs(kind: str, text: str, code: str | None, data_style) -> str:
    if kind == "n":
        vt = data_style(code)[1] if code else "float"
        n = float(text)
        if vt == "date":
            d = EPOCH + dt.timedelta(days=n)
            return f'office:value-type="date" office:date-value="{d.isoformat(timespec="seconds")}"'
        if vt == "time":
            secs = round(n * 86400, 3)
            h, rem = divmod(secs, 3600)
            m, s = divmod(rem, 60)
            return f'office:value-type="time" office:time-value="PT{int(h)}H{int(m)}M{s:g}S"'
        if vt in ("percentage", "currency"):
            return f'office:value-type="{vt}" office:value="{text}"' + (' office:currency="USD"' if vt == "currency" else "")
        return f'office:value-type="float" office:value="{text}"'
    if kind == "b":
        return f'office:value-type="boolean" office:boolean-value="{"true" if text == "TRUE" else "false"}"'
    if kind == "e":
        return 'office:value-type="string" calcext:value-type="error"'
    return 'office:value-type="string"'


def _cell_xml(r, c, vals, res, codes, sts, merges, covered, links, cell_style, data_style) -> str:
    if (r, c) in covered:
        return "<table:covered-table-cell/>"
    attrs = []
    code = codes.get((r, c))
    tokens = sts.get((r, c), "")
    if tokens or code:
        attrs.append(f'table:style-name="{cell_style(tokens, code or "")}"')
    if (r, c) in merges:
        h, w = merges[(r, c)]
        attrs.append(f'table:number-columns-spanned="{w}" table:number-rows-spanned="{h}"')
    kind, text = vals.get((r, c), ("", ""))
    shown = text
    if kind == "f":
        attrs.append(f"table:formula={quoteattr(to_file(text))}")
        rk, rt = res.get((r, c), ("t", ""))
        attrs.append(_value_attrs(rk, rt, code, data_style) if rk in ("n", "b") else 'office:value-type="string"' + (f" office:string-value={quoteattr(rt)}" if rk == "t" else ""))
        shown = rt
    elif kind in ("n", "b", "t", "e"):
        attrs.append(_value_attrs(kind, text, code, data_style))
    body = ""
    if kind and shown != "":
        link = links.get((r, c))
        inner = escape(shown).replace("\n", "<text:line-break/>")
        body = f"<text:p><text:a xlink:href={quoteattr(link)} xlink:type=\"simple\">{inner}</text:a></text:p>" if link else f"<text:p>{inner}</text:p>"
    return f"<table:table-cell {' '.join(attrs)}>{body}</table:table-cell>" if attrs or body else "<table:table-cell/>"
