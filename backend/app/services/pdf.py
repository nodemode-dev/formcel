import io
import os
from pathlib import Path

from openpyxl.utils import get_column_letter
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

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


def _pages(sizes: list[float], room: float) -> list[tuple[int, int]]:
    out, start, used = [], 0, 0.0
    for i, s in enumerate(sizes):
        if used + s > room and i > start:
            out.append((start, i))
            start, used = i, 0.0
        used += s
    out.append((start, len(sizes)))
    return out


def _sheet(c: canvas.Canvas, eng, i: int, view: dict, slots: dict[str, str], fonts: dict[str, str]) -> int:
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
    nrows = max(r for r, _ in keys) + 1
    ncols = max(col for _, col in keys) + 1
    covered = {(r, col) for (r0, c0), (r1, c1) in merges.items() for r in range(r0, r1 + 1) for col in range(c0, c1 + 1) if (r, col) != (r0, c0)}
    colpx = dict((view.get("cols") or {}).get("sizes", []))
    rowpx = dict((view.get("rows") or {}).get("sizes", []))
    hidden_c = set((view.get("cols") or {}).get("hidden", []))
    hidden_r = set((view.get("rows") or {}).get("hidden", [])) | filtered_rows(eng.filter(i))
    cw =[0.0 if col in hidden_c else colpx.get(col, COL_PX) * PT for col in range(ncols)]
    rh = [0.0 if r in hidden_r else rowpx.get(r, ROW_PX) * PT for r in range(nrows)]
    room_w, room_h = PAGE_W - 2 * MARGIN_X, PAGE_H - 2 * MARGIN_Y
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
    for c0, c1 in _pages(cw, room_w):
        for r0, r1 in _pages(rh, room_h):
            pages += 1
            xs = [MARGIN_X]
            for col in range(c0, c1):
                xs.append(xs[-1] + cw[col])
            ys = [PAGE_H - MARGIN_Y]
            for r in range(r0, r1):
                ys.append(ys[-1] - rh[r])
            lines = []
            for r in range(r0, r1):
                for col in range(c0, c1):
                    if (r, col) in covered or not cw[col] or not rh[r]:
                        continue
                    re_, ce = merges.get((r, col), (r, col))
                    x0 = xs[col - c0]
                    x1 = xs[min(ce, c1 - 1) - c0 + 1]
                    y0 = ys[r - r0]
                    y1 = ys[min(re_, r1 - 1) - r0 + 1]
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
                        while n < c1 and (r, n) not in values and (r, n) not in covered and c.stringWidth(text, face, size) > clip_x1 - x0 - pad:
                            clip_x1 = xs[n - c0 + 1]
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
        total += _sheet(c, eng, i, views[i] if i < len(views) else {}, slots, fonts)
    if not total:
        c.setFont(fonts["r"], 10)
        c.drawString(MARGIN_X, PAGE_H - MARGIN_Y - 10, "This sheet is empty.")
        c.showPage()
    c.save()
    return out.getvalue()
