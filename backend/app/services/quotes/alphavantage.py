import json
from datetime import date, datetime, timezone

from . import net, settings, symbols
from .model import NoData, NotConfigured, QuoteError, RateLimited, Unsupported

NAME = "alphavantage"


def _call(**params) -> dict:
    key = settings.key_of(NAME)
    if not key:
        raise NotConfigured("Alpha Vantage needs your own API key. Add it under Settings, Market data.")
    text = net.get(NAME, settings.base_of(NAME) + "/query", {**params, "apikey": key})
    try:
        data = json.loads(text)
    except ValueError:
        raise QuoteError("Alpha Vantage answered in a shape FormCel does not read")
    if not isinstance(data, dict):
        raise QuoteError("Alpha Vantage answered in a shape FormCel does not read")
    if "Error Message" in data:
        raise NoData(f"Alpha Vantage: {data['Error Message']}")
    for k in ("Note", "Information"):
        if k in data and len(data) == 1:
            msg = str(data[k])
            if "premium" in msg.lower() and "rate" not in msg.lower() and "per" not in msg.lower():
                raise Unsupported(f"Alpha Vantage: {msg}")
            if "api key" in msg.lower() and "invalid" in msg.lower():
                raise NotConfigured(f"Alpha Vantage: {msg}")
            raise RateLimited(f"Alpha Vantage: {msg}")
    return data


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def quote(symbol: str) -> dict:
    data = _call(function="GLOBAL_QUOTE", symbol=symbols.alpha(symbol))
    q = data.get("Global Quote") or {}
    if not q.get("05. price"):
        raise NoData(f"Alpha Vantage does not know the symbol {symbol}")
    when = None
    try:
        when = datetime.strptime(q["07. latest trading day"], "%Y-%m-%d").replace(hour=21, tzinfo=timezone.utc).timestamp()
    except (KeyError, ValueError):
        pass
    pct = str(q.get("10. change percent", "")).replace("%", "")
    return {"price": _num(q.get("05. price")), "open": _num(q.get("02. open")), "high": _num(q.get("03. high")), "low": _num(q.get("04. low")), "volume": _num(q.get("06. volume")), "prev": _num(q.get("08. previous close")), "change": _num(q.get("09. change")), "changepct": _num(pct), "time": when}


def profile(symbol: str) -> dict:
    d = _call(function="OVERVIEW", symbol=symbols.alpha(symbol))
    if not d.get("Symbol"):
        raise NoData(f"Alpha Vantage has no company overview for {symbol}")
    return {
        "name": d.get("Name"), "exchange": d.get("Exchange"), "currency": d.get("Currency"), "type": d.get("AssetType"), "industry": d.get("Industry"), "description": d.get("Description"),
        "marketcap": _num(d.get("MarketCapitalization")), "pe": _num(d.get("PERatio")), "eps": _num(d.get("EPS")), "beta": _num(d.get("Beta")),
        "high52": _num(d.get("52WeekHigh")), "low52": _num(d.get("52WeekLow")), "shares": _num(d.get("SharesOutstanding")),
    }


def history(symbol: str, start: date, end: date) -> list[dict]:
    sym = symbols.alpha(symbol)
    data = _call(function="TIME_SERIES_DAILY", symbol=sym, outputsize="compact")
    series = data.get("Time Series (Daily)") or {}
    if series and min(series) > start.isoformat() and (date.today() - start).days > 100:
        try:
            full = _call(function="TIME_SERIES_DAILY", symbol=sym, outputsize="full")
            series = full.get("Time Series (Daily)") or series
        except (Unsupported, RateLimited):
            pass
    out = []
    for k, v in series.items():
        try:
            d = datetime.strptime(k, "%Y-%m-%d").date()
        except ValueError:
            continue
        if start <= d <= end:
            out.append({"date": d, "open": _num(v.get("1. open")), "high": _num(v.get("2. high")), "low": _num(v.get("3. low")), "close": _num(v.get("4. close")), "volume": _num(v.get("5. volume"))})
    out.sort(key=lambda x: x["date"])
    if not out:
        raise NoData(f"Alpha Vantage returned no history for {symbol} in that range (free keys carry about 100 trading days)")
    return out


def search(query: str) -> list[dict]:
    data = _call(function="SYMBOL_SEARCH", keywords=query)
    out = []
    for m in data.get("bestMatches") or []:
        out.append({"symbol": m.get("1. symbol"), "name": m.get("2. name"), "type": m.get("3. type"), "exchange": m.get("4. region"), "currency": m.get("8. currency")})
    return out


def fx(base: str, quote_: str) -> dict:
    data = _call(function="CURRENCY_EXCHANGE_RATE", from_currency=base, to_currency=quote_)
    r = data.get("Realtime Currency Exchange Rate") or {}
    rate = _num(r.get("5. Exchange Rate"))
    if rate is None:
        raise NoData(f"Alpha Vantage has no rate for {base}/{quote_}")
    when = None
    try:
        when = datetime.strptime(r["6. Last Refreshed"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except (KeyError, ValueError):
        pass
    return {"rate": rate, "time": when}
