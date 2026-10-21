import asyncio
import html
import json
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
    return {"notes": {}, "threads": [], "history": [], "shares": {}}


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


def log_edit(c: dict, user: str, sheet: int, sheet_name: str, row: int, col: int, before: str, after: str) -> None:
    c["history"].append({"t": stamp(), "user": user, "sheet": sheet, "sheetName": sheet_name, "row": row, "col": col, "before": before[:2000], "after": after[:2000]})
    if len(c["history"]) > HISTORY_LIMIT:
        del c["history"][: len(c["history"]) - HISTORY_LIMIT]


def changes(c: dict, sheet: int | None, area: tuple[int, int, int, int] | None, limit: int = 500) -> list[dict]:
    out = []
    for h in reversed(c["history"]):
        if sheet is not None and h["sheet"] != sheet:
            continue
        if area and not (area[0] <= h["row"] <= area[2] and area[1] <= h["col"] <= area[3]):
            continue
        out.append({**h, "ref": f"{col_name(h['col'])}{h['row'] + 1}"})
        if len(out) >= limit:
            break
    return out


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


def render_sheet(title: str, sheet_name: str, values: list, styles: dict[tuple[int, int], str], embed: bool) -> str:
    cells: dict[tuple[int, int], str] = {(r, c): v for r, c, v in values if v != ""}
    rows = max((r for r, _ in cells), default=-1) + 1
    cols = max((c for _, c in cells), default=-1) + 1
    rows, cols = min(max(rows, 1), 2000), min(max(cols, 1), 60)
    head = "<tr><th></th>" + "".join(f"<th>{col_name(c)}</th>" for c in range(cols)) + "</tr>"
    body = []
    for r in range(rows):
        tds = []
        for c in range(cols):
            v = cells.get((r, c), "")
            numeric = v.replace(",", "").replace(".", "", 1).replace("-", "", 1).replace("%", "").replace("$", "").isdigit()
            style = css_of(styles.get((r, c), ""))
            if numeric and "text-align" not in style:
                style += ";text-align:right"
            tds.append(f'<td style="{html.escape(style)}">{html.escape(v)}</td>')
        body.append(f"<tr><th>{r + 1}</th>{''.join(tds)}</tr>")
    banner = "" if embed else f'<header><strong>{html.escape(title)}</strong> <span>{html.escape(sheet_name)} - read-only, published from FormCel</span></header>'
    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            f"<title>{html.escape(title)} - {html.escape(sheet_name)}</title><style>"
            "body{margin:0;font:13px Inter,system-ui,sans-serif;background:#fff;color:#111}header{padding:8px 12px;border-bottom:1px solid #ddd;background:#f6f6f6}"
            "header span{color:#666;margin-left:8px}table{border-collapse:collapse;margin:0}td,th{border:1px solid #e1e1e1;padding:2px 8px;min-width:64px;height:22px;white-space:pre}"
            "th{background:#f3f3f3;font-weight:500;color:#555;position:sticky;top:0}th:first-child{position:sticky;left:0;min-width:32px}"
            "@media(prefers-color-scheme:dark){body{background:#161616;color:#eee}header{background:#222;border-color:#333}td,th{border-color:#333}th{background:#222;color:#aaa}}"
            f"</style></head><body>{banner}<div style=\"overflow:auto\"><table>{head}{''.join(body)}</table></div></body></html>")
