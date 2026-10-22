import re

LITERAL = re.compile(r'PY\(\s*"((?:[^"]|"")*)"', re.I)


def before(b, code: str) -> list[str]:
    found: list[tuple[int, int, int, str]] = []
    with b.lock:
        for i in range(len(b.sheet_names())):
            for item in b.engine.cells(i):
                f = item[2]
                if isinstance(f, str) and f.startswith("="):
                    m = LITERAL.search(f)
                    if m:
                        found.append((i, item[0], item[1], m.group(1).replace('""', '"')))
    found.sort()
    out: list[str] = []
    for _, _, _, c in found:
        if c == code:
            return out[-30:]
        out.append(c)
    return []
