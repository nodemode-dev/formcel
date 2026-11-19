import json
import threading

from .. import config

FILE = "trust.json"
KINDS = ("external", "scripts")
BLOCKED = "This workbook asks to read files or web pages. Answer the question in the FormCel window."
_lock = threading.Lock()
wanting: set[str] = set()


def _read() -> dict:
    try:
        data = json.loads((config.DATA_DIR / FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def get(wid: str | None) -> dict:
    entry = _read().get(str(wid or ""))
    return {k: entry.get(k) for k in KINDS if isinstance(entry, dict) and isinstance(entry.get(k), bool)}


def allows(wid: str | None, kind: str) -> bool:
    return get(wid).get(kind) is True


def external(wid: str | None) -> bool:
    from . import appsettings

    if appsettings.external_allowed() and allows(wid, "external"):
        return True
    if wid and "external" not in get(wid):
        wanting.add(str(wid))
    return False


def put(wid: str, patch: dict) -> dict:
    with _lock:
        data = _read()
        entry = dict(data.get(wid) or {})
        for k in KINDS:
            if isinstance(patch.get(k), bool):
                entry[k] = patch[k]
        data[wid] = entry
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        (config.DATA_DIR / FILE).write_text(json.dumps(data, indent=1), encoding="utf-8")
    wanting.discard(wid)
    return get(wid)
