import json
import re
from contextvars import ContextVar
from pathlib import Path

FUTURE: dict[str, str] = json.loads((Path(__file__).with_name("future.json")).read_text(encoding="utf-8"))["functions"]
STRING = re.compile(r'"(?:[^"]|"")*"')
PREFIX = re.compile(r"_xlfn\.(?:_xlws\.)?|_xlpm\.|_xlws\.", re.I)
CALL = re.compile(r"(?<![A-Za-z0-9_.$!])([A-Za-z][A-Za-z0-9.]*)\s*\(")
WORD = r"(?<![A-Za-z0-9_.$!:\[])({})(?![A-Za-z0-9_.!(\[])"


def _outside(text: str, fn) -> str:
    out, at = [], 0
    for m in STRING.finditer(text):
        out.append(fn(text[at:m.start()]))
        out.append(m.group(0))
        at = m.end()
    out.append(fn(text[at:]))
    return "".join(out)


REF = r"(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Z]{1,3}\$?\d+"
ANCHOR_IN = re.compile(rf"ANCHORARRAY\(\s*({REF})\s*\)", re.I)
ANCHOR_OUT = re.compile(rf"(?<![A-Za-z0-9_.$])({REF})#")


def _close(s: str, open_at: int) -> int:
    depth, quoted = 0, False
    for i in range(open_at, len(s)):
        ch = s[i]
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch in "({":
            depth += 1
        elif not quoted and ch in ")}":
            depth -= 1
            if depth == 0:
                return i
    return len(s) - 1


def _singles_in(s: str) -> str:
    while True:
        m = re.search(r"(?<![A-Za-z0-9_.])SINGLE\(", s, re.I)
        if not m:
            return s
        end = _close(s, m.end() - 1)
        inner = s[m.end():end]
        simple = re.fullmatch(rf"{REF}(?::\$?[A-Z]{{1,3}}\$?\d+)?|[A-Za-z_][A-Za-z0-9_.]*(?:\(.*\))?|\{{.*\}}", inner.strip(), re.S)
        s = s[:m.start()] + "@" + (inner if simple else f"({inner})") + s[end + 1:]


def _singles_out(s: str) -> str:
    out, i = [], 0
    while i < len(s):
        ch = s[i]
        if ch == '"':
            j = i + 1
            while j < len(s) and not (s[j] == '"' and (j + 1 >= len(s) or s[j + 1] != '"')):
                j += 2 if s[j] == '"' else 1
            out.append(s[i:j + 1])
            i = j + 1
            continue
        if ch != "@":
            out.append(ch)
            i += 1
            continue
        j = i + 1
        if j < len(s) and s[j] in "({":
            end = _close(s, j)
            operand = s[j:end + 1]
        else:
            m = re.match(rf"{REF}(?::\$?[A-Z]{{1,3}}\$?\d+)?|[A-Za-z_][A-Za-z0-9_.]*", s[j:])
            operand = m.group(0) if m else ""
            end = j + len(operand) - 1
            if end + 1 < len(s) and s[end + 1] == "(":
                close = _close(s, end + 1)
                operand = s[j:close + 1]
                end = close
        inner = operand[1:-1] if operand.startswith("(") and operand.endswith(")") else operand
        out.append(f"_xlfn.SINGLE({_singles_out(inner)})")
        i = end + 1
    return "".join(out)


def unwrap_arrayformula(s: str) -> str:
    at = 0
    while True:
        m = re.compile(r"(?<![A-Za-z0-9_.])ARRAYFORMULA\(", re.I).search(s, at)
        if not m:
            return s
        if s[:m.start()].count('"') % 2:
            at = m.end()
            continue
        end = _close(s, m.end() - 1)
        s = s[:m.start()] + "(" + s[m.end():end] + ")" + s[end + 1:]
        at = m.start()


EXT_BOOKS: ContextVar[list[tuple[str, str]] | None] = ContextVar("ext_books", default=None)
EXT_QUOTED_IN = re.compile(r"'\[(\d+)\]((?:[^']|'')+)'!")
EXT_PLAIN_IN = re.compile(r"(?<![A-Za-z0-9_.$'])\[(\d+)\]([A-Za-z_][A-Za-z0-9_.]*)!")
EXT_OUT: ContextVar[dict[tuple[str, str], int] | None] = ContextVar("ext_out", default=None)
EXT_SHEETS: ContextVar[dict[tuple[str, str], list[str]] | None] = ContextVar("ext_sheets", default=None)
EXT_ANY_OUT = re.compile(r"'((?:[^']|'')*\[[^\]'!]+\](?:[^']|'')*)'!|(?<![A-Za-z0-9_.$'\]])\[([^\]'!\[]+)\]([A-Za-z_][A-Za-z0-9_.]*)!")
SIMPLE_BOOK = re.compile(r"[A-Za-z0-9._-]+")
SIMPLE_SHEET = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _ext_ref_in(n: int, sheet: str) -> str:
    books = EXT_BOOKS.get() or []
    if not 1 <= n <= len(books):
        return "#REF!"
    path, name = books[n - 1]
    sheet = sheet.replace("''", "'")
    if not path and SIMPLE_BOOK.fullmatch(name) and SIMPLE_SHEET.fullmatch(sheet):
        return f"[{name}]{sheet}!"
    return "'" + f"{path}[{name}]{sheet}".replace("'", "''") + "'!"


def _ext_in(s: str) -> str:
    if not (EXT_BOOKS.get() or []):
        return s
    s = EXT_QUOTED_IN.sub(lambda m: _ext_ref_in(int(m.group(1)), m.group(2)), s)
    return EXT_PLAIN_IN.sub(lambda m: _ext_ref_in(int(m.group(1)), m.group(2)), s)


def _split_book(text: str) -> tuple[str, str, str] | None:
    close = text.rfind("]")
    open_at = text.rfind("[", 0, close) if close >= 0 else -1
    if open_at < 0 or close - open_at < 2 or close == len(text) - 1:
        return None
    return text[:open_at], text[open_at + 1:close], text[close + 1:]


def _ext_ref_out(text: str) -> str:
    parts = _split_book(text.replace("''", "'"))
    ledger = EXT_OUT.get()
    if parts is None or ledger is None:
        return text
    path, name, sheet = parts
    key = (path, name)
    if key not in ledger:
        ledger[key] = len(ledger) + 1
    n = ledger[key]
    seen = EXT_SHEETS.get()
    if seen is not None and sheet not in seen.setdefault(key, []):
        seen[key].append(sheet)
    if SIMPLE_SHEET.fullmatch(sheet):
        return f"[{n}]{sheet}!"
    return "'" + f"[{n}]{sheet}".replace("'", "''") + "'!"


def _ext_out(s: str) -> str:
    if EXT_OUT.get() is None or "[" not in s:
        return s
    return EXT_ANY_OUT.sub(lambda m: _ext_ref_out(m.group(1) if m.group(1) is not None else f"[{m.group(2)}]{m.group(3)}"), s)


def from_file(formula: str) -> str:
    plain = _outside(formula, lambda s: _ext_in(PREFIX.sub("", s)))
    return _singles_in(_outside(plain, lambda s: ANCHOR_IN.sub(lambda m: m.group(1) + "#", s)))


def _args(text: str, open_at: int) -> list[str]:
    depth, start, out, i = 0, open_at + 1, [], open_at
    in_str = False
    while i < len(text):
        ch = text[i]
        if ch == '"':
            in_str = not in_str
        elif not in_str:
            if ch in "({":
                depth += 1
            elif ch in ")}":
                depth -= 1
                if depth == 0:
                    out.append(text[start:i])
                    return out
            elif ch == "," and depth == 1:
                out.append(text[start:i])
                start = i + 1
        i += 1
    return out


def _params(formula: str) -> set[str]:
    names: set[str] = set()
    for m in CALL.finditer(formula):
        fn = m.group(1).upper()
        if fn not in ("LET", "LAMBDA"):
            continue
        args = [a.strip() for a in _args(formula, m.end() - 1)]
        picks = args[:-1] if fn == "LAMBDA" else args[:-1:2]
        names.update(a for a in picks if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", a))
    return names


def to_file(formula: str) -> str:
    formula = unwrap_arrayformula(formula)
    params = _params(formula)

    def fix(s: str) -> str:
        s = CALL.sub(lambda m: (FUTURE.get(m.group(1).upper(), m.group(1)) if m.group(1).upper() not in params else m.group(1)) + "(", s)
        for p in sorted(params, key=len, reverse=True):
            s = re.sub(WORD.format(re.escape(p)), lambda m: "_xlpm." + m.group(1), s, flags=re.I)
            s = re.sub(r"(?<![A-Za-z0-9_.$!])(" + re.escape(p) + r")(?=\s*\()", lambda m: "_xlpm." + m.group(1), s, flags=re.I)
        return ANCHOR_OUT.sub(lambda m: f"_xlfn.ANCHORARRAY({m.group(1)})", _ext_out(s))

    return _singles_out(_outside(formula, fix))
