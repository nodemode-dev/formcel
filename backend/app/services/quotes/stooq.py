import csv
import io
from datetime import date, datetime, timedelta, timezone

from . import net, settings, symbols
from .model import NoData, NotConfigured, QuoteError, Unsupported

NAME = "stooq"


def _csv(url: str, params: dict) -> list[dict]:
    key = settings.key_of(NAME)
    if key:
        params = {**params, "apikey": key}
    text = net.get(NAME, settings.base_of(NAME) + url, params).strip()
    if not text or text[:1] == "<" or "apikey" in text[:400].lower() and "," not in text.splitlines()[0]:
        raise NotConfigured("Stooq answered with a page instead of CSV. It now needs an API key: open https://stooq.com/q/d/?s=spy.us&get_apikey, solve the captcha, and paste the key under Settings, Market data.")
    if text.lower().startswith(("no data", "n/d", "exceeded", "error")):
        raise NoData(f"Stooq has no data for this request ({text[:60]})")
    rows = list(csv.DictReader(io.StringIO(text)))
    return rows


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def history(symbol: str, start: date, end: date) -> list[dict]:
    rows = _csv("/q/d/l/", {"s": symbols.stooq(symbol), "d1": start.strftime("%Y%m%d"), "d2": end.strftime("%Y%m%d"), "i": "d"})
    out = []
    for r in rows:
        try:
            d = datetime.strptime(r["Date"], "%Y-%m-%d").date()
        except (KeyError, ValueError):
            continue
        out.append({"date": d, "open": _num(r.get("Open")), "high": _num(r.get("High")), "low": _num(r.get("Low")), "close": _num(r.get("Close")), "volume": _num(r.get("Volume"))})
    out.sort(key=lambda x: x["date"])
    if not out:
        raise NoData(f"Stooq has no history for {symbol} in that range")
    return out


def quote(symbol: str) -> dict:
    rows = _csv("/q/l/", {"s": symbols.stooq(symbol), "f": "sd2t2ohlcv", "h": "", "e": "csv"})
    if not rows or _num(rows[0].get("Close")) is None:
        raise NoData(f"Stooq does not know the symbol {symbol}")
    r = rows[0]
    price = _num(r.get("Close"))
    when = None
    try:
        when = datetime.strptime(f"{r.get('Date')} {r.get('Time')}", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        pass
    prev = None
    try:
        past = history(symbol, date.today() - timedelta(days=14), date.today())
        before = [p for p in past if when is None or p["date"] < datetime.fromtimestamp(when, timezone.utc).date()]
        prev = before[-1]["close"] if before else None
    except QuoteError:
        prev = None
    out = {"price": price, "open": _num(r.get("Open")), "high": _num(r.get("High")), "low": _num(r.get("Low")), "volume": _num(r.get("Volume")), "time": when, "prev": prev, "name": r.get("Symbol", symbol)}
    if prev:
        out["change"] = price - prev
        out["changepct"] = (price - prev) / prev * 100
    return out


def profile(symbol: str) -> dict:
    rows = history(symbol, date.today() - timedelta(days=366), date.today())
    highs = [r["high"] for r in rows if r["high"] is not None]
    lows = [r["low"] for r in rows if r["low"] is not None]
    vols = [r["volume"] for r in rows[-63:] if r["volume"] is not None]
    return {"high52": max(highs) if highs else None, "low52": min(lows) if lows else None, "volumeavg": sum(vols) / len(vols) if vols else None}


def search(query: str) -> list[dict]:
    raise Unsupported("Stooq has no symbol search")


def fx(base: str, quote_: str) -> dict:
    raise Unsupported("Stooq exchange rates are not used; FormCel takes rates from the European Central Bank")
