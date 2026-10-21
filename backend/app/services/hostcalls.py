import re

from . import aiclient, ranges, webdata

NUM = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def cell(v) -> str:
    if v is None or v == "":
        return "z:"
    if isinstance(v, bool):
        return f"b:{int(v)}"
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


def importrange(args: list, books) -> list[list]:
    need(args, 2)
    wid, ref = text_arg(args[0]), text_arg(args[1])
    return ranges.range_values(books, wid, ref)


def resolve(key: str, books, fresh: bool = False) -> tuple[str, str]:
    name, args = split_key(key)
    try:
        if name == "WEBSERVICE":
            need(args, 1)
            body, ctype = webdata.fetch(text_arg(args[0]), fresh)
            return "t:" + esc(webdata.decode(body, ctype)[:32767]), ""
        if name == "IMPORTDATA":
            need(args, 1, 2)
            delim = text_arg(args[1]) if len(args) > 1 and args[1] != "" else None
            return encode(webdata.import_data(text_arg(args[0]), delim, fresh)), ""
        if name == "IMPORTHTML":
            need(args, 3)
            return encode(webdata.import_html(text_arg(args[0]), text_arg(args[1]), int(args[2]), fresh)), ""
        if name == "IMPORTXML":
            need(args, 2)
            return encode(webdata.import_xml(text_arg(args[0]), text_arg(args[1]), fresh)), ""
        if name == "FILTERXML":
            need(args, 2)
            return encode(webdata.filter_xml(text_arg(args[0]), text_arg(args[1]))), ""
        if name == "IMPORTRANGE":
            return encode(importrange(args, books)), ""
        if name == "AI":
            need(args, 1, 1)
            return aiclient.cell_answer(text_arg(args[0]), text_arg(args[1]) if len(args) > 1 else ""), ""
    except aiclient.NotConfigured as e:
        return error("#N/A"), str(e)
    except (webdata.FetchError, ValueError, KeyError, IndexError, TypeError) as e:
        code = "#VALUE!" if name in ("WEBSERVICE", "FILTERXML") else "#N/A"
        return error(code), f"{name}: {e}"
    return error("#NAME?"), f"{name} is not a connected function"
