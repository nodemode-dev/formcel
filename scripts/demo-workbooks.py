"""Build the three in-app demo workbooks with FormCel's own engine and write backend/app/templates/demos.json.

Run from the repository root with the engine's Python (the one backend/oc_install sets up):
    python -B scripts/demo-workbooks.py
Every name, shop, figure and measurement is invented here from a fixed seed, so a rerun writes the same file.
"""

import json
import os
import random
import sys
import tempfile
import zipfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "backend" / "app" / "templates" / "demos.json"
LIST = "\u001f"
PART = "\u001e"

sys.dont_write_bytecode = True
os.environ["FORMCEL_DATA_DIR"] = tempfile.mkdtemp(prefix="formcel-demos-")
sys.path.insert(0, str(ROOT / "backend"))

from app.services.store import Store
from app import config

TITLE = "b;sz:22;fc:1f2937"
NOTE = "i;fc:6b7280"
HEAD = "b;fc:ffffff;bg:1f2937;ha:left;va:middle;in:1"
KPI_LABEL = "b;sz:9;fc:6b7280;bg:f3f4f6;ha:left;va:middle;in:1"
KPI_VALUE = "b;sz:18;fc:1f2937;bg:f3f4f6;ha:left;va:middle;in:1"
INPUT = "fc:1d4ed8;bg:eff6ff"
PALETTE = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#eab308", "#0d9488"]


def col(c: int) -> str:
    s = ""
    c += 1
    while c:
        c, r = divmod(c - 1, 26)
        s = chr(65 + r) + s
    return s


def a1(r: int, c: int) -> str:
    return f"{col(c)}{r + 1}"


def serial(d: date) -> int:
    return (d - date(1899, 12, 30)).days


class Sheet:
    def __init__(self, book: "Builder", index: int):
        self.book, self.i = book, index
        self.cells: list[tuple[int, int, str]] = []
        self.formats: list[tuple[int, int, str]] = []
        self.styles: list[tuple[int, int, str]] = []
        self.rules: list[str] = []
        self.valid: list[str] = []
        self.merges: list[tuple[int, int, int, int]] = []
        self.objects: list[dict] = []
        self.view: dict = {}

    def put(self, r: int, c: int, *values, fmt: str = "", style: str = "") -> None:
        for k, v in enumerate(values):
            if v is None or v == "":
                continue
            self.cells.append((r, c + k, str(v)))
            if fmt:
                self.formats.append((r, c + k, fmt))
            if style:
                self.styles.append((r, c + k, style))

    def fmt(self, r0: int, c0: int, r1: int, c1: int, code: str) -> None:
        self.formats += [(r, c, code) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]

    def style(self, r0: int, c0: int, r1: int, c1: int, code: str) -> None:
        self.styles += [(r, c, code) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]

    def widths(self, *sizes: int, freeze: tuple[int, int] = (0, 0), color: str = "") -> None:
        self.view = {"cols": {"sizes": [[i, w] for i, w in enumerate(sizes)], "hidden": []}, "rows": {"sizes": [[0, 34]], "hidden": []}}
        if freeze != (0, 0):
            self.view["fr"], self.view["fc"] = freeze
        if color:
            self.view["color"] = color

    def chart(self, r0: int, c0: int, r1: int, c1: int, kind: str, rng: str, title: str, **extra) -> None:
        spec = {"type": kind, "range": rng, "byRows": False, "title": title, "xTitle": "", "yTitle": "", "legend": "bottom", "labels": False, "secondary": [], "colors": PALETTE}
        spec.update(extra)
        self.objects.append({"id": f"demo{self.book.key}{len(self.book.ids)}", "kind": "chart", "x": c0 * 90, "y": r0 * 20, "w": (c1 - c0) * 90, "h": (r1 - r0) * 20,
                             "chart": spec, "alt": title, "name": title, "anchor": {"r0": r0, "c0": c0, "dy0": 0, "dx0": 0, "r1": r1, "c1": c1, "dy1": 0, "dx1": 0}})
        self.book.ids.append(1)

    def spark(self, r: int, c: int, data: str, kind: str = "line") -> None:
        self.objects.append({"id": f"spark{self.book.key}{len(self.book.ids)}", "kind": "spark", "x": c * 90, "y": r * 20, "w": 120, "h": 20,
                             "spark": {"type": kind, "color": "#2563eb", "neg": "#e11d48", "data": data, "weight": 1.5, "high": True},
                             "anchor": {"r0": r, "c0": c, "dy0": 0, "dx0": 0, "r1": r + 1, "c1": c + 1, "dy1": 0, "dx1": 0}})
        self.book.ids.append(1)

    def text(self, r0: int, c0: int, r1: int, c1: int, body: str) -> None:
        self.objects.append({"id": f"text{self.book.key}{len(self.book.ids)}", "kind": "text", "text": {"text": body, "size": 11, "color": "#8a8a8b"},
                             "x": c0 * 90, "y": r0 * 20, "w": (c1 - c0) * 90, "h": (r1 - r0) * 20, "anchor": {"r0": r0, "c0": c0, "dy0": 0, "dx0": 0, "r1": r1, "c1": c1, "dy1": 0, "dx1": 0}})
        self.book.ids.append(1)


class Builder:
    def __init__(self, store: Store, key: str, names: list[str]):
        self.store, self.key = store, key
        self.ids: list[int] = []
        self.sheets = [Sheet(self, i) for i in range(len(names))]
        self.names = names
        self.defined: list[tuple[str, str]] = []
        self.tables: list[tuple[int, str, str, str]] = []
        self.pivots: list[str] = []
        self.whatif: list[str] = []

    def build(self) -> dict:
        st = self.store
        wid = st.create(self.names[0], None)["id"]
        b = st._load(wid)
        with b.lock:
            eng = b.engine
            for i, name in enumerate(self.names):
                if i:
                    eng.add_sheet(name)
                else:
                    eng.rename_sheet(0, name)
            for s in self.sheets:
                eng.load_formats(s.formats, s.i)
                eng.load_styles(s.styles, s.i)
                eng.load(s.cells, s.i)
            for name, refers in self.defined:
                eng.define_name(name, refers)
            for sheet, top, bottom, name in self.tables:
                eng.create_table(top, bottom, True, sheet)
                lines = eng.tables()
                parts = lines[-1].split("\t")
                parts[1] = name
                eng.load_tables(lines[:-1] + ["\t".join(parts)])
            for s in self.sheets:
                eng.load_merges(s.merges, s.i)
                eng.load_rules(s.rules, s.i)
                eng.load_validations(s.valid, s.i)
            for line in self.pivots:
                eng.create_pivot(line)
            for s in self.sheets:
                eng.load_formats(s.formats, s.i)
            b.fit_views()
            b.fit_objects()
            for s in self.sheets:
                b.views[s.i] = s.view
                b.objects[s.i] = s.objects
            b.whatif = list(self.whatif)
            st._write(b)
        with zipfile.ZipFile(st.path(wid)) as z:
            doc = json.loads(z.read("workbook.json"))
        for k in ("id", "title", "created", "modified", "template"):
            doc.pop(k, None)
        return doc


REGIONS = ["North", "South", "East", "West"]
STORES = {"North": ["Quayside", "Millbrook"], "South": ["Saltmarsh", "Riverside"], "East": ["Harbour Row", "Lantern Hill"], "West": ["Copper Lane", "Fernside"]}
PRODUCTS = [("City", "Harbour Commuter", 640), ("City", "Harbour Folding", 520), ("Road", "Tideline Road", 1180), ("Road", "Tideline Sport", 1490),
            ("Mountain", "Ridge Trail", 980), ("Mountain", "Ridge Enduro", 1720), ("Electric", "Current City-E", 2150), ("Electric", "Current Cargo-E", 2890),
            ("Kids", "Pebble 16", 210), ("Kids", "Pebble 20", 260), ("Gear", "Lantern Light Set", 45), ("Gear", "Keel Lock", 38)]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def sales(st: Store) -> dict:
    rnd = random.Random(2026)
    bk = Builder(st, "s", ["Dashboard", "Orders", "Pivot", "Products"])
    dash, orders, pivot, prods = bk.sheets
    head = ["Order", "Date", "Month", "Region", "Store", "Category", "Product", "Units", "Unit price", "Revenue"]
    orders.put(0, 0, *head)
    season = [0.55, 0.6, 0.85, 1.05, 1.25, 1.35, 1.4, 1.3, 1.05, 0.85, 0.7, 0.95]
    days = []
    for m in range(12):
        days += [date(2026, m + 1, 1) + timedelta(days=d) for d in range(28)] * round(season[m] * 4)
    picks = sorted(rnd.sample(days, 1200))
    weight = {"North": 1.0, "South": 0.8, "East": 1.25, "West": 0.95}
    for i, d in enumerate(picks, start=1):
        region = rnd.choices(REGIONS, [weight[x] for x in REGIONS])[0]
        cat, name, price = rnd.choices(PRODUCTS, [6, 4, 3, 2, 3, 2, 3 + d.month / 4, 1 + d.month / 6, 3, 3, 8, 8])[0]
        units = rnd.choice([1, 1, 1, 1, 2, 2, 3]) if price > 100 else rnd.randint(1, 6)
        r = i
        orders.put(r, 0, f"HB-{10000 + i}")
        orders.put(r, 1, serial(d), fmt="yyyy-mm-dd")
        orders.put(r, 2, f"=TEXT(B{r + 1},\"mm mmm\")")
        orders.put(r, 3, region, rnd.choice(STORES[region]), cat, name)
        orders.put(r, 7, units)
        orders.put(r, 8, f"=XLOOKUP(G{r + 1},Products!$B$2:$B$13,Products!$C$2:$C$13)", fmt="$#,##0")
        orders.put(r, 9, f"=H{r + 1}*I{r + 1}", fmt="$#,##0")
    orders.widths(90, 96, 80, 70, 110, 90, 140, 60, 84, 96, freeze=(1, 0), color="2563eb")
    orders.valid.append("1,3,1200,3\tlist\t\tNorth,South,East,West\t\tbd\tstop\t\t\tNot in the list\tPick a region from the list.\t")
    orders.valid.append("1,6,1200,6\tlist\t\t=Products!$B$2:$B$13\t\tbd\tstop\t\t\tNot in the list\tPick a product from the Products sheet.\t")
    orders.rules.append("1,9,1200,9\t0\tbar\t93c5fd\tlow\thigh\t")
    bk.tables.append((1, "A1", "J1201", "Orders"))

    prods.put(0, 0, "Category", "Product", "Unit price", "Units sold", "Revenue")
    for i, (cat, name, price) in enumerate(PRODUCTS, start=1):
        prods.put(i, 0, cat, name)
        prods.put(i, 2, price, fmt="$#,##0")
        prods.put(i, 3, f"=SUMIFS(Orders[Units],Orders[Product],B{i + 1})", fmt="#,##0")
        prods.put(i, 4, f"=SUMIFS(Orders[Revenue],Orders[Product],B{i + 1})", fmt="$#,##0")
    prods.widths(90, 150, 80, 84, 100, color="16a34a")
    prods.style(0, 0, 0, 4, HEAD)
    prods.rules.append("1,4,12,4\t0\tscale\tlow,high\tf8fafc,60a5fa\t\t")

    dash.put(0, 0, "Harbour Bikes: a year of sales", style=TITLE)
    dash.put(1, 0, "1,200 invented orders across four regions. Edit any order on the Orders sheet and every figure, chart and sparkline here follows.", style=NOTE)
    kpis = [("REVENUE", "=SUM(Orders[Revenue])", "$#,##0"), ("ORDERS", "=ROWS(Orders[Order])", "#,##0"), ("UNITS SOLD","=SUM(Orders[Units])", "#,##0"),
            ("AVERAGE ORDER", "=AVERAGE(Orders[Revenue])", "$#,##0"), ("BEST REGION", "=INDEX(A20:A23,MATCH(MAX(B20:B23),B20:B23,0))", ""),
            ("BEST MONTH", "=INDEX(A6:A17,MATCH(MAX(F6:F17),F6:F17,0))", "")]
    for k, (label, f, code) in enumerate(kpis):
        dash.put(2, k, label, style=KPI_LABEL)
        dash.put(3, k, f, fmt=code, style=KPI_VALUE)
    dash.put(4, 0, "Month", *REGIONS, "Total", "Orders", style=HEAD)
    for m in range(12):
        r = 5 + m
        key = f"{m + 1:02d} {MONTHS[m]}"
        dash.put(r, 0, MONTHS[m])
        for k, reg in enumerate(REGIONS):
            dash.put(r, 1 + k, f"=SUMIFS(Orders[Revenue],Orders[Month],\"{key}\",Orders[Region],\"{reg}\")", fmt="$#,##0")
        dash.put(r, 5, f"=SUM(B{r + 1}:E{r + 1})", fmt="$#,##0")
        dash.put(r, 6, f"=COUNTIFS(Orders[Month],\"{key}\")", fmt="#,##0")
    dash.rules.append("5,1,16,4\t0\tscale\tlow,high\tf8fafc,60a5fa\t\t")
    dash.put(18, 0, "Region", "Revenue", "Share", "Trend", style=HEAD)
    for k, reg in enumerate(REGIONS):
        r = 19 + k
        dash.put(r, 0, reg)
        dash.put(r, 1, f"=SUM({col(1 + k)}6:{col(1 + k)}17)", fmt="$#,##0")
        dash.put(r, 2, f"=B{r + 1}/SUM($B$20:$B$23)", fmt="0.0%")
        dash.spark(r, 3, f"'Dashboard'!{col(1 + k)}6:{col(1 + k)}17")
    dash.rules.append("19,1,22,1\t0\tbar\t60a5fa\tnum:0\thigh\t")
    dash.rules.append("19,2,22,2\t0\ticons\t3arrows\t33,66\t\t")
    dash.widths(140, 112, 112, 112, 112, 112, 80, 40, 90, 90, 90, 90, 90, 90, 90, 90, freeze=(0, 0), color="f97316")
    dash.view["rows"]["sizes"] = [[0, 36], [3, 34]]
    dash.put(43, 0, "Chart data", style="b")
    dash.put(44, 0, "Month", "Revenue", "Orders", style=HEAD)
    for m in range(12):
        dash.put(45 + m, 0, MONTHS[m], f"=F{6 + m}", f"=G{6 + m}")
        dash.fmt(45 + m, 1, 45 + m, 1, "$#,##0")
    cats = list(dict.fromkeys(p[0] for p in PRODUCTS))
    dash.put(44, 4, "Category", "Revenue", style=HEAD)
    for k, cat in enumerate(cats):
        dash.put(45 + k, 4, cat, f"=SUMIFS(Orders[Revenue],Orders[Category],E{46 + k})")
        dash.fmt(45 + k, 5, 45 + k, 5, "$#,##0")
    dash.chart(4, 8, 22, 16, "combo", "Dashboard!A45:C57", "Revenue and orders by month", secondary=[1], yFmt="$#,##0")
    dash.chart(24, 0, 42, 7, "column-stacked", "Dashboard!A5:E17", "Revenue by month and region", yFmt="$#,##0")
    dash.chart(24, 8, 42, 16, "doughnut", f"Dashboard!E45:F{45 + len(cats)}", "Revenue by category", legend="right", labels=True)

    pivot.put(0, 0, "PivotTable: revenue by category and region. Change the Orders sheet, then refresh it from the PivotTable tab.", style=NOTE)
    pivot.widths(130, 104, 104, 104, 104, 110, color="9333ea")
    pivot.fmt(4, 1, 10, 5, "$#,##0")
    vals = PART.join(["Revenue", "sum", "none", "Revenue", "", ""])
    bk.pivots.append("\t".join(["RevenueByCategory", "2", "2,0", "1", "0,0,1200,9", "Orders", "rc", "", "Category", "Region", vals, "", "", ""]))
    return {"id": "demo-sales", "name": "A year of bike sales", "description": "An invented bike shop's 1,200 orders in a table, a dashboard of formulas, a PivotTable, a combo chart, stacked columns, sparklines, data bars and icon sets.", "doc": bk.build()}


def whatif(st: Store) -> dict:
    bk = Builder(st, "w", ["Loan", "Schedule", "Savings"])
    loan, sched, save = bk.sheets
    loan.put(0, 0, "Loan and savings what-if", style=TITLE)
    loan.put(1, 0, "Blue cells are inputs. Change one and the payment, the schedule, the data table and the charts follow. Data > What-If Analysis > Scenario Manager holds three ready scenarios.", style=NOTE)
    inputs = [("Home price", 420000, "$#,##0", "Price"), ("Deposit", 84000, "$#,##0", "Deposit"), ("Interest rate (yearly)", 0.049, "0.00%", "Rate"), ("Term in years", 25, "0", "Years")]
    loan.put(3, 0, "Inputs", style=HEAD)
    loan.put(3, 1, "", style=HEAD)
    for k, (label, v, code, name) in enumerate(inputs):
        r = 4 + k
        loan.put(r, 0, label)
        loan.put(r, 1, v, fmt=code, style=INPUT)
        bk.defined.append((name, f"=Loan!$B${r + 1}"))
    bk.defined.append(("Payment", "=LAMBDA(principal,rate,years,PMT(rate/12,years*12,-principal))"))
    loan.put(9, 0, "Results", style=HEAD)
    loan.put(9, 1, "", style=HEAD)
    results = [("Amount borrowed", "=Price-Deposit", "$#,##0"), ("Monthly payment", "=Payment(B11,Rate,Years)", "$#,##0.00"),
               ("Total paid", "=LET(n,Years*12,pmt,B12,pmt*n)", "$#,##0"), ("Total interest", "=B13-B11", "$#,##0"),
               ("Interest share of what you pay", "=B14/B13", "0.0%")]
    for k, (label, f, code) in enumerate(results):
        loan.put(10 + k, 0, label)
        loan.put(10 + k, 1, f, fmt=code, style="b" if k == 1 else "")
    loan.put(16, 0, "Payment for each rate and term (a two-variable data table)", style="b")
    loan.put(17, 0, "=B12", fmt="$#,##0", style="i;fc:6b7280")
    rates = [0.035, 0.04, 0.045, 0.05, 0.055, 0.06, 0.065]
    terms = [15, 20, 25, 30]
    for k, t in enumerate(terms):
        loan.put(17, 1 + k, t, fmt="0 \"yrs\"", style="b;bg:f3f4f6")
    for k, rt in enumerate(rates):
        loan.put(18 + k, 0, rt, fmt="0.0%", style="b;bg:f3f4f6")
    loan.fmt(18, 1, 24, 4, "$#,##0")
    loan.rules.append("18,1,24,4\t0\tscale\tlow,high\tdcfce7,fecaca\t\t")
    bk.whatif.append("dt\t0\t17\t0\t24\t4\tB8\tB7")
    bk.whatif.append("sc\tToday's offer\tThe numbers as quoted.\t0\tB6\t84000\tB7\t0.049\tB8\t25")
    bk.whatif.append("sc\tBigger deposit\tPut in 30 percent.\t0\tB6\t126000\tB7\t0.047\tB8\t25")
    bk.whatif.append("sc\tShorter term\tFifteen years at a lower rate.\t0\tB6\t84000\tB7\t0.044\tB8\t15")
    loan.put(26, 0, "Yearly view (dynamic arrays)", style="b")
    loan.put(27, 0, "Year", "Balance at year end", "Interest that year", style=HEAD)
    loan.put(28, 0, "=\"Year \"&SEQUENCE(Years)")
    loan.put(28, 1, "=XLOOKUP(SEQUENCE(Years)*12,Schedule!A5:A364,Schedule!E5:E364)", fmt="$#,##0")
    loan.put(28, 2, "=BYROW(SEQUENCE(Years),LAMBDA(y,SUMIFS(Schedule!C5:C364,Schedule!F5:F364,y)))", fmt="$#,##0")
    loan.fmt(29, 1, 57, 2, "$#,##0")
    loan.widths(230, 120, 104, 104, 104, 40, 90, 90, 90, 90, 90, 90, 90, color="2563eb")
    loan.text(3, 3, 15, 6, "Goal Seek: to keep the monthly payment at 1,800, select B12, choose Data > What-If Analysis > Goal Seek, set it to 1800 by changing B6 (the deposit). FormCel finds the deposit you need.")
    loan.chart(2, 7, 22, 15, "combo", "Loan!A28:C58", "Balance at year end and interest paid each year", secondary=[1], yFmt="$#,##0", y2Fmt="$#,##0")

    sched.put(0, 0, "Amortisation schedule", style=TITLE)
    sched.put(1, 0, "One row per month; rows past the term stay empty.", style=NOTE)
    sched.put(3, 0, "Month", "Payment", "Interest", "Principal", "Balance", "Year", style=HEAD)
    sched.put(3, 4, "", style=HEAD)
    for m in range(1, 361):
        r = 3 + m
        on = f"A{r + 1}<=Years*12"
        prev = "Loan!$B$11" if m == 1 else f"E{r}"
        sched.put(r, 0, m)
        sched.put(r, 1, f"=IF({on},Loan!$B$12,\"\")")
        sched.put(r, 2, f"=IF({on},{prev}*Rate/12,\"\")")
        sched.put(r, 3, f"=IF({on},B{r + 1}-C{r + 1},\"\")")
        sched.put(r, 4, f"=IF({on},{prev}-D{r + 1},\"\")")
        sched.put(r, 5, f"=IF({on},ROUNDUP(A{r + 1}/12,0),\"\")")
    sched.fmt(4, 1, 363, 4, "$#,##0.00")
    sched.widths(70, 100, 100, 100, 120, 60, freeze=(4, 0), color="0d9488")

    save.put(0, 0, "A savings goal", style=TITLE)
    save.put(1, 0, "How a monthly saving grows at a steady return. The chart reads the table below.", style=NOTE)
    for k, (label, v, code) in enumerate([("Monthly saving", 450, "$#,##0"), ("Return per year", 0.045, "0.0%"), ("Years", 10, "0"), ("Starting balance", 5000, "$#,##0")]):
        save.put(3 + k, 0, label)
        save.put(3 + k, 1, v, fmt=code, style=INPUT)
    save.put(8, 0, "Balance after the last year")
    save.put(8, 1, "=FV(B5/12,B6*12,-B4,-B7)", fmt="$#,##0", style="b")
    save.put(10, 0, "Year", "Balance", "Paid in", "Growth", style=HEAD)
    for y in range(1, 21):
        r = 10 + y
        save.put(r, 0, y)
        save.put(r, 1, f"=IF(A{r + 1}<=$B$6,FV($B$5/12,A{r + 1}*12,-$B$4,-$B$7),NA())", fmt="$#,##0")
        save.put(r, 2, f"=IF(A{r + 1}<=$B$6,$B$7+$B$4*12*A{r + 1},NA())", fmt="$#,##0")
        save.put(r, 3, f"=IFERROR(B{r + 1}-C{r + 1},\"\")", fmt="$#,##0")
    save.widths(200, 110, 110, 110, 40, 90, 90, 90, 90, 90, 90, color="16a34a")
    save.chart(2, 5, 20, 12, "line", "Savings!A11:C31", "Balance and money paid in", yFmt="$#,##0")
    return {"id": "demo-whatif", "name": "Loan and savings what-if", "description": "Named inputs, a LAMBDA, LET and dynamic arrays, a 30-year schedule, a two-variable data table, three scenarios and charts that follow the inputs.", "doc": bk.build()}


ANALYSTS = ["Ana Ortiz", "Ben Okafor", "Chen Wei", "Dara Novak"]


def lab(st: Store) -> dict:
    rnd = random.Random(7)
    bk = Builder(st, "l", ["Summary", "Clean", "Import", "Batches"])
    summ, clean, raw, batches = bk.sheets
    rows = []
    start = date(2026, 3, 2)
    for i in range(1, 161):
        temp = round(rnd.gauss(21.5, 1.6), 1)
        cond = round(410 + (temp - 21.5) * 18 + rnd.gauss(0, 9), 1)
        ph = round(rnd.gauss(7.1, 0.12), 2)
        if i in (37, 92, 141):
            cond = round(cond + rnd.choice([-1, 1]) * 70, 1)
        rows.append((f"S-{i:03d}", start + timedelta(days=(i - 1) // 6), temp, ph, cond, ANALYSTS[(i * 7) % 4]))
    raw.put(0, 0, "Exported from the bench meter (one text line per reading)", style="b")
    out = 1
    for k, (sid, d, temp, ph, cond, who) in enumerate(rows):
        line = f"  {sid} ;{d.isoformat()}; {temp} C ;{ph};{cond} uS/cm; {who.lower() if k % 9 == 0 else who} "
        raw.put(out, 0, line)
        out += 1
        if k % 23 == 5:
            raw.put(out, 0, line)
            out += 1
    raw.put(0, 2, "Split with Text to Columns on ; and cleaned with TRIM, PROPER and Remove Duplicates to make the Clean sheet. The formula in C3 shows the same split as a dynamic array.", style=NOTE)
    raw.put(2, 2, "=MAP(TEXTSPLIT(A2,\";\"),LAMBDA(part,TRIM(part)))")
    raw.widths(420, 20, 90, 90, 90, 90, 90, 90, color="6b7280")

    clean.put(0, 0, "Sample", "Date", "Temperature (C)", "Conductivity (uS/cm)", "pH", "Analyst", "Outlier")
    for i, (sid, d, temp, ph, cond, who) in enumerate(rows, start=1):
        r = i
        clean.put(r, 0, sid)
        clean.put(r, 1, serial(d), fmt="yyyy-mm-dd")
        clean.put(r, 2, temp, fmt="0.0")
        clean.put(r, 3, cond, fmt="0.0")
        clean.put(r, 4, ph, fmt="0.00")
        clean.put(r, 5, who)
        clean.put(r, 6, f"=IF(ABS(D{r + 1}-(Summary!$B$12*C{r + 1}+Summary!$B$13))>3*Summary!$B$15,\"check\",\"\")")
    clean.valid.append("1,5,160,5\tlist\t\t" + ",".join(ANALYSTS) + "\t\tbd\tstop\t\t\tNot in the list\tPick an analyst from the list.\t")
    clean.valid.append("1,4,160,4\tdecimal\tbetween\t0\t14\tbe\tstop\t\t\tNot a pH\tA pH is between 0 and 14.\t")
    clean.rules.append("1,0,160,6\t0\tformula\t=$G2=\"check\"\t\t\tfc:991b1b;bg:fee2e2")
    clean.rules.append("1,4,160,4\t0\tformula\t=ABS(E2-AVERAGE($E$2:$E$161))>2*STDEV.S($E$2:$E$161)\t\t\tb;fc:92400e;bg:fef3c7")
    clean.widths(80, 96, 120, 150, 70, 100, 70, freeze=(1, 1), color="16a34a")
    bk.tables.append((1, "A1", "G161", "Readings"))

    summ.put(0, 0, "Lab measurements: water samples", style=TITLE)
    summ.put(1, 0, "160 invented bench readings, cleaned from a messy export. Outliers are flagged red on the Clean sheet against the fitted line below.", style=NOTE)
    summ.put(3, 0, "Measure", "Mean", "Std dev", "Std error", "Median", "Min", "Max", "Count", style=HEAD)
    for k, (label, field, code) in enumerate([("Temperature (C)", "Readings[Temperature (C)]", "0.00"), ("pH", "Readings[pH]", "0.000"), ("Conductivity (uS/cm)", "Readings[Conductivity (uS/cm)]", "0.0")]):
        r = 4 + k
        summ.put(r, 0, label)
        summ.put(r, 1, f"=AVERAGE({field})", f"=STDEV.S({field})", f"=C{r + 1}/SQRT(H{r + 1})", f"=MEDIAN({field})", f"=MIN({field})", f"=MAX({field})", fmt=code)
        summ.put(r, 7, f"=COUNT({field})")
    summ.put(9, 0, "Conductivity against temperature", style="b")
    summ.put(10, 0, "Measure", "Value", style=HEAD)
    fits = [("Slope", "=SLOPE(Readings[Conductivity (uS/cm)],Readings[Temperature (C)])", "0.00"),
            ("Intercept", "=INTERCEPT(Readings[Conductivity (uS/cm)],Readings[Temperature (C)])", "0.0"),
            ("R squared", "=RSQ(Readings[Conductivity (uS/cm)],Readings[Temperature (C)])", "0.000"),
            ("Residual std dev", "=STEYX(Readings[Conductivity (uS/cm)],Readings[Temperature (C)])", "0.0"),
            ("Readings flagged", "=COUNTIF(Readings[Outlier],\"check\")", "0")]
    for k, (label, f, code) in enumerate(fits):
        summ.put(11 + k, 0, label)
        summ.put(11 + k, 1, f, fmt=code)
    summ.put(17, 0, "By analyst", style="b")
    summ.put(18, 0, "Analyst", "Readings", "Mean pH", "Mean conductivity", style=HEAD)
    for k, who in enumerate(ANALYSTS):
        r = 19 + k
        summ.put(r, 0, who)
        summ.put(r, 1, f"=COUNTIF(Readings[Analyst],A{r + 1})")
        summ.put(r, 2, f"=AVERAGEIFS(Readings[pH],Readings[Analyst],A{r + 1})", fmt="0.000")
        summ.put(r, 3, f"=AVERAGEIFS(Readings[Conductivity (uS/cm)],Readings[Analyst],A{r + 1})", fmt="0.0")
    summ.rules.append("19,2,22,2\t0\tscale\tlow,high\tf8fafc,60a5fa\t\t")
    summ.widths(190, 90, 90, 90, 90, 90, 90, 70, 30, 90, 90, 90, 90, 90, 90, 90, 90, color="9333ea")
    summ.chart(2, 9, 20, 17, "scatter", "Clean!C1:D161", "Conductivity against temperature", legend="none", xTitle="Temperature (C)", yTitle="Conductivity (uS/cm)", trends=[{"series": 0, "kind": "linear", "eq": True, "r2": True}])
    summ.chart(24, 0, 40, 8, "histogram", "Clean!E1:E161", "Spread of pH readings", legend="none", xTitle="pH", yTitle="Readings", bins=12)
    summ.chart(21, 9, 40, 17, "box", "Batches!A1:D41", "Conductivity by analyst", legend="none", yTitle="uS/cm")

    batches.put(0, 0, *ANALYSTS, style=HEAD)
    for k, who in enumerate(ANALYSTS):
        mine = [x for x in rows if x[5] == who][:40]
        for i, x in enumerate(mine, start=1):
            batches.put(i, k, x[4], fmt="0.0")
    batches.widths(100, 100, 100, 100, color="eab308")
    return {"id": "demo-lab", "name": "Lab measurements", "description": "A messy meter export cleaned into a table with validation, summary statistics, a scatter with trendline and R squared, a histogram, a box plot and flagged outliers.", "doc": bk.build()}


def main() -> None:
    st = Store(config.ensure_data_dir())
    demos = []
    for make in (sales, whatif, lab):
        d = make(st)
        demos.append({"id": d["id"], "name": d["name"], "description": d["description"], "category": "Demos", "tags": ["demo"], "featured": False, "doc": d["doc"]})
    OUT.write_text(json.dumps(demos, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes, {len(demos)} demos")


if __name__ == "__main__":
    main()
