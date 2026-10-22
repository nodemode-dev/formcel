import re

US = {"NASDAQ", "NYSE", "AMEX", "NYSEARCA", "NYSEAMERICAN", "NYSEMKT", "XNAS", "XNYS", "ARCX", "BATS", "XASE", "BATY", "OTC", "OTCMKTS", "XNMS", "XNGS", "XNCM"}
STOOQ = {"LON": "uk", "LSE": "uk", "XLON": "uk", "ETR": "de", "XETR": "de", "FRA": "de", "TSE": "jp", "TYO": "jp", "XTKS": "jp", "WSE": "pl", "XWAR": "pl", "HKG": "hk", "XHKG": "hk", "EPA": "fr", "TSX": "ca", "XTSE": "ca"}
ALPHA = {"LON": "LON", "LSE": "LON", "XLON": "LON", "TSE": "TRT", "TSX": "TRT", "XTSE": "TRT", "ETR": "DEX", "XETR": "DEX", "FRA": "FRK", "EPA": "PAR", "HKG": "HKG", "XHKG": "HKG", "TYO": "TYO", "BOM": "BSE", "NSE": "BSE", "ASX": "AX", "XASX": "AX"}
FINNHUB = {"LON": "L", "LSE": "L", "XLON": "L", "TSX": "TO", "TSE": "TO", "XTSE": "TO", "ETR": "DE", "XETR": "DE", "FRA": "F", "EPA": "PA", "HKG": "HK", "XHKG": "HK", "TYO": "T", "ASX": "AX", "XASX": "AX"}
CURRENCY = re.compile(r"^[A-Za-z]{3}$")


def split(sym: str) -> tuple[str, str]:
    s = str(sym or "").strip()
    if ":" in s:
        ex, _, t = s.partition(":")
        return ex.strip().upper(), t.strip()
    return "", s


def currency_pair(sym: str) -> tuple[str, str] | None:
    s = str(sym or "").strip()
    up = s.upper()
    if up.startswith("CURRENCY:"):
        body = up[9:].replace("/", "").replace("-", "").strip()
        if len(body) == 6 and body.isalpha():
            return body[:3], body[3:]
        raise ValueError(f"{s} is not a currency pair like CURRENCY:USDEUR")
    m = re.fullmatch(r"([A-Za-z]{3})/([A-Za-z]{3})", s)
    if m:
        return m.group(1).upper(), m.group(2).upper()
    return None


def stooq(sym: str) -> str:
    ex, t = split(sym)
    t = t.lower()
    if t.startswith("^") or "." in t:
        return t
    return f"{t}.{STOOQ.get(ex, 'us')}"


def alpha(sym: str) -> str:
    ex, t = split(sym)
    t = t.upper()
    if "." in t or not ex or ex in US:
        return t
    return f"{t}.{ALPHA[ex]}" if ex in ALPHA else t


def finnhub(sym: str) -> str:
    ex, t = split(sym)
    t = t.upper()
    if "." in t or not ex or ex in US:
        return t
    return f"{t}.{FINNHUB[ex]}" if ex in FINNHUB else t
