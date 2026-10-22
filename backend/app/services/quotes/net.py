import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque

from . import settings
from .model import NotConfigured, QuoteError, RateLimited, Unavailable

TIMEOUT = 12
MAX_WAIT = 20.0
MAX_BYTES = 12 * 1024 * 1024
_lock = threading.Lock()
_calls: dict[str, deque] = {}
counts: dict[str, int] = {}


def pace(provider: str) -> None:
    limit = settings.rpm_of(provider)
    deadline = time.time() + MAX_WAIT
    while True:
        with _lock:
            q = _calls.setdefault(provider, deque())
            now = time.time()
            while q and now - q[0] >= 60:
                q.popleft()
            if len(q) < limit:
                q.append(now)
                counts[provider] = counts.get(provider, 0) + 1
                return
            wait = 60 - (now - q[0])
        if time.time() + wait > deadline:
            raise RateLimited(f"{provider} allows {limit} requests a minute and that limit is used up; try again in {int(wait) + 1} seconds")
        time.sleep(min(wait, 1.0))


def get(provider: str, url: str, params: dict | None = None, headers: dict | None = None) -> str:
    q = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None and v != ""})
    full = url + (("&" if "?" in url else "?") + q if q else "")
    pace(provider)
    req = urllib.request.Request(full, headers={"User-Agent": "FormCel/0.37 (+local spreadsheet)", "Accept": "*/*", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read(MAX_BYTES + 1)
            ctype = r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise NotConfigured(f"{provider} refused the request ({e.code}). Check the key in Settings, Market data, or whether your plan includes this data.")
        if e.code == 429:
            raise RateLimited(f"{provider} says the request limit is reached (429). Wait a minute or use another provider.")
        raise QuoteError(f"{provider} answered {e.code}")
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        reason = getattr(e, "reason", e)
        raise Unavailable(f"The network is unavailable or {provider} did not answer: {reason}")
    if len(body) > MAX_BYTES:
        raise QuoteError(f"{provider} sent more than 12 MB")
    m = re.search(r"charset=([\w-]+)", ctype, re.I)
    try:
        return body.decode(m.group(1) if m else "utf-8", errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")
