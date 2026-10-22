from datetime import date, datetime, timezone

EPOCH = date(1899, 12, 30)


class QuoteError(Exception):
    code = "#N/A"


class NotConfigured(QuoteError):
    pass


class Unavailable(QuoteError):
    pass


class RateLimited(QuoteError):
    pass


class Unsupported(QuoteError):
    pass


class NoData(QuoteError):
    pass


class BadArgument(QuoteError):
    code = "#VALUE!"


class XDate(float):
    pass


class XMoment(float):
    pass


def serial(d: date) -> XDate:
    return XDate((d - EPOCH).days)


def moment(epoch: float) -> XMoment:
    dt = datetime.fromtimestamp(epoch, timezone.utc).replace(tzinfo=None)
    return XMoment((dt - datetime(1899, 12, 30)).total_seconds() / 86400)


def from_serial(n: float) -> date:
    from datetime import timedelta

    return EPOCH + timedelta(days=int(n // 1))


def parse_date(v) -> date:
    if isinstance(v, bool):
        raise BadArgument("a date was expected")
    if isinstance(v, (int, float)):
        if v < 1 or v > 2958465:
            raise BadArgument("the date is out of range")
        return from_serial(float(v))
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d-%m-%Y", "%Y%m%d", "%d %b %Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    try:
        return from_serial(float(s))
    except ValueError:
        raise BadArgument(f"{s!r} is not a date")
