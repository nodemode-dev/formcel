from .. import config
from . import aiclient, secrets

DEFAULTS = {"snapshot_gap": 300, "version_limit": 200, "external_content": True}
LIMITS = {"snapshot_gap": (30, 86400), "version_limit": (5, 1000)}


def values() -> dict:
    saved = aiclient.load_settings().get("app") or {}
    out = dict(DEFAULTS)
    for k, (lo, hi) in LIMITS.items():
        v = saved.get(k)
        if isinstance(v, int) and not isinstance(v, bool):
            out[k] = max(lo, min(hi, v))
    if isinstance(saved.get("external_content"), bool):
        out["external_content"] = saved["external_content"]
    return out


def snapshot_gap() -> int:
    return values()["snapshot_gap"]


def version_limit() -> int:
    return values()["version_limit"]


def external_allowed() -> bool:
    return values()["external_content"]


def public() -> dict:
    return {**values(), "data_dir": str(config.DATA_DIR), "secrets": secrets.where(), "limits": {k: list(v) for k, v in LIMITS.items()}}


def update(patch: dict) -> dict:
    with aiclient.SETTINGS:
        s = aiclient.load_settings()
        app = dict(s.get("app") or {})
        for k, (lo, hi) in LIMITS.items():
            if k in patch and patch[k] is not None:
                app[k] = max(lo, min(hi, int(patch[k])))
        if patch.get("external_content") is not None:
            app["external_content"] = bool(patch["external_content"])
        s["app"] = app
        aiclient.save_settings(s)
    return public()
