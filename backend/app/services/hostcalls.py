import re

from . import aiclient, offline_ai, ranges, webdata
from .quotes import model as quote_model

ERRORS = {"#VALUE!", "#N/A", "#DIV/0!", "#NUM!", "#NULL!", "#NAME?", "#REF!"}
NUM = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def cell(v) -> str:
    if v is None or v == "":
        return "z:"
    if isinstance(v, bool):
        return f"b:{int(v)}"
    if isinstance(v, quote_model.XDate):
        return f"d:{float(v)}"
    if isinstance(v, quote_model.XMoment):
        return f"m:{float(v)}"
    if isinstance(v, (int, float)):
        return f"n:{v}"
    s = str(v)
    t = s.strip().replace(",", "") if re.fullmatch(r"[+-]?[\d,]*\.?\d+(e[+-]?\d+)?", s.strip().replace(",", ""), re.I) else ""
    if t and NUM.match(t):
        return f"n:{t}"
    return "t:" + esc(s)


def encode(rows: list[list]) -> str:
    if not rows:
        return "e:#N/A"
    return "\n".join("\t".join(cell(v) for v in r) for r in rows)


def error(code: str = "#N/A") -> str:
    return f"e:{code}"


def parse_arg(tok: str):
    kind, _, body = tok.partition(":")
    if kind == "n":
        return float(body)
    if kind == "b":
        return body == "1"
    if kind == "z":
        return ""
    if kind == "e":
        return None
    if kind == "a":
        return None
    return body


def split_key(key: str) -> tuple[str, list]:
    name, *rest = key.split("\x1f")
    args: list = []
    for a in rest:
        if a.startswith("a:"):
            head, *items = a.split("\x1e")
            _, r, c = head.split(":")
            r, c = int(r), int(c)
            vals = [parse_arg(i) for i in items]
            args.append([vals[i * c:(i + 1) * c] for i in range(r)])
        else:
            args.append(parse_arg(a))
    return name, args


def text_arg(v) -> str:
    if isinstance(v, list):
        return "\n".join("\t".join("" if x is None else str(x) for x in row) for row in v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return "" if v is None else str(v)


def need(args: list, n: int, opt: int = 0) -> None:
    if not n <= len(args) <= n + opt:
        raise ValueError("wrong number of arguments")


def looks_like_path(s: str) -> bool:
    t = s.strip()
    return bool(re.search(r"[\\/]", t)) or t.lower().endswith((".fcel", ".xlsx", ".xlsm", ".xls", ".csv", ".ods"))


def external(book: str, ref: str, books) -> list[list]:
    from . import pqx

    b = book.strip()
    if b.startswith("[") and b.endswith("]"):
        b = b[1:-1]
    b = b.strip("'")
    sheet, _, area = ref.rpartition("!")
    sheet = sheet.strip().strip("'").replace("''", "'")
    from pathlib import Path

    p = Path(b).expanduser()
    if not p.is_file():
        from .store import store

        cands = [store().dir / b, store().dir / f"{b}.fcel"]
        p = next((c for c in cands if c.is_file()), p)
    if p.is_file() and p.suffix.lower() == ".fcel":
        from .store import store

        if p.parent.resolve() == store().dir.resolve():
            try:
                return ranges.range_values(books, p.stem, f"{sheet}!{area}" if sheet else area)
            except (KeyError, FileNotFoundError):
                pass
    if not p.is_file():
        from .store import store

        for w in store().listing():
            if w["title"].lower() == b.lower() or w["id"] == b:
                return ranges.range_values(books, w["id"], f"{sheet}!{area}" if sheet else area)
        raise ValueError(f"the workbook {b} was not found")
    t = pqx.file_table(str(p), sheet, area)
    return t.rows


def importrange(args: list, books) -> list[list]:
    need(args, 2)
    wid, ref = text_arg(args[0]), text_arg(args[1])
    if looks_like_path(wid):
        return external(wid, ref, books)
    try:
        return ranges.range_values(books, wid, ref)
    except (KeyError, FileNotFoundError):
        from . import extbooks
        from .store import store

        found = extbooks.find(store(), wid)
        if found is None:
            raise ValueError(f"the workbook {wid} was not found")
        return ranges.range_values(books, found, ref)


_prepared: dict[str, tuple] = {}


def prepare(b) -> None:
    from . import jsfn

    names = tuple(sorted({"PY", *jsfn.functions(b.auto or {}).keys()}))
    if _prepared.get(b.id) != names:
        with b.lock:
            b.engine.host_custom(list(names))
        _prepared[b.id] = names


def py_order(b, keys: list[str]) -> list[str]:
    where: list[tuple[int, int, int, str]] = []
    with b.lock:
        for i in range(len(b.sheet_names())):
            for item in b.engine.cells(i):
                f = item[2]
                if isinstance(f, str) and f.startswith("=") and "PY(" in f.upper():
                    where.append((i, item[0], item[1], f))
    where.sort()

    def rank(k: str) -> tuple[int, int, int]:
        name, args = split_key(k)
        if name != "PY" or not args:
            return (-1, 0, 0)
        code = text_arg(args[0]).replace('"', '""')
        for s, r, c, f in where:
            if code in f:
                return (s, r, c)
        return (10**6, 0, 0)

    return sorted(keys, key=rank)


_py_memo: dict[tuple, tuple[list[tuple[str, str]], str]] = {}


def python_cell(args: list, books=None, wid: str = ""):
    from . import pysand, pyxl

    if not args:
        raise ValueError("PY needs code as its first argument")
    if not pysand.enabled():
        return error("#N/A"), "Python cells are off. Turn them on under Data, Python cells."
    code = text_arg(args[0])
    data = [list(a) if isinstance(a, list) else a for a in args[1:]]
    memo_key = (wid, code, repr(data))

    def read(ref: str) -> dict:
        if books is None or not wid:
            raise ValueError("xl() needs the workbook this cell is in")
        return pyxl.read(books(wid), ref)

    earlier: list[str] = []
    if wid and books is not None:
        from . import pyorder

        try:
            earlier = pyorder.before(books(wid), code)
        except Exception:
            earlier = []
    hit = _py_memo.get(memo_key) if not earlier else None
    if hit is not None and wid:
        try:
            if all(pyxl.digest(read(r)["rows"]) == d for r, d in hit[0]):
                return hit[1], ""
        except Exception:
            pass
    seen: list[tuple[str, str]] = []

    def tracked(ref: str) -> dict:
        got = read(ref)
        seen.append((ref, pyxl.digest(got["rows"])))
        return got

    try:
        out = encode(norm(pysand.run(code, data, tracked, before=earlier)["value"]))
    except pysand.PyError as e:
        return error("#VALUE!"), f"PY: {e}"
    if len(_py_memo) > 400:
        _py_memo.clear()
    _py_memo[memo_key] = (seen, out)
    return out, ""


def norm(v):
    if isinstance(v, list):
        return v
    return [[v]]


def resolve(key: str, books, fresh: bool = False, auto: dict | None = None, wid: str = "") -> tuple[str, str]:
    name, args = split_key(key)
    try:
        if name == "PY":
            r = python_cell(args, books, wid)
            return r if isinstance(r, tuple) else (r, "")
        if name in ("EXTERNALREF", "EXTREF"):
            need(args, 2)
            return encode(external(text_arg(args[0]), text_arg(args[1]), books)), ""
        if auto is not None:
            from . import jsfn

            fn = jsfn.functions(auto).get(name.upper())
            if fn is not None:
                try:
                    return encode(norm(jsfn.call(fn[1], fn[0], args, name.upper() in jsfn.streaming(auto)))), ""
                except jsfn.JsUnavailable as e:
                    return error("#NAME?"), str(e)
                except jsfn.JsError as e:
                    return error(e.code if e.code in ERRORS else "#VALUE!"), f"{name}: {e}"
        if name in ("GOOGLEFINANCE", "STOCKHISTORY"):
            from .quotes import service as quote_service

            rows = quote_service.googlefinance(args, fresh) if name == "GOOGLEFINANCE" else quote_service.stockhistory(args, fresh)
            return encode(rows), ""
        if name == "WEBSERVICE":
            need(args, 1)
            url = text_arg(args[0])
            if len(url) > 2048:
                raise ValueError("the address is over 2048 characters")
            body, ctype = webdata.fetch(url, fresh)
            text = webdata.decode(body, ctype)
            if len(text) > 32767:
                raise ValueError("the response is over 32767 characters")
            return "t:" + esc(text), ""
        if name == "IMPORTDATA":
            need(args, 1, 2)
            delim = text_arg(args[1]) if len(args) > 1 and args[1] != "" else None
            return encode(webdata.import_data(text_arg(args[0]), delim, fresh)), ""
        if name == "IMPORTHTML":
            need(args, 3, 1)
            return encode(webdata.import_html(text_arg(args[0]), text_arg(args[1]), int(args[2]), fresh)), ""
        if name == "IMPORTFEED":
            need(args, 1, 3)
            query = text_arg(args[1]) if len(args) > 1 and args[1] != "" else "items"
            heads = len(args) > 2 and args[2] not in ("", False, 0.0)
            count = int(args[3]) if len(args) > 3 and args[3] != "" else None
            return encode(webdata.import_feed(text_arg(args[0]), query, heads, count, fresh)), ""
        if name == "IMPORTXML":
            need(args, 2)
            return encode(webdata.import_xml(text_arg(args[0]), text_arg(args[1]), fresh)), ""
        if name == "FILTERXML":
            need(args, 2)
            return encode(webdata.filter_xml(text_arg(args[0]), text_arg(args[1]))), ""
        if name == "IMPORTRANGE":
            return encode(importrange(args, books)), ""
        if name == "XREF":
            from . import extbooks

            return extbooks.resolve(args, books), ""
        if name == "AI":
            need(args, 1, 7)
            try:
                return aiclient.cell_answer(text_arg(args[0]), [text_arg(a) for a in args[1:] if a != ""]), ""
            except aiclient.NotConfigured:
                local = offline_ai.cell_answer(text_arg(args[0]), [text_arg(a) for a in args[1:] if a != ""])
                if local is None:
                    raise
                return "t:" + esc(local), ""
    except aiclient.NotConfigured as e:
        return error("#ERROR!"), str(e)
    except quote_model.QuoteError as e:
        return error(e.code), f"{name}: {e}"
    except (webdata.FetchError, ValueError, KeyError, IndexError, TypeError, OSError) as e:
        code = "#VALUE!" if name in ("WEBSERVICE", "FILTERXML") else "#N/A"
        return error(code), f"{name}: {e}"
    return error("#NAME?"), f"{name} is not a connected function"
