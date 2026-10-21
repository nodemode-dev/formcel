import re
import threading
from pathlib import Path

from .. import config

DICT_DIR = Path(__file__).resolve().parent.parent / "dictionaries"
LETTERS = "abcdefghijklmnopqrstuvwxyz'"
WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*")
SKIP = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:https?://|www\.)\S+")
MAX_CELLS = 200000
MAX_USER_WORDS = 20000

_lock = threading.Lock()
_words: set[str] | None = None
_user: set[str] | None = None


def _rules(aff: str) -> dict[str, list[tuple[str, bool, str, str, re.Pattern]]]:
    out: dict[str, list] = {}
    cross: dict[tuple[str, str], bool] = {}
    for line in aff.splitlines():
        p = line.split()
        if len(p) == 4 and p[0] in ("PFX", "SFX") and p[2] in ("Y", "N"):
            cross[(p[0], p[1])] = p[2] == "Y"
        elif len(p) >= 5 and p[0] in ("PFX", "SFX") and (p[0], p[1]) in cross:
            strip = "" if p[2] == "0" else p[2]
            add = "" if p[3] == "0" else p[3].split("/")[0]
            cond = p[4]
            rx = re.compile(("^" + cond) if p[0] == "PFX" else (cond + "$"))
            out.setdefault(p[1], []).append((p[0], cross[(p[0], p[1])], strip, add, rx))
    return out


def _load() -> set[str]:
    aff = (DICT_DIR / "en_US.aff").read_text(encoding="utf-8")
    rules = _rules(aff)
    only = {line.split()[1] for line in aff.splitlines() if line.startswith("ONLYINCOMPOUND")}
    words: set[str] = set()
    lines = (DICT_DIR / "en_US.dic").read_text(encoding="utf-8").splitlines()
    for line in lines[1:]:
        entry = line.split()[0] if line.strip() else ""
        if not entry:
            continue
        word, _, flags = entry.partition("/")
        if only & set(flags):
            continue
        words.add(word)
        sfx: list[str] = []
        pfx = []
        for f in flags:
            for kind, cross, strip, add, rx in rules.get(f, ()):
                if kind == "PFX" and cross:
                    pfx.append((strip, add, rx))
                if not rx.search(word):
                    continue
                if kind == "SFX":
                    if strip and not word.endswith(strip):
                        continue
                    form = (word[: len(word) - len(strip)] if strip else word) + add
                    if cross:
                        sfx.append(form)
                    words.add(form)
                else:
                    if strip and not word.startswith(strip):
                        continue
                    words.add(add + word[len(strip):])
        for sf in sfx:
            for strip, add, rx in pfx:
                if rx.search(sf) and (not strip or sf.startswith(strip)):
                    words.add(add + sf[len(strip):])
    return words


def words() -> set[str]:
    global _words
    with _lock:
        if _words is None:
            _words = _load()
        return _words


def _user_file() -> Path:
    return config.DATA_DIR / "user-dictionary.txt"


def user_words() -> set[str]:
    global _user
    with _lock:
        if _user is None:
            try:
                _user = {w.strip().lower() for w in _user_file().read_text(encoding="utf-8").splitlines() if w.strip()}
            except OSError:
                _user = set()
        return _user


def listed() -> list[str]:
    return sorted(user_words())


def add(word: str) -> list[str]:
    w = word.strip().lower().replace("’", "'")
    if not WORD.fullmatch(w):
        raise ValueError("A dictionary word is letters only.")
    have = user_words()
    if len(have) >= MAX_USER_WORDS and w not in have:
        raise ValueError("The user dictionary is full.")
    with _lock:
        have.add(w)
        _save(have)
    return sorted(have)


def remove(word: str) -> list[str]:
    have = user_words()
    with _lock:
        have.discard(word.strip().lower())
        _save(have)
    return sorted(have)


def _save(have: set[str]) -> None:
    f = _user_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text("\n".join(sorted(have)) + ("\n" if have else ""), encoding="utf-8")
    tmp.replace(f)


def known(word: str) -> bool:
    w = word.replace("’", "'")
    base = words()
    if w in base or w.lower() in user_words():
        return True
    low = w.lower()
    if w != low and (low in base or low.capitalize() in base):
        return w.isupper() or w == w.capitalize() or low in base
    return False


def _skipped(word: str) -> bool:
    return len(word) < 2 or word.isupper() or (word[1:] != word[1:].lower() and not word.isupper())


def check(cells: list[tuple[int, int, str]]) -> list[dict]:
    issues = []
    for r, c, text in cells[:MAX_CELLS]:
        if not text or text.startswith("="):
            continue
        masked = SKIP.sub(lambda m: " " * len(m.group()), text)
        for m in WORD.finditer(masked):
            w = m.group()
            if _skipped(w) or known(w):
                continue
            issues.append({"r": r, "c": c, "start": m.start(), "end": m.end(), "word": w})
    return issues


def _edits1(w: str) -> set[str]:
    splits = [(w[:i], w[i:]) for i in range(len(w) + 1)]
    out = {a + b[1:] for a, b in splits if b}
    out |= {a + b[1] + b[0] + b[2:] for a, b in splits if len(b) > 1}
    out |= {a + ch + b[1:] for a, b in splits if b for ch in LETTERS}
    out |= {a + ch + b for a, b in splits for ch in LETTERS}
    return out


def suggest(word: str, limit: int = 8) -> list[str]:
    w = word.replace("’", "'")
    low = w.lower()
    base = words()
    found: dict[str, int] = {}
    for e in _edits1(low):
        if e in base:
            found[e] = 1
        elif e.capitalize() in base:
            found[e.capitalize()] = 1
    if len(found) < limit and len(low) <= 12:
        for e1 in _edits1(low):
            for e2 in _edits1(e1):
                if e2 in base and e2 not in found:
                    found[e2] = 2
                    if len(found) >= 40:
                        break
            if len(found) >= 40:
                break

    def rank(item: tuple[str, int]) -> tuple:
        cand, d = item
        c = cand.lower()
        swap = len(c) == len(low) and any(c[:i] + low[i + 1] + low[i] + c[i + 2:] == c and low[:i] + low[i + 1] + low[i] + low[i + 2:] == c for i in range(len(low) - 1))
        kind = 0 if swap else 1 if len(c) == len(low) else 2 if len(c) > len(low) else 3
        return (d, kind, 0 if c[:1] == low[:1] else 1, abs(len(c) - len(low)), c)

    out = []
    for cand, _ in sorted(found.items(), key=rank):
        if cand.lower() == low:
            continue
        out.append(cand.upper() if w.isupper() and len(w) > 1 else cand.capitalize() if w[:1].isupper() else cand)
        if len(out) >= limit:
            break
    return out
