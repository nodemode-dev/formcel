import io
import re


def runs(raw: bytes, width: int, rows: int, min_len: int) -> list[list[tuple[int, int]]]:
    pat = re.compile(b"\x00{%d,}" % min_len)
    out = []
    for y in range(rows):
        line = raw[y * width:(y + 1) * width]
        out.append([m.span() for m in pat.finditer(line)])
    return out


def groups(idx: list[int]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for i in idx:
        if out and i <= out[-1][1] + 1:
            out[-1] = (out[-1][0], i)
        else:
            out.append((i, i))
    return out


def prepare(data: bytes) -> dict:
    try:
        from PIL import Image, ImageDraw, ImageOps
    except ImportError:
        return {"data": data, "ext": None, "scale": 1, "vlines": []}
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        return {"data": data, "ext": None, "scale": 1, "vlines": []}
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        back = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(back, im)
    im = im.convert("L")
    w, h = im.size
    scale = 1
    if max(w, h) < 1600:
        scale = min(3, -(-1600 // max(w, h)))
        im = im.resize((w * scale, h * scale), Image.LANCZOS)
        w, h = im.size
    im = ImageOps.autocontrast(im, cutoff=1)
    bw = im.point(lambda p: 0 if p < 150 else 255)
    raw = bw.tobytes()
    draw = ImageDraw.Draw(im)
    hrows = runs(raw, w, h, max(40, int(0.2 * w)))
    flagged = [y for y, r in enumerate(hrows) if r]
    for y in flagged:
        for a, b in hrows[y]:
            draw.rectangle([a, max(0, y - 1), b, min(h - 1, y + 1)], fill=255)
    t = bw.transpose(Image.Transpose.ROTATE_90)
    traw = t.tobytes()
    vcols = runs(traw, h, w, max(40, int(0.2 * h)))
    vlines: list[float] = []
    cols = [x for x, r in enumerate(vcols) if r]
    for a, b in groups(cols):
        for x in range(a, b + 1):
            for s, e in vcols[x]:
                ox = w - 1 - x
                draw.rectangle([max(0, ox - 1), s, min(w - 1, ox + 1), min(h - 1, e - 1)], fill=255)
        vlines.append(w - 1 - (a + b) / 2)
    vlines.sort()
    out = io.BytesIO()
    im.save(out, format="PNG")
    return {"data": out.getvalue(), "ext": ".png", "scale": scale, "vlines": vlines}
