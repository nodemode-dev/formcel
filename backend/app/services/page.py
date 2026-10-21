import re

from openpyxl.utils import column_index_from_string, get_column_letter
from openpyxl.worksheet.pagebreak import Break, ColBreak, RowBreak

PAPERS = {"Letter": (612.0, 792.0, 1), "Tabloid": (792.0, 1224.0, 3), "Legal": (612.0, 1008.0, 5), "A3": (841.89, 1190.55, 8), "A4": (595.28, 841.89, 9)}
PAPER_BY_CODE = {v[2]: k for k, v in PAPERS.items()}
MARGINS = {"normal": (0.75, 0.7, 0.75, 0.7, 0.3, 0.3), "wide": (1.0, 1.0, 1.0, 1.0, 0.5, 0.5), "narrow": (0.75, 0.25, 0.75, 0.25, 0.3, 0.3)}
SCALES = ("none", "fit-cols", "fit-sheet", "custom")
HF_KEYS = ("hl", "hc", "hr", "fl", "fc", "fr")
DEFAULT = {"orient": "portrait", "paper": "Letter", "margins": "normal", "m": list(MARGINS["normal"]), "area": "", "titleRows": "", "titleCols": "",
           "scale": "none", "pct": 100, "grid": False, "heads": False, "hf": {k: "" for k in HF_KEYS}, "rowBreaks": [], "colBreaks": []}
CELL = re.compile(r"^\$?([A-Za-z]{1,3})\$?(\d{1,7})$")


def clean(raw) -> dict:
    p = raw if isinstance(raw, dict) else {}
    out = {**DEFAULT, "hf": dict(DEFAULT["hf"])}
    if p.get("orient") in ("portrait", "landscape"):
        out["orient"] = p["orient"]
    if p.get("paper") in PAPERS:
        out["paper"] = p["paper"]
    if p.get("margins") in (*MARGINS, "custom"):
        out["margins"] = p["margins"]
    m = p.get("m")
    if out["margins"] == "custom" and isinstance(m, list) and len(m) == 6:
        out["m"] = [max(0.0, min(5.0, float(x))) for x in m]
    else:
        out["m"] = list(MARGINS.get(out["margins"], MARGINS["normal"]))
    out["area"] = str(p.get("area") or "")[:64]
    out["titleRows"] = str(p.get("titleRows") or "")[:32]
    out["titleCols"] = str(p.get("titleCols") or "")[:32]
    if p.get("scale") in SCALES:
        out["scale"] = p["scale"]
    out["pct"] = max(10, min(400, int(p.get("pct") or 100)))
    out["grid"] = bool(p.get("grid"))
    out["heads"] = bool(p.get("heads"))
    hf = p.get("hf") or {}
    for k in HF_KEYS:
        out["hf"][k] = str(hf.get(k) or "")[:255]
    out["rowBreaks"] = sorted({int(x) for x in p.get("rowBreaks") or [] if int(x) > 0})
    out["colBreaks"] = sorted({int(x) for x in p.get("colBreaks") or [] if int(x) > 0})
    return out


def cell_of(text: str) -> tuple[int, int] | None:
    m = CELL.match(text.strip())
    if not m:
        return None
    return int(m.group(2)) - 1, column_index_from_string(m.group(1).upper()) - 1


def area_of(text: str) -> tuple[int, int, int, int] | None:
    text = (text or "").strip().split("!")[-1]
    if not text:
        return None
    a, _, b = text.partition(":")
    p, q = cell_of(a), cell_of(b or a)
    if not p or not q:
        return None
    return min(p[0], q[0]), min(p[1], q[1]), max(p[0], q[0]), max(p[1], q[1])


def rows_of(text: str) -> tuple[int, int] | None:
    m = re.match(r"^\$?(\d+)(?::\$?(\d+))?$", (text or "").strip().split("!")[-1])
    if not m:
        return None
    a, b = int(m.group(1)) - 1, int(m.group(2) or m.group(1)) - 1
    return min(a, b), max(a, b)


def cols_of(text: str) -> tuple[int, int] | None:
    m = re.match(r"^\$?([A-Za-z]{1,3})(?::\$?([A-Za-z]{1,3}))?$", (text or "").strip().split("!")[-1])
    if not m:
        return None
    a = column_index_from_string(m.group(1).upper()) - 1
    b = column_index_from_string((m.group(2) or m.group(1)).upper()) - 1
    return min(a, b), max(a, b)


def code_text(text: str, page: int, pages: int, sheet: str, file: str, today: str) -> str:
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if c == "&" and i + 1 < len(text):
            n = text[i + 1]
            if n == "P":
                out.append(str(page))
            elif n == "N":
                out.append(str(pages))
            elif n == "D":
                out.append(today)
            elif n == "A":
                out.append(sheet)
            elif n == "F":
                out.append(file)
            elif n == "&":
                out.append("&")
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def to_xlsx(ws, raw) -> None:
    p = clean(raw)
    if p == clean({}):
        return
    ws.page_setup.orientation = p["orient"]
    ws.page_setup.paperSize = PAPERS[p["paper"]][2]
    m = p["m"]
    ws.page_margins.top, ws.page_margins.right, ws.page_margins.bottom, ws.page_margins.left, ws.page_margins.header, ws.page_margins.footer = m
    if p["scale"] == "fit-cols":
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    elif p["scale"] == "fit-sheet":
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 1
    elif p["scale"] == "custom":
        ws.page_setup.scale = p["pct"]
    ws.print_options.gridLines = p["grid"]
    ws.print_options.headings = p["heads"]
    a = area_of(p["area"])
    if a:
        ws.print_area = f"{get_column_letter(a[1] + 1)}{a[0] + 1}:{get_column_letter(a[3] + 1)}{a[2] + 1}"
    tr, tc = rows_of(p["titleRows"]), cols_of(p["titleCols"])
    if tr:
        ws.print_title_rows = f"{tr[0] + 1}:{tr[1] + 1}"
    if tc:
        ws.print_title_cols = f"{get_column_letter(tc[0] + 1)}:{get_column_letter(tc[1] + 1)}"
    hf = p["hf"]
    for band, key in ((ws.oddHeader, "h"), (ws.oddFooter, "f")):
        for part, slot in ((band.left, "l"), (band.center, "c"), (band.right, "r")):
            if hf[key + slot]:
                part.text = hf[key + slot]
    for r in p["rowBreaks"]:
        ws.row_breaks.append(Break(id=r))
    for c in p["colBreaks"]:
        ws.col_breaks.append(Break(id=c))


def from_xlsx(ws) -> dict | None:
    p = clean({})
    seen = False
    ps, pm = ws.page_setup, ws.page_margins
    if ps.orientation in ("portrait", "landscape") and ps.orientation != "portrait":
        p["orient"], seen = ps.orientation, True
    if ps.paperSize and int(ps.paperSize) in PAPER_BY_CODE and PAPER_BY_CODE[int(ps.paperSize)] != "Letter":
        p["paper"], seen = PAPER_BY_CODE[int(ps.paperSize)], True
    m = [pm.top, pm.right, pm.bottom, pm.left, pm.header, pm.footer]
    if all(x is not None for x in m):
        m = [round(float(x), 3) for x in m]
        for name, preset in MARGINS.items():
            if all(abs(a - b) < 0.001 for a, b in zip(m, preset)):
                p["margins"] = name
                break
        else:
            p["margins"] = "custom"
            seen = True
        p["m"] = m
        seen = seen or p["margins"] != "normal"
    fit = ws.sheet_properties.pageSetUpPr is not None and ws.sheet_properties.pageSetUpPr.fitToPage
    if fit:
        w, h = ps.fitToWidth if ps.fitToWidth is not None else 1, ps.fitToHeight if ps.fitToHeight is not None else 1
        p["scale"], seen = ("fit-cols" if h == 0 else "fit-sheet"), True
    elif ps.scale and int(ps.scale) != 100:
        p["scale"], p["pct"], seen = "custom", int(ps.scale), True
    if ws.print_options.gridLines:
        p["grid"], seen = True, True
    if ws.print_options.headings:
        p["heads"], seen = True, True
    pa = ws.print_area
    if pa:
        p["area"] = (pa if isinstance(pa, str) else ",".join(pa)).split(",")[0].replace("$", "").split("!")[-1]
        seen = True
    if ws.print_title_rows:
        p["titleRows"], seen = ws.print_title_rows.replace("$", ""), True
    if ws.print_title_cols:
        p["titleCols"], seen = ws.print_title_cols.replace("$", ""), True
    for key, part in (("hl", ws.oddHeader.left), ("hc", ws.oddHeader.center), ("hr", ws.oddHeader.right), ("fl", ws.oddFooter.left), ("fc", ws.oddFooter.center), ("fr", ws.oddFooter.right)):
        if part.text and part.text not in ("&C&R", "&R", "&C"):
            p["hf"][key], seen = part.text, True
    p["rowBreaks"] = [b.id for b in ws.row_breaks.brk if b.id]
    p["colBreaks"] = [b.id for b in ws.col_breaks.brk if b.id]
    seen = seen or bool(p["rowBreaks"] or p["colBreaks"])
    return p if seen else None
