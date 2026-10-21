import base64
import io
import re
from collections import Counter

from openpyxl.chart import AreaChart, BarChart, BubbleChart, DoughnutChart, LineChart, PieChart, RadarChart, Reference, ScatterChart, Series
from openpyxl.chart.data_source import AxDataSource, NumDataSource, NumRef, StrRef
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.series import SeriesLabel
from openpyxl.drawing.image import Image as XImage
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.utils import get_column_letter, range_boundaries

EMU = 9525
COL_PX = 100
ROW_PX = 24
LEGEND = {"right": "r", "left": "l", "top": "t", "bottom": "b"}
LEGEND_IN = {"r": "right", "l": "left", "t": "top", "b": "bottom", "tr": "right"}
EXPORTED = {"column", "column-stacked", "bar", "bar-stacked", "line", "area", "pie", "doughnut", "scatter", "bubble", "combo", "radar"}


def _sizes(view: dict, key: str, default: int) -> dict[int, int]:
    return {int(i): int(px) for i, px in (view.get(key) or {}).get("sizes", [])}


def _locate(sizes: dict[int, int], default: int, px: float) -> tuple[int, int]:
    i = 0
    acc = 0.0
    while True:
        s = sizes.get(i, default)
        if acc + s > px or i > 20000:
            return i, int((px - acc) * EMU)
        acc += s
        i += 1


def _offset(sizes: dict[int, int], default: int, index: int) -> float:
    return float(sum(sizes.get(i, default) for i in range(index)))


def _anchor(obj: dict, view: dict) -> OneCellAnchor:
    cs = _sizes(view, "cols", COL_PX)
    rs = _sizes(view, "rows", ROW_PX)
    col, coff = _locate(cs, COL_PX, max(0, obj.get("x", 0)))
    row, roff = _locate(rs, ROW_PX, max(0, obj.get("y", 0)))
    return OneCellAnchor(_from=AnchorMarker(col=col, colOff=coff, row=row, rowOff=roff), ext=XDRPositiveSize2D(int(obj.get("w", 400) * EMU), int(obj.get("h", 250) * EMU)))


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _layout(ws, bounds: tuple[int, int, int, int], by_rows: bool, scatter: bool) -> dict:
    c0, r0, c1, r1 = bounds
    grid = [[ws.cell(row=r, column=c).value for c in range(c0, c1 + 1)] for r in range(r0, r1 + 1)]
    if by_rows:
        grid = [list(x) for x in zip(*grid)] if grid else grid
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    body = grid[1:]
    text = lambda v: isinstance(v, str) and v != ""
    labels = scatter or (cols > 1 and bool(body) and sum(1 for r in body if text(r[0])) > len(body) / 2 and not any(_num(r[0]) for r in body))
    first_row = grid[0][1 if labels else 0:] if rows else []
    header = rows > 1 and bool(first_row) and all(not _num(v) for v in first_row) and any(v not in (None, "") for v in first_row)
    return {"labels": labels, "header": header, "rows": rows, "cols": cols}


def _ref(ws, by_rows: bool, bounds: tuple[int, int, int, int], line: int, lo: int, hi: int) -> Reference:
    c0, r0, c1, r1 = bounds
    if by_rows:
        return Reference(ws, min_col=c0 + lo, max_col=c0 + hi, min_row=r0 + line, max_row=r0 + line)
    return Reference(ws, min_col=c0 + line, max_col=c0 + line, min_row=r0 + lo, max_row=r0 + hi)


def _cell_ref(ws, by_rows: bool, bounds: tuple[int, int, int, int], line: int, pos: int) -> str:
    c0, r0, _, _ = bounds
    col, row = (c0 + pos, r0 + line) if by_rows else (c0 + line, r0 + pos)
    return f"'{ws.title}'!${get_column_letter(col)}${row}"


def chart_out(wb, host, obj: dict, view: dict) -> bool:
    spec = obj.get("chart") or {}
    kind = spec.get("type", "column")
    if kind not in EXPORTED:
        return False
    text = str(spec.get("range", "")).strip().lstrip("=")
    if "!" not in text and text in wb.defined_names:
        text = str(wb.defined_names[text].attr_text or "").lstrip("=")
    ws = host
    if "!" in text:
        name, text = text.rsplit("!", 1)
        name = name.strip("'").replace("''", "'")
        if name not in wb.sheetnames:
            return False
        ws = wb[name]
    try:
        bounds = range_boundaries(text.replace("$", ""))
    except ValueError:
        return False
    if None in bounds:
        return False
    c0, r0, c1, r1 = bounds
    by_rows = bool(spec.get("byRows"))
    scatter = kind in ("scatter", "bubble")
    lay = _layout(ws, bounds, by_rows, scatter)
    if lay["rows"] < 1 or lay["cols"] < 1:
        return False
    first = 1 if lay["labels"] else 0
    lo = 1 if lay["header"] else 0
    hi = lay["rows"] - 1
    if hi < lo:
        return False
    nser = lay["cols"] - first
    if nser < 1:
        return False
    secondary = set(spec.get("secondary") or [])
    if kind == "combo" and not secondary and nser > 1:
        secondary = {nser - 1}

    def series(j: int):
        line = first + j
        vals = _ref(ws, by_rows, bounds, line, lo, hi)
        s = Series(vals, title=None)
        if lay["header"]:
            s.tx = SeriesLabel(strRef=StrRef(_cell_ref(ws, by_rows, bounds, line, 0)))
        return s

    def attach(chart, indices) -> None:
        cats = _ref(ws, by_rows, bounds, 0, lo, hi) if lay["labels"] else None
        for j in indices:
            s = series(j)
            if scatter and cats is not None:
                s.xVal = AxDataSource(numRef=NumRef(f=str(cats)))
            chart.series.append(s)
        if cats is not None and not scatter:
            chart.set_categories(cats)

    if kind in ("column", "column-stacked", "bar", "bar-stacked", "combo"):
        chart = BarChart()
        chart.type = "bar" if kind.startswith("bar") else "col"
        if kind.endswith("stacked"):
            chart.grouping = "stacked"
            chart.overlap = 100
        main = [j for j in range(nser) if j not in secondary] if kind == "combo" else list(range(nser))
        attach(chart, main)
        if kind == "combo" and secondary:
            top = LineChart()
            attach(top, sorted(secondary))
            top.y_axis.axId = 200
            top.y_axis.crosses = "max"
            top.y_axis.delete = False
            chart += top
    elif kind == "line":
        chart = LineChart()
        attach(chart, range(nser))
    elif kind == "area":
        chart = AreaChart()
        attach(chart, range(nser))
    elif kind in ("pie", "doughnut"):
        chart = PieChart() if kind == "pie" else DoughnutChart()
        attach(chart, [0])
    elif kind == "scatter":
        chart = ScatterChart()
        chart.style = 13
        attach(chart, range(nser))
    elif kind == "bubble":
        chart = BubbleChart()
        if nser >= 2:
            cats = _ref(ws, by_rows, bounds, 0, lo, hi)
            from openpyxl.chart.series import XYSeries

            s = XYSeries()
            s.xVal = AxDataSource(numRef=NumRef(f=str(cats)))
            s.yVal = NumDataSource(numRef=NumRef(f=str(_ref(ws, by_rows, bounds, first, lo, hi))))
            s.bubbleSize = NumDataSource(numRef=NumRef(f=str(_ref(ws, by_rows, bounds, first + 1, lo, hi))))
            chart.series.append(s)
        else:
            return False
    else:
        chart = RadarChart()
        attach(chart, range(nser))
    if spec.get("title"):
        chart.title = spec["title"]
    if hasattr(chart, "x_axis") and kind not in ("pie", "doughnut"):
        chart.x_axis.delete = False
        chart.y_axis.delete = False
        if spec.get("xTitle"):
            chart.x_axis.title = spec["xTitle"]
        if spec.get("yTitle"):
            chart.y_axis.title = spec["yTitle"]
        if spec.get("min") is not None:
            chart.y_axis.scaling.min = spec["min"]
        if spec.get("max") is not None:
            chart.y_axis.scaling.max = spec["max"]
    legend = spec.get("legend", "right")
    if legend == "none":
        chart.legend = None
    elif chart.legend is not None:
        chart.legend.position = LEGEND.get(legend, "r")
    if spec.get("labels"):
        chart.dataLabels = DataLabelList()
        chart.dataLabels.showVal = True
    chart.anchor = _anchor(obj, view)
    host.add_chart(chart)
    return True


def picture_out(host, obj: dict, view: dict) -> bool:
    pic = obj.get("picture") or {}
    m = re.match(r"data:image/(png|jpeg|gif|bmp|webp);base64,(.*)$", str(pic.get("src", "")), re.S)
    if not m:
        return False
    try:
        img = XImage(io.BytesIO(base64.b64decode(m.group(2))))
    except Exception:
        return False
    img.width, img.height = int(obj.get("w", 200)), int(obj.get("h", 150))
    img.anchor = _anchor(obj, view)
    host.add_image(img)
    return True


def objects_out(wb, ws, objects: list[dict], view: dict, notes: Counter | None = None) -> None:
    for obj in objects:
        kind = obj.get("kind")
        ok = chart_out(wb, ws, obj, view) if kind == "chart" else picture_out(ws, obj, view) if kind == "picture" else False
        if not ok and notes is not None:
            notes[kind or "object"] += 1


def _refs(text: str) -> tuple[str | None, tuple[int, int, int, int]] | None:
    m = re.match(r"^(?:'((?:[^']|'')+)'|([^!']+))!(.+)$", text or "")
    if not m:
        return None
    name = (m.group(1) or m.group(2)).replace("''", "'")
    try:
        c0, r0, c1, r1 = range_boundaries(m.group(3).replace("$", ""))
    except ValueError:
        return None
    if None in (c0, r0, c1, r1):
        return None
    return name, (c0, r0, c1, r1)


def _px_from_anchor(anchor, view: dict) -> tuple[int, int, int, int]:
    cs = _sizes(view, "cols", COL_PX)
    rs = _sizes(view, "rows", ROW_PX)
    f = anchor._from
    x = _offset(cs, COL_PX, f.col) + f.colOff / EMU
    y = _offset(rs, ROW_PX, f.row) + f.rowOff / EMU
    if hasattr(anchor, "to") and anchor.to is not None:
        t = anchor.to
        w = _offset(cs, COL_PX, t.col) + t.colOff / EMU - x
        h = _offset(rs, ROW_PX, t.row) + t.rowOff / EMU - y
    elif getattr(anchor, "ext", None) is not None:
        w, h = anchor.ext.width / EMU, anchor.ext.height / EMU
    else:
        w, h = 480, 300
    return int(x), int(y), max(40, int(w)), max(40, int(h))


def _title_text(t) -> str:
    try:
        return "".join(r.t for p in t.tx.rich.p for r in (p.r or []))
    except AttributeError:
        return ""


def chart_in(ch, ws_title: str, view: dict) -> dict | None:
    sers = list(ch.series)
    if not sers:
        return None
    kind = ch.tagname
    if kind == "barChart":
        spec_type = ("bar" if ch.type == "bar" else "column") + ("-stacked" if ch.grouping in ("stacked", "percentStacked") else "")
    else:
        spec_type = {"lineChart": "line", "line3DChart": "line", "areaChart": "area", "pieChart": "pie", "pie3DChart": "pie", "doughnutChart": "doughnut", "scatterChart": "scatter", "bubbleChart": "bubble", "radarChart": "radar"}.get(kind)
    if not spec_type:
        return None
    boxes: list[tuple[int, int, int, int]] = []
    sheet = None
    by_rows = False
    for s in sers:
        refs = []
        if s.tx is not None and s.tx.strRef is not None:
            refs.append(s.tx.strRef.f)
        for src in (getattr(s, "cat", None), getattr(s, "xVal", None)):
            if src is not None:
                refs.append((src.numRef or src.strRef).f if (src.numRef or src.strRef) else None)
        for src in (getattr(s, "val", None), getattr(s, "yVal", None), getattr(s, "bubbleSize", None)):
            if src is not None and src.numRef is not None:
                refs.append(src.numRef.f)
        for r in refs:
            got = _refs(r) if r else None
            if got:
                sheet = sheet or got[0]
                boxes.append(got[1])
    if not boxes:
        return None
    val = _refs(sers[0].val.numRef.f) if getattr(sers[0], "val", None) is not None and sers[0].val.numRef is not None else None
    if val:
        c0, r0, c1, r1 = val[1]
        by_rows = r0 == r1 and c1 > c0
    c0 = min(b[0] for b in boxes)
    r0 = min(b[1] for b in boxes)
    c1 = max(b[2] for b in boxes)
    r1 = max(b[3] for b in boxes)
    rng = f"{get_column_letter(c0)}{r0}:{get_column_letter(c1)}{r1}"
    if sheet and sheet != ws_title:
        rng = f"'{sheet.replace(chr(39), chr(39) * 2)}'!{rng}"
    legend = LEGEND_IN.get(ch.legend.position, "right") if ch.legend is not None else "none"
    xt = _title_text(ch.x_axis.title) if getattr(ch, "x_axis", None) is not None and ch.x_axis.title is not None else ""
    yt = _title_text(ch.y_axis.title) if getattr(ch, "y_axis", None) is not None and ch.y_axis.title is not None else ""
    x, y, w, h = _px_from_anchor(ch.anchor, view)
    return {"kind": "chart", "x": x, "y": y, "w": w, "h": h, "chart": {"type": spec_type, "range": rng, "byRows": by_rows, "title": _title_text(ch.title) if ch.title is not None else "", "xTitle": xt, "yTitle": yt, "legend": legend, "labels": bool(ch.dataLabels is not None and ch.dataLabels.showVal), "secondary": []}}


def objects_in(ws, view: dict, notes: Counter) -> list[dict]:
    out: list[dict] = []
    for i, ch in enumerate(getattr(ws, "_charts", []) or []):
        item = chart_in(ch, ws.title, view)
        if item is None:
            notes["charts of a type FormCel does not draw left out"] += 1
            continue
        item["id"] = f"x{id(ws) % 10**6}c{i}"
        out.append(item)
    for i, im in enumerate(getattr(ws, "_images", []) or []):
        try:
            data = im._data()
            fmt = (im.format or "png").lower()
            fmt = "jpeg" if fmt == "jpg" else fmt
            x, y, w, h = _px_from_anchor(im.anchor, view)
        except Exception:
            notes["pictures FormCel could not read left out"] += 1
            continue
        out.append({"id": f"x{id(ws) % 10**6}p{i}", "kind": "picture", "x": x, "y": y, "w": w, "h": h, "picture": {"src": f"data:image/{fmt};base64,{base64.b64encode(data).decode()}", "name": f"picture{i + 1}.{fmt}"}})
    return out
