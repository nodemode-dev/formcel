import io
import re
import zipfile
from xml.sax.saxutils import escape, quoteattr

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
QT_REL = NS_REL + "/queryTable"
CONN_REL = NS_REL + "/connections"
QT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"
CONN_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"


def _unxml(s: str) -> str:
    return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")


def _table_parts(files: dict[str, bytes]) -> dict[str, str]:
    out = {}
    for name, blob in files.items():
        if re.fullmatch(r"xl/tables/table\d+\.xml", name):
            m = re.search(r'<table\b[^>]*?\bname="([^"]*)"', blob.decode("utf-8"))
            if m:
                out[_unxml(m.group(1))] = name
    return out


def _add_override(ct: str, part: str, kind: str) -> str:
    return ct.replace("</Types>", f'<Override PartName="/{part}" ContentType="{kind}"/></Types>')


def _workbook_rels(files: dict[str, bytes]) -> tuple[str, str]:
    path = "xl/_rels/workbook.xml.rels"
    xml = files[path].decode("utf-8")
    return path, xml


def _next_rid(xml: str) -> str:
    ids = [int(x) for x in re.findall(r'Id="rId(\d+)"', xml)]
    return f"rId{max(ids, default=0) + 1}"


def finish(data: bytes, queries: list[dict] | None) -> bytes:
    wanted = [q for q in (queries or []) if q.get("asTable") and q.get("tableName") and q.get("name")]
    if not wanted:
        return data
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        files = {n: z.read(n) for n in z.namelist()}
    parts = _table_parts(files)
    conns: list[str] = []
    ct = files["[Content_Types].xml"].decode("utf-8")
    used: set[str] = set()
    for q in wanted:
        part = parts.get(q["tableName"])
        if not part or part in used:
            continue
        used.add(part)
        n = len(conns) + 1
        xml = files[part].decode("utf-8")
        cols = re.findall(r'<tableColumn\b[^>]*?\bname="([^"]*)"', xml)
        if not cols or 'tableType="' in xml:
            continue
        xml = re.sub(r"<table\b", f'<table tableType="queryTable" connectionId="{n}"', xml, count=1)
        counter = iter(range(1, len(cols) + 1))
        xml = re.sub(r'<tableColumn\b([^>]*?)\bname="([^"]*)"', lambda m: f'<tableColumn{m.group(1)}uniqueName="{m.group(2)}" queryTableFieldId="{next(counter)}" name="{m.group(2)}"', xml)
        files[part] = xml.encode("utf-8")
        qpart = f"xl/queryTables/queryTable{n}.xml"
        fields = "".join(f'<queryTableField id="{i + 1}" name="{c}" tableColumnId="{i + 1}"/>' for i, c in enumerate(cols))
        files[qpart] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<queryTable xmlns="{NS_MAIN}" name="ExternalData_{n}" connectionId="{n}" autoFormatId="16" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0">'
            f'<queryTableRefresh nextId="{len(cols) + 1}"><queryTableFields count="{len(cols)}">{fields}</queryTableFields></queryTableRefresh></queryTable>'
        ).encode("utf-8")
        ct = _add_override(ct, qpart, QT_TYPE)
        rels = part.replace("xl/tables/", "xl/tables/_rels/") + ".rels"
        files[rels] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="{NS_PKG}"><Relationship Id="rId1" Type="{QT_REL}" Target="../queryTables/queryTable{n}.xml"/></Relationships>'
        ).encode("utf-8")
        name = q["name"]
        text = f'Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location="{name}";Extended Properties=""'
        conns.append(
            f'<connection id="{n}" name={quoteattr("Query - " + name)} description={quoteattr(f"Connection to the {chr(39)}{name}{chr(39)} query in the workbook.")} type="5" refreshedVersion="6" background="1" saveData="1">'
            f'<dbPr connection={quoteattr(text)} command={quoteattr("SELECT * FROM [" + name + "]")}/></connection>'
        )
    if not conns:
        return data
    files["xl/connections.xml"] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="{NS_MAIN}">{"".join(conns)}</connections>').encode("utf-8")
    ct = _add_override(ct, "xl/connections.xml", CONN_TYPE)
    files["[Content_Types].xml"] = ct.encode("utf-8")
    path, rels = _workbook_rels(files)
    files[path] = rels.replace("</Relationships>", f'<Relationship Id="{_next_rid(rels)}" Type="{CONN_REL}" Target="connections.xml"/></Relationships>').encode("utf-8")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", files.pop("[Content_Types].xml"))
        for n, blob in files.items():
            z.writestr(n, blob)
    return out.getvalue()
