import shutil
import statistics
import subprocess
import tempfile
from pathlib import Path


class OcrUnavailable(Exception):
    pass


class OcrError(Exception):
    pass


def binary() -> str | None:
    return shutil.which("tesseract")


def status() -> dict:
    exe = binary()
    if not exe:
        return {"available": False, "engine": "", "note": "No OCR engine is installed. FormCel can use the Apache-2.0 Tesseract program when it is on the PATH (apt install tesseract-ocr, brew install tesseract, or the Windows installer)."}
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10)
        first = (out.stdout or out.stderr).splitlines()[0] if (out.stdout or out.stderr) else "tesseract"
    except (OSError, subprocess.SubprocessError):
        first = "tesseract"
    langs = []
    try:
        out = subprocess.run([exe, "--list-langs"], capture_output=True, text=True, timeout=10)
        langs = [x.strip() for x in out.stdout.splitlines()[1:] if x.strip()]
    except (OSError, subprocess.SubprocessError):
        pass
    return {"available": True, "engine": first, "languages": langs, "note": ""}


def sniff(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return ".png"
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return ".tif"
    if data[:2] == b"BM":
        return ".bmp"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:3] == b"GIF":
        return ".gif"
    raise OcrError("that file is not a PNG, JPEG, TIFF, BMP, GIF or WebP picture")


def words(data: bytes, lang: str) -> list[dict]:
    exe = binary()
    if not exe:
        raise OcrUnavailable(status()["note"])
    ext = sniff(data)
    lang = lang if lang.replace("+", "").replace("_", "").isalnum() else "eng"
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / f"in{ext}"
        src.write_bytes(data)
        try:
            run = subprocess.run([exe, str(src), "stdout", "-l", lang, "--psm", "6", "tsv"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90, cwd=d)
        except subprocess.TimeoutExpired:
            raise OcrError("the picture took too long to read")
        if run.returncode != 0:
            raise OcrError((run.stderr or "tesseract failed").strip().splitlines()[-1][:200])
    out = []
    for line in run.stdout.splitlines()[1:]:
        p = line.split("\t")
        if len(p) < 12 or p[0] != "5":
            continue
        text = p[11].strip()
        try:
            conf = float(p[10])
        except ValueError:
            conf = -1
        if text and conf >= 0:
            out.append({"block": int(p[2]), "par": int(p[3]), "line": int(p[4]), "x": int(p[6]), "y": int(p[7]), "w": int(p[8]), "h": int(p[9]), "text": text, "conf": conf})
    return out


def to_rows(ws: list[dict]) -> list[list[str]]:
    if not ws:
        return []
    lines: dict[tuple, list[dict]] = {}
    for w in ws:
        lines.setdefault((w["block"], w["par"], w["line"]), []).append(w)
    ordered = sorted(lines.values(), key=lambda l: (min(w["y"] for w in l), min(w["x"] for w in l)))
    heights = [w["h"] for w in ws]
    gap = max(12, 1.4 * statistics.median(heights))
    cells = []
    for l in ordered:
        l.sort(key=lambda w: w["x"])
        row: list[tuple[int, str]] = []
        cur = l[0]["text"]
        start = l[0]["x"]
        end = l[0]["x"] + l[0]["w"]
        for w in l[1:]:
            if w["x"] - end > gap:
                row.append((start, cur))
                cur, start = w["text"], w["x"]
            else:
                cur += " " + w["text"]
            end = w["x"] + w["w"]
        row.append((start, cur))
        cells.append(row)
    starts = sorted({s for r in cells for s, _ in r})
    cols: list[int] = []
    for s in starts:
        if not cols or s - cols[-1] > gap:
            cols.append(s)
    out = []
    for r in cells:
        line = [""] * len(cols)
        for s, t in r:
            k = max(i for i, c in enumerate(cols) if c <= s + gap / 2) if any(c <= s + gap / 2 for c in cols) else 0
            line[k] = (line[k] + " " + t).strip()
        out.append(line)
    return out


def read_picture(data: bytes, lang: str = "eng") -> dict:
    from . import ocrprep, ocrtable

    sniff(data)
    prep = ocrprep.prepare(data)
    ws = words(prep["data"], lang)
    conf = round(sum(w["conf"] for w in ws) / len(ws), 1) if ws else 0
    if not ws:
        return {"rows": [], "words": 0, "confidence": 0, "cells": [], "merges": [], "columns": [], "header": False, "fixed": 0}
    table = ocrtable.build(ws, prep["vlines"])
    rows = [[c["v"] for c in row] for row in table["cells"]]
    return {"rows": rows, "words": len(ws), "confidence": conf, "scale": prep["scale"], **table}
