import asyncio
import re
import time
from datetime import datetime

from . import gastriggers, pquery, qtable, ranges
from .store import store

TICK = 15
_last: dict[tuple[str, str], float] = {}
_day: dict[tuple[str, str], str] = {}


def target_cells(q: dict, rows: list[list[str]], names: list[str]) -> tuple[int, list[tuple[int, int, str]], dict]:
    t = q.get("target") or {}
    sheet = names.index(t["sheet"]) if t.get("sheet") in names else 0
    r0, c0 = ranges.parse_cell(t.get("cell") or "A1")
    h = len(rows)
    w = max((len(r) for r in rows), default=0)
    old = q.get("last") or {}
    cells = [(r0 + r, c0 + c, v) for r, row in enumerate(rows) for c, v in enumerate(row)]
    for r in range(max(old.get("rows", 0), h)):
        for c in range(max(old.get("cols", 0), w)):
            if r >= h or c >= w:
                cells.append((r0 + r, c0 + c, ""))
    return sheet, cells, {"rows": h, "cols": w}


def refresh(wid: str, qid: str) -> dict:
    b = store().book(wid)
    with b.lock:
        q = next((x for x in (b.auto.get("queries") or []) if x.get("id") == qid), None)
    if q is None:
        raise KeyError(qid)
    with b.lock:
        library = {x["id"]: x for x in (b.auto.get("queries") or []) if x.get("id")}
    result = pquery.run(q, store().book, True, library)
    with b.lock:
        sheet, cells, last = target_cells(q, result["rows"], b.sheet_names())
    store().edit(wid, sheet, cells)
    with b.lock:
        if q.get("asTable"):
            r0, c0 = ranges.parse_cell((q.get("target") or {}).get("cell") or "A1")
            try:
                q["tableName"] = qtable.fit_table(b.engine, sheet, r0, c0, last["rows"], last["cols"], q.get("tableName"), result["rows"][0] if result["rows"] else None)
            except ValueError:
                pass
            q["tabled"] = bool(q.get("tableName"))
        q["last"] = last
        q["refreshed"] = time.time()
    store().set_automation(wid, b.auto)
    return {"rows": len(result["rows"]), "target": q.get("target")}


def due() -> list[tuple[str, str]]:
    out = []
    now = time.time()
    for p in store().dir.glob("*.fcel"):
        try:
            auto = store()._automation(p)
        except Exception:
            continue
        for q in auto.get("queries") or []:
            daily = str(q.get("daily") or "")
            if q.get("id") and re.fullmatch(r"\d{1,2}:\d{2}", daily):
                k = (p.stem, q["id"])
                stamp = f"{datetime.now():%Y-%m-%d}"
                if _day.get(k) != stamp and f"{datetime.now():%H:%M}" >= daily.zfill(5):
                    first = k not in _day
                    _day[k] = stamp
                    if not first or (q.get("refreshed") or 0) < time.time() - 3600:
                        out.append(k)
                continue
            every = q.get("every") or 0
            if every and every > 0 and q.get("id"):
                k = (p.stem, q["id"])
                if k not in _last:
                    _last[k] = now
                elif now - _last[k] >= every * 60:
                    _last[k] = now
                    out.append(k)
    return out


def tick() -> None:
    for wid, qid in due():
        try:
            refresh(wid, qid)
        except Exception:
            continue
    try:
        gastriggers.tick()
    except Exception:
        return


async def loop() -> None:
    while True:
        await asyncio.sleep(TICK)
        await asyncio.to_thread(tick)
