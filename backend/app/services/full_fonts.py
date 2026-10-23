import io
from functools import lru_cache
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

from .. import config

FAMILIES = {"lora": "lora", "merriweather": "merriweather", "playfair-display": "playfairdisplay", "raleway": "raleway", "source-sans-3": "sourcesans3"}


def roots() -> list[Path]:
    out = []
    if config.WINDOW_DIR is not None:
        out.append(Path(config.WINDOW_DIR) / "fonts" / "full")
    out.append(Path(__file__).resolve().parents[3] / "frontend" / "public" / "fonts" / "full")
    return [r for r in out if r.is_dir()]


def _file(slug: str, italic: bool) -> Path | None:
    key = FAMILIES.get(slug)
    if key is None:
        return None
    for root in roots():
        folder = root / key
        if folder.is_dir():
            files = sorted(p for p in folder.glob("*.ttf") if ("Italic" in p.name) == italic)
            return files[0] if files else None
    return None


@lru_cache(maxsize=64)
def _instance(path: str, weight: int) -> bytes:
    font = TTFont(path)
    if "fvar" in font:
        axes = {a.axisTag: a.defaultValue for a in font["fvar"].axes}
        wght = next((a for a in font["fvar"].axes if a.axisTag == "wght"), None)
        if wght is not None:
            axes["wght"] = max(wght.minValue, min(wght.maxValue, float(weight)))
        try:
            font = instantiateVariableFont(font, axes, updateFontNames=True)
        except Exception:
            font = instantiateVariableFont(TTFont(path), axes)
    font.flavor = None
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def face(family: str, bold: bool, italic: bool) -> bytes | None:
    src = _file(family.lower().replace(" ", "-"), italic)
    if src is None:
        return None
    return _instance(str(src), 700 if bold else 400)
