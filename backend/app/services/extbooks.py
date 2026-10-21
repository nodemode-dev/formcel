import re

from . import hostcalls, ranges

EXTENSION = re.compile(r"\.(fcel|xlsx|xlsm|xlsb|xls|ods|csv)$", re.I)
ERRORS = {"#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!"}
EXACT_LIMIT = 100_000


def stem(name: str) -> str:
    return EXTENSION.sub("", name.strip()).lower()


def find(store, book: str) -> str | None:
    want = stem(book)
    for item in store.listing():
        if item["id"].lower() == want or stem(item["title"]) == want:
            return item["id"]
    return None


def token(v) -> str:
    if isinstance(v, str) and v in ERRORS:
        return f"e:{v}"
    return hostcalls.cell(v)


def values(books, store, book: str, sheet: str, area: tuple[int, int, int, int]) -> str:
    wid = find(store, book)
    if wid is None:
        return "e:#REF!"
    b = books(wid)
    with b.lock:
        names = [n.lower() for n in b.sheet_names()]
        if sheet.lower() not in names:
            return "e:#REF!"
        idx = names.index(sheet.lower())
        r0, c0, r1, c1 = area
        used = ranges.used_area(b.engine, idx)
        full = (r1 - r0 + 1) * (c1 - c0 + 1)
        if full > EXACT_LIMIT:
            if used is None:
                return "z:"
            r1, c1 = min(r1, used[2]), min(c1, used[3])
            if r1 < r0 or c1 < c0:
                return "z:"
        grid = ranges.grid(b.engine, idx, (r0, c0, r1, c1))
    return "\n".join("\t".join(token(v) for v in row) for row in grid)


def resolve(args: list, books) -> str:
    from .store import store

    if len(args) != 4:
        raise ValueError("wrong number of arguments")
    _, book, sheet, spec = (hostcalls.text_arg(a) for a in args)
    nums = [int(x) for x in spec.split(",")]
    if len(nums) != 4:
        raise ValueError("bad area")
    return values(books, store(), book, sheet, (nums[0], nums[1], nums[2], nums[3]))
