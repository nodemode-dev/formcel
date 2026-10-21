import base64
import json
import re
import uuid
import zipfile
from html import unescape
from io import BytesIO
from types import SimpleNamespace
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

from openpyxl.utils import get_column_letter, range_boundaries

NS_CX = "http://schemas.microsoft.com/office/drawing/2014/chartex"
NS_CX1 = "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
REL_CHARTEX = "http://schemas.microsoft.com/office/2014/relationships/chartEx"
REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"
CT_CHARTEX = "application/vnd.ms-office.chartex+xml"
CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml"

EMU = 9525
LAYOUT = {"histogram": "clusteredColumn", "box": "boxWhisker", "waterfall": "waterfall", "funnel": "funnel", "treemap": "treemap", "sunburst": "sunburst", "map": "regionMap"}
TYPE_OF = {v: k for k, v in LAYOUT.items()}
TYPE_OF["pareto"] = "histogram"
CHARTEX = set(LAYOUT)
TAGGED = {"gauge", "scorecard", "org", "timeline"}
TAG_ATTR = "fcspec:"
LEGEND_POS = {"right": "r", "left": "l", "top": "t", "bottom": "b"}
LEGEND_BACK = {"r": "right", "l": "left", "t": "top", "b": "bottom"}
TOTAL_WORDS = re.compile(r"total|net|sum|end", re.I)


def _q(name: str) -> str:
    return "'" + name.replace("'", "''") + "'"


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _hex(v) -> str | None:
    s = str(v or "").strip().lstrip("#")
    return s.upper() if re.fullmatch(r"[0-9a-fA-F]{6}", s) else None


def _fill(color: str) -> str:
    return f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'


def _text_pts(values: list) -> str:
    return "".join(f'<cx:pt idx="{i}">{escape(str(v))}</cx:pt>' for i, v in enumerate(values) if v not in (None, ""))


def _num_pts(values: list) -> str:
    return "".join(f'<cx:pt idx="{i}">{v!r}</cx:pt>' for i, v in enumerate(values) if _num(v))


class Source:
    def __init__(self, ws, bounds: tuple[int, int, int, int], by_rows: bool, lo: int, hi: int):
        self.ws = ws
        self.c0, self.r0, self.c1, self.r1 = bounds
        self.by_rows = by_rows
        self.lo = lo
        self.hi = hi

    def cell(self, line: int, pos: int):
        col, row = (self.c0 + pos, self.r0 + line) if self.by_rows else (self.c0 + line, self.r0 + pos)
        return self.ws.cell(row=row, column=col)

    def values(self, line: int) -> list:
        out = []
        for pos in range(self.lo, self.hi + 1):
            v = self.cell(line, pos).value
            out.append(None if isinstance(v, str) and v.startswith("=") else v)
        return out

    def ref(self, line_a: int, line_b: int | None = None) -> str:
        b = line_a if line_b is None else line_b
        if self.by_rows:
            a1 = f"${get_column_letter(self.c0 + self.lo)}${self.r0 + line_a}"
            a2 = f"${get_column_letter(self.c0 + self.hi)}${self.r0 + b}"
        else:
            a1 = f"${get_column_letter(self.c0 + line_a)}${self.r0 + self.lo}"
            a2 = f"${get_column_letter(self.c0 + b)}${self.r0 + self.hi}"
        return f"{_q(self.ws.title)}!{a1}:{a2}"

    def head_ref(self, line: int) -> str:
        col, row = (self.c0, self.r0 + line) if self.by_rows else (self.c0 + line, self.r0)
        return f"{_q(self.ws.title)}!${get_column_letter(col)}${row}"

    def dim_attr(self) -> str:
        return ' dir="row"' if self.by_rows else ""


def _num_dim(src: Source, kind: str, line: int) -> str:
    vals = src.values(line)
    return f'<cx:numDim type="{kind}"><cx:f{src.dim_attr()}>{escape(src.ref(line))}</cx:f><cx:lvl ptCount="{len(vals)}" formatCode="General">{_num_pts(vals)}</cx:lvl></cx:numDim>'


def _str_dim(src: Source, kind: str, first: int, last: int) -> str:
    lvls = ""
    for line in range(last, first - 1, -1):
        vals = src.values(line)
        lvls += f'<cx:lvl ptCount="{len(vals)}">{_text_pts(vals)}</cx:lvl>'
    return f'<cx:strDim type="{kind}"><cx:f{src.dim_attr()}>{escape(src.ref(first, last))}</cx:f>{lvls}</cx:strDim>'


def leading_text(src: Source, width: int) -> int:
    k = 0
    while k < width:
        vals = [v for v in src.values(k) if v not in (None, "")]
        if not vals or any(_num(v) for v in vals):
            break
        k += 1
    return k


def _title(text: str) -> str:
    return f'<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>{escape(text)}</cx:v></cx:txData></cx:tx></cx:title>'


def _axis_title(text: str) -> str:
    return f'<cx:title pos="b" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>{escape(text)}</cx:v></cx:txData></cx:tx></cx:title>' if text else ""


def build(kind: str, spec: dict, ws, bounds: tuple[int, int, int, int], by_rows: bool, lay: dict) -> str | None:
    first = 1 if lay["labels"] else 0
    lo = 1 if lay["header"] else 0
    hi = lay["rows"] - 1
    if hi < lo:
        return None
    src = Source(ws, bounds, by_rows, lo, hi)
    width = lay["cols"]
    nser = width - first
    if nser < 1 and kind != "histogram":
        return None
    data: list[str] = []
    series: list[str] = []
    colors = [_hex(c) for c in (spec.get("colors") or [])]
    label_fmt = str(spec.get("labelFmt") or "").strip()
    labels = bool(spec.get("labels"))

    def tx(line: int) -> str:
        if not lay["header"]:
            return ""
        v = src.cell(line, 0).value
        return f'<cx:tx><cx:txData><cx:f>{escape(src.head_ref(line))}</cx:f><cx:v>{escape("" if v is None else str(v))}</cx:v></cx:txData></cx:tx>'

    def sppr(i: int) -> str:
        c = colors[i] if i < len(colors) else None
        return f"<cx:spPr>{_fill(c)}</cx:spPr>" if c else ""

    def dlabels(pos: str, cat: bool = False, val: bool = True) -> str:
        if not labels:
            return ""
        fmt = f'<cx:numFmt formatCode="{escape(label_fmt, {chr(34): "&quot;"})}" sourceLinked="0"/>' if label_fmt else ""
        return f'<cx:dataLabels pos="{pos}">{fmt}<cx:visibility seriesName="0" categoryName="{int(cat)}" value="{int(val)}"/></cx:dataLabels>'

    def sid() -> str:
        return "{" + str(uuid.uuid4()).upper() + "}"

    layout = LAYOUT[kind]
    axes = ""
    gap = {"histogram": "0", "waterfall": "0.5", "box": "1", "funnel": "0.06"}.get(kind)
    if kind in ("histogram", "box"):
        count = 1 if kind == "histogram" else max(1, nser)
        for j in range(count):
            line = first + j
            data.append(f'<cx:data id="{j}">{_num_dim(src, "val", line)}</cx:data>')
            if kind == "histogram":
                bins = spec.get("bins")
                if bins:
                    pr = f'<cx:layoutPr><cx:binning intervalClosed="r"><cx:binCount val="{int(bins)}"/></cx:binning></cx:layoutPr>'
                else:
                    pr = '<cx:layoutPr><cx:binning intervalClosed="r"/></cx:layoutPr>'
            else:
                pr = '<cx:layoutPr><cx:visibility meanLine="0" meanMarker="1" nonoutliers="0" outliers="1"/><cx:statistics quartileMethod="exclusive"/></cx:layoutPr>'
            series.append(f'<cx:series layoutId="{layout}" uniqueId="{sid()}">{tx(line)}{sppr(j)}{dlabels("outEnd")}<cx:dataId val="{j}"/>{pr}</cx:series>')
    elif kind in ("waterfall", "funnel"):
        cat = _str_dim(src, "cat", 0, 0) if lay["labels"] else ""
        data.append(f'<cx:data id="0">{cat}{_num_dim(src, "val", first)}</cx:data>')
        pr = ""
        if kind == "waterfall":
            names = src.values(0) if lay["labels"] else []
            totals = spec.get("totals")
            if totals is None:
                totals = [i for i, n in enumerate(names) if i > 0 and isinstance(n, str) and TOTAL_WORDS.search(n)]
            if totals:
                pr = "<cx:layoutPr><cx:subtotals>" + "".join(f'<cx:idx val="{int(i)}"/>' for i in totals) + "</cx:subtotals></cx:layoutPr>"
        series.append(f'<cx:series layoutId="{layout}" uniqueId="{sid()}">{tx(first)}{sppr(0)}{dlabels("outEnd" if kind == "waterfall" else "ctr", cat=kind == "funnel")}<cx:dataId val="0"/>{pr}</cx:series>')
    elif kind in ("treemap", "sunburst"):
        k = leading_text(src, width)
        if k < 1:
            return None
        if k >= width:
            return None
        data.append(f'<cx:data id="0">{_str_dim(src, "cat", 0, k - 1)}{_num_dim(src, "size", k)}</cx:data>')
        pr = '<cx:layoutPr><cx:parentLabelLayout val="overlapping"/></cx:layoutPr>' if kind == "treemap" else ""
        series.append(f'<cx:series layoutId="{layout}" uniqueId="{sid()}">{tx(k)}{sppr(0)}{dlabels("ctr", cat=True, val=False)}<cx:dataId val="0"/>{pr}</cx:series>')
    elif kind == "map":
        if not lay["labels"]:
            return None
        data.append(f'<cx:data id="0">{_str_dim(src, "cat", 0, 0)}{_num_dim(src, "colorVal", first)}</cx:data>')
        geo = '<cx:layoutPr><cx:geography cultureLanguage="en-US" cultureRegion="US" attribution="Powered by Bing"/></cx:layoutPr>'
        series.append(f'<cx:series layoutId="{layout}" uniqueId="{sid()}">{tx(first)}{sppr(0)}{dlabels("ctr", cat=True)}<cx:dataId val="0"/>{geo}</cx:series>')
    else:
        return None
    if gap is not None:
        yfmt = str(spec.get("yFmt") or "").strip()
        xfmt = str(spec.get("xFmt") or "").strip()
        vmin, vmax = spec.get("min"), spec.get("max")
        vattr = "".join(f' {n}="{v}"' for n, v in (("max", vmax), ("min", vmin)) if _num(v))
        q = lambda s: escape(s, {'"': "&quot;"})
        xn = f'<cx:numFmt formatCode="{q(xfmt)}" sourceLinked="0"/>' if xfmt else ""
        yn = f'<cx:numFmt formatCode="{q(yfmt)}" sourceLinked="0"/>' if yfmt else ""
        grid = "" if spec.get("grid") is False else "<cx:majorGridlines/>"
        axes = f'<cx:axis id="0"><cx:catScaling gapWidth="{gap}"/>{_axis_title(str(spec.get("xTitle") or ""))}<cx:tickLabels/>{xn}</cx:axis>'
        if kind != "funnel":
            axes += f'<cx:axis id="1"><cx:valScaling{vattr}/>{_axis_title(str(spec.get("yTitle") or ""))}{grid}<cx:tickLabels/>{yn}</cx:axis>'
    plot_fill = _hex(spec.get("plotFill"))
    plot_sp = f"<cx:spPr>{_fill(plot_fill)}</cx:spPr>" if plot_fill else ""
    title = _title(str(spec["title"])) if spec.get("title") else ""
    legend_key = spec.get("legend", "right")
    legend = "" if legend_key == "none" else f'<cx:legend pos="{LEGEND_POS.get(legend_key, "r")}" align="ctr" overlay="0"/>'
    fill = _hex(spec.get("fill"))
    space_sp = f"<cx:spPr>{_fill(fill)}</cx:spPr>" if fill else ""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<cx:chartSpace xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:cx="{NS_CX}">'
        f'<cx:chartData>{"".join(data)}</cx:chartData>'
        f'<cx:chart>{title}<cx:plotArea><cx:plotAreaRegion>{"".join(series)}</cx:plotAreaRegion>{axes}{plot_sp}</cx:plotArea>{legend}</cx:chart>'
        f"{space_sp}</cx:chartSpace>"
    )


def queue(wb, sheet: str, obj: dict, xml: str) -> None:
    wb.__dict__.setdefault("_fc_cx", []).append({"sheet": sheet, "obj": obj, "xml": xml})


def tag(wb, sheet: str, index: int, spec: dict) -> None:
    wb.__dict__.setdefault("_fc_tags", []).append({"sheet": sheet, "index": index, "spec": spec})


def _rels_path(part: str) -> str:
    head, _, tail = part.rpartition("/")
    return f"{head}/_rels/{tail}.rels"


def _resolve(base: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    parts = base.rpartition("/")[0].split("/") if "/" in base else []
    for seg in target.split("/"):
        if seg == "..":
            if parts:
                parts.pop()
        elif seg and seg != ".":
            parts.append(seg)
    return "/".join(parts)


def _sheet_parts(files: dict[str, bytes]) -> dict[str, str]:
    wbx = files.get("xl/workbook.xml")
    rels = files.get("xl/_rels/workbook.xml.rels")
    if not wbx or not rels:
        return {}
    ids = {}
    for m in re.finditer(r"<(?:\w+:)?Relationship\b([^>]*?)/?>", rels.decode("utf-8", "replace")):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        if "Id" in attrs and "Target" in attrs:
            ids[attrs["Id"]] = _resolve("xl/workbook.xml", unescape(attrs["Target"]))
    out = {}
    for m in re.finditer(r"<(?:\w+:)?sheet\b([^>]*?)/?>", wbx.decode("utf-8", "replace")):
        attrs = dict(re.findall(r"([\w:]+)=\"([^\"]*)\"", m.group(1)))
        rid = attrs.get("r:id") or attrs.get("id")
        if "name" in attrs and rid in ids:
            out[unescape(attrs["name"])] = ids[rid]
    return out


def _rel_map(files: dict[str, bytes], part: str) -> dict[str, tuple[str, str]]:
    raw = files.get(_rels_path(part))
    out: dict[str, tuple[str, str]] = {}
    if not raw:
        return out
    for m in re.finditer(r"<(?:\w+:)?Relationship\b([^>]*?)/?>", raw.decode("utf-8", "replace")):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        if "Id" in attrs and "Target" in attrs:
            out[attrs["Id"]] = (attrs.get("Type", ""), _resolve(part, unescape(attrs["Target"])))
    return out


def _anchor_xml(obj: dict, view: dict, name_id: int, rid: str, cols: dict, rows: dict, col_px: int, row_px: int) -> str:
    def locate(sizes: dict, default: int, px: float) -> tuple[int, int]:
        i = 0
        acc = 0.0
        while True:
            s = sizes.get(i, default)
            if acc + s > px or i > 20000:
                return i, int((px - acc) * EMU)
            acc += s
            i += 1

    col, coff = locate(cols, col_px, max(0, obj.get("x", 0)))
    row, roff = locate(rows, row_px, max(0, obj.get("y", 0)))
    cx = int(obj.get("w", 480) * EMU)
    cy = int(obj.get("h", 300) * EMU)
    note = "This chart isn't available in your version of Excel."
    return (
        f"<oneCellAnchor><from><col>{col}</col><colOff>{coff}</colOff><row>{row}</row><rowOff>{roff}</rowOff></from><ext cx=\"{cx}\" cy=\"{cy}\"/>"
        f'<mc:AlternateContent xmlns:mc="{NS_MC}">'
        f'<mc:Choice xmlns:cx1="{NS_CX1}" Requires="cx1">'
        f'<graphicFrame macro=""><nvGraphicFramePr><cNvPr id="{name_id}" name="Chart {name_id}"/><cNvGraphicFramePr/></nvGraphicFramePr>'
        f'<xfrm><a:off xmlns:a="{NS_A}" x="0" y="0"/><a:ext xmlns:a="{NS_A}" cx="0" cy="0"/></xfrm>'
        f'<a:graphic xmlns:a="{NS_A}"><a:graphicData uri="{NS_CX}"><cx:chart xmlns:cx="{NS_CX}" xmlns:r="{NS_R}" r:id="{rid}"/></a:graphicData></a:graphic></graphicFrame>'
        "</mc:Choice>"
        f'<mc:Fallback><sp macro="" textlink=""><nvSpPr><cNvPr id="0" name=""/><cNvSpPr><a:spLocks xmlns:a="{NS_A}" noTextEdit="1"/></cNvSpPr></nvSpPr>'
        f'<spPr><a:xfrm xmlns:a="{NS_A}"><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom xmlns:a="{NS_A}" prst="rect"><a:avLst/></a:prstGeom><a:solidFill xmlns:a="{NS_A}"><a:prstClr val="white"/></a:solidFill><a:ln xmlns:a="{NS_A}" w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></spPr>'
        f'<txBody><a:bodyPr xmlns:a="{NS_A}" vertOverflow="clip" horzOverflow="clip"/><a:lstStyle xmlns:a="{NS_A}"/><a:p xmlns:a="{NS_A}"><a:r><a:rPr lang="en-US" sz="1100"/><a:t>{escape(note)}</a:t></a:r></a:p></txBody></sp></mc:Fallback>'
        "</mc:AlternateContent><clientData/></oneCellAnchor>"
    )


def inject(data: bytes, wb, views: list[dict], col_px: int, row_px: int) -> bytes:
    cx = getattr(wb, "_fc_cx", None) or []
    tags = getattr(wb, "_fc_tags", None) or []
    if not cx and not tags:
        return data
    with zipfile.ZipFile(BytesIO(data)) as z:
        order = z.namelist()
        files = {n: z.read(n) for n in order}
        infos = {n: z.getinfo(n).compress_type for n in order}
    sheets = _sheet_parts(files)
    names = [ws.title for ws in wb.worksheets]
    ctypes = files["[Content_Types].xml"].decode("utf-8")
    additions: list[str] = []
    next_cx = 1 + max([int(m) for n in files for m in re.findall(r"xl/charts/chartEx(\d+)\.xml", n)] or [0])
    next_drawing = 1 + max([int(m) for n in files for m in re.findall(r"xl/drawings/drawing(\d+)\.xml$", n)] or [0])
    by_sheet: dict[str, list[dict]] = {}
    for item in cx:
        by_sheet.setdefault(item["sheet"], []).append(item)
    tag_sheet: dict[str, list[dict]] = {}
    for item in tags:
        tag_sheet.setdefault(item["sheet"], []).append(item)
    for sheet in {*by_sheet, *tag_sheet}:
        part = sheets.get(sheet)
        if part is None or part not in files:
            continue
        rels = _rel_map(files, part)
        drawing = next((t for (ty, t) in rels.values() if ty.endswith("/drawing")), None)
        if drawing is None:
            drawing = f"xl/drawings/drawing{next_drawing}.xml"
            next_drawing += 1
            files[drawing] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><wsDr xmlns="{NS_XDR}"></wsDr>'.encode()
            infos[drawing] = zipfile.ZIP_DEFLATED
            additions.append(f'<Override PartName="/{drawing}" ContentType="{CT_DRAWING}"/>')
            rid = f"rIdFc{len(rels) + 1}"
            rpath = _rels_path(part)
            line = f'<Relationship Id="{rid}" Type="{REL_DRAWING}" Target="/{drawing}"/>'
            if rpath in files:
                files[rpath] = files[rpath].decode("utf-8").replace("</Relationships>", line + "</Relationships>").encode()
            else:
                files[rpath] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{NS_PKG}">{line}</Relationships>'.encode()
                infos[rpath] = zipfile.ZIP_DEFLATED
            sx = files[part].decode("utf-8")
            tag_xml = f'<drawing xmlns:r="{NS_R}" r:id="{rid}"/>'
            m = re.search(r"<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b", sx)
            sx = sx[: m.start()] + tag_xml + sx[m.start():] if m else sx.replace("</worksheet>", tag_xml + "</worksheet>")
            files[part] = sx.encode()
        dxml = files[drawing].decode("utf-8")
        drels_path = _rels_path(drawing)
        drels = files.get(drels_path, f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{NS_PKG}"></Relationships>'.encode()).decode("utf-8")
        view = views[names.index(sheet)] if sheet in names and names.index(sheet) < len(views) else {}
        cols = {int(i): int(px) for i, px in (view.get("cols") or {}).get("sizes", [])}
        rows = {int(i): int(px) for i, px in (view.get("rows") or {}).get("sizes", [])}
        pieces = ""
        for k, item in enumerate(by_sheet.get(sheet, [])):
            cpart = f"xl/charts/chartEx{next_cx}.xml"
            next_cx += 1
            files[cpart] = item["xml"].encode("utf-8")
            infos[cpart] = zipfile.ZIP_DEFLATED
            additions.append(f'<Override PartName="/{cpart}" ContentType="{CT_CHARTEX}"/>')
            rid = f"rIdCx{next_cx}"
            drels = drels.replace("</Relationships>", f'<Relationship Id="{rid}" Type="{REL_CHARTEX}" Target="/{cpart}"/></Relationships>')
            pieces += _anchor_xml(item["obj"], view, 1000 + next_cx, rid, cols, rows, col_px, row_px)
        if pieces:
            dxml = dxml.replace("</wsDr>", pieces + "</wsDr>") if "</wsDr>" in dxml else dxml.rsplit("</", 1)[0] + pieces + "</" + dxml.rsplit("</", 1)[1]
        frames = list(re.finditer(r"<graphicFrame\b.*?</graphicFrame>", dxml, re.S))
        for t in sorted(tag_sheet.get(sheet, []), key=lambda x: -x["index"]):
            if t["index"] >= len(frames):
                continue
            fm = frames[t["index"]]
            blob = base64.b64encode(json.dumps(t["spec"], separators=(",", ":")).encode()).decode()
            frame = re.sub(r"<cNvPr\b([^>]*?)(/?)>", lambda mm: f'<cNvPr{mm.group(1)} title="{TAG_ATTR}{blob}"{mm.group(2)}>', fm.group(0), count=1)
            dxml = dxml[: fm.start()] + frame + dxml[fm.end():]
        files[drawing] = dxml.encode("utf-8")
        files[drels_path] = drels.encode("utf-8")
        infos.setdefault(drels_path, zipfile.ZIP_DEFLATED)
    if additions:
        ctypes = ctypes.replace("</Types>", "".join(additions) + "</Types>")
    files["[Content_Types].xml"] = ctypes.encode("utf-8")
    out = BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n in [*order, *[k for k in files if k not in order]]:
            z.writestr(n, files[n], compress_type=infos.get(n, zipfile.ZIP_DEFLATED))
    return out.getvalue()


def _local(tag_name: str) -> str:
    return tag_name.rpartition("}")[2]


def _int(el, name: str) -> int:
    for child in el:
        if _local(child.tag) == name:
            try:
                return int((child.text or "0").strip())
            except ValueError:
                return 0
    return 0


def scan(data: bytes) -> dict[str, list[dict]]:
    try:
        z = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile:
        return {}
    with z:
        names = z.namelist()
        files: dict[str, bytes] = {}
        wanted = [n for n in names if n.endswith(".rels") or n in ("xl/workbook.xml",) or re.match(r"xl/(drawings/drawing\d+|charts/chart\w*?\d+)\.xml$", n)]
        for n in wanted:
            files[n] = z.read(n)
    if not any(re.match(r"xl/drawings/drawing\d+\.xml$", n) for n in files):
        return {}
    sheets = _sheet_parts(files)
    out: dict[str, list[dict]] = {}
    for sheet, part in sheets.items():
        srels = _rel_map(files, part)
        drawing = next((t for (ty, t) in srels.values() if ty.endswith("/drawing")), None)
        if not drawing or drawing not in files:
            continue
        drels = _rel_map(files, drawing)
        try:
            root = ET.fromstring(files[drawing])
        except ET.ParseError:
            continue
        found = []
        for anchor in root:
            name = _local(anchor.tag)
            if name not in ("twoCellAnchor", "oneCellAnchor", "absoluteAnchor"):
                continue
            frm = next((c for c in anchor if _local(c.tag) == "from"), None)
            to = next((c for c in anchor if _local(c.tag) == "to"), None)
            ext = next((c for c in anchor if _local(c.tag) == "ext"), None)
            ref = None
            kind = None
            title = ""
            for el in anchor.iter():
                ln = _local(el.tag)
                if ln == "chart" and f"{{{NS_R}}}id" in el.attrib:
                    ref = el.attrib[f"{{{NS_R}}}id"]
                    kind = "cx" if el.tag.startswith("{" + NS_CX) else "chart"
                elif ln == "cNvPr" and not title:
                    title = el.attrib.get("title", "")
            if ref is None or ref not in drels:
                continue
            entry = {"kind": kind, "title": title, "part": drels[ref][1]}
            if frm is not None:
                entry["from"] = (_int(frm, "col"), _int(frm, "colOff"), _int(frm, "row"), _int(frm, "rowOff"))
            if to is not None:
                entry["to"] = (_int(to, "col"), _int(to, "colOff"), _int(to, "row"), _int(to, "rowOff"))
            if ext is not None:
                entry["ext"] = (int(ext.attrib.get("cx", "0")), int(ext.attrib.get("cy", "0")))
            blob = files.get(entry["part"])
            if blob is None:
                with zipfile.ZipFile(BytesIO(data)) as z2:
                    try:
                        blob = z2.read(entry["part"])
                    except KeyError:
                        continue
            entry["xml"] = blob
            found.append(entry)
        if found:
            out[sheet] = found
    return out


def decode_tag(title: str) -> dict | None:
    if not title.startswith(TAG_ATTR):
        return None
    try:
        got = json.loads(base64.b64decode(title[len(TAG_ATTR):]).decode())
    except (ValueError, UnicodeDecodeError):
        return None
    return got if isinstance(got, dict) else None


def anchor_of(entry: dict) -> SimpleNamespace:
    c, co, r, ro = entry.get("from", (0, 0, 0, 0))
    frm = SimpleNamespace(col=c, colOff=co, row=r, rowOff=ro)
    to = None
    if "to" in entry:
        tc, tco, tr, tro = entry["to"]
        to = SimpleNamespace(col=tc, colOff=tco, row=tr, rowOff=tro)
    ext = SimpleNamespace(width=entry["ext"][0], height=entry["ext"][1]) if "ext" in entry else None
    return SimpleNamespace(_from=frm, to=to, ext=ext)


def plot_fill(xml: bytes) -> str | None:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    for el in root.iter(f"{{{NS_C}}}plotArea"):
        for child in el:
            if _local(child.tag) == "spPr":
                for c in child.iter(f"{{{NS_A}}}srgbClr"):
                    return "#" + c.attrib.get("val", "").lower()
    return None


def _cx_attr(el, name: str):
    return el.attrib.get(name) if el is not None else None


def _first(el, path: list[str]):
    cur = el
    for step in path:
        if cur is None:
            return None
        cur = next((c for c in cur if _local(c.tag) == step), None)
    return cur


def _ref_box(f: str):
    m = re.match(r"^(?:'((?:[^']|'')+)'|([^!']+))!(.+)$", f.strip())
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


def parse(xml: bytes, ws_title: str) -> dict | None:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    chart = _first(root, ["chart"])
    region = _first(chart, ["plotArea", "plotAreaRegion"])
    if chart is None or region is None:
        return None
    ser = next((c for c in region if _local(c.tag) == "series"), None)
    if ser is None:
        return None
    layout = ser.attrib.get("layoutId", "")
    kind = TYPE_OF.get(layout)
    if kind is None:
        return None
    boxes: list[tuple[int, int, int, int]] = []
    sheet = None
    by_rows = False
    for f in root.iter(f"{{{NS_CX}}}f"):
        got = _ref_box(f.text or "")
        if got:
            sheet = sheet or got[0]
            boxes.append(got[1])
            if f.attrib.get("dir") == "row":
                by_rows = True
    if not boxes:
        return None
    c0 = min(b[0] for b in boxes)
    r0 = min(b[1] for b in boxes)
    c1 = max(b[2] for b in boxes)
    r1 = max(b[3] for b in boxes)
    rng = f"{get_column_letter(c0)}{r0}:{get_column_letter(c1)}{r1}"
    if sheet and sheet != ws_title:
        rng = f"'{sheet.replace(chr(39), chr(39) * 2)}'!{rng}"
    spec: dict = {"type": kind, "range": rng, "byRows": by_rows, "title": "", "xTitle": "", "yTitle": "", "legend": "none", "labels": False, "secondary": []}
    t = _first(chart, ["title", "tx", "txData", "v"])
    if t is not None and t.text:
        spec["title"] = t.text
    lg = next((c for c in chart if _local(c.tag) == "legend"), None)
    if lg is not None:
        spec["legend"] = LEGEND_BACK.get(lg.attrib.get("pos", "r"), "right")
    dl = next((c for c in ser if _local(c.tag) == "dataLabels"), None)
    if dl is not None:
        vis = next((c for c in dl if _local(c.tag) == "visibility"), None)
        spec["labels"] = vis is None or vis.attrib.get("value", "1") in ("1", "true") or vis.attrib.get("categoryName") in ("1", "true")
        nf = next((c for c in dl if _local(c.tag) == "numFmt"), None)
        if nf is not None and nf.attrib.get("formatCode") and nf.attrib.get("formatCode") != "General":
            spec["labelFmt"] = nf.attrib["formatCode"]
    bc = next(ser.iter(f"{{{NS_CX}}}binCount"), None)
    if bc is not None:
        try:
            spec["bins"] = int(bc.attrib.get("val", "0")) or None
        except ValueError:
            pass
        if spec.get("bins") is None:
            spec.pop("bins", None)
    sub = [int(e.attrib.get("val", "-1")) for e in ser.iter(f"{{{NS_CX}}}idx") if e.attrib.get("val", "").lstrip("-").isdigit()]
    if kind == "waterfall" and sub:
        spec["totals"] = sorted(sub)
    sp = _first(ser, ["spPr"])
    if sp is not None:
        c = next(sp.iter(f"{{{NS_A}}}srgbClr"), None)
        if c is not None:
            spec["colors"] = ["#" + c.attrib.get("val", "").lower()]
    for ax in (c for c in _first(chart, ["plotArea"]) if _local(c.tag) == "axis"):
        tt = _first(ax, ["title", "tx", "txData", "v"])
        is_val = any(_local(c.tag) == "valScaling" for c in ax)
        if tt is not None and tt.text:
            spec["yTitle" if is_val else "xTitle"] = tt.text
        nf = next((c for c in ax if _local(c.tag) == "numFmt"), None)
        if nf is not None and nf.attrib.get("formatCode") and nf.attrib.get("formatCode") != "General":
            spec["yFmt" if is_val else "xFmt"] = nf.attrib["formatCode"]
        if is_val:
            vs = next(c for c in ax if _local(c.tag) == "valScaling")
            for key, name in (("min", "min"), ("max", "max")):
                try:
                    if vs.attrib.get(name) not in (None, "auto"):
                        spec[key] = float(vs.attrib[name])
                except ValueError:
                    pass
            if not any(_local(c.tag) == "majorGridlines" for c in ax):
                spec["grid"] = False
    pa = _first(chart, ["plotArea", "spPr"])
    if pa is not None:
        c = next(pa.iter(f"{{{NS_A}}}srgbClr"), None)
        if c is not None:
            spec["plotFill"] = "#" + c.attrib.get("val", "").lower()
    cs = next((c for c in root if _local(c.tag) == "spPr"), None)
    if cs is not None:
        c = next(cs.iter(f"{{{NS_A}}}srgbClr"), None)
        if c is not None:
            spec["fill"] = "#" + c.attrib.get("val", "").lower()
    return spec
