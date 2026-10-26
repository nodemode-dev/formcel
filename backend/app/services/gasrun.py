import contextvars
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from . import ranges

RUNNER = Path(__file__).with_name("gas_runner.js")
LIMIT = 30
MAX_BYTES = 10 * 1024 * 1024
MAX_CELLS = 600_000
GAS = re.compile(r"\b(SpreadsheetApp|PropertiesService|UrlFetchApp|ScriptApp|Logger\.log|Utilities\.|Session\.)")
FUNC = re.compile(r"(?:^|\n)\s*function\s+([A-Za-z_$][\w$]*)\s*\(")
SIMPLE = ("onOpen", "onEdit", "onChange", "onInstall")

busy = contextvars.ContextVar("fc_script_busy", default=False)


class RunError(Exception):
    pass


def available() -> bool:
    return shutil.which("node") is not None


_PERMISSION: dict[str, str | None] = {}
OLD_NODE = "This Node.js cannot run scripts with file and process access turned off. Install Node.js 22 or later (MIT) so scripts can run."


def locked_down(exe: str, readable: Path | None = None) -> list[str]:
    if exe not in _PERMISSION:
        _PERMISSION[exe] = None
        for flag in ("--permission", "--experimental-permission"):
            try:
                ok = subprocess.run([exe, flag, "-e", "0"], capture_output=True, timeout=10, cwd="/", env={"PATH": "/usr/bin:/bin"}).returncode == 0
            except (OSError, subprocess.SubprocessError):
                ok = False
            if ok:
                _PERMISSION[exe] = flag
                break
    flag = _PERMISSION[exe]
    if flag is None:
        raise RunError(OLD_NODE)
    return [flag] + ([f"--allow-fs-read={readable}"] if readable is not None else [])


def is_gas(s: dict) -> bool:
    code = s.get("code") or ""
    if re.search(r"\bfunction\s+main\s*\(\s*\w+\s*:\s*ExcelScript", code) or "ExcelScript." in code:
        return False
    return bool(GAS.search(code)) or bool(s.get("gas"))


def sources(auto: dict) -> list[dict]:
    return [s for s in auto.get("scripts") or [] if is_gas(s)]


def project(auto: dict) -> str:
    parts = []
    for s in sources(auto):
        js = s.get("js") if isinstance(s.get("js"), str) else s.get("code") or ""
        parts.append(js)
    return "\n;\n".join(parts)


def functions(auto: dict) -> list[str]:
    out = []
    for s in sources(auto):
        for n in FUNC.findall(s.get("code") or ""):
            if n not in out:
                out.append(n)
    return out


def snapshot(b) -> dict:
    with b.lock:
        names = b.sheet_names()
        out = []
        budget = MAX_CELLS
        for i, n in enumerate(names):
            a = ranges.used_area(b.engine, i)
            if a is None:
                out.append({"name": n, "values": [], "formulas": []})
                continue
            area = (0, 0, a[2], a[3])
            budget -= (a[2] + 1) * (a[3] + 1)
            if budget < 0:
                raise RunError("The workbook is too large for a script run (over 600,000 cells).")
            vals = ranges.grid(b.engine, i, area, "typed")
            forms = ranges.grid(b.engine, i, area, "input")
            out.append({
                "name": n,
                "values": [["" if v is None else v for v in row] for row in vals],
                "formulas": [[f if isinstance(f, str) and f.startswith("=") else "" for f in row] for row in forms],
            })
        return {"id": b.id, "title": b.title, "sheets": out}


def private_host(host: str) -> bool:
    if os.environ.get("FORMCEL_ALLOW_PRIVATE_FETCH"):
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return True
    return False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def fetch(msg: dict) -> dict:
    url = msg["url"]
    for _ in range(6):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise RunError("only http and https addresses are fetched")
        if private_host(parts.hostname):
            raise RunError(f"{parts.hostname} is on a private network; scripts can only fetch public addresses")
        data = msg["payload"].encode("utf-8") if msg.get("payload") is not None else None
        headers = {"User-Agent": "FormCel-Script/0.36", **{str(k): str(v) for k, v in (msg.get("headers") or {}).items()}}
        if msg.get("contentType"):
            headers["Content-Type"] = msg["contentType"]
        req = urllib.request.Request(url, data=data, headers=headers, method=msg.get("method", "GET"))
        opener = urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(req, timeout=15) as r:
                body = r.read(MAX_BYTES + 1)
                status, hdrs = r.status, dict(r.headers.items())
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                url = urllib.parse.urljoin(url, e.headers["Location"])
                continue
            body = e.read(MAX_BYTES + 1)
            status, hdrs = e.code, dict(e.headers.items())
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise RunError(f"DNS error or unreachable: {url} ({e})")
        if len(body) > MAX_BYTES:
            raise RunError("the response is over 10 MB")
        return {"status": status, "headers": hdrs, "text": body.decode("utf-8", errors="replace")}
    raise RunError("too many redirects")


def apply_ops(wid: str, ops: list[dict], req: dict) -> None:
    from .store import now, store

    token = busy.set(True)
    try:
        i = 0
        while i < len(ops):
            op = ops[i]
            b = store().book(wid)
            names = b.sheet_names()
            if op["k"] == "edit":
                sheet = op["sheet"]
                cells = []
                while i < len(ops) and ops[i]["k"] == "edit" and ops[i]["sheet"] == sheet:
                    cells.append((ops[i]["r"], ops[i]["c"], ops[i]["raw"]))
                    i += 1
                if sheet in names:
                    store().edit(wid, names.index(sheet), cells, user="script", why="script")
                continue
            i += 1
            req["structural"] = True
            if op["k"] == "sheet":
                if op["name"] not in names:
                    store().add_sheet(wid, op["name"])
                continue
            if op["k"] == "rename" and op["sheet"] in names:
                store().sheet_op(wid, "update", names.index(op["sheet"]), name=op["name"])
                continue
            if op["sheet"] not in names:
                continue
            idx = names.index(op["sheet"])
            top = f"{ranges.col_name(op['c0'])}{op['r0'] + 1}"
            bottom = f"{ranges.col_name(op['c1'])}{op['r1'] + 1}"
            with b.lock:
                if op["k"] == "style":
                    b.engine.set_style(top, bottom, op["patch"], idx)
                elif op["k"] == "format":
                    b.engine.set_format(top, bottom, op["code"], idx)
                elif op["k"] == "sort":
                    b.engine.sort(top, bottom, [tuple(k) for k in op["keys"]], bool(op.get("header")), False, idx)
                b.modified = now()
                store()._write(b)
    finally:
        busy.reset(token)


def run(wid: str, fn: str, args: list | None = None, event: dict | None = None, user: str = "") -> dict:
    from . import gastriggers
    from .store import store

    exe = shutil.which("node")
    if not exe:
        raise RunError("No JavaScript runtime was found on the PATH. Install Node.js (MIT) so scripts can run in the engine process.")
    b = store().book(wid)
    with b.lock:
        auto = b.auto or {}
    js = project(auto)
    if not js.strip():
        raise RunError("This workbook has no Apps Script project. Write a script that uses SpreadsheetApp and run it again.")
    state = gastriggers.state_of(auto)
    req = {
        "js": js,
        "fn": fn,
        "args": args or [],
        "event": event,
        "user": user,
        "tz": "UTC",
        "book": {**snapshot(b), "active": b.sheet_names()[0]},
        "props": {k: dict(state["props"].get(k) or {}) for k in ("script", "user", "document")},
    }
    started = time.time()
    p = subprocess.Popen([exe, *locked_down(exe, RUNNER), "--max-old-space-size=192", str(RUNNER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd="/", env={"PATH": "/usr/bin:/bin:/usr/local/bin:" + os.path.dirname(exe)})
    timer = threading.Timer(LIMIT, p.kill)
    timer.start()
    final: dict | None = None
    try:
        p.stdin.write(json.dumps(req) + "\n")
        p.stdin.flush()
        for line in p.stdout:
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("done"):
                final = msg
                break
            reply: dict = {}
            try:
                reply = handle(wid, msg, req)
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
        final = {"ok": False, "error": f"Exceeded maximum execution time ({LIMIT} seconds)" if ms >= LIMIT * 1000 - 200 else (err[-1][:300] if err else "the script stopped"), "logs": [], "toasts": [], "alerts": [], "menus": []}
    final["ms"] = ms
    if req.get("structural"):
        store().hub.publish(wid, {"type": "reload"}, None)
    return final


def handle(wid: str, msg: dict, req: dict) -> dict:
    from . import gastriggers
    from .store import store

    kind = msg.get("rpc")
    if kind == "apply":
        apply_ops(wid, msg["ops"], req)
        return {"book": snapshot(store().book(wid))}
    if kind == "book":
        return {"book": snapshot(store().book(wid))}
    if kind == "shift":
        b = store().book(wid)
        idx = b.sheet_names().index(msg["sheet"])
        token = busy.set(True)
        try:
            store().shift(wid, idx, msg["rows"], msg["at"], msg["n"], msg["insert"], user="script")
        finally:
            busy.reset(token)
        return {}
    if kind == "deleteSheet":
        b = store().book(wid)
        names = b.sheet_names()
        if msg["sheet"] in names and len(names) > 1:
            store().sheet_op(wid, "delete", names.index(msg["sheet"]))
        return {}
    if kind == "fetch":
        return fetch(msg)
    if kind == "uuid":
        return {"value": str(uuid.uuid4())}
    if kind == "props":
        gastriggers.save_props(wid, msg["scope"], msg["data"])
        return {}
    if kind == "trigger.create":
        return {"id": gastriggers.create(wid, msg["trigger"])["id"]}
    if kind == "trigger.list":
        return {"triggers": gastriggers.listing(wid)}
    if kind == "trigger.delete":
        gastriggers.delete(wid, msg["id"])
        return {}
    raise RunError(f"unknown call {kind}")
