import re
import statistics
from datetime import date

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
NUM_US = re.compile(r"^[+-]?\(?[$€£¥]?\s?\d{1,3}(,\d{3})+(\.\d+)?\)?%?$|^[+-]?\(?[$€£¥]?\s?\d+(\.\d+)?\)?%?$|^[+-]?\(?[$€£¥]?\s?\.\d+\)?%?$")
NUM_EU = re.compile(r"^[+-]?\(?[$€£¥]?\s?\d{1,3}(\.\d{3})+(,\d+)?\)?%?$|^[+-]?\(?[$€£¥]?\s?\d+,\d+\)?%?$|^[+-]?\(?\d+\)?%?$")
CONFUSE = str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1", "|": "1", "S": "5", "B": "8", "Z": "2", "z": "2", "s": "5"})
SYMBOLS = "$€£¥"


def median(xs: list[float], default: float = 10.0) -> float:
    return statistics.median(xs) if xs else default


def cluster_lines(ws: list[dict]) -> list[list[dict]]:
    h = median([w["h"] for w in ws])
    out: list[list[dict]] = []
    for w in sorted(ws, key=lambda w: w["y"] + w["h"] / 2):
        cy = w["y"] + w["h"] / 2
        if out:
            cur = out[-1]
            mean = sum(x["y"] + x["h"] / 2 for x in cur) / len(cur)
            if abs(cy - mean) <= 0.55 * h:
                cur.append(w)
                continue
        out.append([w])
    for line in out:
        line.sort(key=lambda w: w["x"])
    return out


def phrases(line: list[dict], gap: float) -> list[dict]:
    out: list[dict] = []
    for w in line:
        if out and w["x"] - out[-1]["x1"] <= gap:
            p = out[-1]
            p["text"] += " " + w["text"]
            p["x1"] = max(p["x1"], w["x"] + w["w"])
            p["conf"].append(w["conf"])
        else:
            out.append({"text": w["text"], "x0": w["x"], "x1": w["x"] + w["w"], "conf": [w["conf"]]})
    return out


def boundaries(rows: list[list[dict]], min_gap: float, lo: float, hi: float) -> list[float]:
    useful = [r for r in rows if len(r) >= 2]
    if not useful:
        return []
    n = len(useful)
    tol = 1 if n >= 4 else 0
    width = int(hi - lo) + 2
    diff = [0] * (width + 1)
    for r in useful:
        for p in r:
            a = max(0, int(p["x0"] - lo))
            b = min(width - 1, int(p["x1"] - lo))
            diff[a] += 1
            diff[b + 1] -= 1
    occ, run = [], 0
    for i in range(width):
        run += diff[i]
        occ.append(run)
    cuts: list[float] = []
    i = 0
    while i < width:
        if occ[i] <= tol:
            j = i
            while j < width and occ[j] <= tol:
                j += 1
            if j - i >= min_gap and i > 0 and j < width:
                best, k = (i, j), i
                zeros = []
                while k < j:
                    if occ[k] == 0:
                        e = k
                        while e < j and occ[e] == 0:
                            e += 1
                        if e - k >= min_gap:
                            zeros.append((k, e))
                        k = e
                    else:
                        k += 1
                if len(zeros) == 1:
                    best = zeros[0]
                cuts.append(lo + (best[0] + best[1]) / 2)
            i = j
        else:
            i += 1
    return cuts


def column_of(x: float, cuts: list[float]) -> int:
    k = 0
    for c in cuts:
        if x >= c:
            k += 1
    return k


def classify(s: str, eu: bool = False) -> tuple[str, str]:
    t = s.strip()
    if not t:
        return "empty", ""
    d = parse_date(t)
    if d:
        return "date", d
    pat = NUM_EU if eu else NUM_US
    if pat.match(t):
        neg = t.startswith("(") and t.endswith(")") or t.startswith("-") or t.startswith("(")
        core = re.sub(r"[()+\-$€£¥\s]", "", t)
        pct = core.endswith("%")
        core = core.rstrip("%")
        core = core.replace(".", "").replace(",", ".") if eu else core.replace(",", "")
        try:
            float(core)
        except ValueError:
            return "text", t
        sym = next((c for c in SYMBOLS if c in t), "")
        text = ("-" if neg else "") + sym + core + ("%" if pct else "")
        return ("percent" if pct else "currency" if sym else "number"), text
    return "text", t


def parse_date(t: str) -> str | None:
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", t)
    if m:
        return iso(int(m[1]), int(m[2]), int(m[3]))
    m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", t)
    if m:
        a, b, y = int(m[1]), int(m[2]), int(m[3])
        y = y + 2000 if y < 100 else y
        if a > 12 and b <= 12:
            return iso(y, b, a)
        return iso(y, a, b)
    m = re.fullmatch(r"([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})", t)
    if m and m[1][:3].lower() in MONTHS:
        return iso(int(m[3]), MONTHS[m[1][:3].lower()], int(m[2]))
    m = re.fullmatch(r"(\d{1,2})[\s-]([A-Za-z]{3,9})\.?,?[\s-](\d{2,4})", t)
    if m and m[2][:3].lower() in MONTHS:
        y = int(m[3])
        return iso(y + 2000 if y < 100 else y, MONTHS[m[2][:3].lower()], int(m[1]))
    return None


def iso(y: int, m: int, d: int) -> str | None:
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def fix_digits(s: str) -> str | None:
    t = s.strip()
    if not t or len(t) > 18:
        return None
    digits = sum(ch.isdigit() for ch in t)
    if digits == 0 or digits < len(re.sub(r"[^A-Za-z0-9|]", "", t)) / 2:
        return None
    if not any(ch in "OolI|SBZzs" for ch in t):
        return None
    out = t.translate(CONFUSE)
    return out if NUM_US.match(out) else None


def build(ws: list[dict], vlines: list[float] | None = None) -> dict:
    h = median([w["h"] for w in ws])
    lines = cluster_lines(ws)
    gap = 0.9 * h
    rows = [phrases(l, gap) for l in lines]
    lo = min(w["x"] for w in ws)
    hi = max(w["x"] + w["w"] for w in ws)
    cuts = boundaries(rows, max(5.0, 0.6 * h), lo, hi)
    ruled = [x for x in (vlines or []) if lo < x < hi]
    if ruled:
        cuts = sorted(ruled)
    ncol = len(cuts) + 1
    grid: list[list[dict]] = []
    merges: list[dict] = []
    for r in rows:
        cells = [{"parts": [], "conf": []} for _ in range(ncol)]
        for p in r:
            m = 2
            inner = [k for k, c in enumerate(cuts) if p["x0"] < c - m and p["x1"] > c + m]
            c0 = column_of(p["x0"], cuts) if not inner else inner[0]
            if inner:
                c1 = inner[-1] + 1
                merges.append({"row": len(grid), "c0": c0, "c1": c1})
            else:
                c0 = column_of((p["x0"] + p["x1"]) / 2, cuts)
            cells[c0]["parts"].append(p["text"])
            cells[c0]["conf"].extend(p["conf"])
        grid.append(cells)
    keep = [c for c in range(ncol) if any(g[c]["parts"] for g in grid)]
    remap = {c: i for i, c in enumerate(keep)}
    grid = [[g[c] for c in keep] for g in grid]
    merges = [{"row": m["row"], "c0": remap.get(m["c0"], 0), "c1": max(remap.get(m["c0"], 0), max((remap[c] for c in range(m["c0"], m["c1"] + 1) if c in remap), default=0))} for m in merges]
    merges = [m for m in merges if m["c1"] > m["c0"]]
    width = len(keep)
    texts = [[" ".join(c["parts"]) for c in row] for row in grid]
    eu = False
    sample = [t for row in texts for t in row if t]
    if sample:
        eu_hits = sum(1 for t in sample if NUM_EU.match(t.strip()) and not NUM_US.match(t.strip()))
        us_hits = sum(1 for t in sample if NUM_US.match(t.strip()) and not NUM_EU.match(t.strip()))
        eu = eu_hits > us_hits
    kinds: list[str] = []
    for c in range(width):
        body = [classify(texts[r][c], eu) for r in range(len(texts)) if texts[r][c] and not any(m["row"] == r for m in merges)]
        body = body[1:] if len(body) > 2 else body
        votes = [k for k, _ in body if k != "empty"]
        if not votes:
            kinds.append("text")
            continue
        counts = {k: votes.count(k) for k in set(votes)}
        best = max(counts, key=counts.get)
        numeric = counts.get("number", 0) + counts.get("currency", 0) + counts.get("percent", 0)
        if best == "date" and counts["date"] / len(votes) >= 0.6:
            kinds.append("date")
        elif numeric / len(votes) >= 0.6:
            kinds.append("currency" if counts.get("currency", 0) >= numeric / 2 else "percent" if counts.get("percent", 0) >= numeric / 2 else "number")
        else:
            kinds.append("text")
    fixed_cells = 0
    out_cells: list[list[dict]] = []
    for r, row in enumerate(texts):
        line = []
        merged_row = any(m["row"] == r for m in merges)
        for c, t in enumerate(row):
            conf = grid[r][c]["conf"]
            cell = {"v": t, "kind": "text", "conf": round(sum(conf) / len(conf), 1) if conf else 0, "fixed": False}
            if t and not merged_row:
                kind, val = classify(t, eu)
                if kinds[c] in ("number", "currency", "percent") and kind == "text":
                    alt = fix_digits(t)
                    if alt:
                        kind, val = classify(alt, eu)
                        if kind != "text":
                            cell["fixed"] = True
                            fixed_cells += 1
                if kinds[c] == "date" and kind != "date" and kind != "text":
                    kind, val = "text", t
                if kind == "date" and kinds[c] != "date":
                    kind, val = "text", t
                if kind in ("number", "currency", "percent") and kinds[c] not in ("number", "currency", "percent"):
                    kind, val = "text", t
                cell["kind"], cell["v"] = kind, val
            line.append(cell)
        out_cells.append(line)
    header = True
    if out_cells:
        typed = [c for c in range(width) if kinds[c] != "text"]
        if typed:
            header = sum(1 for c in typed if out_cells[0][c]["kind"] == "text") >= max(1, len(typed) // 2 + len(typed) % 2) and len(out_cells) > 1
        else:
            header = len(out_cells) > 1
    return {"cells": out_cells, "merges": merges, "columns": [{"kind": k} for k in kinds], "header": header, "fixed": fixed_cells, "euNumbers": eu, "cuts": [round(c) for c in cuts]}
