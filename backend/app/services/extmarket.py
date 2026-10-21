import base64
import hashlib
import json
import re
from urllib.parse import urljoin

from . import aiclient, extpkg, webdata

META = ".market.json"
MAX_INDEX = 2 * 1024 * 1024


class MarketError(Exception):
    pass


def settings() -> dict:
    s = aiclient.load_settings().get("registry") or {}
    return {"url": str(s.get("url") or ""), "key": str(s.get("key") or ""), "require_signature": bool(s.get("require_signature"))}


def save(url: str, key: str, require_signature: bool) -> dict:
    url = url.strip()
    if url and not url.lower().startswith(("http://", "https://")):
        raise MarketError("the registry address must start with http:// or https://")
    key = key.strip()
    if key:
        try:
            raw = base64.b64decode(key, validate=True)
        except ValueError:
            raise MarketError("the publisher key must be base64 text")
        if len(raw) != 32:
            raise MarketError("the publisher key must be a 32 byte Ed25519 public key")
    all_ = aiclient.load_settings()
    if url or key:
        all_["registry"] = {"url": url, "key": key, "require_signature": require_signature}
    else:
        all_.pop("registry", None)
    aiclient.save_settings(all_)
    return settings()


def version_key(v: str) -> tuple:
    return tuple(int(x) if x.isdigit() else 0 for x in re.split(r"[.\-+]", str(v or "0")))


def fingerprint(key_b64: str) -> str:
    try:
        return hashlib.sha256(base64.b64decode(key_b64)).hexdigest()[:16]
    except ValueError:
        return ""


def load_index(url: str) -> dict:
    if not url:
        raise MarketError("set a registry address first")
    try:
        body, _ = webdata.fetch(url, True)
    except webdata.FetchError as e:
        raise MarketError(f"the registry could not be read: {e}")
    if len(body) > MAX_INDEX:
        raise MarketError("the registry index is larger than 2 MB")
    try:
        doc = json.loads(body.decode("utf-8-sig"))
    except ValueError as e:
        raise MarketError(f"the registry is not valid JSON: {e}")
    items = doc.get("extensions") if isinstance(doc, dict) else doc if isinstance(doc, list) else None
    if not isinstance(items, list):
        raise MarketError("the registry needs an extensions list")
    clean = []
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("id"), str) or not isinstance(it.get("name"), str) or not isinstance(it.get("url"), str):
            continue
        clean.append({
            "id": it["id"], "name": it["name"], "version": str(it.get("version", "")), "description": str(it.get("description", "")),
            "author": str(it.get("author", "")), "category": str(it.get("category") or "Other"), "tags": [str(t) for t in it.get("tags", []) if isinstance(t, str)][:12],
            "url": urljoin(url, it["url"]), "sha256": str(it.get("sha256", "")).lower(), "signature": str(it.get("signature", "")),
            "size": it.get("size") if isinstance(it.get("size"), int) else None, "homepage": str(it.get("homepage", "")),
        })
    return {"name": str(doc.get("name", "")) if isinstance(doc, dict) else "", "key": str(doc.get("publisher_key", "")) if isinstance(doc, dict) else "", "extensions": clean}


def installed_map() -> dict[str, dict]:
    out = {}
    base = extpkg.root()
    for m in base.glob(f"*/{META}") if base.is_dir() else []:
        try:
            meta = json.loads(m.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        out[meta.get("registry_id", "")] = {"folder": m.parent.name, **meta}
    return out


def catalog(q: str = "", category: str = "") -> dict:
    s = settings()
    idx = load_index(s["url"])
    have = installed_map()
    items = []
    for it in idx["extensions"]:
        h = have.get(it["id"])
        status = "available"
        if h:
            status = "update" if version_key(it["version"]) > version_key(h.get("version", "")) else "installed"
        items.append({**{k: v for k, v in it.items() if k not in ("signature",)}, "signed": bool(it["signature"]), "status": status, "installedVersion": h.get("version") if h else None, "folder": h.get("folder") if h else None})
    cats = sorted({i["category"] for i in items})
    words = [w for w in re.split(r"\s+", q.lower().strip()) if w]
    if words:
        def hay(i):
            return " ".join([i["name"], i["description"], i["author"], i["category"], " ".join(i["tags"])]).lower()
        items = [i for i in items if all(w in hay(i) for w in words)]
    if category:
        items = [i for i in items if i["category"].lower() == category.lower()]
    items.sort(key=lambda i: (i["status"] != "update", i["name"].lower()))
    return {"registry": {"url": s["url"], "name": idx["name"], "key": idx["key"], "pinned": bool(s["key"]), "requireSignature": s["require_signature"]}, "categories": cats, "items": items}


def check_signature(data: bytes, signature: str, key_b64: str) -> bool:
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        raise MarketError("checking signatures needs the cryptography package")
    try:
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(key_b64))
        pub.verify(base64.b64decode(signature), data)
        return True
    except (InvalidSignature, ValueError):
        return False


def verify(data: bytes, entry: dict, idx: dict, s: dict) -> str:
    if not entry["sha256"]:
        raise MarketError("the registry lists no SHA-256 hash for this package, so it was not installed")
    if hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise MarketError("the downloaded package does not match its SHA-256 hash, so it was not installed")
    if s["key"]:
        if not entry["signature"]:
            raise MarketError("the package is not signed and a publisher key is pinned, so it was not installed")
        if not check_signature(data, entry["signature"], s["key"]):
            raise MarketError("the package signature does not match the pinned publisher key, so it was not installed")
        return "verified"
    if s["require_signature"]:
        raise MarketError("signatures are required but no publisher key is pinned; pin the publisher key first")
    if entry["signature"] and idx["key"]:
        if not check_signature(data, entry["signature"], idx["key"]):
            raise MarketError("the package signature does not match the registry's key, so it was not installed")
        return "signed by the registry key (not pinned)"
    return "hash only"


def install(ext_id: str) -> dict:
    s = settings()
    idx = load_index(s["url"])
    entry = next((e for e in idx["extensions"] if e["id"] == ext_id), None)
    if entry is None:
        raise MarketError(f"the registry has no extension {ext_id}")
    try:
        data, _ = webdata.fetch(entry["url"], True)
    except webdata.FetchError as e:
        raise MarketError(f"the package could not be downloaded: {e}")
    trust = verify(data, entry, idx, s)
    try:
        d = extpkg.from_zip(data)
    except extpkg.PackageError as e:
        raise MarketError(f"the package was not installed: {e}")
    (extpkg.root() / d["id"] / META).write_text(json.dumps({"registry_id": entry["id"], "version": entry["version"], "sha256": entry["sha256"], "trust": trust, "registry": s["url"]}), "utf-8")
    return {**d, "trust": trust, "registryVersion": entry["version"]}
