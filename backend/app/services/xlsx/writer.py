import io

from openpyxl import Workbook
from openpyxl.styles import Font, NamedStyle
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.hyperlink import Hyperlink

from .formulas import to_file
from .styles import apply_out
from .theme import theme_out

COL_PX = 100
ROW_PX = 24


def style_name_out(name: str) -> str:
    return name.replace(" ", "") if name.startswith("Accent ") else name


def _number(text: str) -> int | float:
    n = float(text)
    return int(n) if n.is_integer() and abs(n) < 2**53 else n


def write(eng, views: list[dict]) -> bytes:
    wb = Workbook()
    xml, body, heading = theme_out(eng.theme())
    wb.loaded_theme = xml
    wb._fonts[0] = Font(name=body, sz=10)
    named = {}
    defs = {}
    for line in eng.cell_styles():
        parts = line.split("\t")
        if len(parts) > 2 and parts[2]:
            named[parts[0]] = parts[2]
        if len(parts) > 4:
            defs[parts[0]] = (parts[1], parts[2], parts[4] == "1")
    used = {t[3:] for i in range(len(eng.sheet_names())) for _, _, s in eng.styles(i) for t in s.split(";") if t.startswith("cs:")}
    registered: set[str] = set()
    for name, (toks, code, builtin) in defs.items():
        if name == "Normal" or (builtin and name not in used):
            continue
        ns = NamedStyle(name=style_name_out(name))
        apply_out(ns, toks, body, heading)
        if code:
            ns.number_format = code
        wb.add_named_style(ns)
        registered.add(name)
    for i, name in enumerate(eng.sheet_names()):
        ws = wb.active if i == 0 else wb.create_sheet()
        ws.title = name
        view = views[i] if i < len(views) else {}
        for r, c, kind, text in eng.typed(i):
            cell = ws.cell(row=r + 1, column=c + 1)
            if kind == "f":
                cell.value = to_file(text)
            elif kind == "n":
                cell.value = _number(text)
            elif kind == "b":
                cell.value = text == "TRUE"
            elif kind == "e":
                cell.value = text
                cell.data_type = "e"
            elif text:
                cell.value = text
                cell.data_type = "s"
        for r, c, code in eng.auto_formats(i) + eng.formats(i):
            ws.cell(row=r + 1, column=c + 1).number_format = code
        for r, c, _ in eng.styles(i):
            a1 = f"{get_column_letter(c + 1)}{r + 1}"
            st = eng.effective_style(a1, i)
            cell = ws.cell(row=r + 1, column=c + 1)
            cs = next((t[3:] for t in st.split(";") if t.startswith("cs:")), None)
            if cs in registered:
                code = cell.number_format
                cell.style = style_name_out(cs)
                if code != "General":
                    cell.number_format = code
            apply_out(cell, ";".join(t for t in st.split(";") if not t.startswith("cs:")), body, heading)
            if cs in named and eng.format_code(a1, i) is None:
                cell.number_format = named[cs]
        for r, c, target in eng.links(i):
            cell = ws.cell(row=r + 1, column=c + 1)
            if target.startswith("#"):
                cell.hyperlink = Hyperlink(ref=cell.coordinate, location=target[1:])
            else:
                cell.hyperlink = target
        for r1, c1, r2, c2 in eng.merges(i):
            ws.merge_cells(start_row=r1 + 1, start_column=c1 + 1, end_row=r2 + 1, end_column=c2 + 1)
        ws.sheet_format.defaultColWidth = round(COL_PX / 7, 4)
        ws.sheet_format.defaultRowHeight = ROW_PX * 0.75
        cols = view.get("cols") or {}
        for c, px in cols.get("sizes", []):
            ws.column_dimensions[get_column_letter(c + 1)].width = round(px / 7, 4)
        for c in cols.get("hidden", []):
            ws.column_dimensions[get_column_letter(c + 1)].hidden = True
        for c, lv in cols.get("levels", []):
            ws.column_dimensions[get_column_letter(c + 1)].outlineLevel = lv
        rows = view.get("rows") or {}
        for r, px in rows.get("sizes", []):
            ws.row_dimensions[r + 1].height = px * 0.75
        for r in rows.get("hidden", []):
            ws.row_dimensions[r + 1].hidden = True
        for r, lv in rows.get("levels", []):
            ws.row_dimensions[r + 1].outlineLevel = lv
        fr, fc = int(view.get("fr") or 0), int(view.get("fc") or 0)
        if fr or fc:
            ws.freeze_panes = f"{get_column_letter(fc + 1)}{fr + 1}"
        if view.get("zoom") and view["zoom"] != 1:
            ws.sheet_view.zoomScale = round(view["zoom"] * 100)
        if view.get("color"):
            ws.sheet_properties.tabColor = "FF" + view["color"].lstrip("#").upper()
    for name, refers in eng.names():
        wb.defined_names[name] = DefinedName(name, attr_text=to_file(refers).lstrip("="))
    wb.calculation.fullCalcOnLoad = True
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
