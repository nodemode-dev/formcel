import html
import io
import re
import zipfile
from collections import Counter

from openpyxl.chartsheet import Chartsheet
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D

from .drawings import EMU, chart_in

REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
SHEET_TYPE = f"{REL}/worksheet"
CHART_TYPE = f"{REL}/chartsheet"
DRAWING_TYPE = f"{REL}/drawing"
CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"
SIZE = (900, 520)


def sheets_in(wb, notes: Counter) -> list[tuple[int, dict]]:
    found: list[tuple[int, dict]] = []
    for pos, sheet in enumerate(wb._sheets):
        if not isinstance(sheet, Chartsheet):
            continue
        view: dict = {"cols": {"sizes": [], "hidden": []}, "rows": {"sizes": [], "hidden": []}, "chartSheet": True, "zoom": 1}
        if sheet.sheet_state != "visible":
            view["hidden"] = True
        objects = []
        for i, ch in enumerate(getattr(sheet, "_charts", None) or []):
            ch.anchor = OneCellAnchor(_from=AnchorMarker(col=0, row=0), ext=XDRPositiveSize2D(SIZE[0] * EMU, SIZE[1] * EMU))
            item = chart_in(ch, sheet.title, view)
            if item is None:
                notes["charts of a type FormCel does not draw left out"] += 1
                continue
            item.update({"id": f"cs{pos}c{i}", "x": 20, "y": 20, "w": SIZE[0], "h": SIZE[1]})
            objects.append(item)
        found.append((pos, {"name": sheet.title[:31], "cells": [], "formats": [], "styles": [], "merges": [], "links": [], "rules": [], "filter": "", "validations": [], "view": view,
                            "objects": objects, "notes": [], "threads": [], "protection": [], "arrays": []}))
    return found


def _rel_map(xml: str) -> dict[str, tuple[str, str]]:
    out = {}
    for m in re.finditer(r"<Relationship\b([^>]*)/?>", xml):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        if "Id" in attrs:
            out[attrs["Id"]] = (attrs.get("Type", ""), attrs.get("Target", ""))
    return out


def _path(target: str, base: str) -> str:
    if target.startswith("/"):
        return target[1:]
    parts = base.split("/")[:-1]
    for seg in target.split("/"):
        if seg == "..":
            parts.pop()
        elif seg != ".":
            parts.append(seg)
    return "/".join(parts)


def _absolute(xml: str) -> str:
    m = re.search(r"<(\w+:)?(oneCellAnchor|twoCellAnchor)\b[^>]*>", xml)
    if not m:
        return xml
    pre = m.group(1) or ""
    tag = m.group(2)
    frame = re.search(rf"<{pre}graphicFrame\b", xml[m.end():])
    if not frame:
        return xml
    start = m.start()
    inner = m.end() + frame.start()
    xml = xml[:start] + f'<{pre}absoluteAnchor><{pre}pos x="0" y="0"/><{pre}ext cx="0" cy="0"/>' + xml[inner:]
    return xml.replace(f"</{pre}{tag}>", f"</{pre}absoluteAnchor>", 1)


def finish(data: bytes, titles: list[str]) -> bytes:
    if not titles:
        return data
    src = zipfile.ZipFile(io.BytesIO(data))
    files = {n: src.read(n) for n in src.namelist()}
    order = src.namelist()
    wb_xml = files["xl/workbook.xml"].decode("utf-8")
    rels_xml = files["xl/_rels/workbook.xml.rels"].decode("utf-8")
    types = files["[Content_Types].xml"].decode("utf-8")
    rels = _rel_map(rels_xml)
    n = 0
    for m in re.finditer(r"<sheet\b([^>]*)/?>", wb_xml):
        attrs = dict(re.findall(r'([\w:]+)="([^"]*)"', m.group(1)))
        if html.unescape(attrs.get("name", "")) not in titles:
            continue
        rid = attrs.get("r:id")
        kind, target = rels.get(rid, ("", ""))
        if kind != SHEET_TYPE:
            continue
        sheet_path = _path(target, "xl/workbook.xml")
        sheet_rels_path = sheet_path.replace("worksheets/", "worksheets/_rels/") + ".rels"
        own = _rel_map(files.get(sheet_rels_path, b"").decode("utf-8"))
        draw = next((t for k, t in own.values() if k == DRAWING_TYPE), None)
        if draw is None:
            continue
        draw_path = _path(draw, sheet_path)
        if draw_path not in files:
            continue
        n += 1
        new_path = f"xl/chartsheets/sheet{n}.xml"
        new_rels = f"xl/chartsheets/_rels/sheet{n}.xml.rels"
        files[draw_path] = _absolute(files[draw_path].decode("utf-8")).encode("utf-8")
        files[new_path] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="{REL}">'
                           '<sheetViews><sheetView workbookViewId="0" zoomToFit="1"/></sheetViews><drawing r:id="rId1"/></chartsheet>').encode("utf-8")
        files[new_rels] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                           f'<Relationship Id="rId1" Type="{DRAWING_TYPE}" Target="/{draw_path}"/></Relationships>').encode("utf-8")
        order += [new_path, new_rels]
        for gone in (sheet_path, sheet_rels_path):
            files.pop(gone, None)
        rels_xml = re.sub(rf'<Relationship\b[^>]*\bId="{re.escape(rid)}"[^>]*/>', f'<Relationship Id="{rid}" Type="{CHART_TYPE}" Target="/{new_path}"/>', rels_xml)
        types = re.sub(rf'<Override\b[^>]*PartName="/{re.escape(sheet_path)}"[^>]*/>', f'<Override PartName="/{new_path}" ContentType="{CT}"/>', types)
    if not n:
        return data
    files["xl/workbook.xml"] = wb_xml.encode("utf-8")
    files["xl/_rels/workbook.xml.rels"] = rels_xml.encode("utf-8")
    files["[Content_Types].xml"] = types.encode("utf-8")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in dict.fromkeys(order):
            if name in files:
                z.writestr(name, files[name])
    return out.getvalue()
