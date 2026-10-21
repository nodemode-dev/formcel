from collections import Counter

HANDLED = {"Print_Area", "Print_Titles", "_FilterDatabase"}


def skip_name(name: str, dn, notes: Counter) -> bool:
    if name.startswith("_xlnm."):
        if name[6:] not in HANDLED:
            notes["built-in names other than print areas, print titles and filter ranges left out"] += 1
        return True
    return bool(dn.hidden and name.startswith("_xl"))


def extra_areas(ws) -> int:
    area = ws.print_area
    if not area:
        return 0
    parts = [p for p in (area.split(",") if isinstance(area, str) else list(area)) if p]
    return max(0, len(parts) - 1)
