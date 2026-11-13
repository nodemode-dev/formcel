import re

from ..xlsx.formulas import FUTURE, _sub, unwrap_arrayformula

STRING = re.compile(r'"(?:[^"]|"")*"')
ODF_NATIVE = {"DAYS", "IFNA", "XOR"}
BRACKET = re.compile(r"\[([^\]]+)\]")
PREFIX_IN = re.compile(r"(?:COM\.MICROSOFT\.|_xlfn\.(?:_xlws\.)?|ORG\.LIBREOFFICE\.)([A-Za-z][A-Za-z0-9.]*)(?=\s*\()", re.I)
BOOL_IN = re.compile(r"\b(TRUE|FALSE)\(\)", re.I)
BOOL_OUT = re.compile(r"(?<![A-Za-z0-9_.$!])(TRUE|FALSE)(?![A-Za-z0-9_.(!])", re.I)
SHEET = r"(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)"
CELL = r"\$?[A-Z]{1,3}\$?\d+"
COLS = r"\$?[A-Z]{1,3}:\$?[A-Z]{1,3}"
ROWS = r"\$?\d+:\$?\d+"
REF_OUT = re.compile(rf"(?<![A-Za-z0-9_.$!'\]])(?:({SHEET})!)?({CELL}(?::{CELL})?|{COLS}|{ROWS})(?![A-Za-z0-9_(!.\[])")
CALL = re.compile(r"(?<![A-Za-z0-9_.$!])([A-Za-z][A-Za-z0-9.]*)\s*\(")


def _outside(text: str, fn) -> str:
    out, at = [], 0
    for m in STRING.finditer(text):
        out.append(fn(text[at:m.start()]))
        out.append(m.group(0))
        at = m.end()
    out.append(fn(text[at:]))
    return "".join(out)


def _part(p: str) -> tuple[str, str]:
    p = p.strip()
    if "." in p:
        sheet, _, cell = p.rpartition(".")
        return sheet.lstrip("$"), cell
    return "", p


def _ref_in(inner: str) -> str:
    bits = inner.split(":")
    sheet, first = _part(bits[0])
    rest = [_part(b)[1] for b in bits[1:]]
    body = ":".join([first] + rest)
    return f"{sheet}!{body}" if sheet else body


def _seps(s: str, to_file: bool) -> str:
    out, depth, quoted, named = [], 0, False, False
    for ch in s:
        if ch == '"' and not named:
            quoted = not quoted
        elif ch == "'" and not quoted:
            named = not named
        if quoted or named or ch in "\"'":
            out.append(ch)
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        if to_file:
            if depth > 0 and ch == ",":
                ch = ";"
            elif depth > 0 and ch == ";":
                ch = "|"
            elif depth == 0 and ch == ",":
                ch = ";"
        else:
            if depth > 0 and ch == ";":
                ch = ","
            elif depth > 0 and ch == "|":
                ch = ";"
            elif depth == 0 and ch == ";":
                ch = ","
        out.append(ch)
    return "".join(out)


def from_file(f: str) -> str:
    body = f.split(":=", 1)[1] if ":=" in f[:6] else f.lstrip("=")

    def fix(s: str) -> str:
        s = BRACKET.sub(lambda m: _ref_in(m.group(1)), s)
        s = PREFIX_IN.sub(lambda m: m.group(1).upper(), s)
        return BOOL_IN.sub(lambda m: m.group(1).upper(), s)

    return "=" + _seps(_outside(body, fix), False)


def _ref_out(m: re.Match) -> str:
    sheet, ref = m.group(1), m.group(2)
    s = f"${sheet}." if sheet else "."
    parts = ref.split(":")
    if len(parts) == 1:
        return f"[{s}{parts[0]}]"
    return f"[{s}{parts[0]}:.{parts[1]}]"


def to_file(f: str) -> str:
    f = unwrap_arrayformula(f)
    body = f[1:] if f.startswith("=") else f

    def fix(s: str) -> str:
        s = REF_OUT.sub(_ref_out, s)
        s = _sub(CALL, lambda m: (m.group(1) if m.group(1).upper() in ODF_NATIVE or m.group(1).upper() not in FUTURE else "COM.MICROSOFT." + m.group(1).upper()) + "(", s)
        return _sub(BOOL_OUT, lambda m: m.group(1).upper() + "()", s)

    return "of:=" + _seps(_outside(body, fix), True)


def range_in(addr: str) -> str:
    return "=" + _ref_in(addr)
