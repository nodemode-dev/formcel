import io
import re
from html.parser import HTMLParser

from formcel_engine import MAX_COLS, MAX_ROWS, reads_as_text

from . import csvio

MAX_PAGES = 300
CELL_GAP = 0.7
LINE_TOL = 0.5
NAME_BAD = re.compile(r"[\\/*?:\[\]]")


class _Tables(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self.depth = 0
        self.rows: list[list[str]] = []
        self.row: list[str] | None = None
        self.cell: list[str] | None = None
        self.span = 1
        self.rowspans: dict[int, tuple[int, str]] = {}

    def handle_starttag(self, tag: str, attrs: list) -> None:
        d = dict(attrs)
        if tag == "table":
            self.depth += 1
            if self.depth == 1:
                self.rows, self.rowspans = [], {}
        elif self.depth == 1 and tag == "tr":
            self.row = []
        elif self.depth == 1 and tag in ("td", "th") and self.row is not None:
            self.cell = []
            self.span = max(1, min(int(d["colspan"]), 200)) if str(d.get("colspan", "")).isdigit() else 1
            self.cell_rows = max(1, min(int(d["rowspan"]), 1000)) if str(d.get("rowspan", "")).isdigit() else 1
        elif self.cell is not None and tag in ("br", "p", "div"):
            self.cell.append(" ")

    def handle_data(self, data: str) -> None:
        if self.cell is not None and self.depth == 1:
            self.cell.append(data)

    def _close_cell(self) -> None:
        if self.cell is None or self.row is None:
            return
        text = re.sub(r"\s+", " ", "".join(self.cell)).strip()
        self._fill_spans()
        self.row.append(text)
        if self.cell_rows > 1:
            self.rowspans[len(self.row) - 1] = (self.cell_rows - 1, text)
        for _ in range(self.span - 1):
            self._fill_spans()
            self.row.append("")
        self.cell = None

    def _fill_spans(self) -> None:
        while self.row is not None and len(self.row) in self.rowspans:
            left, text = self.rowspans.pop(len(self.row))
            if left > 1:
                self.rowspans[len(self.row)] = (left - 1, text)
            self.row.append(text)

    def handle_endtag(self, tag: str) -> None:
        if self.depth == 1 and tag in ("td", "th"):
            self._close_cell()
        elif self.depth == 1 and tag == "tr" and self.row is not None:
            self._close_cell()
            self._fill_spans()
            self.rows.append(self.row)
            self.row = None
        elif tag == "table" and self.depth:
            self.depth -= 1
            if self.depth == 0:
                if self.row is not None:
                    self._close_cell()
                    self.rows.append(self.row)
                    self.row = None
                if any(any(c for c in r) for r in self.rows):
                    self.tables.append(self.rows)


def html_tables(text: str) -> list[list[list[str]]]:
    p = _Tables()
    p.feed(text)
    p.close()
    return p.tables


def _lines(words: list[dict]) -> list[list[dict]]:
    out: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (round(w["top"], 1), w["x0"])):
        mid = (w["top"] + w["bottom"]) / 2
        if out:
            last = out[-1]
            lo = min(x["top"] for x in last)
            hi = max(x["bottom"] for x in last)
            tol = LINE_TOL * (w["bottom"] - w["top"])
            if lo - tol <= mid <= hi + tol:
                last.append(w)
                continue
        out.append([w])
    for line in out:
        line.sort(key=lambda w: w["x0"])
    return out


def _cells(line: list[dict]) -> list[tuple[float, float, str]]:
    size = sorted(w["bottom"] - w["top"] for w in line)[len(line) // 2] or 10.0
    cells: list[list] = []
    for w in line:
        if cells and w["x0"] - cells[-1][1] <= CELL_GAP * size:
            cells[-1][1] = max(cells[-1][1], w["x1"])
            cells[-1][2] += " " + w["text"]
        else:
            cells.append([w["x0"], w["x1"], w["text"]])
    return [(c[0], c[1], c[2]) for c in cells]


def _columns(rows: list[list[tuple[float, float, str]]]) -> list[tuple[float, float]]:
    spans = sorted((c[0], c[1]) for r in rows for c in r)
    cols: list[list[float]] = []
    for a, b in spans:
        if cols and a <= cols[-1][1]:
            cols[-1][1] = max(cols[-1][1], b)
        else:
            cols.append([a, b])
    return [(c[0], c[1]) for c in cols]


def _grid(run: list[list[tuple[float, float, str]]]) -> list[list[str]]:
    cols = _columns(run[1:] if len(run) > 2 else run)
    if len(cols) < 2:
        return []
    out = []
    for line in run:
        row = [""] * len(cols)
        for a, b, t in line:
            hit = [i for i, (x0, x1) in enumerate(cols) if a < x1 and b > x0]
            if not hit:
                hit = [min(range(len(cols)), key=lambda i: abs((cols[i][0] + cols[i][1]) / 2 - (a + b) / 2))]
            i = hit[0]
            row[i] = f"{row[i]} {t}".strip() if row[i] else t
        out.append(row)
    return out


def pdf_tables(data: bytes) -> list[tuple[int, list[list[str]]]]:
    import pdfplumber

    found: list[tuple[int, list[list[str]]]] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for n, page in enumerate(pdf.pages[:MAX_PAGES], 1):
            words = page.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False)
            run: list[list[tuple[float, float, str]]] = []
            for line in [*_lines(words), []]:
                cells = _cells(line) if line else []
                if len(cells) >= 2:
                    run.append(cells)
                    continue
                if len(run) >= 2:
                    grid = _grid(run)
                    if grid:
                        found.append((n, grid))
                run = []
    return found


def _name(base: str, taken: set[str]) -> str:
    base = NAME_BAD.sub(" ", base).strip()[:28] or "Sheet"
    name, k = base, 2
    while name.lower() in taken:
        name = f"{base[:28]} {k}"
        k += 1
    taken.add(name.lower())
    return name


def cells_of(rows: list[list[str]]) -> list[tuple[int, int, str]]:
    width = max((len(r) for r in rows), default=0)
    text_cols = set()
    body = rows[1:] if len(rows) > 1 else rows
    for c in range(min(width, MAX_COLS)):
        if csvio.guess([r[c] for r in body if c < len(r)])[1] == "text":
            text_cols.add(c)
    out = []
    for r, rec in enumerate(rows[:MAX_ROWS]):
        for c, v in enumerate(rec[:MAX_COLS]):
            v = v.strip()
            if v == "":
                continue
            if c in text_cols or v.startswith("=") or (v.startswith("'") and len(v) > 1):
                out.append((r, c, v if reads_as_text(v) else "'" + v))
            else:
                out.append((r, c, v))
    return out


def read(data: bytes, kind: str) -> tuple[list[tuple[str, list[tuple[int, int, str]]]], list[str]]:
    taken: set[str] = set()
    sheets: list[tuple[str, list[tuple[int, int, str]]]] = []
    notes: list[str] = []
    if kind == "pdf":
        try:
            tables = pdf_tables(data)
        except Exception as e:
            raise ValueError(f"That PDF could not be read: {e}") from e
        if not tables:
            raise ValueError("No tables were found in that PDF. Scanned pages have no text to read; run them through Data > Pictures to text first.")
        per_page: dict[int, int] = {}
        for page, rows in tables:
            per_page[page] = per_page.get(page, 0) + 1
            label = f"Page {page}" if per_page[page] == 1 and sum(1 for p, _ in tables if p == page) == 1 else f"Page {page} Table {per_page[page]}"
            sheets.append((_name(label, taken), cells_of(rows)))
        notes.append(f"{len(tables)} table{'s' if len(tables) != 1 else ''} found in the PDF by word positions")
    elif kind == "paste":
        text, _ = csvio.decode(data)
        rows = csvio.rows_of(text, csvio.sniff(text, "pasted.txt"))
        if not rows:
            raise ValueError("There was nothing to paste.")
        sheets.append(("Pasted data", cells_of(rows)))
    else:
        text, _ = csvio.decode(data)
        tables = html_tables(text)
        if not tables:
            raise ValueError("No table was found in that HTML.")
        for i, rows in enumerate(tables, 1):
            sheets.append((_name(f"Table {i}", taken), cells_of(rows)))
    return sheets, notes
