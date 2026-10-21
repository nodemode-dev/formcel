import re

from openpyxl.utils import get_column_letter

from .pdf import SLOTS, _colour, _style

DEFAULT_NAME = re.compile(r"^Sheet ?\d+$", re.I)
DEFAULT_COLUMN = re.compile(r"^Column\d+$")
MIN_CONTRAST = 4.5
DEFAULT_TEXT = (0.0, 0.0, 0.0)
DEFAULT_FILL = (1.0, 1.0, 1.0)


def _lum(rgb: tuple[float, float, float]) -> float:
    ch = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in rgb]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def contrast(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    hi, lo = sorted((_lum(a), _lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def _a1(r: int, c: int) -> str:
    return f"{get_column_letter(c + 1)}{r + 1}"


def check(eng, views: list[dict]) -> list[dict]:
    out: list[dict] = []
    theme = eng.theme().split(";")
    slots = dict(zip(SLOTS, (theme[1] if len(theme) > 1 else "").split(",")))
    names = eng.sheet_names()

    def add(sheet: int | None, level: str, rule: str, where: str, text: str, fix: str) -> None:
        out.append({"sheet": sheet, "level": level, "rule": rule, "where": where, "text": text, "fix": fix})

    for i, name in enumerate(names):
        view = views[i] if i < len(views) else {}
        for obj in view.get("objects") or []:
            if not str(obj.get("alt") or "").strip():
                add(i, "error", "alt", str(obj.get("name") or obj.get("id") or "Object"), f"{obj.get('kind', 'Object')} has no alternative text.", "Add a description of what the object shows.")
        if DEFAULT_NAME.match(name.strip()):
            add(i, "tip", "sheetname", "A1", f"Sheet \"{name}\" has a default name.", "Rename the sheet so it says what it holds.")
        merges = eng.merges(i)
        if merges:
            r0, c0, r1, c1 = merges[0]
            add(i, "warning", "merged", _a1(r0, c0), f"{len(merges)} merged {'cell range' if len(merges) == 1 else 'cell ranges'} on this sheet.", "Avoid merged cells: screen readers and keyboard navigation skip over them. Unmerge them or use a plain layout.")
        weak = []
        for r, c, _ in eng.styles(i):
            st = _style(eng.effective_style(_a1(r, c), i))
            fc, bg = st.get("fc"), st.get("bg")
            if not fc and not bg:
                continue
            try:
                a = _colour(fc, slots) if fc else DEFAULT_TEXT
                b = _colour(bg, slots) if bg else DEFAULT_FILL
            except (ValueError, KeyError):
                continue
            if contrast(a, b) < MIN_CONTRAST:
                weak.append((r, c))
        if weak:
            r, c = weak[0]
            add(i, "warning", "contrast", _a1(r, c), f"{len(weak)} {'cell has' if len(weak) == 1 else 'cells have'} hard-to-read text colour on its fill (contrast under 4.5 to 1).", "Pick a text colour that stands out from the fill.")
    for line in eng.tables():
        p = line.split("\t")
        try:
            sheet, n = int(p[0]), int(p[5])
        except (ValueError, IndexError):
            continue
        bad = [x for x in p[6:6 + n] if not x.strip() or DEFAULT_COLUMN.match(x)]
        if bad:
            add(sheet, "warning", "tableheader", p[1], f"Table {p[1]} has {len(bad)} header {'cell' if len(bad) == 1 else 'cells'} without a meaningful name ({bad[0] or 'blank'}).", "Give each column a header that says what it holds.")
    return out
