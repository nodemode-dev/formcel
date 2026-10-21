import json
import re
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


def from_file(formula: str) -> str:
    return _outside(formula, lambda s: PREFIX.sub("", s))


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
    params = _params(formula)

    def fix(s: str) -> str:
        s = CALL.sub(lambda m: (FUTURE.get(m.group(1).upper(), m.group(1)) if m.group(1).upper() not in params else m.group(1)) + "(", s)
        for p in sorted(params, key=len, reverse=True):
            s = re.sub(WORD.format(re.escape(p)), lambda m: "_xlpm." + m.group(1), s, flags=re.I)
            s = re.sub(r"(?<![A-Za-z0-9_.$!])(" + re.escape(p) + r")(?=\s*\()", lambda m: "_xlpm." + m.group(1), s, flags=re.I)
        return s

    return _outside(formula, fix)
