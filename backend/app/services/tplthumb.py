import re
from functools import lru_cache

import formcel_engine

from . import templates
from .store import ENGINE

MAX_ROWS = 2000
MAX_COLS = 64
PREVIEW_CHARTS = 6


def col_index(letters: str) -> int:
    n = 0
    for ch in letters.upper():
        n = n * 26 + ord(ch) - 64
    return n - 1


def parse_ref(text: str) -> tuple[int, int, int, int] | None:
    a, _, b = text.replace("$", "").partition(":")
    m = re.fullmatch(r"([A-Za-z]{1,3})(\d{1,7})", a.strip())
    n = re.fullmatch(r"([A-Za-z]{1,3})(\d{1,7})", (b or a).strip())
    if not m or not n:
        return None
    r0, c0, r1, c1 = int(m[2]) - 1, col_index(m[1]), int(n[2]) - 1, col_index(n[1])
    return min(r0, r1), min(c0, c1), max(r0, r1), max(c0, c1)


def parse_range(text: str) -> tuple[str | None, tuple[int, int, int, int]] | None:
    s = text.strip().lstrip("=")
    sheet = None
    bang = s.rfind("!")
    if bang > 0:
        sheet = re.sub(r"^'(.*)'$", r"\1", s[:bang]).replace("''", "'")
        s = s[bang + 1:]
    ref = parse_ref(s)
    return (sheet, ref) if ref else None


def resolve(eng, names: list[tuple[str, str]], text: str) -> tuple[str | None, tuple[int, int, int, int]] | None:
    direct = parse_range(text)
    if direct:
        return direct
    t = text.strip().lstrip("=")
    for n, refers in names:
        if n.lower() == t.lower():
            return parse_range(refers)
    return None


def build_engine(doc: dict):
    eng = formcel_engine.Workbook()
    if doc.get("theme"):
        eng.load_theme(doc["theme"])
    if doc.get("cellStyles"):
        eng.load_cell_styles(doc["cellStyles"])
    for i, s in enumerate(doc["sheets"]):
        if i:
            eng.add_sheet(s["name"])
        else:
            eng.rename_sheet(0, s["name"])
        eng.load([tuple(c) for c in s["cells"]], i)
    for name, refers in doc.get("names", []):
        try:
            eng.define_name(name, refers)
        except ValueError:
            continue
    if doc.get("tables"):
        eng.load_tables(doc["tables"])
    return eng


def raw_values(eng, sheet: int) -> dict[tuple[int, int], str]:
    out = {(r, c): v for r, c, v in eng.values(sheet)}
    for r, c, kind, text in [*eng.typed(sheet), *eng.results(sheet)]:
        if kind == "n":
            out[(r, c)] = text
        elif kind == "t":
            out[(r, c)] = "'" + text
        elif kind == "b":
            out[(r, c)] = text
    return out


def matrix(vals: dict[tuple[int, int], str], box: tuple[int, int, int, int]) -> list[list[str]]:
    r0, c0, r1, c1 = box
    h = min(r1 - r0 + 1, MAX_ROWS)
    w = min(c1 - c0 + 1, MAX_COLS)
    return [[vals.get((r0 + i, c0 + j), "") for j in range(w)] for i in range(h)]


def chart_objects(doc: dict) -> list[tuple[int, dict]]:
    out = []
    for i, s in enumerate(doc["sheets"]):
        for o in s.get("objects", []):
            if o.get("kind") == "chart" and o.get("chart"):
                out.append((i, o))
    return out


@lru_cache(maxsize=256)
def thumb(template_id: str) -> dict | None:
    doc = templates.doc_of(template_id)
    if doc is None:
        return None
    with ENGINE:
        formcel_engine.set_locale(doc.get("locale") or "en-US")
        eng = build_engine(doc)
        names = [(n, r) for n, r in eng.names()]
        sheet_names = eng.sheet_names()
        cache: dict[int, dict] = {}
        charts = []
        for si, o in chart_objects(doc)[:PREVIEW_CHARTS]:
            spec = o["chart"]
            ref = resolve(eng, names, spec.get("range", ""))
            mx: list[list[str]] = []
            if ref:
                sheet = si if ref[0] is None else next((k for k, n in enumerate(sheet_names) if n.lower() == ref[0].lower()), -1)
                if sheet >= 0:
                    if sheet not in cache:
                        cache[sheet] = raw_values(eng, sheet)
                    mx = matrix(cache[sheet], ref[1])
            charts.append({"sheet": si, "w": o.get("w", 480), "h": o.get("h", 300), "spec": spec, "matrix": mx})
    sparks = sum(1 for s in doc["sheets"] for o in s.get("objects", []) if o.get("kind") == "spark")
    return {"id": template_id, "charts": charts, "sparks": sparks}
