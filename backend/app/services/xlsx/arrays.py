from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.utils import get_column_letter, range_boundaries
from openpyxl.worksheet.formula import ArrayFormula

from .. import ranges

ERRORS = ("#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!", "#GETTING_DATA")


def spans(eng, sheet: int) -> list[tuple[int, int, int, int, bool]]:
    out = []
    for line in eng.calc(f"spills\t{sheet}").splitlines():
        p = line.split("\t")
        if len(p) == 5:
            out.append((int(p[0]), int(p[1]), int(p[2]), int(p[3]), p[4] == "a"))
    return out


def ref_of(r0: int, c0: int, r1: int, c1: int) -> str:
    a = f"{get_column_letter(c0 + 1)}{r0 + 1}"
    return a if (r0, c0) == (r1, c1) else f"{a}:{get_column_letter(c1 + 1)}{r1 + 1}"


def write_out(eng, ws, sheet: int) -> list[str]:
    dynamic: list[str] = []
    for r0, c0, r1, c1, legacy in spans(eng, sheet):
        anchor = ws.cell(row=r0 + 1, column=c0 + 1)
        if not isinstance(anchor.value, str) or not anchor.value.startswith("="):
            continue
        anchor.value = ArrayFormula(ref_of(r0, c0, r1, c1), anchor.value)
        if not legacy:
            dynamic.append(anchor.coordinate)
        if (r0, c0) == (r1, c1):
            continue
        grid = ranges.grid(eng, sheet, (r0, c0, r1, c1))
        for dr, row in enumerate(grid):
            for dc, v in enumerate(row):
                if (dr, dc) == (0, 0) or v is None:
                    continue
                cell = ws.cell(row=r0 + dr + 1, column=c0 + dc + 1)
                cell.value = ILLEGAL_CHARACTERS_RE.sub("", v) if isinstance(v, str) else v
                if isinstance(v, str):
                    cell.data_type = "e" if v in ERRORS else "s"
    return dynamic


def members(ws) -> tuple[list[tuple[int, int, int, int, str]], set[tuple[int, int]]]:
    found: list[tuple[int, int, int, int, str]] = []
    skip: set[tuple[int, int]] = set()
    for (r, c), cell in ws._cells.items():
        v = cell.value
        if not isinstance(v, ArrayFormula) or not v.ref:
            continue
        try:
            c0, r0, c1, r1 = range_boundaries(str(v.ref))
        except (TypeError, ValueError):
            continue
        found.append((r0 - 1, c0 - 1, r1 - 1, c1 - 1, cell.coordinate))
        if (r1 - r0 + 1) * (c1 - c0 + 1) <= 1_000_000:
            skip.update((rr, cc) for rr in range(r0, r1 + 1) for cc in range(c0, c1 + 1) if (rr, cc) != (r, c))
    return found, skip
