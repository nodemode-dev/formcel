import hashlib
import io
import struct
import zlib
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from .. import config
from . import full_fonts, sysfonts

DEFAULTS = {"", "inter", "aptos narrow", "helvetica", "arial"}


def woff_to_ttf(data: bytes) -> bytes:
    if data[:4] != b"wOFF":
        raise ValueError("not a WOFF file")
    flavor, _length, num = struct.unpack(">4sIH", data[4:14])
    tables = []
    for i in range(num):
        tag, off, comp, orig, _sum = struct.unpack(">4sIIII", data[44 + i * 20:64 + i * 20])
        blob = data[off:off + comp]
        if comp < orig:
            blob = zlib.decompress(blob)
        tables.append((tag, blob))
    tables.sort(key=lambda t: t[0])
    head = struct.pack(">4sHHHH", flavor, num, 0, 0, 0)
    pos = 12 + 16 * num
    directory = b""
    body = b""
    for tag, blob in tables:
        padded = blob + b"\0" * (-len(blob) % 4)
        words = struct.unpack(">%dI" % (len(padded) // 4), padded)
        directory += struct.pack(">4sIII", tag, sum(words) & 0xFFFFFFFF, pos + len(body), len(blob))
        body += padded
    return head + directory + body


def _bundled_file(family: str, bold: bool, italic: bool) -> Path | None:
    slug = family.lower().replace(" ", "-")
    roots = []
    if config.WINDOW_DIR is not None:
        roots.append(Path(config.WINDOW_DIR) / "assets")
    roots.append(Path(__file__).resolve().parents[3] / "frontend" / "node_modules" / "@fontsource" / slug / "files")
    for want_w, want_s in ((("700" if bold else "400"), ("italic" if italic else "normal")), ("400", "normal")):
        for root in roots:
            if root.is_dir():
                hit = sorted(root.glob(f"{slug}-latin-{want_w}-{want_s}*.woff"))
                if hit:
                    return hit[0]
    return None


class PdfFonts:
    def __init__(self, base: dict[str, str], theme: tuple[str, str]):
        self.base = base
        self.theme = theme
        self.missing: list[str] = []
        self.embedded: list[str] = []
        self.cache: dict[tuple[str, bool, bool], str] = {}

    def resolve(self, name: str) -> str:
        return self.theme[0] if name == "+heading" else self.theme[1] if name == "+body" else name

    def _register(self, name: str, bold: bool, italic: bool) -> str | None:
        fid = "FC" + hashlib.sha1(f"{name}|{bold}|{italic}".encode()).hexdigest()[:12]
        if fid in pdfmetrics.getRegisteredFontNames():
            return fid
        found = sysfonts.find_file(name, bold, italic)
        try:
            if found and found[0].lower().endswith((".ttf", ".ttc")):
                pdfmetrics.registerFont(TTFont(fid, found[0], subfontIndex=found[1]))
                return fid
        except Exception:
            pass
        try:
            full = full_fonts.face(name, bold, italic)
            if full is not None:
                pdfmetrics.registerFont(TTFont(fid, io.BytesIO(full)))
                return fid
        except Exception:
            pass
        try:
            hit = _bundled_file(name, bold, italic)
            if hit is not None:
                pdfmetrics.registerFont(TTFont(fid, io.BytesIO(woff_to_ttf(hit.read_bytes()))))
                return fid
        except Exception:
            pass
        return None

    def face(self, name: str | None, bold: bool, italic: bool) -> str:
        slot = "b" if bold and not italic else "i" if italic and not bold else "bi" if bold and italic else "r"
        if not name:
            return self.base[slot]
        real = self.resolve(name)
        if real.lower() in DEFAULTS:
            return self.base[slot]
        key = (real, bold, italic)
        if key not in self.cache:
            fid = self._register(real, bold, italic)
            if fid is None:
                if real not in self.missing:
                    self.missing.append(real)
            elif real not in self.embedded:
                self.embedded.append(real)
            self.cache[key] = fid or self.base[slot]
        return self.cache[key]

    def note(self) -> str:
        if not self.missing:
            return ""
        return "Not found on this computer, printed in the default font instead: " + ", ".join(self.missing)
