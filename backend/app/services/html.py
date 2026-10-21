from html import escape

from openpyxl.utils import get_column_letter

from . import page as pg
from .pdf import SLOTS, _colour, _style
from .xlsx.autofilter import filtered_rows

COL_PX, ROW_PX = 100, 24


def _hex(rgb: tuple[float, float, float]) -> str:
    return "#" + "".join(f"{round(max(0.0, min(1.0, x)) * 255):02x}" for x in rgb)


def _css(st: dict, slots: dict[str, str], num: bool) -> str:
    out = []
    if st.get("b"):
        out.append("font-weight:700")
    if st.get("i"):
        out.append("font-style:italic")
    deco = [d for k, d in (("u", "underline"), ("s", "line-through")) if st.get(k)]
    if deco:
        out.append("text-decoration:" + " ".join(deco))
    if st.get("sz"):
        out.append(f"font-size:{st['sz']:g}pt")
    if st.get("fc"):
        out.append("color:" + _hex(_colour(st["fc"], slots)))
    if st.get("bg"):
        out.append("background:" + _hex(_colour(st["bg"], slots)))
    ha = st.get("ha") or ("right" if num else "")
    if ha:
        out.append(f"text-align:{ha}")
    if st.get("va"):
        out.append("vertical-align:" + {"middle": "middle", "top": "top", "bottom": "bottom"}.get(st["va"], "bottom"))
    if st.get("wrap"):
        out.append("white-space:pre-wrap")
    for k, side in (("bt", "top"), ("br", "right"), ("bb", "bottom"), ("bl", "left")):
        if k in st.get("borders", {}):
            line, colr = st["borders"][k]
            style = {"dashed": "dashed", "dotted": "dotted", "double": "double"}.get(line, "solid")
            width = {"medium": 2, "thick": 3, "double": 3}.get(line, 1)
            out.append(f"border-{side}:{width}px {style} {_hex(_colour(colr, slots))}")
    return ";".join(out)


def _table(eng, i: int, view: dict, slots: dict[str, str]) -> str:
    values = {(r, c): v for r, c, v in eng.values(i) if v != ""}
    kinds = {(r, c): k for r, c, k, _ in eng.typed(i)}
    kinds.update({(r, c): k for r, c, k, _ in eng.results(i)})
    styled = {(r, c) for r, c, _ in eng.styles(i)}
    merges = {(r0, c0): (r1, c1) for r0, c0, r1, c1 in eng.merges(i)}
    keys = set(values) | styled | {(r1, c1) for r1, c1 in merges.values()}
    if not keys:
        return "<p>This sheet is empty.</p>"
    nrows = max(r for r, _ in keys) + 1
    ncols = max(c for _, c in keys) + 1
    covered = {(r, c) for (r0, c0), (r1, c1) in merges.items() for r in range(r0, r1 + 1) for c in range(c0, c1 + 1) if (r, c) != (r0, c0)}
    colpx = dict((view.get("cols") or {}).get("sizes", []))
    rowpx = dict((view.get("rows") or {}).get("sizes", []))
    hidden_c = set((view.get("cols") or {}).get("hidden", []))
    hidden_r = set((view.get("rows") or {}).get("hidden", [])) | filtered_rows(eng.filter(i))
    cols = [c for c in range(ncols) if c not in hidden_c]
    out = ["<table><colgroup>"]
    out += [f'<col style="width:{colpx.get(c, COL_PX)}px">' for c in cols]
    out.append("</colgroup><tbody>")
    for r in range(nrows):
        if r in hidden_r:
            continue
        h = rowpx.get(r)
        out.append(f'<tr style="height:{h}px">' if h else "<tr>")
        for c in cols:
            if (r, c) in covered:
                continue
            st = _style(eng.effective_style(f"{get_column_letter(c + 1)}{r + 1}", i)) if (r, c) in styled else {"borders": {}}
            num = kinds.get((r, c)) == "n"
            span = ""
            if (r, c) in merges:
                r1, c1 = merges[(r, c)]
                rs = sum(1 for x in range(r, r1 + 1) if x not in hidden_r)
                cs = sum(1 for x in range(c, c1 + 1) if x not in hidden_c)
                span = (f' rowspan="{rs}"' if rs > 1 else "") + (f' colspan="{cs}"' if cs > 1 else "")
            css = _css(st, slots, num)
            text = escape(values.get((r, c), "")).replace("\n", "<br>") if not st.get("wrap") else escape(values.get((r, c), ""))
            out.append(f'<td{span}{f" style={chr(34)}{css}{chr(34)}" if css else ""}>{text}</td>')
        out.append("</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def write(eng, views: list[dict], sheets: list[int], title: str) -> str:
    theme = eng.theme().split(";")
    slots = dict(zip(SLOTS, (theme[1] if len(theme) > 1 else "").split(",")))
    names = eng.sheet_names()
    body = []
    for i in sheets:
        view = views[i] if i < len(views) else {}
        body.append(f'<section id="sheet-{i + 1}"><h2>{escape(names[i])}</h2>{_table(eng, i, view, slots)}</section>')
    nav = ""
    if len(sheets) > 1:
        nav = "<nav aria-label=\"Sheets\">" + " ".join(f'<a href="#sheet-{i + 1}">{escape(names[i])}</a>' for i in sheets) + "</nav>"
    head = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(title)}</title>"
        "<meta name=\"generator\" content=\"FormCel\"><style>"
        "body{font-family:Calibri,Arial,sans-serif;margin:24px;color:#111;background:#fff}"
        "h1{font-size:20px}h2{font-size:16px;margin-top:28px}nav a{margin-right:12px}"
        "table{border-collapse:collapse;table-layout:fixed;font-size:11pt}"
        "td{border:1px solid #d4d4d4;padding:2px 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;vertical-align:bottom}"
        "</style></head><body>"
    )
    return f"{head}<h1>{escape(title)}</h1>{nav}{''.join(body)}</body></html>"
