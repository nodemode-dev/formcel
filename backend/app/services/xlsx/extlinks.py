import re

from openpyxl.packaging.relationship import Relationship
from openpyxl.utils import get_column_letter
from openpyxl.workbook.external_link.external import (
    ExternalBook,
    ExternalCell,
    ExternalLink,
    ExternalRow,
    ExternalSheetData,
    ExternalSheetDataSet,
    ExternalSheetNames,
)

from .formulas import EXT_BOOKS, EXT_OUT, EXT_SHEETS

FILE_PREFIX = re.compile(r"^file:/+", re.I)


def unesc(s: str) -> str:
    out, i = [], 0
    while i < len(s):
        ch = s[i]
        if ch == "\\" and i + 1 < len(s):
            nxt = s[i + 1]
            out.append({"t": "\t", "n": "\n", "r": "\r"}.get(nxt, nxt))
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def parse(lines: list[str]) -> list[dict]:
    books: list[dict] = []
    for line in lines:
        p = line.split("\t")
        if p[0] == "book" and len(p) >= 4:
            books.append({"path": unesc(p[1]), "name": unesc(p[2]), "broken": p[3] == "1", "sheets": {}})
        elif p[0] == "sheet" and len(p) >= 3 and p[1].isdigit() and int(p[1]) < len(books):
            books[int(p[1])]["sheets"].setdefault(unesc(p[2]), {})
        elif p[0] == "cell" and len(p) >= 6 and p[1].isdigit() and int(p[1]) < len(books):
            tok = unesc(p[5])
            books[int(p[1])]["sheets"].setdefault(unesc(p[2]), {})[(int(p[3]), int(p[4]))] = (tok[:2], unesc(tok[2:]))
    return books


def _cell(r: int, c: int, kind: str, body: str):
    ref = f"{get_column_letter(c + 1)}{r + 1}"
    if kind == "n:":
        return ExternalCell(r=ref, t="n", v=body)
    if kind == "b:":
        return ExternalCell(r=ref, t="b", v=body)
    if kind == "e:":
        return ExternalCell(r=ref, t="e", v=body)
    if kind == "t:":
        return ExternalCell(r=ref, t="str", v=body)
    return None


def links_out(wb, lines: list[str]) -> None:
    ledger = EXT_OUT.get() or {}
    seen = EXT_SHEETS.get() or {}
    known = {(b["path"].lower(), b["name"].lower()): b for b in parse(lines)}
    for (path, name), _ in sorted(ledger.items(), key=lambda kv: kv[1]):
        book = known.get((path.lower(), name.lower()), {"sheets": {}})
        names = list(seen.get((path, name), []))
        for s in book["sheets"]:
            if s not in names:
                names.append(s)
        data = []
        for sid, sheet in enumerate(names):
            cells = book["sheets"].get(sheet, {})
            rows: dict[int, list] = {}
            for (r, c), (kind, body) in sorted(cells.items()):
                cell = _cell(r, c, kind, body)
                if cell is not None:
                    rows.setdefault(r, []).append(cell)
            data.append(ExternalSheetData(sheetId=sid, row=[ExternalRow(r=r + 1, cell=cs) for r, cs in sorted(rows.items())]))
        link = ExternalLink(externalBook=ExternalBook(sheetNames=ExternalSheetNames(sheetName=names), sheetDataSet=ExternalSheetDataSet(sheetData=data), id="rId1"))
        link.file_link = Relationship(type="externalLinkPath", Target=path + name, TargetMode="External", Id="rId1")
        wb._external_links.append(link)


def split_target(target: str) -> tuple[str, str]:
    t = FILE_PREFIX.sub("", target or "")
    cut = max(t.rfind("/"), t.rfind("\\"))
    return (t[:cut + 1], t[cut + 1:]) if cut >= 0 else ("", t)


def books_in(wb) -> list[tuple[str, str]]:
    out = []
    for link in getattr(wb, "_external_links", []):
        target = getattr(getattr(link, "file_link", None), "Target", "") or ""
        out.append(split_target(target))
    EXT_BOOKS.set(out)
    return out


def lines_in(wb) -> list[str]:
    books = []
    for link in getattr(wb, "_external_links", []):
        target = getattr(getattr(link, "file_link", None), "Target", "") or ""
        book = link.externalBook
        names = list(book.sheetNames.sheetName) if book is not None and book.sheetNames is not None else []
        cached: dict[str, dict] = {n: {} for n in names}
        sets = book.sheetDataSet.sheetData if book is not None and book.sheetDataSet is not None else []
        for sd in sets:
            if sd.sheetId is None or sd.sheetId >= len(names):
                continue
            for row in sd.row:
                for cell in row.cell:
                    m = re.fullmatch(r"([A-Z]{1,3})(\d+)", cell.r or "")
                    if not m or cell.v is None:
                        continue
                    col = 0
                    for ch in m.group(1):
                        col = col * 26 + ord(ch) - 64
                    kind = {"b": "b:", "e": "e:", "n": "n:", None: "n:"}.get(cell.t, "t:")
                    cached[names[sd.sheetId]][(int(m.group(2)) - 1, col - 1)] = kind + esc(str(cell.v))
        books.append((split_target(target), cached))
    out: list[str] = []
    for i, ((path, name), cached) in enumerate(books):
        out.append(f"book\t{esc(path)}\t{esc(name)}\t0")
        for sheet, cells in cached.items():
            out.append(f"sheet\t{i}\t{esc(sheet)}")
            for (r, c), tok in cells.items():
                out.append(f"cell\t{i}\t{esc(sheet)}\t{r}\t{c}\t{esc(tok)}")
    return out
