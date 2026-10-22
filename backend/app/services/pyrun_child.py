import ast
import builtins
import importlib
import io
import json
import os
import resource
import sys
import sysconfig

proto_in = os.fdopen(os.dup(0), "r", encoding="utf-8")
proto_out = os.fdopen(os.dup(1), "w", encoding="utf-8")
null = os.open(os.devnull, os.O_RDWR)
os.dup2(null, 0)
os.dup2(null, 1)

req = json.loads(proto_in.readline())
MEM = int(req.get("memory", 1536)) * 1024 * 1024
resource.setrlimit(resource.RLIMIT_CPU, (int(req.get("cpu", 10)), int(req.get("cpu", 10))))
resource.setrlimit(resource.RLIMIT_AS, (MEM, MEM))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
try:
    resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
except (ValueError, OSError):
    pass

ALLOWED = ["math", "statistics", "re", "json", "datetime", "itertools", "functools", "collections", "random", "string", "decimal", "fractions", "operator", "textwrap", "calendar"]
HEAVY = ["pandas", "numpy"]
BANNED_NAMES = {"open", "exec", "eval", "compile", "input", "breakpoint", "help", "memoryview", "getattr", "setattr", "delattr", "globals", "locals", "vars", "dir", "type", "object", "super", "classmethod", "staticmethod", "property", "exit", "quit", "copyright", "credits", "license"}
SAFE = ["abs", "all", "any", "ascii", "bin", "bool", "bytes", "callable", "chr", "complex", "dict", "divmod", "enumerate", "filter", "float", "format", "frozenset", "hash", "hex", "int", "isinstance", "issubclass", "iter", "len", "list", "map", "max", "min", "next", "oct", "ord", "pow", "range", "repr", "reversed", "round", "set", "slice", "sorted", "str", "sum", "tuple", "zip", "Exception", "ValueError", "TypeError", "KeyError", "IndexError", "ZeroDivisionError", "ArithmeticError", "StopIteration", "True", "False", "None"]

pd = np = None
have = []
if req.get("pandas"):
    try:
        import numpy as np
        import pandas as pd

        have = HEAVY
        pd.DataFrame({"a": [1, 2], "b": [3.5, 4.5]}).describe()
        pd.Series([1, 2, 3]).rolling(2).mean()
        pd.DataFrame({"a": ["x", "y"], "b": [1, 2]}).groupby("a").sum()
        pd.to_datetime(["2024-01-01"]).strftime("%Y")
        pd.DataFrame({"a": [1, 2]}).merge(pd.DataFrame({"a": [1, 2], "c": [3, 4]}), on="a")
        pd.DataFrame({"a": [1, 2]}).sort_values("a").to_dict()
        pd.pivot_table(pd.DataFrame({"a": ["x", "y"], "b": [1, 2], "c": [1, 1]}), index="a", values="b", aggfunc="sum")
    except Exception:
        pd = np = None
        have = []
for m in ALLOWED:
    importlib.import_module(m)

ROOTS = tuple(os.path.realpath(p) for p in {sysconfig.get_paths()[k] for k in ("stdlib", "platstdlib", "purelib", "platlib")} | {sys.prefix, sys.base_prefix, sys.exec_prefix} if p)
BLOCK = ("socket.", "subprocess.", "os.system", "os.exec", "os.fork", "os.spawn", "os.posix_spawn", "os.kill", "os.remove", "os.rename", "os.replace", "os.mkdir", "os.rmdir", "os.chmod", "os.chown", "os.link", "os.symlink", "os.truncate", "os.putenv", "os.unsetenv", "os.chdir", "os.chroot", "os.setuid", "os.setgid", "shutil.", "ctypes.", "webbrowser", "urllib.Request", "http.client", "smtplib", "ftplib", "telnetlib", "pty.", "fcntl.", "tempfile.", "sqlite3.", "mmap.", "pickle.find_class", "multiprocessing.", "winreg.")
WRITE = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


def audit(event, args):
    if event == "open":
        path, mode, flags = args
        if isinstance(path, int):
            return
        mode = mode if isinstance(mode, str) else ""
        if (mode and any(c in mode for c in "wax+")) or (isinstance(flags, int) and flags & WRITE):
            raise PermissionError("writing files is not available in Python cells")
        p = os.path.realpath(os.fsdecode(path))
        if p == os.devnull or p.startswith(ROOTS):
            return
        raise PermissionError("reading files is not available in Python cells")
    if event.startswith(BLOCK):
        raise PermissionError("this is not available in Python cells (" + event + ")")


sys.addaudithook(audit)

code = req["code"]
tree = ast.parse(code, mode="exec")
before = []
for earlier in req.get("before") or []:
    try:
        before.append(ast.parse(earlier, mode="exec"))
    except SyntaxError:
        continue
allowed = ALLOWED + have
for node in [n for t in before + [tree] for n in ast.walk(t)]:
    if isinstance(node, ast.Import):
        for a in node.names:
            if a.name.split(".")[0] not in allowed:
                raise ImportError("import " + a.name + " is not available; allowed: " + ", ".join(allowed))
    elif isinstance(node, ast.ImportFrom):
        if (node.module or "").split(".")[0] not in allowed or node.level:
            raise ImportError("import from " + str(node.module) + " is not available")
    elif isinstance(node, ast.Attribute) and node.attr.startswith("_"):
        raise NameError("attributes that start with an underscore are not available")
    elif isinstance(node, ast.Name) and (node.id in BANNED_NAMES or "__" in node.id):
        raise NameError(node.id + " is not available")
    elif isinstance(node, (ast.Global, ast.Nonlocal)):
        raise SyntaxError("global and nonlocal are not available")


def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name.split(".")[0] not in allowed:
        raise ImportError(name + " is not available")
    return importlib.import_module(name)


printed = []


def say(*a, **k):
    printed.append(" ".join(str(x) for x in a)[:2000])


def ask(msg):
    proto_out.write(json.dumps(msg, default=str) + "\n")
    proto_out.flush()
    line = proto_in.readline()
    if not line:
        raise RuntimeError("the engine closed the connection")
    reply = json.loads(line)
    if reply.get("error"):
        raise ValueError(reply["error"])
    return reply


def frame(rows, headers):
    if pd is None:
        return rows
    if headers and rows:
        head = ["" if h is None else h for h in rows[0]]
        seen = {}
        cols = []
        for h in head:
            n = seen.get(h, 0)
            seen[h] = n + 1
            cols.append(h if n == 0 else "%s.%d" % (h, n))
        return pd.DataFrame(rows[1:], columns=cols)
    return pd.DataFrame(rows)


def xl(reference, headers=False):
    r = ask({"xl": str(reference)})
    rows = [[None if v == "" else v for v in row] for row in r["rows"]]
    if r.get("cell") and len(rows) == 1 and len(rows[0]) == 1:
        return rows[0][0]
    return frame(rows, bool(headers))


safe = {k: getattr(builtins, k) for k in SAFE if hasattr(builtins, k)}
safe["__import__"] = guarded_import
safe["print"] = say
env = {"__builtins__": safe, "xl": xl}
for m in ALLOWED:
    env[m] = importlib.import_module(m)
if pd is not None:
    env["pd"] = pd
    env["np"] = np
args = req["args"]
env["args"] = args
for i, v in enumerate(args):
    env["arg%d" % (i + 1)] = v

LIMIT = 200000


def scalar(v):
    if v is None:
        return None
    if isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return None if v != v else v
    if np is not None:
        if isinstance(v, np.generic):
            return scalar(v.item())
    if pd is not None:
        if v is pd.NaT or (hasattr(pd, "isna") and not hasattr(v, "__len__") and pd.isna(v)):
            return None
    if hasattr(v, "isoformat"):
        return v.isoformat(sep=" ") if hasattr(v, "hour") and (v.hour or v.minute or v.second) else v.isoformat()[:10]
    if hasattr(v, "__float__") and not isinstance(v, (list, tuple, dict)):
        try:
            return float(v)
        except Exception:
            pass
    return str(v)


def table(v):
    if pd is not None and isinstance(v, pd.Series):
        v = v.to_frame()
    if pd is not None and isinstance(v, pd.DataFrame):
        if v.size > LIMIT:
            raise ValueError("the result is over %d cells" % LIMIT)
        cols = [" ".join(str(x) for x in c) if isinstance(c, tuple) else str(c) for c in v.columns]
        keep_index = not isinstance(v.index, pd.RangeIndex)
        head = ([str(v.index.name) if v.index.name is not None else ""] if keep_index else []) + cols
        body = []
        idx = list(v.index)
        for i, row in enumerate(v.itertuples(index=False, name=None)):
            body.append(([scalar(idx[i])] if keep_index else []) + [scalar(x) for x in row])
        return [head] + body
    return None


def plain(v, depth=0):
    if np is not None and isinstance(v, np.ndarray):
        v = v.tolist()
    t = table(v)
    if t is not None:
        return t
    if isinstance(v, dict):
        return [[scalar(k), plain_cell(x)] for k, x in v.items()]
    if isinstance(v, (list, tuple, set, frozenset, range)):
        items = list(v)
        if items and all(isinstance(r, dict) for r in items):
            keys = list(dict.fromkeys(k for r in items for k in r))
            return [[scalar(k) for k in keys]] + [[plain_cell(r.get(k)) for k in keys] for r in items]
        if items and all(isinstance(r, (list, tuple)) for r in items):
            return [[plain_cell(c) for c in r] for r in items]
        return [[plain_cell(c)] for c in items]
    return [[scalar(v)]]


def plain_cell(c):
    if isinstance(c, (list, tuple, dict, set)):
        return json.dumps(c, default=str)
    return scalar(c)


for earlier in before:
    try:
        exec(compile(earlier, "<before>", "exec"), env)
    except Exception:
        continue
printed.clear()

try:
    last = tree.body[-1] if tree.body else None
    if isinstance(last, ast.Expr):
        tree.body = tree.body[:-1]
        exec(compile(tree, "<py>", "exec"), env)
        value = eval(compile(ast.Expression(last.value), "<py>", "eval"), env)
    else:
        exec(compile(tree, "<py>", "exec"), env)
        value = env.get("result")
    out = {"value": plain(value), "print": printed}
except BaseException as e:
    tb = e.__traceback__
    line = 0
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == "<py>":
            line = tb.tb_lineno
        tb = tb.tb_next
    said = "the code used more than %d MB of memory" % (MEM // 1048576) if isinstance(e, MemoryError) else str(e)
    out = {"error": ("%s: %s" % (type(e).__name__, said))[:300], "line": line, "print": printed}
proto_out.write(json.dumps({"done": out}, default=str) + "\n")
proto_out.flush()
