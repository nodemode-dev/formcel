import json
import re
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from .pquery import QueryError

TOKEN = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_ ]*?)\s*\}\}")
READ_START = re.compile(r"(?is)^\s*(select|with|show|describe|desc|explain|values|table)\b")


def typed(p: dict):
    v = p.get("value")
    kind = p.get("type") or "text"
    if v is None or v == "":
        return None
    if kind == "number":
        try:
            f = float(str(v).replace(",", ""))
        except ValueError:
            raise QueryError(f"parameter {p.get('name')} is not a number: {v}")
        return int(f) if f.is_integer() else f
    if kind == "logical":
        return str(v).strip().lower() in ("true", "1", "yes")
    if kind == "date":
        s = str(v).strip()
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            raise QueryError(f"parameter {p.get('name')} is not a date (use YYYY-MM-DD): {v}")
    return str(v)


def values(query: dict) -> dict:
    out = {}
    for p in query.get("params") or []:
        name = str(p.get("name") or "").strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            raise QueryError(f"a parameter name must be letters, digits and underscores: {name}")
        out[name] = typed(p)
    return out


def text_of(v) -> str:
    if v is None:
        return ""
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    return str(v)


def substitute(node, vals: dict):
    if isinstance(node, str):
        return TOKEN.sub(lambda m: text_of(vals[m.group(1).strip()]) if m.group(1).strip() in vals else m.group(0), node)
    if isinstance(node, list):
        return [substitute(x, vals) for x in node]
    if isinstance(node, dict):
        return {k: (v if k == "sql" else substitute(v, vals)) for k, v in node.items()}
    return node


def apply(query: dict) -> dict:
    vals = values(query)
    if not vals:
        return query
    out = dict(query)
    out["source"] = substitute(query.get("source") or {}, vals)
    out["steps"] = substitute(query.get("steps") or [], vals)
    out["source"]["params"] = vals
    return out


def scan(sql: str):
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if ch in "'\"`":
            j = i + 1
            while j < n:
                if sql[j] == ch:
                    if j + 1 < n and sql[j + 1] == ch:
                        j += 2
                        continue
                    break
                if sql[j] == "\\" and ch == "'":
                    j += 1
                j += 1
            yield "quote", sql[i:j + 1]
            i = j + 1
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j < 0 else j
            yield "comment", sql[i:j]
            i = j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            j = n if j < 0 else j + 2
            yield "comment", sql[i:j]
            i = j
        else:
            j = i
            while j < n and sql[j] not in "'\"`" and not sql.startswith("--", j) and not sql.startswith("/*", j):
                j += 1
            yield "code", sql[i:j]
            i = j


def one_statement(sql: str) -> str:
    s = sql.strip()
    code = "".join(t for k, t in scan(s) if k == "code")
    code = code.rstrip().rstrip(";").rstrip()
    if ";" in code:
        raise QueryError("only one statement is run")
    trimmed = s.rstrip()
    while trimmed.endswith(";"):
        trimmed = trimmed[:-1].rstrip()
    if not READ_START.match("".join(t for k, t in scan(trimmed) if k != "comment")):
        raise QueryError("only a SELECT (or WITH, SHOW, DESCRIBE, EXPLAIN, VALUES) statement is run")
    return trimmed


def bind(sql: str, params: dict | None, style: str) -> tuple[str, dict | None]:
    params = params or {}
    used: dict = {}
    out = []
    for kind, text in scan(sql):
        if kind != "code":
            out.append(text.replace("%", "%%") if style == "pyformat" else text)
            continue
        def sub(m):
            name = m.group(1)
            if name not in params:
                return m.group(0)
            used[name] = params[name]
            return f"%({name})s" if style == "pyformat" else f":{name}"

        piece = re.sub(r"(?<![@\w])@([A-Za-z_][A-Za-z0-9_]*)", sub, text.replace("%", "%%") if style == "pyformat" else text)
        out.append(piece)
    text = "".join(out)
    if style == "pyformat" and not used:
        return text.replace("%%", "%"), None
    return text, used


def cell(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, Decimal):
        f = float(v)
        return int(f) if f.is_integer() and abs(f) < 1e15 else f
    if isinstance(v, datetime):
        return v.isoformat(sep="T", timespec="seconds") if v.microsecond == 0 else v.isoformat()
    if isinstance(v, (date, time)):
        return v.isoformat()
    if isinstance(v, timedelta):
        secs = int(v.total_seconds())
        sign = "-" if secs < 0 else ""
        secs = abs(secs)
        return f"{sign}{secs // 3600:02d}:{secs % 3600 // 60:02d}:{secs % 60:02d}"
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        b = bytes(v)
        try:
            return b.decode("utf-8")
        except UnicodeDecodeError:
            return "0x" + b.hex()
    if isinstance(v, (list, tuple, dict, set)):
        return json.dumps(list(v) if isinstance(v, (set, tuple)) else v, default=text_of, ensure_ascii=False)
    return str(v)


def row(r) -> list:
    return [cell(v) for v in r]
