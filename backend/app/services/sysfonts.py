import mmap
import os
import shutil
import struct
import subprocess
import sys
import threading
from pathlib import Path

EXTS = (".ttf", ".otf", ".ttc", ".otc")
MAX_FILES = 20000

_lock = threading.Lock()
_index: list[dict] | None = None


def _decode(rec_platform: int, raw: bytes) -> str:
    try:
        if rec_platform in (0, 3):
            return raw.decode("utf-16-be")
        return raw.decode("mac_roman")
    except Exception:
        return ""


def _names(data: bytes, base: int) -> dict[int, str]:
    if base + 12 > len(data):
        return {}
    num = struct.unpack_from(">H", data, base + 4)[0]
    table = None
    for i in range(num):
        o = base + 12 + i * 16
        if o + 16 > len(data):
            return {}
        tag, _, off, length = struct.unpack_from(">4sIII", data, o)
        if tag == b"name":
            table = (off, length)
            break
    if not table:
        return {}
    off, length = table
    if off + 6 > len(data):
        return {}
    count, str_off = struct.unpack_from(">HH", data, off + 2)
    found: dict[int, tuple[int, str]] = {}
    for i in range(count):
        o = off + 6 + i * 12
        if o + 12 > len(data):
            break
        plat, _enc, lang, nid, ln, so = struct.unpack_from(">HHHHHH", data, o)
        if nid not in (1, 2, 4, 16, 17) or plat not in (0, 1, 3):
            continue
        a = off + str_off + so
        if a + ln > len(data):
            continue
        text = _decode(plat, data[a:a + ln]).strip()
        if not text:
            continue
        rank = 2 if plat == 3 and lang == 0x409 else 1 if plat == 3 else 0
        if nid not in found or rank > found[nid][0]:
            found[nid] = (rank, text)
    return {k: v[1] for k, v in found.items()}


def read_families(path: str) -> list[dict]:
    out: list[dict] = []
    try:
        with open(path, "rb") as fh:
            head = fh.read(12)
            if head[:4] == b"ttcf":
                n = struct.unpack(">I", head[8:12])[0]
                offs = struct.unpack(">%dI" % min(n, 64), fh.read(4 * min(n, 64)))
            else:
                offs = (0,)
            data = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
    except (OSError, ValueError):
        return out
    for i, base in enumerate(offs):
        try:
            nm = _names(data, base)
        except struct.error:
            continue
        fam = nm.get(16) or nm.get(1)
        if not fam or fam.startswith("."):
            continue
        style = (nm.get(17) or nm.get(2) or "Regular").lower()
        out.append({"family": fam, "bold": "bold" in style, "italic": "italic" in style or "oblique" in style, "path": path, "index": i})
    return out


def _dirs() -> list[Path]:
    home = Path.home()
    if sys.platform == "darwin":
        return [Path("/System/Library/Fonts"), Path("/Library/Fonts"), home / "Library/Fonts"]
    if os.name == "nt":
        win = os.environ.get("WINDIR", r"C:\Windows")
        local = os.environ.get("LOCALAPPDATA", str(home / "AppData/Local"))
        return [Path(win) / "Fonts", Path(local) / "Microsoft/Windows/Fonts"]
    return [Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), home / ".local/share/fonts", home / ".fonts"]


def _fc_list() -> list[dict] | None:
    exe = shutil.which("fc-list")
    if not exe or os.name == "nt":
        return None
    try:
        res = subprocess.run([exe, "--format", "%{file}\t%{family}\t%{style}\t%{index}\n"], capture_output=True, text=True, timeout=20)
    except Exception:
        return None
    if res.returncode != 0:
        return None
    out: list[dict] = []
    for line in res.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 4 or not parts[0].lower().endswith(EXTS):
            continue
        style = parts[2].lower()
        try:
            idx = int(parts[3]) & 0xFFFF
        except ValueError:
            idx = 0
        for fam in parts[1].split(","):
            fam = fam.strip()
            if fam and not fam.startswith("."):
                out.append({"family": fam, "bold": "bold" in style, "italic": "italic" in style or "oblique" in style, "path": parts[0], "index": idx})
    return out


def _scan() -> list[dict]:
    out: list[dict] = []
    seen = 0
    for root in _dirs():
        if not root.is_dir():
            continue
        for dirpath, _dirs_, files in os.walk(root, followlinks=True):
            for name in files:
                if name.lower().endswith(EXTS):
                    seen += 1
                    if seen > MAX_FILES:
                        return out
                    out.extend(read_families(os.path.join(dirpath, name)))
    return out


def index(refresh: bool = False) -> list[dict]:
    global _index
    with _lock:
        if _index is None or refresh:
            found = _fc_list()
            _index = found if found else _scan()
        return _index


def families(refresh: bool = False) -> list[str]:
    seen: dict[str, str] = {}
    for f in index(refresh):
        seen.setdefault(f["family"].lower(), f["family"])
    return sorted(seen.values(), key=str.lower)


def find_file(family: str, bold: bool = False, italic: bool = False) -> tuple[str, int] | None:
    want = family.strip().lower()
    cands = [f for f in index() if f["family"].lower() == want]
    if not cands:
        return None

    def score(f: dict) -> tuple[int, int]:
        ttf = 0 if f["path"].lower().endswith((".ttf", ".ttc")) else 1
        return (ttf, (f["bold"] != bold) * 2 + (f["italic"] != italic))

    best = min(cands, key=score)
    return best["path"], best["index"]
