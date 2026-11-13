import base64
import io
import posixpath
import re
import zipfile
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape, quoteattr

from openpyxl.utils import get_column_letter, range_boundaries

from . import richdata, shapexml

EMU = 9525
COL_PX = 100
ROW_PX = 24
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
NS_XM = "http://schemas.microsoft.com/office/excel/2006/main"
SPARK_URI = "{05C60535-1F16-4fd2-B633-F4F43ED7C7EB}"
DRAWING_REL = NS_REL + "/drawing"
DRAWING_TYPE = "application/vnd.openxmlformats-officedocument.drawing+xml"
SPARK_TYPE = {"line": "", "column": "column", "winloss": "stacked"}
SPARK_TYPE_IN = {"column": "column", "stacked": "winloss"}
FLAGS = (("markers", "markers"), ("high", "high"), ("low", "low"), ("first", "first"), ("last", "last"), ("negative", "negative"), ("axis", "displayXAxis"))
POINT_COLORS = (("axisColor", "colorAxis"), ("markerColor", "colorMarkers"), ("firstColor", "colorFirst"), ("lastColor", "colorLast"), ("highColor", "colorHigh"), ("lowColor", "colorLow"))
DEFAULT_SERIES = "#376092"
DEFAULT_NEGATIVE = "#d00000"


def _hex(color: str | None, fallback: str) -> str:
    t = (color or "").strip().lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{6}", t):
        return t.upper()
    if re.fullmatch(r"[0-9a-fA-F]{3}", t):
        return "".join(ch * 2 for ch in t).upper()
    return fallback.lstrip("#").upper()


def _locate(sizes: dict[int, int], default: int, px: float) -> tuple[int, int]:
    i = 0
    acc = 0.0
    while True:
        s = sizes.get(i, default)
        if acc + s > px or i > 20000:
            return i, int((px - acc) * EMU)
        acc += s
        i += 1


def _sizes(view: dict, key: str) -> dict[int, int]:
    return {int(i): int(px) for i, px in (view.get(key) or {}).get("sizes", [])}


def _offset(sizes: dict[int, int], default: int, index: int) -> float:
    return float(sum(sizes.get(i, default) for i in range(index)))


def markers(obj: dict, view: dict) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    a = obj.get("anchor")
    if isinstance(a, dict):
        return ((int(a["c0"]), int(a["dx0"] * EMU), int(a["r0"]), int(a["dy0"] * EMU)), (int(a["c1"]), int(a["dx1"] * EMU), int(a["r1"]), int(a["dy1"] * EMU)))
    cs = _sizes(view, "cols")
    rs = _sizes(view, "rows")
    x, y = max(0, obj.get("x", 0)), max(0, obj.get("y", 0))
    c0, co0 = _locate(cs, COL_PX, x)
    r0, ro0 = _locate(rs, ROW_PX, y)
    c1, co1 = _locate(cs, COL_PX, x + max(1, obj.get("w", 100)))
    r1, ro1 = _locate(rs, ROW_PX, y + max(1, obj.get("h", 60)))
    return (c0, co0, r0, ro0), (c1, co1, r1, ro1)


def _marker_xml(tag: str, m: tuple[int, int, int, int]) -> str:
    return f"<{tag}><col>{m[0]}</col><colOff>{m[1]}</colOff><row>{m[2]}</row><rowOff>{m[3]}</rowOff></{tag}>"


def cell_of(obj: dict, view: dict) -> tuple[int, int]:
    f, _ = markers(obj, view)
    return f[2], f[0]


def range_text(box: dict, view: dict) -> str:
    f, t = markers(box, view)
    r0, c0 = f[2], f[0]
    r1 = t[2] - (1 if t[3] == 0 and t[2] > r0 else 0)
    c1 = t[0] - (1 if t[1] == 0 and t[0] > c0 else 0)
    a = f"{get_column_letter(c0 + 1)}{r0 + 1}"
    b = f"{get_column_letter(c1 + 1)}{r1 + 1}"
    return a if a == b else f"{a}:{b}"


def _rgb(color: str, fallback: str) -> str:
    return "FF" + _hex(color, fallback)


def macro_of(obj: dict) -> str:
    name = str(obj.get("scriptName") or "").strip()
    return f"[0]!{re.sub(r'[^A-Za-z0-9_.]', '_', name)}" if name else ""


def _shape_xml(obj: dict, ident: int, view: dict) -> str:
    f, t = markers(obj, view)
    w, h = int(obj.get("w", 140) * EMU), int(obj.get("h", 90) * EMU)
    alt = f" descr={quoteattr(str(obj['alt']))}" if obj.get("alt") else ""
    if obj.get("kind") == "shape":
        return (
            f'<twoCellAnchor editAs="twoCell" xmlns:a="{NS_A}">{_marker_xml("from", f)}{_marker_xml("to", t)}'
            f'{shapexml.element(obj, ident, w, h, str(obj.get("alt") or ""), macro_of(obj))}<clientData/></twoCellAnchor>'
        )
    spec = obj.get("text") or {}
    body = str(spec.get("text", ""))
    size = int(spec.get("size", 14) * 75)
    fill = ""
    line = "<a:ln><a:noFill/></a:ln>"
    geom = "rect"
    text_color = _hex(spec.get("color"), "000000")
    name = f"Text Box {ident}"
    nv = '<cNvSpPr txBox="1"/>'
    align = "l"
    anchor = "t"
    paragraphs = body.split("\n") or [""]
    runs = "".join(
        f'<a:p><a:pPr algn="{align}"/>' + (f'<a:r><a:rPr lang="en-US" sz="{size}"><a:solidFill><a:srgbClr val="{text_color}"/></a:solidFill></a:rPr><a:t>{escape(p)}</a:t></a:r>' if p else f'<a:endParaRPr lang="en-US" sz="{size}"/>') + "</a:p>"
        for p in paragraphs
    )
    fill_xml = fill if fill else "<a:noFill/>"
    return (
        f'<twoCellAnchor editAs="twoCell" xmlns:a="{NS_A}">{_marker_xml("from", f)}{_marker_xml("to", t)}'
        f'<sp macro={quoteattr(macro_of(obj))} textlink=""><nvSpPr><cNvPr id="{ident}" name="{name}"{alt}/>{nv}</nvSpPr>'
        f'<spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="{geom}"><a:avLst/></a:prstGeom>'
        f"{fill_xml}{line}</spPr>"
        f'<txBody><a:bodyPr vertOverflow="clip" wrap="square" rtlCol="0" anchor="{anchor}"/><a:lstStyle/>{runs}</txBody></sp><clientData/></twoCellAnchor>'
    )


def _group_key(spark: dict) -> str:
    rest = {k: v for k, v in spark.items() if k not in ("data", "dataId")}
    return repr(sorted(rest.items()))


def _group_xml(spark: dict, members: list[tuple[str, str]]) -> str:
    attrs = []
    kind = SPARK_TYPE.get(spark.get("type", "line"), "")
    if kind:
        attrs.append(f'type="{kind}"')
    attrs.append(f'displayEmptyCellsAs="{spark.get("empty", "gap") if spark.get("empty") in ("gap", "zero", "span") else "gap"}"')
    for key, attr in FLAGS:
        if spark.get(key):
            attrs.append(f'{attr}="1"')
    if spark.get("hidden"):
        attrs.append('displayHidden="1"')
    if spark.get("weight"):
        attrs.append(f'lineWeight="{float(spark["weight"])}"')
    for side in ("min", "max"):
        v = spark.get(side)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            attrs.append(f'{side}AxisType="custom" manual{side.capitalize()}="{v}"')
        elif v == "group":
            attrs.append(f'{side}AxisType="group"')
    colors = f'<x14:colorSeries rgb="{_rgb(spark.get("color"), DEFAULT_SERIES)}"/><x14:colorNegative rgb="{_rgb(spark.get("neg"), DEFAULT_NEGATIVE)}"/>'
    for key, tag in POINT_COLORS:
        if spark.get(key):
            colors += f'<x14:{tag} rgb="{_rgb(spark[key], "000000")}"/>'
    items = "".join(f"<x14:sparkline><xm:f>{escape(f)}</xm:f><xm:sqref>{escape(s)}</xm:sqref></x14:sparkline>" for f, s in members)
    return f'<x14:sparklineGroup {" ".join(attrs)}>{colors}<x14:sparklines>{items}</x14:sparklines></x14:sparklineGroup>'


def sparklines_xml(sheet_name: str, sparks: list[dict], view: dict) -> str:
    groups: dict[str, tuple[dict, list[tuple[str, str]]]] = {}
    for obj in sparks:
        spec = obj["spark"]
        data = obj.get("_data") or spec.get("data") or ""
        if not data:
            continue
        r, c = cell_of(obj, view)
        loc = f"{get_column_letter(c + 1)}{r + 1}"
        ref = data if "!" in data else f"'{sheet_name.replace(chr(39), chr(39) * 2)}'!{data}"
        groups.setdefault(_group_key(spec), (spec, []))[1].append((ref, loc))
    if not groups:
        return ""
    body = "".join(_group_xml(spec, members) for spec, members in groups.values())
    return f'<ext xmlns:x14="{NS_X14}" uri="{SPARK_URI}"><x14:sparklineGroups xmlns:xm="{NS_XM}">{body}</x14:sparklineGroups></ext>'


def _rels_of(files: dict[str, bytes], path: str) -> tuple[str, str]:
    d, name = posixpath.split(path)
    rels = posixpath.join(d, "_rels", name + ".rels")
    return rels, files[rels].decode("utf-8") if rels in files else f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{NS_PKG_REL}"></Relationships>'


def _drawing_of(files: dict[str, bytes], sheet: str) -> str | None:
    rels, xml = _rels_of(files, sheet)
    if rels not in files:
        return None
    for m in re.finditer(r"<Relationship\b[^>]*>", xml):
        tag = m.group(0)
        if DRAWING_REL in tag:
            target = re.search(r'Target="([^"]*)"', tag)
            if target:
                t = target.group(1)
                return t.lstrip("/") if t.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(sheet), t))
    return None


def _new_rid(xml: str) -> str:
    ids = [int(x) for x in re.findall(r'Id="rId(\d+)"', xml)]
    return f"rId{max(ids, default=0) + 1}"


def _add_drawing(files: dict[str, bytes], sheet: str) -> str:
    n = 1
    while f"xl/drawings/drawing{n}.xml" in files:
        n += 1
    path = f"xl/drawings/drawing{n}.xml"
    files[path] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><wsDr xmlns="{NS_XDR}"></wsDr>'.encode()
    rels, xml = _rels_of(files, sheet)
    rid = _new_rid(xml)
    xml = xml.replace("</Relationships>", f'<Relationship Id="{rid}" Type="{DRAWING_REL}" Target="/{path}"/></Relationships>')
    files[rels] = xml.encode()
    ct = files["[Content_Types].xml"].decode()
    files["[Content_Types].xml"] = ct.replace("</Types>", f'<Override PartName="/{path}" ContentType="{DRAWING_TYPE}"/></Types>').encode()
    sx = files[sheet].decode()
    tag = f'<drawing xmlns:r="{NS_REL}" r:id="{rid}"/>'
    after = re.search(r"<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b", sx)
    sx = sx[: after.start()] + tag + sx[after.start():] if after else sx.replace("</worksheet>", tag + "</worksheet>")
    files[sheet] = sx.encode()
    return path


def _set_alts(xml: str, alts: dict[str, list[str]]) -> str:
    counters = {"graphicFrame": 0, "pic": 0}
    pattern = re.compile(r"(<(graphicFrame|pic)\b[^>]*>\s*<nv(?:GraphicFrame|Pic)Pr>\s*)<cNvPr\b([^>]*?)(/?)>")

    def fix(m: re.Match) -> str:
        kind = m.group(2)
        key = "charts" if kind == "graphicFrame" else "pics"
        i = counters[kind]
        counters[kind] += 1
        values = alts.get(key) or []
        text = values[i] if i < len(values) else ""
        attrs = re.sub(r'\s+descr="[^"]*"', "", m.group(3))
        if text:
            attrs += f" descr={quoteattr(text)}"
        return f"{m.group(1)}<cNvPr{attrs}{m.group(4)}>"

    return pattern.sub(fix, xml)


def _set_macros(xml: str, names: list[str]) -> str:
    count = [0]

    def fix(m: re.Match) -> str:
        i = count[0]
        count[0] += 1
        macro = names[i] if i < len(names) else ""
        attrs = re.sub(r'\s+macro="[^"]*"', "", m.group(1))
        return f"<pic{attrs} macro={quoteattr(macro)}>" if macro else f"<pic{attrs}>"

    return re.sub(r"<pic\b([^>]*)>", fix, xml)


def _apply(files: dict[str, bytes], index: int, plan: dict, name: str, view: dict) -> None:
    sheet = f"xl/worksheets/sheet{index + 1}.xml"
    if sheet not in files:
        return
    shapes = plan.get("shapes") or []
    alts = plan.get("alts") or {}
    drawing = _drawing_of(files, sheet)
    if shapes and drawing is None:
        drawing = _add_drawing(files, sheet)
    if drawing is not None and drawing in files:
        xml = files[drawing].decode()
        if any(alts.get(k) for k in alts):
            xml = _set_alts(xml, alts)
        if any((plan.get("macros") or {}).get("pics") or []):
            xml = _set_macros(xml, plan["macros"]["pics"])
        if shapes:
            top = max([int(x) for x in re.findall(r'<cNvPr id="(\d+)"', xml)], default=0)
            add = "".join(_shape_xml(obj, top + 1 + k, view) for k, obj in enumerate(shapes))
            xml = xml.replace("</wsDr>", add + "</wsDr>") if "</wsDr>" in xml else xml
        files[drawing] = xml.encode()
    ext = sparklines_xml(name, plan.get("sparks") or [], view)
    if ext:
        sx = files[sheet].decode()
        if "<extLst>" in sx:
            sx = sx.replace("</extLst>", ext + "</extLst>", 1)
        else:
            sx = sx.replace("</worksheet>", f"<extLst>{ext}</extLst></worksheet>")
        files[sheet] = sx.encode()


def finish(data: bytes, plans: dict[int, dict], names: list[str], views: list[dict]) -> bytes:
    if not any(plans.get(i) and (plans[i].get("shapes") or plans[i].get("sparks") or plans[i].get("cellpics") or any((plans[i].get("alts") or {}).values()) or any((plans[i].get("macros") or {}).get("pics") or [])) for i in plans):
        return data
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        files = {n: z.read(n) for n in z.namelist()}
    for i, plan in plans.items():
        _apply(files, i, plan, names[i] if i < len(names) else "Sheet", views[i] if i < len(views) else {})
    richdata.write(files, [(f"xl/worksheets/sheet{i + 1}.xml", plan["cellpics"]) for i, plan in plans.items() if plan.get("cellpics") and f"xl/worksheets/sheet{i + 1}.xml" in files])
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for n, blob in files.items():
            z.writestr(n, blob)
    return out.getvalue()


def _tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def _child(el: ET.Element, name: str) -> ET.Element | None:
    for c in el:
        if _tag(c) == name:
            return c
    return None


def _marker_in(el: ET.Element | None) -> tuple[int, int, int, int] | None:
    if el is None:
        return None
    try:
        vals = {_tag(c): int(c.text or 0) for c in el}
        return vals["col"], vals["colOff"], vals["row"], vals["rowOff"]
    except (KeyError, ValueError):
        return None


def _box(f: tuple[int, int, int, int], t: tuple[int, int, int, int] | None, ext: tuple[int, int] | None, view: dict) -> tuple[int, int, int, int]:
    cs = _sizes(view, "cols")
    rs = _sizes(view, "rows")
    x = _offset(cs, COL_PX, f[0]) + f[1] / EMU
    y = _offset(rs, ROW_PX, f[2]) + f[3] / EMU
    if t is not None:
        w = _offset(cs, COL_PX, t[0]) + t[1] / EMU - x
        h = _offset(rs, ROW_PX, t[2]) + t[3] / EMU - y
    elif ext is not None:
        w, h = ext[0] / EMU, ext[1] / EMU
    else:
        w, h = 140, 90
    return int(x), int(y), max(16, int(w)), max(16, int(h))


def _color_in(el: ET.Element | None) -> str | None:
    if el is None:
        return None
    fill = _child(el, "solidFill")
    if fill is None:
        return None
    srgb = _child(fill, "srgbClr")
    return "#" + srgb.get("val", "").lower() if srgb is not None and srgb.get("val") else None


def _shape_in(anchor: ET.Element, sp: ET.Element, view: dict, tag: str) -> dict | None:
    sp_pr = _child(sp, "spPr")
    geom = _child(sp_pr, "prstGeom") if sp_pr is not None else None
    prst = geom.get("prst", "rect") if geom is not None else "rect"
    nv = _child(sp, "nvSpPr")
    if nv is None:
        nv = _child(sp, "nvCxnSpPr")
    c_nv = _child(nv, "cNvPr") if nv is not None else None
    c_sp = _child(nv, "cNvSpPr") if nv is not None else None
    text_box = c_sp is not None and c_sp.get("txBox") in ("1", "true")
    body = _child(sp, "txBody")
    paragraphs = []
    size = 14.0
    color = ""
    if body is not None:
        for p in body:
            if _tag(p) != "p":
                continue
            line = ""
            for r in p:
                if _tag(r) == "r":
                    t = _child(r, "t")
                    line += (t.text or "") if t is not None else ""
                    rpr = _child(r, "rPr")
                    if rpr is not None:
                        if rpr.get("sz"):
                            size = int(rpr.get("sz")) / 75
                        color = _color_in(rpr) or color
                elif _tag(r) == "br":
                    line += "\n"
            paragraphs.append(line)
    text = "\n".join(paragraphs).rstrip("\n")
    f = _marker_in(_child(anchor, "from"))
    if f is None:
        pos = _child(anchor, "pos")
        if pos is None:
            return None
        f = (0, 0, 0, 0)
    t = _marker_in(_child(anchor, "to"))
    ext_el = _child(anchor, "ext")
    ext = (int(ext_el.get("cx", 0)), int(ext_el.get("cy", 0))) if ext_el is not None else None
    x, y, w, h = _box(f, t, ext, view)
    alt = (c_nv.get("descr") if c_nv is not None else "") or ""
    base = {"x": x, "y": y, "w": w, "h": h, "alt": alt}
    macro = (sp.get("macro") or "").split("!")[-1].strip()
    if macro:
        base["scriptName"] = macro
    is_button = c_nv is not None and (c_nv.get("name") or "").startswith("Button")
    if text_box and not (sp_pr is not None and _color_in(sp_pr)):
        return {**base, "kind": "text", "text": {"text": text, "size": round(size), "color": color if color and color != "#000000" else ""}}
    shape = shapexml.parse(sp)
    if shape is None:
        return None
    if is_button:
        shape["button"] = True
    return {**base, "kind": "shape", "shape": shape}


def _target(base: str, target: str) -> str:
    return target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(base), target))


def _sheet_parts(files: dict[str, bytes]) -> list[str]:
    if "xl/workbook.xml" not in files:
        return []
    wb = ET.fromstring(files["xl/workbook.xml"])
    rels = ET.fromstring(files["xl/_rels/workbook.xml.rels"]) if "xl/_rels/workbook.xml.rels" in files else None
    targets = {r.get("Id"): (r.get("Target", ""), r.get("Type", "")) for r in rels} if rels is not None else {}
    out = []
    for el in wb.iter():
        if _tag(el) == "sheet":
            target, kind = targets.get(el.get(f"{{{NS_REL}}}id"), ("", ""))
            path = _target("xl/workbook.xml", target)
            if target and not kind.endswith("/chartsheet") and path in files:
                out.append(path)
    return out


def _spark_style(g: ET.Element) -> dict:
    spec: dict = {"type": SPARK_TYPE_IN.get(g.get("type", ""), "line")}
    for key, attr in FLAGS:
        if g.get(attr) in ("1", "true"):
            spec[key] = True
    if g.get("displayHidden") in ("1", "true"):
        spec["hidden"] = True
    if g.get("lineWeight"):
        try:
            spec["weight"] = float(g.get("lineWeight"))
        except ValueError:
            pass
    if g.get("displayEmptyCellsAs") in ("zero", "span"):
        spec["empty"] = g.get("displayEmptyCellsAs")
    for side in ("min", "max"):
        kind = g.get(f"{side}AxisType")
        if kind == "custom" and g.get(f"manual{side.capitalize()}"):
            try:
                spec[side] = float(g.get(f"manual{side.capitalize()}"))
            except ValueError:
                pass
        elif kind == "group":
            spec[side] = "group"
    for c in g:
        name = _tag(c)
        rgb = c.get("rgb")
        if not rgb or len(rgb) < 6:
            continue
        col = "#" + rgb[-6:].lower()
        if name == "colorSeries":
            spec["color"] = col
        elif name == "colorNegative":
            spec["neg"] = col
        else:
            for key, tag in POINT_COLORS:
                if tag == name:
                    spec[key] = col
    return spec


def _sparks_in(root: ET.Element, sheet_name: str, view: dict, sid: str) -> list[dict]:
    out: list[dict] = []
    n = 0
    for g in root.iter(f"{{{NS_X14}}}sparklineGroup"):
        spec = _spark_style(g)
        for s in g.iter(f"{{{NS_X14}}}sparkline"):
            f = s.find(f"{{{NS_XM}}}f")
            q = s.find(f"{{{NS_XM}}}sqref")
            if f is None or q is None or not f.text or not q.text:
                continue
            try:
                c0, r0, c1, r1 = range_boundaries(q.text.strip().replace("$", ""))
            except ValueError:
                continue
            if None in (c0, r0):
                continue
            ref = f.text.strip()
            sheet_part, _, cells = ref.rpartition("!")
            sheet_part = sheet_part.strip("'").replace("''", "'")
            same = not sheet_part or sheet_part == sheet_name
            n += 1
            oid = f"{sid}s{n}"
            cs, rs = _sizes(view, "cols"), _sizes(view, "rows")
            x = int(_offset(cs, COL_PX, c0 - 1))
            y = int(_offset(rs, ROW_PX, r0 - 1))
            w = cs.get(c0 - 1, COL_PX)
            h = rs.get(r0 - 1, ROW_PX)
            item = {"id": oid, "kind": "spark", "x": x, "y": y, "w": w, "h": h, "spark": dict(spec)}
            if same:
                try:
                    dc0, dr0, dc1, dr1 = range_boundaries(cells.replace("$", ""))
                    box_x = int(_offset(cs, COL_PX, dc0 - 1))
                    box_y = int(_offset(rs, ROW_PX, dr0 - 1))
                    box_w = int(_offset(cs, COL_PX, dc1) - _offset(cs, COL_PX, dc0 - 1))
                    box_h = int(_offset(rs, ROW_PX, dr1) - _offset(rs, ROW_PX, dr0 - 1))
                    out.append({"id": f"{oid}d", "kind": "range", "x": box_x, "y": box_y, "w": max(1, box_w), "h": max(1, box_h)})
                    item["spark"]["dataId"] = f"{oid}d"
                except (ValueError, TypeError):
                    continue
            else:
                item["spark"]["data"] = ref
            out.append(item)
    return out


class Package:
    def __init__(self, data: bytes):
        self._pics: dict[int, dict] = {}
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = z.namelist()
                rich = "xl/richData/rdrichvalue.xml" in names
                self.files = {n: z.read(n) for n in names if n.endswith((".xml", ".rels")) or (rich and n.startswith("xl/media/"))}
        except zipfile.BadZipFile:
            self.files = {}
        self.sheets = _sheet_parts(self.files) if self.files else []

    def _raw_pics(self, i: int) -> dict[tuple[int, int], dict]:
        if i >= len(self.sheets):
            return {}
        if i not in self._pics:
            self._pics[i] = richdata.images(self.files, self.sheets[i])
        return self._pics[i]

    def cellkeys(self, i: int) -> set[tuple[int, int]]:
        return {k for k, got in self._raw_pics(i).items() if not got["formula"]}

    def cellpics(self, i: int, view: dict) -> list[dict]:
        out: list[dict] = []
        for (r, c), got in sorted(self._raw_pics(i).items()):
            blob = self.files.get(got["path"])
            if blob is None or got["formula"]:
                continue
            ext = posixpath.splitext(got["path"])[1][1:].lower()
            kind = "jpeg" if ext in ("jpg", "jpeg") else ext if ext in ("png", "gif", "bmp", "webp") else "png"
            cs, rs = _sizes(view, "cols"), _sizes(view, "rows")
            item = {"id": f"x{i}i{r}_{c}", "kind": "picture", "inCell": True, "x": int(_offset(cs, COL_PX, c)), "y": int(_offset(rs, ROW_PX, r)), "w": cs.get(c, COL_PX), "h": rs.get(r, ROW_PX),
                    "picture": {"src": f"data:image/{kind};base64,{base64.b64encode(blob).decode()}", "name": posixpath.basename(got["path"])}}
            if got["alt"]:
                item["alt"] = got["alt"]
            out.append(item)
        return out

    def sheet(self, i: int, name: str, view: dict) -> dict:
        entry: dict = {"shapes": [], "alts": {"charts": [], "pics": []}, "macros": {"pics": []}, "sparks": []}
        if i >= len(self.sheets):
            return entry
        sheet = self.sheets[i]
        drawing = _drawing_of(self.files, sheet)
        if drawing and drawing in self.files:
            try:
                root = ET.fromstring(self.files[drawing])
            except ET.ParseError:
                root = None
            if root is not None:
                for k, anchor in enumerate(root):
                    for el in anchor:
                        kind = _tag(el)
                        if kind == "AlternateContent":
                            choice = _child(el, "Choice")
                            inner = _child(choice, "sp") if choice is not None else None
                            if inner is not None:
                                el, kind = inner, "sp"
                        if kind in ("sp", "cxnSp"):
                            item = _shape_in(anchor, el, view, kind)
                            if item:
                                item["id"] = f"x{i}h{k}"
                                entry["shapes"].append(item)
                        elif kind in ("graphicFrame", "pic"):
                            nv = _child(el, "nvGraphicFramePr" if kind == "graphicFrame" else "nvPicPr")
                            c = _child(nv, "cNvPr") if nv is not None else None
                            entry["alts"]["charts" if kind == "graphicFrame" else "pics"].append((c.get("descr") or "") if c is not None else "")
                            if kind == "pic":
                                entry["macros"]["pics"].append((el.get("macro") or "").split("!")[-1].strip())
        if sheet in self.files:
            try:
                entry["sparks"] = _sparks_in(ET.fromstring(self.files[sheet]), name, view, f"x{i}")
            except ET.ParseError:
                pass
        entry["cellpics"] = self.cellpics(i, view)
        return entry
