from datetime import date, datetime
from xml.etree import ElementTree as ET

from . import cache, net, settings
from .model import NoData, QuoteError

NAME = "ecb"
FEEDS = {"daily": "eurofxref-daily.xml", "90d": "eurofxref-hist-90d.xml", "all": "eurofxref-hist.xml"}


def _load(feed: str, fresh: bool) -> dict[date, dict[str, float]]:
    key = f"ecb:{feed}"
    ttl = settings.load()["ttl"]["fx"]
    hit = cache.get(key, ttl, fresh)
    if hit is not None:
        return hit
    text = net.get(NAME, settings.base_of(NAME) + "/" + FEEDS[feed])
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError:
        raise QuoteError("The European Central Bank answered with something that is not its rates feed")
    days: dict[date, dict[str, float]] = {}
    for el in root.iter():
        if el.tag.rsplit("}", 1)[-1] != "Cube" or "time" not in el.attrib:
            continue
        try:
            d = datetime.strptime(el.attrib["time"], "%Y-%m-%d").date()
        except ValueError:
            continue
        rates = {"EUR": 1.0}
        for c in el:
            if "currency" in c.attrib and "rate" in c.attrib:
                try:
                    rates[c.attrib["currency"].upper()] = float(c.attrib["rate"])
                except ValueError:
                    continue
        days[d] = rates
    if not days:
        raise NoData("The European Central Bank feed held no rates")
    cache.put(key, days)
    return days


def _cross(rates: dict[str, float], base: str, quote: str) -> float:
    if base not in rates or quote not in rates:
        missing = base if base not in rates else quote
        raise NoData(f"The European Central Bank publishes no rate for {missing}. It covers about 30 currencies against the euro.")
    return round(rates[quote] / rates[base], 6)


def currencies(fresh: bool = False) -> list[str]:
    days = _load("daily", fresh)
    return sorted(next(iter(days.values())))


def latest(base: str, quote: str, fresh: bool = False) -> dict:
    days = _load("daily", fresh)
    d = max(days)
    return {"rate": _cross(days[d], base, quote), "date": d}


def at(base: str, quote: str, day: date, fresh: bool = False) -> dict:
    feed = "90d" if (date.today() - day).days <= 85 else "all"
    days = _load(feed, fresh)
    ok = [d for d in days if d <= day]
    if not ok:
        raise NoData(f"The European Central Bank has no rate on or before {day}")
    d = max(ok)
    return {"rate": _cross(days[d], base, quote), "date": d}


def series(base: str, quote: str, start: date, end: date, fresh: bool = False) -> list[dict]:
    feed = "90d" if (date.today() - start).days <= 85 else "all"
    days = _load(feed, fresh)
    out = []
    for d in sorted(days):
        if start <= d <= end:
            try:
                r = _cross(days[d], base, quote)
            except NoData:
                continue
            out.append({"date": d, "open": r, "high": r, "low": r, "close": r, "volume": None})
    if not out:
        raise NoData(f"The European Central Bank has no {base}/{quote} rates between {start} and {end}")
    return out
