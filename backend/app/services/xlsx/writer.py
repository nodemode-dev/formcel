import io
import zipfile

from openpyxl import Workbook
from openpyxl.styles import Font, NamedStyle
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.hyperlink import Hyperlink
from openpyxl.worksheet.properties import Outline

from ...version import VERSION
from .. import page
from .arrays import write_out
from .autofilter import filter_out
from .calcio import calc_out, finish as calc_finish
from .cf import rules_out
from .chartex import inject
from .chartsheets import finish as sheets_finish
from .drawings import objects_out, pivot_ranges
from .extlinks import links_out
from .formulas import EXT_OUT, EXT_SHEETS, to_file
from .overlay import finish as overlay_finish
from .pivots import finish as pivots_finish
from .pivots import pivots_out
from .props import app_xml, core_out, patch_app
from .slicers import finish as slicers_finish
from .protect import book_out, notes_out, sheet_out
from .review import finish as review_finish, placeholders, ranges_out
from .styles import apply_out
from .tables import ref_of, tables_out
from .theme import theme_out
from .validation import validations_out
from .whatif import whatif_out

COL_PX = 100
ROW_PX = 24


def style_name_out(name: str) -> str:
    return name.replace(" ", "") if name.startswith("Accent ") else name


def _number(text: str) -> int | float:
    n = float(text)
    return int(n) if n.is_integer() and abs(n) < 2**53 else n


def write(eng, views: list[dict], vba: dict[str, bytes] | None = None, objects: list[list[dict]] | None = None, notes: dict | None = None, threads: list[dict] | None = None, props: dict | None = None, stamps: tuple[str, str] | None = None, whatif: list[str] | None = None) -> bytes:
    threads = threads or []
    ranges: dict[int, list[tuple[str, str]]] = {}
    wb = Workbook()
    if stamps:
        core_out(wb, props or {}, *stamps)
    EXT_OUT.set({})
    EXT_SHEETS.set({})
    dynamic: list[list[str]] = []
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
                qualified = eng.file_formula(cell.coordinate, i) if "[" in text else None
                cell.value = to_file(qualified or text)
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
        dynamic.append(write_out(eng, ws, i))
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
        own = {(r, c) for r, c, _ in eng.links(i)}
        for r, c, target in [*eng.links(i), *[x for x in eng.chip_links(i) if (x[0], x[1]) not in own]]:
            cell = ws.cell(row=r + 1, column=c + 1)
            if target.startswith("#"):
                cell.hyperlink = Hyperlink(ref=cell.coordinate, location=target[1:])
            else:
                cell.hyperlink = target
        rules_out(ws, eng.rules(i))
        filtered = filter_out(ws, wb, eng.filter(i))
        validations_out(ws, eng.validations(i))
        for r1, c1, r2, c2 in eng.merges(i):
            ws.merge_cells(start_row=r1 + 1, start_column=c1 + 1, end_row=r2 + 1, end_column=c2 + 1)
        ws.sheet_format.defaultColWidth = round(((view.get("cols") or {}).get("base") or COL_PX) / 7, 4)
        ws.sheet_format.defaultRowHeight = ((view.get("rows") or {}).get("base") or ROW_PX) * 0.75
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
        for r in [*rows.get("hidden", []), *filtered]:
            ws.row_dimensions[r + 1].hidden = True
        for r, lv in rows.get("levels", []):
            ws.row_dimensions[r + 1].outlineLevel = lv
        if rows.get("before") or cols.get("before"):
            ws.sheet_properties.outlinePr = Outline(summaryBelow=not rows.get("before"), summaryRight=not cols.get("before"))
        fr, fc = int(view.get("fr") or 0), int(view.get("fc") or 0)
        if fr or fc:
            ws.freeze_panes = f"{get_column_letter(fc + 1)}{fr + 1}"
        if view.get("zoom") and view["zoom"] != 1:
            ws.sheet_view.zoomScale = round(view["zoom"] * 100)
        page.to_xlsx(ws, view.get("page"))
        if view.get("hidden") and any(not (v or {}).get("hidden") for j, v in enumerate(views) if j != i):
            ws.sheet_state = "hidden"
        if view.get("color"):
            ws.sheet_properties.tabColor = "FF" + view["color"].lstrip("#").upper()
        notes_out(ws, notes or {}, i)
        placeholders(ws, threads, i)
        sheet_out(ws, eng.protection(i))
        ranges[i] = ranges_out(wb, eng.protection(i), i)
    book_out(wb, eng.protection())
    notes_of = dict(eng.name_notes())
    for name, refers in eng.names():
        scope, _, local = name.rpartition("!")
        comment = notes_of.get(name)
        dn = DefinedName(local, attr_text=to_file(refers).lstrip("="), comment=comment)
        if not scope:
            wb.defined_names[local] = dn
            continue
        title = scope[1:-1].replace("''", "'") if scope.startswith("'") else scope
        sheet = next((w for w in wb.worksheets if w.title.lower() == title.lower()), None)
        if sheet is not None:
            sheet.defined_names[local] = dn
    for i, items in tables_out(wb, eng).items():
        ws = wb.worksheets[i]
        for tb, area in items:
            if ws.auto_filter.ref == ref_of(*area):
                if tb.autoFilter is not None:
                    tb.autoFilter.filterColumn = list(ws.auto_filter.filterColumn)
                ws.auto_filter.ref = None
                ws.auto_filter.filterColumn = []
    plans: dict[int, dict] = {}
    pivots = pivot_ranges(eng.pivots(), eng.sheet_names())
    shows = pivots_out(wb, eng)
    whatif_out(wb, whatif or [])
    for i, items in enumerate(objects or []):
        if items and i < len(wb.worksheets):
            plans[i] = objects_out(wb, wb.worksheets[i], items, views[i] if i < len(views) else {}, pivots=pivots)
    links_out(wb, eng.calc("extlines").splitlines())
    ignored = calc_out(wb, eng.calc("get"))
    if vba:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as arc:
            for name, blob in vba.items():
                arc.writestr(name, blob)
        wb.vba_archive = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    out = io.BytesIO()
    wb.save(out)
    data = calc_finish(out.getvalue(), dynamic, ignored)
    data = pivots_finish(data, shows)
    data = patch_app(data, app_xml(props or {}, eng.sheet_names(), VERSION)) if stamps else data
    data = overlay_finish(inject(review_finish(data, threads, ranges), wb, views, COL_PX, ROW_PX), plans, eng.sheet_names(), views)
    data = slicers_finish(data, views, eng.tables(), eng.pivots())
    return sheets_finish(data,[wb.worksheets[i].title for i, plan in plans.items() if plan["alts"]["charts"] and i < len(views) and views[i].get("chartSheet")])
