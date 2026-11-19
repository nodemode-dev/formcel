import hmac
import secrets

from . import aiclient

INAPP_CLIENT = "Claude Code in FormCel"
INAPP_VAR = "FORMCEL_INAPP_TOKEN"
INAPP_HEADER = "x-formcel-inapp"
_live: dict[str, str] = {}


def mint(slot: str) -> str:
    token = secrets.token_urlsafe(24)
    _live[slot] = token
    return token


def revoke(token: str | None) -> None:
    for slot, value in list(_live.items()):
        if token and hmac.compare_digest(value.encode(), token.encode()):
            _live.pop(slot, None)


def drop(slot: str) -> None:
    _live.pop(slot, None)


def is_inapp(token: str | None) -> bool:
    return bool(token) and any(hmac.compare_digest(token.encode(), value.encode()) for value in list(_live.values()))


def state() -> dict:
    from . import seal

    return seal.effective(aiclient.load_settings())


def allowed() -> bool:
    return (state().get("agents") or {}).get("allowed") is True


def set_allowed(on: bool) -> bool:
    from . import seal

    with aiclient.SETTINGS:
        s = aiclient.load_settings()
        s["agents"] = {**(s.get("agents") or {}), "allowed": bool(on)}
        aiclient.save_settings(seal.sign(s))
    return allowed()
