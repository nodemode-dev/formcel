import threading
import time
import uuid
from datetime import datetime

from . import collab as cb
from . import gasrun

MAX_RUNS = 60
FAIL_LIMIT = 5
KINDS = ("time", "open", "edit", "change")
_seen: dict[str, tuple[float, bool]] = {}
_fired: dict[str, float] = {}


def state_of(auto: dict) -> dict:
    st = auto.setdefault("server", {})
    st.setdefault("triggers", [])
    st.setdefault("props", {"script": {}, "user": {}, "document": {}})
    st.setdefault("runs", [])
    st.setdefault("menus", [])
    return st


def mutate(wid: str, fn):
    from .store import store

    b = store().book(wid)
    with b.lock:
        st = state_of(b.auto)
        out = fn(st)
    store().set_automation(wid, b.auto)
    return out


def save_props(wid: str, scope: str, data: dict) -> None:
    if scope not in ("script", "user", "document"):
        return
    mutate(wid, lambda st: st["props"].__setitem__(scope, {str(k): str(v) for k, v in data.items()}))


def listing(wid: str) -> list[dict]:
    from .store import store

    b = store().book(wid)
    with b.lock:
        return [dict(t) for t in state_of(b.auto)["triggers"]]


def create(wid: str, spec: dict, owner: str = "") -> dict:
    from .store import store

    b = store().book(wid)
    with b.lock:
        known = gasrun.functions(b.auto or {})
    fn = str(spec.get("fn") or "")
    if fn not in known:
        raise ValueError(f"No function {fn} in this workbook's scripts. Functions: {', '.join(known) or 'none'}.")
    kind = spec.get("type")
    if kind not in KINDS:
        raise ValueError("The trigger type is time, open, edit or change.")
    t = {"id": uuid.uuid4().hex[:12], "fn": fn, "type": kind, "every": 0, "daily": "", "weekday": "", "enabled": True, "created": time.time(), "owner": owner or str(spec.get("owner") or ""), "last": None, "failures": 0}
    if kind == "time":
        every = int(spec.get("every") or 0)
        daily = str(spec.get("daily") or "")
        if not every and not daily:
            raise ValueError("A time-driven trigger needs a number of minutes or a time of day.")
        if every and not 1 <= every <= 60 * 24 * 7 * 4:
            raise ValueError("Minutes must be between 1 and 40320.")
        if daily and not (len(daily) == 5 and daily[2] == ":" and daily[:2].isdigit() and daily[3:].isdigit() and int(daily[:2]) < 24 and int(daily[3:]) < 60):
            raise ValueError("The time of day is written as HH:MM.")
        t["every"], t["daily"], t["weekday"] = every, daily, str(spec.get("weekday") or "")
    mutate(wid, lambda st: st["triggers"].append(t))
    return t


def delete(wid: str, tid: str) -> None:
    def f(st):
        n = len(st["triggers"])
        st["triggers"][:] = [t for t in st["triggers"] if t["id"] != tid]
        if len(st["triggers"]) == n:
            raise KeyError(tid)

    mutate(wid, f)


def set_enabled(wid: str, tid: str, on: bool) -> dict:
    def f(st):
        for t in st["triggers"]:
            if t["id"] == tid:
                t["enabled"] = on
                if on:
                    t["failures"] = 0
                return dict(t)
        raise KeyError(tid)

    return mutate(wid, f)


def record(wid: str, tid: str | None, fn: str, kind: str, res: dict) -> None:
    from .store import store

    ok = bool(res.get("ok"))
    entry = {"at": time.time(), "fn": fn, "kind": kind, "trigger": tid or "", "ok": ok, "ms": res.get("ms", 0), "error": res.get("error", ""), "line": res.get("line", 0), "log": "\n".join(res.get("logs") or [])[:600]}

    def f(st):
        st["runs"].append(entry)
        del st["runs"][:-MAX_RUNS]
        if kind == "open" and res.get("menus") is not None:
            st["menus"] = res["menus"]
        for t in st["triggers"]:
            if t["id"] == tid:
                t["last"] = {"at": entry["at"], "ok": ok, "ms": entry["ms"], "error": entry["error"]}
                t["failures"] = 0 if ok else t.get("failures", 0) + 1
                if t["failures"] >= FAIL_LIMIT:
                    t["enabled"] = False
                return t.get("owner", "")
        return ""

    owner = mutate(wid, f)
    if not ok:
        b = store().book(wid)
        with b.lock:
            cb.notify(b.collab, owner, "Scripts", "script", f"{fn} failed: {entry['error']}"[:280])


def execute(wid: str, fn: str, kind: str, event: dict | None = None, tid: str | None = None) -> dict:
    try:
        res = gasrun.run(wid, fn, event=event)
    except Exception as e:
        res = {"ok": False, "error": str(e), "logs": [], "ms": 0}
    record(wid, tid, fn, kind, res)
    return res


def matching(auto: dict, kind: str) -> list[tuple[str, str | None]]:
    st = state_of(dict(auto))
    known = gasrun.functions(auto)
    out: list[tuple[str, str | None]] = []
    simple = {"open": "onOpen", "edit": "onEdit", "change": "onChange"}[kind]
    if simple in known:
        out.append((simple, None))
    for t in st["triggers"]:
        if t["type"] == kind and t.get("enabled") and t["fn"] in known and not (t["fn"] == simple and (simple, None) in out):
            out.append((t["fn"], t["id"]))
    return out


def spawn(wid: str, kind: str, event: dict | None) -> None:
    from .store import store

    if gasrun.busy.get() or not gasrun.available():
        return
    try:
        b = store().book(wid)
        with b.lock:
            todo = matching(b.auto or {}, kind)
    except Exception:
        return
    if not todo:
        return

    def work():
        for fn, tid in todo:
            execute(wid, fn, kind, event, tid)

    threading.Thread(target=work, daemon=True).start()


def on_edit(wid: str, sheet: str, cells: list, olds: dict, new_of) -> None:
    if not cells or gasrun.busy.get():
        return
    rows = [c[0] for c in cells]
    cols = [c[1] for c in cells]
    first = cells[0]
    value = new_of(*first)
    event = {"type": "edit", "sheet": sheet, "row": min(rows), "col": min(cols), "rows": max(rows) - min(rows) + 1, "cols": max(cols) - min(cols) + 1, "value": value, "oldValue": olds.get(first) or None}
    spawn(wid, "edit", event)
    spawn(wid, "change", {**event, "type": "change", "changeType": "EDIT"})


def on_change(wid: str, kind: str) -> None:
    from .store import store

    try:
        name = store().book(wid).sheet_names()[0]
    except Exception:
        return
    spawn(wid, "change", {"type": "change", "sheet": name, "row": 0, "col": 0, "changeType": kind})


def opened(wid: str) -> dict:
    from .store import store

    b = store().book(wid)
    with b.lock:
        todo = matching(b.auto or {}, "open")
    ran = []
    for fn, tid in todo:
        res = execute(wid, fn, "open", {"type": "open"}, tid)
        ran.append({"fn": fn, "ok": res.get("ok"), "error": res.get("error", "")})
    with b.lock:
        st = state_of(b.auto)
        return {"menus": st["menus"], "ran": ran}


def due(t: dict, now: float) -> bool:
    if t["type"] != "time" or not t.get("enabled"):
        return False
    last = (t.get("last") or {}).get("at") or _fired.get(t["id"]) or t["created"]
    if t.get("every"):
        return now - last >= t["every"] * 60
    stamp = datetime.fromtimestamp(now)
    if t.get("weekday") and str(stamp.isoweekday()) != t["weekday"] and stamp.strftime("%A").upper() != t["weekday"].upper():
        return False
    hh, mm = t["daily"].split(":")
    return stamp.strftime("%H:%M") >= f"{int(hh):02d}:{mm}" and datetime.fromtimestamp(last).date() != stamp.date()


def tick() -> None:
    from .store import store

    if not gasrun.available():
        return
    now = time.time()
    for p in store().dir.glob("*.fcel"):
        wid = p.stem
        try:
            mtime = p.stat().st_mtime
        except OSError:
            continue
        hit = _seen.get(wid)
        if hit and hit[0] == mtime and not hit[1]:
            continue
        try:
            auto = store()._automation(p)
        except Exception:
            continue
        server = auto.get("server") or {}
        has = any(t.get("type") == "time" and t.get("enabled") for t in server.get("triggers") or [])
        _seen[wid] = (mtime, has)
        if not has:
            continue
        for t in server["triggers"]:
            if due(t, now):
                _fired[t["id"]] = now
                execute(wid, t["fn"], "time", {"type": "time", "at": now, "uid": t["id"]}, t["id"])
