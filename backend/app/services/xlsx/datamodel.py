import io
import re
import zipfile
from xml.sax.saxutils import escape, quoteattr

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_DS = "http://schemas.openxmlformats.org/officeDocument/2006/customXml"
NS_X15 = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"
FC_NS = "urn:formcel:datamodel"
CONN_NAME = "ThisWorkbookDataModel"
CONN_REL = NS_REL + "/connections"
CONN_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"
CUSTOM_REL = NS_REL + "/customXml"
PROPS_REL = NS_REL + "/customXmlProps"
PROPS_TYPE = "application/vnd.openxmlformats-officedocument.customXmlProperties+xml"
CUBE = re.compile(r"(?<![A-Za-z0-9_.])CUBE(?:MEMBERPROPERTY|MEMBER|VALUE|SETCOUNT|SET|RANKEDMEMBER|KPIMEMBER)\s*\(", re.I)
CTRL = re.compile("[\x00-\x08\x0b-\x1f]")
PICTURE = re.compile("[␀-␟]")
NOTE = "FormCel's own definition of the workbook Data Model. Excel does not read this part; it cannot refresh a Data Model from it."


def _pack(s: str) -> str:
    return CTRL.sub(lambda m: chr(0x2400 + ord(m.group(0))), s)


def _unpack(s: str) -> str:
    return PICTURE.sub(lambda m: chr(ord(m.group(0)) - 0x2400), s)


def cube_values(eng) -> dict[int, dict[tuple[int, int], tuple[str, str]]]:
    out: dict[int, dict[tuple[int, int], tuple[str, str]]] = {}
    for i in range(len(eng.sheet_names())):
        wanted = {(r, c) for r, c, k, t in eng.typed(i) if k == "f" and CUBE.search(t)}
        if not wanted:
            continue
        out[i] = {(r, c): (k, t) for r, c, k, t in eng.results(i) if (r, c) in wanted}
    return out


def _read_all(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n: z.read(n) for n in z.namelist()}


def _sheet_files(files: dict[str, bytes], names: list[str]) -> dict[int, str]:
    wb = files["xl/workbook.xml"].decode("utf-8")
    rels = files["xl/_rels/workbook.xml.rels"].decode("utf-8")
    target = {}
    for m in re.finditer(r"<Relationship\b([^>]*)/?>", rels):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        if "Id" in attrs and "Target" in attrs:
            t = attrs["Target"]
            target[attrs["Id"]] = t.lstrip("/") if t.startswith("/") else "xl/" + t
    out: dict[int, str] = {}
    for pos, m in enumerate(re.finditer(r"<sheet\b([^>]*)/?>", wb)):
        attrs = dict(re.findall(r'([\w:]+)="([^"]*)"', m.group(1)))
        path = target.get(attrs.get("r:id", ""))
        if path:
            out[pos] = path
    return out


def _cell(ref: str, attrs: str, t: str, f: str, v: str) -> str:
    attrs = re.sub(r' t="[^"]*"', "", attrs)
    return '<c r="' + ref + '"' + attrs + t + "><f>" + f + "</f><v>" + escape(v) + "</v></c>"


def _cached(xml: str, cells: dict[tuple[int, int], tuple[str, str]]) -> str:
    from openpyxl.utils import get_column_letter

    for (r, c), (kind, text) in cells.items():
        ref = f"{get_column_letter(c + 1)}{r + 1}"
        pat = re.compile(r'<c r="' + ref + r'"((?: [A-Za-z:]+="[^"]*")*)><f>(.*?)</f><v\s*/></c>', re.S)
        if kind == "n":
            t, v = "", text
        elif kind == "b":
            t, v = ' t="b"', "1" if text.upper() == "TRUE" else "0"
        elif kind == "e":
            t, v = ' t="e"', text
        else:
            t, v = ' t="str"', text
        xml = pat.sub(lambda m: _cell(ref, m.group(1), t, m.group(2), v), xml, count=1)
    return xml


def _next_part(files: dict[str, bytes], pattern: str) -> int:
    nums = [int(m.group(1)) for n in files for m in [re.fullmatch(pattern, n)] if m]
    return max(nums, default=0) + 1


def _rid(rels: str) -> str:
    return "rId" + str(max([int(x) for x in re.findall(r'Id="rId(\d+)"', rels)], default=0) + 1)


def _unwire(s: str) -> str:
    return re.sub(r"\\(.)", lambda m: {"t": "\t", "n": "\n", "r": "\r"}.get(m.group(1), m.group(1)), s)


def finish(data: bytes, eng) -> bytes:
    lines = eng.model_lines()
    conns = [(_unwire(p[1]), _unwire(p[2])) for p in (l.split("\t") for l in lines) if len(p) >= 3 and p[0] == "X"]
    cells = cube_values(eng)
    if not lines and not cells:
        return data
    files = _read_all(data)
    ct = files["[Content_Types].xml"].decode("utf-8")
    sheets = _sheet_files(files, eng.sheet_names())
    for i, vals in cells.items():
        path = sheets.get(i)
        if path and path in files:
            files[path] = _cached(files[path].decode("utf-8"), vals).encode("utf-8")
    existing = files.get("xl/connections.xml")
    ids = [int(x) for x in re.findall(r'<connection\b[^>]*?\bid="(\d+)"', existing.decode("utf-8"))] if existing else []
    nxt = max(ids, default=0)
    parts = []
    if "name=\"" + CONN_NAME + "\"" not in (existing or b"").decode("utf-8"):
        nxt += 1
        parts.append(
            f'<connection id="{nxt}" name="{CONN_NAME}" description="This workbook\'s Data Model" type="5" refreshedVersion="6" minRefreshableVersion="5" background="1" saveData="1">'
            f'<dbPr connection="Data Model Connection" command="Model" commandType="1"/>'
            f'<extLst><ext uri="{{DE250136-89BD-433C-8126-D09CA5730AF9}}" xmlns:x15="{NS_X15}"><x15:connection id="" model="1"/></ext></extLst></connection>'
        )
    for name, text in conns or []:
        nxt += 1
        parts.append(f'<connection id="{nxt}" name={quoteattr(name)} description={quoteattr("OLAP connection defined in FormCel (untested)")} type="5" refreshedVersion="6" background="1" saveData="1" olap="1"><dbPr connection={quoteattr(text)} command="" commandType="1"/></connection>')
    if parts:
        if existing:
            files["xl/connections.xml"] = existing.decode("utf-8").replace("</connections>", "".join(parts) + "</connections>").encode("utf-8")
        else:
            files["xl/connections.xml"] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="{NS_MAIN}">{"".join(parts)}</connections>').encode("utf-8")
            ct = ct.replace("</Types>", f'<Override PartName="/xl/connections.xml" ContentType="{CONN_TYPE}"/></Types>')
            rels = files["xl/_rels/workbook.xml.rels"].decode("utf-8")
            files["xl/_rels/workbook.xml.rels"] = rels.replace("</Relationships>", f'<Relationship Id="{_rid(rels)}" Type="{CONN_REL}" Target="connections.xml"/></Relationships>').encode("utf-8")
    if lines:
        n = _next_part(files, r"customXml/item(\d+)\.xml")
        body = "".join(f"<l>{escape(_pack(l))}</l>" for l in lines)
        files[f"customXml/item{n}.xml"] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<formcelDataModel xmlns="{FC_NS}" version="1" note={quoteattr(NOTE)}>{body}</formcelDataModel>').encode("utf-8")
        files[f"customXml/itemProps{n}.xml"] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ds:datastoreItem ds:itemID="{{6F1C2B7E-3A4D-4E55-9C0B-{n:012d}}}" xmlns:ds="{NS_DS}"><ds:schemaRefs><ds:schemaRef ds:uri="{FC_NS}"/></ds:schemaRefs></ds:datastoreItem>').encode("utf-8")
        files[f"customXml/_rels/item{n}.xml.rels"] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="{NS_PKG}"><Relationship Id="rId1" Type="{PROPS_REL}" Target="itemProps{n}.xml"/></Relationships>').encode("utf-8")
        ct = ct.replace("</Types>", f'<Override PartName="/customXml/itemProps{n}.xml" ContentType="{PROPS_TYPE}"/></Types>')
        rels = files["xl/_rels/workbook.xml.rels"].decode("utf-8")
        files["xl/_rels/workbook.xml.rels"] = rels.replace("</Relationships>", f'<Relationship Id="{_rid(rels)}" Type="{CUSTOM_REL}" Target="../customXml/item{n}.xml"/></Relationships>').encode("utf-8")
    files["[Content_Types].xml"] = ct.encode("utf-8")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", files.pop("[Content_Types].xml"))
        for n, blob in files.items():
            z.writestr(n, blob)
    return out.getvalue()


def read(data: bytes) -> tuple[list[str], list[tuple[str, str]], bool]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = z.namelist()
            lines: list[str] = []
            for n in names:
                if re.fullmatch(r"customXml/item\d+\.xml", n):
                    xml = z.read(n).decode("utf-8", "replace")
                    if f'xmlns="{FC_NS}"' in xml[:400]:
                        lines = [_unpack(_unxml(m)) for m in re.findall(r"<l>(.*?)</l>", xml, re.S)]
            conns: list[tuple[str, str]] = []
            if "xl/connections.xml" in names:
                xml = z.read("xl/connections.xml").decode("utf-8", "replace")
                for m in re.finditer(r"<connection\b([^>]*)>(.*?)</connection>", xml, re.S):
                    attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
                    db = re.search(r'<dbPr\b[^>]*?\bconnection="([^"]*)"', m.group(2))
                    if attrs.get("olap") == "1" and db and attrs.get("name"):
                        conns.append((_unxml(attrs["name"]), _unxml(db.group(1))))
            return lines, conns, "xl/model/item.data" in names
    except (zipfile.BadZipFile, KeyError, UnicodeDecodeError):
        return [], [], False


def _unxml(s: str) -> str:
    return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")
