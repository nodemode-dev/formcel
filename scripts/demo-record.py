"""Record the engine's answers that open the three demo workbooks, for the browser demo pages.

Run from the repository root with the engine's Python (the one backend/oc_install sets up):
    python -B scripts/demo-record.py
For each demo it asks a fresh engine, in a temporary data folder, exactly what the window asks when Home opens
that demo (POST /api/workbooks with the demo template, then the workbook and its floating objects) and writes the
answers to demo/assets/workbooks.js, which the three pages share. The id and the two times are left out; the page
fills them in when it opens the demo, as the engine would.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "demo" / "assets" / "workbooks.js"
DEMOS = ("sales", "whatif", "lab")
DROP = ("id", "created", "modified")

sys.dont_write_bytecode = True
os.environ["FORMCEL_DATA_DIR"] = tempfile.mkdtemp(prefix="formcel-demo-record-")
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient

from app.main import app


def answer(r) -> dict:
    if r.status_code not in (200, 201):
        raise SystemExit(f"{r.request.method} {r.request.url.path}: {r.status_code} {r.text[:200]}")
    return {k: v for k, v in r.json().items() if k not in DROP}


def main() -> None:
    books = {}
    with TestClient(app, base_url="http://127.0.0.1") as c:
        for d in DEMOS:
            made = c.post("/api/workbooks", json={"template": f"demo-{d}"})
            wid = made.json()["id"]
            books[d] = {
                "meta": answer(made),
                "doc": answer(c.get(f"/api/workbooks/{wid}")),
                "objects": answer(c.get(f"/api/workbooks/{wid}/objects")),
            }
    body = json.dumps(books, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(f"window.FC_DEMO_BOOKS={body};\n", encoding="ascii")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes, {len(books)} workbooks")


if __name__ == "__main__":
    main()
