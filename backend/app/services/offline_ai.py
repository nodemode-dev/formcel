import re
from collections import Counter

from . import ranges

NUM_TEXT = re.compile(r"^\s*[-+(]?\s*[$€£¥]?\s*[-+]?\d[\d,]*(\.\d+)?\s*%?\s*\)?\s*$")
DATE_FORMS = [
    (re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$"), "mdy"),
    (re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$"), "ymd"),
    (re.compile(r"^(\d{4})/(\d{1,2})/(\d{1,2})$"), "ymd"),
    (re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$"), "dmy"),
]


def is_blank(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def text_to_number(s: str):
    if not NUM_TEXT.match(s):
        return None
    neg = s.strip().startswith("(") or "-" in s
    pct = s.strip().rstrip(")").endswith("%")
    t = re.sub(r"[^\d.]", "", s)
    if not t or t.count(".") > 1:
        return None
    n = float(t)
    n = -n if neg else n
    return n / 100 if pct else n


def fmt(n: float) -> str:
    return str(int(n)) if float(n).is_integer() and abs(n) < 1e15 else repr(n)


def parse_date(s: str, order: str):
    for rx, form in DATE_FORMS:
        m = rx.match(s.strip())
        if not m:
            continue
        a, b, c = (int(x) for x in m.groups())
        if form == "ymd":
            y, mo, d = a, b, c
        elif form == "dmy":
            d, mo, y = a, b, c
        elif order == "dmy":
            d, mo, y = a, b, c
        else:
            mo, d, y = a, b, c
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    return None


def suggestions(rows: list[list], header: bool = True, dated: frozenset = frozenset()) -> list[dict]:
    out: list[dict] = []
    if not rows:
        return out
    head = [str(v) if not is_blank(v) else f"Column {i + 1}" for i, v in enumerate(rows[0])] if header else [f"Column {i + 1}" for i in range(len(rows[0]))]
    body_at = 1 if header else 0
    body = rows[body_at:]
    ncol = len(head)

    def sug(kind: str, label: str, col: int | None, edits: list[list]):
        out.append({"id": f"s{len(out) + 1}", "kind": kind, "label": label, "column": None if col is None else head[col], "count": len(edits), "edits": edits})

    for c in range(ncol):
        cells = [(body_at + r, row[c] if c < len(row) else None) for r, row in enumerate(body)]
        strs = [(r, v) for r, v in cells if isinstance(v, str) and v.strip() != ""]
        trim = [[r, c, re.sub(r"\s+", " ", v).strip()] for r, v in strs if re.sub(r"\s+", " ", v).strip() != v]
        if trim:
            sug("trim", f"Trim extra spaces in {head[c]}", c, trim)
        hidden = [[r, c, "".join(ch for ch in v if ch.isprintable())] for r, v in strs if any(not ch.isprintable() for ch in v)]
        if hidden:
            sug("clean", f"Remove non-printing characters in {head[c]}", c, hidden)
        groups: dict[str, Counter] = {}
        for r, v in strs:
            groups.setdefault(re.sub(r"\s+", " ", v).strip().lower(), Counter())[re.sub(r"\s+", " ", v).strip()] += 1
        case = []
        for key, cnt in groups.items():
            if len(cnt) > 1:
                best = cnt.most_common(1)[0][0]
                for r, v in strs:
                    nv = re.sub(r"\s+", " ", v).strip()
                    if nv.lower() == key and nv != best:
                        case.append([r, c, best])
        if case:
            sug("case", f"Make spelling and case consistent in {head[c]}", c, case)
        nums = [(r, text_to_number(v)) for r, v in strs]
        conv = [(r, n) for r, n in nums if n is not None]
        real = [v for _, v in cells if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if conv and len(conv) >= max(1, (len(conv) + len(real)) // 2) and len(conv) + len(real) >= len(strs):
            sug("numbers", f"Turn text into numbers in {head[c]}", c, [[r, c, fmt(n)] for r, n in conv])
        orders = Counter()
        found = []
        for r, v in strs:
            if (r, c) in dated:
                continue
            for rx, form in DATE_FORMS:
                m = rx.match(v.strip())
                if m:
                    found.append((r, v))
                    if form == "mdy" and int(m.group(1)) > 12:
                        orders["dmy"] += 1
                    elif form == "mdy" and int(m.group(2)) > 12:
                        orders["mdy"] += 1
                    break
        if found and len(found) >= len(strs) * 0.6:
            order = orders.most_common(1)[0][0] if orders else "mdy"
            edits = []
            for r, v in found:
                d = parse_date(v, order)
                if d and d != v.strip():
                    edits.append([r, c, d])
            if edits:
                sug("dates", f"Write dates in {head[c]} as year-month-day", c, edits)
    seen: dict[tuple, int] = {}
    dup_rows = []
    for r, row in enumerate(body):
        key = tuple(re.sub(r"\s+", " ", str(v)).strip().lower() if not is_blank(v) else "" for v in row)
        if not any(key):
            continue
        if key in seen:
            dup_rows.append(body_at + r)
        else:
            seen[key] = r
    if dup_rows:
        drop = set(dup_rows)
        kept = [row for r, row in enumerate(rows) if r not in drop]
        edits = []
        for r in range(len(rows)):
            for c in range(ncol):
                new = kept[r][c] if r < len(kept) and c < len(kept[r]) else None
                old = rows[r][c] if c < len(rows[r]) else None
                if (r >= len(kept) or new != old) and not (is_blank(new) and is_blank(old)):
                    edits.append([r, c, "" if is_blank(new) else str(new)])
        sug("duplicates", f"Remove {len(dup_rows)} duplicate row{'s' if len(dup_rows) != 1 else ''}", None, edits)
    blank_rows = [body_at + r for r, row in enumerate(body) if all(is_blank(v) for v in row)]
    inner = [r for r in blank_rows if r < len(rows) - 1 and any(not is_blank(v) for rr in rows[r + 1:] for v in rr)]
    if inner:
        drop = set(inner)
        kept = [row for r, row in enumerate(rows) if r not in drop]
        edits = []
        for r in range(len(rows)):
            for c in range(ncol):
                new = kept[r][c] if r < len(kept) and c < len(kept[r]) else None
                old = rows[r][c] if c < len(rows[r]) else None
                if (r >= len(kept) or new != old) and not (is_blank(new) and is_blank(old)):
                    edits.append([r, c, "" if is_blank(new) else str(new)])
        sug("blank_rows", f"Close {len(inner)} blank row{'s' if len(inner) != 1 else ''}", None, edits)
    return out


CHART_WORDS = [
    ("doughnut", "doughnut"), ("donut", "doughnut"), ("pie", "pie"), ("stacked column", "column-stacked"), ("stacked bar", "bar-stacked"),
    ("scatter", "scatter"), ("histogram", "histogram"), ("waterfall", "waterfall"), ("funnel", "funnel"), ("radar", "radar"),
    ("area", "area"), ("line", "line"), ("trend", "line"), ("over time", "line"), ("bar", "bar"), ("column", "column"),
]


def pick_chart(prompt: str) -> str:
    p = prompt.lower()
    for w, t in CHART_WORDS:
        if w in p:
            return t
    return "column"


TEMPLATES = {
    "budget": [["Category", "Planned", "Actual", "Difference"], ["Rent", 1200, 1200, "=C2-B2"], ["Food", 450, 510, "=C3-B3"], ["Transport", 120, 95, "=C4-B4"], ["Utilities", 160, 172, "=C5-B5"], ["Savings", 300, 300, "=C6-B6"], ["Total", "=SUM(B2:B6)", "=SUM(C2:C6)", "=SUM(D2:D6)"]],
    "invoice": [["Item", "Qty", "Unit price", "Amount"], ["Design work", 10, 85, "=B2*C2"], ["Hosting", 12, 20, "=B3*C3"], ["Support", 5, 60, "=B4*C4"], ["", "", "Subtotal", "=SUM(D2:D4)"], ["", "", "Tax 10%", "=D5*0.1"], ["", "", "Total", "=D5+D6"]],
    "timesheet": [["Day", "Start", "End", "Hours"], ["Mon", "9:00", "17:30", "=(C2-B2)*24"], ["Tue", "9:00", "17:00", "=(C3-B3)*24"], ["Wed", "8:30", "16:30", "=(C4-B4)*24"], ["Thu", "9:00", "17:00", "=(C5-B5)*24"], ["Fri", "9:00", "15:00", "=(C6-B6)*24"], ["Total", "", "", "=SUM(D2:D6)"]],
    "gradebook": [["Student", "Test 1", "Test 2", "Final", "Average"], ["Ann", 88, 92, 90, "=AVERAGE(B2:D2)"], ["Bob", 75, 80, 78, "=AVERAGE(B3:D3)"], ["Cy", 93, 85, 91, "=AVERAGE(B4:D4)"], ["Class average", "=AVERAGE(B2:B4)", "=AVERAGE(C2:C4)", "=AVERAGE(D2:D4)", "=AVERAGE(E2:E4)"]],
    "inventory": [["SKU", "Item", "On hand", "Reorder at", "Status"], ["A-100", "Widget", 40, 25, '=IF(C2<=D2,"Reorder","OK")'], ["A-200", "Gadget", 12, 20, '=IF(C3<=D3,"Reorder","OK")'], ["B-300", "Gizmo", 75, 30, '=IF(C4<=D4,"Reorder","OK")']],
    "tracker": [["Task", "Owner", "Due", "Status"], ["Draft plan", "Ann", "", "Open"], ["Review", "Bob", "", "Open"], ["Ship", "Cy", "", "Open"]],
    "schedule": [["Time", "Mon", "Tue", "Wed", "Thu", "Fri"], ["9:00", "", "", "", "", ""], ["10:00", "", "", "", "", ""], ["11:00", "", "", "", "", ""], ["13:00", "", "", "", "", ""], ["15:00", "", "", "", "", ""]],
    "loan": [["Loan amount", 200000], ["Annual rate", 0.06], ["Years", 30], ["Monthly payment", "=-PMT(B2/12,B3*12,B1)"], ["Total paid", "=B4*B3*12"], ["Total interest", "=B5-B1"]],
}
TEMPLATE_WORDS = {"budget": "budget", "expense": "budget", "invoice": "invoice", "bill": "invoice", "timesheet": "timesheet", "time sheet": "timesheet", "hours": "timesheet", "grade": "gradebook", "student": "gradebook", "inventory": "inventory", "stock": "inventory", "tracker": "tracker", "to-do": "tracker", "todo": "tracker", "task": "tracker", "schedule": "schedule", "timetable": "schedule", "planner": "schedule", "loan": "loan", "mortgage": "loan"}
AGGS = [("average", "AVERAGE"), ("mean", "AVERAGE"), ("count", "COUNT"), ("maximum", "MAX"), ("highest", "MAX"), ("largest", "MAX"), ("max", "MAX"), ("minimum", "MIN"), ("lowest", "MIN"), ("smallest", "MIN"), ("min", "MIN"), ("median", "MEDIAN"), ("sum", "SUM"), ("total", "SUM"), ("add up", "SUM")]


POSITIVE = {"good", "great", "excellent", "love", "loved", "happy", "amazing", "fantastic", "perfect", "best", "nice", "wonderful", "pleased", "recommend", "fast", "easy", "helpful"}
NEGATIVE = {"bad", "poor", "terrible", "hate", "hated", "awful", "worst", "slow", "broken", "disappointed", "disappointing", "angry", "useless", "refund", "problem", "late", "rude", "difficult"}


def cell_answer(prompt: str, data: list[str]) -> str | None:
    p = prompt.lower()
    text = " ".join(data).strip()
    if not text:
        return None
    words = re.findall(r"[a-z']+", text.lower())
    if re.search(r"sentiment|positive or negative|tone", p):
        score = sum(w in POSITIVE for w in words) - sum(w in NEGATIVE for w in words)
        return "Positive" if score > 0 else "Negative" if score < 0 else "Neutral"
    if "email" in p and re.search(r"extract|find|get", p):
        m = re.search(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", text)
        return m.group(0) if m else ""
    if re.search(r"extract|find|get", p) and re.search(r"url|link|website", p):
        m = re.search(r"https?://[^\s,;]+", text)
        return m.group(0) if m else ""
    if re.search(r"extract|find|get", p) and re.search(r"phone", p):
        m = re.search(r"\+?\d[\d\s().-]{6,}\d", text)
        return m.group(0).strip() if m else ""
    if re.search(r"extract|find|get", p) and re.search(r"number|amount|price", p):
        m = re.search(r"-?\d[\d,]*(\.\d+)?", text)
        return m.group(0) if m else ""
    if re.search(r"word count|how many words|count the words", p):
        return str(len(words))
    if re.search(r"summari[sz]e|shorten|tl;?dr|in one sentence|brief", p):
        first = re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text))[0]
        return first if len(first) <= 140 else first[:137].rsplit(" ", 1)[0] + "..."
    if re.search(r"keywords?|key words", p):
        stop = {"the", "and", "for", "with", "that", "this", "from", "are", "was", "has", "have", "you", "your", "not", "but", "its", "our", "his", "her", "their"}
        top = Counter(w for w in words if len(w) > 3 and w not in stop).most_common(3)
        return ", ".join(w for w, _ in top)
    return None


def columns_of(rows: list[list[str]]) -> tuple[list[str], list[list[str]], list[bool]]:
    head = rows[0] if rows else []
    body = rows[1:] if len(rows) > 1 else []
    numeric = []
    for i in range(len(head)):
        col = [r[i] for r in body if i < len(r) and r[i].strip()]
        numeric.append(bool(col) and all(text_to_number(x) is not None for x in col))
    return head, body, numeric


def offline_other(prompt: str, p: str, ctx: dict, read_range, out: dict) -> dict:
    selection = ctx.get("selection", "")
    sheet = ctx.get("sheet", "")
    area = selection.rpartition("!")[2] if selection else "A1"
    try:
        a = ranges.parse_area(area)
    except ValueError:
        a = (0, 0, 0, 0)
    start = f"{ranges.col_name(a[1])}{a[0] + 1}"
    if re.search(r"\b(generate|make|create|build|give me|draft|set up|new)\b", p) and re.search(r"\b(table|template|sheet|tracker|budget|invoice|schedule|planner|timesheet|gradebook|inventory|loan)\b", p):
        kind = next((v for w, v in TEMPLATE_WORDS.items() if w in p), None)
        if kind:
            if any(x.strip() for line in read_range(f"{sheet}!{area}").split("\n") for x in line.split("\t")):
                start = f"{ranges.col_name(a[3] + 2)}{a[0] + 1}"
            out["proposals"].append({"sheet": sheet, "start": start, "rows": TEMPLATES[kind], "note": f"{kind} template at {start}"})
            out["text"] = f"Proposed a {kind} template at {start}: sample values and working formulas you can replace. Offline templates are fixed; a model endpoint writes tables to fit your request."
            return out
    has_data = ":" in area and (a[2] > a[0] or a[3] > a[1])
    text = read_range(f"{sheet}!{area}") if has_data else ""
    rows = [r.split("\t") for r in text.split("\n")] if text else []
    if rows and re.search(r"\b(summari[sz]e|summary|describe|overview|insights?|what.s in|tell me about|analy[sz]e)\b", p):
        head, body, numeric = columns_of(rows)
        lines = [f"{len(body)} rows and {len(head)} columns in {area}."]
        for i, h in enumerate(head):
            col = [r[i].strip() for r in body if i < len(r) and r[i].strip()]
            name = h or ranges.col_name(a[1] + i)
            if numeric[i]:
                nums = [text_to_number(x) for x in col]
                lines.append(f"{name}: sum {fmt(sum(nums))}, average {fmt(round(sum(nums) / len(nums), 4))}, min {fmt(min(nums))}, max {fmt(max(nums))}.")
            elif col:
                top = Counter(col).most_common(3)
                lines.append(f"{name}: {len(set(col))} distinct, most common " + ", ".join(f"{k} ({n})" for k, n in top) + ".")
            blanks = len(body) - len(col)
            if blanks:
                lines.append(f"{name} has {blanks} blank cell{'s' if blanks != 1 else ''}.")
        out["text"] = "\n".join(lines) + "\nThis is a fixed-rule summary; a model endpoint writes a narrative one."
        return out
    if rows and re.search(r"\b(formula|sum|total|average|mean|count|max|maximum|min|minimum|median|highest|lowest|largest|smallest|add up)\b", p):
        head, body, numeric = columns_of(rows)
        func = next((f for w, f in AGGS if re.search(rf"\b{w}\b", p)), "SUM")
        cols = [i for i, n in enumerate(numeric) if n]
        named = [i for i in cols if head[i] and head[i].lower() in p]
        cols = named or cols
        if not cols:
            out["text"] = "I found no numeric column in the selection to build a formula over."
            return out
        r_first, r_last = a[0] + 2, a[2] + 1
        base = min(cols)
        first_col = ranges.col_name(a[1] + base)
        row = [""] * (max(cols) - base + 1)
        for i in cols:
            letter = ranges.col_name(a[1] + i)
            row[i - base] = f"={func}({letter}{r_first}:{letter}{r_last})"
        at = f"{first_col}{a[2] + 2}"
        out["proposals"].append({"sheet": sheet, "start": at, "rows": [row], "note": f"{func} of each numeric column, below the data at {at}"})
        out["text"] = f"Proposed {func} formulas under the data at {at}. Offline suggestions cover totals and averages; a model endpoint writes formulas from a description."
        return out
    out["text"] = "No model is set, so the assistant works offline. Ask for a chart or a pivot table, for example \"column chart of the selection\" or \"pivot of Sales by Region\"; for a summary, a total or average formula under the data, or a template such as a budget or invoice; or use Clean data. Add an endpoint under Endpoint settings for open questions."
    return out


def plan(prompt: str, ctx: dict, read_range) -> dict:
    p = prompt.lower()
    selection = ctx.get("selection", "")
    sheet = ctx.get("sheet", "")
    want_pivot = bool(re.search(r"\bpivot", p))
    want_chart = bool(re.search(r"\b(chart|graph|plot|visuali[sz]e)\b", p))
    out = {"text": "", "proposals": [], "charts": [], "pivots": []}
    if not (want_pivot or want_chart):
        return offline_other(prompt, p, ctx, read_range, out)
    area = selection.rpartition("!")[2] if selection else ""
    try:
        a = ranges.parse_area(area) if area and (":" in area) else None
    except ValueError:
        a = None
    text = read_range(f"{sheet}!{area}") if a else ""
    rows = [r.split("\t") for r in text.split("\n")] if text else []
    if not rows:
        out["text"] = "Select the data first (a header row and the rows under it), then ask again."
        return out
    head = rows[0]
    if want_pivot:
        low = [h.lower() for h in head]
        mentioned = [(p.find(h), i) for i, h in enumerate(low) if h and h in p]
        mentioned.sort()
        names = [head[i] for _, i in mentioned]
        by = p.find(" by ")
        row_f, val_f = None, None
        if by >= 0:
            after = [head[i] for pos, i in mentioned if pos > by]
            before = [head[i] for pos, i in mentioned if pos < by]
            row_f = after[0] if after else None
            val_f = before[0] if before else None
        if row_f is None and names:
            row_f = names[-1] if len(names) > 1 else names[0]
        if val_f is None:
            for i, h in enumerate(head):
                col = [r[i] for r in rows[1:] if i < len(r) and r[i].strip()]
                if col and all(re.fullmatch(r"-?[\d,.]+", x.strip()) for x in col) and h != row_f:
                    val_f = h
                    break
        if row_f is None:
            for i, h in enumerate(head):
                col = [r[i] for r in rows[1:] if i < len(r) and r[i].strip()]
                if col and not all(re.fullmatch(r"-?[\d,.]+", x.strip()) for x in col) and h != val_f:
                    row_f = h
                    break
        func = next((f for w, f in (("average", "average"), ("mean", "average"), ("count", "count"), ("max", "max"), ("min", "min"), ("sum", "sum"), ("total", "sum")) if w in p), "sum")
        if row_f is None:
            out["text"] = "I could not tell which column to group by. Name it, for example \"pivot of Sales by Region\"."
            return out
        out["pivots"].append({"source": f"{sheet}!{area}", "rows": [row_f], "cols": [], "values": [{"field": val_f or row_f, "func": func if val_f else "count"}], "note": f"{func if val_f else 'count'} of {val_f or row_f} by {row_f}"})
        out["text"] = f"Proposed a PivotTable: {out['pivots'][0]['note']}."
    if want_chart:
        t = pick_chart(prompt)
        title = re.sub(r"\s+", " ", re.sub(r"(?i)\b(make|create|build|draw|show|me|a|an|the|of|chart|graph|plot)\b", " ", prompt)).strip().capitalize()[:60]
        out["charts"].append({"sheet": sheet, "range": area, "type": t, "title": title, "byRows": False, "note": f"{t} chart of {area}"})
        out["text"] = (out["text"] + " " if out["text"] else "") + f"Proposed a {t} chart of {area}."
    return out
