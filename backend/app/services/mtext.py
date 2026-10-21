import json
import re

from .pquery import QueryError

SOURCE_FN = {
    "csv": "Csv.Document",
    "text": "Csv.Pasted",
    "json": "Json.Document",
    "html": "Web.Page",
    "sheet": "Excel.CurrentWorkbook",
    "excel": "Excel.Workbook",
    "folder": "Folder.Files",
    "sqlite": "Sqlite.Database",
    "postgres": "PostgreSQL.Database",
    "mysql": "MySQL.Database",
}
FN_SOURCE = {v: k for k, v in SOURCE_FN.items()}

TYPE_M = {"number": "type number", "text": "type text", "date": "type date", "logical": "type logical"}
M_TYPE = {v: k for k, v in TYPE_M.items()}
AGG_M = {"sum": "List.Sum", "average": "List.Average", "min": "List.Min", "max": "List.Max", "count": "List.Count", "first": "List.First"}
M_AGG = {v: k for k, v in AGG_M.items()}
JOIN_M = {"left": "JoinKind.LeftOuter", "inner": "JoinKind.Inner", "right": "JoinKind.RightOuter", "full": "JoinKind.FullOuter", "leftanti": "JoinKind.LeftAnti"}
M_JOIN = {v: k for k, v in JOIN_M.items()}
TEXT_M = {"trim": "Text.Trim", "clean": "Text.Clean", "upper": "Text.Upper", "lower": "Text.Lower", "proper": "Text.Proper"}
M_TEXT = {v: k for k, v in TEXT_M.items()}
PART_M = {"year": "Date.Year", "month": "Date.Month", "day": "Date.Day", "weekday": "Date.DayOfWeek", "quarter": "Date.QuarterOfYear", "monthname": "Date.MonthName"}
M_PART = {v: k for k, v in PART_M.items()}
NUMBER = re.compile(r"-?\d+(\.\d+)?$")

NAMES = {
    "promote_headers": "Promoted Headers", "demote_headers": "Demoted Headers", "remove_columns": "Removed Columns", "keep_columns": "Kept Columns",
    "rename": "Renamed Columns", "filter": "Filtered Rows", "change_type": "Changed Type", "sort": "Sorted Rows", "group": "Grouped Rows",
    "remove_duplicates": "Removed Duplicates", "top": "Kept First Rows", "skip": "Removed Top Rows", "split_column": "Split Column",
    "merge_columns": "Merged Columns", "fill_down": "Filled Down", "fill_up": "Filled Up", "replace_values": "Replaced Value",
    "text_transform": "Transformed Text", "unpivot": "Unpivoted Columns", "pivot": "Pivoted Column", "add_column": "Added Custom",
    "date_part": "Added Date Part", "add_index": "Added Index", "reorder": "Reordered Columns", "transpose": "Transposed Table",
    "remove_blank_rows": "Removed Blank Rows", "remove_errors": "Removed Errors", "append": "Appended Query", "merge": "Merged Queries",
}


def q(s) -> str:
    return '"' + str(s).replace('"', '""') + '"'


def num_text(v) -> str:
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def lst(xs) -> str:
    return "{" + ", ".join(q(x) for x in xs) + "}"


def value_text(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return num_text(v)
    if isinstance(v, (list, dict)):
        return q(json.dumps(v, separators=(",", ":")))
    return q(v)


def literal(v) -> str:
    s = str(v)
    return s if NUMBER.match(s) else q(s)


def ident(name: str) -> str:
    return name if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", name) else '#"' + name.replace('"', '""') + '"'


def columns_of(s: dict, key: str = "columns") -> list[str]:
    v = s.get(key)
    if isinstance(v, str):
        return [x.strip() for x in v.split(",") if x.strip()]
    return list(v or [])


def has(s: dict, key: str) -> bool:
    return s.get(key) not in (None, "")


def ref_name(s: dict, library: dict) -> str:
    ref = s.get("query")
    if ref:
        q0 = library.get(ref)
        return ident((q0 or {}).get("name") or str(ref))
    return "FormCel.Inline(" + q(json.dumps(s.get("other") or {}, separators=(",", ":"))) + ")"


def step_call(s: dict, prev: str, library: dict) -> str:
    op = s.get("op")
    p = prev
    if op == "promote_headers":
        return f"Table.PromoteHeaders({p})"
    if op == "demote_headers":
        return f"Table.DemoteHeaders({p})"
    if op == "remove_columns":
        return f"Table.RemoveColumns({p}, {lst(columns_of(s))})"
    if op == "keep_columns":
        return f"Table.SelectColumns({p}, {lst(columns_of(s))})"
    if op == "rename":
        return f"Table.RenameColumns({p}, {{{{{q(s.get('from', ''))}, {q(s.get('to', ''))}}}}})"
    if op == "filter":
        col, cmp, val = s.get("column", ""), s.get("cmp", "="), s.get("value", "")
        c = f"[{col}]"
        if cmp == "blank":
            body = f"{c} = null"
        elif cmp == "notblank":
            body = f"{c} <> null"
        elif cmp in ("contains", "begins", "ends"):
            body = f"Text.{ {'contains': 'Contains', 'begins': 'StartsWith', 'ends': 'EndsWith'}[cmp] }({c}, {q(val)})"
        elif cmp == "notcontains":
            body = f"not Text.Contains({c}, {q(val)})"
        else:
            body = f"{c} {cmp} {literal(val)}"
        return f"Table.SelectRows({p}, each {body})"
    if op == "change_type":
        return f"Table.TransformColumnTypes({p}, {{{{{q(s.get('column', ''))}, {TYPE_M.get(s.get('type', 'text'), 'type text')}}}}})"
    if op == "sort":
        return f"Table.Sort({p}, {{{{{q(s.get('column', ''))}, {'Order.Descending' if s.get('desc') else 'Order.Ascending'}}}}})"
    if op == "group":
        agg = s.get("agg", "count")
        col = s.get("column", "")
        name = s.get("as") or (agg.capitalize() if not col else f"{agg.capitalize()} of {col}")
        if agg == "count":
            fn = "each Table.RowCount(_)"
        else:
            fn = f"each {AGG_M[agg]}([{col}])"
        return f"Table.Group({p}, {lst(columns_of(s, 'by'))}, {{{{{q(name)}, {fn}, type number}}}})"
    if op == "remove_duplicates":
        return f"Table.Distinct({p})"
    if op == "top":
        return f"Table.FirstN({p}, {num_text(s.get('n', 0))})"
    if op == "skip":
        return f"Table.Skip({p}, {num_text(s.get('n', 0))})"
    if op == "split_column":
        if has(s, "length") and not has(s, "delimiter"):
            sp = f"Splitter.SplitTextByRepeatedLengths({num_text(s['length'])})"
        else:
            sp = f"Splitter.SplitTextByDelimiter({q(s.get('delimiter', ''))}" + (f", {num_text(s['max'])})" if has(s, "max") else ")")
        return f"Table.SplitColumn({p}, {q(s.get('column', ''))}, {sp})"
    if op == "merge_columns":
        return f"Table.CombineColumns({p}, {lst(columns_of(s))}, Combiner.CombineTextByDelimiter({q(s.get('separator', ''))}), {q(s.get('as') or 'Merged')})"
    if op in ("fill_down", "fill_up"):
        return f"Table.{'FillDown' if op == 'fill_down' else 'FillUp'}({p}, {lst(columns_of(s))})"
    if op == "replace_values":
        cols = columns_of(s) or ([s["column"]] if has(s, "column") else [])
        return f"Table.ReplaceValue({p}, {q(s.get('find', ''))}, {q(s.get('with', ''))}, {'Replacer.ReplaceValue' if s.get('whole') else 'Replacer.ReplaceText'}, {lst(cols)})"
    if op == "text_transform":
        cols = columns_of(s) or ([s["column"]] if has(s, "column") else [])
        return f"Table.TransformColumns({p}, {lst(cols)}, {TEXT_M.get(s.get('how', 'trim'), 'Text.Trim')})"
    if op == "unpivot":
        if has(s, "keep"):
            return f"Table.UnpivotOtherColumns({p}, {lst(columns_of(s, 'keep'))}, {q(s.get('attribute') or 'Attribute')}, {q(s.get('value') or 'Value')})"
        return f"Table.Unpivot({p}, {lst(columns_of(s))}, {q(s.get('attribute') or 'Attribute')}, {q(s.get('value') or 'Value')})"
    if op == "pivot":
        return f"Table.Pivot({p}, {q(s.get('column', ''))}, {q(s.get('values', ''))}, {AGG_M.get(s.get('agg', 'sum'), 'List.Sum')})"
    if op == "add_column":
        return f"Table.AddColumn({p}, {q(s.get('as') or 'Custom')}, each {str(s.get('expression', '')).strip()})"
    if op == "date_part":
        return f"Table.AddDatePart({p}, {q(s.get('column', ''))}, {PART_M.get(s.get('part', 'year'), 'Date.Year')}, {q(s.get('as') or '')})"
    if op == "add_index":
        return f"Table.AddIndexColumn({p}, {q(s.get('as') or 'Index')}, {num_text(s.get('start') if has(s, 'start') else 0)}, 1)"
    if op == "reorder":
        return f"Table.ReorderColumns({p}, {lst(columns_of(s))})"
    if op == "transpose":
        return f"Table.Transpose({p})"
    if op == "remove_blank_rows":
        return f"Table.RemoveBlankRows({p})"
    if op == "remove_errors":
        return f"Table.RemoveRowsWithErrors({p})"
    if op == "append":
        return f"Table.Combine({{{p}, {ref_name(s, library)}}})"
    if op == "merge":
        left = columns_of(s, "left") or ([s["column"]] if has(s, "column") else [])
        right = columns_of(s, "right") or left
        return f"Table.Join({p}, {lst(left)}, {ref_name(s, library)}, {lst(right)}, {JOIN_M.get(s.get('join', 'left'), 'JoinKind.LeftOuter')})"
    rec = ", ".join(f"{ident(k)} = {value_text(v)}" for k, v in s.items())
    return f"FormCel.Step({p}, [{rec}])"


def source_call(src: dict, library: dict) -> str:
    kind = src.get("kind", "")
    if kind == "query":
        ref = src.get("query")
        return ident((library.get(ref) or {}).get("name") or str(ref or ""))
    fn = SOURCE_FN.get(kind)
    if fn is None:
        raise QueryError("choose a source")
    rec = ", ".join(f"{ident(k)} = {value_text(v)}" for k, v in src.items() if k != "kind" and v not in (None, ""))
    return f"{fn}([{rec}])"


def to_text(query: dict, library: dict | None = None) -> str:
    library = library or {}
    lines = [f"    Source = {source_call(query.get('source') or {}, library)}"]
    used = {"Source"}
    prev = "Source"
    for s in query.get("steps") or []:
        base = NAMES.get(s.get("op"), "Step")
        name, k = base, 1
        while name in used:
            k += 1
            name = f"{base}{k}"
        used.add(name)
        lines.append(f"    {ident(name)} = {step_call(s, prev, library)}")
        prev = ident(name)
    return "let\n" + ",\n".join(lines) + f"\nin\n    {prev}\n"


class Tok:
    def __init__(self, kind: str, val: str, a: int, b: int):
        self.kind, self.val, self.a, self.b = kind, val, a, b


def tokenize(src: str) -> list[Tok]:
    out: list[Tok] = []
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch.isspace():
            i += 1
        elif src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2)
            if j < 0:
                raise QueryError("a comment is not closed")
            i = j + 2
        elif ch == '"' or src.startswith('#"', i):
            kind = "id" if ch == "#" else "str"
            j = i + (2 if ch == "#" else 1)
            buf = []
            while j < n:
                if src[j] == '"':
                    if j + 1 < n and src[j + 1] == '"':
                        buf.append('"')
                        j += 2
                        continue
                    break
                buf.append(src[j])
                j += 1
            else:
                raise QueryError(f"line {src.count(chr(10), 0, i) + 1}: a text value is missing its closing quote")
            out.append(Tok(kind, "".join(buf), i, j + 1))
            i = j + 1
        elif ch.isdigit():
            j = i
            while j < n and (src[j].isdigit() or src[j] == "."):
                j += 1
            if j < n and src[j] in "eE" and j + 1 < n and (src[j + 1].isdigit() or src[j + 1] in "+-"):
                j += 2
                while j < n and src[j].isdigit():
                    j += 1
            out.append(Tok("num", src[i:j], i, j))
            i = j
        elif ch.isalpha() or ch == "_":
            j = i
            while j < n and (src[j].isalnum() or src[j] in "._"):
                j += 1
            out.append(Tok("id", src[i:j], i, j))
            i = j
        elif src.startswith("<>", i) or src.startswith(">=", i) or src.startswith("<=", i):
            out.append(Tok("p", src[i:i + 2], i, i + 2))
            i += 2
        elif ch in "(){}[],=<>-&+*/":
            out.append(Tok("p", ch, i, i + 1))
            i += 1
        else:
            raise QueryError(f"line {src.count(chr(10), 0, i) + 1}: unexpected character {ch}")
    return out


class Parser:
    def __init__(self, src: str):
        self.src = src
        self.t = tokenize(src)
        self.i = 0

    def line(self) -> int:
        pos = self.t[self.i].a if self.i < len(self.t) else len(self.src)
        return self.src.count("\n", 0, pos) + 1

    def fail(self, msg: str):
        raise QueryError(f"line {self.line()}: {msg}")

    def peek(self) -> Tok | None:
        return self.t[self.i] if self.i < len(self.t) else None

    def eat(self, kind: str, val: str | None = None) -> Tok:
        t = self.peek()
        if t is None or t.kind != kind or (val is not None and t.val != val):
            self.fail(f"expected {val or kind}" + (f" but found {t.val}" if t else " but the text ended"))
        self.i += 1
        return t

    def is_p(self, val: str) -> bool:
        t = self.peek()
        return t is not None and t.kind == "p" and t.val == val

    def value(self):
        t = self.peek()
        if t is None:
            self.fail("a value is missing")
        if t.kind == "str":
            self.i += 1
            return ("s", t.val)
        if t.kind == "num":
            self.i += 1
            return ("n", t.val)
        if t.kind == "p" and t.val == "-":
            self.i += 1
            n = self.eat("num")
            return ("n", "-" + n.val)
        if t.kind == "p" and t.val == "{":
            self.i += 1
            items = []
            while not self.is_p("}"):
                items.append(self.value())
                if self.is_p(","):
                    self.i += 1
                elif not self.is_p("}"):
                    self.fail("expected a comma or a closing brace")
            self.i += 1
            return ("l", items)
        if t.kind == "p" and t.val == "[":
            self.i += 1
            rec = []
            while not self.is_p("]"):
                k = self.peek()
                if k is None or k.kind not in ("id", "str"):
                    self.fail("a record field name is missing")
                self.i += 1
                self.eat("p", "=")
                rec.append((k.val, self.value()))
                if self.is_p(","):
                    self.i += 1
                elif not self.is_p("]"):
                    self.fail("expected a comma or a closing bracket")
            self.i += 1
            return ("r", rec)
        if t.kind == "id":
            if t.val == "each":
                self.i += 1
                return ("e", self.raw_until())
            if t.val == "type":
                self.i += 1
                n = self.eat("id")
                return ("t", "type " + n.val)
            if t.val in ("true", "false"):
                self.i += 1
                return ("b", t.val == "true")
            if t.val == "null":
                self.i += 1
                return ("z", None)
            self.i += 1
            if self.is_p("("):
                self.i += 1
                args = []
                while not self.is_p(")"):
                    args.append(self.value())
                    if self.is_p(","):
                        self.i += 1
                    elif not self.is_p(")"):
                        self.fail("expected a comma or a closing parenthesis")
                self.i += 1
                return ("c", t.val, args)
            return ("i", t.val)
        self.fail(f"unexpected {t.val}")

    def raw_until(self) -> str:
        start = self.peek().a if self.peek() else len(self.src)
        depth = 0
        end = start
        while self.i < len(self.t):
            t = self.t[self.i]
            if t.kind == "p" and t.val in "([{":
                depth += 1
            elif t.kind == "p" and t.val in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif t.kind == "p" and t.val == "," and depth == 0:
                break
            end = t.b
            self.i += 1
        text = self.src[start:end].strip()
        if not text:
            self.fail("write an expression after each")
        return text

    def program(self) -> tuple[list[tuple[str, tuple, int]], str]:
        self.eat("id", "let")
        steps = []
        while True:
            line = self.line()
            k = self.peek()
            if k is None or k.kind not in ("id", "str"):
                self.fail("a step name is missing")
            self.i += 1
            self.eat("p", "=")
            steps.append((k.val, self.value(), line))
            if self.is_p(","):
                self.i += 1
                continue
            break
        self.eat("id", "in")
        last = self.eat("id").val
        if self.peek() is not None:
            self.fail("nothing may follow the final step name")
        return steps, last


def as_str(n, what: str) -> str:
    if n[0] == "s":
        return n[1]
    raise QueryError(f"{what} must be a text value in quotes")


def as_strs(n, what: str) -> list[str]:
    if n[0] == "l" and all(x[0] == "s" for x in n[1]):
        return [x[1] for x in n[1]]
    raise QueryError(f"{what} must be a list of text values, such as {{\"A\", \"B\"}}")


def as_numtext(n, what: str) -> str:
    if n[0] == "n":
        return n[1]
    raise QueryError(f"{what} must be a number")


def raw_value(n):
    k = n[0]
    if k in ("s", "n"):
        return n[1]
    if k == "b":
        return n[1]
    if k == "z":
        return None
    return None


def num_field(text: str):
    f = float(text)
    return int(f) if f.is_integer() else f


def record_dict(n, what: str) -> dict:
    if n[0] != "r":
        raise QueryError(f"{what} needs a record in square brackets")
    out = {}
    for k, v in n[1]:
        if v[0] == "s":
            out[k] = v[1]
        elif v[0] == "n":
            out[k] = num_field(v[1])
        elif v[0] == "b":
            out[k] = v[1]
        elif v[0] == "z":
            out[k] = None
        else:
            raise QueryError(f"the field {k} must be text, a number or true or false")
    return out


def by_name(name: str, library: dict) -> str:
    for k, v in library.items():
        if v.get("name") == name:
            return k
    for k, v in library.items():
        if str(v.get("name", "")).lower() == name.lower():
            return k
    if name in library:
        return name
    raise QueryError(f"there is no saved query named {name}")


def other_ref(n, library: dict) -> dict:
    if n[0] == "i":
        return {"query": by_name(n[1], library)}
    if n[0] == "c" and n[1] == "FormCel.Inline" and len(n[2]) == 1 and n[2][0][0] == "s":
        try:
            return {"other": json.loads(n[2][0][1])}
        except ValueError:
            raise QueryError("the inline query is not valid")
    raise QueryError("name a saved query here")


FILTER_CMP = re.compile(r"^\[(.+?)\]\s*(=|<>|>=|<=|>|<)\s*(.+)$", re.S)
FILTER_TEXT = re.compile(r"^(not\s+)?Text\.(Contains|StartsWith|EndsWith)\(\s*\[(.+?)\]\s*,\s*(\".*\")\s*\)$", re.S)
GROUP_EACH = re.compile(r"^(?:List\.(Sum|Average|Min|Max)\(\s*\[(.+?)\]\s*\)|Table\.RowCount\(\s*_\s*\))$", re.S)


def unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1].replace('""', '"')
    raise QueryError(f"{s} is not a text value")


def parse_filter(raw: str) -> dict:
    m = FILTER_TEXT.match(raw.strip())
    if m:
        neg, fn, col, val = m.groups()
        cmp = {"Contains": "contains", "StartsWith": "begins", "EndsWith": "ends"}[fn]
        if neg:
            if cmp != "contains":
                raise QueryError("only not Text.Contains is understood")
            cmp = "notcontains"
        return {"op": "filter", "column": col, "cmp": cmp, "value": unquote(val)}
    m = FILTER_CMP.match(raw.strip())
    if not m:
        raise QueryError("a filter reads like each [Column] > 5, each Text.Contains([Column], \"x\") or each [Column] = null")
    col, cmp, rhs = m.groups()
    rhs = rhs.strip()
    if rhs == "null":
        if cmp not in ("=", "<>"):
            raise QueryError("null can only be compared with = or <>")
        return {"op": "filter", "column": col, "cmp": "blank" if cmp == "=" else "notblank", "value": ""}
    if rhs.startswith('"'):
        return {"op": "filter", "column": col, "cmp": cmp, "value": unquote(rhs)}
    if NUMBER.match(rhs):
        return {"op": "filter", "column": col, "cmp": cmp, "value": rhs}
    raise QueryError("compare a column with a number, a text value in quotes or null")


def parse_step(call: tuple, prev: str, library: dict) -> dict:
    _, fn, args = call
    if not args:
        raise QueryError(f"{fn} needs the previous step as its first argument")
    first = args[0]
    if fn == "Table.Combine":
        if first[0] != "l" or len(first[1]) != 2:
            raise QueryError("Table.Combine takes {PreviousStep, Query}")
        first, args = first[1][0], [first[1][0], first[1][1]]
    if first[0] != "i" or first[1] != prev:
        raise QueryError(f"{fn} must start from the step before it, {prev}")
    a = args[1:]

    def need(k: int):
        if len(a) < k:
            raise QueryError(f"{fn} is missing arguments")

    if fn == "Table.PromoteHeaders":
        return {"op": "promote_headers"}
    if fn == "Table.DemoteHeaders":
        return {"op": "demote_headers"}
    if fn == "Table.RemoveColumns":
        need(1)
        return {"op": "remove_columns", "columns": as_strs(a[0], "the columns")}
    if fn == "Table.SelectColumns":
        need(1)
        return {"op": "keep_columns", "columns": as_strs(a[0], "the columns")}
    if fn == "Table.RenameColumns":
        need(1)
        if a[0][0] != "l" or len(a[0][1]) != 1 or a[0][1][0][0] != "l" or len(a[0][1][0][1]) != 2:
            raise QueryError("Table.RenameColumns takes one pair, such as {{\"Old\", \"New\"}}; use one step per rename")
        old, new = a[0][1][0][1]
        return {"op": "rename", "from": as_str(old, "the old name"), "to": as_str(new, "the new name")}
    if fn == "Table.SelectRows":
        need(1)
        if a[0][0] != "e":
            raise QueryError("Table.SelectRows needs an each condition")
        return parse_filter(a[0][1])
    if fn == "Table.TransformColumnTypes":
        need(1)
        if a[0][0] != "l" or len(a[0][1]) != 1 or a[0][1][0][0] != "l" or len(a[0][1][0][1]) != 2:
            raise QueryError("Table.TransformColumnTypes takes one pair, such as {{\"Col\", type number}}")
        col, ty = a[0][1][0][1]
        if ty[0] != "t" or ty[1] not in M_TYPE:
            raise QueryError("the type must be type number, type text, type date or type logical")
        return {"op": "change_type", "column": as_str(col, "the column"), "type": M_TYPE[ty[1]]}
    if fn == "Table.Sort":
        need(1)
        if a[0][0] != "l" or len(a[0][1]) != 1 or a[0][1][0][0] != "l" or len(a[0][1][0][1]) != 2:
            raise QueryError("Table.Sort takes one pair, such as {{\"Col\", Order.Ascending}}")
        col, order = a[0][1][0][1]
        if order[0] != "i" or order[1] not in ("Order.Ascending", "Order.Descending"):
            raise QueryError("the order must be Order.Ascending or Order.Descending")
        return {"op": "sort", "column": as_str(col, "the column"), "desc": order[1] == "Order.Descending"}
    if fn == "Table.Group":
        need(2)
        if a[1][0] != "l" or len(a[1][1]) != 1 or a[1][1][0][0] != "l" or len(a[1][1][0][1]) < 2:
            raise QueryError("Table.Group takes one aggregate, such as {{\"Total\", each List.Sum([Amount]), type number}}")
        parts = a[1][1][0][1]
        name = as_str(parts[0], "the result name")
        if parts[1][0] != "e":
            raise QueryError("the aggregate must start with each")
        m = GROUP_EACH.match(parts[1][1].strip())
        if not m:
            raise QueryError("the aggregate must be List.Sum, List.Average, List.Min or List.Max of a [Column], or Table.RowCount(_)")
        out = {"op": "group", "by": as_strs(a[0], "the group columns"), "as": name}
        if m.group(1):
            out["agg"] = m.group(1).lower() if m.group(1) != "Average" else "average"
            out["column"] = m.group(2)
        else:
            out["agg"] = "count"
        return out
    if fn == "Table.Distinct":
        return {"op": "remove_duplicates"}
    if fn == "Table.FirstN":
        need(1)
        return {"op": "top", "n": num_field(as_numtext(a[0], "the row count"))}
    if fn == "Table.Skip":
        need(1)
        return {"op": "skip", "n": num_field(as_numtext(a[0], "the row count"))}
    if fn == "Table.SplitColumn":
        need(2)
        out = {"op": "split_column", "column": as_str(a[0], "the column")}
        sp = a[1]
        if sp[0] != "c":
            raise QueryError("use Splitter.SplitTextByDelimiter or Splitter.SplitTextByRepeatedLengths")
        if sp[1] == "Splitter.SplitTextByDelimiter" and sp[2]:
            out["delimiter"] = as_str(sp[2][0], "the delimiter")
            if len(sp[2]) > 1:
                out["max"] = num_field(as_numtext(sp[2][1], "the part count"))
        elif sp[1] == "Splitter.SplitTextByRepeatedLengths" and sp[2]:
            out["length"] = num_field(as_numtext(sp[2][0], "the length"))
        else:
            raise QueryError("use Splitter.SplitTextByDelimiter or Splitter.SplitTextByRepeatedLengths")
        return out
    if fn == "Table.CombineColumns":
        need(3)
        c = a[1]
        if c[0] != "c" or c[1] != "Combiner.CombineTextByDelimiter" or not c[2]:
            raise QueryError("use Combiner.CombineTextByDelimiter(\"separator\")")
        return {"op": "merge_columns", "columns": as_strs(a[0], "the columns"), "separator": as_str(c[2][0], "the separator"), "as": as_str(a[2], "the new name")}
    if fn in ("Table.FillDown", "Table.FillUp"):
        need(1)
        return {"op": "fill_down" if fn == "Table.FillDown" else "fill_up", "columns": as_strs(a[0], "the columns")}
    if fn == "Table.ReplaceValue":
        need(4)
        rep = a[2]
        if rep[0] != "i" or rep[1] not in ("Replacer.ReplaceValue", "Replacer.ReplaceText"):
            raise QueryError("use Replacer.ReplaceText or Replacer.ReplaceValue")
        out = {"op": "replace_values", "find": as_str(a[0], "the text to find"), "with": as_str(a[1], "the replacement"), "whole": rep[1] == "Replacer.ReplaceValue"}
        cols = as_strs(a[3], "the columns")
        if cols:
            out["columns"] = cols
        return out
    if fn == "Table.TransformColumns":
        need(2)
        f = a[1]
        if f[0] != "i" or f[1] not in M_TEXT:
            raise QueryError("use Text.Trim, Text.Clean, Text.Upper, Text.Lower or Text.Proper")
        out = {"op": "text_transform", "how": M_TEXT[f[1]]}
        cols = as_strs(a[0], "the columns")
        if cols:
            out["columns"] = cols
        return out
    if fn in ("Table.UnpivotOtherColumns", "Table.Unpivot"):
        need(3)
        out = {"op": "unpivot", "keep" if fn == "Table.UnpivotOtherColumns" else "columns": as_strs(a[0], "the columns"), "attribute": as_str(a[1], "the name column"), "value": as_str(a[2], "the value column")}
        return out
    if fn == "Table.Pivot":
        need(3)
        f = a[2]
        if f[0] != "i" or f[1] not in M_AGG:
            raise QueryError("combine with List.Sum, List.Average, List.Min, List.Max, List.Count or List.First")
        return {"op": "pivot", "column": as_str(a[0], "the column"), "values": as_str(a[1], "the values column"), "agg": M_AGG[f[1]]}
    if fn == "Table.AddColumn":
        need(2)
        if a[1][0] != "e":
            raise QueryError("the new column needs each and an expression")
        return {"op": "add_column", "as": as_str(a[0], "the column name"), "expression": a[1][1]}
    if fn == "Table.AddDatePart":
        need(3)
        f = a[1]
        if f[0] != "i" or f[1] not in M_PART:
            raise QueryError("use Date.Year, Date.Month, Date.Day, Date.DayOfWeek, Date.QuarterOfYear or Date.MonthName")
        out = {"op": "date_part", "column": as_str(a[0], "the column"), "part": M_PART[f[1]]}
        if len(a) > 2 and a[2][0] == "s" and a[2][1]:
            out["as"] = a[2][1]
        return out
    if fn == "Table.AddIndexColumn":
        need(2)
        out = {"op": "add_index", "as": as_str(a[0], "the column name")}
        if len(a) > 1:
            out["start"] = num_field(as_numtext(a[1], "the start"))
        return out
    if fn == "Table.ReorderColumns":
        need(1)
        return {"op": "reorder", "columns": as_strs(a[0], "the columns")}
    if fn == "Table.Transpose":
        return {"op": "transpose"}
    if fn == "Table.RemoveBlankRows":
        return {"op": "remove_blank_rows"}
    if fn == "Table.RemoveRowsWithErrors":
        return {"op": "remove_errors"}
    if fn == "Table.Combine":
        return {"op": "append", **other_ref(args[1], library)}
    if fn == "Table.Join":
        need(4)
        j = a[3] if len(a) > 3 and a[3][0] == "i" else (a[4] if len(a) > 4 else None)
        if j is None or j[0] != "i" or j[1] not in M_JOIN:
            raise QueryError("use JoinKind.LeftOuter, Inner, RightOuter, FullOuter or LeftAnti")
        return {"op": "merge", "left": as_strs(a[0], "the key columns"), "right": as_strs(a[2], "the other key columns"), "join": M_JOIN[j[1]], **other_ref(a[1], library)}
    if fn == "FormCel.Step":
        need(1)
        d = record_dict(a[0], "FormCel.Step")
        if "op" not in d:
            raise QueryError("FormCel.Step needs an op field")
        return d
    raise QueryError(f"{fn} is not a step FormCel can run")


def parse_source(call: tuple, library: dict) -> dict:
    if call[0] == "i":
        return {"kind": "query", "query": by_name(call[1], library)}
    if call[0] != "c" or call[1] not in FN_SOURCE:
        raise QueryError("the first line must name a source, such as Csv.Document([url = \"https://...\"]), or another query")
    if len(call[2]) != 1:
        raise QueryError(f"{call[1]} takes one record in square brackets")
    d = record_dict(call[2][0], call[1])
    return {"kind": FN_SOURCE[call[1]], **d}


def from_text(text: str, library: dict | None = None) -> dict:
    library = library or {}
    p = Parser(text)
    items, last = p.program()
    if not items:
        raise QueryError("write at least a source")
    first_name, first, line = items[0]
    try:
        source = parse_source(first, library)
    except QueryError as e:
        raise QueryError(f"line {line}: {e}")
    steps = []
    prev = first_name
    for name, value, line in items[1:]:
        if value[0] != "c":
            raise QueryError(f"line {line}: {name} must be a call such as Table.Skip({prev}, 1)")
        try:
            steps.append(parse_step(value, prev, library))
        except QueryError as e:
            raise QueryError(f"line {line}: {e}")
        prev = name
    if last != prev:
        raise QueryError(f"the in line must name the last step, {prev}")
    return {"source": source, "steps": steps}
