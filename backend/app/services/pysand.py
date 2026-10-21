import json
import os
import subprocess
import sys
import tempfile

from . import aiclient

TIMEOUT = 8
MAX_CODE = 8000

RUNNER = r'''
import ast, json, sys, resource, builtins, importlib

resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
try:
    resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
except (ValueError, OSError):
    pass

ALLOWED = ["math", "statistics", "re", "json", "datetime", "itertools", "functools", "collections", "random", "string", "decimal", "fractions", "operator", "textwrap", "calendar"]
BANNED_NAMES = {"open", "exec", "eval", "compile", "input", "breakpoint", "help", "memoryview", "getattr", "setattr", "delattr", "globals", "locals", "vars", "dir", "type", "object", "super", "classmethod", "staticmethod", "property", "exit", "quit", "copyright", "credits", "license"}
SAFE = ["abs", "all", "any", "ascii", "bin", "bool", "bytes", "callable", "chr", "complex", "dict", "divmod", "enumerate", "filter", "float", "format", "frozenset", "hash", "hex", "int", "isinstance", "issubclass", "iter", "len", "list", "map", "max", "min", "next", "oct", "ord", "pow", "print", "range", "repr", "reversed", "round", "set", "slice", "sorted", "str", "sum", "tuple", "zip", "Exception", "ValueError", "TypeError", "KeyError", "IndexError", "ZeroDivisionError", "ArithmeticError", "StopIteration", "True", "False", "None"]

req = json.loads(sys.stdin.read())
code = req["code"]
tree = ast.parse(code, mode="exec")
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        for a in node.names:
            if a.name.split(".")[0] not in ALLOWED:
                raise ImportError("import " + a.name + " is not available; allowed: " + ", ".join(ALLOWED))
    elif isinstance(node, ast.ImportFrom):
        if (node.module or "").split(".")[0] not in ALLOWED or node.level:
            raise ImportError("import from " + str(node.module) + " is not available")
    elif isinstance(node, ast.Attribute) and node.attr.startswith("_"):
        raise NameError("attributes that start with an underscore are not available")
    elif isinstance(node, ast.Name) and (node.id in BANNED_NAMES or "__" in node.id):
        raise NameError(node.id + " is not available")
    elif isinstance(node, (ast.Global, ast.Nonlocal)):
        raise SyntaxError("global and nonlocal are not available")

def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name.split(".")[0] not in ALLOWED:
        raise ImportError(name + " is not available")
    return importlib.import_module(name)

safe = {k: getattr(builtins, k) for k in SAFE if hasattr(builtins, k)}
safe["__import__"] = guarded_import
env = {"__builtins__": safe}
for m in ALLOWED:
    env[m] = importlib.import_module(m)
args = req["args"]
env["args"] = args
for i, v in enumerate(args):
    env["arg%d" % (i + 1)] = v
last = tree.body[-1] if tree.body else None
value = None
if isinstance(last, ast.Expr):
    tree.body = tree.body[:-1]
    exec(compile(tree, "<py>", "exec"), env)
    value = eval(compile(ast.Expression(last.value), "<py>", "eval"), env)
else:
    exec(compile(tree, "<py>", "exec"), env)
    value = env.get("result")

def plain(v, depth=0):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if depth > 3:
        raise ValueError("the result is nested too deeply")
    if isinstance(v, dict):
        return [[plain(k, 9), plain(x, depth + 1)] for k, x in v.items()]
    if isinstance(v, (list, tuple, set, frozenset, range)):
        items = list(v)
        if items and all(isinstance(r, (list, tuple)) for r in items):
            return [[plain(c, 9) for c in r] for r in items]
        return [[plain(c, 9)] for c in items]
    return str(v)

sys.stdout.write(json.dumps({"value": plain(value)}))
'''


def enabled() -> bool:
    return bool(aiclient.load_settings().get("python_cells"))


def set_enabled(on: bool) -> dict:
    s = aiclient.load_settings()
    if on:
        s["python_cells"] = True
    else:
        s.pop("python_cells", None)
    aiclient.save_settings(s)
    return status()


def status() -> dict:
    return {"enabled": enabled(), "version": sys.version.split()[0], "modules": ["math", "statistics", "re", "json", "datetime", "itertools", "functools", "collections", "random", "string", "decimal", "fractions", "operator", "textwrap", "calendar"]}


class PyError(Exception):
    pass


def run(code: str, args: list) -> list[list] | object:
    if len(code) > MAX_CODE:
        raise PyError(f"the code is over {MAX_CODE} characters")
    with tempfile.TemporaryDirectory() as d:
        try:
            p = subprocess.run([sys.executable, "-I", "-S", "-c", RUNNER], input=json.dumps({"code": code, "args": args}, default=str), capture_output=True, text=True, timeout=TIMEOUT, cwd=d, env={"PYTHONIOENCODING": "utf-8", "PATH": os.defpath})
        except subprocess.TimeoutExpired:
            raise PyError(f"the code ran longer than {TIMEOUT} seconds")
    if p.returncode != 0:
        last = (p.stderr.strip().splitlines() or ["the code failed"])[-1]
        raise PyError(last[:300])
    try:
        return json.loads(p.stdout)["value"]
    except (ValueError, KeyError):
        raise PyError("the code returned nothing readable")
