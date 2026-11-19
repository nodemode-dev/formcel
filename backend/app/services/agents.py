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


def choice() -> str:
    held = state().get("agents") or {}
    return "blocked" if held.get("blocked") is True else "allowed" if held.get("allowed") is True else "ask"


def allowed() -> bool:
    return choice() == "allowed"


def blocked() -> bool:
    return choice() == "blocked"


def set_choice(value: str) -> str:
    from . import seal

    with aiclient.SETTINGS:
        s = aiclient.load_settings()
        held = {k: v for k, v in (s.get("agents") or {}).items() if k != "blocked"}
        s["agents"] = {**held, "allowed": value == "allowed"} | ({"blocked": True} if value == "blocked" else {})
        aiclient.save_settings(seal.sign(s))
    return choice()


def set_allowed(on: bool) -> bool:
    set_choice("allowed" if on else "blocked" if blocked() else "ask")
    return allowed()
