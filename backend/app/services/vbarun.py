import json
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

from . import gasrun, ranges
from .restmodels import esc

RUNNER = Path(__file__).with_name("vba_runner.mjs")
LIMIT = 30
UDF_LIMIT = 8
MAX_CELLS = 600_000
FUNCTION = re.compile(r"^[ \t]*(?:(Public|Private|Friend)[ \t]+)?(?:Static[ \t]+)?Function[ \t]+([A-Za-z_]\w*)", re.I | re.M)
STD = ("std",)


class VbaError(Exception):
    pass


def available() -> bool:
    return shutil.which("node") is not None and RUNNER.is_file()


def level(b) -> str:
    settings = (b.auto or {}).get("settings") or {}
    raw = settings.get("macroSecurity")
    if isinstance(raw, dict):
        raw = raw.get("level")
    return raw if raw in ("silent", "notify", "signed", "all") else "notify"


def allowed(b, trigger: str) -> bool:
    lv = level(b)
    if lv == "all":
        return True
    if lv == "notify":
        return trigger == "user"
    return False


def modules_of(b) -> tuple[list[dict], list[dict]]:
    try:
        from .vba import service
    except ImportError:
        return [], []
    with b.lock:
        doc = service.read(getattr(b, "vba", None), b.sheet_names())
    if not doc.get("present"):
        return [], []
    sheets = doc.get("sheets") or []
    by_code = {s["codeName"]: s["name"] for s in sheets if s.get("codeName")}
    mods = [{"name": m["name"], "kind": m["kind"], "code": m["code"], "sheet": by_code.get(m["name"])} for m in doc["modules"]]
    return mods, sheets


def functions(b) -> list[str]:
    mods, _ = modules_of(b)
    out: list[str] = []
    for m in mods:
        if m["kind"] not in STD:
            continue
        for vis, name in FUNCTION.findall(m["code"]):
            if vis.lower() != "private" and name not in out:
                out.append(name)
    return out


def snapshot(b) -> dict:
    with b.lock:
        names = b.sheet_names()
        sheets = []
        budget = MAX_CELLS
        for i, n in enumerate(names):
            items = b.engine.cells(i)
            budget -= len(items)
            if budget < 0:
                raise VbaError("The workbook is too large for a macro run (over 600,000 cells).")
            values = {(r, c): t for r, c, t in b.engine.values(i)}
            cells = []
            for r, c, raw in items:
                v = values.get((r, c), "")
                formula = raw if isinstance(raw, str) and raw.startswith("=") else None
                cells.append([r, c, v if formula else raw, formula, False, v])
            view = b.views[i] if i < len(b.views) else {}
            cols = view.get("cols") or {}
            rows = view.get("rows") or {}
            sheets.append({
                "name": n,
                "cells": cells,
                "styles": [[r, c, s] for r, c, s in b.engine.styles(i)],
                "formats": [[r, c, f] for r, c, f in b.engine.formats(i)],
                "merges": [list(m) for m in b.engine.merges(i)],
                "visible": "Hidden" if view.get("hidden") else "Visible",
                "tab": str(view.get("color") or "").replace("#", "").lower(),
                "grid": True,
                "freeze": [view.get("fr") or 0, view.get("fc") or 0],
                "cols": [list(x) for x in cols.get("sizes") or []] + [[k, 0] for k in cols.get("hidden") or []],
                "rows": [list(x) for x in rows.get("sizes") or []] + [[k, 0] for k in rows.get("hidden") or []],
            })
        return {
            "sheets": sheets,
            "active": names[0],
            "selection": {"sheet": names[0], "r0": 0, "c0": 0, "r1": 0, "c1": 0},
            "tables": [],
            "charts": [],
            "pivots": [],
            "names": [list(x) for x in b.engine.names()],
            "title": b.title,
        }


def blank_book(b) -> dict:
    with b.lock:
        names = b.sheet_names()
        title = b.title
    sheets = [{"name": n, "cells": [], "styles": [], "formats": [], "merges": [], "visible": "Visible", "tab": "", "grid": True, "freeze": [0, 0], "cols": [], "rows": []} for n in names]
    return {"sheets": sheets, "active": names[0], "selection": None, "tables": [], "charts": [], "pivots": [], "names": [], "title": title}


def merge_mode(mode: str) -> str:
    return "cells" if mode == "all" else mode


def apply_ops(wid: str, ops: list[dict], state: dict) -> None:
    from .store import now, store

    token = gasrun.busy.set(True)
    try:
        i = 0
        while i < len(ops):
            op = ops[i]
            kind = op.get("k")
            b = store().book(wid)
            names = b.sheet_names()
            if kind == "edit":
                sheet = op["sheet"]
                cells = []
                while i < len(ops) and ops[i].get("k") == "edit" and ops[i]["sheet"] == sheet:
                    cells.append((ops[i]["r"], ops[i]["c"], ops[i]["raw"]))
                    i += 1
                if sheet in names:
                    store().edit(wid, names.index(sheet), cells, user="macro", why="macro")
                continue
            i += 1
            if kind == "select":
                continue
            state["structural"] = True
            if kind == "sheet":
                if op["name"] not in names:
                    store().add_sheet(wid, op["name"])
                continue
            if kind == "name":
                with b.lock:
                    b.engine.define_name(op["name"], op["refers"])
                    b.modified = now()
                    store()._write(b)
                continue
            if op.get("sheet") not in names:
                state["skipped"] = state.get("skipped", 0) + 1
                continue
            idx = names.index(op["sheet"])
            if kind == "sheetOp":
                name = op["op"]
                if name == "rename":
                    store().sheet_op(wid, "update", idx, name=op.get("name"))
                elif name == "move":
                    store().sheet_op(wid, "move", idx, to=op.get("to", 0))
                elif name == "delete" and len(names) > 1:
                    store().sheet_op(wid, "delete", idx)
                elif name == "tab":
                    store().sheet_op(wid, "update", idx, view={"color": "#" + str(op.get("value") or "").lstrip("#") if op.get("value") else ""})
                elif name == "visible":
                    store().sheet_op(wid, "update", idx, view={"hidden": op.get("value") != "Visible"})
                elif name == "show":
                    store().sheet_op(wid, "update", idx, view={"hidden": False})
                elif name == "freeze":
                    store().sheet_op(wid, "update", idx, view={"fr": op.get("rows") or 0, "fc": op.get("cols") or 0})
                continue
            if kind == "shift":
                store().shift(wid, idx, op["rows"], op["at"], op["n"], op["insert"], user="macro")
                continue
            if kind in ("size", "hide"):
                with b.lock:
                    b.fit_views()
                    view = dict(b.views[idx])
                    axis = "cols" if op.get("cols", not op.get("rows")) else "rows"
                    cur = dict(view.get(axis) or {})
                    if kind == "size":
                        sizes = {k: v for k, v in cur.get("sizes") or []}
                        for k in range(op["i0"], op["i1"] + 1):
                            sizes[k] = op["px"]
                        cur["sizes"] = [[k, v] for k, v in sorted(sizes.items())]
                    else:
                        hidden = set(cur.get("hidden") or [])
                        for k in range(op["i0"], op["i1"] + 1):
                            (hidden.add if op["on"] else hidden.discard)(k)
                        cur["hidden"] = sorted(hidden)
                    view[axis] = cur
                    b.views[idx] = view
                    b.modified = now()
                    store()._write(b)
                continue
            if "r0" not in op and kind not in ("link", "filter"):
                state["skipped"] = state.get("skipped", 0) + 1
                continue
            with b.lock:
                if kind == "filter":
                    b.engine.set_filter(op["text"], idx)
                else:
                    r0, c0 = op.get("r0", op.get("r")), op.get("c0", op.get("c"))
                    r1, c1 = op.get("r1", r0), op.get("c1", c0)
                    top = f"{ranges.col_name(c0)}{r0 + 1}"
                    bottom = f"{ranges.col_name(c1)}{r1 + 1}"
                    if kind == "style":
                        b.engine.set_style(top, bottom, op["patch"], idx)
                    elif kind == "format":
                        b.engine.set_format(top, bottom, op["code"], idx)
                    elif kind == "sort":
                        b.engine.sort(top, bottom, [tuple(k) for k in op["keys"]], bool(op.get("header")), False, idx)
                    elif kind == "merge":
                        b.engine.merge(top, bottom, merge_mode(op["mode"]), idx)
                    elif kind == "link":
                        b.engine.set_link(top, op["target"], op.get("display") or None, idx)
                    else:
                        state["skipped"] = state.get("skipped", 0) + 1
                        continue
                b.modified = now()
                store()._write(b)
    finally:
        gasrun.busy.reset(token)


def evaluate(wid: str, sheet: str, formula: str) -> str:
    from .store import store

    b = store().book(wid)
    with b.lock:
        names = b.sheet_names()
        idx = names.index(sheet) if sheet in names else 0
        reply = b.engine.name_tool("eval", f"{idx}\t0\t0\t{esc(formula)}\t1")
    if reply.startswith("e"):
        raise VbaError(reply[1:])
    return reply[1:]


def spawn(wid: str, req: dict, limit: int) -> dict:
    from .store import store

    exe = shutil.which("node")
    if not exe:
        raise VbaError("No JavaScript runtime was found on the PATH. Install Node.js (MIT) so macros can run in the engine process.")
    if not RUNNER.is_file():
        raise VbaError("The VBA runner is not built. Run npm run build:vba in the frontend folder.")
    try:
        flags = gasrun.locked_down(exe, RUNNER)
    except gasrun.RunError as e:
        raise VbaError(str(e)) from None
    state: dict = {}
    started = time.time()
    p = subprocess.Popen([exe, *flags, "--max-old-space-size=256", str(RUNNER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", cwd="/", env=gasrun.child_env(str(Path(exe).parent)))
    timer = threading.Timer(limit, p.kill)
    timer.start()
    final: dict | None = None
    try:
        p.stdin.write(json.dumps({**req, "limitMs": limit * 1000}) + "\n")
        p.stdin.flush()
        for line in p.stdout:
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("done"):
                final = msg
                break
            try:
                kind = msg.get("rpc")
                if kind == "apply":
                    apply_ops(wid, msg["ops"], state)
                    reply = {"book": snapshot(store().book(wid))}
                elif kind == "eval":
                    reply = {"text": evaluate(wid, msg["sheet"], msg["formula"])}
                else:
                    reply = {"error": f"unknown call {kind}"}
            except Exception as e:
                reply = {"error": str(e)}
            p.stdin.write(json.dumps(reply) + "\n")
            p.stdin.flush()
    except (BrokenPipeError, OSError):
        pass
    finally:
        timer.cancel()
        if p.poll() is None:
            p.kill()
        p.wait()
    ms = int((time.time() - started) * 1000)
    if final is None:
        err = (p.stderr.read() or "").strip().splitlines()
        final = {"ok": False, "error": f"The macro ran longer than {limit} seconds and was stopped" if ms >= limit * 1000 - 200 else (err[-1][:300] if err else "the macro stopped"), "output": []}
    final["ms"] = ms
    if state.get("skipped"):
        final["skipped"] = state["skipped"]
    if state.get("structural"):
        store().hub.publish(wid, {"type": "reload"}, None)
    return final


def run(wid: str, proc: str, args: list | None = None, modules: list[dict] | None = None, trigger: str = "user") -> dict:
    from .store import store

    b = store().book(wid)
    mods = modules if modules is not None else modules_of(b)[0]
    if not mods:
        raise VbaError("This workbook has no macro project.")
    if not allowed(b, trigger):
        raise VbaError("Macros are disabled by the macro security setting.")
    return spawn(wid, {"mode": "run", "modules": mods, "proc": proc, "args": args or [], "book": snapshot(b)}, LIMIT)


def fire(wid: str, event: dict, modules: list[dict] | None = None, trigger: str = "event") -> dict:
    from .store import store

    b = store().book(wid)
    mods = modules if modules is not None else modules_of(b)[0]
    if not mods:
        return {"ok": True, "ran": False, "cancel": False, "output": []}
    if not allowed(b, trigger):
        return {"ok": False, "ran": False, "cancel": False, "error": "Macros are disabled by the macro security setting.", "output": []}
    return spawn(wid, {"mode": "event", "modules": mods, "event": event, "book": snapshot(b)}, LIMIT)


def call_udf(wid: str, name: str, args: list):
    from .store import store

    b = store().book(wid)
    mods = modules_of(b)[0]
    if not mods or not allowed(b, "function"):
        raise VbaError("Macros are disabled by the macro security setting.")
    out = spawn(wid, {"mode": "udf", "modules": mods, "proc": name, "args": args, "book": blank_book(b)}, UDF_LIMIT)
    if not out.get("ok"):
        raise VbaError(out.get("code") or "#VALUE!")
    return out.get("value")
