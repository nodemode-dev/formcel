import re
from xml.sax.saxutils import escape, quoteattr

from openpyxl.utils import column_index_from_string, get_column_letter as L

from ..xlsx.cf import _unesc, esc
from ..xlsx.validation import _serial
from .formulas import from_file, to_file

NUMBER = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?")
CMP_OUT = {"eq": "=", "ne": "!=", "gt": ">", "ge": ">=", "lt": "<", "le": "<="}
CMP_IN = {v: k for k, v in CMP_OUT.items()}
TYPES_OUT = {"whole": "cell-content-is-whole-number()", "decimal": "cell-content-is-decimal-number()", "date": "cell-content-is-date()", "time": "cell-content-is-time()"}
TYPES_IN = {"cell-content-is-whole-number()": "whole", "cell-content-is-decimal-number()": "decimal", "cell-content-is-date()": "date", "cell-content-is-time()": "time"}
STYLES_IN = {"stop": "stop", "warning": "warning", "information": "info"}
STYLES_OUT = {v: k for k, v in STYLES_IN.items()}
MAX_CELLS = 200000


def _quote(name: str) -> str:
    return "'" + name.replace("'", "''") + "'" if re.search(r"[^A-Za-z0-9_]", name) else name


def _operand(kind: str, v: str) -> str:
    if v.startswith("="):
        return to_file(v)[4:]
    if kind in ("date", "time"):
        v = _serial(v)
    if NUMBER.fullmatch(v):
        return v
    return '"' + v.replace('"', '""') + '"'


def _condition(kind: str, op: str, a: str, b: str) -> str:
    if kind == "list":
        if a.startswith("="):
            return f"of:cell-content-is-in-list({to_file(a)[4:]})"
        items = [x.strip() for x in a.split(",") if x.strip()]
        return "of:cell-content-is-in-list(" + ";".join('"' + x.replace('"', '""') + '"' for x in items) + ")"
    if kind == "custom":
        return f"of:is-true-formula({to_file(a)[4:] if a.startswith('=') else a})"
    if kind == "any":
        return ""
    head = f"of:{TYPES_OUT[kind]} and " if kind in TYPES_OUT else "of:"
    stem = "cell-content-text-length" if kind == "length" else "cell-content"
    if op in ("between", "notbetween"):
        mid = "is-not-between" if op == "notbetween" else "is-between"
        return f"{head}{stem}-{mid}({_operand(kind, a)},{_operand(kind, b)})"
    return f"{head}{stem}(){CMP_OUT.get(op, '=')}{_operand(kind, a)}"


def out(lines_by_sheet: list[tuple[str, list[str]]]) -> tuple[str, dict[str, dict[tuple[int, int], str]], int]:
    blocks: list[str] = []
    cells: dict[str, dict[tuple[int, int], str]] = {}
    total = 0
    skipped = 0
    for sheet, lines in lines_by_sheet:
        here = cells.setdefault(sheet, {})
        q = _quote(sheet)
        for line in lines:
            p = [_unesc(x) for x in line.split("\t")]
            p += [""] * (11 - len(p))
            r0, c0, r1, c1 = (int(x) for x in p[0].split(","))
            kind, op, a, b, flags, style = p[1:7]
            if kind == "checkbox":
                continue
            name = f"val{len(blocks) + 1}"
            cond = _condition(kind, op, a, b)
            attrs = [f"table:name=\"{name}\""]
            if cond:
                attrs.append(f"table:condition={quoteattr(cond)}")
            attrs.append(f"table:allow-empty-cell=\"{'true' if 'b' in flags else 'false'}\"")
            attrs.append(f"table:base-cell-address={quoteattr(f'{q}.{L(c0 + 1)}{r0 + 1}')}")
            if kind == "list":
                attrs.append(f"table:display-list=\"{'none' if 'd' in flags else 'unsorted'}\"")
            body = ""
            if p[7] or p[8] or "p" in flags:
                paras = "".join(f"<text:p>{escape(t)}</text:p>" for t in p[8].split("\n")) if p[8] else ""
                body += f"<table:help-message table:title={quoteattr(p[7])} table:display=\"{'true' if 'p' in flags else 'false'}\">{paras}</table:help-message>"
            paras = "".join(f"<text:p>{escape(t)}</text:p>" for t in p[10].split("\n")) if p[10] else ""
            body += f"<table:error-message table:message-type=\"{STYLES_OUT.get(style, 'stop')}\" table:title={quoteattr(p[9])} table:display=\"{'true' if 'e' in flags else 'false'}\">{paras}</table:error-message>"
            blocks.append(f"<table:content-validation {' '.join(attrs)}>{body}</table:content-validation>")
            for r in range(r0, r1 + 1):
                for c in range(c0, c1 + 1):
                    if total >= MAX_CELLS:
                        skipped += 1
                        continue
                    here[(r, c)] = name
                    total += 1
    xml = f"<table:content-validations>{''.join(blocks)}</table:content-validations>" if blocks else ""
    return xml, cells, skipped


def _split(s: str, sep: str = ",;") -> list[str]:
    parts, depth, cur, q = [], 0, "", False
    for ch in s:
        if ch == '"':
            q = not q
        if not q and ch in "([{":
            depth += 1
        elif not q and ch in ")]}":
            depth -= 1
        if ch in sep and depth == 0 and not q:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts


def _operand_in(arg: str) -> str:
    f = from_file("of:=" + arg.strip())[1:]
    if NUMBER.fullmatch(f):
        return f
    if len(f) >= 2 and f[0] == '"' and f[-1] == '"' and '"' not in f[1:-1].replace('""', ""):
        return f[1:-1].replace('""', '"')
    return "=" + f


def _parse(cond: str) -> tuple[str, str, str, str] | None:
    text = re.sub(r"(?<![A-Za-z0-9_])of:", "", cond.strip())
    parts = [x.strip() for x in re.split(r"\s+and\s+(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)", text)]
    kind, op, a, b = "any", "between", "", ""
    for part in parts:
        if part in TYPES_IN:
            kind = TYPES_IN[part]
            continue
        m = re.fullmatch(r"cell-content-is-in-list\((.*)\)", part, re.S)
        if m:
            args = _split(m.group(1))
            conv = [_operand_in(x) for x in args]
            if len(conv) == 1 and conv[0].startswith("="):
                return "list", "", conv[0], ""
            return "list", "", ",".join(x[1:] if x.startswith("=") else x for x in conv), ""
        m = re.fullmatch(r"is-true-formula\((.*)\)", part, re.S)
        if m:
            return "custom", "", "=" + from_file("of:=" + m.group(1))[1:], ""
        m = re.fullmatch(r"cell-content-text-length-is-(not-)?between\((.*)\)", part, re.S)
        if m:
            args = _split(m.group(2))
            return "length", "notbetween" if m.group(1) else "between", _operand_in(args[0]), _operand_in(args[1]) if len(args) > 1 else ""
        m = re.fullmatch(r"cell-content-is-(not-)?between\((.*)\)", part, re.S)
        if m:
            args = _split(m.group(2))
            op, a, b = "notbetween" if m.group(1) else "between", _operand_in(args[0]), _operand_in(args[1]) if len(args) > 1 else ""
            if kind == "any":
                kind = "decimal"
            continue
        m = re.fullmatch(r"(cell-content-text-length|cell-content)\(\)(!=|>=|<=|=|>|<)(.*)", part, re.S)
        if m:
            op, a = CMP_IN[m.group(2)], _operand_in(m.group(3))
            kind = "length" if m.group(1).endswith("length") else ("decimal" if kind == "any" else kind)
            continue
        return None
    if kind == "any":
        return None
    return kind, op, a, b


def _text(el, X: str) -> str:
    return "\n".join("".join(p.itertext()) for p in el.findall(f"{X}p"))


def _definitions(root, T: str, X: str, notes) -> dict[str, list[str]]:
    defs: dict[str, list[str]] = {}
    for v in root.iter(f"{T}content-validation"):
        name = v.get(f"{T}name")
        cond = v.get(f"{T}condition") or ""
        parsed = _parse(cond) if cond else ("any", "between", "", "")
        if parsed is None:
            notes["data validation rules FormCel cannot read left out"] += 1
            continue
        kind, op, a, b = parsed
        help_, err = v.find(f"{T}help-message"), v.find(f"{T}error-message")
        flags = ("b" if v.get(f"{T}allow-empty-cell") != "false" else "")
        if kind == "list" and v.get(f"{T}display-list") == "none":
            flags += "d"
        if help_ is not None and help_.get(f"{T}display") == "true":
            flags += "p"
        if err is not None and err.get(f"{T}display") == "true":
            flags += "e"
        style = STYLES_IN.get(err.get(f"{T}message-type") or "stop", "stop") if err is not None else "stop"
        rest = [kind, op, a, b, flags, style, help_.get(f"{T}title") or "" if help_ is not None else "", _text(help_, X) if help_ is not None else "",
                err.get(f"{T}title") or "" if err is not None else "", _text(err, X) if err is not None else ""]
        defs[name] = ["\t".join(esc(x) for x in rest)]
    return defs


def _rows(el, T: str):
    for ch in el:
        if ch.tag == f"{T}table-row":
            yield ch
        elif ch.tag in (f"{T}table-header-rows", f"{T}table-rows", f"{T}table-row-group"):
            yield from _rows(ch, T)


def lines_in(root, tables: list, T: str, X: str, notes) -> list[list[str]]:
    defs = _definitions(root, T, X, notes)
    result: list[list[str]] = []
    for tb in tables:
        runs: dict[tuple[str, int, int], list[list[int]]] = {}
        r = 0
        for row in _rows(tb, T):
            rep = int(row.get(f"{T}number-rows-repeated", "1"))
            c = 0
            for cell in row:
                if cell.tag not in (f"{T}table-cell", f"{T}covered-table-cell"):
                    continue
                crep = int(cell.get(f"{T}number-columns-repeated", "1"))
                name = cell.get(f"{T}content-validation-name")
                if name in defs and c < 16384 and r < 1048576:
                    key = (name, c, min(c + crep, 16384) - 1)
                    open_runs = runs.setdefault(key, [])
                    if open_runs and open_runs[-1][1] == r - 1:
                        open_runs[-1][1] = r + rep - 1
                    else:
                        open_runs.append([r, r + rep - 1])
                c += crep
            r += rep
            if r >= 1048576:
                break
        boxes = sorted((name, r0, r1, c0, c1) for (name, c0, c1), spans in runs.items() for r0, r1 in spans)
        joined: list[list] = []
        for name, r0, r1, c0, c1 in boxes:
            if joined and joined[-1][0] == name and joined[-1][1] == r0 and joined[-1][2] == r1 and joined[-1][4] + 1 == c0:
                joined[-1][4] = c1
            else:
                joined.append([name, r0, r1, c0, c1])
        result.append([f"{r0},{c0},{r1},{c1}\t{defs[name][0]}" for name, r0, r1, c0, c1 in sorted(joined, key=lambda j: (j[1], j[3]))])
    return result
