import hashlib
import json
import re

from . import ranges

TABLE = re.compile(r"^([A-Za-z_\\][\w.\\]*)(?:\[(.*)\])?$")
AREA = re.compile(r"^\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$")
COLS = re.compile(r"^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$")
ROWS = re.compile(r"^\$?(\d+):\$?(\d+)$")


def tables(engine) -> list[dict]:
    out = []
    for line in engine.tables():
        p = [x.replace("\\t", "\t").replace("\\n", "\n").replace("\\\\", "\\") for x in line.split("\t")]
        try:
            r0, c0, r1, c1 = (int(n) for n in p[2].split(","))
            count = int(p[5])
        except (IndexError, ValueError):
            continue
        out.append({"sheet": int(p[0]), "name": p[1], "area": (r0, c0, r1, c1), "totals": "t" in p[3], "cols": p[6:6 + count]})
    return out


def value_rows(engine, sheet: int, area: tuple[int, int, int, int]) -> list[list]:
    rows = ranges.grid(engine, sheet, area, "typed")
    return [["" if v is None else v for v in row] for row in rows]


def clip(engine, sheet: int, area: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    used = ranges.used_area(engine, sheet)
    if used is None:
        return area[0], area[1], area[0], area[1]
    return area[0], area[1], min(area[2], used[2]), min(area[3], used[3])


def table_ref(engine, name: str, item: str) -> list[list] | None:
    for t in tables(engine):
        if t["name"].lower() != name.lower():
            continue
        r0, c0, r1, c1 = t["area"]
        data_end = r1 - 1 if t["totals"] else r1
        item = item.strip()
        flag = item.lower()
        if not item or flag == "#data":
            area = (r0 + 1, c0, data_end, c1)
        elif flag == "#all":
            area = (r0, c0, r1, c1)
        elif flag == "#headers":
            area = (r0, c0, r0, c1)
        elif flag == "#totals":
            if not t["totals"]:
                raise ValueError(f"{name} has no totals row")
            area = (r1, c0, r1, c1)
        else:
            col = item.strip("[]").strip()
            names = [c.lower() for c in t["cols"]]
            if col.lower() not in names:
                raise ValueError(f"{name} has no column {col}")
            c = c0 + names.index(col.lower())
            area = (r0 + 1, c, data_end, c)
        return value_rows(engine, t["sheet"], area)
    return None


def read(b, ref: str) -> dict:
    ref = ref.strip()
    if not ref:
        raise ValueError("xl() needs a reference such as \"A1:C10\"")
    with b.lock:
        engine = b.engine
        names = b.sheet_names()
        m = TABLE.match(ref)
        if m and not AREA.match(ref) and "!" not in ref:
            rows = table_ref(engine, m.group(1), m.group(2) or "")
            if rows is not None:
                return {"rows": rows, "cell": False}
            for n, refers in engine.names():
                if n.lower() == ref.lower():
                    ref = refers.lstrip("=")
                    break
        sheet, area_text = ranges.split_sheet(ref, names) if "!" in ref else (0, ref)
        area_text = area_text.replace("$", "")
        cm, rm = COLS.match(area_text), ROWS.match(area_text)
        if cm:
            area = (0, ranges.col_index(cm.group(1)), 1048575, ranges.col_index(cm.group(2)))
            area = clip(engine, sheet, area)
        elif rm:
            area = (int(rm.group(1)) - 1, 0, int(rm.group(2)) - 1, 16383)
            area = clip(engine, sheet, area)
        else:
            try:
                area = ranges.parse_area(area_text)
            except ValueError:
                raise ValueError(f"{ref} is not a range, table or name in this workbook")
        if (area[2] - area[0] + 1) * (area[3] - area[1] + 1) > 1_000_000:
            raise ValueError("xl() reads at most 1,000,000 cells")
        rows = value_rows(engine, sheet, area)
        return {"rows": rows, "cell": area[0] == area[2] and area[1] == area[3]}


def digest(rows: list[list]) -> str:
    return hashlib.sha1(json.dumps(rows, default=str, separators=(",", ":")).encode()).hexdigest()
