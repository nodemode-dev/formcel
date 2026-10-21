import ast
import csv
import io
import math
import operator
import re
from datetime import date, datetime
from pathlib import Path

from . import pquery

MAX_ROWS = pquery.MAX_ROWS
Table = pquery.Table
QueryError = pquery.QueryError
num = pquery.num
txt = pquery.txt


class Ctx:
    def __init__(self, books, fresh: bool, library: dict | None = None, depth: int = 0):
        self.books = books
        self.fresh = fresh
        self.library = library or {}
        self.depth = depth


def single_select(sql: str) -> str:
    s = sql.strip().rstrip(";").strip()
    if not re.match(r"(?is)^(select|with)\b", s) or ";" in s:
        raise QueryError("only one SELECT statement is run")
    return s


def postgres_table(src: dict) -> Table:
    try:
        import psycopg
    except ImportError:
        raise QueryError("PostgreSQL needs the psycopg package: pip install \"psycopg[binary]\"")
    sql = single_select(src.get("sql", ""))
    try:
        with psycopg.connect(host=src.get("host") or "localhost", port=int(src.get("port") or 5432), user=src.get("user") or None, password=src.get("password") or None, dbname=src.get("database") or None, connect_timeout=10, options="-c statement_timeout=30000 -c default_transaction_read_only=on") as con:
            con.read_only = True
            cur = con.execute(sql)
            cols = [d.name for d in cur.description or []]
            rows = [list(r) for r in cur.fetchmany(MAX_ROWS)]
    except psycopg.Error as e:
        raise QueryError(f"PostgreSQL: {str(e).strip().splitlines()[0] if str(e).strip() else 'error'}")
    return Table(cols or ["Column1"], rows)


def mysql_table(src: dict) -> Table:
    try:
        import pymysql
    except ImportError:
        raise QueryError("MySQL needs the PyMySQL package: pip install pymysql")
    sql = single_select(src.get("sql", ""))
    try:
        con = pymysql.connect(host=src.get("host") or "localhost", port=int(src.get("port") or 3306), user=src.get("user") or "", password=src.get("password") or "", database=src.get("database") or None, connect_timeout=10, read_timeout=30)
        try:
            with con.cursor() as cur:
                cur.execute("SET SESSION TRANSACTION READ ONLY")
                cur.execute(sql)
                cols = [d[0] for d in cur.description or []]
                rows = [list(r) for r in cur.fetchmany(MAX_ROWS)]
        finally:
            con.close()
    except pymysql.MySQLError as e:
        raise QueryError(f"MySQL: {e}")
    return Table(cols or ["Column1"], rows)


def drivers() -> dict:
    out = {"sqlite": True}
    for key, mod in (("postgres", "psycopg"), ("mysql", "pymysql")):
        try:
            __import__(mod)
            out[key] = True
        except ImportError:
            out[key] = False
    return out


def schema(src: dict) -> list[dict]:
    kind = src.get("kind", "")
    if kind == "sqlite":
        sql = "SELECT m.name AS t, p.name AS c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid"
        t = pquery.sqlite_table(src.get("path", ""), sql)
    elif kind == "postgres":
        t = postgres_table({**src, "sql": "SELECT table_schema || '.' || table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1, ordinal_position"})
    elif kind == "mysql":
        t = mysql_table({**src, "sql": "SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position"})
    else:
        raise QueryError("choose a database")
    tables: dict[str, list[str]] = {}
    for r in t.rows:
        tables.setdefault(str(r[0]), []).append(str(r[1]))
    return [{"name": k, "columns": v} for k, v in tables.items()]


def cell_value(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def xlsx_table(path: Path, sheet: str, area: str) -> Table:
    ext = path.suffix.lower()
    if ext == ".xls":
        try:
            import xlrd
        except ImportError:
            raise QueryError("reading .xls needs the xlrd package")
        try:
            wb = xlrd.open_workbook(str(path))
            ws = wb.sheet_by_name(sheet) if sheet else wb.sheet_by_index(0)
        except Exception as e:
            raise QueryError(f"{path.name}: {e}")
        rows = [[(None if c.ctype in (0, 6) else c.value) for c in ws.row(r)] for r in range(min(ws.nrows, MAX_ROWS))]
    else:
        try:
            import openpyxl
        except ImportError:
            raise QueryError("reading .xlsx needs the openpyxl package")
        try:
            wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
        except Exception as e:
            raise QueryError(f"{path.name}: {e}")
        try:
            if sheet and sheet not in wb.sheetnames:
                raise QueryError(f"{path.name} has no sheet {sheet}. Sheets: {', '.join(wb.sheetnames)}")
            ws = wb[sheet] if sheet else wb[wb.sheetnames[0]]
            rows = []
            for r in ws.iter_rows(values_only=True):
                rows.append([cell_value(v) for v in r])
                if len(rows) >= MAX_ROWS:
                    break
        finally:
            wb.close()
    if area:
        from . import ranges

        r0, c0, r1, c1 = ranges.parse_area(area)
        rows = [r[c0:c1 + 1] + [None] * max(0, c1 + 1 - len(r)) for r in rows[r0:r1 + 1]]
    while rows and all(v is None or v == "" for v in rows[-1]):
        rows.pop()
    return pquery.blank(rows)


def fcel_table(path: Path, sheet: str, area: str) -> Table:
    import json
    import zipfile

    try:
        with zipfile.ZipFile(path) as z:
            doc = json.loads(z.read("workbook.json"))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as e:
        raise QueryError(f"{path.name}: {e}")
    sheets = doc.get("sheets") or []
    pick = next((s for s in sheets if s.get("name") == sheet), None) if sheet else (sheets[0] if sheets else None)
    if pick is None:
        raise QueryError(f"{path.name} has no sheet {sheet}")
    cells = {(c[0], c[1]): c[2] for c in pick.get("cells", [])}
    if not cells:
        return pquery.blank([])
    from . import ranges

    if area:
        r0, c0, r1, c1 = ranges.parse_area(area)
    else:
        r0, c0 = min(k[0] for k in cells), min(k[1] for k in cells)
        r1, c1 = max(k[0] for k in cells), max(k[1] for k in cells)
    return pquery.blank([[cells.get((r, c)) for c in range(c0, c1 + 1)] for r in range(r0, r1 + 1)])


def file_table(path_text: str, sheet: str = "", area: str = "") -> Table:
    p = Path(path_text).expanduser()
    if not p.is_file():
        raise QueryError(f"no file at {path_text}")
    ext = p.suffix.lower()
    if ext in (".xlsx", ".xlsm", ".xls"):
        return xlsx_table(p, sheet, area)
    if ext == ".fcel":
        return fcel_table(p, sheet, area)
    if ext in (".csv", ".tsv", ".txt"):
        text = p.read_text("utf-8-sig", errors="replace")
        from . import webdata

        return pquery.blank(webdata.split_csv(text, "\t" if ext == ".tsv" else None))
    raise QueryError(f"{p.name}: only .xlsx, .xlsm, .xls, .fcel, .csv and .tsv files are read")


def folder_table(src: dict) -> Table:
    root = Path(src.get("path", "")).expanduser()
    if not root.is_dir():
        raise QueryError(f"no folder at {src.get('path', '')}")
    pattern = src.get("pattern") or "*"
    files = sorted(p for p in root.rglob(pattern) if p.is_file() and p.suffix.lower() in (".xlsx", ".xlsm", ".xls", ".fcel", ".csv", ".tsv")) if src.get("subfolders") else sorted(p for p in root.glob(pattern) if p.is_file() and p.suffix.lower() in (".xlsx", ".xlsm", ".xls", ".fcel", ".csv", ".tsv"))
    if not files:
        raise QueryError("the folder has no spreadsheet or CSV files that match")
    if src.get("list"):
        return Table(["Name", "Folder", "Extension", "Size", "Modified"], [[f.name, str(f.parent), f.suffix, f.stat().st_size, datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="seconds")] for f in files])
    combined: Table | None = None
    for f in files[:200]:
        t = file_table(str(f), src.get("sheet", ""), "")
        if t.rows and src.get("headers", True):
            head = pquery.unique([txt(v) for v in t.rows[0]])
            t = Table(head, t.rows[1:])
        t = Table(t.cols + ["Source.Name"], [r + [f.name] for r in t.rows])
        combined = t if combined is None else append(combined, t)
        if len(combined.rows) >= MAX_ROWS:
            break
    return combined or pquery.blank([])


def source(kind: str, src: dict) -> Table | None:
    if kind == "excel":
        return file_table(src.get("path", ""), src.get("sheet", ""), src.get("range", ""))
    if kind == "folder":
        return folder_table(src)
    if kind == "postgres":
        return postgres_table(src)
    if kind == "mysql":
        return mysql_table(src)
    return None


def append(a: Table, b: Table) -> Table:
    cols = list(a.cols) + [c for c in b.cols if c not in a.cols]
    rows = [[r[a.cols.index(c)] if c in a.cols else None for c in cols] for r in a.rows]
    rows += [[r[b.cols.index(c)] if c in b.cols else None for c in cols] for r in b.rows]
    return Table(cols, rows)


def other_table(s: dict, ctx: Ctx) -> Table:
    if ctx.depth > 4:
        raise QueryError("queries refer to each other too deeply")
    ref = s.get("query")
    if ref:
        q = ctx.library.get(ref) or next((v for v in ctx.library.values() if v.get("name") == ref), None)
        if q is None:
            raise QueryError(f"there is no saved query {ref}")
    else:
        q = s.get("other") or {}
    t = pquery.source(q.get("source") or {}, ctx.books, ctx.fresh)
    inner = Ctx(ctx.books, ctx.fresh, ctx.library, ctx.depth + 1)
    for st in q.get("steps") or []:
        t = pquery.step(t, st, inner)
    return t


def key_of(r: list, idx: list[int]) -> tuple:
    return tuple(txt(r[i]).strip().lower() for i in idx)


def merge(t: Table, s: dict, ctx: Ctx) -> Table:
    o = other_table(s, ctx)
    left = [t.idx(c) for c in s.get("left") or [s.get("column", "")]]
    right = [o.idx(c) for c in s.get("right") or s.get("left") or [s.get("column", "")]]
    if len(left) != len(right):
        raise QueryError("merge needs the same number of key columns on both sides")
    kind = s.get("join", "left")
    take = [i for i in range(len(o.cols)) if i not in right] if s.get("expand", True) else []
    names = [c if c not in t.cols else f"{c}.1" for c in (o.cols[i] for i in take)]
    index: dict[tuple, list[list]] = {}
    for r in o.rows:
        index.setdefault(key_of(r, right), []).append(r)
    rows, used = [], set()
    for r in t.rows:
        k = key_of(r, left)
        hits = index.get(k) or []
        if hits:
            used.add(k)
            for h in hits:
                rows.append(list(r) + [h[i] for i in take])
        elif kind in ("left", "full"):
            rows.append(list(r) + [None] * len(take))
        elif kind == "leftanti":
            rows.append(list(r) + [None] * len(take))
    if kind == "inner":
        rows = [r for r in rows if any(v is not None for v in r[len(t.cols):]) or not take]
    if kind == "leftanti":
        rows = [list(r) + [None] * len(take) for r in t.rows if key_of(r, left) not in index]
    if kind in ("right", "full"):
        for r in o.rows:
            k = key_of(r, right)
            if k not in used:
                base = [None] * len(t.cols)
                for li, ri in zip(left, right):
                    base[li] = r[ri]
                rows.append(base + [r[i] for i in take])
    return Table(list(t.cols) + names, rows)


SPLIT_ERR = "split needs a delimiter or a number of characters"


def split_column(t: Table, s: dict) -> Table:
    i = t.idx(s.get("column", ""))
    mode = s.get("mode") or ("length" if s.get("length") else "delimiter")
    parts = []
    for r in t.rows:
        v = txt(r[i])
        if mode == "length":
            n = int(s.get("length") or 0)
            if n < 1:
                raise QueryError(SPLIT_ERR)
            parts.append([v[k:k + n] for k in range(0, len(v), n)] or [""])
        else:
            d = s.get("delimiter")
            if not d:
                raise QueryError(SPLIT_ERR)
            d = d.replace("\\t", "\t").replace("\\n", "\n")
            parts.append(v.split(d, int(s["max"]) - 1) if s.get("max") else v.split(d))
    w = max((len(p) for p in parts), default=1)
    names = pquery.unique(t.cols[:i] + [f"{t.cols[i]}.{k + 1}" for k in range(w)] + t.cols[i + 1:])
    rows = []
    for r, p in zip(t.rows, parts):
        cells = [(x if x != "" else None) for x in p] + [None] * (w - len(p))
        rows.append(list(r[:i]) + cells + list(r[i + 1:]))
    return Table(names, rows)


def merge_columns(t: Table, s: dict) -> Table:
    cols = [t.idx(c) for c in s.get("columns", [])]
    if len(cols) < 2:
        raise QueryError("merge columns needs at least two columns")
    sep = (s.get("separator") or "").replace("\\t", "\t")
    name = s.get("as") or "Merged"
    keep = [k for k in range(len(t.cols)) if k not in cols]
    rows = [[r[k] for k in keep] + [sep.join(txt(r[k]) for k in cols)] for r in t.rows]
    return Table([t.cols[k] for k in keep] + [name], rows)


def fill(t: Table, s: dict, down: bool) -> Table:
    targets = [t.idx(c) for c in s.get("columns", [])] or list(range(len(t.cols)))
    rows = [list(r) for r in t.rows]
    order = range(len(rows)) if down else range(len(rows) - 1, -1, -1)
    for i in targets:
        last = None
        for k in order:
            v = rows[k][i]
            if v is None or txt(v) == "":
                rows[k][i] = last
            else:
                last = v
    return Table(t.cols, rows)


def replace_values(t: Table, s: dict) -> Table:
    targets = [t.idx(c) for c in s.get("columns", [])] if s.get("columns") else ([t.idx(s["column"])] if s.get("column") else list(range(len(t.cols))))
    find, repl = s.get("find", ""), s.get("with", "")
    whole = bool(s.get("whole"))
    rows = [list(r) for r in t.rows]
    for r in rows:
        for i in targets:
            v = r[i]
            if v is None and find == "":
                r[i] = repl
            elif v is None:
                continue
            elif whole:
                if txt(v) == find or (num(v) is not None and num(find) is not None and num(v) == num(find)):
                    r[i] = repl if repl != "" else None
            elif find != "" and find in txt(v):
                r[i] = txt(v).replace(find, repl)
    return Table(t.cols, rows)


def transform_text(t: Table, s: dict) -> Table:
    targets = [t.idx(c) for c in s.get("columns", [])] if s.get("columns") else ([t.idx(s["column"])] if s.get("column") else list(range(len(t.cols))))
    how = s.get("how", "trim")
    fns = {
        "trim": lambda x: re.sub(r"\s+", " ", x).strip(),
        "clean": lambda x: "".join(ch for ch in x if ch.isprintable()),
        "upper": str.upper,
        "lower": str.lower,
        "proper": str.title,
    }
    if how not in fns:
        raise QueryError(f"unknown text transform {how}")
    rows = [list(r) for r in t.rows]
    for r in rows:
        for i in targets:
            if isinstance(r[i], str):
                r[i] = fns[how](r[i])
    return Table(t.cols, rows)


def unpivot(t: Table, s: dict) -> Table:
    if s.get("keep"):
        keep = [t.idx(c) for c in s.get("keep", [])]
        cols = [i for i in range(len(t.cols)) if i not in keep]
    else:
        cols = [t.idx(c) for c in s.get("columns", [])]
        keep = [i for i in range(len(t.cols)) if i not in cols]
    if not cols:
        raise QueryError("unpivot needs the columns to turn into rows")
    an, vn = s.get("attribute") or "Attribute", s.get("value") or "Value"
    rows = [[r[k] for k in keep] + [t.cols[c], r[c]] for r in t.rows for c in cols]
    return Table([t.cols[k] for k in keep] + [an, vn], rows)


def pivot(t: Table, s: dict) -> Table:
    pc = t.idx(s.get("column", ""))
    vc = t.idx(s.get("values", ""))
    agg = s.get("agg", "sum")
    keep = [i for i in range(len(t.cols)) if i not in (pc, vc)]
    heads: list[str] = []
    groups: dict[tuple, dict[str, list]] = {}
    for r in t.rows:
        h = txt(r[pc])
        if h not in heads:
            heads.append(h)
        groups.setdefault(tuple(txt(r[i]) for i in keep), {}).setdefault(h, []).append(r)
    rows = []
    for k, per in groups.items():
        first = next(iter(per.values()))[0]
        out = [first[i] for i in keep]
        for h in heads:
            hit = per.get(h)
            if not hit:
                out.append(None)
                continue
            vals = [num(r[vc]) for r in hit if num(r[vc]) is not None]
            if agg == "count":
                out.append(float(len(hit)))
            elif agg == "first":
                out.append(hit[0][vc])
            elif not vals:
                out.append(None)
            else:
                out.append({"sum": sum(vals), "average": sum(vals) / len(vals), "min": min(vals), "max": max(vals)}.get(agg, sum(vals)))
        rows.append(out)
    return Table([t.cols[i] for i in keep] + pquery.unique(heads), rows)


def transpose(t: Table) -> Table:
    full = [list(t.cols)] + t.rows
    return pquery.blank([list(c) for c in zip(*full)] if full else [])


def reorder(t: Table, s: dict) -> Table:
    order = [t.idx(c) for c in s.get("columns", [])]
    rest = [i for i in range(len(t.cols)) if i not in order]
    idx = order + rest
    return Table([t.cols[i] for i in idx], [[r[i] for i in idx] for r in t.rows])


def index_column(t: Table, s: dict) -> Table:
    start = int(s.get("start") if s.get("start") not in (None, "") else 0)
    return Table(t.cols + [s.get("as") or "Index"], [r + [float(start + k)] for k, r in enumerate(t.rows)])


def skip(t: Table, s: dict) -> Table:
    n = max(0, int(s.get("n", 0)))
    return Table(t.cols, t.rows[n:])


def remove_blank_rows(t: Table) -> Table:
    return Table(t.cols, [r for r in t.rows if any(v is not None and txt(v) != "" for v in r)])


def remove_errors(t: Table, s: dict) -> Table:
    return Table(t.cols, [r for r in t.rows if not any(isinstance(v, str) and v.startswith("#") and v.rstrip("!?/0AL").upper() in ("#", "#DIV", "#N", "#NAME", "#REF", "#VALUE", "#NUM") for v in r)])


def date_part(t: Table, s: dict) -> Table:
    i = t.idx(s.get("column", ""))
    part = s.get("part", "year")
    out = []
    for r in t.rows:
        v = r[i]
        d = None
        if isinstance(v, (date, datetime)):
            d = v
        elif v is not None and txt(v):
            try:
                d = datetime.fromisoformat(txt(v)[:19])
            except ValueError:
                d = None
        if d is None:
            out.append(r + [None])
            continue
        val = {"year": d.year, "month": d.month, "day": d.day, "weekday": d.isoweekday(), "quarter": (d.month - 1) // 3 + 1, "monthname": d.strftime("%B")}.get(part)
        out.append(r + [float(val) if isinstance(val, int) else val])
    return Table(t.cols + [s.get("as") or f"{t.cols[i]} {part}"], out)


BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Mod: operator.mod, ast.Pow: operator.pow, ast.FloorDiv: operator.floordiv}
CMPS = {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge}


def m_translate(src: str) -> str:
    s = src.strip()
    s = re.sub(r"^each\s+", "", s)
    out, i, n = [], 0, len(s)
    while i < n:
        ch = s[i]
        if ch == '"':
            j = i + 1
            buf = ['"']
            while j < n:
                if s[j] == '"' and j + 1 < n and s[j + 1] == '"':
                    buf.append('\\"')
                    j += 2
                    continue
                if s[j] == '"':
                    break
                buf.append("\\\\" if s[j] == "\\" else s[j])
                j += 1
            buf.append('"')
            out.append("".join(buf))
            i = j + 1
        elif ch == "[":
            j = s.find("]", i)
            if j < 0:
                raise QueryError("a column name is missing its closing bracket")
            out.append(f"_c({s[i + 1:j]!r})")
            i = j + 1
        elif ch == "<" and s[i:i + 2] == "<>":
            out.append("!=")
            i += 2
        elif ch == "=" and s[i - 1:i] not in ("<", ">", "!", "=") and s[i + 1:i + 2] != "=":
            out.append("==")
            i += 1
        elif ch.isalpha() or ch == "_":
            j = i
            while j < n and (s[j].isalnum() or s[j] in "._"):
                j += 1
            out.append(s[i:j])
            i = j
        else:
            out.append(ch)
            i += 1
    text = "".join(out)
    text = re.sub(r"\bif\b(.+?)\bthen\b(.+?)\belse\b(.+)$", lambda m: f"(({m.group(2)}) if ({m.group(1)}) else ({m.group(3)}))", text, flags=re.S)
    text = re.sub(r"\band\b", " and ", text)
    text = re.sub(r"\bor\b", " or ", text)
    text = re.sub(r"\bnot\b", " not ", text)
    text = re.sub(r"\btrue\b", "True", text)
    text = re.sub(r"\bfalse\b", "False", text)
    text = re.sub(r"\bnull\b", "None", text)
    return text


M_FUNCS = {
    "Text.Upper": lambda x: txt(x).upper(),
    "Text.Lower": lambda x: txt(x).lower(),
    "Text.Proper": lambda x: txt(x).title(),
    "Text.Trim": lambda x: txt(x).strip(),
    "Text.Length": lambda x: float(len(txt(x))),
    "Text.Start": lambda x, n: txt(x)[: int(n)],
    "Text.End": lambda x, n: txt(x)[-int(n):] if int(n) else "",
    "Text.Middle": lambda x, a, n=None: txt(x)[int(a):] if n is None else txt(x)[int(a):int(a) + int(n)],
    "Text.Replace": lambda x, a, b: txt(x).replace(txt(a), txt(b)),
    "Text.Contains": lambda x, a: txt(a).lower() in txt(x).lower(),
    "Text.StartsWith": lambda x, a: txt(x).lower().startswith(txt(a).lower()),
    "Text.EndsWith": lambda x, a: txt(x).lower().endswith(txt(a).lower()),
    "Text.From": lambda x: txt(x),
    "Text.PadStart": lambda x, n, c=" ": txt(x).rjust(int(n), txt(c) or " "),
    "Text.Combine": lambda *a: "".join(txt(v) for v in a),
    "Number.From": lambda x: num(x),
    "Number.Round": lambda x, d=0: round(num(x), int(d)) if num(x) is not None else None,
    "Number.Abs": lambda x: abs(num(x)) if num(x) is not None else None,
    "Number.Sqrt": lambda x: math.sqrt(num(x)) if num(x) is not None and num(x) >= 0 else None,
    "Number.Power": lambda x, y: num(x) ** num(y) if num(x) is not None and num(y) is not None else None,
    "Number.Mod": lambda x, y: num(x) % num(y) if num(x) is not None and num(y) else None,
    "Number.IntegerDivide": lambda x, y: float(num(x) // num(y)) if num(x) is not None and num(y) else None,
    "Number.RoundUp": lambda x: float(math.ceil(num(x))) if num(x) is not None else None,
    "Number.RoundDown": lambda x: float(math.floor(num(x))) if num(x) is not None else None,
    "Date.Year": lambda x: float(datetime.fromisoformat(txt(x)[:19]).year),
    "Date.Month": lambda x: float(datetime.fromisoformat(txt(x)[:19]).month),
    "Date.Day": lambda x: float(datetime.fromisoformat(txt(x)[:19]).day),
    "List.Max": lambda *a: max(n for n in (num(v) for v in a) if n is not None),
    "List.Min": lambda *a: min(n for n in (num(v) for v in a) if n is not None),
    "List.Sum": lambda *a: sum(n for n in (num(v) for v in a) if n is not None),
    "List.Average": lambda *a: (lambda xs: sum(xs) / len(xs) if xs else None)([n for n in (num(v) for v in a) if n is not None]),
}


def m_eval(node, row: dict):
    if isinstance(node, ast.Expression):
        return m_eval(node.body, row)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.BinOp):
        l, r = m_eval(node.left, row), m_eval(node.right, row)
        if isinstance(node.op, ast.BitAnd):
            return txt(l) + txt(r)
        a, b = num(l), num(r)
        if a is None or b is None:
            return None
        try:
            return float(BIN[type(node.op)](a, b))
        except (ZeroDivisionError, OverflowError, ValueError):
            return None
    if isinstance(node, ast.UnaryOp):
        v = m_eval(node.operand, row)
        if isinstance(node.op, ast.Not):
            return not v
        n = num(v)
        return None if n is None else (-n if isinstance(node.op, ast.USub) else n)
    if isinstance(node, ast.BoolOp):
        vals = [m_eval(v, row) for v in node.values]
        return all(vals) if isinstance(node.op, ast.And) else any(vals)
    if isinstance(node, ast.Compare):
        left = m_eval(node.left, row)
        for op, c in zip(node.ops, node.comparators):
            right = m_eval(c, row)
            a, b = (num(left), num(right)) if num(left) is not None and num(right) is not None else (txt(left).lower(), txt(right).lower())
            if not CMPS[type(op)](a, b):
                return False
            left = right
        return True
    if isinstance(node, ast.IfExp):
        return m_eval(node.body, row) if m_eval(node.test, row) else m_eval(node.orelse, row)
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id == "_c":
            name = node.args[0].value
            if name not in row:
                low = {k.lower(): k for k in row}
                if str(name).lower() not in low:
                    raise QueryError(f"there is no column {name}")
                name = low[str(name).lower()]
            return row[name]
        fname = dotted(node.func)
        fn = M_FUNCS.get(fname)
        if fn is None:
            raise QueryError(f"{fname} is not available in a custom column")
        try:
            return fn(*[m_eval(a, row) for a in node.args])
        except (TypeError, ValueError):
            return None
    raise QueryError("that expression is not supported in a custom column")


def dotted(node) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return dotted(node.value) + "." + node.attr
    raise QueryError("that expression is not supported in a custom column")


def parse_expr(expr: str):
    py = m_translate(expr)
    try:
        tree = ast.parse(py.strip(), mode="eval")
    except SyntaxError:
        raise QueryError(f"the expression could not be read: {expr}")
    for n in ast.walk(tree):
        if isinstance(n, (ast.Lambda, ast.ListComp, ast.GeneratorExp, ast.Subscript, ast.Starred, ast.Await, ast.JoinedStr)):
            raise QueryError("that expression is not supported in a custom column")
    return tree


def add_column(t: Table, s: dict) -> Table:
    expr = s.get("expression", "")
    if not expr.strip():
        raise QueryError("write an expression for the new column, such as [Price] * [Qty]")
    tree = parse_expr(expr)
    rows = []
    for r in t.rows:
        row = dict(zip(t.cols, r))
        v = m_eval(tree, row)
        rows.append(list(r) + [v])
    return Table(t.cols + [s.get("as") or "Custom"], rows)


def step(t: Table, s: dict, ctx: Ctx) -> Table:
    op = s.get("op")
    if op == "split_column":
        return split_column(t, s)
    if op == "merge_columns":
        return merge_columns(t, s)
    if op == "fill_down":
        return fill(t, s, True)
    if op == "fill_up":
        return fill(t, s, False)
    if op == "replace_values":
        return replace_values(t, s)
    if op == "text_transform":
        return transform_text(t, s)
    if op == "unpivot":
        return unpivot(t, s)
    if op == "pivot":
        return pivot(t, s)
    if op == "transpose":
        return transpose(t)
    if op == "reorder":
        return reorder(t, s)
    if op == "add_index":
        return index_column(t, s)
    if op == "skip":
        return skip(t, s)
    if op == "remove_blank_rows":
        return remove_blank_rows(t)
    if op == "remove_errors":
        return remove_errors(t, s)
    if op == "date_part":
        return date_part(t, s)
    if op == "add_column":
        return add_column(t, s)
    if op == "append":
        return append(t, other_table(s, ctx))
    if op == "merge":
        return merge(t, s, ctx)
    raise QueryError(f"unknown step {op}")


def csv_text(rows: list[list]) -> str:
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    return buf.getvalue()
