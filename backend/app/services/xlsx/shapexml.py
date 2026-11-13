import re
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape, quoteattr

EMU = 9525
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"

LINE_PRESETS = {"line", "straightConnector1", "bentConnector3", "curvedConnector3"}
PRESETS = LINE_PRESETS | {
    "rect", "roundRect", "snip1Rect", "snip2SameRect", "round1Rect", "round2SameRect", "plaque", "bevel", "frame", "foldedCorner",
    "ellipse", "triangle", "rtTriangle", "parallelogram", "trapezoid", "diamond", "pentagon", "hexagon", "heptagon", "octagon", "chevron", "homePlate",
    "plus", "donut", "noSmoking", "blockArc", "heart", "smileyFace", "sun", "moon", "cloud", "lightningBolt", "cube", "can", "teardrop", "pie",
    "rightArrow", "leftArrow", "upArrow", "downArrow", "leftRightArrow", "upDownArrow", "bentArrow", "uturnArrow", "notchedRightArrow", "stripedRightArrow", "rightArrowCallout", "quadArrow",
    "star4", "star5", "star6", "star7", "star8", "star10", "star12", "star16", "star24", "star32", "ribbon2", "wave", "irregularSeal1",
    "wedgeRectCallout", "wedgeRoundRectCallout", "wedgeEllipseCallout", "cloudCallout", "borderCallout1",
    "flowChartProcess", "flowChartAlternateProcess", "flowChartDecision", "flowChartInputOutput", "flowChartPredefinedProcess", "flowChartDocument", "flowChartMultidocument",
    "flowChartTerminator", "flowChartPreparation", "flowChartManualInput", "flowChartManualOperation", "flowChartConnector", "flowChartOffpageConnector", "flowChartDelay",
    "flowChartDisplay", "flowChartMagneticDisk", "flowChartSort", "flowChartMerge", "flowChartExtract", "flowChartSummingJunction", "flowChartOr", "flowChartCollate",
    "flowChartInternalStorage", "flowChartPunchedCard",
}
LEGACY = {"arrow": "rightArrow", "line": "line"}
DASHES = {"solid", "dot", "dash", "lgDash", "dashDot", "lgDashDot", "lgDashDotDot", "sysDash", "sysDot", "sysDashDot", "sysDashDotDot"}
SCHEME = {"accent1": "4472C4", "accent2": "ED7D31", "accent3": "A5A5A5", "accent4": "FFC000", "accent5": "5B9BD5", "accent6": "70AD47", "dk1": "000000", "lt1": "FFFFFF", "tx1": "000000", "bg1": "FFFFFF", "dk2": "44546A", "lt2": "E7E6E6", "tx2": "44546A", "bg2": "E7E6E6"}
ALIGN = {"l": "l", "ctr": "ctr", "r": "r", "j": "just"}
ALIGN_IN = {"l": "l", "ctr": "ctr", "r": "r", "just": "j"}


def _hex(color, fallback: str | None) -> str | None:
    t = str(color or "").strip().lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{6}", t):
        return t.upper()
    if re.fullmatch(r"[0-9a-fA-F]{3}", t):
        return "".join(ch * 2 for ch in t).upper()
    return fallback


def _contrast(fill: str | None) -> str:
    if not fill:
        return "000000"
    r, g, b = (int(fill[i:i + 2], 16) for i in (0, 2, 4))
    return "000000" if 0.299 * r + 0.587 * g + 0.114 * b > 150 else "FFFFFF"


def _number(v, fallback: float) -> float:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else fallback


def preset_of(spec: dict) -> str:
    name = str(spec.get("shape") or "rect")
    name = LEGACY.get(name, name) if name == "arrow" else name
    return name if name in PRESETS else "rect"


def _line_xml(spec: dict, prst: str) -> str:
    if spec.get("noLine"):
        return "<a:ln><a:noFill/></a:ln>"
    color = _hex(spec.get("stroke"), "2F4B6E")
    width = max(0.0, min(100.0, _number(spec.get("lw"), 1.0)))
    dash = spec.get("dash") if spec.get("dash") in DASHES else "solid"
    parts = f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
    if dash != "solid":
        parts += f'<a:prstDash val="{dash}"/>'
    if spec.get("head"):
        parts += '<a:headEnd type="triangle"/>'
    if spec.get("tail"):
        parts += '<a:tailEnd type="triangle"/>'
    return f'<a:ln w="{int(width * 12700)}">{parts}</a:ln>'


def _fill_xml(spec: dict) -> tuple[str, str | None]:
    if spec.get("noFill"):
        return "<a:noFill/>", None
    color = _hex(spec.get("fill"), "4E79A7")
    alpha = _number(spec.get("opacity"), 1.0)
    inner = f'<a:alpha val="{int(max(0.0, min(1.0, alpha)) * 100000)}"/>' if alpha < 1 else ""
    return f'<a:solidFill><a:srgbClr val="{color}">{inner}</a:srgbClr></a:solidFill>', color


def _runs(spec: dict, fill: str | None) -> str:
    body = str(spec.get("text", ""))
    size = int(max(1.0, min(400.0, _number(spec.get("size"), 11.0))) * 100)
    color = _hex(spec.get("color"), None) or _contrast(fill)
    attrs = f' sz="{size}"'
    if spec.get("bold"):
        attrs += ' b="1"'
    if spec.get("italic"):
        attrs += ' i="1"'
    if spec.get("underline"):
        attrs += ' u="sng"'
    if spec.get("strike"):
        attrs += ' strike="sngStrike"'
    font = f'<a:latin typeface={quoteattr(str(spec["font"]))}/>' if spec.get("font") else ""
    align = ALIGN.get(spec.get("align") or "ctr", "ctr")
    out = ""
    for p in body.split("\n") or [""]:
        if p:
            out += f'<a:p><a:pPr algn="{align}"/><a:r><a:rPr lang="en-US"{attrs}><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>{font}</a:rPr><a:t>{escape(p)}</a:t></a:r></a:p>'
        else:
            out += f'<a:p><a:pPr algn="{align}"/><a:endParaRPr lang="en-US"{attrs}/></a:p>'
    return out


def element(obj: dict, ident: int, w: int, h: int, alt: str, macro: str = "") -> str:
    spec = obj.get("shape") or {}
    prst = preset_of(spec)
    rot = _number(spec.get("rot"), 0.0) % 360
    flips = (' flipH="1"' if spec.get("flipH") else "") + (' flipV="1"' if spec.get("flipV") else "")
    xfrm = f'<a:xfrm{f" rot={chr(34)}{int(rot * 60000)}{chr(34)}" if rot else ""}{flips}><a:off x="0" y="0"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>'
    geom = f'<a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom>'
    descr = f" descr={quoteattr(alt)}" if alt else ""
    if prst in LINE_PRESETS:
        return (
            f'<cxnSp macro={quoteattr(macro)}><nvCxnSpPr><cNvPr id="{ident}" name="Connector {ident}"{descr}/><cNvCxnSpPr/></nvCxnSpPr>'
            f"<spPr>{xfrm}{geom}{_line_xml(spec, prst)}</spPr></cxnSp>"
        )
    fill_xml, fill = _fill_xml(spec)
    anchor = {"t": "t", "b": "b"}.get(spec.get("valign") or "ctr", "ctr")
    return (
        f'<sp macro={quoteattr(macro)} textlink=""><nvSpPr><cNvPr id="{ident}" name="{"Button" if spec.get("button") else "Shape"} {ident}"{descr}/><cNvSpPr/></nvSpPr>'
        f"<spPr>{xfrm}{geom}{fill_xml}{_line_xml(spec, prst)}</spPr>"
        f'<txBody><a:bodyPr vertOverflow="clip" wrap="square" rtlCol="0" anchor="{anchor}"/><a:lstStyle/>{_runs(spec, fill)}</txBody></sp>'
    )


def _tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def _child(el: ET.Element | None, name: str) -> ET.Element | None:
    if el is None:
        return None
    for c in el:
        if _tag(c) == name:
            return c
    return None


def _color(el: ET.Element | None) -> str | None:
    if el is None:
        return None
    srgb = _child(el, "srgbClr")
    if srgb is not None and re.fullmatch(r"[0-9a-fA-F]{6}", srgb.get("val") or ""):
        return "#" + srgb.get("val", "").lower()
    scheme = _child(el, "schemeClr")
    if scheme is not None and scheme.get("val") in SCHEME:
        return "#" + SCHEME[scheme.get("val", "")].lower()
    return None


def _solid(el: ET.Element | None) -> str | None:
    return _color(_child(el, "solidFill"))


def _style_color(sp: ET.Element, ref: str) -> str | None:
    style = _child(sp, "style")
    r = _child(style, ref)
    return _color(r) if r is not None and r.get("idx", "0") != "0" else None


def parse(sp: ET.Element) -> dict | None:
    sp_pr = _child(sp, "spPr")
    geom = _child(sp_pr, "prstGeom")
    prst = geom.get("prst", "rect") if geom is not None else "rect"
    if prst not in PRESETS:
        return None
    spec: dict = {"shape": prst, "text": ""}
    xfrm = _child(sp_pr, "xfrm")
    if xfrm is not None:
        try:
            rot = int(xfrm.get("rot", "0")) / 60000
        except ValueError:
            rot = 0
        if rot % 360:
            spec["rot"] = round(rot % 360, 2)
        if xfrm.get("flipH") in ("1", "true"):
            spec["flipH"] = True
        if xfrm.get("flipV") in ("1", "true"):
            spec["flipV"] = True
    is_line = prst in LINE_PRESETS
    if _child(sp_pr, "noFill") is not None or is_line:
        spec["noFill"] = True
        spec["fill"] = "#4e79a7"
    else:
        spec["fill"] = _solid(sp_pr) or _style_color(sp, "fillRef") or "#4e79a7"
        alpha = next((a for a in sp_pr.iter() if _tag(a) == "alpha"), None) if sp_pr is not None else None
        if alpha is not None:
            try:
                spec["opacity"] = round(int(alpha.get("val", "100000")) / 100000, 2)
            except ValueError:
                pass
    ln = _child(sp_pr, "ln")
    if ln is not None and _child(ln, "noFill") is not None:
        spec["noLine"] = True
        spec["stroke"] = "#2f4b6e"
    else:
        spec["stroke"] = _solid(ln) or _style_color(sp, "lnRef") or "#2f4b6e"
        if ln is not None:
            if ln.get("w"):
                try:
                    spec["lw"] = round(int(ln.get("w", "12700")) / 12700, 2)
                except ValueError:
                    pass
            dash = _child(ln, "prstDash")
            if dash is not None and dash.get("val") in DASHES and dash.get("val") != "solid":
                spec["dash"] = dash.get("val")
            if _child(ln, "headEnd") is not None and _child(ln, "headEnd").get("type", "none") != "none":
                spec["head"] = True
            if _child(ln, "tailEnd") is not None and _child(ln, "tailEnd").get("type", "none") != "none":
                spec["tail"] = True
    body = _child(sp, "txBody")
    if body is None:
        return spec
    bp = _child(body, "bodyPr")
    if bp is not None and bp.get("anchor") in ("t", "b"):
        spec["valign"] = bp.get("anchor")
    lines = []
    for p in body:
        if _tag(p) != "p":
            continue
        text = ""
        for r in p:
            if _tag(r) == "r":
                t = _child(r, "t")
                text += (t.text or "") if t is not None else ""
                rpr = _child(r, "rPr")
                if rpr is not None:
                    if rpr.get("sz"):
                        try:
                            spec["size"] = int(rpr.get("sz", "1100")) / 100
                        except ValueError:
                            pass
                    for key, attr in (("bold", "b"), ("italic", "i")):
                        if rpr.get(attr) in ("1", "true"):
                            spec[key] = True
                    if rpr.get("u") not in (None, "none"):
                        spec["underline"] = True
                    if rpr.get("strike") not in (None, "noStrike"):
                        spec["strike"] = True
                    col = _solid(rpr)
                    if col:
                        spec["color"] = col
                    latin = _child(rpr, "latin")
                    if latin is not None and latin.get("typeface") and not latin.get("typeface", "").startswith("+"):
                        spec["font"] = latin.get("typeface")
            elif _tag(r) == "br":
                text += "\n"
            elif _tag(r) == "pPr" and r.get("algn") in ALIGN_IN:
                spec["align"] = ALIGN_IN[r.get("algn", "ctr")]
        lines.append(text)
    spec["text"] = "\n".join(lines).rstrip("\n")
    return spec
