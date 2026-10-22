import json
import re

from . import project as P

BIN = "xl/vbaProject.bin"
NAMES = "fc/codenames.json"
VALID = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,30}$")


def collect_codenames(wb) -> bytes:
    sheets = [[ws.title, getattr(ws.sheet_properties, "codeName", None) or ""] for ws in wb.worksheets]
    return json.dumps({"workbook": getattr(wb, "code_name", None) or "ThisWorkbook", "sheets": sheets}).encode()


def apply_codenames(wb, parts: dict[str, bytes]) -> None:
    raw = parts.get(NAMES)
    if not raw:
        return
    try:
        doc = json.loads(raw)
    except ValueError:
        return
    wb.code_name = doc.get("workbook") or "ThisWorkbook"
    sheets = doc.get("sheets") or []
    by_name = {n: c for n, c in sheets}
    same = len(sheets) == len(wb.worksheets)
    for i, ws in enumerate(wb.worksheets):
        code = by_name.get(ws.title) or (sheets[i][1] if same else "")
        if code:
            ws.sheet_properties.codeName = code


def code_names(parts: dict[str, bytes] | None, titles: list[str]) -> tuple[str, list[str]]:
    doc = {}
    if parts and parts.get(NAMES):
        try:
            doc = json.loads(parts[NAMES])
        except ValueError:
            doc = {}
    sheets = doc.get("sheets") or []
    by_name = {n: c for n, c in sheets}
    same = len(sheets) == len(titles)
    return doc.get("workbook") or "ThisWorkbook", [by_name.get(t) or (sheets[i][1] if same and sheets[i][1] else "") for i, t in enumerate(titles)]


def read(parts: dict[str, bytes] | None, titles: list[str]) -> dict:
    book, codes = code_names(parts, titles)
    out = {"present": False, "locked": False, "name": "VBAProject", "workbook": book, "sheets": [{"name": t, "codeName": c} for t, c in zip(titles, codes)], "modules": [], "error": ""}
    if not parts or BIN not in parts:
        return out
    out["present"] = True
    try:
        pr = P.parse(parts[BIN])
    except Exception as e:
        out["error"] = f"The macro project could not be read: {e}"
        return out
    out["name"] = pr.name
    out["locked"] = pr.locked
    out["modules"] = [{"name": m.name, "kind": m.kind, "code": m.code, "header": m.header, "private": m.private, "procAttrs": m.procattrs} for m in pr.modules]
    return out


def _check(mods: list[dict]) -> list[P.Module]:
    seen: set[str] = set()
    out = []
    for m in mods:
        name = str(m.get("name", ""))
        kind = m.get("kind")
        if not VALID.match(name) or kind not in P.KINDS:
            raise ValueError(f"{name or 'A module'} is not a valid module name or kind.")
        if name.lower() in seen:
            raise ValueError(f"{name} is used twice.")
        seen.add(name.lower())
        head, code, inline = P.split_source(str(m.get("code", "")))
        given = [str(h) for h in (m.get("header") or [])]
        attrs = {str(k): [str(x) for x in v] for k, v in (m.get("procAttrs") or {}).items()}
        for k, v in inline.items():
            attrs[k] = v
        out.append(P.Module(name, kind, code, head or given, "", bool(m.get("private")), False, attrs))
    return out


def write(parts: dict[str, bytes] | None, mods: list[dict], titles: list[str], name: str | None = None) -> dict[str, bytes]:
    new = _check(mods)
    parts = dict(parts or {})
    old = None
    if BIN in parts:
        try:
            old = P.parse(parts[BIN])
        except Exception:
            old = None
    if old is not None:
        same = len(old.modules) == len(new) and all(a.name == b.name and a.kind == b.kind and a.code.replace("\r\n", "\n").strip() == b.code.replace("\r\n", "\n").strip() and a.private == b.private and a.procattrs == b.procattrs for a, b in zip(old.modules, new))
        if same:
            return parts
        known = {m.name.lower(): m for m in old.modules}
        for m in new:
            o = known.get(m.name.lower())
            if o is not None:
                m.stream = o.stream
                if not m.header or m.header == P.default_header(m.name, m.kind):
                    m.header = o.header
                m.readonly = o.readonly
        old.modules = new
        proj = old
    else:
        proj = P.Project(name=name or "VBAProject", modules=new)
    for m in proj.modules:
        if not m.header:
            m.header = P.default_header(m.name, m.kind)
    parts[BIN] = P.build(proj)
    return parts


def blank(titles: list[str]) -> list[dict]:
    mods = [{"name": "ThisWorkbook", "kind": "document", "code": ""}]
    mods += [{"name": f"Sheet{i + 1}", "kind": "document", "code": ""} for i in range(len(titles))]
    return mods


TYPES = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'
RELS = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'


def ensure_codenames(parts: dict[str, bytes], titles: list[str]) -> None:
    parts.setdefault("[Content_Types].xml", TYPES)
    parts.setdefault("_rels/.rels", RELS)
    if NAMES not in parts:
        parts[NAMES] = json.dumps({"workbook": "ThisWorkbook", "sheets": [[t, f"Sheet{i + 1}"] for i, t in enumerate(titles)]}).encode()
