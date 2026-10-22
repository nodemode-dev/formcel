import json
from datetime import date, datetime, timezone

from . import net, settings, symbols
from .model import NoData, NotConfigured, QuoteError, Unsupported

NAME = "finnhub"


def _call(path: str, **params):
    key = settings.key_of(NAME)
    if not key:
        raise NotConfigured("Finnhub needs your own API key. Add it under Settings, Market data.")
    try:
        text = net.get(NAME, settings.base_of(NAME) + path, params, {"X-Finnhub-Token": key})
    except NotConfigured:
        if path == "/stock/candle":
            raise Unsupported("Finnhub's free plan does not include candle history; use Stooq or Alpha Vantage for history, or a paid Finnhub plan")
        raise
    try:
        data = json.loads(text)
    except ValueError:
        raise QuoteError("Finnhub answered in a shape FormCel does not read")
    if isinstance(data, dict) and data.get("error"):
        raise QuoteError(f"Finnhub: {data['error']}")
    return data


def _num(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def quote(symbol: str) -> dict:
    q = _call("/quote", symbol=symbols.finnhub(symbol))
    if not isinstance(q, dict) or not q.get("c") and not q.get("pc"):
        raise NoData(f"Finnhub does not know the symbol {symbol}")
    return {"price": _num(q.get("c")), "open": _num(q.get("o")), "high": _num(q.get("h")), "low": _num(q.get("l")), "prev": _num(q.get("pc")), "change": _num(q.get("d")), "changepct": _num(q.get("dp")), "time": _num(q.get("t"))}


def profile(symbol: str) -> dict:
    sym = symbols.finnhub(symbol)
    p = _call("/stock/profile2", symbol=sym)
    if not isinstance(p, dict) or not p:
        raise NoData(f"Finnhub has no company profile for {symbol}")
    m = _call("/stock/metric", symbol=sym, metric="all")
    met = (m or {}).get("metric") or {}
    cap = _num(p.get("marketCapitalization"))
    shares = _num(p.get("shareOutstanding"))
    return {
        "name": p.get("name"), "exchange": p.get("exchange"), "currency": p.get("currency"), "industry": p.get("finnhubIndustry"), "type": "Common Stock",
        "marketcap": cap * 1e6 if cap is not None else None, "shares": shares * 1e6 if shares is not None else None,
        "pe": _num(met.get("peBasicExclExtraTTM") or met.get("peTTM")), "eps": _num(met.get("epsBasicExclExtraItemsTTM") or met.get("epsTTM")), "beta": _num(met.get("beta")),
        "high52": _num(met.get("52WeekHigh")), "low52": _num(met.get("52WeekLow")), "volumeavg": (_num(met.get("10DayAverageTradingVolume")) or 0) * 1e6 or None,
    }


def history(symbol: str, start: date, end: date) -> list[dict]:
    lo = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp())
    hi = int(datetime(end.year, end.month, end.day, 23, 59, 59, tzinfo=timezone.utc).timestamp())
    c = _call("/stock/candle", symbol=symbols.finnhub(symbol), resolution="D", **{"from": lo, "to": hi})
    if not isinstance(c, dict) or c.get("s") != "ok":
        raise NoData(f"Finnhub returned no candles for {symbol} in that range")
    out = []
    for i, t in enumerate(c.get("t") or []):
        out.append({"date": datetime.fromtimestamp(t, timezone.utc).date(), "open": _num(c["o"][i]), "high": _num(c["h"][i]), "low": _num(c["l"][i]), "close": _num(c["c"][i]), "volume": _num(c["v"][i])})
    out.sort(key=lambda x: x["date"])
    return out


def search(query: str) -> list[dict]:
    d = _call("/search", q=query)
    out = []
    for m in (d or {}).get("result") or []:
        out.append({"symbol": m.get("symbol"), "name": m.get("description"), "type": m.get("type"), "exchange": "", "currency": ""})
    return out


def fx(base: str, quote_: str) -> dict:
    d = _call("/forex/rates", base=base)
    r = ((d or {}).get("quote") or {}).get(quote_)
    if r is None:
        raise NoData(f"Finnhub has no rate for {base}/{quote_}")
    return {"rate": float(r), "time": None}
