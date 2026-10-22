import re

from openpyxl.chart.axis import ChartLines
from openpyxl.chart.data_source import NumFmt
from openpyxl.chart.error_bar import ErrorBars
from openpyxl.chart.marker import DataPoint, Marker
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.trendline import Trendline

TREND_OUT = {"linear": "linear", "exp": "exp", "log": "log", "poly": "poly", "power": "power", "mavg": "movingAvg"}
TREND_IN = {v: k for k, v in TREND_OUT.items()}
ERR_OUT = {"fixed": "fixedVal", "percent": "percentage", "stdev": "stdDev", "sterr": "stdErr"}
ERR_IN = {v: k for k, v in ERR_OUT.items()}
LINE_KINDS = {"line", "scatter", "radar", "combo-line"}
POINT_KINDS = {"pie", "doughnut"}


def hex6(value) -> str | None:
    s = str(value or "").strip().lstrip("#")
    return s.upper() if re.fullmatch(r"[0-9a-fA-F]{6}", s) else None


def _color(spec: dict, j: int) -> str | None:
    colors = spec.get("colors") or []
    return hex6(colors[j]) if j < len(colors) else None


def series_out(s, j: int, spec: dict, kind: str, line: bool) -> None:
    if kind not in POINT_KINDS:
        c = _color(spec, j)
        if c:
            if s.graphicalProperties is None:
                s.graphicalProperties = GraphicalProperties()
            if line:
                s.graphicalProperties.line.solidFill = c
                s.graphicalProperties.line.width = 28575
                s.marker = Marker(symbol="circle", size=6)
                s.marker.graphicalProperties = GraphicalProperties(solidFill=c)
                s.marker.graphicalProperties.line.solidFill = c
            else:
                s.graphicalProperties.solidFill = c
                s.graphicalProperties.line.solidFill = c
    if kind in POINT_KINDS:
        points = []
        for i, raw in enumerate(spec.get("colors") or []):
            c = hex6(raw)
            if c:
                pt = DataPoint(idx=i)
                pt.graphicalProperties = GraphicalProperties(solidFill=c)
                points.append(pt)
        if points:
            s.dPt = points
    if kind in POINT_KINDS:
        return
    for t in spec.get("trends") or []:
        if t.get("series", -1) not in (j, -1) and t.get("series", -1) >= 0:
            continue
        ty = TREND_OUT.get(t.get("kind", "linear"), "linear")
        tl = Trendline(trendlineType=ty, dispEq=bool(t.get("eq")), dispRSqr=bool(t.get("r2")))
        if ty == "poly":
            tl.order = max(2, min(6, int(t.get("order") or 2)))
        if ty == "movingAvg":
            tl.period = max(2, int(t.get("period") or 2))
        s.trendline = tl
        break
    for e in spec.get("errBars") or []:
        if (e.get("series", -1) >= 0 and e.get("series") != j) or e.get("kind") == "column":
            continue
        ty = ERR_OUT.get(e.get("kind", "fixed"), "fixedVal")
        eb = ErrorBars(errDir="y", errBarType=e.get("dir", "both") if e.get("dir") in ("both", "plus", "minus") else "both", errValType=ty, noEndCap=False)
        eb.val = float(e.get("value", 1))
        s.errBars = eb
        break


def _numfmt(axis, code) -> None:
    code = str(code or "").strip()
    if code:
        axis.numFmt = NumFmt(formatCode=code, sourceLinked=False)


def chart_out(chart, spec: dict, kind: str, extra=()) -> None:
    if kind not in POINT_KINDS and hasattr(chart, "y_axis"):
        _numfmt(chart.y_axis, spec.get("yFmt"))
        _numfmt(chart.x_axis, spec.get("xFmt"))
        if spec.get("logY"):
            chart.y_axis.scaling.logBase = 10
        if spec.get("grid") is False:
            chart.y_axis.majorGridlines = None
        if spec.get("xGrid"):
            chart.x_axis.majorGridlines = ChartLines()
        elif kind in ("scatter", "bubble"):
            chart.x_axis.majorGridlines = None
        for other in extra:
            _numfmt(other.y_axis, spec.get("yFmt"))
    fmt = str(spec.get("labelFmt") or "").strip()
    if fmt and spec.get("labels") and chart.dataLabels is not None:
        chart.dataLabels.numFmt = fmt
    fill = hex6(spec.get("fill"))
    if fill:
        chart.graphical_properties = GraphicalProperties(solidFill=fill)
    plot = hex6(spec.get("plotFill"))
    if plot:
        chart.plot_area.graphicalProperties = GraphicalProperties(solidFill=plot)


def _rgb(cc) -> str | None:
    if cc is None:
        return None
    v = getattr(cc, "srgbClr", None)
    if isinstance(v, str):
        return "#" + v[-6:].lower() if len(v) >= 6 else None
    return None


def _series_color(s, line: bool) -> str | None:
    gp = s.graphicalProperties
    if gp is None:
        return None
    if line:
        return _rgb(gp.line.solidFill) if gp.line is not None else None
    return _rgb(gp.solidFill) or (_rgb(gp.line.solidFill) if gp.line is not None else None)


def chart_in(ch, spec: dict, all_series: list, kind: str) -> None:
    line = kind in LINE_KINDS
    colors: list[str] = []
    if kind in POINT_KINDS:
        s0 = all_series[0] if all_series else None
        for pt in (getattr(s0, "dPt", None) or []):
            c = _rgb(pt.graphicalProperties.solidFill) if pt.graphicalProperties is not None else None
            if c:
                while len(colors) <= pt.idx:
                    colors.append("")
                colors[pt.idx] = c
    else:
        for s in all_series:
            colors.append(_series_color(s, line) or "")
    while colors and not colors[-1]:
        colors.pop()
    if colors:
        spec["colors"] = colors
    trends = []
    errs = []
    for j, s in enumerate(all_series):
        tl = getattr(s, "trendline", None)
        if tl is not None and tl.trendlineType in TREND_IN:
            t = {"series": j, "kind": TREND_IN[tl.trendlineType]}
            if tl.order:
                t["order"] = int(tl.order)
            if tl.period:
                t["period"] = int(tl.period)
            if tl.dispEq:
                t["eq"] = True
            if tl.dispRSqr:
                t["r2"] = True
            trends.append(t)
        eb = getattr(s, "errBars", None)
        if eb is not None and eb.errValType in ERR_IN and (eb.errDir in (None, "y")):
            errs.append({"series": j, "kind": ERR_IN[eb.errValType], "value": float(eb.val if eb.val is not None else 1), "dir": eb.errBarType or "both"})
    if trends:
        spec["trends"] = _collapse(trends, len(all_series))
    if errs:
        spec["errBars"] = _collapse(errs, len(all_series))
    ya = getattr(ch, "y_axis", None)
    xa = getattr(ch, "x_axis", None)
    if ya is not None and kind not in POINT_KINDS:
        if ya.numFmt is not None and ya.numFmt.formatCode and not ya.numFmt.sourceLinked and ya.numFmt.formatCode != "General":
            spec["yFmt"] = ya.numFmt.formatCode
        if ya.scaling is not None:
            if ya.scaling.logBase:
                spec["logY"] = True
            if ya.scaling.min is not None:
                spec["min"] = float(ya.scaling.min)
            if ya.scaling.max is not None:
                spec["max"] = float(ya.scaling.max)
        if ya.majorGridlines is None:
            spec["grid"] = False
    if xa is not None and kind not in POINT_KINDS:
        if xa.numFmt is not None and xa.numFmt.formatCode and not xa.numFmt.sourceLinked and xa.numFmt.formatCode != "General":
            spec["xFmt"] = xa.numFmt.formatCode
        if xa.majorGridlines is not None:
            spec["xGrid"] = True
    dl = ch.dataLabels
    if dl is None:
        dl = next((s.dLbls for s in all_series if getattr(s, "dLbls", None) is not None), None)
    if dl is not None and dl.numFmt:
        spec["labelFmt"] = dl.numFmt if isinstance(dl.numFmt, str) else getattr(dl.numFmt, "formatCode", "")
        if not spec["labelFmt"] or spec["labelFmt"] == "General":
            spec.pop("labelFmt")
    gp = getattr(ch, "graphical_properties", None)
    fill = _rgb(gp.solidFill) if gp is not None else None
    if fill:
        spec["fill"] = fill


def _collapse(items: list[dict], count: int) -> list[dict]:
    if count > 1 and len(items) == count:
        first = {k: v for k, v in items[0].items() if k != "series"}
        if all({k: v for k, v in i.items() if k != "series"} == first for i in items):
            return [{"series": -1, **first}]
    return items
