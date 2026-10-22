import re

A1 = re.compile(r"^\$?([A-Za-z]{1,3})\$?(\d+)$")


def col_index(letters: str) -> int:
    n = 0
    for ch in letters.upper():
        n = n * 26 + ord(ch) - 64
    return n - 1


def col_name(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def parse_cell(a1: str) -> tuple[int, int]:
    m = A1.match(a1.strip())
    if not m:
        raise ValueError(f"{a1} is not a cell address")
    return int(m.group(2)) - 1, col_index(m.group(1))


def parse_area(ref: str) -> tuple[int, int, int, int]:
    a, _, b = ref.strip().partition(":")
    r0, c0 = parse_cell(a)
    r1, c1 = parse_cell(b) if b else (r0, c0)
    return min(r0, r1), min(c0, c1), max(r0, r1), max(c0, c1)


def split_sheet(ref: str, names: list[str]) -> tuple[int, str]:
    if "!" not in ref:
        return 0, ref
    sheet, _, area = ref.rpartition("!")
    sheet = sheet.strip()
    if sheet.startswith("'") and sheet.endswith("'"):
        sheet = sheet[1:-1].replace("''", "'")
    for i, n in enumerate(names):
        if n.lower() == sheet.lower():
            return i, area
    raise ValueError(f"no sheet named {sheet}")


def grid(engine, sheet: int, area: tuple[int, int, int, int], kind: str = "typed") -> list[list]:
    r0, c0, r1, c1 = area
    rows = [[None] * (c1 - c0 + 1) for _ in range(r1 - r0 + 1)]
    if kind != "typed":
        for item in engine.cells(sheet):
            if r0 <= item[0] <= r1 and c0 <= item[1] <= c1:
                rows[item[0] - r0][item[1] - c0] = item[2]
        return rows
    kinds = {(i[0], i[1]): i[2] for i in engine.typed(sheet) if i[2] in "nbt"}
    for r, c, t in engine.values(sheet):
        if not (r0 <= r <= r1 and c0 <= c <= c1) or t == "":
            continue
        k = kinds.get((r, c))
        if k == "t":
            v = t
        elif t in ("TRUE", "FALSE") and k in (None, "b"):
            v = t == "TRUE"
        else:
            try:
                v = float(t) if k in (None, "n") else t
            except ValueError:
                v = t
        rows[r - r0][c - c0] = v
    return rows


def used_area(engine, sheet: int) -> tuple[int, int, int, int] | None:
    items = engine.cells(sheet)
    if not items:
        return None
    return min(i[0] for i in items), min(i[1] for i in items), max(i[0] for i in items), max(i[1] for i in items)


def range_values(books, wid: str, ref: str) -> list[list]:
    b = books(wid)
    with b.lock:
        hit = b.engine.table_area(ref.strip()) if "!" not in ref else None
        if hit:
            return grid(b.engine, hit[0], hit[1:])
        names = b.sheet_names()
        sheet, area = split_sheet(ref, names)
        return grid(b.engine, sheet, parse_area(area))
