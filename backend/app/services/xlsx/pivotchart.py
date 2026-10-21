import re

from openpyxl.chart.marker import Marker
from openpyxl.chart.pivot import PivotFormat, PivotSource
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.pivot.fields import Index
from openpyxl.pivot.table import ChartFormat, PivotArea, Reference

DATA_FIELD = 4294967294
EXT_URI = "{781A3756-C4B2-4CAC-9D66-4F8BD8637D16}"
NS_C14 = "http://schemas.microsoft.com/office/drawing/2007/8/2/chart"
BOOK = "Book.xlsx"


def _formats(pt, count: int) -> list[ChartFormat]:
    columns = [f.x for f in (pt.colFields or []) if f.x is not None and f.x >= 0]
    datas = max(1, len(pt.dataFields or []))
    out = []
    for s in range(count):
        if columns:
            refs = [Reference(field=columns[0], selected=False, x=[Index(v=s // datas)]), Reference(field=DATA_FIELD, selected=False, x=[Index(v=s % datas)])]
        else:
            refs = [Reference(field=DATA_FIELD, selected=False, x=[Index(v=s % datas)])]
        out.append(ChartFormat(chart=0, format=s, series=True, pivotArea=PivotArea(references=refs, type="data", outline=False, fieldPosition=0, dataOnly=None)))
    return out


def attach(wb, chart, name: str, area: str, series: int) -> bool:
    sheet = area.rpartition("!")[0].strip("'").replace("''", "'")
    ws = next((w for w in wb.worksheets if w.title == sheet), None)
    pt = next((p for p in getattr(ws, "_pivots", []) if p.name == name), None) if ws is not None else None
    if pt is None:
        return False
    chart.pivotSource = PivotSource(name=f"[{BOOK}]{ws.title}!{name}", fmtId=0)
    chart.pivotFormats = [PivotFormat(idx=i, spPr=GraphicalProperties(), marker=Marker(symbol="none")) for i in range(series)]
    pt.chartFormat = 1
    pt.chartFormats = _formats(pt, series)
    return True


def mark(wb, buttons: bool) -> None:
    wb.__dict__.setdefault("_fc_chartflags", []).append(buttons)


def plain(wb) -> None:
    wb.__dict__.setdefault("_fc_chartflags", []).append(None)


def options(buttons: bool, p: str) -> str:
    flag = "1" if buttons else "0"
    return (
        f'<{p}extLst><{p}ext uri="{EXT_URI}" xmlns:c14="{NS_C14}"><c14:pivotOptions>'
        f'<c14:dropZoneFilter val="{flag}"/><c14:dropZoneCategories val="{flag}"/><c14:dropZoneData val="{flag}"/><c14:dropZoneSeries val="{flag}"/><c14:dropZonesVisible val="{flag}"/>'
        f"</c14:pivotOptions></{p}ext></{p}extLst>"
    )


def finish(files: dict[str, bytes], flags: list) -> None:
    for n in range(len(flags)):
        part = f"xl/charts/chart{n + 1}.xml"
        if flags[n] is None or part not in files:
            continue
        xml = files[part].decode("utf-8")
        if "pivotSource" not in xml or EXT_URI in xml:
            continue
        root = re.search(r"<((?:\w+:)?)chartSpace\b", xml)
        end = xml.rfind(f"</{root.group(1)}chartSpace>") if root else -1
        if end < 0:
            continue
        files[part] = (xml[:end] + options(bool(flags[n]), root.group(1)) + xml[end:]).encode("utf-8")


def name_in(chart) -> str | None:
    src = getattr(chart, "pivotSource", None)
    if src is None or not src.name:
        return None
    return src.name.rpartition("!")[2] or None


def unbind(sheets: list[dict], lines: list[str]) -> None:
    known = {line.split("\t")[0] for line in lines}
    for sheet in sheets:
        for obj in sheet.get("objects", []):
            spec = obj.get("chart") or {}
            if spec.get("pivot") and spec["pivot"] not in known:
                spec.pop("pivot", None)
                spec.pop("pivotButtons", None)


def buttons_in(xml: bytes) -> bool:
    text = xml.decode("utf-8", "replace")
    m = re.search(r'<c14:dropZonesVisible val="(\d)"', text)
    return not (m and m.group(1) == "0")
