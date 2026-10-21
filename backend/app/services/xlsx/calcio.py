import io
import re
import zipfile

from openpyxl.utils import get_column_letter, range_boundaries

MODE_OUT = {"auto": None, "tables": "autoNoTable", "manual": "manual"}
MODE_IN = {None: "auto", "auto": "auto", "autoNoTable": "tables", "manual": "manual"}
RULE_ATTR = {1: "evalError", 2: "calculatedColumn", 4: "twoDigitTextYear", 8: "numberStoredAsText", 16: "formula", 32: "formulaRange", 64: "unlockedFormula", 128: "emptyCellReference", 256: "listDataValidation"}
ATTR_RULE = {v: k for k, v in RULE_ATTR.items()}
IGNORE_LIMIT = 20000


def parse(text: str) -> tuple[dict[str, str], list[tuple[int, int, int, int]]]:
    values: dict[str, str] = {}
    ignored: list[tuple[int, int, int, int]] = []
    for line in (text or "").splitlines():
        key, _, val = line.partition("=")
        if key == "ignore":
            try:
                s, r, c, rule = (int(x) for x in val.split(","))
                ignored.append((s, r, c, rule))
            except ValueError:
                continue
        elif key:
            values[key.strip()] = val.strip()
    return values, ignored


def render(values: dict[str, str], ignored: list[tuple[int, int, int, int]]) -> str:
    out = [f"{k}={v}" for k, v in values.items()]
    out.extend(f"ignore={s},{r},{c},{rule}" for s, r, c, rule in ignored)
    return "\n".join(out) + "\n"


def calc_out(wb, text: str) -> list[tuple[int, int, int, int]]:
    values, ignored = parse(text)
    cp = wb.calculation
    cp.calcMode = MODE_OUT.get(values.get("mode", "auto"))
    cp.refMode = "R1C1" if values.get("style") == "r1c1" else None
    iterate = values.get("iterate") == "1"
    cp.iterate = True if iterate else None
    cp.iterateCount = int(values.get("iterations", 100)) if iterate else None
    cp.iterateDelta = float(values.get("delta", 0.001)) if iterate else None
    cp.calcOnSave = None if values.get("save", "1") == "1" else False
    threads = int(values.get("threads", 0) or 0)
    cp.concurrentCalc = None if threads != 1 else False
    cp.fullCalcOnLoad = True
    return ignored


def calc_in(wb) -> dict[str, str]:
    cp = wb.calculation
    values = {"mode": MODE_IN.get(cp.calcMode, "auto"), "style": "r1c1" if cp.refMode == "R1C1" else "a1"}
    if cp.iterate:
        values["iterate"] = "1"
        values["iterations"] = str(cp.iterateCount if cp.iterateCount else 100)
        values["delta"] = repr(float(cp.iterateDelta if cp.iterateDelta is not None else 0.001))
    if cp.calcOnSave is False:
        values["save"] = "0"
    if cp.concurrentCalc is False:
        values["threads"] = "1"
    return values


def ignored_xml(entries: list[tuple[int, int, int, int]], sheet: int) -> str:
    by_rule: dict[int, list[tuple[int, int]]] = {}
    for s, r, c, rule in entries:
        if s == sheet and rule in RULE_ATTR:
            by_rule.setdefault(rule, []).append((r, c))
    if not by_rule:
        return ""
    parts = []
    for rule, cells in sorted(by_rule.items()):
        sqref = " ".join(f"{get_column_letter(c + 1)}{r + 1}" for r, c in sorted(cells)[:IGNORE_LIMIT])
        parts.append(f'<ignoredError sqref="{sqref}" {RULE_ATTR[rule]}="1"/>')
    return "<ignoredErrors>" + "".join(parts) + "</ignoredErrors>"


def ignored_cells(attrs: dict[str, str], sheet: int) -> list[tuple[int, int, int, int]]:
    out: list[tuple[int, int, int, int]] = []
    sqref = attrs.get("sqref", "")
    rules = [ATTR_RULE[k] for k, v in attrs.items() if k in ATTR_RULE and v in ("1", "true")]
    for part in sqref.split():
        try:
            c0, r0, c1, r1 = range_boundaries(part)
        except (TypeError, ValueError):
            continue
        for r in range(r0 - 1, min(r1, r0 + 999)):
            for c in range(c0 - 1, min(c1, c0 + 99)):
                for rule in rules:
                    out.append((sheet, r, c, rule))
                    if len(out) >= IGNORE_LIMIT:
                        return out
    return out


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DYNAMIC_CELL = re.compile(rb"<c\s[^>]*?\bcm=\"\d+\"[^>]*>")
IGNORED_TAG = re.compile(rb"<ignoredError\s([^>]*?)/?>")
ATTR = re.compile(rb"([A-Za-z:]+)=\"([^\"]*)\"")
REF_ATTR = re.compile(rb"\br=\"([A-Z]+\d+)\"")
AFTER_IGNORED = (b"<smartTags", b"<drawing", b"<legacyDrawing", b"<picture", b"<oleObjects", b"<controls", b"<webPublishItems", b"<tableParts", b"<extLst", b"</worksheet>")
METADATA = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    f'<metadata xmlns="{MAIN_NS}" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">'
    '<metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>'
    '<futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata>'
    '<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>'
)


def _sheet_paths(zf: zipfile.ZipFile) -> list[str]:
    try:
        book = zf.read("xl/workbook.xml")
        rels = zf.read("xl/_rels/workbook.xml.rels")
    except KeyError:
        return []
    target = {}
    for m in re.finditer(rb"<Relationship\s([^>]*?)/?>", rels):
        a = {k.decode(): v.decode() for k, v in ATTR.findall(m.group(1))}
        target[a.get("Id")] = (a.get("Target", ""), a.get("Type", ""))
    out = []
    for m in re.finditer(rb"<(?:\w+:)?sheet\s([^>]*?)/?>", book):
        a = {k.decode(): v.decode() for k, v in ATTR.findall(m.group(1))}
        rid = next((v for k, v in a.items() if k.endswith(":id") or k == "id"), None)
        t, kind = target.get(rid, ("", ""))
        if kind.endswith("/worksheet"):
            out.append(t.lstrip("/") if t.startswith("/") else "xl/" + t)
    return out


def scan(data: bytes) -> list[dict]:
    out: list[dict] = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for i, path in enumerate(_sheet_paths(zf)):
                xml = zf.read(path)
                dynamic = set()
                for m in DYNAMIC_CELL.finditer(xml):
                    ref = REF_ATTR.search(m.group(0))
                    if ref:
                        dynamic.add(ref.group(1).decode())
                ignored: list[tuple[int, int, int, int]] = []
                for m in IGNORED_TAG.finditer(xml):
                    attrs = {k.decode(): v.decode() for k, v in ATTR.findall(m.group(1))}
                    ignored.extend(ignored_cells(attrs, i))
                out.append({"dynamic": dynamic, "ignored": ignored})
    except (zipfile.BadZipFile, KeyError):
        return []
    return out


def finish(data: bytes, dynamic: list[list[str]], ignored: list[tuple[int, int, int, int]]) -> bytes:
    if not any(dynamic) and not ignored:
        return data
    src = zipfile.ZipFile(io.BytesIO(data))
    paths = _sheet_paths(src)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            blob = src.read(item.filename)
            if item.filename in paths:
                i = paths.index(item.filename)
                for ref in (dynamic[i] if i < len(dynamic) else []):
                    blob = re.sub(rb"(<c\s[^>]*?\br=\"" + ref.encode() + rb"\")", rb'\1 cm="1"', blob, count=1)
                xml = ignored_xml(ignored, i).encode()
                if xml:
                    at = min((blob.find(tag) for tag in AFTER_IGNORED if blob.find(tag) >= 0), default=len(blob))
                    blob = blob[:at] + xml + blob[at:]
            elif item.filename == "[Content_Types].xml" and any(dynamic):
                blob = blob.replace(b"</Types>", b'<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/></Types>')
            elif item.filename == "xl/_rels/workbook.xml.rels" and any(dynamic):
                blob = blob.replace(b"</Relationships>", b'<Relationship Id="rIdMeta1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>')
            dst.writestr(item, blob)
        if any(dynamic):
            dst.writestr("xl/metadata.xml", METADATA)
    return out.getvalue()
