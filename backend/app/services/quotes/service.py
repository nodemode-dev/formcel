from datetime import date, datetime, timedelta, timezone

from . import alphavantage, cache, ecb, finnhub, settings, stooq, symbols
from .model import BadArgument, NoData, NotConfigured, QuoteError, Unsupported, moment, parse_date, serial

PROV = {"stooq": stooq, "alphavantage": alphavantage, "finnhub": finnhub}
QUOTE_ATTRS = {"price", "priceopen", "high", "low", "volume", "tradetime", "datadelay", "change", "changepct", "closeyest"}
PROFILE_ATTRS = {"marketcap", "volumeavg", "pe", "eps", "high52", "low52", "beta", "shares", "currency"}
REALTIME = QUOTE_ATTRS | PROFILE_ATTRS
FUND_RETURNS = {"returnday": 1, "return1": 7, "return4": 28, "return13": 91, "return52": 365, "return156": 1095, "return260": 1825}
FUND_OTHER = {"returnytd", "netassets", "yieldpct", "incomedividend", "capitalgain", "date"}
HISTORICAL = {"open", "close", "high", "low", "volume", "all", "price"}
CURRENCY_OF_SUFFIX = {"us": "USD", "uk": "GBX", "de": "EUR", "jp": "JPY", "pl": "PLN", "hk": "HKD", "ca": "CAD", "fr": "EUR"}


def active():
    name = settings.load()["provider"]
    if not name:
        raise NotConfigured("No market data provider is set. Choose Stooq, Alpha Vantage or Finnhub under Settings, Market data, and add its key.")
    return name, PROV[name]


def _ttl(kind: str) -> float:
    return settings.load()["ttl"][kind]


def _cached(kind: str, key: str, make, fresh: bool):
    hit = cache.get(f"{kind}:{key}", _ttl(kind), fresh)
    if hit is not None:
        return hit
    val = make()
    cache.put(f"{kind}:{key}", val)
    return val


def quote(symbol: str, fresh: bool = False) -> dict:
    name, mod = active()
    return _cached("quote", f"{name}:{symbol}", lambda: mod.quote(symbol), fresh)


def profile(symbol: str, fresh: bool = False) -> dict:
    name, mod = active()
    return _cached("profile", f"{name}:{symbol}", lambda: mod.profile(symbol), fresh)


def daily(symbol: str, start: date, end: date, fresh: bool = False) -> list[dict]:
    pair = symbols.currency_pair(symbol)
    if pair:
        return ecb.series(pair[0], pair[1], start, end, fresh)
    name, mod = active()
    key = f"{name}:{symbol}:{start}:{end}"
    ttl = _ttl("history") if end < date.today() else _ttl("quote")
    hit = cache.get(f"history:{key}", ttl, fresh)
    if hit is not None:
        return hit
    rows = mod.history(symbol, start, end)
    cache.put(f"history:{key}", rows)
    return rows


def rate(base: str, quote_: str, fresh: bool = False) -> dict:
    if base == quote_:
        return {"rate": 1.0, "date": date.today(), "prev": 1.0}
    if settings.load()["fx"] == "provider":
        name, mod = active()
        r = _cached("fx", f"{name}:{base}{quote_}", lambda: mod.fx(base, quote_), fresh)
        return {"rate": r["rate"], "date": datetime.fromtimestamp(r["time"], timezone.utc).date() if r.get("time") else date.today(), "prev": None}
    latest = ecb.latest(base, quote_, fresh)
    prev = None
    try:
        before = ecb.at(base, quote_, latest["date"] - timedelta(days=1), fresh)
        prev = before["rate"]
    except QuoteError:
        prev = None
    return {"rate": latest["rate"], "date": latest["date"], "prev": prev}


def _need(d: dict, key: str, label: str, provider: str):
    v = d.get(key)
    if v is None:
        raise Unsupported(f"{provider} does not supply {label} for this symbol")
    return v


def _fx_attr(pair: tuple[str, str], attr: str, fresh: bool):
    r = rate(pair[0], pair[1], fresh)
    if attr == "price":
        return r["rate"]
    if attr == "closeyest":
        return _need(r, "prev", "the previous rate", "The rate source")
    if attr == "change":
        return r["rate"] - _need(r, "prev", "the previous rate", "The rate source")
    if attr == "changepct":
        p = _need(r, "prev", "the previous rate", "The rate source")
        return (r["rate"] - p) / p * 100
    if attr == "tradetime":
        d = r["date"]
        return moment(datetime(d.year, d.month, d.day, 15, tzinfo=timezone.utc).timestamp())
    if attr == "currency":
        return pair[1]
    if attr == "datadelay":
        return 0
    raise Unsupported("Currencies have no trading window, so open, high, low and volume are not returned")


def realtime(symbol: str, attr: str, fresh: bool = False):
    attr = (attr or "price").strip().lower()
    pair = symbols.currency_pair(symbol)
    if pair:
        return _fx_attr(pair, attr, fresh)
    if attr in FUND_RETURNS or attr in FUND_OTHER:
        return fund_attr(symbol, attr, fresh)
    if attr not in REALTIME:
        raise BadArgument(f"{attr!r} is not a GOOGLEFINANCE attribute")
    name, _ = active()
    if attr == "datadelay":
        return settings.delay_of(name)
    if attr == "currency":
        try:
            c = profile(symbol, fresh).get("currency")
        except QuoteError:
            c = None
        if c:
            return c
        ex, t = symbols.split(symbol)
        suffix = symbols.stooq(symbol).rsplit(".", 1)[-1] if name == "stooq" else ""
        if suffix in CURRENCY_OF_SUFFIX:
            return CURRENCY_OF_SUFFIX[suffix]
        raise Unsupported(f"{name} does not supply the currency for this symbol")
    if attr in QUOTE_ATTRS:
        q = quote(symbol, fresh)
        if attr == "tradetime":
            return moment(_need(q, "time", "the trade time", name))
        key = {"price": "price", "priceopen": "open", "high": "high", "low": "low", "volume": "volume", "change": "change", "changepct": "changepct", "closeyest": "prev"}[attr]
        return _need(q, key, attr, name)
    p = profile(symbol, fresh)
    return _need(p, attr, attr, name)


def fund_attr(symbol: str, attr: str, fresh: bool):
    name, _ = active()
    if attr == "date":
        return serial(datetime.fromtimestamp(_need(quote(symbol, fresh), "time", "the trade date", name), timezone.utc).date())
    if attr in FUND_RETURNS or attr == "returnytd":
        today = date.today()
        if attr == "returnytd":
            start = date(today.year - 1, 12, 20)
        else:
            start = today - timedelta(days=FUND_RETURNS[attr] + 10)
        rows = daily(symbol, start, today, fresh)
        last = rows[-1]["close"]
        if attr == "returnytd":
            base = [r for r in rows if r["date"] <= date(today.year - 1, 12, 31)]
        else:
            base = [r for r in rows if r["date"] <= today - timedelta(days=FUND_RETURNS[attr])]
        if not base or not base[-1]["close"]:
            raise NoData(f"There is not enough history to work out {attr}")
        return (last - base[-1]["close"]) / base[-1]["close"] * 100
    raise Unsupported(f"{name} does not supply {attr}; mutual fund data is limited to price, change and returns worked out from history")


def _bucket(d: date, interval: int) -> date:
    if interval == 1:
        return d - timedelta(days=d.weekday())
    if interval == 2:
        return d.replace(day=1)
    return d


def aggregate(rows: list[dict], interval: int) -> list[dict]:
    if interval == 0:
        return rows
    groups: dict[date, list[dict]] = {}
    for r in rows:
        groups.setdefault(_bucket(r["date"], interval), []).append(r)
    out = []
    for key in sorted(groups):
        g = groups[key]
        highs = [r["high"] for r in g if r["high"] is not None]
        lows = [r["low"] for r in g if r["low"] is not None]
        vols = [r["volume"] for r in g if r["volume"] is not None]
        out.append({"date": key if interval == 2 else g[0]["date"], "open": g[0]["open"], "high": max(highs) if highs else None, "low": min(lows) if lows else None, "close": g[-1]["close"], "volume": sum(vols) if vols else None})
    return out


def _scalar(v):
    while isinstance(v, list):
        v = v[0] if v else ""
        if isinstance(v, list) and not v:
            v = ""
    return v


def _blank(v) -> bool:
    return v is None or v == ""


def googlefinance(args: list, fresh: bool = False) -> list[list]:
    args = [_scalar(a) for a in args]
    while args and _blank(args[-1]):
        args.pop()
    if not args or _blank(args[0]):
        raise BadArgument("GOOGLEFINANCE needs a ticker")
    if len(args) > 5:
        raise BadArgument("GOOGLEFINANCE takes at most five arguments")
    symbol = str(args[0]).strip()
    attr = str(args[1]).strip().lower() if len(args) > 1 and not _blank(args[1]) else "price"
    dated = len(args) > 2 and not _blank(args[2])
    if not dated:
        if len(args) > 3:
            raise BadArgument("an end date or day count needs a start date")
        return [[realtime(symbol, attr, fresh)]]
    if attr not in HISTORICAL:
        if attr in REALTIME or attr in FUND_RETURNS or attr in FUND_OTHER:
            raise BadArgument(f"{attr} is a current-value attribute; with dates use open, close, high, low, volume, price or all")
        raise BadArgument(f"{attr!r} is not a GOOGLEFINANCE attribute")
    start = parse_date(args[2])
    end = start
    if len(args) > 3 and not _blank(args[3]):
        e = args[3]
        if isinstance(e, (int, float)) and not isinstance(e, bool) and e < 10000:
            if e < 0:
                raise BadArgument("the number of days cannot be negative")
            end = start + timedelta(days=int(e))
        else:
            end = parse_date(e)
    if end < start:
        raise BadArgument("the end date is before the start date")
    interval = 0
    if len(args) > 4 and not _blank(args[4]):
        iv = args[4]
        if isinstance(iv, str):
            iv = {"DAILY": 1, "WEEKLY": 7}.get(iv.strip().upper())
        if iv not in (1, 7, 1.0, 7.0):
            raise BadArgument('the interval is "DAILY", "WEEKLY", 1 or 7')
        interval = 1 if int(iv) == 7 else 0
    pad = (start.weekday() if interval else 0)
    rows = daily(symbol, start - timedelta(days=pad), end, fresh)
    rows = [r for r in rows if r["date"] >= start - timedelta(days=pad)]
    rows = aggregate(rows, interval)
    if not rows:
        raise NoData(f"No trading data for {symbol} between {start} and {end}")
    cols = {"open": ["Open"], "close": ["Close"], "price": ["Close"], "high": ["High"], "low": ["Low"], "volume": ["Volume"], "all": ["Open", "High", "Low", "Close", "Volume"]}[attr]
    out = [["Date", *cols]]
    for r in rows:
        out.append([serial(r["date"]), *[r[c.lower()] for c in cols]])
    return out


def stockhistory(args: list, fresh: bool = False) -> list[list]:
    args = [_scalar(a) for a in args]
    if len(args) < 2 or _blank(args[0]) or _blank(args[1]):
        raise BadArgument("STOCKHISTORY needs a stock and a start date")
    if len(args) > 11:
        raise BadArgument("STOCKHISTORY takes at most eleven arguments")
    stock = str(args[0]).strip()
    start = parse_date(args[1])
    end = parse_date(args[2]) if len(args) > 2 and not _blank(args[2]) else start

    def opt(i: int, default: int, allowed) -> int:
        if len(args) <= i or _blank(args[i]):
            return default
        v = args[i]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or int(v) not in allowed:
            raise BadArgument(f"argument {i + 1} must be one of {sorted(allowed)}")
        return int(v)

    interval = opt(3, 0, {0, 1, 2})
    headers = opt(4, 1, {0, 1, 2})
    props = [opt(i, -1, {0, 1, 2, 3, 4, 5}) for i in range(5, min(len(args), 11)) if not _blank(args[i])] or [0, 1]
    if end < start:
        raise BadArgument("the end date is before the start date")
    first = _bucket(start, interval)
    rows = aggregate(daily(stock, first, end, fresh), interval)
    rows = [r for r in rows if r["date"] >= first]
    if not rows:
        raise NoData(f"No trading data for {stock} between {start} and {end}")
    names = ["Date", "Close", "Open", "High", "Low", "Volume"]
    keys = ["date", "close", "open", "high", "low", "volume"]
    out: list[list] = []
    if headers == 2:
        out.append([stock.upper(), *[""] * (len(props) - 1)])
    if headers:
        out.append([names[p] for p in props])
    for r in rows:
        out.append([serial(r[keys[p]]) if p == 0 else r[keys[p]] for p in props])
    return out
