import io
import json
import re
from collections import Counter

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter, range_boundaries
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.formula import DataTableFormula
from openpyxl.worksheet.scenario import InputCells, Scenario, ScenarioList

from .cf import esc
from .tables import _unesc, ref_of

CELL = re.compile(r"\$?([A-Za-z]{1,3})\$?(\d+)")
MODES = {"max": "1", "min": "2", "value": "3"}
MODES_IN = {v: k for k, v in MODES.items()}
RELS = {"<=": "1", "=": "2", ">=": "3", "int": "4", "bin": "5", "dif": "6"}
RELS_IN = {v: k for k, v in RELS.items()}
CONS = re.compile(r"^(.+?)\s*(<=|>=|=|\s+int|\s+bin|\s+dif)\s*(.*)$", re.IGNORECASE)
ENGINES = {"nl": "1", "auto": "2", "evo": "3"}
ENGINES_IN = {"1": "nl", "2": "auto", "3": "evo"}
OPT_NAMES = {"pre": "solver_pre", "itr": "solver_itr", "tim": "solver_tim", "cvg": "solver_cvg", "pop": "solver_ssz", "mut": "solver_mrt", "seed": "solver_rsd", "nimp": "solver_mni", "sub": "solver_nod"}
OPT_FLAGS = {"scl": ("solver_scl", "1", "0"), "rb": ("solver_rbv", "1", "0"), "sho": ("solver_sho", "1", "2"), "ms": ("solver_msl", "1", "2")}
BIG = "2147483647"
SOLVER = re.compile(r"^solver_")


def _quote(name: str) -> str:
    return name if re.fullmatch(r"\w+", name) and not name[0].isdigit() else "'" + name.replace("'", "''") + "'"


def _a1(r: int, c: int) -> str:
    return f"{get_column_letter(c + 1)}{r + 1}"


def _absolute(text: str, sheet: str) -> str:
    out = []
    for part in re.split(r"[,;]", text):
        part = part.strip()
        if not part:
            continue
        head = ""
        if "!" in part:
            head, part = part.rsplit("!", 1)
            head += "!"
        else:
            head = _quote(sheet) + "!"
        out.append(head + CELL.sub(lambda m: f"${m.group(1).upper()}${m.group(2)}", part))
    return ",".join(out)


def _relative(text: str, sheet: str) -> str:
    out = []
    own = {_quote(sheet), sheet}
    for part in text.split(","):
        part = part.strip()
        if "!" in part:
            head, ref = part.rsplit("!", 1)
            part = ref if head.strip("'").replace("''", "'") in own or head in own else part
        out.append(part.replace("$", "") if "!" not in part else part)
    return ",".join(x for x in out if x)


def _is_ref(text: str) -> bool:
    return bool(re.fullmatch(r"(?:(?:'[^']+'|\w+)!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?", text.strip()))


def _model_out(ws, sheet: str, text: str) -> None:
    try:
        parts = json.loads(text)
        obj, mode, target, cells, cons, nonneg, method = parts[:7]
        opts = parts[7] if len(parts) > 7 and isinstance(parts[7], dict) else {}
    except (ValueError, TypeError):
        return
    names: dict[str, str] = {"solver_ver": "3", "solver_eng": ENGINES.get(method, "2"), "solver_lin": "2" if method in ("nl", "evo") else "1",
                             "solver_neg": "1" if nonneg else "0", "solver_typ": MODES.get(mode, "1"), "solver_val": str(target or 0)}
    for key, name in OPT_NAMES.items():
        if str(opts.get(key, "")).strip():
            names[name] = str(opts[key]).strip()
    for key, (name, on, off) in OPT_FLAGS.items():
        if key in opts:
            names[name] = on if opts[key] in (True, 1, "1") else off
    if str(opts.get("tol", "")).strip():
        try:
            names["solver_tol"] = repr(float(opts["tol"]) / 100)
        except ValueError:
            pass
    if str(obj).strip():
        names["solver_opt"] = _absolute(str(obj), sheet)
    if str(cells).strip():
        names["solver_adj"] = _absolute(str(cells), sheet)
    n = 0
    for line in str(cons).split("\n"):
        m = CONS.match(line.strip())
        if not m:
            continue
        n += 1
        op = m.group(2).strip().lower()
        rhs = m.group(3).strip()
        names[f"solver_lhs{n}"] = _absolute(m.group(1), sheet)
        names[f"solver_rel{n}"] = RELS[op]
        if op == "int":
            names[f"solver_rhs{n}"] = "integer"
        elif op == "bin":
            names[f"solver_rhs{n}"] = "binary"
        elif op == "dif":
            names[f"solver_rhs{n}"] = "alldifferent"
        else:
            names[f"solver_rhs{n}"] = _absolute(rhs, sheet) if _is_ref(rhs) else rhs or "0"
    names["solver_num"] = str(n)
    for k, v in names.items():
        ws.defined_names[k] = DefinedName(k, attr_text=v)


def whatif_out(wb, lines: list[str]) -> None:
    sheets = wb.worksheets
    scenarios: dict[int, list] = {}
    for line in lines:
        p = line.split("\t")
        kind = p[0]
        if kind == "dt" and len(p) >= 8:
            try:
                i, r0, c0, r1, c1 = (int(x) for x in p[1:6])
            except ValueError:
                continue
            if i >= len(sheets) or r1 <= r0 or c1 <= c0:
                continue
            row_in, col_in = p[6].strip(), p[7].strip()
            if not (row_in or col_in):
                continue
            both = bool(row_in and col_in)
            first = sheets[i].cell(row=r0 + 2, column=c0 + 2)
            first.value = DataTableFormula(ref=ref_of(r0 + 1, c0 + 1, r1, c1), dt2D=both or None, dtr=bool(row_in) or None, r1=row_in or col_in, r2=col_in if both else None)
        elif kind == "sc" and len(p) >= 4:
            try:
                i = int(_unesc(p[3]))
            except ValueError:
                continue
            if i >= len(sheets):
                continue
            cells = [InputCells(r=p[k], val=_unesc(p[k + 1])) for k in range(4, len(p) - 1, 2)]
            scenarios.setdefault(i, []).append(Scenario(name=_unesc(p[1])[:255], user="FormCel", comment=_unesc(p[2]) or None, inputCells=cells))
        elif kind == "sv" and len(p) >= 3:
            try:
                i = int(p[1])
            except ValueError:
                continue
            if i < len(sheets):
                _model_out(sheets[i], sheets[i].title, _unesc(p[2]))
    for i, items in scenarios.items():
        sheets[i].scenarios = ScenarioList(scenario=items)


def _model_in(ws, notes: Counter) -> str | None:
    names = {k: (v.attr_text or "") for k, v in ws.defined_names.items() if SOLVER.match(k)}
    if not names:
        return None
    title = ws.title
    mode = MODES_IN.get(names.get("solver_typ", "1").strip(), "max")
    try:
        count = int(names.get("solver_num", "0") or 0)
    except ValueError:
        count = 0
    cons = []
    for n in range(1, count + 1):
        lhs, rel = names.get(f"solver_lhs{n}"), RELS_IN.get(names.get(f"solver_rel{n}", "").strip())
        if not lhs or rel is None:
            notes["Solver constraints FormCel could not read left out"] += 1
            continue
        rhs = names.get(f"solver_rhs{n}", "")
        left = _relative(lhs, title)
        if rel in ("int", "bin", "dif"):
            cons.append(f"{left} {rel}")
        else:
            cons.append(f"{left}{rel}{_relative(rhs, title) if _is_ref(rhs) else rhs.lstrip('=')}")
    method = ENGINES_IN.get(names.get("solver_eng", "2").strip(), "auto")
    opts: dict = {}
    for key, name in OPT_NAMES.items():
        value = names.get(name, "").strip()
        if value and value != BIG:
            opts[key] = value
    for key, (name, on, _off) in OPT_FLAGS.items():
        value = names.get(name, "").strip()
        if value:
            opts[key] = value == on
    if names.get("solver_tol", "").strip():
        try:
            opts["tol"] = str(round(float(names["solver_tol"]) * 100, 6)).rstrip("0").rstrip(".")
        except ValueError:
            pass
    model = [_relative(names.get("solver_opt", ""), title), mode, names.get("solver_val", "0"), _relative(names.get("solver_adj", ""), title), "\n".join(cons), names.get("solver_neg", "1").strip() != "0", method]
    if opts:
        model.append(opts)
    return json.dumps(model)


def whatif_in(wb, data: bytes, sheet_index: dict, notes: Counter) -> tuple[list[str], list[tuple[int, int, int, str]]]:
    lines: list[str] = []
    found: list[tuple[int, int, int, DataTableFormula]] = []
    for ws in wb.worksheets:
        i = sheet_index.get(ws.title)
        if i is None:
            continue
        for (r, c), cell in list(ws._cells.items()):
            v = cell.value
            if not isinstance(v, DataTableFormula) or not v.ref:
                continue
            try:
                r_in, c_in = v.r1 or "", v.r2 or ""
                two = str(v.dt2D) in ("1", "True", "true")
                across = str(v.dtr) in ("1", "True", "true")
                c0, r0, c1, r1 = range_boundaries(v.ref)
            except (TypeError, ValueError):
                notes["what-if data tables FormCel could not read left out"] += 1
                continue
            if two:
                row_in, col_in = r_in, c_in
            elif across:
                row_in, col_in = r_in, ""
            else:
                row_in, col_in = "", r_in
            lines.append("\t".join(["dt", str(i), str(r0 - 2), str(c0 - 2), str(r1 - 1), str(c1 - 1), row_in.replace("$", ""), col_in.replace("$", "")]))
            found.append((i, r, c, v))
        sc = getattr(ws, "scenarios", None)
        for s in (sc.scenario if sc is not None else []):
            parts = ["sc", esc(s.name or ""), esc(s.comment or ""), str(i)]
            for ic in s.inputCells:
                parts += [str(ic.r).replace("$", ""), esc("" if ic.val is None else str(ic.val))]
            lines.append("\t".join(parts))
        model = _model_in(ws, notes)
        if model:
            lines.append("\t".join(["sv", str(i), esc(model)]))
    patches: list[tuple[int, int, int, str]] = []
    if found:
        try:
            cached = load_workbook(io.BytesIO(data), data_only=True)
        except (ValueError, KeyError, OSError):
            cached = None
        for i, r, c, _ in found:
            val = cached.worksheets[i].cell(row=r, column=c).value if cached is not None else None
            if isinstance(val, bool):
                val = "TRUE" if val else "FALSE"
            if isinstance(val, (int, float)):
                patches.append((i, r - 1, c - 1, repr(val)))
    return lines, patches
