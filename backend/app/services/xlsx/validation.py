from collections import Counter

from formcel_engine import Workbook
from openpyxl.utils import get_column_letter, range_boundaries
from openpyxl.worksheet.datavalidation import DataValidation

from .cf import _operand_in, _operand_out, esc
from .formulas import from_file, to_file

KINDS_IN = {"whole": "whole", "decimal": "decimal", "list": "list", "date": "date", "time": "time", "textLength": "length", "custom": "custom"}
KINDS_OUT = {v: k for k, v in KINDS_IN.items()}
OPS_IN = {"between": "between", "notBetween": "notbetween", "equal": "eq", "notEqual": "ne", "greaterThan": "gt", "lessThan": "lt",
          "greaterThanOrEqual": "ge", "lessThanOrEqual": "le"}
OPS_OUT = {v: k for k, v in OPS_IN.items()}
STYLES_IN = {"stop": "stop", "warning": "warning", "information": "info"}
STYLES_OUT = {v: k for k, v in STYLES_IN.items()}


def _list_in(f: str) -> str:
    if len(f) >= 2 and f[0] == '"' and f[-1] == '"':
        return f[1:-1].replace('""', '"')
    return "=" + from_file(f)


def _serial(v: str) -> str:
    t = Workbook()
    t.set("A1", v)
    for _, _, kind, val in t.typed(0):
        if kind == "n":
            return val
    return v


def validations_in(ws, notes: Counter) -> list[str]:
    out: list[str] = []
    dv = ws.data_validations
    for v in (dv.dataValidation if dv else []):
        kind = KINDS_IN.get(v.type or "", "any")
        if kind == "list":
            a, b, op = _list_in(v.formula1 or ""), "", ""
        elif kind == "custom":
            a, b, op = "=" + from_file(v.formula1 or "TRUE"), "", ""
        elif kind == "any":
            a, b, op = "", "", ""
        else:
            op = OPS_IN.get(v.operator or "between", "between")
            a = _operand_in(v.formula1) if v.formula1 else ""
            b = _operand_in(v.formula2) if v.formula2 else ""
        flags = ("b" if v.allow_blank else "") + ("" if v.showDropDown or kind != "list" else "d") + ("p" if v.showInputMessage else "") + ("e" if v.showErrorMessage else "")
        style = STYLES_IN.get(v.errorStyle or "stop", "stop")
        rest = [kind, op, a, b, flags, style, v.promptTitle or "", v.prompt or "", v.errorTitle or "", v.error or ""]
        for rng in str(v.sqref).split():
            try:
                c0, r0, c1, r1 = range_boundaries(rng)
            except (TypeError, ValueError):
                notes["data validation ranges FormCel cannot read left out"] += 1
                continue
            out.append(f"{r0 - 1},{c0 - 1},{r1 - 1},{c1 - 1}\t" + "\t".join(esc(x) for x in rest))
    return out


def _unesc(s: str) -> str:
    out, it = [], iter(s)
    for ch in it:
        if ch != "\\":
            out.append(ch)
            continue
        nx = next(it, "")
        out.append({"t": "\t", "n": "\n", "r": "\r"}.get(nx, nx))
    return "".join(out)


def _operand(kind: str, v: str) -> str | None:
    if not v:
        return None
    if kind in ("date", "time") and not v.startswith("="):
        v = _serial(v)
    return _operand_out(v)


def validations_out(ws, lines: list[str]) -> None:
    for line in lines:
        p = [_unesc(x) for x in line.split("\t")]
        p += [""] * (11 - len(p))
        r0, c0, r1, c1 = (int(x) for x in p[0].split(","))
        kind, op, a, b, flags, style = p[1:7]
        if kind == "checkbox":
            continue
        if kind == "list":
            f1 = to_file(a[1:]) if a.startswith("=") else '"' + a.replace('"', '""') + '"'
            f2 = None
        elif kind == "custom":
            f1, f2 = to_file(a[1:]) if a.startswith("=") else a, None
        elif kind == "any":
            f1 = f2 = None
        else:
            f1, f2 = _operand(kind, a), _operand(kind, b) if op in ("between", "notbetween") else None
        dv = DataValidation(type=KINDS_OUT.get(kind), formula1=f1, formula2=f2, allow_blank="b" in flags,
                            showDropDown="d" not in flags if kind == "list" else None, showInputMessage="p" in flags, showErrorMessage="e" in flags,
                            errorStyle=STYLES_OUT.get(style, "stop"), promptTitle=p[7] or None, prompt=p[8] or None, errorTitle=p[9] or None, error=p[10] or None,
                            operator=OPS_OUT.get(op) if kind not in ("list", "custom", "any") else None)
        dv.add(f"{get_column_letter(c0 + 1)}{r0 + 1}:{get_column_letter(c1 + 1)}{r1 + 1}")
        ws.add_data_validation(dv)
