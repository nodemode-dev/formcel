import re

from openpyxl.writer.theme import theme_xml

from .styles import SLOTS

SLOT_XML = re.compile(r"<a:(dk1|lt1|dk2|lt2|accent[1-6])>\s*<a:(?:srgbClr val|sysClr [^>]*?lastClr)=\"([0-9A-Fa-f]{6})\"", re.S)
FONT_XML = re.compile(r"<a:(major|minor)Font>\s*<a:latin typeface=\"([^\"]*)\"", re.S)
NAME_XML = re.compile(r"<a:clrScheme name=\"([^\"]*)\"")


def theme_in(xml: bytes | str | None) -> str | None:
    if not xml:
        return None
    text = xml.decode("utf-8", "replace") if isinstance(xml, bytes) else xml
    found = {k: v.lower() for k, v in SLOT_XML.findall(text)}
    if not all(s in found for s in SLOTS):
        return None
    fonts = dict(FONT_XML.findall(text))
    name = (NAME_XML.search(text).group(1) if NAME_XML.search(text) else "Imported").replace(";", " ")
    return f"{name};{','.join(found[s] for s in SLOTS)};{fonts.get('major', 'Calibri Light')};{fonts.get('minor', 'Calibri')}"


def theme_out(text: str) -> tuple[bytes, str, str]:
    parts = text.split(";")
    name = parts[0] if parts else "FormCel"
    cols = (parts[1] if len(parts) > 1 else "").split(",")
    heading = parts[2] if len(parts) > 2 and parts[2] else "Inter"
    body = parts[3] if len(parts) > 3 and parts[3] else "Inter"
    xml = theme_xml
    if len(cols) == 10:
        colours = dict(zip(SLOTS, cols))
        xml = re.sub(r"<a:(dk1|lt1|dk2|lt2|accent[1-6])>.*?</a:\1>",
                     lambda m: f"<a:{m.group(1)}><a:srgbClr val=\"{colours[m.group(1)].upper()}\"/></a:{m.group(1)}>", xml, flags=re.S)
    xml = NAME_XML.sub(f"<a:clrScheme name=\"{name}\"", xml, count=1)
    xml = re.sub(r"(<a:majorFont>\s*<a:latin typeface=\")[^\"]*", lambda m: m.group(1) + heading, xml, count=1)
    xml = re.sub(r"(<a:minorFont>\s*<a:latin typeface=\")[^\"]*", lambda m: m.group(1) + body, xml, count=1)
    return xml.encode("utf-8"), body, heading
