import re
import time
from datetime import datetime, timezone

from . import ecb, service, settings, symbols
from .model import NoData, NotConfigured, QuoteError, Unsupported, moment

NAMES = {
    "DOLLAR": "USD", "US DOLLAR": "USD", "DOLLARS": "USD", "EURO": "EUR", "EUROS": "EUR", "POUND": "GBP", "POUND STERLING": "GBP", "STERLING": "GBP", "YEN": "JPY", "FRANC": "CHF", "SWISS FRANC": "CHF",
    "CANADIAN DOLLAR": "CAD", "AUSTRALIAN DOLLAR": "AUD", "NEW ZEALAND DOLLAR": "NZD", "YUAN": "CNY", "RENMINBI": "CNY", "RUPEE": "INR", "KRONA": "SEK", "KRONE": "NOK", "WON": "KRW", "PESO": "MXN", "REAL": "BRL", "RAND": "ZAR", "ZLOTY": "PLN", "FORINT": "HUF", "LIRA": "TRY",
}
TICKER = re.compile(r"^[A-Za-z0-9.^:\-]{1,16}$")


def encode(entity: str, provider: str, at: int, fields: list[tuple[str, str, object]]) -> str:
    def esc(s) -> str:
        return str(s).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")

    lines = ["\t".join(esc(x) for x in ("v1", entity, provider, at))]
    for name, kind, value in fields:
        lines.append("\t".join((esc(name), esc(kind), esc(value))))
    return "\n".join(lines)


def _currency_code(word: str) -> str | None:
    w = word.strip().upper()
    if re.fullmatch(r"[A-Z]{3}", w):
        return w
    return NAMES.get(w)


def currency_pair(text: str) -> tuple[str, str] | None:
    t = text.strip()
    m = re.fullmatch(r"(?i)\s*([A-Za-z ]+?)\s*(?:/|-|\s+to\s+|\s+in\s+|\s)\s*([A-Za-z ]+?)\s*", t)
    if m:
        a, b = _currency_code(m.group(1)), _currency_code(m.group(2))
        if a and b:
            return a, b
    if re.fullmatch(r"(?i)[A-Z]{6}", t):
        return t[:3].upper(), t[3:].upper()
    return None


def resolve_currency(text: str, fresh: bool = False) -> list[dict]:
    pair = currency_pair(text)
    if not pair:
        return []
    known = ecb.currencies(fresh)
    for c in pair:
        if c not in known:
            raise NoData(f"{c} is not among the currencies the European Central Bank publishes")
    return [{"entity": f"{pair[0]}/{pair[1]}", "name": f"{pair[0]}/{pair[1]}", "exchange": "", "type": "Currency", "symbol": f"{pair[0]}{pair[1]}"}]


def resolve_stock(text: str, fresh: bool = False) -> list[dict]:
    name, mod = service.active()
    t = text.strip()
    out: list[dict] = []
    if TICKER.match(t):
        try:
            q = service.quote(t, fresh)
            nm = None
            try:
                nm = service.profile(t, fresh).get("name")
            except QuoteError:
                nm = None
            return [{"entity": t.upper(), "name": nm or t.upper(), "exchange": "", "type": "Stock", "symbol": t.upper(), "price": q.get("price")}]
        except NotConfigured:
            raise
        except QuoteError:
            pass
    try:
        for m in mod.search(t)[:8]:
            if m.get("symbol"):
                out.append({"entity": m["symbol"], "name": m.get("name") or m["symbol"], "exchange": m.get("exchange") or "", "type": m.get("type") or "", "symbol": m["symbol"]})
    except Unsupported:
        pass
    return out


def resolve(kind: str, text: str, fresh: bool = False) -> list[dict]:
    return resolve_currency(text, fresh) if kind == "currency" else resolve_stock(text, fresh)


def _pct(v):
    return None if v is None else v / 100


def stock_record(entity: str, fresh: bool = False) -> dict:
    name, _ = service.active()
    q = service.quote(entity, fresh)
    try:
        p = service.profile(entity, fresh)
    except Unsupported:
        p = {}
    except NoData:
        p = {}
    ex, tick = symbols.split(entity)
    try:
        cur = service.realtime(entity, "currency", fresh)
    except QuoteError:
        cur = p.get("currency")
    rows = [
        ("Name", "t", p.get("name") or tick.upper()),
        ("Ticker symbol", "t", tick.upper()),
        ("Exchange", "t", p.get("exchange") or ex),
        ("Instrument type", "t", p.get("type") or "Stock"),
        ("Currency", "t", cur),
        ("Price", "n", q.get("price")),
        ("Change", "n", q.get("change")),
        ("Change (%)", "p", _pct(q.get("changepct"))),
        ("Previous close", "n", q.get("prev")),
        ("Open", "n", q.get("open")),
        ("High", "n", q.get("high")),
        ("Low", "n", q.get("low")),
        ("52 week high", "n", p.get("high52")),
        ("52 week low", "n", p.get("low52")),
        ("Volume", "i", q.get("volume")),
        ("Average volume", "i", p.get("volumeavg")),
        ("Market cap", "i", p.get("marketcap")),
        ("P/E", "n", p.get("pe")),
        ("EPS", "n", p.get("eps")),
        ("Beta", "n", p.get("beta")),
        ("Shares outstanding", "i", p.get("shares")),
        ("Industry", "t", p.get("industry")),
        ("Description", "t", p.get("description")),
        ("Last trade time", "m", float(moment(q["time"])) if q.get("time") else None),
    ]
    fields = [(n, k, v) for n, k, v in rows if v is not None and v != ""]
    return _package("stock", entity, fields[0][2], name, fields)


def currency_record(entity: str, fresh: bool = False) -> dict:
    pair = currency_pair(entity)
    if not pair:
        raise NoData(f"{entity} is not a currency pair")
    r = service.rate(pair[0], pair[1], fresh)
    d = r["date"]
    prev = r.get("prev")
    label = f"{pair[0]}/{pair[1]}"
    rows = [
        ("Name", "t", label),
        ("Ticker symbol", "t", f"{pair[0]}{pair[1]}"),
        ("Instrument type", "t", "Currency"),
        ("Base currency", "t", pair[0]),
        ("Quote currency", "t", pair[1]),
        ("Price", "n", r["rate"]),
        ("Previous close", "n", prev),
        ("Change", "n", None if prev is None else r["rate"] - prev),
        ("Change (%)", "p", None if not prev else (r["rate"] - prev) / prev),
        ("Last trade time", "m", float(moment(datetime(d.year, d.month, d.day, 15, tzinfo=timezone.utc).timestamp()))),
    ]
    fields = [(n, k, v) for n, k, v in rows if v is not None and v != ""]
    source = "ecb" if settings.load()["fx"] == "ecb" else settings.load()["provider"]
    return _package("currency", label, label, source, fields)


def _package(kind: str, entity: str, display: str, provider: str, fields: list) -> dict:
    at = int(time.time())
    return {
        "kind": kind,
        "entity": entity,
        "name": str(display),
        "provider": provider,
        "at": at,
        "fields": [{"name": n, "kind": k, "value": v} for n, k, v in fields],
        "payload": encode(entity, provider, at, fields),
    }


def record(kind: str, entity: str, fresh: bool = False) -> dict:
    return currency_record(entity, fresh) if kind == "currency" else stock_record(entity, fresh)


def unresolved(kind: str) -> str:
    return encode("", "", 0, [])
