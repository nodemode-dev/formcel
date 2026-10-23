import io
import json
import re
import zipfile

from openpyxl.utils import get_column_letter

from .. import records as linked

PART = "formcel/datatypes.json"
CTYPE = "application/vnd.formcel.datatypes+json"
RTYPE = "http://schemas.formcel.app/2026/relationships/datatypes"
KINDS = ("stock", "currency")


def _unesc(s: str) -> str:
    return re.sub(r"\\(.)", lambda m: {"t": "\t", "n": "\n", "r": "\r"}.get(m.group(1), m.group(1)), s)


def typed(chips: list[tuple[int, int, str]]) -> list[tuple[int, int, str, str, str]]:
    out = []
    for r, c, text in chips:
        for line in text.split("\n"):
            p = [_unesc(x) for x in line.split("\t")]
            if len(p) >= 4 and p[0] in KINDS:
                out.append((r, c, p[0], p[2], p[3]))
                break
    return out


def collect(eng) -> dict:
    cells = []
    for i, name in enumerate(eng.sheet_names()):
        for r, c, kind, label, value in typed(eng.chips(i)):
            cells.append({"sheet": name, "ref": f"{get_column_letter(c + 1)}{r + 1}", "kind": kind, "label": label, "record": value})
    return {"format": "formcel-datatypes", "version": 2, "records": linked.to_doc(eng.records()), "cells": cells}


def finish(data: bytes, part: dict) -> bytes:
    if not part["cells"]:
        return data
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        files = {n: z.read(n) for n in z.namelist()}
    files[PART] = json.dumps(part, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ct = files["[Content_Types].xml"].decode("utf-8")
    files["[Content_Types].xml"] = ct.replace("</Types>", f'<Override PartName="/{PART}" ContentType="{CTYPE}"/></Types>').encode("utf-8")
    rels = files["xl/_rels/workbook.xml.rels"].decode("utf-8")
    top = max([int(x) for x in re.findall(r'Id="rId(\d+)"', rels)], default=0) + 1
    files["xl/_rels/workbook.xml.rels"] = rels.replace("</Relationships>", f'<Relationship Id="rId{top}" Type="{RTYPE}" Target="../{PART}"/></Relationships>').encode("utf-8")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", files.pop("[Content_Types].xml"))
        for n, blob in files.items():
            z.writestr(n, blob)
    return out.getvalue()


def read(data: bytes, names: list[str]) -> tuple[dict[int, list[tuple[int, int, str]]], list[tuple]]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if PART not in z.namelist():
                return {}, []
            doc = json.loads(z.read(PART).decode("utf-8"))
    except (zipfile.BadZipFile, ValueError, KeyError):
        return {}, []
    out: dict[int, list[tuple[int, int, str]]] = {}
    lower = [n.lower() for n in names]
    records = linked.from_doc(doc.get("records")) if isinstance(doc, dict) else []
    for c in doc.get("cells", []) if isinstance(doc, dict) else []:
        try:
            idx = lower.index(str(c["sheet"])[:31].lower())
            m = re.fullmatch(r"([A-Z]{1,3})(\d+)", str(c["ref"]))
            kind, label, value = str(c["kind"]), str(c["label"]), str(c["record"] if "record" in c else c["value"])
        except (KeyError, ValueError):
            continue
        if not m or kind not in KINDS or not label:
            continue
        col = 0
        for ch in m.group(1):
            col = col * 26 + ord(ch) - 64

        def esc(s: str) -> str:
            return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")

        text = "\t".join([kind, "0", esc(label), esc(value), ""])
        out.setdefault(idx, []).append((int(m.group(2)) - 1, col - 1, text))
    return out, records
