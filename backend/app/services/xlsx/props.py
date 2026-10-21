import io
import re
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape

FIELDS = ("title", "subject", "author", "tags", "categories", "comments", "company", "manager", "status")
LIMITS = {"comments": 2000}
APP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
VT = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"


def clean(raw: dict | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for k in FIELDS:
        v = str((raw or {}).get(k) or "").replace("\x00", "").strip()
        if v:
            out[k] = v[: LIMITS.get(k, 255)]
    return out


def _stamp(text: str) -> datetime | None:
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def core_out(wb, props: dict, created: str, modified: str) -> None:
    p = wb.properties
    p.title = props.get("title") or None
    p.subject = props.get("subject") or None
    p.creator = props.get("author") or "FormCel"
    p.lastModifiedBy = props.get("author") or "FormCel"
    p.keywords = props.get("tags") or None
    p.category = props.get("categories") or None
    p.description = props.get("comments") or None
    p.contentStatus = props.get("status") or None
    c, m = _stamp(created), _stamp(modified)
    if c:
        p.created = c
    if m:
        p.modified = m


def app_xml(props: dict, sheets: list[str], version: str) -> bytes:
    parts = "".join(f"<vt:lpstr>{escape(n)}</vt:lpstr>" for n in sheets)
    extra = "".join(f"<{tag}>{escape(props[k])}</{tag}>" for k, tag in (("manager", "Manager"), ("company", "Company")) if props.get(k))
    xml = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="{APP}" xmlns:vt="{VT}">{extra}'
        f"<Application>FormCel</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>"
        f'<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>{len(sheets)}</vt:i4></vt:variant></vt:vector></HeadingPairs>'
        f'<TitlesOfParts><vt:vector size="{len(sheets)}" baseType="lpstr">{parts}</vt:vector></TitlesOfParts>'
        f"<AppVersion>{escape(version)}</AppVersion></Properties>"
    )
    return xml.encode("utf-8")


def patch_app(data: bytes, xml: bytes) -> bytes:
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            blob = xml if item.filename == "docProps/app.xml" else src.read(item.filename)
            dst.writestr(item, blob)
    return out.getvalue()


def _tag(text: str, tag: str) -> str:
    m = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.S)
    if not m:
        return ""
    return m.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&").strip()


def read_props(wb, data: bytes) -> dict[str, str]:
    p = wb.properties
    author = p.creator if p.creator and p.creator not in ("openpyxl", "FormCel") else ""
    raw = {"title": p.title, "subject": p.subject, "author": author, "tags": p.keywords, "categories": p.category, "comments": p.description, "status": p.contentStatus}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if "docProps/app.xml" in z.namelist():
                text = z.read("docProps/app.xml").decode("utf-8", "replace")
                raw["company"] = _tag(text, "Company")
                raw["manager"] = _tag(text, "Manager")
    except (zipfile.BadZipFile, KeyError):
        pass
    return clean(raw)
