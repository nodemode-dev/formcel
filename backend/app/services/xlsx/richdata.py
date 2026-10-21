import posixpath
import re
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_RD = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"
NS_RD2 = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_VREL = "http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel"
NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
FUTURE_URI = "{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"
PARTS = {
    "xl/richData/rdrichvalue.xml": ("application/vnd.ms-excel.rdrichvalue+xml", "http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue"),
    "xl/richData/rdrichvaluestructure.xml": ("application/vnd.ms-excel.rdrichvaluestructure+xml", "http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure"),
    "xl/richData/rdRichValueTypes.xml": ("application/vnd.ms-excel.rdrichvaluetypes+xml", "http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueTypes"),
    "xl/richData/richValueRel.xml": ("application/vnd.ms-excel.richvaluerel+xml", "http://schemas.microsoft.com/office/2022/10/relationships/richValueRel"),
}
IMAGE_TYPES = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp", "webp": "image/webp"}
CALC_ORIGIN_PLACED = 5
TYPES_XML = (
    f'<rvTypesInfo xmlns="{NS_RD2}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="{NS_MAIN}"><global><keyFlags>'
    '<key name="_Self"><flag name="ExcludeFromFile" value="1"/><flag name="ExcludeFromCalcComparison" value="1"/></key>'
    + "".join(f'<key name="{n}"><flag name="ExcludeFromCalcComparison" value="1"/></key>' for n in ("_DisplayString", "_Flags", "_Format", "_SubLabel", "_Attribution", "_Icon", "_Display", "_CanonicalPropertyNames", "_ClassificationId"))
    + "</keyFlags></global></rvTypesInfo>"
)
HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def _rels_path(part: str) -> str:
    head, _, tail = part.rpartition("/")
    return f"{head}/_rels/{tail}.rels"


def _merge_metadata(files: dict[str, bytes], count: int) -> tuple[int, bool]:
    future = f'<futureMetadata name="XLRICHVALUE" count="{count}">' + "".join(f'<bk><extLst><ext uri="{FUTURE_URI}"><xlrd:rvb i="{i}"/></ext></extLst></bk>' for i in range(count)) + "</futureMetadata>"
    value = f'<valueMetadata count="{count}">' + "".join('<bk><rc t="{t}" v="%d"/></bk>' % i for i in range(count)) + "</valueMetadata>"
    kind = '<metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/>'
    old = files.get("xl/metadata.xml")
    if old is None:
        text = HEAD + f'<metadata xmlns="{NS_MAIN}" xmlns:xlrd="{NS_RD}"><metadataTypes count="1">{kind}</metadataTypes>{future}{value}</metadata>'
        files["xl/metadata.xml"] = text.replace("{t}", "1").encode()
        return 1, True
    text = old.decode("utf-8")
    m = re.search(r'<metadataTypes count="(\d+)">', text)
    t = int(m.group(1)) + 1 if m else 1
    if m:
        text = text.replace(m.group(0), f'<metadataTypes count="{t}">', 1)
        text = text.replace("</metadataTypes>", kind + "</metadataTypes>", 1)
    else:
        text = text.replace("</metadata>", f'<metadataTypes count="1">{kind}</metadataTypes></metadata>', 1)
        t = 1
    if "xmlns:xlrd=" not in text:
        text = text.replace("<metadata ", f'<metadata xmlns:xlrd="{NS_RD}" ', 1)
    at = text.find("<cellMetadata")
    if at < 0:
        at = text.rfind("</metadata>")
    text = text[:at] + future + text[at:]
    text = text.replace("</metadata>", value.replace("{t}", str(t)) + "</metadata>", 1)
    files["xl/metadata.xml"] = text.encode()
    return t, False


def write(files: dict[str, bytes], items: list[tuple[str, list[dict]]]) -> None:
    pics = [(path, p) for path, group in items for p in group]
    if not pics:
        return
    media: list[tuple[str, bytes]] = []
    media_of: dict[bytes, int] = {}
    taken = {n for n in files if n.startswith("xl/media/")}
    n = 1
    for _, p in pics:
        data = p["data"]
        if data in media_of:
            continue
        ext = p.get("ext", "png") if p.get("ext") in IMAGE_TYPES else "png"
        while f"xl/media/image{n}.{ext}" in taken:
            n += 1
        name = f"xl/media/image{n}.{ext}"
        taken.add(name)
        files[name] = data
        media_of[data] = len(media)
        media.append((name, data))
    has_alt = any(p.get("alt") for _, p in pics)
    structure = '<s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s>'
    if has_alt:
        structure += '<s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/><k n="Text" t="s"/></s>'
    values = ""
    for _, p in pics:
        rel = media_of[p["data"]]
        if p.get("alt"):
            values += f'<rv s="1"><v>{rel}</v><v>{CALC_ORIGIN_PLACED}</v><v>{escape(str(p["alt"]))}</v></rv>'
        else:
            values += f'<rv s="0"><v>{rel}</v><v>{CALC_ORIGIN_PLACED}</v></rv>'
    structures = 2 if has_alt else 1
    files["xl/richData/rdrichvalue.xml"] = (HEAD + f'<rvData xmlns="{NS_RD}" count="{len(pics)}">{values}</rvData>').encode()
    files["xl/richData/rdrichvaluestructure.xml"] = (HEAD + f'<rvStructures xmlns="{NS_RD}" count="{structures}">{structure}</rvStructures>').encode()
    files["xl/richData/rdRichValueTypes.xml"] = (HEAD + TYPES_XML).encode()
    files["xl/richData/richValueRel.xml"] = (HEAD + f'<richValueRels xmlns="{NS_VREL}" xmlns:r="{NS_REL}">' + "".join(f'<rel r:id="rId{i + 1}"/>' for i in range(len(media))) + "</richValueRels>").encode()
    rels = "".join(f'<Relationship Id="rId{i + 1}" Type="{NS_REL}/image" Target="../media/{posixpath.basename(name)}"/>' for i, (name, _) in enumerate(media))
    files["xl/richData/_rels/richValueRel.xml.rels"] = (HEAD + f'<Relationships xmlns="{NS_PKG}">{rels}</Relationships>').encode()
    _merge_metadata(files, len(pics))
    ct = files["[Content_Types].xml"].decode("utf-8")
    add = ""
    for ext in {posixpath.splitext(name)[1][1:] for name, _ in media}:
        if f'Extension="{ext}"' not in ct:
            add += f'<Default Extension="{ext}" ContentType="{IMAGE_TYPES[ext]}"/>'
    for part, (ctype, _) in PARTS.items():
        if f'PartName="/{part}"' not in ct:
            add += f'<Override PartName="/{part}" ContentType="{ctype}"/>'
    if 'PartName="/xl/metadata.xml"' not in ct:
        add += '<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>'
    files["[Content_Types].xml"] = ct.replace("</Types>", add + "</Types>").encode()
    wrels = files["xl/_rels/workbook.xml.rels"].decode("utf-8")
    ids = [int(x) for x in re.findall(r'Id="rId(\d+)"', wrels)]
    top = max(ids, default=0)
    add = ""
    for part, (_, rtype) in PARTS.items():
        top += 1
        add += f'<Relationship Id="rId{top}" Type="{rtype}" Target="{part[3:]}"/>'
    if "/relationships/sheetMetadata" not in wrels:
        top += 1
        add += f'<Relationship Id="rId{top}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>'
    files["xl/_rels/workbook.xml.rels"] = wrels.replace("</Relationships>", add + "</Relationships>").encode()
    seq = 0
    for path, group in items:
        xml = files[path].decode("utf-8")
        for p in group:
            seq += 1
            ref = p["ref"]
            m = re.search(r'<c\s[^>]*?\br="' + ref + r'"[^>]*?(/?)>', xml)
            if m is None:
                continue
            tag = m.group(0)
            head = re.sub(r'\s(?:t|vm)="[^"]*"', "", tag[:-2] if m.group(1) else tag[:-1]) + f' t="e" vm="{seq}"'
            xml = xml[: m.start()] + head + ("><v>#VALUE!</v></c>" if m.group(1) else ">") + xml[m.end():]
        files[path] = xml.encode()


def _local(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def _rels(files: dict[str, bytes], part: str) -> dict[str, str]:
    raw = files.get(_rels_path(part))
    out: dict[str, str] = {}
    if raw is None:
        return out
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return out
    base = posixpath.dirname(part)
    for r in root:
        target = r.get("Target", "")
        out[r.get("Id", "")] = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(base, target))
    return out


def has(files: dict[str, bytes]) -> bool:
    return "xl/richData/rdrichvalue.xml" in files and "xl/metadata.xml" in files


def _find(files: dict[str, bytes], suffix: str) -> str | None:
    rels = _rels(files, "xl/workbook.xml")
    root_rels = files.get("xl/_rels/workbook.xml.rels", b"").decode("utf-8", "replace")
    for m in re.finditer(r"<Relationship\b([^>]*?)/?>", root_rels):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        if attrs.get("Type", "").endswith(suffix) and attrs.get("Id") in rels:
            return rels[attrs["Id"]]
    return None


def images(files: dict[str, bytes], sheet: str) -> dict[tuple[int, int], dict]:
    if not has(files) or sheet not in files:
        return {}
    value_part = _find(files, "/rdRichValue") or "xl/richData/rdrichvalue.xml"
    struct_part = _find(files, "/rdRichValueStructure") or "xl/richData/rdrichvaluestructure.xml"
    rel_part = _find(files, "/richValueRel") or "xl/richData/richValueRel.xml"
    try:
        meta = ET.fromstring(files["xl/metadata.xml"])
        values = ET.fromstring(files[value_part])
        structs = ET.fromstring(files[struct_part])
        relroot = ET.fromstring(files[rel_part])
    except (ET.ParseError, KeyError):
        return {}
    kinds = [m.get("name", "") for m in meta.iter() if _local(m) == "metadataType"]
    futures: dict[str, list[int]] = {}
    for fm in meta.iter():
        if _local(fm) == "futureMetadata":
            futures[fm.get("name", "")] = [int(x.get("i", "0")) for x in fm.iter() if _local(x) == "rvb"]
    value_blocks: list[tuple[int, int]] = []
    for vm in meta.iter():
        if _local(vm) == "valueMetadata":
            for bk in vm:
                rc = next((x for x in bk if _local(x) == "rc"), None)
                value_blocks.append((int(rc.get("t", "0")), int(rc.get("v", "0"))) if rc is not None else (0, 0))
    keys: list[list[str]] = [[k.get("n", "") for k in s if _local(k) == "k"] for s in structs if _local(s) == "s"]
    rvs: list[tuple[int, list[str]]] = []
    for rv in values:
        if _local(rv) == "rv":
            rvs.append((int(rv.get("s", "0")), [(v.text or "") for v in rv if _local(v) == "v"]))
    rids = [r.get(f"{{{NS_REL}}}id", "") for r in relroot if _local(r) == "rel"]
    targets = _rels(files, rel_part)
    out: dict[tuple[int, int], dict] = {}
    for m in re.finditer(r"<c\s([^>]*?)(?:/>|>(.*?)</c>)", files[sheet].decode("utf-8", "replace"), re.S):
        attrs = dict(re.findall(r'([\w:]+)="([^"]*)"', m.group(1)))
        if "vm" not in attrs or "r" not in attrs:
            continue
        try:
            t, v = value_blocks[int(attrs["vm"]) - 1]
            if kinds[t - 1] != "XLRICHVALUE":
                continue
            s, vals = rvs[futures["XLRICHVALUE"][v]]
            names = keys[s]
            if "_rvRel:LocalImageIdentifier" not in names:
                continue
            path = targets.get(rids[int(vals[names.index("_rvRel:LocalImageIdentifier")])])
            if not path or path not in files:
                continue
        except (ValueError, IndexError, KeyError):
            continue
        ref = re.fullmatch(r"([A-Z]+)(\d+)", attrs["r"])
        if not ref:
            continue
        col = 0
        for ch in ref.group(1):
            col = col * 26 + ord(ch) - 64
        alt = vals[names.index("Text")] if "Text" in names and names.index("Text") < len(vals) else ""
        out[(int(ref.group(2)) - 1, col - 1)] = {"path": path, "alt": alt, "formula": "<f" in (m.group(2) or "")}
    return out
