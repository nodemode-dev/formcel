import io
import json
import re
import shutil
import zipfile
from pathlib import Path

from .. import config

MAX_BYTES = 5 * 1024 * 1024
MAX_FILES = 200


class PackageError(Exception):
    pass


def root() -> Path:
    return config.DATA_DIR / "Extensions"


def slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", name.strip()).strip("-.")
    if not s:
        raise PackageError("the package needs a name")
    return s[:60]


def read_manifest(folder: Path) -> dict:
    m = folder / "manifest.json"
    if not m.is_file():
        raise PackageError("manifest.json was not found at the top of the package")
    try:
        doc = json.loads(m.read_text("utf-8"))
    except (OSError, ValueError) as e:
        raise PackageError(f"manifest.json is not valid JSON: {e}")
    if not isinstance(doc, dict) or not isinstance(doc.get("name"), str) or not doc["name"].strip():
        raise PackageError("manifest.json needs a name")
    scripts = doc.get("scripts", [])
    if not isinstance(scripts, list) or not scripts:
        raise PackageError("manifest.json needs a scripts list with at least one script file")
    for s in scripts:
        if not isinstance(s, dict) or not isinstance(s.get("file"), str):
            raise PackageError("each script in manifest.json needs a file")
        f = (folder / s["file"]).resolve()
        if folder.resolve() not in f.parents or not f.is_file():
            raise PackageError(f"script file {s['file']} is missing or outside the package")
    return doc


def describe(folder: Path) -> dict | None:
    try:
        doc = read_manifest(folder)
    except PackageError:
        return None
    scripts = []
    for s in doc["scripts"]:
        f = (folder / s["file"]).resolve()
        scripts.append({"name": s.get("name", f.stem), "code": f.read_text("utf-8"), "custom": bool(s.get("custom")), "button": s.get("button", "") if isinstance(s.get("button", ""), str) else ""})
    return {"id": folder.name, "name": doc["name"], "version": str(doc.get("version", "")), "description": str(doc.get("description", "")), "author": str(doc.get("author", "")), "functions": [f for f in doc.get("functions", []) if isinstance(f, dict)][:100], "scripts": scripts}


def listing() -> list[dict]:
    base = root()
    out = []
    for m in sorted(base.glob("*/manifest.json")) if base.is_dir() else []:
        d = describe(m.parent)
        if d:
            out.append(d)
    return out


def check_tree(folder: Path) -> None:
    files = [p for p in folder.rglob("*") if p.is_file()]
    if len(files) > MAX_FILES:
        raise PackageError(f"the package has more than {MAX_FILES} files")
    if sum(p.stat().st_size for p in files) > MAX_BYTES:
        raise PackageError("the package is larger than 5 MB")
    for p in files:
        if p.is_symlink():
            raise PackageError("packages cannot contain links")


def place(src: Path) -> dict:
    check_tree(src)
    doc = read_manifest(src)
    dest = root() / slug(str(doc.get("id") or doc["name"]))
    root().mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest, symlinks=False)
    d = describe(dest)
    if d is None:
        shutil.rmtree(dest, ignore_errors=True)
        raise PackageError("the package could not be read after copying")
    return d


def from_folder(path: str) -> dict:
    p = Path(path).expanduser()
    if p.is_file() and p.suffix.lower() == ".zip":
        return from_zip(p.read_bytes())
    if not p.is_dir():
        raise PackageError(f"no folder or zip at {path}")
    return place(p)


def from_zip(data: bytes) -> dict:
    import tempfile

    if len(data) > MAX_BYTES:
        raise PackageError("the zip is larger than 5 MB")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise PackageError("that file is not a zip")
    infos = [i for i in z.infolist() if not i.is_dir()]
    if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_BYTES * 4:
        raise PackageError("the zip is too large to install")
    with tempfile.TemporaryDirectory() as d:
        base = Path(d).resolve()
        for i in infos:
            target = (base / i.filename).resolve()
            if base not in target.parents:
                raise PackageError("the zip has a file outside its folder")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(i))
        top = base
        if not (top / "manifest.json").is_file():
            subs = [p for p in base.iterdir() if p.is_dir()]
            if len(subs) == 1 and (subs[0] / "manifest.json").is_file():
                top = subs[0]
        return place(top)


def remove(pid: str) -> None:
    dest = (root() / slug(pid)).resolve()
    if root().resolve() not in dest.parents or not dest.is_dir():
        raise PackageError("that extension is not installed")
    shutil.rmtree(dest)
