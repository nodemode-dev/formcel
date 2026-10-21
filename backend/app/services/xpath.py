import math
import re

TOKEN = re.compile(
    r"""\s*(?:
    (?P<num>\d+(?:\.\d*)?|\.\d+)
    |(?P<str>"[^"]*"|'[^']*')
    |(?P<op>//|\.\.|::|!=|<=|>=|[/()\[\]@,|=<>+\-*.])
    |(?P<name>[A-Za-z_][\w.\-]*(?::[A-Za-z_*][\w.\-]*)?)
    )""",
    re.X,
)

AXES = {"child", "descendant", "descendant-or-self", "parent", "ancestor", "ancestor-or-self", "following-sibling", "preceding-sibling", "self", "attribute", "following", "preceding"}


class XPathError(Exception):
    pass


class Text:
    def __init__(self, value: str, parent):
        self.tag = "#text"
        self.value = value
        self.parent = parent
        self.attrs: dict = {}
        self.kids: list = []


class Attr:
    def __init__(self, name: str, value: str, parent):
        self.tag = "@" + name
        self.name = name
        self.value = value
        self.parent = parent
        self.attrs: dict = {}
        self.kids: list = []


def tokens(q: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    pos = 0
    q = q.rstrip()
    while pos < len(q):
        m = TOKEN.match(q, pos)
        if not m or m.end() == pos:
            raise XPathError(f"unsupported XPath near '{q[pos:pos + 12].strip()}'")
        pos = m.end()
        kind = m.lastgroup
        out.append((kind, m.group(kind)))
    return out


def ordered(n) -> list:
    if isinstance(n, (Text, Attr)):
        return []
    items = [(i, 0, t) for i, t in n.chunks] + [(i, 1, k) for i, k in enumerate(n.kids)]
    items.sort(key=lambda x: (x[0], x[1]))
    return [Text(v, n) if kind == 0 else v for _, kind, v in items]


def string_of(n) -> str:
    if isinstance(n, (Text, Attr)):
        return n.value
    return n.text()


def descend(n) -> list:
    out = []
    for c in ordered(n):
        out.append(c)
        out.extend(descend(c))
    return out


class Parser:
    def __init__(self, q: str):
        self.t = tokens(q)
        self.i = 0

    def peek(self, k: int = 0):
        return self.t[self.i + k] if self.i + k < len(self.t) else (None, None)

    def eat(self, v: str) -> bool:
        if self.peek()[1] == v and self.peek()[0] != "str":
            self.i += 1
            return True
        return False

    def need(self, v: str) -> None:
        if not self.eat(v):
            raise XPathError(f"expected '{v}'")

    def parse(self):
        e = self.or_()
        if self.i != len(self.t):
            raise XPathError(f"unexpected '{self.peek()[1]}'")
        return e

    def or_(self):
        e = self.and_()
        while self.peek() == ("name", "or"):
            self.i += 1
            e = ("or", e, self.and_())
        return e

    def and_(self):
        e = self.eq()
        while self.peek() == ("name", "and"):
            self.i += 1
            e = ("and", e, self.eq())
        return e

    def eq(self):
        e = self.rel()
        while self.peek()[0] == "op" and self.peek()[1] in ("=", "!="):
            op = self.t[self.i][1]
            self.i += 1
            e = (op, e, self.rel())
        return e

    def rel(self):
        e = self.add()
        while self.peek()[0] == "op" and self.peek()[1] in ("<", ">", "<=", ">="):
            op = self.t[self.i][1]
            self.i += 1
            e = (op, e, self.add())
        return e

    def add(self):
        e = self.mul()
        while self.peek()[0] == "op" and self.peek()[1] in ("+", "-"):
            op = self.t[self.i][1]
            self.i += 1
            e = (op, e, self.mul())
        return e

    def mul(self):
        e = self.unary()
        while True:
            k, v = self.peek()
            if k == "op" and v == "*":
                self.i += 1
                e = ("*", e, self.unary())
            elif k == "name" and v in ("div", "mod"):
                self.i += 1
                e = (v, e, self.unary())
            else:
                return e

    def unary(self):
        if self.eat("-"):
            return ("neg", self.unary())
        return self.union()

    def union(self):
        e = self.path()
        while self.eat("|"):
            e = ("union", e, self.path())
        return e

    def path(self):
        k, v = self.peek()
        if k == "str":
            self.i += 1
            return ("lit", v[1:-1])
        if k == "num":
            self.i += 1
            return ("lit", float(v))
        if v == "(" and k == "op":
            self.i += 1
            e = self.or_()
            self.need(")")
            return self.tail(("group", e))
        if k == "name" and self.peek(1) == ("op", "(") and v not in ("text", "node", "comment") and v not in AXES:
            self.i += 2
            args = []
            if not self.eat(")"):
                args.append(self.or_())
                while self.eat(","):
                    args.append(self.or_())
                self.need(")")
            return self.tail(("call", v, args))
        absolute = False
        steps: list = []
        if self.eat("/"):
            absolute = True
            if self.peek()[0] is None or self.peek()[1] in (")", "]", ",", "|", "=", "!=", "<", ">", "<=", ">="):
                return ("path", True, [])
        elif self.eat("//"):
            absolute = True
            steps.append(("descendant-or-self", ("node",), []))
        steps.append(self.step())
        self.steps_more(steps)
        return ("path", absolute, steps)

    def tail(self, base):
        steps: list = []
        self.steps_more(steps)
        if not steps:
            return base
        return ("filter", base, steps)

    def steps_more(self, steps: list) -> None:
        while True:
            if self.eat("/"):
                steps.append(self.step())
            elif self.eat("//"):
                steps.append(("descendant-or-self", ("node",), []))
                steps.append(self.step())
            else:
                return

    def step(self):
        if self.eat("."):
            return ("self", ("node",), self.preds())
        if self.eat(".."):
            return ("parent", ("node",), self.preds())
        axis = "child"
        if self.eat("@"):
            axis = "attribute"
        elif self.peek()[0] == "name" and self.peek(1) == ("op", "::"):
            axis = self.peek()[1]
            if axis not in AXES:
                raise XPathError(f"unsupported axis {axis}")
            self.i += 2
        k, v = self.peek()
        if k == "op" and v == "*":
            self.i += 1
            test = ("any",)
        elif k == "name":
            self.i += 1
            if v in ("text", "node", "comment") and self.peek() == ("op", "("):
                self.i += 1
                self.need(")")
                test = (v,)
            else:
                test = ("name", v.split(":")[-1])
        else:
            raise XPathError(f"unexpected '{v}'")
        return (axis, test, self.preds())

    def preds(self) -> list:
        out = []
        while self.eat("["):
            out.append(self.or_())
            self.need("]")
        return out


def axis_nodes(axis: str, n) -> list:
    if axis == "child":
        return ordered(n)
    if axis == "descendant":
        return descend(n)
    if axis == "descendant-or-self":
        return [n] + descend(n)
    if axis == "self":
        return [n]
    if axis == "parent":
        return [n.parent] if n.parent is not None else []
    if axis in ("ancestor", "ancestor-or-self"):
        out = [n] if axis == "ancestor-or-self" else []
        p = n.parent
        while p is not None:
            out.append(p)
            p = p.parent
        return out
    if axis == "attribute":
        return [Attr(k, v, n) for k, v in n.attrs.items()] if not isinstance(n, (Text, Attr)) else []
    if axis in ("following-sibling", "preceding-sibling"):
        if n.parent is None:
            return []
        sibs = ordered(n.parent)
        idx = next((i for i, s in enumerate(sibs) if s is n or (isinstance(s, Text) and isinstance(n, Text) and s.value == n.value and s.parent is n.parent)), None)
        if idx is None:
            return []
        return sibs[idx + 1:] if axis == "following-sibling" else list(reversed(sibs[:idx]))
    raise XPathError(f"unsupported axis {axis}")


def matches(axis: str, test, n) -> bool:
    kind = test[0]
    if kind == "node":
        return True
    if axis == "attribute":
        return isinstance(n, Attr) and (kind == "any" or n.name == test[1] or n.name.lower() == test[1].lower())
    if kind == "text":
        return isinstance(n, Text)
    if kind == "comment":
        return False
    if isinstance(n, (Text, Attr)):
        return False
    if kind == "any":
        return n.tag != "#root"
    return n.tag == test[1] or n.tag.lower() == test[1].lower()


def uniq(nodes: list) -> list:
    seen: set = set()
    out = []
    for n in nodes:
        k = id(n) if not isinstance(n, (Text, Attr)) else (id(n.parent), n.tag, n.value)
        if k not in seen:
            seen.add(k)
            out.append(n)
    return out


def num(v) -> float:
    if isinstance(v, list):
        v = string(v)
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, float):
        return v
    try:
        return float(str(v).strip())
    except ValueError:
        return math.nan


def string(v) -> str:
    if isinstance(v, list):
        return string_of(v[0]) if v else ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        if math.isnan(v):
            return "NaN"
        return str(int(v)) if v.is_integer() else repr(v)
    return str(v)


def boolean(v) -> bool:
    if isinstance(v, list):
        return bool(v)
    if isinstance(v, float):
        return v != 0 and not math.isnan(v)
    if isinstance(v, str):
        return v != ""
    return bool(v)


def compare(op: str, a, b) -> bool:
    if isinstance(a, list) and isinstance(b, list):
        return any(compare(op, string_of(x), string_of(y)) for x in a for y in b)
    if isinstance(a, list):
        return any(compare(op, string_of(x) if not isinstance(b, float) else num(string_of(x)), b) for x in a)
    if isinstance(b, list):
        return any(compare(op, a, string_of(y) if not isinstance(a, float) else num(string_of(y))) for y in b)
    if op in ("=", "!="):
        if isinstance(a, bool) or isinstance(b, bool):
            r = boolean(a) == boolean(b)
        elif isinstance(a, float) or isinstance(b, float):
            r = num(a) == num(b)
        else:
            r = string(a) == string(b)
        return r if op == "=" else not r
    x, y = num(a), num(b)
    return {"<": x < y, ">": x > y, "<=": x <= y, ">=": x >= y}[op]


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


class Ctx:
    def __init__(self, node, pos: int = 1, size: int = 1):
        self.node = node
        self.pos = pos
        self.size = size


def call(name: str, args: list, ctx: Ctx, run):
    n = name.lower()
    a = [run(x, ctx) for x in args]

    def s(i: int) -> str:
        return string(a[i]) if i < len(a) else string_of(ctx.node)

    if n == "position":
        return float(ctx.pos)
    if n == "last":
        return float(ctx.size)
    if n == "count":
        return float(len(a[0]))
    if n == "contains":
        return s(1) in s(0)
    if n == "starts-with":
        return s(0).startswith(s(1))
    if n == "ends-with":
        return s(0).endswith(s(1))
    if n == "string":
        return s(0)
    if n == "concat":
        return "".join(string(x) for x in a)
    if n == "normalize-space":
        return norm(s(0))
    if n == "string-length":
        return float(len(s(0)))
    if n == "substring":
        text = s(0)
        start = round(num(a[1]))
        if len(a) > 2:
            end = start + round(num(a[2]))
            return "".join(c for i, c in enumerate(text, 1) if start <= i < end)
        return "".join(c for i, c in enumerate(text, 1) if i >= start)
    if n == "substring-before":
        t, k = s(0), s(1)
        return t[:t.index(k)] if k in t else ""
    if n == "substring-after":
        t, k = s(0), s(1)
        return t[t.index(k) + len(k):] if k in t else ""
    if n == "translate":
        src, dst = s(1), s(2)
        table = {ord(c): (dst[i] if i < len(dst) else None) for i, c in enumerate(src) if c not in src[:i]}
        return s(0).translate(table)
    if n in ("lower-case", "lower"):
        return s(0).lower()
    if n in ("upper-case", "upper"):
        return s(0).upper()
    if n == "not":
        return not boolean(a[0])
    if n == "true":
        return True
    if n == "false":
        return False
    if n == "boolean":
        return boolean(a[0])
    if n == "number":
        return num(a[0]) if a else num(string_of(ctx.node))
    if n == "sum":
        return float(sum(num(string_of(x)) for x in a[0]))
    if n == "floor":
        return float(math.floor(num(a[0])))
    if n == "ceiling":
        return float(math.ceil(num(a[0])))
    if n == "round":
        return float(math.floor(num(a[0]) + 0.5))
    if n in ("name", "local-name"):
        t = a[0][0] if a and a[0] else ctx.node
        return getattr(t, "name", None) or ("" if t.tag.startswith("#") else t.tag)
    if n == "string-join":
        return s(1).join(string_of(x) for x in a[0]) if len(a) > 1 else "".join(string_of(x) for x in a[0])
    raise XPathError(f"unsupported XPath function {name}()")


def run_steps(nodes: list, steps: list, run) -> list:
    for axis, test, preds in steps:
        nxt: list = []
        for n in nodes:
            cand = [c for c in axis_nodes(axis, n) if matches(axis, test, c)]
            for p in preds:
                kept = []
                for i, c in enumerate(cand, 1):
                    v = run(p, Ctx(c, i, len(cand)))
                    if isinstance(v, float):
                        if v == i:
                            kept.append(c)
                    elif boolean(v):
                        kept.append(c)
                cand = kept
            nxt.extend(cand)
        nodes = uniq(nxt)
    return nodes


def evaluate(root, query: str):
    tree = Parser(query).parse()

    def run(e, ctx: Ctx):
        k = e[0]
        if k == "lit":
            return e[1]
        if k == "group":
            return run(e[1], ctx)
        if k == "path":
            start = [root] if e[1] else [ctx.node]
            return run_steps(start, e[2], run)
        if k == "filter":
            base = run(e[1], ctx)
            if not isinstance(base, list):
                raise XPathError("a path can only follow a node set")
            return run_steps(base, e[2], run)
        if k == "call":
            return call(e[1], e[2], ctx, run)
        if k == "or":
            return boolean(run(e[1], ctx)) or boolean(run(e[2], ctx))
        if k == "and":
            return boolean(run(e[1], ctx)) and boolean(run(e[2], ctx))
        if k in ("=", "!=", "<", ">", "<=", ">="):
            return compare(k, run(e[1], ctx), run(e[2], ctx))
        if k == "neg":
            return -num(run(e[1], ctx))
        if k == "union":
            a, b = run(e[1], ctx), run(e[2], ctx)
            if not isinstance(a, list) or not isinstance(b, list):
                raise XPathError("a union needs node sets")
            merged = uniq(a + b)
            all_nodes = [root] + descend(root)
            pos = {id(n): i for i, n in enumerate(all_nodes)}
            return sorted(merged, key=lambda n: pos.get(id(n), pos.get(id(n.parent), 0) + 0.5))
        x, y = num(run(e[1], ctx)), num(run(e[2], ctx))
        if k == "+":
            return x + y
        if k == "-":
            return x - y
        if k == "*":
            return x * y
        if k == "div":
            return x / y if y else (math.nan if x == 0 else math.copysign(math.inf, x))
        if k == "mod":
            return math.fmod(x, y) if y else math.nan
        raise XPathError("unsupported expression")

    return run(tree, Ctx(root))
