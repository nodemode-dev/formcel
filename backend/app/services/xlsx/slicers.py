import io
import math
import re
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET
from xml.sax.saxutils import quoteattr

from openpyxl.utils import range_boundaries

from .overlay import EMU, _add_drawing, _box, _child, _drawing_of, _marker_in, _new_rid, _rels_of, _sheet_parts, _tag, _target, markers
from .pivots import parse as pivot_parse
from .tables import parse as table_parse

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_SL = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
NS_X15 = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"
NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_DRAW_SL = "http://schemas.microsoft.com/office/drawing/2010/slicer"
NS_SLE15 = "http://schemas.microsoft.com/office/drawing/2012/slicer"
REL_SLICER = "http://schemas.microsoft.com/office/2007/relationships/slicer"
REL_CACHE = "http://schemas.microsoft.com/office/2007/relationships/slicerCache"
CT_SLICER = "application/vnd.ms-excel.slicer+xml"
CT_CACHE = "application/vnd.ms-excel.slicerCache+xml"
URI_SHEET = "{A8765BA9-456A-4dab-B4F3-ACF838C121DE}"
URI_PIVOT = "{BBE1A952-AA13-448e-AADC-164F8A28A991}"
URI_TABLE = "{46BE6895-7355-4a93-B00E-2C351335B9C9}"
URI_TABLE_CACHE = "{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}"
LEFT, TOP = 60, 150
WIDTH = 200
STYLE_OUT = {"accent": "SlicerStyleLight1", "light": "SlicerStyleOther1", "dark": "SlicerStyleDark1", "green": "SlicerStyleLight6", "orange": "SlicerStyleLight2"}
STYLE_IN = {"SlicerStyleLight1": "accent", "SlicerStyleLight4": "accent", "SlicerStyleLight5": "accent", "SlicerStyleLight2": "orange", "SlicerStyleLight6": "green",
            "SlicerStyleLight3": "light", "SlicerStyleOther1": "light"}
ROW_EMU = 241300


def _safe(text: str) -> str:
    return re.sub(r"\W", "_", text) or "Field"


def _unique(taken: set[str], want: str) -> str:
    name, n = want, 1
    while name.lower() in taken:
        n += 1
        name = f"{want}{n}"
    taken.add(name.lower())
    return name


def _xdr_marker(tag: str, m: tuple[int, int, int, int]) -> str:
    return f"<xdr:{tag}><xdr:col>{m[0]}</xdr:col><xdr:colOff>{m[1]}</xdr:colOff><xdr:row>{m[2]}</xdr:row><xdr:rowOff>{m[3]}</xdr:rowOff></xdr:{tag}>"


def _anchor_xml(name: str, ident: int, box: dict, view: dict) -> str:
    f, t = markers(box, view)
    q = quoteattr(name)
    cx, cy = int(box["w"] * EMU), int(box["h"] * EMU)
    text = "This shape represents a slicer. Slicers are supported in Excel 2010 or later.&#10;&#10;If the shape was modified in an earlier version of Excel, or if the workbook was saved in Excel 2003 or earlier, the slicer cannot be used."
    return (f'<mc:AlternateContent xmlns:mc="{NS_MC}" xmlns:xdr="{NS_XDR}" xmlns:a="{NS_A}"><mc:Choice xmlns:sle15="{NS_SLE15}" Requires="sle15">'
            f'<xdr:twoCellAnchor editAs="oneCell">{_xdr_marker("from", f)}{_xdr_marker("to", t)}<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{ident}" name={q}/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
            f'<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="{NS_DRAW_SL}"><sle:slicer xmlns:sle="{NS_DRAW_SL}" name={q}/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></mc:Choice>'
            f'<mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr>'
            f'<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>{text}</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent>')


def _cache_fields(files: dict[str, bytes]) -> dict[int, dict[str, list[str]]]:
    out: dict[int, dict[str, list[str]]] = {}
    if "xl/workbook.xml" not in files or "xl/_rels/workbook.xml.rels" not in files:
        return out
    wb = files["xl/workbook.xml"].decode("utf-8")
    try:
        rels = {r.get("Id"): r.get("Target", "") for r in ET.fromstring(files["xl/_rels/workbook.xml.rels"])}
    except ET.ParseError:
        return out
    for m in re.finditer(r"<pivotCache\b([^>]*)/?>", wb):
        attrs = dict(re.findall(r'([\w:]+)="([^"]*)"', m.group(1)))
        target = rels.get(attrs.get("r:id", ""))
        if not target or "cacheId" not in attrs:
            continue
        path = _target("xl/workbook.xml", target)
        if path not in files:
            continue
        try:
            root = ET.fromstring(files[path])
        except ET.ParseError:
            continue
        fields: dict[str, list[str]] = {}
        for cf in root.iter(f"{{{NS_MAIN}}}cacheField"):
            si = cf.find(f"{{{NS_MAIN}}}sharedItems")
            fields[cf.get("name", "")] = [(it.get("v") or "") for it in (si if si is not None else [])]
        out[int(attrs["cacheId"])] = fields
    return out


def _sheet_ids(files: dict[str, bytes]) -> list[str]:
    wb = files.get("xl/workbook.xml", b"").decode("utf-8")
    return [dict(re.findall(r'([\w:]+)="([^"]*)"', m.group(1))).get("sheetId", "") for m in re.finditer(r"<sheet\b([^>]*)/?>", wb)]


def _add_override(files: dict[str, bytes], part: str, ctype: str) -> None:
    ct = files["[Content_Types].xml"].decode("utf-8")
    files["[Content_Types].xml"] = ct.replace("</Types>", f'<Override PartName="/{part}" ContentType="{ctype}"/></Types>').encode("utf-8")


def _add_rel(files: dict[str, bytes], owner: str, kind: str, target: str) -> str:
    rels, xml = _rels_of(files, owner)
    rid = _new_rid(xml)
    files[rels] = xml.replace("</Relationships>", f'<Relationship Id="{rid}" Type="{kind}" Target="/{target}"/></Relationships>').encode("utf-8")
    return rid


def _add_ext(xml: str, ext: str, root_tag: str) -> str:
    if "<extLst>" in xml:
        return xml.replace("</extLst>", ext + "</extLst>", 1)
    return xml.replace(f"</{root_tag}>", f"<extLst>{ext}</extLst></{root_tag}>", 1)


def finish(data: bytes, views: list[dict], table_lines: list[str], pivot_lines: list[str]) -> bytes:
    if not any((v or {}).get("slicers") for v in views):
        return data
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        files = {n: z.read(n) for n in z.namelist()}
    tables = [(k + 1, table_parse(line)) for k, line in enumerate(table_lines)]
    pivots = [(k + 1, pivot_parse(line)) for k, line in enumerate(pivot_lines)]
    caches = _cache_fields(files)
    sheet_ids = _sheet_ids(files)
    cache_names: set[str] = set()
    slicer_names: set[str] = set()
    cache_parts: list[tuple[str, str]] = []
    cache_count = 0
    slicer_count = 0
    for i, view in enumerate(views):
        specs = (view or {}).get("slicers") or []
        sheet = f"xl/worksheets/sheet{i + 1}.xml"
        if not specs or sheet not in files:
            continue
        entries: list[str] = []
        placed: list[tuple[str, dict, dict]] = []
        for sl in specs:
            caption = str(sl.get("title") or "Slicer")
            cols = max(1, min(20, int(sl.get("cols") or 1)))
            style = STYLE_OUT.get(sl.get("style") or "accent", STYLE_OUT["accent"])
            if sl.get("pivot"):
                hit = next(((cid, d) for cid, d in pivots if d and d["name"] == sl["pivot"]), None)
                if hit is None:
                    continue
                cid, d = hit
                field = str(sl.get("field") or "")
                items = (caches.get(cid) or {}).get(field)
                if not items:
                    continue
                kept = next((it for f, it in d["filters"] if f == field), [])
                keep = {x.lower() for x in kept}
                body = "".join(f'<i x="{x}"' + (' s="1"' if not keep or items[x].lower() in keep else "") + "/>" for x in range(len(items)))
                tab = sheet_ids[d["sheet"]] if d["sheet"] < len(sheet_ids) else str(d["sheet"] + 1)
                name = _unique(cache_names, "Slicer_" + _safe(field))
                xml = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicerCacheDefinition xmlns="{NS_SL}" xmlns:mc="{NS_MC}" mc:Ignorable="x" xmlns:x="{NS_MAIN}" name={quoteattr(name)} sourceName={quoteattr(field)}>'
                       f'<pivotTables><pivotTable tabId="{tab}" name={quoteattr(d["name"])}/></pivotTables><data><tabular pivotCacheId="{cid}"><items count="{len(items)}">{body}</items></tabular></data></slicerCacheDefinition>')
                kind = "pivot"
                height = 34 + 26 * math.ceil(len(items) / cols)
            else:
                col = int(sl.get("col", -1))
                hit = next(((tid, t) for tid, t in tables if t and t["sheet"] == i and t["area"][1] <= col <= t["area"][3]), None)
                if hit is None:
                    continue
                tid, t = hit
                j = col - t["area"][1]
                if j >= len(t["cols"]):
                    continue
                source = t["cols"][j]
                name = _unique(cache_names, "Slicer_" + _safe(source))
                xml = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicerCacheDefinition xmlns="{NS_SL}" xmlns:mc="{NS_MC}" mc:Ignorable="x" xmlns:x="{NS_MAIN}" name={quoteattr(name)} sourceName={quoteattr(source)}>'
                       f'<extLst><x:ext uri="{URI_TABLE_CACHE}" xmlns:x15="{NS_X15}"><x15:tableSlicerCache tableId="{tid}" column="{j + 1}"/></x:ext></extLst></slicerCacheDefinition>')
                kind = "table"
                height = 220
            cache_count += 1
            cache_parts.append((kind, f"xl/slicerCaches/slicerCache{cache_count}.xml"))
            files[cache_parts[-1][1]] = xml.encode("utf-8")
            cap = _unique(slicer_names, caption[:60])
            entries.append(f'<slicer name={quoteattr(cap)} cache={quoteattr(name)} caption={quoteattr(caption)} columnCount="{cols}" style="{style}" rowHeight="{ROW_EMU}"/>')
            box = {"x": max(0, int(sl.get("x", 0)) - LEFT), "y": max(0, int(sl.get("y", 0)) - TOP), "w": WIDTH, "h": min(320, height)}
            placed.append((cap, box, view))
        if not entries:
            continue
        slicer_count += 1
        part = f"xl/slicers/slicer{slicer_count}.xml"
        files[part] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicers xmlns="{NS_SL}" xmlns:mc="{NS_MC}" mc:Ignorable="x" xmlns:x="{NS_MAIN}">{"".join(entries)}</slicers>').encode("utf-8")
        _add_override(files, part, CT_SLICER)
        rid = _add_rel(files, sheet, REL_SLICER, part)
        sx = files[sheet].decode("utf-8")
        ext = f'<ext uri="{URI_SHEET}" xmlns:x14="{NS_SL}"><x14:slicerList><x14:slicer r:id="{rid}" xmlns:r="{NS_REL}"/></x14:slicerList></ext>'
        files[sheet] = _add_ext(sx, ext, "worksheet").encode("utf-8")
        drawing = _drawing_of(files, sheet) or _add_drawing(files, sheet)
        dx = files[drawing].decode("utf-8")
        top = max([int(x) for x in re.findall(r'<(?:\w+:)?cNvPr id="(\d+)"', dx)], default=0)
        add = "".join(_anchor_xml(cap, top + 1 + k, box, v) for k, (cap, box, v) in enumerate(placed))
        files[drawing] = dx.replace("</wsDr>", add + "</wsDr>", 1).encode("utf-8")
    if not cache_parts:
        return data
    wb_xml = files["xl/workbook.xml"].decode("utf-8")
    exts = {"pivot": [], "table": []}
    for kind, part in cache_parts:
        _add_override(files, part, CT_CACHE)
        rid = _add_rel(files, "xl/workbook.xml", REL_CACHE, part)
        exts[kind].append(f'<x14:slicerCache r:id="{rid}"/>')
    block = ""
    if exts["pivot"]:
        block += f'<ext uri="{URI_PIVOT}" xmlns:x14="{NS_SL}"><x14:slicerCaches xmlns:r="{NS_REL}">{"".join(exts["pivot"])}</x14:slicerCaches></ext>'
    if exts["table"]:
        block += f'<ext uri="{URI_TABLE}" xmlns:x15="{NS_X15}"><x15:slicerCaches xmlns:x14="{NS_SL}" xmlns:r="{NS_REL}">{"".join(exts["table"])}</x15:slicerCaches></ext>'
    files["xl/workbook.xml"] = _add_ext(wb_xml, block, "workbook").encode("utf-8")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for n, blob in files.items():
            z.writestr(n, blob)
    return out.getvalue()


def _caches_in(files: dict[str, bytes]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    rels_path = "xl/_rels/workbook.xml.rels"
    if rels_path not in files:
        return out
    try:
        rels = ET.fromstring(files[rels_path])
    except ET.ParseError:
        return out
    for r in rels:
        if not (r.get("Type") or "").endswith("/slicerCache"):
            continue
        path = _target("xl/workbook.xml", r.get("Target", ""))
        if path not in files:
            continue
        try:
            root = ET.fromstring(files[path])
        except ET.ParseError:
            continue
        info: dict = {"source": root.get("sourceName", ""), "pivot": "", "cache": None, "table": None, "column": None}
        for el in root.iter():
            tag = _tag(el)
            if tag == "pivotTable" and not info["pivot"]:
                info["pivot"] = el.get("name", "")
            elif tag == "tabular":
                info["cache"] = el.get("pivotCacheId")
            elif tag == "tableSlicerCache":
                info["table"], info["column"] = el.get("tableId"), el.get("column")
        out[root.get("name", "")] = info
    return out


def _positions(files: dict[str, bytes], sheet: str, view: dict) -> dict[str, tuple[int, int, int, int]]:
    out: dict[str, tuple[int, int, int, int]] = {}
    drawing = _drawing_of(files, sheet)
    if not drawing or drawing not in files:
        return out
    try:
        root = ET.fromstring(files[drawing])
    except ET.ParseError:
        return out
    for el in root.iter():
        if _tag(el) != "slicer" or not el.get("name"):
            continue
        anchor = None
        for cand in root.iter():
            if _tag(cand) in ("twoCellAnchor", "oneCellAnchor") and any(e is el for e in cand.iter()):
                anchor = cand
        if anchor is None:
            continue
        f = _marker_in(_child(anchor, "from"))
        if f is None:
            continue
        ext = _child(anchor, "ext")
        out[el.get("name")] = _box(f, _marker_in(_child(anchor, "to")), (int(ext.get("cx", 0)), int(ext.get("cy", 0))) if ext is not None else None, view)
    return out


def slicers_in(wb, data: bytes, order: dict, pivot_lines: list[str], views: dict[int, dict], notes: Counter) -> None:
    pivot_names = {d["name"] for d in (pivot_parse(line) for line in pivot_lines) if d}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            files = {n: z.read(n) for n in z.namelist() if n.endswith((".xml", ".rels"))}
    except zipfile.BadZipFile:
        return
    timelines = sum(1 for n in files if n.startswith("xl/timelineCaches/") and n.endswith(".xml"))
    if timelines:
        notes["timelines left out"] += timelines
    caches = _caches_in(files)
    if not caches:
        return
    sheets = _sheet_parts(files)
    for si, ws in enumerate(wb.worksheets):
        if si >= len(sheets):
            break
        i = order.get(ws.title)
        view = views.get(i)
        if view is None:
            continue
        rels_path, rels_xml = _rels_of(files, sheets[si])
        if rels_path not in files:
            continue
        pos = _positions(files, sheets[si], view)
        found: list[dict] = []
        for m in re.finditer(r"<Relationship\b[^>]*>", rels_xml):
            tag = m.group(0)
            if REL_SLICER not in tag:
                continue
            target = re.search(r'Target="([^"]*)"', tag)
            part = _target(sheets[si], target.group(1)) if target else ""
            if part not in files:
                continue
            try:
                root = ET.fromstring(files[part])
            except ET.ParseError:
                continue
            for sl in root:
                if _tag(sl) != "slicer":
                    continue
                cache = caches.get(sl.get("cache", ""))
                caption = sl.get("caption") or sl.get("name") or ""
                style = STYLE_IN.get(sl.get("style") or "", "dark" if (sl.get("style") or "").startswith(("SlicerStyleDark", "SlicerStyleOther2")) else "accent")
                spec: dict = {"id": f"x{si}s{len(found)}", "title": caption, "style": style, "cols": max(1, min(4, int(sl.get("columnCount") or 1)))}
                box = pos.get(sl.get("name", ""))
                spec["x"], spec["y"] = (box[0] + LEFT, box[1] + TOP) if box else (120 + 24 * len(found), TOP + 24 * len(found))
                if cache is None:
                    notes["slicers FormCel could not read left out"] += 1
                    continue
                if cache["pivot"]:
                    if cache["pivot"] not in pivot_names:
                        notes["slicers FormCel could not read left out"] += 1
                        continue
                    spec.update({"col": -1, "pivot": cache["pivot"], "field": cache["source"]})
                else:
                    got = _table_column(ws, cache)
                    if got is None:
                        notes["slicers FormCel could not read left out"] += 1
                        continue
                    spec["col"] = got
                found.append(spec)
        if found:
            view["slicers"] = found


def _table_column(ws, cache: dict) -> int | None:
    for t in ws.tables.values():
        if cache["table"] is not None and str(t.id) != str(cache["table"]):
            continue
        try:
            c0 = range_boundaries(t.ref)[0] - 1
        except (TypeError, ValueError):
            continue
        for j, tc in enumerate(t.tableColumns):
            if str(tc.id) == str(cache["column"]) or (cache["column"] is None and tc.name == cache["source"]):
                return c0 + j
        for j, tc in enumerate(t.tableColumns):
            if tc.name == cache["source"]:
                return c0 + j
    return None
