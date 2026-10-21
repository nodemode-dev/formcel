from openpyxl.comments import Comment
from openpyxl.packaging.custom import BoolProperty
from openpyxl.styles import Protection
from openpyxl.workbook.protection import WorkbookProtection

ACTIONS = {
    "select_locked": "selectLockedCells", "select_unlocked": "selectUnlockedCells", "format_cells": "formatCells",
    "format_columns": "formatColumns", "format_rows": "formatRows", "insert_columns": "insertColumns", "insert_rows": "insertRows",
    "insert_hyperlinks": "insertHyperlinks", "delete_columns": "deleteColumns", "delete_rows": "deleteRows", "sort": "sort",
    "autofilter": "autoFilter", "pivot": "pivotTables", "objects": "objects", "scenarios": "scenarios",
}


def notes_in(ws) -> list[tuple[int, int, str, str]]:
    out = []
    for (r, c), cell in ws._cells.items():
        cm = cell.comment
        if cm is not None and (cm.text or "").strip():
            out.append((r - 1, c - 1, cm.text, cm.author or ""))
    return out


def notes_out(ws, notes: dict, sheet: int) -> None:
    for k, n in notes.items():
        s, r, c = (int(x) for x in k.split(":"))
        if s == sheet:
            cm = Comment(n["text"], n.get("author") or "FormCel")
            cm.width, cm.height = 240, 100
            ws.cell(row=r + 1, column=c + 1).comment = cm


def flags_in(cell) -> int:
    p = cell.protection
    if p is None:
        return 0
    return (1 if p.locked is False else 0) | (2 if p.hidden else 0)


def sheet_in(ws, flagged: dict[tuple[int, int], int]) -> list[str]:
    p = ws.protection
    on = bool(p.sheet)
    if not on and not flagged:
        return []
    allow = [name for name, attr in ACTIONS.items() if not getattr(p, attr)]
    lines = [f"S\t{int(on)}\t\t{(p.password or '').upper()}\t{','.join(allow)}"]
    for (r, c), f in sorted(flagged.items()):
        lines.append(f"C\t{r}\t{c}\t{f}")
    return lines


def sheet_out(ws, lines: list[str]) -> None:
    for line in lines:
        f = line.split("\t")
        if f[0] == "S" and len(f) >= 5:
            p = ws.protection
            p.sheet = f[1] == "1"
            allow = set(f[4].split(","))
            for name, attr in ACTIONS.items():
                setattr(p, attr, name not in allow)
            if f[3]:
                p.password = f[3]
        elif f[0] == "C" and len(f) >= 4:
            r, c, v = int(f[1]), int(f[2]), int(f[3])
            ws.cell(row=r + 1, column=c + 1).protection = Protection(locked=not v & 1, hidden=bool(v & 2))


def book_in(wb) -> list[str]:
    sec = wb.security
    final = any(getattr(p, "name", "") == "_MarkAsFinal" and bool(getattr(p, "value", False)) for p in getattr(wb, "custom_doc_props", []) or [])
    structure = bool(sec and sec.lockStructure)
    if not structure and not final:
        return []
    legacy = (sec.workbookPassword or "").upper() if sec else ""
    return [f"B\t{int(structure)}\t\t{legacy}\t{int(final)}"]


def book_out(wb, lines: list[str]) -> None:
    for line in lines:
        f = line.split("\t")
        if f[0] != "B" or len(f) < 5:
            continue
        if f[1] == "1":
            wb.security = WorkbookProtection(lockStructure=True, workbookPassword=f[3] or None)
        if f[4] == "1":
            wb.custom_doc_props.append(BoolProperty(name="_MarkAsFinal", value=True))
