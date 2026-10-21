import io
import re
import struct

from xlrd import compdoc, formula as xf

FORMULA = 0x0006
SHRFMLA = 0x04BC
BOUNDSHEET = 0x0085
BOF = 0x0809
EOF = 0x000A
STRINGS = re.compile(r'"(?:[^"]|"")*"')
WHOLE = re.compile(r"(?<![A-Za-z0-9_.$])(\d+)\.0(?![0-9])")
SELF_RANGE = re.compile(r"(\$?[A-Z]{1,3}\$?\d+):\1(?![0-9A-Za-z$])")
TYPE_CELL = getattr(xf, "FMLA_TYPE_CELL", 1)
TYPE_SHARED = getattr(xf, "FMLA_TYPE_SHARED", 4)


def _records(mem: bytes, pos: int):
    n = len(mem)
    while pos + 4 <= n:
        op, ln = struct.unpack_from("<HH", mem, pos)
        yield op, pos + 4, ln
        pos += 4 + ln


def _text(book, rgce: bytes, kind: int, row: int, col: int) -> str | None:
    try:
        out = xf.decompile_formula(book, rgce, len(rgce), kind, browx=row, bcolx=col, blah=0, level=0)
    except Exception:
        return None
    if not out or "<" in out and ">" in out and "unknown" in out.lower():
        return None
    return tidy(out)


def tidy(text: str) -> str:
    parts = STRINGS.split(text)
    quoted = STRINGS.findall(text)
    out = []
    for i, p in enumerate(parts):
        p = WHOLE.sub(r"\1", p)
        p = SELF_RANGE.sub(r"\1", p)
        out.append(p)
        if i < len(quoted):
            out.append(quoted[i])
    return "".join(out)


def read(data: bytes, book, covered: list[set[tuple[int, int]]] | None = None) -> tuple[list[dict[tuple[int, int], str]], int]:
    try:
        doc = compdoc.CompDoc(data, io.StringIO())
        mem = doc.get_named_stream("Workbook") or doc.get_named_stream("Book")
    except Exception:
        return [], 0
    if not mem:
        return [], 0
    starts = []
    for op, at, _ in _records(mem, 0):
        if op == BOUNDSHEET:
            starts.append(struct.unpack_from("<I", mem, at)[0])
        elif op == EOF:
            if starts:
                break
    sheets: list[dict[tuple[int, int], str]] = []
    lost = 0
    for si, start in enumerate(starts):
        found: dict[tuple[int, int], str] = {}
        own = covered[si] if covered and si < len(covered) else set()
        shared: list[tuple[int, int, int, int, bytes]] = []
        pending: list[tuple[int, int]] = []
        depth = 0
        for op, at, ln in _records(mem, start):
            if op == BOF:
                depth += 1
                continue
            if op == EOF:
                depth -= 1
                if depth <= 0:
                    break
                continue
            if depth != 1:
                continue
            if op == FORMULA and ln >= 22:
                row, col = struct.unpack_from("<HH", mem, at)
                cb = struct.unpack_from("<H", mem, at + 20)[0]
                rgce = bytes(mem[at + 22 : at + 22 + cb])
                if rgce[:1] in (b"\x01", b"\x02"):
                    pending.append((row, col))
                else:
                    t = _text(book, rgce, TYPE_CELL, row, col)
                    if t is None:
                        lost += 1
                    else:
                        found[(row, col)] = t
            elif op == SHRFMLA and ln >= 10:
                r0, r1, c0, c1 = struct.unpack_from("<HHBB", mem, at)
                cce = struct.unpack_from("<H", mem, at + 8)[0]
                shared.append((r0, r1, c0, c1, bytes(mem[at + 10 : at + 10 + cce])))
        for row, col in pending:
            if (row, col) in own:
                continue
            hit =next((s for s in shared if s[0] <= row <= s[1] and s[2] <= col <= s[3]), None)
            t = _text(book, hit[4], TYPE_SHARED, row, col) if hit else None
            if t is None:
                lost += 1
            else:
                found[(row, col)] = t
        sheets.append(found)
    return sheets, lost
