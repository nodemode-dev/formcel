import csv
import io
import re

from formcel_engine import MAX_COLS, MAX_ROWS, reads_as_text

DELIMITERS = {",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe"}
BY_NAME = {v: k for k, v in DELIMITERS.items()}
SAMPLE_ROWS = 12
GUESS_ROWS = 2000
LEADING_ZERO = re.compile(r"^0\d+$")
LONG_DIGITS = re.compile(r"^\d{16,}$")


def decode(data: bytes) -> tuple[str, str]:
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", "replace"), "UTF-8"
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", "replace"), "UTF-16"
    try:
        return data.decode("utf-8"), "UTF-8"
    except UnicodeDecodeError:
        return data.decode("cp1252", "replace"), "Windows-1252"


def sniff(text: str, name: str) -> str:
    if name.lower().endswith(".tsv"):
        return "\t"
    line = text.split("\n", 1)[0]
    best, count = ",", line.count(",")
    for d in (";", "\t", "|"):
        if line.count(d) > count:
            best, count = d, line.count(d)
    return best


def rows_of(text: str, delimiter: str) -> list[list[str]]:
    out = []
    for rec in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter):
        if len(out) >= MAX_ROWS:
            break
        out.append(rec[:MAX_COLS])
    while out and not any(v.strip() for v in out[-1]):
        out.pop()
    return out


def guess(values: list[str]) -> tuple[str, str]:
    vals = [v.strip() for v in values if v.strip()]
    if not vals:
        return "Empty", "general"
    typed = [not reads_as_text(v) for v in vals]
    nums = 0
    for v in vals:
        try:
            float(v.replace(",", ""))
            nums += 1
        except ValueError:
            pass
    keep = any(LEADING_ZERO.match(v) or LONG_DIGITS.match(v) for v in vals)
    if keep:
        label = "Numbers with leading zeros or over 15 digits"
    elif nums == len(vals):
        label = "Numbers"
    elif all(typed):
        label = "Dates, times or numbers"
    elif not any(typed):
        label = "Text"
    else:
        label = "Mixed"
    return label, "text" if keep else "general"


def preview(data: bytes, name: str, delimiter: str | None) -> dict:
    text, enc = decode(data)
    d = BY_NAME.get(delimiter or "") or sniff(text, name)
    rows = rows_of(text, d)
    width = max((len(r) for r in rows), default=0)
    body = rows[1:GUESS_ROWS + 1] if len(rows) > 1 else rows
    cols = []
    for c in range(width):
        label, suggest = guess([r[c] for r in body if c < len(r)])
        cols.append({"label": label, "as": suggest})
    sample = [[v[:80] for v in r] for r in rows[:SAMPLE_ROWS]]
    return {"name": name, "delimiter": DELIMITERS[d], "encoding": enc, "rows": len(rows), "columns": cols, "sample": sample}


def write(values: list[tuple[int, int, str]], delimiter: str) -> str:
    if not values:
        return ""
    rows = max(r for r, _, _ in values) + 1
    cols = max(c for _, c, _ in values) + 1
    grid = [[""] * cols for _ in range(rows)]
    for r, c, v in values:
        grid[r][c] = v
    out = io.StringIO()
    w = csv.writer(out, delimiter=delimiter, lineterminator="\r\n")
    for row in grid:
        while row and row[-1] == "":
            row.pop()
        w.writerow(row)
    return out.getvalue()


def cells(data: bytes, name: str, delimiter: str | None, text_cols: set[int], max_rows: int = 0) -> tuple[list[tuple[int, int, str]], dict]:
    text, enc = decode(data)
    d = BY_NAME.get(delimiter or "") or sniff(text, name)
    out = []
    rows = rows_of(text, d)
    cut = max_rows if 0 < max_rows < len(rows) else 0
    for r, rec in enumerate(rows[:cut] if cut else rows):
        for c, v in enumerate(rec):
            if v == "":
                continue
            if c in text_cols or v.startswith("=") or (v.startswith("'") and len(v) > 1):
                out.append((r, c, v if reads_as_text(v) else "'" + v))
            else:
                out.append((r, c, v))
    return out, {"delimiter": DELIMITERS[d], "encoding": enc, "cut": cut, "rows": len(rows)}
