import io
import random
import re
import struct
import uuid
from dataclasses import dataclass, field

import olefile

from . import cfb, mlz

KINDS = ("std", "class", "document", "form")
ATTR = re.compile(r"^\s*Attribute\s", re.I)

REFS = [
    ("stdole", r"*\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\Windows\System32\stdole2.tlb#OLE Automation"),
    ("Excel", r"*\G{00020813-0000-0000-C000-000000000046}#1.9#0#C:\Program Files\Microsoft Office\Root\Office16\EXCEL.EXE#Microsoft Excel 16.0 Object Library"),
    ("Office", r"*\G{2DF8D04C-5BFA-101B-BDE5-00AA0044DE52}#2.0#0#C:\Program Files\Common Files\Microsoft Shared\OFFICE16\MSO.DLL#Microsoft Office 16.0 Object Library"),
]


@dataclass
class Module:
    name: str
    kind: str
    code: str
    header: list[str] = field(default_factory=list)
    stream: str = ""
    private: bool = False
    readonly: bool = False
    procattrs: dict[str, list[str]] = field(default_factory=dict)


@dataclass
class Project:
    name: str = "VBAProject"
    codepage: int = 1252
    modules: list[Module] = field(default_factory=list)
    prefix: bytes = b""
    project_text: str = ""
    extras: dict[str, bytes] = field(default_factory=dict)
    locked: bool = False


def default_header(name: str, kind: str) -> list[str]:
    head = [f'Attribute VB_Name = "{name}"']
    if kind == "std":
        return head
    head += ["Attribute VB_GlobalNameSpace = False", "Attribute VB_Creatable = False", f"Attribute VB_PredeclaredId = {'True' if kind == 'form' else 'False'}", "Attribute VB_Exposed = False"]
    if kind == "document":
        head += ['Attribute VB_Base = "0{00020819-0000-0000-C000-000000000046}"', "Attribute VB_TemplateDerived = False", "Attribute VB_Customizable = True"]
    if kind == "form":
        head += ['Attribute VB_Base = "0{' + str(uuid.uuid4()).upper() + '}{' + str(uuid.uuid4()).upper() + '}"', "Attribute VB_TemplateDerived = False", "Attribute VB_Customizable = False"]
    return head


PROC = re.compile(r"^\s*(?:(?:Public|Private|Friend|Static)\s+)*(?:Sub|Function|Property\s+(?:Get|Let|Set))\s+([A-Za-z_]\w*)", re.I)
PROC_ATTR = re.compile(r"^\s*Attribute\s+([A-Za-z_]\w*)\.", re.I)


def split_source(text: str) -> tuple[list[str], str, dict[str, list[str]]]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    n = 0
    while n < len(lines) and ATTR.match(lines[n]):
        n += 1
    body = []
    attrs: dict[str, list[str]] = {}
    for line in lines[n:]:
        m = PROC_ATTR.match(line)
        if m:
            attrs.setdefault(m.group(1), []).append(line.strip())
        else:
            body.append(line)
    return lines[:n], "\n".join(body), attrs


def join_source(code: str, attrs: dict[str, list[str]]) -> list[str]:
    out: list[str] = []
    pending: list[str] | None = None
    for line in code.replace("\r\n", "\n").split("\n"):
        out.append(line)
        if pending is not None:
            if line.rstrip().endswith(" _"):
                continue
            out.extend(pending)
            pending = None
            continue
        m = PROC.match(line)
        if m and m.group(1) in attrs:
            if line.rstrip().endswith(" _"):
                pending = attrs[m.group(1)]
            else:
                out.extend(attrs[m.group(1)])
    return out


def _records(buf: bytes) -> int:
    pos = 0
    while pos + 6 <= len(buf):
        rid, size = struct.unpack_from("<HI", buf, pos)
        if rid == 0x000F:
            return pos
        if rid == 0x0009:
            pos += 12
            continue
        pos += 6 + size
        if rid == 0x002F:
            if buf[pos : pos + 2] == b"\x16\x00":
                nsize = struct.unpack_from("<I", buf, pos + 2)[0]
                pos += 6 + nsize
                pos += 6 + struct.unpack_from("<I", buf, pos + 2)[0]
            pos += 2
            pos += 4 + struct.unpack_from("<I", buf, pos)[0]
    raise ValueError("The VBA project has no module list.")


def codec(codepage: int) -> str:
    if codepage == 10000:
        return "mac_roman"
    try:
        "".encode(f"cp{codepage}")
        return f"cp{codepage}"
    except LookupError:
        return "cp1252"


def _text(buf: bytes, codepage: int) -> str:
    try:
        return buf.decode(codec(codepage))
    except (LookupError, UnicodeDecodeError):
        return buf.decode("latin-1")


def parse(blob: bytes) -> Project:
    ole = olefile.OleFileIO(io.BytesIO(blob))
    try:
        dir_raw = mlz.decompress(ole.openstream("VBA/dir").read())
        proj_raw = ole.openstream("PROJECT").read() if ole.exists("PROJECT") else b""
        streams = {"/".join(p): None for p in ole.listdir(streams=True, storages=False)}
        end = _records(dir_raw)
        out = Project(prefix=dir_raw[:end])
        pos = 0
        while pos < end:
            rid, size = struct.unpack_from("<HI", dir_raw, pos)
            if rid in (0x16, 0x33, 0x2F, 0x0D, 0x0E):
                break
            if rid == 0x0004:
                out.name = dir_raw[pos + 6 : pos + 6 + size].decode("latin-1")
            elif rid == 0x0003:
                out.codepage = struct.unpack_from("<H", dir_raw, pos + 6)[0]
            pos += 12 if rid == 0x0009 else 6 + size
        out.project_text = _text(proj_raw, out.codepage)
        kinds: dict[str, str] = {}
        for line in out.project_text.splitlines():
            m = re.match(r"^(Document|Module|Class|BaseClass)=([^/\r\n]+)", line)
            if m:
                kinds[m.group(2).lower()] = {"Document": "document", "Module": "std", "Class": "class", "BaseClass": "form"}[m.group(1)]
        out.locked = _protected(out.project_text)
        pos = end
        count = struct.unpack_from("<H", dir_raw, pos + 6)[0]
        pos += 16
        for _ in range(count):
            fields: dict[int, bytes] = {}
            while True:
                rid, size = struct.unpack_from("<HI", dir_raw, pos)
                fields[rid] = dir_raw[pos + 6 : pos + 6 + size]
                pos += 6 + size
                if rid == 0x002B:
                    break
            name = _text(fields.get(0x0019, b""), out.codepage)
            if 0x0047 in fields:
                name = fields[0x0047].decode("utf-16-le", "replace") or name
            stream = _text(fields.get(0x001A, fields.get(0x0019, b"")), out.codepage)
            offset = struct.unpack("<I", fields[0x0031])[0] if 0x0031 in fields else 0
            raw = ole.openstream(f"VBA/{stream}").read()
            try:
                src = mlz.decompress(raw[offset:]).decode(codec(out.codepage), "replace")
            except ValueError:
                src = ""
            head, code, pa = split_source(src)
            kind = kinds.get(name.lower()) or ("std" if 0x0021 in fields else "class")
            out.modules.append(Module(name, kind, code, head, stream, 0x0028 in fields, 0x0025 in fields, pa))
        skip = {"PROJECT", "PROJECTwm"}
        for path in streams:
            if path in skip or path.startswith("VBA/") or path.startswith("VBA\\"):
                continue
            out.extras[path] = ole.openstream(path).read()
        return out
    finally:
        ole.close()


def _protected(text: str) -> bool:
    m = re.search(r'^CMG="([0-9A-Fa-f]+)"', text, re.M)
    if not m:
        return False
    try:
        data = decrypt(m.group(1))
    except (ValueError, struct.error):
        return False
    return len(data) >= 4 and struct.unpack_from("<I", data)[0] != 0


def decrypt(hexs: str) -> bytes:
    b = bytes.fromhex(hexs)
    seed, enc_ver, enc_key = b[0], b[1], b[2]
    key = enc_key ^ seed
    un1, e1, e2 = key, enc_key, enc_ver
    plain = bytearray()
    for e in b[3:]:
        v = e ^ ((e2 + un1) & 255)
        e2, e1, un1 = e1, e, v
        plain.append(v)
    ign = (seed & 6) // 2
    length = struct.unpack_from("<I", plain, ign)[0]
    return bytes(plain[ign + 4 : ign + 4 + length])


def encrypt(data: bytes, guid: str, seed: int | None = None) -> str:
    seed = random.randrange(256) if seed is None else seed
    key = sum(guid.encode("ascii")) & 255
    ign = (seed & 6) // 2
    plain = bytes(random.randrange(256) for _ in range(ign)) + struct.pack("<I", len(data)) + data
    enc_ver, enc_key = seed ^ 2, seed ^ key
    un1, e1, e2 = key, enc_key, enc_ver
    out = bytearray([seed, enc_ver, enc_key])
    for v in plain:
        e = v ^ ((e2 + un1) & 255)
        e2, e1, un1 = e1, e, v
        out.append(e)
    return out.hex().upper()


def _rec(rid: int, data: bytes) -> bytes:
    return struct.pack("<HI", rid, len(data)) + data


def _prefix(name: str, codepage: int) -> bytes:
    nm = name.encode(codec(codepage), "replace")
    out = _rec(1, struct.pack("<I", 3)) + _rec(2, struct.pack("<I", 0x409)) + _rec(0x14, struct.pack("<I", 0x409)) + _rec(3, struct.pack("<H", codepage))
    out += _rec(4, nm)
    out += _rec(5, b"") + _rec(0x40, b"") + _rec(6, b"") + _rec(0x3D, b"")
    out += _rec(7, struct.pack("<I", 0)) + _rec(8, struct.pack("<I", 0))
    out += struct.pack("<HIIH", 9, 4, 1403, 5)
    out += _rec(0x0C, b"") + _rec(0x3C, b"")
    for rname, libid in REFS:
        bn = rname.encode("ascii")
        out += _rec(0x16, bn) + _rec(0x3E, bn.decode().encode("utf-16-le"))
        lib = libid.encode("ascii")
        out += _rec(0x0D, struct.pack("<I", len(lib)) + lib + struct.pack("<IH", 0, 0))
    return out


def _module_rec(m: Module, index: int) -> bytes:
    nm = m.name.encode("cp1252", "replace")
    st = (m.stream or m.name).encode("cp1252", "replace")
    out = _rec(0x19, nm) + _rec(0x47, m.name.encode("utf-16-le"))
    out += _rec(0x1A, st) + _rec(0x32, (m.stream or m.name).encode("utf-16-le"))
    out += _rec(0x1C, b"") + _rec(0x48, b"")
    out += _rec(0x31, struct.pack("<I", 0)) + _rec(0x1E, struct.pack("<I", 0)) + _rec(0x2C, struct.pack("<H", 0xFFFF))
    out += struct.pack("<HI", 0x21 if m.kind == "std" else 0x22, 0)
    if m.readonly:
        out += struct.pack("<HI", 0x25, 0)
    if m.private:
        out += struct.pack("<HI", 0x28, 0)
    return out + struct.pack("<HI", 0x2B, 0)


def _source(m: Module, codepage: int) -> bytes:
    head = m.header or default_header(m.name, m.kind)
    if not any(re.match(r"^\s*Attribute\s+VB_Name", h, re.I) for h in head):
        head = [f'Attribute VB_Name = "{m.name}"', *head]
    text = "\r\n".join([*head, *join_source(m.code, m.procattrs)])
    if not text.endswith("\r\n"):
        text += "\r\n"
    return text.encode(codec(codepage), "replace")


def _project_text(p: Project, guid: str) -> str:
    kept = p.project_text
    gid = re.search(r'^ID="(\{[^}]*\})"', kept, re.M)
    guid = gid.group(1) if gid else guid
    lines = [f'ID="{guid}"']
    for m in p.modules:
        word = {"std": "Module", "class": "Class", "document": "Document", "form": "BaseClass"}[m.kind]
        lines.append(f"{word}={m.name}" + ("/&H00000000" if m.kind == "document" else ""))
    lines.append(f'Name="{p.name}"')
    for key, default in (("HelpContextID", '"0"'), ("VersionCompatible32", '"393222000"')):
        mm = re.search(rf"^{key}=(.*)$", kept, re.M)
        lines.append(f"{key}={mm.group(1).strip() if mm else default}")
    prot = [re.search(rf"^{k}=(\".*?\")\s*$", kept, re.M) for k in ("CMG", "DPB", "GC")]
    if all(prot):
        lines += [f"{k}={mm.group(1)}" for k, mm in zip(("CMG", "DPB", "GC"), prot)]
    else:
        lines += [f'CMG="{encrypt(bytes(4), guid)}"', f'DPB="{encrypt(bytes(1), guid)}"', f'GC="{encrypt(b"\xff", guid)}"']
    host = re.search(r"\[Host Extender Info\].*?(?=\r?\n\[|\Z)", kept, re.S)
    lines += ["", host.group(0).strip() if host else "[Host Extender Info]\r\n&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000\r\n&H00000002={00020813-0000-0000-C000-000000000046};Excel;&H00000000", ""]
    lines.append("[Workspace]")
    for m in p.modules:
        lines.append(f"{m.name}=0, 0, 0, 0, C")
    return "\r\n".join(lines) + "\r\n"


def build(p: Project) -> bytes:
    guid = "{" + str(uuid.uuid4()).upper() + "}"
    cp = p.codepage
    prefix = p.prefix or _prefix(p.name, cp)
    d = bytearray(prefix)
    d += _rec(0x0F, struct.pack("<H", len(p.modules)))
    d += _rec(0x13, struct.pack("<H", 0xFFFF))
    files: dict[str, bytes] = {}
    for i, m in enumerate(p.modules):
        m.stream = m.stream or m.name
        d += _module_rec(m, i)
        files[f"VBA/{m.stream}"] = mlz.compress(_source(m, cp))
    d += struct.pack("<HI", 0x10, 0)
    files["VBA/dir"] = mlz.compress(bytes(d))
    files["VBA/_VBA_PROJECT"] = b"\xcc\x61\xff\xff\x00\x00\x00"
    files["PROJECT"] = _project_text(p, guid).encode(codec(cp), "replace")
    wm = b"".join(m.name.encode(codec(cp), "replace") + b"\0" + m.name.encode("utf-16-le") + b"\0\0" for m in p.modules)
    files["PROJECTwm"] = wm + b"\0\0"
    for path, data in p.extras.items():
        files.setdefault(path, data)
    return cfb.build(files)
