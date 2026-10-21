import asyncio
import csv
import html
import io
import json
import re
import secrets
import shutil
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SNAPSHOT_GAP = 300
HISTORY_LIMIT = 20_000
VERSION_LIMIT = 200


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def col_name(c: int) -> str:
    s = ""
    c += 1
    while c:
        c, rem = divmod(c - 1, 26)
        s = chr(65 + rem) + s
    return s


def empty() -> dict:
    return {"notes": {}, "threads": [], "history": [], "shares": {}, "notifications": [], "watch": [], "chat": [], "access": [], "chips": {}}


def fit(c: dict | None) -> dict:
    out = empty()
    out.update({k: v for k, v in (c or {}).items() if k in out})
    return out


def key(sheet: int, row: int, col: int) -> str:
    return f"{sheet}:{row}:{col}"


def set_note(c: dict, sheet: int, row: int, col: int, text: str, author: str) -> None:
    k = key(sheet, row, col)
    if not text.strip():
        c["notes"].pop(k, None)
        return
    c["notes"][k] = {"text": text[:32_000], "author": author, "time": stamp()}


def shift_keys(c: dict, sheet: int, rows: bool, at: int, delta: int) -> None:
    def move(i: int) -> int | None:
        if delta >= 0:
            return i + delta if i >= at else i
        if at <= i < at - delta:
            return None
        return i + delta if i >= at - delta else i

    moved = {}
    for k, v in c["notes"].items():
        s, r, col = (int(x) for x in k.split(":"))
        if s == sheet:
            n = move(r if rows else col)
            if n is None:
                continue
            r, col = (n, col) if rows else (r, n)
        moved[key(s, r, col)] = v
    c["notes"] = moved
    chips = {}
    for k, v in c["chips"].items():
        s, r, col = (int(x) for x in k.split(":"))
        if s == sheet:
            n = move(r if rows else col)
            if n is None:
                continue
            r, col = (n, col) if rows else (r, n)
        chips[key(s, r, col)] = v
    c["chips"] = chips
    keep = []
    for t in c["threads"]:
        if t["sheet"] == sheet:
            n = move(t["row"] if rows else t["col"])
            if n is None:
                continue
            t["row" if rows else "col"] = n
        keep.append(t)
    c["threads"] = keep


def remap_sheets(c: dict, f) -> None:
    notes = {}
    for k, v in c["notes"].items():
        s, r, col = (int(x) for x in k.split(":"))
        n = f(s)
        if n is not None:
            notes[key(n, r, col)] = v
    c["notes"] = notes
    chips = {}
    for k, v in c["chips"].items():
        s, r, col = (int(x) for x in k.split(":"))
        n = f(s)
        if n is not None:
            chips[key(n, r, col)] = v
    c["chips"] = chips
    c["watch"] = [w for w in c["watch"] if f(w["sheet"]) is not None]
    for w in c["watch"]:
        w["sheet"] = f(w["sheet"])
    threads = []
    for t in c["threads"]:
        n = f(t["sheet"])
        if n is not None:
            t["sheet"] = n
            threads.append(t)
    c["threads"] = threads
    for h in c["history"]:
        n = f(h["sheet"])
        h["sheet"] = -1 if n is None else n
    for s in c["shares"].values():
        n = f(s["sheet"])
        if n is None:
            s["revoked"] = True
        else:
            s["sheet"] = n


def mentions(text: str, people: list[str]) -> list[str]:
    found = []
    low = text.lower()
    for p in sorted(people, key=len, reverse=True):
        if p and f"@{p.lower()}" in low and p not in found:
            found.append(p)
    return found


def add_thread(c: dict, sheet: int, row: int, col: int, text: str, author: str) -> dict:
    t = {"id": uuid.uuid4().hex[:10], "sheet": sheet, "row": row, "col": col, "status": "open", "assignee": "",
         "messages": [{"id": uuid.uuid4().hex[:8], "author": author, "time": stamp(), "text": text[:8000]}]}
    c["threads"].append(t)
    return t


def import_thread(c: dict, sheet: int, t: dict) -> None:
    msgs = [{"id": uuid.uuid4().hex[:8], "author": m["author"], "time": m["time"] or stamp(), "text": m["text"][:8000]} for m in t["messages"]]
    if msgs:
        c["threads"].append({"id": uuid.uuid4().hex[:10], "sheet": sheet, "row": t["row"], "col": t["col"], "status": t["status"], "assignee": "", "messages": msgs})


def find_thread(c: dict, tid: str) -> dict:
    for t in c["threads"]:
        if t["id"] == tid:
            return t
    raise KeyError(tid)


def people_of(c: dict) -> list[str]:
    seen: list[str] = []
    for t in c["threads"]:
        for m in t["messages"]:
            if m["author"] and m["author"] not in seen:
                seen.append(m["author"])
        if t["assignee"] and t["assignee"] not in seen:
            seen.append(t["assignee"])
    for n in c["notes"].values():
        if n["author"] and n["author"] not in seen:
            seen.append(n["author"])
    return seen


def log_edit(c: dict, user: str, sheet: int, sheet_name: str, row: int, col: int, before: str, after: str, why: str = "") -> None:
    item = {"t": stamp(), "user": user, "sheet": sheet, "sheetName": sheet_name, "row": row, "col": col, "before": before[:2000], "after": after[:2000]}
    if why:
        item["why"] = why[:200]
    c["history"].append(item)
    if len(c["history"]) > HISTORY_LIMIT:
        del c["history"][: len(c["history"]) - HISTORY_LIMIT]


def log_shift(c: dict, user: str, sheet: int, sheet_name: str, rows: bool, at: int, n: int, insert: bool) -> None:
    unit = "row" if rows else "column"
    where = f"{at + 1}" if rows else col_name(at)
    what = f"Inserted {n} {unit}{'s' if n != 1 else ''} at {unit} {where}" if insert else f"Deleted {n} {unit}{'s' if n != 1 else ''} from {unit} {where}"
    c["history"].append({"t": stamp(), "user": user, "sheet": sheet, "sheetName": sheet_name, "row": at if rows else -1, "col": -1 if rows else at, "kind": "shift", "before": "", "after": "", "why": what})
    if len(c["history"]) > HISTORY_LIMIT:
        del c["history"][: len(c["history"]) - HISTORY_LIMIT]


def when_of(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        d = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def changes(c: dict, sheet: int | None, area: tuple[int, int, int, int] | None, limit: int = 500, user: str | None = None, since: str | None = None, until: str | None = None) -> list[dict]:
    out = []
    lo, hi = when_of(since), when_of(until)
    for h in reversed(c["history"]):
        if sheet is not None and h["sheet"] != sheet:
            continue
        if user and (h.get("user") or "").lower() != user.lower():
            continue
        if lo or hi:
            at = when_of(h.get("t"))
            if at is None or (lo and at < lo) or (hi and at > hi):
                continue
        shifted = h.get("kind") == "shift"
        if area:
            if shifted:
                reach = h["row"] <= area[2] if h["row"] >= 0 else h["col"] <= area[3]
                if not reach:
                    continue
            elif not (area[0] <= h["row"] <= area[2] and area[1] <= h["col"] <= area[3]):
                continue
        ref = (f"Row {h['row'] + 1}" if h["row"] >= 0 else f"Column {col_name(h['col'])}") if shifted else f"{col_name(h['col'])}{h['row'] + 1}"
        out.append({**h, "ref": ref})
        if len(out) >= limit:
            break
    return out


def history_people(c: dict) -> list[str]:
    seen: list[str] = []
    for h in c["history"]:
        u = h.get("user") or ""
        if u and u not in seen:
            seen.append(u)
    return seen


def notify(c: dict, to: str, sender: str, kind: str, text: str, sheet: int = -1, row: int = -1, col: int = -1, thread: str = "") -> None:
    if not to or to.lower() == (sender or "").lower():
        return
    c["notifications"].append({"id": uuid.uuid4().hex[:10], "to": to, "from": sender, "kind": kind, "text": text[:300], "sheet": sheet, "row": row, "col": col, "thread": thread, "time": stamp(), "read": False})
    if len(c["notifications"]) > 2000:
        del c["notifications"][:500]


def notify_thread(c: dict, t: dict, text: str, sender: str, people: list[str], assigned: bool) -> None:
    told = mentions(text, people)
    for p in told:
        notify(c, p, sender, "mention", text, t["sheet"], t["row"], t["col"], t["id"])
    if assigned and t.get("assignee") and t["assignee"] not in told:
        notify(c, t["assignee"], sender, "assign", text, t["sheet"], t["row"], t["col"], t["id"])
    elif assigned and t.get("assignee"):
        notify(c, t["assignee"], sender, "assign", f"Assigned to you: {text}", t["sheet"], t["row"], t["col"], t["id"])
    for m in t["messages"][:-1]:
        a = m.get("author")
        if a and a not in told and a != t.get("assignee"):
            notify(c, a, sender, "reply", text, t["sheet"], t["row"], t["col"], t["id"])
            break


def notify_edit(c: dict, user: str, sheet: int, sheet_name: str, cells: list[tuple[int, int]]) -> list[str]:
    told: list[str] = []
    for w in c["watch"]:
        if w["sheet"] != sheet or w["user"].lower() == (user or "").lower() or w["user"] in told:
            continue
        hit = next(((r, k) for r, k in cells if w["r0"] <= r <= w["r1"] and w["c0"] <= k <= w["c1"]), None)
        if hit:
            notify(c, w["user"], user, "watch", f"{user or 'Someone'} changed {sheet_name}!{col_name(hit[1])}{hit[0] + 1}", sheet, hit[0], hit[1])
            told.append(w["user"])
    return told


def add_watch(c: dict, user: str, sheet: int, r0: int, c0: int, r1: int, c1: int) -> None:
    mine = [w for w in c["watch"] if w["user"] == user and (w["sheet"], w["r0"], w["c0"], w["r1"], w["c1"]) == (sheet, r0, c0, r1, c1)]
    if not mine:
        c["watch"].append({"id": uuid.uuid4().hex[:8], "user": user, "sheet": sheet, "r0": min(r0, r1), "c0": min(c0, c1), "r1": max(r0, r1), "c1": max(c0, c1)})


def chat_add(c: dict, user: str, text: str) -> dict:
    m = {"id": uuid.uuid4().hex[:8], "user": user or "Someone", "time": stamp(), "text": text[:2000]}
    c["chat"].append(m)
    if len(c["chat"]) > 300:
        del c["chat"][:100]
    return m


CHIP_KINDS = ("person", "date", "file", "place")


def set_chip(c: dict, sheet: int, row: int, col: int, kind: str, label: str, value: str) -> None:
    if kind not in CHIP_KINDS:
        raise ValueError("A chip is a person, a date, a file or a place.")
    k = key(sheet, row, col)
    c["chips"].setdefault(k, []).append({"id": uuid.uuid4().hex[:8], "kind": kind, "label": label.strip()[:200] or value[:200], "value": value.strip()[:2000]})
    del c["chips"][k][:-20]


def drop_chip(c: dict, sheet: int, row: int, col: int, cid: str) -> None:
    k = key(sheet, row, col)
    c["chips"][k] = [x for x in c["chips"].get(k, []) if x["id"] != cid]
    if not c["chips"][k]:
        del c["chips"][k]


def log_access(c: dict, token: str, who: str, ip: str, what: str) -> None:
    c["access"].append({"t": stamp(), "token": token, "user": who[:60], "ip": ip[:64], "what": what})
    if len(c["access"]) > 5000:
        del c["access"][:1000]


def activity(c: dict, online: list[dict]) -> dict:
    per: dict[str, dict] = {}
    days: dict[str, int] = {}
    cutoff = datetime.now(timezone.utc).timestamp() - 14 * 86400
    for a in c["access"]:
        p = per.setdefault(a["token"], {"views": 0, "visitors": set(), "last": ""})
        p["views"] += 1
        p["visitors"].add(a["user"] or a["ip"])
        p["last"] = a["t"]
        d = when_of(a["t"])
        if d and d.timestamp() >= cutoff:
            days[a["t"][:10]] = days.get(a["t"][:10], 0) + 1
    links = []
    for tok, s in c["shares"].items():
        p = per.get(tok, {"views": 0, "visitors": set(), "last": ""})
        links.append({"token": tok, "kind": s["kind"], "perm": s.get("perm", "view"), "sheet": s["sheet"], "created": s["created"], "revoked": s["revoked"], "views": p["views"], "visitors": len(p["visitors"]), "last": p["last"]})
    return {"links": links, "recent": list(reversed(c["access"][-60:])), "daily": [{"day": d, "views": days[d]} for d in sorted(days)], "online": online}


class Versions:
    def __init__(self, root: Path):
        self.root = root / "Versions"
        self.guard = threading.Lock()

    def folder(self, wid: str) -> Path:
        return self.root / wid

    def index(self, wid: str) -> list[dict]:
        p = self.folder(wid) / "index.json"
        try:
            return json.loads(p.read_text("utf-8"))
        except (OSError, ValueError):
            return []

    def _save(self, wid: str, items: list[dict]) -> None:
        p = self.folder(wid) / "index.json"
        p.write_text(json.dumps(items, ensure_ascii=False), "utf-8")

    def snapshot(self, wid: str, source: Path, name: str = "", user: str = "", force: bool = False, why: str = "autosave") -> dict | None:
        with self.guard:
            items = self.index(wid)
            if not force and items and time.time() - items[-1]["epoch"] < SNAPSHOT_GAP:
                return None
            self.folder(wid).mkdir(parents=True, exist_ok=True)
            vid = f"{int(time.time() * 1000):x}"
            shutil.copyfile(source, self.folder(wid) / f"{vid}.fcel")
            item = {"id": vid, "time": stamp(), "epoch": time.time(), "name": name, "user": user, "why": why, "size": source.stat().st_size}
            items.append(item)
            for old in items[:-VERSION_LIMIT]:
                (self.folder(wid) / f"{old['id']}.fcel").unlink(missing_ok=True)
            self._save(wid, items[-VERSION_LIMIT:])
            return item

    def find(self, wid: str, vid: str) -> dict:
        for v in self.index(wid):
            if v["id"] == vid:
                return v
        raise KeyError(vid)

    def rename(self, wid: str, vid: str, name: str) -> dict:
        with self.guard:
            items = self.index(wid)
            for v in items:
                if v["id"] == vid:
                    v["name"] = name.strip()[:120]
                    self._save(wid, items)
                    return v
        raise KeyError(vid)

    def path(self, wid: str, vid: str) -> Path:
        self.find(wid, vid)
        return self.folder(wid) / f"{vid}.fcel"

    def preview(self, wid: str, vid: str, sheet: int, rows: int = 60, cols: int = 20) -> dict:
        with zipfile.ZipFile(self.path(wid, vid)) as z:
            doc = json.loads(z.read("workbook.json"))
        sheets = [s["name"] for s in doc["sheets"]]
        sheet = min(max(sheet, 0), len(sheets) - 1)
        grid = [["" for _ in range(cols)] for _ in range(rows)]
        for r, c, v in doc["sheets"][sheet]["cells"]:
            if r < rows and c < cols:
                grid[r][c] = v
        return {"sheets": sheets, "sheet": sheet, "grid": grid}


class Hub:
    def __init__(self):
        self.subs: dict[str, dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Queue, str]]] = {}
        self.cursors: dict[str, dict[str, dict]] = {}
        self.guard = threading.Lock()

    def join(self, wid: str, client: str, user: str, loop: asyncio.AbstractEventLoop) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        with self.guard:
            self.subs.setdefault(wid, {})[client] = (loop, q, user)
        self.publish(wid, {"type": "join", "client": client, "user": user}, client)
        return q

    def leave(self, wid: str, client: str) -> None:
        with self.guard:
            self.subs.get(wid, {}).pop(client, None)
            self.cursors.get(wid, {}).pop(client, None)
        self.publish(wid, {"type": "leave", "client": client}, client)

    def people(self, wid: str) -> list[dict]:
        with self.guard:
            return [{"client": c, "user": u, **self.cursors.get(wid, {}).get(c, {})} for c, (_, _, u) in self.subs.get(wid, {}).items()]

    def cursor(self, wid: str, client: str, data: dict) -> None:
        with self.guard:
            self.cursors.setdefault(wid, {})[client] = data

    def publish(self, wid: str, event: dict, origin: str | None) -> None:
        with self.guard:
            targets = [(loop, q) for c, (loop, q, _) in self.subs.get(wid, {}).items() if c != origin]
        for loop, q in targets:
            def put(q=q):
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    pass
            loop.call_soon_threadsafe(put)


def token() -> str:
    return secrets.token_urlsafe(18)


def css_of(tokens: str) -> str:
    out = []
    for t in tokens.split(";"):
        if t == "b":
            out.append("font-weight:700")
        elif t == "i":
            out.append("font-style:italic")
        elif t == "u":
            out.append("text-decoration:underline")
        elif t.startswith("fc:") and len(t) == 9 and not t.startswith("fc:t:"):
            out.append(f"color:#{t[3:]}")
        elif t.startswith("bg:") and len(t) == 9 and not t.startswith("bg:t:"):
            out.append(f"background:#{t[3:]}")
        elif t in ("ha:left", "ha:center", "ha:right"):
            out.append(f"text-align:{t[3:]}")
    return ";".join(out)


def render_sheet(title: str, sheet_name: str, values: list, styles: dict[tuple[int, int], str], embed: bool, gridlines: bool = True, headers: bool = True, area: tuple[int, int, int, int] | None = None, sheets: list[str] | None = None, current: int = 0) -> str:
    cells: dict[tuple[int, int], str] = {(r, c): v for r, c, v in values if v != ""}
    rows = max((r for r, _ in cells), default=-1) + 1
    cols = max((c for _, c in cells), default=-1) + 1
    rows, cols = min(max(rows, 1), 2000), min(max(cols, 1), 60)
    r_lo, c_lo = 0, 0
    if area:
        r_lo, c_lo, rows, cols = area[0], area[1], min(area[2] + 1, 2000), min(area[3] + 1, 200)
    head = "<tr><th></th>" + "".join(f"<th>{col_name(c)}</th>" for c in range(c_lo, cols)) + "</tr>" if headers else ""
    body = []
    for r in range(r_lo, rows):
        tds = []
        for c in range(c_lo, cols):
            v = cells.get((r, c), "")
            numeric = v.replace(",", "").replace(".", "", 1).replace("-", "", 1).replace("%", "").replace("$", "").isdigit()
            style = css_of(styles.get((r, c), ""))
            if numeric and "text-align" not in style:
                style += ";text-align:right"
            tds.append(f'<td style="{html.escape(style)}">{html.escape(v)}</td>')
        body.append(f"<tr>{f'<th>{r + 1}</th>' if headers else ''}{''.join(tds)}</tr>")
    tabs = "".join(f'<a href="?sheet={i}{"&embed=1" if embed else ""}"{" aria-current=page" if i == current else ""}>{html.escape(n)}</a>' for i, n in enumerate(sheets or [])) if sheets and len(sheets) > 1 else ""
    banner = "" if embed else f'<header><strong>{html.escape(title)}</strong> <span>{html.escape(sheet_name)} - read-only, published from FormCel</span></header>'
    lines = "" if gridlines else "td,th{border-color:transparent!important}"
    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            f"<title>{html.escape(title)} - {html.escape(sheet_name)}</title><style>"
            "body{margin:0;font:13px Inter,system-ui,sans-serif;background:#fff;color:#111}header{padding:8px 12px;border-bottom:1px solid #ddd;background:#f6f6f6}"
            "header span{color:#666;margin-left:8px}table{border-collapse:collapse;margin:0}td,th{border:1px solid #e1e1e1;padding:2px 8px;min-width:64px;height:22px;white-space:pre}"
            "th{background:#f3f3f3;font-weight:500;color:#555;position:sticky;top:0}th:first-child{position:sticky;left:0;min-width:32px}"
            "@media(prefers-color-scheme:dark){body{background:#161616;color:#eee}header{background:#222;border-color:#333}td,th{border-color:#333}th{background:#222;color:#aaa}}"
            "nav{display:flex;gap:4px;padding:4px 8px;background:#f6f6f6;border-bottom:1px solid #ddd}nav a{padding:3px 10px;color:inherit;text-decoration:none;border-radius:4px}nav a[aria-current]{background:#e4e4e4;font-weight:600}"
            f"{lines}</style></head><body>{banner}{f'<nav>{tabs}</nav>' if tabs else ''}<div style=\"overflow:auto\"><table>{head}{''.join(body)}</table></div></body></html>")


def csv_of(values: list, area: tuple[int, int, int, int] | None = None) -> str:
    cells = {(r, c): v for r, c, v in values if v != ""}
    r0, c0, r1, c1 = area if area else (0, 0, max((r for r, _ in cells), default=-1), max((c for _, c in cells), default=-1))
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    for r in range(r0, r1 + 1):
        w.writerow([cells.get((r, c), "") for c in range(c0, c1 + 1)])
    return out.getvalue()


def area_of(text: str) -> tuple[int, int, int, int] | None:
    m = re.fullmatch(r"\s*\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?\s*", text or "")
    if not m:
        return None

    def col(s: str) -> int:
        n = 0
        for ch in s.upper():
            n = n * 26 + ord(ch) - 64
        return n - 1

    r0, c0 = int(m.group(2)) - 1, col(m.group(1))
    r1, c1 = (int(m.group(4)) - 1, col(m.group(3))) if m.group(3) else (r0, c0)
    if min(r0, c0, r1, c1) < 0:
        return None
    return min(r0, r1), min(c0, c1), max(r0, r1), max(c0, c1)
