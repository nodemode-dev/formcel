import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from . import aiclient

TIMEOUT = 8
MAX_CODE = 8000

CHILD = Path(__file__).with_name("pyrun_child.py")
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
    mods = ["math", "statistics", "re", "json", "datetime", "itertools", "functools", "collections", "random", "string", "decimal", "fractions", "operator", "textwrap", "calendar"]
    pandas = pandas_ready()
    return {"enabled": enabled(), "version": sys.version.split()[0], "modules": mods + (["pandas as pd", "numpy as np"] if pandas else []), "pandas": pandas, "network": "no network (separate network namespace)" if isolated_network() else "no network (blocked in the interpreter)", "limits": f"{TIMEOUT} s, 1.5 GB, no file access, no child processes"}


class PyError(Exception):
    pass


_net: list[bool] = []


def isolated_network() -> bool:
    if not _net:
        exe = shutil.which("unshare")
        ok = False
        if exe:
            try:
                ok = subprocess.run([exe, "-rn", "true"], capture_output=True, timeout=5).returncode == 0
            except (OSError, subprocess.SubprocessError):
                ok = False
        _net.append(ok)
    return _net[0]


def pandas_ready() -> bool:
    return importlib.util.find_spec("pandas") is not None and importlib.util.find_spec("numpy") is not None


def run(code: str, args: list, reader=None, memory: int = 1536) -> dict:
    if len(code) > MAX_CODE:
        raise PyError(f"the code is over {MAX_CODE} characters")
    cmd = [sys.executable, "-I", str(CHILD)]
    if isolated_network():
        cmd = [shutil.which("unshare") or "unshare", "-rn", *cmd]
    refs: list[str] = []
    with tempfile.TemporaryDirectory() as d:
        env = {"PYTHONIOENCODING": "utf-8", "PATH": os.defpath, "HOME": d, "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "NUMEXPR_NUM_THREADS": "1"}
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=d, env=env, start_new_session=True)
        timer = threading.Timer(TIMEOUT, lambda: os.killpg(p.pid, signal.SIGKILL))
        timer.start()
        done: dict | None = None
        try:
            p.stdin.write(json.dumps({"code": code, "args": args, "pandas": pandas_ready(), "memory": memory, "cpu": TIMEOUT + 2}, default=str) + "\n")
            p.stdin.flush()
            for line in p.stdout:
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if "done" in msg:
                    done = msg["done"]
                    break
                reply: dict
                try:
                    if reader is None:
                        raise ValueError("xl() is not available here")
                    refs.append(msg["xl"])
                    reply = reader(msg["xl"])
                except Exception as e:
                    reply = {"error": str(e)}
                p.stdin.write(json.dumps(reply, default=str) + "\n")
                p.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            try:
                p.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
            timer.cancel()
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            p.wait()
        err = (p.stderr.read() or "").strip().splitlines()
    if done is None:
        if p.returncode in (-9, -signal.SIGKILL):
            raise PyError(f"the code ran longer than {TIMEOUT} seconds or used too much memory")
        raise PyError((err[-1] if err else "the code failed")[:300])
    if "error" in done:
        raise PyError(done["error"] + (f" (line {done['line']})" if done.get("line") else ""))
    return {"value": done["value"], "print": done.get("print", []), "refs": refs}
