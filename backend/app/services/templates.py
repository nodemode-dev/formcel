import json
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent / "templates"
SOURCES = ("native.json", "formmd.json")
ORDER = ("Spreadsheets", "Data & charts", "Example projects")
PREVIEW_ROWS = 8
PREVIEW_COLS = 6


@lru_cache(maxsize=1)
def catalog() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for name in SOURCES:
        for t in json.loads((HERE / name).read_text(encoding="utf-8")):
            t["source"] = "form.md" if name == "formmd.json" else "formcel"
            out[t["id"]] = t
    return out


def grid_of(sheet: dict) -> list[list[str]]:
    head = [sheet["columns"]] if any(sheet["columns"]) else []
    return head + sheet["rows"]


def preview(sheet: dict) -> list[list[str]]:
    return [row[:PREVIEW_COLS] for row in grid_of(sheet)[:PREVIEW_ROWS]]


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
        "preview": preview(t["sheets"][0]),
    }


def listing() -> dict:
    items = sorted(catalog().values(), key=lambda t: (ORDER.index(t["category"]) if t["category"] in ORDER else len(ORDER), not t.get("featured"), t["name"]))
    cats = [{"name": c, "count": sum(1 for t in items if t["category"] == c)} for c in ORDER]
    return {"categories": cats, "templates": [summary(t) for t in items]}


def sheets_of(template_id: str) -> list[tuple[str, list[tuple[int, int, str]]]] | None:
    t = catalog().get(template_id)
    if t is None:
        return None
    out = []
    for s in t["sheets"]:
        cells = [(r, c, v) for r, row in enumerate(grid_of(s)) for c, v in enumerate(row) if v != ""]
        out.append((s["name"][:31], cells))
    return out
