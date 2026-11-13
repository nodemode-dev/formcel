#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = os.environ.get("FORMCEL_PORT", "8199")
DEFAULT_URL = f"http://127.0.0.1:{PORT}/mcp"
URL = os.environ.get("FORMCEL_MCP_URL", DEFAULT_URL)
session = ""
started = False


def read_version():
    try:
        with open(os.path.join(ROOT, "frontend", "package.json"), encoding="utf-8") as f:
            return json.load(f).get("version") or "unknown"
    except (OSError, ValueError):
        return "unknown"


def base():
    return URL.rsplit("/mcp", 1)[0]


def answering():
    try:
        with urllib.request.urlopen(base() + "/api/health", timeout=2) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def start_engine():
    global started
    if started or URL != DEFAULT_URL or os.environ.get("FORMCEL_MCP_AUTOSTART", "1") == "0":
        return False
    backend = os.path.join(ROOT, "backend")
    script = os.path.join(backend, "boot_backend.bat" if os.name == "nt" else "boot_backend")
    if not os.path.isfile(script):
        return False
    started = True
    log = open(os.path.join(tempfile.gettempdir(), "formcel-engine.log"), "ab")
    print(f"[formcel mcp] starting the engine; log: {log.name}", file=sys.stderr, flush=True)
    try:
        subprocess.Popen([script], cwd=backend, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                         start_new_session=(os.name != "nt"), creationflags=(0x208 if os.name == "nt" else 0))
    except OSError as exc:
        print(f"[formcel mcp] the engine could not start: {exc}", file=sys.stderr, flush=True)
        return False
    for _ in range(120):
        time.sleep(0.5)
        if answering():
            return True
    return False


def error_reply(msg, text):
    if msg.get("id") is None:
        return None
    return json.dumps({"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32000, "message": text}})


def forward(line, retry=True):
    global session
    try:
        msg = json.loads(line)
    except ValueError:
        return json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
    if not isinstance(msg, dict):
        msg = {}
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if session:
        headers["Mcp-Session-Id"] = session
    req = urllib.request.Request(URL, data=line.encode("utf-8"), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=660) as r:
            body = r.read().decode("utf-8")
            session = r.headers.get("Mcp-Session-Id") or session
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8") or ""
    except (urllib.error.URLError, OSError) as exc:
        print(f"[formcel mcp] the engine is not answering at {URL}: {exc}", file=sys.stderr, flush=True)
        if retry and start_engine():
            return forward(line, False)
        return error_reply(msg, "The FormCel engine is not running and could not be started: run ./formcel in the FormCel folder, then retry.")
    if msg.get("id") is None:
        return None
    return body.strip() or None


def main():
    global URL
    for stream in (sys.stdin, sys.stdout):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="formcel mcp", description="FormCel over MCP's stdio transport")
    parser.add_argument("--url", help="the engine's /mcp address (default " + DEFAULT_URL + ")")
    parser.add_argument("--where", action="store_true", help="print the launcher, script and URL, then exit")
    parser.add_argument("--version", action="store_true", help="print the version, then exit")
    args = parser.parse_args()
    if args.url:
        URL = args.url
    if args.version:
        print("formcel " + read_version())
        return
    if args.where:
        launcher = os.path.join(ROOT, "formcel.bat" if os.name == "nt" else "formcel")
        print(json.dumps({"launcher": launcher, "script": os.path.abspath(__file__), "url": URL,
                          "claude_desktop": {"mcpServers": {"formcel": {"command": launcher, "args": ["mcp"]}}}}, indent=2))
        return
    for line in sys.stdin:
        if not line.strip():
            continue
        out = forward(line)
        if out:
            sys.stdout.write(out + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
