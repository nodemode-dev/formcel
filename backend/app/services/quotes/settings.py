from .. import aiclient

PROVIDERS = {
    "stooq": {
        "label": "Stooq",
        "needs_key": True,
        "key_help": "Stooq now asks for an API key on its CSV downloads. Open https://stooq.com/q/d/?s=spy.us&get_apikey, solve the captcha and paste the apikey value from the download link.",
        "site": "https://stooq.com",
        "terms": "https://stooq.com/regulamin/",
        "base": "https://stooq.com",
        "rpm": 20,
        "delay": 15,
        "supports": ["quote", "history", "profile52"],
    },
    "alphavantage": {
        "label": "Alpha Vantage",
        "needs_key": True,
        "key_help": "Get a free key at https://www.alphavantage.co/support/#api-key. The free plan allows a few requests a minute and a small number a day.",
        "site": "https://www.alphavantage.co",
        "terms": "https://www.alphavantage.co/terms_of_service/",
        "base": "https://www.alphavantage.co",
        "rpm": 5,
        "delay": 15,
        "supports": ["quote", "history", "profile", "search", "fx"],
    },
    "finnhub": {
        "label": "Finnhub",
        "needs_key": True,
        "key_help": "Get a free key at https://finnhub.io/register. Candle history needs a paid plan.",
        "site": "https://finnhub.io",
        "terms": "https://finnhub.io/terms-of-service",
        "base": "https://finnhub.io/api/v1",
        "rpm": 55,
        "delay": 0,
        "supports": ["quote", "profile", "search", "fx", "history"],
    },
}

ECB = {
    "label": "European Central Bank reference rates",
    "site": "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
    "terms": "https://www.ecb.europa.eu/services/disclaimer/html/index.en.html",
    "base": "https://www.ecb.europa.eu/stats/eurofxref",
    "rpm": 10,
}

DEFAULT_TTL = {"quote": 60, "history": 21600, "profile": 21600, "fx": 3600}
REFRESH_MODES = ("manual", "open", "5min")


def load() -> dict:
    raw = aiclient.load_settings().get("quotes") or {}
    keys = raw.get("keys") if isinstance(raw.get("keys"), dict) else {}
    bases = raw.get("bases") if isinstance(raw.get("bases"), dict) else {}
    ttl = {**DEFAULT_TTL, **{k: v for k, v in (raw.get("ttl") or {}).items() if k in DEFAULT_TTL and isinstance(v, (int, float)) and v >= 0}}
    rpm = {k: int(v) for k, v in (raw.get("rpm") or {}).items() if isinstance(v, (int, float)) and v > 0}
    delay = {k: int(v) for k, v in (raw.get("delay") or {}).items() if isinstance(v, (int, float)) and v >= 0}
    provider = raw.get("provider") if raw.get("provider") in PROVIDERS else ""
    fx = raw.get("fx") if raw.get("fx") in ("ecb", "provider") else "ecb"
    return {"provider": provider, "keys": {k: str(v) for k, v in keys.items() if k in PROVIDERS}, "bases": {k: str(v) for k, v in bases.items() if k in PROVIDERS or k == "ecb"}, "ttl": ttl, "rpm": rpm, "delay": delay, "fx": fx}


def base_of(name: str) -> str:
    s = load()
    over = s["bases"].get(name, "").strip().rstrip("/")
    if over:
        return over
    return (ECB if name == "ecb" else PROVIDERS[name])["base"]


def rpm_of(name: str) -> int:
    s = load()
    return s["rpm"].get(name) or (ECB["rpm"] if name == "ecb" else PROVIDERS[name]["rpm"])


def delay_of(name: str) -> int:
    s = load()
    d = s["delay"].get(name)
    return PROVIDERS[name]["delay"] if d is None else d


def key_of(name: str) -> str:
    return load()["keys"].get(name, "")


def public() -> dict:
    s = load()
    return {
        "provider": s["provider"],
        "fx": s["fx"],
        "ttl": s["ttl"],
        "providers": [
            {
                "id": pid,
                "label": p["label"],
                "needs_key": p["needs_key"],
                "key_set": bool(s["keys"].get(pid)),
                "key_help": p["key_help"],
                "site": p["site"],
                "terms": p["terms"],
                "base": s["bases"].get(pid, ""),
                "default_base": p["base"],
                "rpm": s["rpm"].get(pid) or p["rpm"],
                "delay": delay_of(pid),
                "supports": p["supports"],
            }
            for pid, p in PROVIDERS.items()
        ],
        "ecb": {"label": ECB["label"], "site": ECB["site"], "terms": ECB["terms"], "base": s["bases"].get("ecb", ""), "default_base": ECB["base"]},
    }


def update(body: dict) -> dict:
    s = aiclient.load_settings()
    cur = load()
    provider = body.get("provider", cur["provider"])
    if provider not in PROVIDERS and provider != "":
        raise ValueError("the provider is stooq, alphavantage, finnhub or empty")
    fx = body.get("fx", cur["fx"])
    if fx not in ("ecb", "provider"):
        raise ValueError("exchange rates come from ecb or provider")
    keys = dict(cur["keys"])
    for pid, v in (body.get("keys") or {}).items():
        if pid in PROVIDERS and v is not None:
            if str(v).strip():
                keys[pid] = str(v).strip()
            else:
                keys.pop(pid, None)
    bases = dict(cur["bases"])
    for pid, v in (body.get("bases") or {}).items():
        v = str(v or "").strip()
        if v and not v.lower().startswith(("http://", "https://")):
            raise ValueError("a provider address starts with http:// or https://")
        if v:
            bases[pid] = v
        else:
            bases.pop(pid, None)
    ttl = {**cur["ttl"], **{k: v for k, v in (body.get("ttl") or {}).items() if k in DEFAULT_TTL and isinstance(v, (int, float)) and v >= 0}}
    rpm = {**cur["rpm"], **{k: int(v) for k, v in (body.get("rpm") or {}).items() if isinstance(v, (int, float)) and v > 0}}
    delay = {**cur["delay"], **{k: int(v) for k, v in (body.get("delay") or {}).items() if isinstance(v, (int, float)) and v >= 0}}
    s["quotes"] = {"provider": provider, "fx": fx, "keys": keys, "bases": bases, "ttl": ttl, "rpm": rpm, "delay": delay}
    aiclient.save_settings(s)
    from . import cache

    cache.clear()
    return public()
