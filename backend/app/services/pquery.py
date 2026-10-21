import json
import re
import sqlite3
from datetime import date, datetime
from pathlib import Path

from . import ranges, webdata

MAX_ROWS = 200_000


class QueryError(Exception):
    pass


class Table:
    def __init__(self, cols: list[str], rows: list[list]):
        self.cols = cols
        self.rows = rows

    def idx(self, name: str) -> int:
        for i, c in enumerate(self.cols):
            if c == name:
                return i
        for i, c in enumerate(self.cols):
            if c.lower() == str(name).lower():
                return i
        raise QueryError(f"there is no column {name}")


def blank(rows: list[list]) -> Table:
    w = max((len(r) for r in rows), default=0)
    return Table([f"Column{i + 1}" for i in range(w)], [list(r) + [None] * (w - len(r)) for r in rows])


def num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    s = s[1:] if s.startswith("$") else s
    try:
        if s.endswith("%"):
            return float(s[:-1]) / 100
        return float(s)
    except ValueError:
        return None


def txt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def source(src: dict, books, fresh: bool = False, ctx=None) -> Table:
    kind = src.get("kind", "")
    if kind in ("csv", "text"):
        text = src.get("text") or ""
        if not text and src.get("url"):
            body, ctype = webdata.fetch(src["url"], fresh)
            text = webdata.decode(body, ctype)
        return blank(webdata.split_csv(text, src.get("delimiter") or None))
    if kind == "json":
        text = src.get("text") or ""
        if not text and src.get("url"):
            body, ctype = webdata.fetch(src["url"], fresh)
            text = webdata.decode(body, ctype)
        try:
            data = json.loads(text)
        except ValueError as e:
            raise QueryError(f"not valid JSON: {e}")
        rows = webdata.json_rows(data)
        t = blank(rows)
        t.rows = [[None if v == "" else v for v in r] for r in t.rows]
        if rows and all(isinstance(c, str) for c in rows[0]) and isinstance(data, (list, dict)) and webdata.is_records(data):
            return Table(unique([txt(v) for v in rows[0]]), t.rows[1:])
        return t
    if kind == "html":
        tables = webdata.html_tables(src.get("url", ""), fresh)
        i = int(src.get("table") or 1)
        if not 1 <= i <= len(tables):
            raise QueryError(f"the page has {len(tables)} tables")
        return blank(tables[i - 1])
    if kind == "sheet":
        wid = src.get("workbook")
        if not wid:
            raise QueryError("choose a workbook")
        b = books(wid)
        with b.lock:
            names = b.sheet_names()
            sheet, area = ranges.split_sheet(src.get("range") or "", names) if "!" in (src.get("range") or "") else (0, src.get("range") or "")
            if src.get("sheet"):
                sheet = names.index(src["sheet"]) if src["sheet"] in names else 0
            a = ranges.parse_area(area) if area else ranges.used_area(b.engine, sheet)
            if a is None:
                return blank([])
            data = ranges.grid(b.engine, sheet, a)
        return blank(data)
    if kind == "sqlite":
        return sqlite_table(src.get("path", ""), src.get("sql", ""), src.get("params"))
    from . import pqx

    if kind == "query":
        return pqx.ref_table(src, ctx or pqx.Ctx(books, fresh))
    t = pqx.source(kind, src)
    if t is None:
        raise QueryError("choose a source")
    return t


def sqlite_table(path: str, sql: str, params: dict | None = None) -> Table:
    from . import qparams

    p = Path(path).expanduser()
    if not p.is_file():
        raise QueryError(f"no database file at {path}")
    s, args = qparams.bind(qparams.one_statement(sql), params, "named")
    try:
        con = sqlite3.connect(f"file:{p.as_posix()}?mode=ro", uri=True)
        try:
            con.execute("PRAGMA query_only = ON")
            cur = con.execute(s, args or {})
            cols = [d[0] for d in cur.description or []]
            rows = [qparams.row(r) for r in cur.fetchmany(MAX_ROWS)]
        finally:
            con.close()
    except sqlite3.Error as e:
        raise QueryError(f"SQLite: {e}")
    return Table(cols or ["Column1"], rows)


def unique(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    for n in names:
        k = n or "Column"
        if k in seen:
            seen[k] += 1
            k = f"{k}.{seen[k]}"
        else:
            seen[k] = 0
        out.append(k)
    return out


def test(op: str, v, want) -> bool:
    if op == "blank":
        return v is None or txt(v) == ""
    if op == "notblank":
        return not (v is None or txt(v) == "")
    nv, nw = num(v), num(want)
    if op in ("contains", "begins", "ends", "notcontains"):
        a, b = txt(v).lower(), txt(want).lower()
        return {"contains": b in a, "begins": a.startswith(b), "ends": a.endswith(b), "notcontains": b not in a}[op]
    if nv is not None and nw is not None:
        a, b = nv, nw
    else:
        a, b = txt(v).lower(), txt(want).lower()
    return {"=": a == b, "<>": a != b, ">": a > b, "<": a < b, ">=": a >= b, "<=": a <= b}.get(op, False)


def convert(v, kind: str):
    if v is None or txt(v) == "":
        return None
    if kind == "number":
        n = num(v)
        if n is None:
            raise QueryError(f"{txt(v)} is not a number")
        return n
    if kind == "text":
        return txt(v)
    if kind == "logical":
        return txt(v).strip().lower() in ("true", "1", "yes")
    if kind == "date":
        s = txt(v).strip()
        for f in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d", "%b %d, %Y", "%d %b %Y"):
            try:
                return datetime.strptime(s, f).date().isoformat()
            except ValueError:
                continue
        raise QueryError(f"{s} is not a date")
    raise QueryError(f"unknown type {kind}")


def step(t: Table, s: dict, ctx=None) -> Table:
    op = s.get("op")
    if op == "promote_headers":
        if not t.rows:
            return t
        head = unique([txt(v) for v in t.rows[0]])
        rows = [list(r) for r in t.rows[1:]]
        for i in range(len(head)):
            col = [r[i] for r in rows if txt(r[i]) != ""]
            if col and all(num(v) is not None for v in col):
                for r in rows:
                    r[i] = num(r[i]) if txt(r[i]) != "" else None
        return Table(head, rows)
    if op == "demote_headers":
        return Table([f"Column{i + 1}" for i in range(len(t.cols))], [list(t.cols)] + t.rows)
    if op in ("remove_columns", "keep_columns"):
        want = {t.idx(c) for c in s.get("columns", [])}
        keep = [i for i in range(len(t.cols)) if (i in want) == (op == "keep_columns")]
        return Table([t.cols[i] for i in keep], [[r[i] for i in keep] for r in t.rows])
    if op == "rename":
        i = t.idx(s.get("from", ""))
        cols = list(t.cols)
        cols[i] = s.get("to", cols[i])
        return Table(cols, t.rows)
    if op == "filter":
        i = t.idx(s.get("column", ""))
        return Table(t.cols, [r for r in t.rows if test(s.get("cmp", "="), r[i], s.get("value", ""))])
    if op == "change_type":
        i = t.idx(s.get("column", ""))
        rows = []
        for r in t.rows:
            r = list(r)
            r[i] = convert(r[i], s.get("type", "text"))
            rows.append(r)
        return Table(t.cols, rows)
    if op == "sort":
        i = t.idx(s.get("column", ""))
        desc = bool(s.get("desc"))

        def key(r):
            v = r[i]
            n = num(v)
            return (v is None, 0, n, "") if n is not None else (v is None, 1, 0.0, txt(v).lower())

        filled = sorted([r for r in t.rows if r[i] is not None], key=key, reverse=desc)
        return Table(t.cols, filled + [r for r in t.rows if r[i] is None])
    if op == "remove_duplicates":
        seen, rows = set(), []
        for r in t.rows:
            k = tuple(txt(v) for v in r)
            if k not in seen:
                seen.add(k)
                rows.append(r)
        return Table(t.cols, rows)
    if op == "top":
        return Table(t.cols, t.rows[: max(0, int(s.get("n", 0)))])
    if op == "group":
        by = [t.idx(c) for c in s.get("by", [])]
        agg = s.get("agg", "count")
        ci = t.idx(s["column"]) if s.get("column") else None
        groups: dict[tuple, list] = {}
        for r in t.rows:
            groups.setdefault(tuple(txt(r[i]) for i in by), []).append(r)
        name = s.get("as") or (agg.capitalize() if ci is None else f"{agg.capitalize()} of {t.cols[ci]}")
        rows = []
        for k, grp in groups.items():
            first = grp[0]
            vals = [num(r[ci]) for r in grp if ci is not None and num(r[ci]) is not None] if ci is not None else []
            if agg == "count":
                v = float(len(grp))
            elif not vals:
                v = None
            else:
                v = {"sum": sum(vals), "average": sum(vals) / len(vals), "min": min(vals), "max": max(vals)}[agg]
            rows.append([first[i] for i in by] + [v])
        return Table([t.cols[i] for i in by] + [name], rows)
    from . import pqx

    return pqx.step(t, s, ctx or pqx.Ctx(None, False))


def run(q: dict, books, fresh: bool = False, library: dict | None = None) -> dict:
    from . import pqx, qparams

    q = qparams.apply(q)
    ctx = pqx.Ctx(books, fresh, library or {})
    t = source(q.get("source") or {}, books, fresh, ctx)
    for s in q.get("steps") or []:
        t = step(t, s, ctx)
    out = [list(t.cols)] + t.rows
    return {"columns": t.cols, "rows": [[raw(v) for v in r] for r in out]}


def raw(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(int(v)) if float(v).is_integer() and abs(v) < 1e15 else repr(float(v))
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    s = str(v)
    if s.startswith(("=", "'", "+", "-", "@")) or re.fullmatch(r"\s*[\d.,$%-]+\s*", s) or s.strip().upper() in ("TRUE", "FALSE"):
        return "'" + s
    return s
