import re
from xml.sax.saxutils import quoteattr

from openpyxl.utils import column_index_from_string, get_column_letter as L

from ..xlsx.autofilter import _parse, _serial
from ..xlsx.cf import esc

OPS_OUT = {"eq": "=", "ne": "!=", "gt": ">", "ge": ">=", "lt": "<", "le": "<=", "begins": "begins with", "notbegins": "!begins with",
           "ends": "ends with", "notends": "!ends with", "contains": "contains", "notcontains": "!contains"}
OPS_IN = {**{v: k for k, v in OPS_OUT.items()}, "does not contain": "notcontains", "does not begin with": "notbegins", "does not end with": "notends"}
SHEET_ADDR = re.compile(r"^\$?('(?:[^']|'')+'|[^.:']+)\.\$?([A-Za-z]+)\$?(\d+)(?::(?:'(?:[^']|'')+'|[^.:']*)\.\$?([A-Za-z]+)\$?(\d+))?$")
ELEMENTS = ("filter-and", "filter-or", "filter-condition")


def _quote(name: str) -> str:
    return "'" + name.replace("'", "''") + "'" if re.search(r"[^A-Za-z0-9_]", name) else name


def _cond(field: int, op: str, value: str) -> str:
    return f"<table:filter-condition table:field-number=\"{field}\" table:value={quoteattr(value)} table:operator={quoteattr(op)}/>"


def _group(field: int, conds: list[tuple[str, str]], joiner: str) -> str:
    items = [_cond(field, op, val) for op, val in conds]
    if len(items) == 1:
        return items[0]
    tag = "table:filter-and" if joiner == "and" else "table:filter-or"
    return f"<{tag}>{''.join(items)}</{tag}>"


def out(text: str, sheet: str) -> tuple[str, int, str]:
    area, cols, _ = _parse(text) if text.strip() else (None, [], [])
    if area is None:
        return "", 0, ""
    r0, c0, r1, c1 = area
    lost = 0
    groups: list[str] = []
    for col, p in cols:
        field = col - c0
        kind = p[0]
        if kind == "values":
            vals = list(p[2:]) + ([""] if p[1] == "1" else [])
            if vals:
                items = "".join(f"<table:filter-set-item table:value={quoteattr(v)}/>" for v in vals)
                groups.append(f"<table:filter-condition table:field-number=\"{field}\" table:value={quoteattr(vals[0])} table:operator=\"=\">{items}</table:filter-condition>")
        elif kind == "cond":
            conds = []
            for op, val in zip(p[2::2], p[3::2]):
                if op in OPS_OUT:
                    conds.append((OPS_OUT[op], _serial(val) if op in ("eq", "ne", "gt", "ge", "lt", "le") else val))
            if conds and p[1] == "and":
                groups.extend(_cond(field, op, val) for op, val in conds)
            elif conds:
                groups.append(_group(field, conds, "or"))
        elif kind == "top":
            n = p[2] if len(p) > 2 else "10"
            pct = len(p) > 3 and p[3] == "%"
            groups.append(_cond(field, f"{'bottom' if p[1] == 'bottom' else 'top'} {'percent' if pct else 'values'}", n))
        elif kind in ("fill", "font") and len(p) > 1 and re.fullmatch(r"[0-9a-fA-F]{6}", p[1]):
            groups.append(_cond(field, "bg-color" if kind == "fill" else "txt-color", "#" + p[1].lower()))
        else:
            lost += 1
    if not groups:
        body = ""
    elif len(groups) == 1:
        body = f"<table:filter>{groups[0]}</table:filter>"
    else:
        body = f"<table:filter><table:filter-and>{''.join(groups)}</table:filter-and></table:filter>"
    q = _quote(sheet)
    target = f"{q}.{L(c0 + 1)}{r0 + 1}:{q}.{L(c1 + 1)}{r1 + 1}"
    return body, lost, target


def database_ranges(items: list[tuple[int, str, str]]) -> tuple[str, int]:
    blocks, lost = [], 0
    for i, (n, sheet, text) in enumerate(items):
        body, dropped, target = out(text, sheet)
        if not target:
            continue
        lost += dropped
        blocks.append(f"<table:database-range table:name=\"__Anonymous_Sheet_DB__{n}\" table:target-range-address={quoteattr(target)} table:display-filter-buttons=\"true\" table:contains-header=\"true\">{body}</table:database-range>")
    return (f"<table:database-ranges>{''.join(blocks)}</table:database-ranges>" if blocks else ""), lost


def _address(addr: str) -> tuple[str, int, int, int, int] | None:
    m = SHEET_ADDR.match((addr or "").strip())
    if not m:
        return None
    name = m.group(1)
    name = name[1:-1].replace("''", "'") if name.startswith("'") else name
    a = (int(m.group(3)) - 1, column_index_from_string(m.group(2).upper()) - 1)
    b =(int(m.group(5)) - 1, column_index_from_string(m.group(4).upper()) - 1) if m.group(4) else a
    return name, a[0], a[1], b[0], b[1]


def _leaves(node, T: str) -> list:
    if node.tag == f"{T}filter-condition":
        return [node]
    found = []
    for ch in node:
        found.extend(_leaves(ch, T))
    return found


def _column(conds: list[tuple[str, str]], joiner: str, notes) -> list[str] | None:
    ops = [c[0] for c in conds]
    if all(o in ("=", "empty") for o in ops) and (joiner == "or" or len(conds) == 1):
        vals = [v for o, v in conds if o == "=" and v != ""]
        return ["values", "1" if "empty" in ops or any(o == "=" and v == "" for o, v in conds) else "0", *vals]
    if len(conds) == 1 and conds[0][0] in ("top values", "bottom values", "top percent", "bottom percent"):
        op, v = conds[0]
        return ["top", "bottom" if op.startswith("bottom") else "top", v, "%" if op.endswith("percent") else ""]
    if len(conds) == 1 and conds[0][0] in ("bg-color", "txt-color"):
        return ["fill" if conds[0][0] == "bg-color" else "font", conds[0][1].lstrip("#").lower()]
    out_parts: list[str] = []
    for op, v in conds:
        if op == "empty":
            out_parts.extend(["eq", ""])
        elif op == "!empty":
            out_parts.extend(["ne", ""])
        elif op in OPS_IN:
            out_parts.extend([OPS_IN[op], v])
        else:
            notes["filter conditions FormCel cannot read left out"] += 1
            return None
    if len(out_parts) > 4:
        notes["filter conditions beyond two per column left out"] += 1
        out_parts = out_parts[:4]
    return ["cond", joiner, *out_parts]


def attach(root, sheets: list[dict], names: dict[str, int], O: str, T: str, notes) -> None:
    for db in root.iter(f"{T}database-range"):
        addr = _address(db.get(f"{T}target-range-address") or "")
        if addr is None or addr[0] not in names:
            continue
        flt = db.find(f"{T}filter")
        if db.get(f"{T}display-filter-buttons") != "true" and flt is None:
            continue
        si = names[addr[0]]
        _, r0, c0, r1, c1 = addr
        lines = [f"area\t{r0},{c0},{r1},{c1}"]
        if flt is not None and len(flt):
            top = flt[0]
            joiner = "and" if top.tag.endswith("filter-and") else "or"
            by_field: dict[int, list[tuple[str, str]]] = {}
            join_for: dict[int, str] = {}
            for node in ([top] if top.tag.endswith("filter-condition") else list(top)):
                inner = "and" if node.tag.endswith("filter-and") else "or" if node.tag.endswith("filter-or") else joiner
                for leaf in _leaves(node, T):
                    f = int(leaf.get(f"{T}field-number", "0"))
                    op = (leaf.get(f"{T}operator") or "=").strip()
                    picked = [it.get(f"{T}value") or "" for it in leaf.findall(f"{T}filter-set-item")]
                    if op == "=" and picked:
                        by_field.setdefault(f, []).extend(("=", v) for v in picked)
                        join_for[f] = "or"
                        continue
                    by_field.setdefault(f, []).append((op, leaf.get(f"{T}value") or ""))
                    join_for.setdefault(f, inner)
            if joiner == "or" and len(by_field) > 1:
                notes["filters joined with OR across columns left out"] += 1
                by_field = {}
            for f, conds in sorted(by_field.items()):
                parts = _column(conds, join_for.get(f, joiner), notes)
                if parts:
                    lines.append(f"col\t{c0 + f}\t" + "\t".join(esc(x) for x in parts))
        view = sheets[si]["view"]
        rows = view.setdefault("rows", {})
        hidden = rows.get("hidden", [])
        if len(lines) > 1:
            mine = [r for r in hidden if r0 < r <= r1]
            rows["hidden"] = [r for r in hidden if not r0 < r <= r1]
            lines.append("hidden\t" + ",".join(str(r) for r in mine))
        if not sheets[si].get("filter"):
            sheets[si]["filter"] = "\n".join(lines) + "\n"
