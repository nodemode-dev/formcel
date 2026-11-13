import json
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent / "templates"
SOURCES = ("native.json", "formmd.json", "conformance.json", "formatcheck.json", "demos.json")
ORDER = ("Spreadsheets", "Data & charts", "Finance", "Sales & marketing", "Operations", "Personal & education", "Example projects")
PREVIEW_ROWS = 8
PREVIEW_COLS = 6


@lru_cache(maxsize=1)
def catalog() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for name in [*SOURCES, *sorted(p.name for p in HERE.glob("gallery_*.json"))]:
        for t in json.loads((HERE / name).read_text(encoding="utf-8")):
            if "doc" in t:
                t["sheets"] = [doc_sheet(s) for s in t["doc"]["sheets"]]
            t["source"] = "form.md" if name == "formmd.json" else "formcel"
            out[t["id"]] = t
    return out


def doc_sheet(s: dict) -> dict:
    cells = s.get("cells", [])
    rows = max((c[0] for c in cells), default=-1) + 1
    cols = max((c[1] for c in cells), default=-1) + 1
    grid = [["" for _ in range(cols)] for _ in range(rows)]
    for r, c, v in cells:
        grid[r][c] = v
    return {"name": s["name"], "columns": [], "rows": grid, "objects": s.get("objects", [])}


def doc_of(template_id: str) -> dict | None:
    t = catalog().get(template_id)
    return json.loads(json.dumps(t["doc"])) if t and "doc" in t else None


def visuals(t: dict) -> list[dict]:
    out = []
    for i, s in enumerate(t["sheets"]):
        for o in s.get("objects", []):
            if o.get("kind") in ("chart", "spark"):
                out.append({"sheet": i, "kind": o["kind"], "type": (o.get("chart") or o.get("spark") or {}).get("type", "")})
    return out


def grid_of(sheet: dict) -> list[list[str]]:
    head = [sheet["columns"]] if any(sheet["columns"]) else []
    return head + sheet["rows"]


def preview(sheet: dict) -> list[list[str]]:
    return [row[:PREVIEW_COLS] for row in grid_of(sheet)[:PREVIEW_ROWS]]


@lru_cache(maxsize=512)
def computed_preview(template_id: str) -> list[list[str]]:
    import formcel_engine

    t = catalog()[template_id]
    raw = preview(t["sheets"][0])
    if not any(v.startswith("=") for row in raw for v in row):
        return raw
    eng = formcel_engine.Workbook()
    for i, (name, cells) in enumerate(sheets_of(template_id) or []):
        if i:
            eng.add_sheet(name)
        else:
            eng.rename_sheet(0, name)
        eng.load(cells, i)
    for n, refers in names_of(template_id):
        eng.define_name(n, refers)
    if t.get("doc", {}).get("tables"):
        eng.load_tables(t["doc"]["tables"])
    out = [["" for _ in row] for row in raw]
    for r, c, v in eng.values(0):
        if r < len(out) and c < len(out[r]):
            out[r][c] = v
    return out


def summary(t: dict) -> dict:
    return {
        "id": t["id"],
        "name": t["name"],
        "description": t["description"],
        "category": t["category"],
        "tags": t.get("tags", []),
        "featured": t.get("featured", False),
        "source": t["source"],
        "sheets": [s["name"] for s in t["sheets"]],
        "rows": sum(len(s["rows"]) for s in t["sheets"]),
        "preview": computed_preview(t["id"]),
        "visuals": visuals(t),
    }


def listing() -> dict:
    items = sorted((t for t in catalog().values() if t["category"] != "Demos"), key=lambda t: (ORDER.index(t["category"]) if t["category"] in ORDER else len(ORDER), not t.get("featured"), t["name"]))
    cats = [{"name": c, "count": sum(1 for t in items if t["category"] == c)} for c in ORDER]
    return {"categories": cats, "templates": [summary(t) for t in items]}


def names_of(template_id: str) -> list[tuple[str, str]]:
    t = catalog().get(template_id)
    return [(n, r) for n, r in t.get("names", t.get("doc", {}).get("names", []))] if t else []


def extras_of(template_id: str) -> list[dict]:
    t = catalog().get(template_id)
    if t is None:
        return []
    keys = ("formats", "styles", "merges", "rules", "links")
    return [{k: s.get(k, []) for k in keys} for s in t["sheets"]]


def sheets_of(template_id: str) -> list[tuple[str, list[tuple[int, int, str]]]] | None:
    t = catalog().get(template_id)
    if t is None:
        return None
    out = []
    for s in t["sheets"]:
        cells = [(r, c, v) for r, row in enumerate(grid_of(s)) for c, v in enumerate(row) if v != ""]
        out.append((s["name"][:31], cells))
    return out
