import base64
import re
import urllib.request

from openpyxl.utils import get_column_letter

from .. import appsettings

MARK = "IMG\t"
LIMIT = 8_000_000
KINDS = {"image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/bmp": "bmp", "image/webp": "webp"}
SNIFF = ((b"\x89PNG", "png"), (b"\xff\xd8", "jpeg"), (b"GIF8", "gif"), (b"BM", "bmp"))


def _kind(blob: bytes, hint: str) -> str | None:
    for magic, kind in SNIFF:
        if blob.startswith(magic):
            return kind
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "webp"
    return KINDS.get(hint)


def _fetch(url: str) -> tuple[bytes, str] | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FormCel"})
        with urllib.request.urlopen(req, timeout=3) as r:
            blob = r.read(LIMIT + 1)
            hint = r.headers.get_content_type()
    except (OSError, ValueError):
        return None
    kind = _kind(blob, hint) if len(blob) <= LIMIT else None
    return (blob, kind) if kind else None


def _data(uri: str) -> tuple[bytes, str] | None:
    m = re.match(r"data:(image/[a-z+.-]+)(?:;[^,]*)?;base64,(.*)$", uri, re.S | re.I)
    if not m:
        return None
    try:
        blob = base64.b64decode(m.group(2))
    except ValueError:
        return None
    kind = _kind(blob, m.group(1).lower())
    return (blob, kind) if kind else None


def collect(eng, plans: dict[int, dict]) -> None:
    cache: dict[str, tuple[bytes, str] | None] = {}
    for i in range(len(eng.sheet_names())):
        for r, c, text in eng.values(i):
            if not text.startswith(MARK):
                continue
            source = text.split("\t", 5)[-1]
            if source not in cache:
                cache[source] = _data(source) if source.lower().startswith("data:") else (_fetch(source) if appsettings.external_allowed() else None)
            got = cache[source]
            if got is None:
                continue
            plan = plans.setdefault(i, {"alts": {"charts": [], "pics": []}, "macros": {"pics": []}, "shapes": [], "sparks": [], "cellpics": []})
            item = {"ref": f"{get_column_letter(c + 1)}{r + 1}", "data": got[0], "ext": got[1], "formula": True}
            if not source.lower().startswith("data:"):
                item["url"] = source
            plan["cellpics"].append(item)
