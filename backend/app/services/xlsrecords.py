import io
import struct

from formcel_engine import offset
from openpyxl.utils import get_column_letter as L
from xlrd import compdoc, formula as xf

from . import xlsformula
from .xlsstyle import EDGES, LINES, _hex
from .xlsx.cf import esc, _operand_in
from .xlsx.drawings import _refs
from .xlsx.formulas import from_file

BOF, EOF, BOUNDSHEET = 0x0809, 0x000A, 0x0085
CFHEADER, CF, DVAL, DV, ARRAY, TABLE, MSODRAWING, OBJ = 0x01B0, 0x01B1, 0x01B2, 0x01BE, 0x0221, 0x0236, 0x00EC, 0x005D
C_CHART, C_SERIES, C_AI, C_SERIESTEXT, C_TEXT, C_OBJECTLINK, C_LEGEND = 0x1002, 0x1003, 0x1051, 0x100D, 0x1025, 0x1027, 0x1015
C_BAR, C_LINE, C_PIE, C_AREA, C_SCATTER, C_RADAR, C_RADARAREA = 0x1017, 0x1018, 0x1019, 0x101A, 0x101B, 0x103E, 0x103F
CELL, ARRAY_T, COND, VALID = xf.FMLA_TYPE_CELL, xf.FMLA_TYPE_ARRAY, xf.FMLA_TYPE_COND_FMT, xf.FMLA_TYPE_DATA_VAL
CF_OPS = {1: "between", 2: "notbetween", 3: "eq", 4: "ne", 5: "gt", 6: "lt", 7: "ge", 8: "le"}
DV_KINDS = {0: "any", 1: "whole", 2: "decimal", 3: "list", 4: "date", 5: "time", 6: "length", 7: "custom"}
DV_STYLES = {0: "stop", 1: "warning", 2: "info"}
LEGEND_AT = {0: "bottom", 1: "right", 2: "top", 3: "right", 4: "left"}
MAX_CHARTS = 50


def _records(mem: bytes, pos: int):
    n = len(mem)
    while pos + 4 <= n:
        op, ln = struct.unpack_from("<HH", mem, pos)
        yield op, bytes(mem[pos + 4 : pos + 4 + ln])
        pos += 4 + ln


def _ref8(body: bytes, at: int) -> tuple[int, int, int, int] | None:
    if at + 8 > len(body):
        return None
    r0, r1, c0, c1 = struct.unpack_from("<HHHH", body, at)
    return r0, c0, min(r1, 1048575), min(c1, 16383)


def _ustr(body: bytes, at: int) -> tuple[str, int]:
    cch, flag = struct.unpack_from("<HB", body, at)
    at += 3
    if flag & 1:
        text = body[at : at + 2 * cch].decode("utf-16-le", "replace")
        return text, at + 2 * cch
    return body[at : at + cch].decode("latin-1"), at + cch


def _formula(book, rgce: bytes, kind: int, row: int, col: int) -> str | None:
    if not rgce:
        return None
    return xlsformula._text(book, rgce, kind, row, col)


def _operand(book, rgce: bytes, kind: int, row: int, col: int) -> str:
    text = _formula(book, rgce, kind, row, col)
    return "" if text is None else _operand_in(text)


def _dxf(book, body: bytes) -> tuple[str, int]:
    flags = struct.unpack_from("<I", body, 6)[0]
    at = 12
    out: list[str] = []
    if flags & 0x04000000 and at + 118 <= len(body):
        font = body[at : at + 118]
        at += 118
        style = struct.unpack_from("<I", font, 68)[0]
        weight = struct.unpack_from("<H", font, 72)[0]
        under = font[76]
        colour = struct.unpack_from("<I", font, 80)[0]
        if weight >= 700 and weight != 0xFFFF:
            out.append("b")
        if style & 2:
            out.append("i")
        if style & 0x80:
            out.append("s")
        if under and under != 0xFF:
            out.append("u")
        if colour < 0x7FFF:
            hexed = _hex(book, colour)
            if hexed:
                out.append(f"fc:{hexed}")
    sides: list[str] = []
    if flags & 0x10000000 and at + 8 <= len(body):
        lines, c1, c2, _ = struct.unpack_from("<HHHH", body, at)
        at += 8
        shapes = {"left": (lines & 15, c1 & 127), "right": ((lines >> 4) & 15, (c1 >> 7) & 127), "top": ((lines >> 8) & 15, c2 & 127), "bottom": ((lines >> 12) & 15, (c2 >> 7) & 127)}
        for tok, edge in EDGES:
            style, ci = shapes[edge]
            if style in LINES:
                sides.append(f"{tok}:{LINES[style]}:{_hex(book, ci) or '000000'}")
    out.extend(sides)
    if flags & 0x20000000 and at + 4 <= len(body):
        word1, word2 = struct.unpack_from("<HH", body, at)
        at += 4
        pattern = word1 >> 10
        if pattern == 1:
            bg = _hex(book, (word2 >> 7) & 127) or _hex(book, word2 & 127)
            if bg:
                out.append(f"bg:{bg}")
    return ";".join(out), at


def _cf_rule(book, body: bytes, base: tuple[int, int]) -> list[str] | None:
    if len(body) < 12:
        return None
    ct, cp, c1, c2 = body[0], body[1], struct.unpack_from("<H", body, 2)[0], struct.unpack_from("<H", body, 4)[0]
    style, at = _dxf(book, body)
    f1, f2 = body[at : at + c1], body[at + c1 : at + c1 + c2]
    if ct == 1 and cp in CF_OPS:
        kind = ["cell", CF_OPS[cp], _operand(book, f1, COND, *base), _operand(book, f2, COND, *base) if c2 else ""]
    elif ct == 2:
        text = _formula(book, f1, COND, *base)
        if text is None:
            return None
        kind = ["formula", "=" + from_file(text), "", ""]
    else:
        return None
    return kind + [style]


def _anchor(body: bytes) -> tuple[int, int, int, int, int, int, int, int] | None:
    pos = 0
    while pos + 8 <= len(body):
        vi, typ, ln = struct.unpack_from("<HHI", body, pos)
        if vi & 15 == 15:
            found = _anchor(body[pos + 8 : pos + 8 + ln])
            if found:
                return found
        elif typ == 0xF010 and ln >= 18:
            _, c0, dx0, r0, dy0, c1, dx1, r1, dy1 = struct.unpack_from("<9H", body, pos + 8)
            return c0, dx0, r0, dy0, c1, dx1, r1, dy1
        pos += 8 + ln
    return None


def _validation(book, body: bytes) -> list[str] | None:
    if len(body) < 8:
        return None
    flags = struct.unpack_from("<I", body, 0)[0]
    kind = DV_KINDS.get(flags & 15)
    if kind is None:
        return None
    style = DV_STYLES.get((flags >> 4) & 7, "stop")
    op = ["between", "notbetween", "eq", "ne", "gt", "lt", "ge", "le"][(flags >> 20) & 7]
    at = 4
    texts = []
    for _ in range(4):
        t, at = _ustr(body, at)
        texts.append(t if t.replace("\x00", "").strip() else "")
    c1 = struct.unpack_from("<H", body, at)[0]
    f1 = body[at + 4 : at + 4 + c1]
    at += 4 + c1
    c2 = struct.unpack_from("<H", body, at)[0]
    f2 = body[at + 4 : at + 4 + c2]
    at += 4 + c2
    count = struct.unpack_from("<H", body, at)[0]
    refs = [r for r in (_ref8(body, at + 2 + 8 * i) for i in range(count)) if r]
    if not refs:
        return None
    base = (refs[0][0], refs[0][1])
    a = b = ""
    if kind == "list":
        if flags & 0x80 and f1[:1] == b"\x17":
            cch, wide = f1[1], f1[2] & 1
            raw = f1[3 : 3 + (2 * cch if wide else cch)]
            a = (raw.decode("utf-16-le", "replace") if wide else raw.decode("latin-1")).replace("\x00", ",")
        else:
            text = _formula(book, f1, VALID, *base)
            a = "=" + text if text else ""
        if not a:
            return None
        op = ""
    elif kind == "custom":
        text = _formula(book, f1, VALID, *base)
        if not text:
            return None
        a, op = "=" + from_file(text), ""
    elif kind == "any":
        op = ""
    else:
        a = _operand(book, f1, VALID, *base)
        b = _operand(book, f2, VALID, *base) if op in ("between", "notbetween") else ""
    letters = ("b" if flags & 0x100 else "") + ("d" if kind == "list" and flags & 0x200 else "") + ("p" if flags & 0x40000 else "") + ("e" if flags & 0x80000 else "")
    rest = [kind, op, a, b, letters, style, texts[0], texts[2], texts[1], texts[3]]
    return [f"{r0},{c0},{r1},{c1}\t" + "\t".join(esc(x) for x in rest) for r0, c0, r1, c1 in refs]


def _table(body: bytes, sheet: int) -> tuple[str, tuple[int, int, int, int]] | None:
    if len(body) < 16:
        return None
    r0, r1, c0, c1, flags, ra, ca, rb, cb = struct.unpack_from("<HHBBHHHHH", body, 0)
    cell = lambda r, c: f"{L(c + 1)}{r + 1}"
    two, across = bool(flags & 8), bool(flags & 4)
    if two:
        row_in, col_in = cell(ra, ca), cell(rb, cb)
    elif across:
        row_in, col_in = cell(ra, ca), ""
    else:
        row_in, col_in = "", cell(ra, ca)
    if r0 < 1 or c0 < 1:
        return None
    return "\t".join(["dt", str(sheet), str(r0 - 1), str(c0 - 1), str(r1), str(c1), row_in, col_in]), (r0, c0, r1, c1)


class _Chart:
    def __init__(self, anchor):
        self.anchor = anchor
        self.kind = None
        self.series: list[dict] = []
        self.legend = "none"
        self.titles: dict[int, str] = {}
        self.pending: str | None = None
        self.ctx = ""
        self.last_ai: tuple[int, int] | None = None


def _chart_record(book, ch: _Chart, op: int, body: bytes) -> None:
    if op == C_SERIES:
        ch.series.append({})
    elif op == C_AI and len(body) >= 8 and ch.series:
        ai, rt = body[0], body[1]
        cce = struct.unpack_from("<H", body, 6)[0]
        ch.last_ai = (ai, rt)
        if rt == 2:
            text = _formula(book, body[8 : 8 + cce], CELL, 0, 0)
            if text:
                ch.series[-1][ai] = text
    elif op == C_SERIESTEXT and len(body) >= 4:
        cch, flag = body[2], body[3]
        raw = body[4 : 4 + (2 * cch if flag & 1 else cch)]
        text = raw.decode("utf-16-le", "replace") if flag & 1 else raw.decode("latin-1")
        if ch.ctx == "text":
            ch.pending = text
        elif ch.series and ch.last_ai == (0, 1):
            ch.series[-1]["name"] = text
    elif op == C_TEXT:
        ch.ctx, ch.pending = "text", None
    elif op == C_OBJECTLINK and len(body) >= 2:
        link = struct.unpack_from("<H", body, 0)[0]
        if ch.pending:
            ch.titles[link] = ch.pending
        ch.ctx, ch.pending = "", None
    elif op == C_LEGEND and len(body) >= 17:
        ch.legend = LEGEND_AT.get(body[16], "right")
    elif ch.kind is None and op in (C_BAR, C_LINE, C_PIE, C_AREA, C_SCATTER, C_RADAR, C_RADARAREA):
        g = struct.unpack_from("<H", body, 4 if op in (C_BAR, C_SCATTER, C_PIE) else 0)[0] if len(body) >= (6 if op in (C_BAR, C_SCATTER, C_PIE) else 2) else 0
        if op == C_BAR:
            ch.kind = ("bar" if g & 1 else "column") + ("-100" if g & 4 else "-stacked" if g & 2 else "")
        elif op == C_LINE:
            ch.kind = "line"
        elif op == C_PIE:
            ch.kind = "doughnut" if len(body) >= 4 and struct.unpack_from("<H", body, 2)[0] else "pie"
        elif op == C_AREA:
            ch.kind = "area-100" if g & 2 else "area-stacked" if g & 1 else "area"
        elif op == C_SCATTER:
            ch.kind = "bubble" if g & 1 else "scatter"
        else:
            ch.kind = "radar"


def _chart_object(ch: _Chart, host: str, view: dict, cols: dict[int, int], rows: dict[int, int]) -> dict | None:
    if not ch.kind or not ch.series:
        return None
    boxes = []
    sheet = None
    by_rows = False
    for s in ch.series:
        for key in (0, 1, 2, 3):
            got = _refs(s.get(key, "")) if s.get(key) else None
            if got:
                sheet = sheet or got[0]
                boxes.append(got[1])
                if key == 1:
                    c0, r0, c1, r1 = got[1]
                    by_rows = by_rows or (r0 == r1 and c1 > c0)
    if not boxes:
        return None
    c0, r0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    c1, r1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    rng = f"{L(c0)}{r0}:{L(c1)}{r1}"
    if sheet and sheet != host:
        rng = f"'{sheet.replace(chr(39), chr(39) * 2)}'!{rng}"
    spec = {"type": ch.kind, "range": rng, "byRows": by_rows, "title": ch.titles.get(1, ""), "xTitle": ch.titles.get(3, ""), "yTitle": ch.titles.get(2, ""),
            "legend": ch.legend, "labels": False, "secondary": []}
    a = ch.anchor
    x, y, w, h = 20, 20, 480, 300
    if a:
        cdef, rdef = 100, 24
        left = sum(cols.get(i, cdef) for i in range(a[0])) + cols.get(a[0], cdef) * a[1] / 1024
        top = sum(rows.get(i, rdef) for i in range(a[2])) + rows.get(a[2], rdef) * a[3] / 256
        right = sum(cols.get(i, cdef) for i in range(a[4])) + cols.get(a[4], cdef) * a[5] / 1024
        bottom = sum(rows.get(i, rdef) for i in range(a[6])) + rows.get(a[6], rdef) * a[7] / 256
        x, y, w, h = int(left), int(top), max(40, int(right - left)), max(40, int(bottom - top))
    return {"kind": "chart", "x": x, "y": y, "w": w, "h": h, "chart": spec}


def scan(data: bytes, book, views: list[dict], names: list[str]) -> list[dict]:
    try:
        doc = compdoc.CompDoc(data, io.StringIO())
        mem = doc.get_named_stream("Workbook") or doc.get_named_stream("Book")
    except Exception:
        return []
    if not mem:
        return []
    starts = []
    for op, body in _records(mem, 0):
        if op == BOUNDSHEET and len(body) >= 4:
            starts.append(struct.unpack_from("<I", body, 0)[0])
        elif op == EOF and starts:
            break
    out = []
    for si, start in enumerate(starts):
        res = {"rules": [], "validations": [], "arrays": [], "tables": [], "charts": [], "covered": set(), "hollow": set(), "lost": 0}
        view = views[si] if si < len(views) else {}
        cols = {int(i): int(px) for i, px in (view.get("cols") or {}).get("sizes", [])}
        rows = {int(i): int(px) for i, px in (view.get("rows") or {}).get("sizes", [])}
        depth = 0
        header = None
        left = 0
        anchor = None
        chart_anchors: list = []
        chart: _Chart | None = None
        host = names[si] if si < len(names) else ""
        for op, body in _records(mem, start):
            if op == BOF:
                depth += 1
                if depth == 2 and len(body) >= 4 and struct.unpack_from("<H", body, 2)[0] == 0x20 and len(res["charts"]) < MAX_CHARTS:
                    chart = _Chart(chart_anchors.pop(0) if chart_anchors else None)
                continue
            if op == EOF:
                depth -= 1
                if depth == 1 and chart is not None:
                    obj = _chart_object(chart, host, view, cols, rows)
                    if obj:
                        res["charts"].append(obj)
                    else:
                        res["lost"] += 1
                    chart = None
                if depth <= 0:
                    break
                continue
            try:
                if depth == 2 and chart is not None:
                    _chart_record(book, chart, op, body)
                    continue
                if depth != 1:
                    continue
                if op == MSODRAWING:
                    anchor = _anchor(body) or anchor
                elif op == OBJ and len(body) >= 8 and struct.unpack_from("<H", body, 4)[0] == 5:
                    chart_anchors.append(anchor)
                    anchor = None
                elif op == CFHEADER and len(body) >= 14:
                    left = struct.unpack_from("<H", body, 0)[0]
                    count = struct.unpack_from("<H", body, 12)[0]
                    header = [r for r in (_ref8(body, 14 + 8 * i) for i in range(count)) if r]
                    bound = _ref8(body, 4)
                    base = (bound[0], bound[1]) if bound else (header[0][0], header[0][1]) if header else (0, 0)
                elif op == CF and header and left > 0:
                    left -= 1
                    rule = _cf_rule(book, body, base)
                    if rule is None:
                        res["lost"] += 1
                    else:
                        for rg in header:
                            k = list(rule)
                            if k[0] == "formula" and (rg[0], rg[1]) != base:
                                k[1] = offset(k[1], rg[0] - base[0], rg[1] - base[1])
                            res["rules"].append(f"{rg[0]},{rg[1]},{rg[2]},{rg[3]}\t0\t" + "\t".join(esc(x) for x in k))
                elif op == DV:
                    lines = _validation(book, body)
                    if lines is None:
                        res["lost"] += 1
                    else:
                        res["validations"].extend(lines)
                elif op == ARRAY and len(body) >= 14:
                    r0, r1, c0, c1 = struct.unpack_from("<HHBB", body, 0)
                    cce = struct.unpack_from("<H", body, 12)[0]
                    text = _formula(book, body[14 : 14 + cce], ARRAY_T, r0, c0)
                    if text:
                        res["arrays"].append((r0, c0, r1, c1, text))
                        members = {(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)}
                        res["covered"].update(members)
                        res["hollow"].update(members - {(r0, c0)})
                elif op == TABLE:
                    got = _table(body, si)
                    if got:
                        res["tables"].append(got[0])
                        r0, c0, r1, c1 = got[1]
                        res["covered"].update((r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1))
            except Exception:
                res["lost"] += 1
                continue
        out.append(res)
    return out
