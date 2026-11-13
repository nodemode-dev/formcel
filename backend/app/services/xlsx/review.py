import io
import re
import uuid
import zipfile
from xml.sax.saxutils import escape as xesc
from xml.sax.saxutils import quoteattr

from openpyxl.comments import Comment
from openpyxl.packaging.custom import StringProperty
from openpyxl.utils import get_column_letter
from openpyxl.utils.cell import coordinate_from_string, column_index_from_string, range_boundaries

TC_NS = "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"
REL_TC = "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment"
REL_PERSON = "http://schemas.microsoft.com/office/2017/10/relationships/person"
CT_TC = "application/vnd.ms-excel.threadedcomments+xml"
CT_PERSON = "application/vnd.ms-excel.person+xml"
SPACE = uuid.UUID("6f1d3c7e-1c5b-4f0e-9a43-5d2f6a0b7e11")
RANGE_PROP = "FormCelRangeUsers"
PLACEHOLDER = ("[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment; however, any edits to it will get removed if the file is opened "
               "in a newer version of Excel. Learn more: https://go.microsoft.com/fwlink/?linkid=870924\n\nComment:\n    ")


def guid(*parts: str) -> str:
    return "{" + str(uuid.uuid5(SPACE, "|".join(parts))).upper() + "}"


def unesc(s: str) -> str:
    out, it = [], iter(s)
    for ch in it:
        if ch != "\\":
            out.append(ch)
            continue
        nxt = next(it, "\\")
        out.append({"t": "\t", "n": "\n", "r": "\r"}.get(nxt, nxt))
    return "".join(out)


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def placeholders(ws, threads: list[dict], sheet: int) -> None:
    for t in threads:
        if t["sheet"] != sheet or not t["messages"]:
            continue
        root = guid("thread", t["id"])
        body = PLACEHOLDER + t["messages"][0]["text"]
        cm = Comment(body, f"tc={root}")
        cm.width, cm.height = 240, 100
        ws.cell(row=t["row"] + 1, column=t["col"] + 1).comment = cm


def ranges_out(wb, lines: list[str], sheet: int) -> list[tuple[str, str]]:
    found = []
    for line in lines:
        f = line.split("\t")
        if f[0] != "R" or len(f) < 4:
            continue
        n = [int(x) for x in f[2].split(",")]
        name = unesc(f[1])
        area = f"{get_column_letter(n[1] + 1)}{n[0] + 1}:{get_column_letter(n[3] + 1)}{n[2] + 1}"
        users = unesc(f[3])
        found.append((name, area))
        wb.custom_doc_props.append(StringProperty(name=f"{RANGE_PROP}.{sheet}.{name}"[:250], value=users[:2000]))
    return found


def _iso(t: str) -> str:
    return (t or "1970-01-01T00:00:00")[:19].replace("Z", "") + ".00"


def _mentions(text: str, people: dict[str, str]) -> str:
    out = []
    for name in sorted(people, key=len, reverse=True):
        at = text.lower().find("@" + name.lower())
        if at >= 0:
            out.append(f'<mention mentionpersonId="{people[name]}" mentionId="{guid("mention", name, str(at), text[:40])}" startIndex="{at}" length="{len(name) + 1}"/>')
    return f"<mentions>{''.join(out)}</mentions>" if out else ""


def thread_xml(threads: list[dict], persons: dict[str, str]) -> str:
    items = []
    for t in threads:
        root = guid("thread", t["id"])
        for i, m in enumerate(t["messages"]):
            pid = persons[m["author"] or "FormCel"]
            ident = root if i == 0 else guid("reply", t["id"], m["id"])
            cell = f"{get_column_letter(t['col'] + 1)}{t['row'] + 1}"
            attrs = f'ref="{cell}" dT="{_iso(m["time"])}" personId="{pid}" id="{ident}"'
            if i == 0:
                attrs += f' done="{1 if t["status"] == "resolved" else 0}"'
            else:
                attrs += f' parentId="{root}"'
            items.append(f'<threadedComment {attrs}><text>{xesc(m["text"])}</text>{_mentions(m["text"], persons)}</threadedComment>')
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ThreadedComments xmlns="{TC_NS}">{"".join(items)}</ThreadedComments>'


def person_xml(persons: dict[str, str]) -> str:
    rows = "".join(f'<person displayName={quoteattr(n)} id="{i}" userId={quoteattr(n)} providerId="None"/>' for n, i in persons.items())
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<personList xmlns="{TC_NS}">{rows}</personList>'


def _rels_add(xml: str, entries: list[tuple[str, str, str]]) -> str:
    add = "".join(f'<Relationship Id="{i}" Type="{t}" Target="{g}"/>' for i, t, g in entries)
    return xml.replace("</Relationships>", add + "</Relationships>")


def finish(data: bytes, threads: list[dict], ranges: dict[int, list[tuple[str, str]]]) -> bytes:
    threads = [t for t in threads if t["messages"] and t["sheet"] >= 0]
    if not threads and not any(ranges.values()):
        return data
    src = zipfile.ZipFile(io.BytesIO(data))
    parts = {n: src.read(n) for n in src.namelist()}
    order = src.namelist()
    persons: dict[str, str] = {}
    for t in threads:
        for m in t["messages"]:
            n = m["author"] or "FormCel"
            persons.setdefault(n, guid("person", n))
    types = parts["[Content_Types].xml"].decode("utf-8")
    by_sheet: dict[int, list[dict]] = {}
    for t in threads:
        by_sheet.setdefault(t["sheet"], []).append(t)
    extra: dict[str, bytes] = {}
    overrides = []
    for sheet, items in sorted(by_sheet.items()):
        path = f"xl/worksheets/sheet{sheet + 1}.xml"
        if path not in parts:
            continue
        name = f"threadedComment{sheet + 1}.xml"
        extra[f"xl/threadedComments/{name}"] = thread_xml(items, persons).encode("utf-8")
        overrides.append(f'<Override PartName="/xl/threadedComments/{name}" ContentType="{CT_TC}"/>')
        rels = f"xl/worksheets/_rels/sheet{sheet + 1}.xml.rels"
        entry = [(f"rIdTc{sheet + 1}", REL_TC, f"../threadedComments/{name}")]
        if rels in parts:
            parts[rels] = _rels_add(parts[rels].decode("utf-8"), entry).encode("utf-8")
        else:
            parts[rels] = _rels_add('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>', entry).encode("utf-8")
    if by_sheet:
        extra["xl/persons/person.xml"] = person_xml(persons).encode("utf-8")
        overrides.append(f'<Override PartName="/xl/persons/person.xml" ContentType="{CT_PERSON}"/>')
        wrels = "xl/_rels/workbook.xml.rels"
        parts[wrels] = _rels_add(parts[wrels].decode("utf-8"), [("rIdPersons", REL_PERSON, "persons/person.xml")]).encode("utf-8")
    parts["[Content_Types].xml"] = types.replace("</Types>", "".join(overrides) + "</Types>").encode("utf-8")
    for sheet, items in ranges.items():
        path = f"xl/worksheets/sheet{sheet + 1}.xml"
        if not items or path not in parts:
            continue
        xml = parts[path].decode("utf-8")
        block = "<protectedRanges>" + "".join(f'<protectedRange name={quoteattr(re.sub(r"[^A-Za-z0-9_ ]", "_", n)[:250])} sqref="{a}"/>' for n, a in items) + "</protectedRanges>"
        if "<sheetProtection" in xml:
            xml = re.sub(r"(<sheetProtection\b[^>]*?(?:/>|>.*?</sheetProtection>))", lambda m: m.group(1) + block, xml, count=1, flags=re.S)
        elif "</sheetData>" in xml:
            xml = xml.replace("</sheetData>", "</sheetData>" + block, 1)
        parts[path] = xml.encode("utf-8")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for n in order:
            z.writestr(n, parts[n])
        for n, blob in extra.items():
            z.writestr(n, blob)
    return out.getvalue()


def _rid_targets(xml: str) -> dict[str, tuple[str, str]]:
    out = {}
    for m in re.finditer(r"<Relationship\b([^>]*)/?>", xml):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        if "Id" in a:
            out[a["Id"]] = (a.get("Type", ""), a.get("Target", ""))
    return out


def _resolve(base: str, target: str) -> str:
    if target.startswith("/"):
        return target[1:]
    parts = base.split("/")[:-1]
    for seg in target.split("/"):
        if seg == "..":
            parts.pop()
        elif seg and seg != ".":
            parts.append(seg)
    return "/".join(parts)


def sheet_paths(z: zipfile.ZipFile) -> list[str]:
    wb = z.read("xl/workbook.xml").decode("utf-8")
    rels = _rid_targets(z.read("xl/_rels/workbook.xml.rels").decode("utf-8"))
    out = []
    for m in re.finditer(r"<(?:\w+:)?sheet\b([^>]*)/?>", wb):
        rid = re.search(r'r:id="([^"]+)"', m.group(1)) or re.search(r'\bid="([^"]+)"', m.group(1))
        if rid and rid.group(1) in rels and not rels[rid.group(1)][0].endswith("/chartsheet"):
            path = _resolve("xl/workbook.xml", rels[rid.group(1)][1])
            if path in z.namelist():
                out.append(path)
    return out


def _cell(ref: str) -> tuple[int, int]:
    col, row = coordinate_from_string(ref)
    return row - 1, column_index_from_string(col) - 1


def threads_in(data: bytes) -> list[list[dict]]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        paths = sheet_paths(z)
    except (zipfile.BadZipFile, KeyError, ValueError):
        return []
    people: dict[str, str] = {}
    for n in z.namelist():
        if n.startswith("xl/persons/") and n.endswith(".xml"):
            xml = z.read(n).decode("utf-8", "replace")
            for m in re.finditer(r"<person\b([^>]*)/?>", xml):
                a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
                if "id" in a:
                    people[a["id"].upper()] = _unxml(a.get("displayName", ""))
    out: list[list[dict]] = []
    for path in paths:
        found: list[dict] = []
        rels_path = path.rsplit("/", 1)[0] + "/_rels/" + path.rsplit("/", 1)[1] + ".rels"
        if rels_path in z.namelist():
            for typ, target in _rid_targets(z.read(rels_path).decode("utf-8")).values():
                if typ == REL_TC:
                    found = _thread_file(z.read(_resolve(path, target)).decode("utf-8", "replace"), people)
        out.append(found)
    return out


def _unxml(s: str) -> str:
    return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")


def _thread_file(xml: str, people: dict[str, str]) -> list[dict]:
    roots: dict[str, dict] = {}
    replies = []
    for m in re.finditer(r"<threadedComment\b([^>]*)>(.*?)</threadedComment>", xml, re.S):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        text = re.search(r"<text>(.*?)</text>", m.group(2), re.S)
        msg = {"author": people.get(a.get("personId", "").upper(), "") or "Unknown", "time": a["dT"] + "Z" if a.get("dT") and not a["dT"].endswith("Z") else a.get("dT", ""), "text": _unxml(text.group(1) if text else "")}
        if a.get("parentId"):
            replies.append((a["parentId"].upper(), msg))
            continue
        try:
            row, col = _cell(a["ref"])
        except (KeyError, ValueError):
            continue
        roots[a.get("id", "").upper()] = {"row": row, "col": col, "status": "resolved" if a.get("done") in ("1", "true") else "open", "messages": [msg]}
    for pid, msg in replies:
        if pid in roots:
            roots[pid]["messages"].append(msg)
    return list(roots.values())


def ranges_in(data: bytes, wb) -> tuple[list[list[str]], int]:
    users: dict[str, str] = {}
    for p in getattr(wb, "custom_doc_props", None) or []:
        n = getattr(p, "name", "")
        if n.startswith(RANGE_PROP + "."):
            users[n[len(RANGE_PROP) + 1:]] = str(getattr(p, "value", "") or "")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        paths = sheet_paths(z)
    except (zipfile.BadZipFile, KeyError, ValueError):
        return [], 0
    out = []
    skipped = 0
    for i, path in enumerate(paths):
        lines = []
        xml = z.read(path).decode("utf-8", "replace") if path in z.namelist() else ""
        for m in re.finditer(r"<protectedRange\b([^>]*?)/?>", xml):
            a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
            ref = (a.get("sqref") or "").split(" ")[0]
            if not ref:
                continue
            try:
                c0, r0, c1, r1 = range_boundaries(ref)
            except ValueError:
                continue
            name = _unxml(a.get("name", "Range"))
            who = users.get(f"{i}.{name}", "")
            if not who:
                skipped += 1
                continue
            lines.append(f"R\t{esc(name)}\t{r0 - 1},{c0 - 1},{r1 - 1},{c1 - 1}\t{esc(who)}")
        out.append(lines)
    return out, skipped
