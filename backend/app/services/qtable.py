from . import ranges


def unescape(s: str) -> str:
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            out.append({"t": "\t", "n": "\n", "r": "\r"}.get(s[i + 1], s[i + 1]))
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def parse(line: str) -> dict | None:
    p = line.split("\t")
    try:
        a = [int(x) for x in p[2].split(",")]
        return {"sheet": int(p[0]), "name": unescape(p[1]), "area": a, "parts": p, "totals": "t" in p[3], "cols": int(p[5])}
    except (IndexError, ValueError):
        return None


def tables_of(engine) -> list[dict]:
    return [t for t in (parse(x) for x in engine.tables()) if t]


def resized_line(t: dict, r1: int, c1: int) -> str:
    p = t["parts"]
    n = t["cols"]
    w = c1 - t["area"][1] + 1

    def fit(chunk: list[str]) -> list[str]:
        return (chunk + [""] * w)[:w]

    cols, calc, kept = p[6:6 + n], p[6 + n:6 + 2 * n], p[6 + 2 * n:6 + 3 * n]
    types = p[6 + 3 * n:6 + 4 * n] if len(p) >= 6 + 4 * n else []
    head = [p[1], f"{t['area'][0]},{t['area'][1]},{r1},{c1}", p[3], p[4], str(w)]
    return "\t".join(head + fit(cols) + fit(calc) + fit(kept) + (fit(types) if types else []))


def sync_names(engine, sheet: int, t: dict, header: list[str]) -> None:
    edits = []
    for i in range(min(len(header), t["area"][3] - t["area"][1] + 1)):
        text = str(header[i])
        edits.append((f"{ranges.col_name(t['area'][1] + i)}{t['area'][0] + 1}", text))
    if edits:
        engine.apply(edits, sheet)


def fit_table(engine, sheet: int, r0: int, c0: int, h: int, w: int, name: str | None, header: list[str] | None = None) -> str | None:
    if h < 2 or w < 1:
        return name
    found = None
    for t in tables_of(engine):
        if t["sheet"] == sheet and ((name and t["name"] == name) or (t["area"][0] == r0 and t["area"][1] == c0)):
            found = t
            break
    r1, c1 = r0 + h - 1, c0 + w - 1
    if found is None:
        engine.create_table(f"{ranges.col_name(c0)}{r0 + 1}", f"{ranges.col_name(c1)}{r1 + 1}", True, sheet)
        for t in tables_of(engine):
            if t["sheet"] == sheet and t["area"][0] == r0 and t["area"][1] == c0:
                return t["name"]
        return None
    if header:
        sync_names(engine, sheet, found, header)
        found = next((t for t in tables_of(engine) if t["name"] == found["name"]), found)
    if found["totals"]:
        return found["name"]
    if found["area"][2] != r1 or found["area"][3] != c1:
        engine.set_table(found["name"], resized_line(found, r1, c1))
    return found["name"]
