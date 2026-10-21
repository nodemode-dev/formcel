import datetime
import io
import os
from pathlib import Path

from openpyxl.utils import get_column_letter
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from . import page as pg
from .xlsx.autofilter import filtered_rows

PAGE_W, PAGE_H = 612.0, 792.0
MARGIN_X, MARGIN_Y = 0.7 * 72, 0.75 * 72
COL_PX, ROW_PX = 100, 24
PT = 0.75
SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]
WIDTHS = {"thin": 0.5, "medium": 1.0, "thick": 1.75, "dashed": 0.5, "dotted": 0.5, "double": 0.5}
CANDIDATES = [
    ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"),
    ("LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf"),
    ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"),
    ("Arial.ttf", "Arial Bold.ttf", "Arial Italic.ttf", "Arial Bold Italic.ttf"),
]
FONT_DIRS = ["/usr/share/fonts", "/usr/local/share/fonts", str(Path.home() / ".fonts"), "/System/Library/Fonts/Supplemental", "/Library/Fonts",
             str(Path.home() / "Library/Fonts"), os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts")]
_family: dict[str, str] | None = None


def _find(name: str) -> str | None:
    for d in FONT_DIRS:
        if not os.path.isdir(d):
            continue
        direct = os.path.join(d, name)
        if os.path.isfile(direct):
            return direct
        for root, _, files in os.walk(d):
            if name in files:
                return os.path.join(root, name)
    return None


def family() -> dict[str, str]:
    global _family
    if _family is not None:
        return _family
    for names in CANDIDATES:
        paths = [_find(n) for n in names]
        if paths[0]:
            out = {}
            for key, p in zip(("r", "b", "i", "bi"), paths):
                fid = f"FormCel-{key}"
                pdfmetrics.registerFont(TTFont(fid, p or paths[0]))
                out[key] = fid
            _family = out
            return out
    _family = {"r": "Helvetica", "b": "Helvetica-Bold", "i": "Helvetica-Oblique", "bi": "Helvetica-BoldOblique"}
    return _family


def _rgb(hexs: str) -> tuple[float, float, float]:
    n = int(hexs[-6:], 16)
    return ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255


def _colour(v: str, slots: dict[str, str]) -> tuple[float, float, float]:
    if v.startswith("t:"):
        p = v.split(":")
        base = slots.get(p[1], "000000")
        t = int(p[2]) if len(p) > 2 and p[2].lstrip("-").isdigit() else 0
        ch = [int(base[i:i + 2], 16) for i in (0, 2, 4)]
        ch = [x + (255 - x) * t / 100 if t >= 0 else x * (1 + t / 100) for x in ch]
        return tuple(x / 255 for x in ch)
    return _rgb(v)


def _style(text: str) -> dict:
    st: dict = {"borders": {}}
    for tok in text.split(";"):
        k, _, v = tok.partition(":")
        if k in ("b", "i", "u", "s", "wrap"):
            st[k] = True
        elif k == "sz" and v:
            st["sz"] = float(v)
        elif k in ("fc", "bg", "ha", "va") and v:
            st[k] = v
        elif k in ("bt", "br", "bb", "bl"):
            line, _, col = v.partition(":")
            st["borders"][k] = (line, col or "000000")
        elif k == "in" and v.isdigit():
            st["in"] = int(v)
    return st


def _pages(sizes: list[float], room: float, breaks: set[int] = frozenset(), lead: float = 0.0) -> list[tuple[int, int]]:
    out, start, used, cap = [], 0, 0.0, room
    for i, s in enumerate(sizes):
        if i > start and (i in breaks or used + s > cap):
            out.append((start, i))
            start, used, cap = i, 0.0, room - lead
        used += s
    out.append((start, len(sizes)))
    return out


def _sheet(c: canvas.Canvas, eng, i: int, view: dict, slots: dict[str, str], fonts: dict[str, str], name: str = "", file: str = "") -> int:
    values = {(r, col): v for r, col, v in eng.values(i) if v != ""}
    kinds = {(r, col): k for r, col, k, _ in eng.typed(i)}
    kinds.update({(r, col): k for r, col, k, _ in eng.results(i)})
    styled = [(r, col) for r, col, _ in eng.styles(i)]
    keys = set(values) | set(styled)
    merges = {(r0, c0): (r1, c1) for r0, c0, r1, c1 in eng.merges(i)}
    for (r0, c0), (r1, c1) in merges.items():
        keys.add((r1, c1))
    if not keys:
        return 0
    pgs = pg.clean(view.get("page"))
    pw, ph, _code = pg.PAPERS[pgs["paper"]]
    if pgs["orient"] == "landscape":
        pw, ph = ph, pw
    mt, mr, mb, ml, mh, mf = (x * 72 for x in pgs["m"])
    area = pg.area_of(pgs["area"])
    hw, hh = (24.0, 14.0) if pgs["heads"] else (0.0, 0.0)
    nrows = max(r for r, _ in keys) + 1
    ncols = max(col for _, col in keys) + 1
    if area:
        nrows, ncols = max(nrows, area[2] + 1), max(ncols, area[3] + 1)
    covered = {(r, col) for (r0, c0), (r1, c1) in merges.items() for r in range(r0, r1 + 1) for col in range(c0, c1 + 1) if (r, col) != (r0, c0)}
    colpx = dict((view.get("cols") or {}).get("sizes", []))
    rowpx = dict((view.get("rows") or {}).get("sizes", []))
    hidden_c = set((view.get("cols") or {}).get("hidden", []))
    hidden_r = set((view.get("rows") or {}).get("hidden", [])) | filtered_rows(eng.filter(i))
    if area:
        hidden_c |= set(range(0, area[1])) | set(range(area[3] + 1, ncols))
        hidden_r |= set(range(0, area[0])) | set(range(area[2] + 1, nrows))
    cw =[0.0 if col in hidden_c else colpx.get(col, COL_PX) * PT for col in range(ncols)]
    rh = [0.0 if r in hidden_r else rowpx.get(r, ROW_PX) * PT for r in range(nrows)]
    room_w, room_h = pw - ml - mr - hw, ph - mt - mb - hh
    if pgs["scale"] == "custom":
        scale = pgs["pct"] / 100
    elif pgs["scale"] == "fit-cols":
        scale = min(1.0, room_w / sum(cw)) if sum(cw) else 1.0
    elif pgs["scale"] == "fit-sheet":
        scale = min(1.0, room_w / sum(cw) if sum(cw) else 1.0, room_h / sum(rh) if sum(rh) else 1.0)
    else:
        scale = min(1.0, max(0.5, room_w / sum(cw))) if sum(cw) else 1.0
    cw = [w * scale for w in cw]
    rh = [h * scale for h in rh]
    styles = {}
    for r, col in styled:
        styles[(r, col)] = _style(eng.effective_style(f"{get_column_letter(col + 1)}{r + 1}", i))
    for (r, col), st in styles.items():
        if r in rowpx or r in hidden_r or (r, col) in covered:
            continue
        size = st.get("sz", 10.0) * scale
        lines = 1
        text = values.get((r, col), "")
        if st.get("wrap") and text and cw[col]:
            face = fonts["b" if st.get("b") else "r"]
            lines = max(1, len(simpleSplit(text, face, size, cw[col] - 5 * scale)))
        rh[r] = max(rh[r], size * 1.2 * lines + 5 * scale)
    paint = {}
    bottom = f"{get_column_letter(ncols)}{nrows}"
    for a1, s, bar, _icon in eng.cf_in("A1", bottom, i):
        col = 0
        k = 0
        while k < len(a1) and a1[k].isalpha():
            col = col * 26 + ord(a1[k].upper()) - 64
            k += 1
        paint[(int(a1[k:]) - 1, col - 1)] = (_style(s) if s else None, bar)
    pages = 0
    tr, tc = pg.rows_of(pgs["titleRows"]), pg.cols_of(pgs["titleCols"])
    trows = [r for r in range(tr[0], min(tr[1], nrows - 1) + 1) if rh[r]] if tr else []
    tcols = [k for k in range(tc[0], min(tc[1], ncols - 1) + 1) if cw[k]] if tc else []
    col_pages = _pages(cw, room_w, set(pgs["colBreaks"]), sum(cw[k] for k in tcols))
    row_pages = _pages(rh, room_h, set(pgs["rowBreaks"]), sum(rh[k] for k in trows))
    total = len(col_pages) * len(row_pages)
    today = datetime.date.today().isoformat()
    for c0, c1 in col_pages:
        for r0, r1 in row_pages:
            pages += 1
            c.setPageSize((pw, ph))
            cl = [k for k in tcols if k < c0] + list(range(c0, c1))
            rl = [k for k in trows if k < r0] + list(range(r0, r1))
            pos_c = {k: n for n, k in enumerate(cl)}
            pos_r = {k: n for n, k in enumerate(rl)}
            xs = [ml + hw]
            for col in cl:
                xs.append(xs[-1] + cw[col])
            ys = [ph - mt - hh]
            for r in rl:
                ys.append(ys[-1] - rh[r])
            lines = []
            if pgs["grid"]:
                for r in rl:
                    for col in cl:
                        if cw[col] and rh[r]:
                            lines.append(((xs[pos_c[col]], ys[pos_r[r]], xs[pos_c[col] + 1], ys[pos_r[r]]), "grid", (0.78, 0.78, 0.78)))
                            lines.append(((xs[pos_c[col]], ys[pos_r[r] + 1], xs[pos_c[col] + 1], ys[pos_r[r] + 1]), "grid", (0.78, 0.78, 0.78)))
                            lines.append(((xs[pos_c[col]], ys[pos_r[r]], xs[pos_c[col]], ys[pos_r[r] + 1]), "grid", (0.78, 0.78, 0.78)))
                            lines.append(((xs[pos_c[col] + 1], ys[pos_r[r]], xs[pos_c[col] + 1], ys[pos_r[r] + 1]), "grid", (0.78, 0.78, 0.78)))
            if pgs["heads"]:
                c.setFont(fonts["r"], 7)
                c.setFillColorRGB(0.35, 0.35, 0.35)
                for col in cl:
                    if cw[col]:
                        c.drawCentredString((xs[pos_c[col]] + xs[pos_c[col] + 1]) / 2, ph - mt - hh + 4, get_column_letter(col + 1))
                for r in rl:
                    if rh[r]:
                        c.drawRightString(ml + hw - 4, (ys[pos_r[r]] + ys[pos_r[r] + 1]) / 2 - 2.5, str(r + 1))
            for r in rl:
                for col in cl:
                    if (r, col) in covered or not cw[col] or not rh[r]:
                        continue
                    re_, ce = merges.get((r, col), (r, col))
                    ce = col if ce == col else max(k for k in cl if k <= ce)
                    re_ = r if re_ == r else max(k for k in rl if k <= re_)
                    x0 = xs[pos_c[col]]
                    x1 = xs[pos_c[ce] + 1]
                    y0 = ys[pos_r[r]]
                    y1 = ys[pos_r[re_] + 1]
                    st = dict(styles.get((r, col), {"borders": {}}))
                    cf = paint.get((r, col))
                    if cf and cf[0]:
                        for k2, v2 in cf[0].items():
                            if k2 == "borders":
                                st["borders"] = {**st.get("borders", {}), **v2}
                            else:
                                st[k2] = v2
                    if st.get("bg"):
                        c.setFillColorRGB(*_colour(st["bg"], slots))
                        c.rect(x0, y1, x1 - x0, y0 - y1, stroke=0, fill=1)
                    if cf and cf[1]:
                        a, b, colr = cf[1].split(",")
                        inner = x1 - x0 - 4
                        c.setFillColorRGB(*_rgb(colr))
                        c.setFillAlpha(0.55)
                        c.rect(x0 + 2 + float(a) * inner, y1 + 2, max(0.75, (float(b) - float(a)) * inner), y0 - y1 - 4, stroke=0, fill=1)
                        c.setFillAlpha(1)
                    for tok, (line, colr) in st.get("borders", {}).items():
                        seg = {"bt": (x0, y0, x1, y0), "bb": (x0, y1, x1, y1), "bl": (x0, y0, x0, y1), "br": (x1, y0, x1, y1)}[tok]
                        lines.append((seg, line, _colour(colr, slots)))
                    text = values.get((r, col))
                    if not text:
                        continue
                    key = ("b" if st.get("b") else "") + ("i" if st.get("i") else "")
                    face = fonts.get({"": "r", "b": "b", "i": "i", "bi": "bi"}[key], fonts["r"])
                    size = st.get("sz", 10.0) * scale
                    c.setFont(face, size)
                    c.setFillColorRGB(*(_colour(st["fc"], slots) if st.get("fc") else (0, 0, 0)))
                    num = kinds.get((r, col)) in ("n",)
                    ha = st.get("ha") or ("right" if num else "center" if kinds.get((r, col)) in ("b", "e") else "left")
                    pad = 2.5 * scale + st.get("in", 0) * 9 * PT * scale
                    width = x1 - x0 - 2 * pad
                    rows_text = simpleSplit(text, face, size, width) if st.get("wrap") else text.split("\n")[:1]
                    lead = size * 1.2
                    block = lead * len(rows_text)
                    va = st.get("va", "bottom")
                    top = y0 - (y0 - y1 - block) / 2 if va == "middle" else (y0 - 1.5 * scale if va == "top" else y1 + block + 1.5 * scale)
                    c.saveState()
                    clip_x1 = x1
                    if not st.get("wrap") and ha == "left" and not num:
                        n = col + 1
                        while n < c1 and n in pos_c and (r, n) not in values and (r, n) not in covered and c.stringWidth(text, face, size) > clip_x1 - x0 - pad:
                            clip_x1 = xs[pos_c[n] + 1]
                            n += 1
                    p = c.beginPath()
                    p.rect(x0, y1, clip_x1 - x0, y0 - y1)
                    c.clipPath(p, stroke=0, fill=0)
                    for k3, line_text in enumerate(rows_text):
                        y = top - lead * (k3 + 1) + (lead - size) / 2 + size * 0.2
                        if ha == "right":
                            c.drawRightString(x1 - pad, y, line_text)
                            w = c.stringWidth(line_text, face, size)
                            lx = x1 - pad - w
                        elif ha == "center":
                            c.drawCentredString((x0 + x1) / 2, y, line_text)
                            w = c.stringWidth(line_text, face, size)
                            lx = (x0 + x1 - w) / 2
                        else:
                            c.drawString(x0 + pad, y, line_text)
                            w = c.stringWidth(line_text, face, size)
                            lx = x0 + pad
                        if st.get("u"):
                            c.setLineWidth(0.5 * scale)
                            c.line(lx, y - size * 0.12, lx + w, y - size * 0.12)
                        if st.get("s"):
                            c.setLineWidth(0.5 * scale)
                            c.line(lx, y + size * 0.3, lx + w, y + size * 0.3)
                    c.restoreState()
            for (xa, ya, xb, yb), line, rgb in lines:
                c.setStrokeColorRGB(*rgb)
                c.setLineWidth(WIDTHS.get(line, 0.5) * scale)
                c.setDash(2, 1.5) if line == "dashed" else c.setDash(0.5, 1) if line == "dotted" else c.setDash()
                if line == "double":
                    off = 1.0 * scale
                    if ya == yb:
                        c.line(xa, ya + off / 2, xb, yb + off / 2)
                        c.line(xa, ya - off / 2, xb, yb - off / 2)
                    else:
                        c.line(xa + off / 2, ya, xb + off / 2, yb)
                        c.line(xa - off / 2, ya, xb - off / 2, yb)
                else:
                    c.line(xa, ya, xb, yb)
            c.setDash()
            c.setFillColorRGB(0, 0, 0)
            c.setFont(fonts["r"], 9)
            for band, y in (("h", ph - mh - 9), ("f", mf)):
                for slot, side in (("l", 0), ("c", 1), ("r", 2)):
                    text = pgs["hf"][band + slot]
                    if not text:
                        continue
                    text = pg.code_text(text, pages, total, name, file, today)
                    x = (ml, (ml + pw - mr) / 2, pw - mr)[side]
                    (c.drawString, c.drawCentredString, c.drawRightString)[side](x, y, text)
            c.showPage()
    return pages


def write(eng, views: list[dict], sheets: list[int], title: str) -> bytes:
    fonts = family()
    theme = eng.theme().split(";")
    slots = dict(zip(SLOTS, (theme[1] if len(theme) > 1 else "").split(",")))
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(PAGE_W, PAGE_H))
    c.setTitle(title)
    c.setCreator("FormCel")
    total = 0
    for i in sheets:
        total += _sheet(c, eng, i, views[i] if i < len(views) else {}, slots, fonts, eng.sheet_names()[i], title)
    if not total:
        c.setFont(fonts["r"], 10)
        c.drawString(MARGIN_X, PAGE_H - MARGIN_Y - 10, "This sheet is empty.")
        c.showPage()
    c.save()
    return out.getvalue()
