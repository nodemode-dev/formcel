#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = f"http://127.0.0.1:{os.environ.get('FORMCEL_PORT', '8199')}/api/commands"
USAGE = "usage: ./formcel cli list [text] | describe <id> | run <id> [key=value ...]"


def value(raw: str):
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def get(url: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"} if data else {}, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8") or "{}").get("detail", str(exc))
        except ValueError:
            detail = str(exc)
        raise SystemExit(f"[formcel] {detail}")
    except urllib.error.URLError:
        raise SystemExit("[formcel] the engine is not running. Start it with ./formcel, then retry.")
    except ValueError:
        raise SystemExit(f"[formcel] the reply from {url} is not JSON; check that FORMCEL_PORT names the FormCel engine.")


def main(argv: list[str]) -> None:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(USAGE)
        return
    cmd, rest = argv[0], argv[1:]
    if cmd == "list":
        out = get(BASE + "?" + urllib.parse.urlencode({"text": " ".join(rest)}))
        if out.get("hint"):
            print(f"[formcel] {out['hint']}")
        width = max((len(c["id"]) for c in out["commands"]), default=0)
        for c in out["commands"]:
            print(f"{c['id']:<{width}}  {c.get('title', '')}")
        print(f"{out.get('shown', len(out['commands']))} of {out.get('count', 0)} commands")
    elif cmd == "describe" and rest:
        print(json.dumps(get(f"{BASE}/{urllib.parse.quote(rest[0])}"), indent=2))
    elif cmd == "run" and rest:
        params = {k: value(v) for k, _, v in (a.partition("=") for a in rest[1:]) if k}
        out = get(f"{BASE}/{urllib.parse.quote(rest[0])}", {"params": params})
        print(json.dumps(out.get("result") if out.get("ok") else out, indent=2))
        if not out.get("ok"):
            raise SystemExit(1)
    else:
        raise SystemExit(USAGE)


if __name__ == "__main__":
    main(sys.argv[1:])
