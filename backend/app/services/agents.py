import hmac
import secrets

from . import aiclient

INAPP_TOKEN = secrets.token_urlsafe(24)
INAPP_CLIENT = "Claude Code in FormCel"
INAPP_VAR = "FORMCEL_INAPP_TOKEN"
INAPP_HEADER = "x-formcel-inapp"


def is_inapp(token: str | None) -> bool:
    return bool(token) and hmac.compare_digest(token.encode(), INAPP_TOKEN.encode())


def allowed() -> bool:
    return (aiclient.load_settings().get("agents") or {}).get("allowed") is True


def set_allowed(on: bool) -> bool:
    with aiclient.SETTINGS:
        s = aiclient.load_settings()
        s["agents"] = {**(s.get("agents") or {}), "allowed": bool(on)}
        aiclient.save_settings(s)
    return allowed()
