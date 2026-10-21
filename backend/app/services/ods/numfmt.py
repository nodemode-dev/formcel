import re
from xml.sax.saxutils import escape, quoteattr

NUMBER = "urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
STYLE = "urn:oasis:names:tc:opendocument:xmlns:style:1.0"
N = f"{{{NUMBER}}}"

DATE_TOK = re.compile(r'"[^"]*"|\\.|\[[^\]]*\]|AM/PM|A/P|yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|\.0+|.', re.I)


def section(code: str) -> str:
    out, q, i = [], False, 0
    while i < len(code):
        ch = code[i]
        if ch == '"':
            q = not q
        elif ch == "\\" and not q:
            out.append(code[i:i + 2])
            i += 2
            continue
        elif ch == ";" and not q:
            break
        out.append(ch)
        i += 1
    return "".join(out)


def is_date(code: str) -> bool:
    s = re.sub(r'"[^"]*"|\\.|\[\$[^\]]*\]', "", section(code))
    return bool(re.search(r"[ydhs]|AM/PM|\[h+\]|\[m+\]|\[s+\]", s, re.I)) or (bool(re.search(r"m", s, re.I)) and not re.search(r"[0#?]", s))


def _lit(t: str) -> str:
    return f"<number:text>{escape(t)}</number:text>"


def _date_style(name: str, code: str) -> tuple[str, str]:
    toks = DATE_TOK.findall(section(code))
    kinds = [t.lower() for t in toks]
    has_date = any(k[0] in "yd" or (k[0] == "m" and not k.startswith("mm:")) for k in kinds if k and k[0] in "ydm") and any(k[0] in "yd" for k in kinds)
    parts = []
    for i, t in enumerate(toks):
        k = t.lower()
        prev = next((x for x in reversed(kinds[:i]) if x[:1] in "hsdmy"), "")
        nxt = next((x for x in kinds[i + 1:] if x[:1] in "hsdmy"), "")
        if k.startswith('"'):
            parts.append(_lit(t[1:-1]))
        elif k.startswith("\\"):
            parts.append(_lit(t[1:]))
        elif k in ("[h]", "[hh]"):
            parts.append('<number:hours number:style="%s"/>' % ("long" if k == "[hh]" else "short"))
        elif k.startswith("[m"):
            parts.append('<number:minutes number:style="long"/>')
        elif k.startswith("[s"):
            parts.append('<number:seconds number:style="long"/>')
        elif k.startswith("["):
            continue
        elif k == "yyyy":
            parts.append('<number:year number:style="long"/>')
        elif k == "yy":
            parts.append("<number:year/>")
        elif k in ("m", "mm") and (prev.startswith("h") or nxt.startswith("s")):
            parts.append('<number:minutes%s/>' % (' number:style="long"' if k == "mm" else ""))
        elif k == "mmmmm":
            parts.append('<number:month number:textual="true"/>')
        elif k == "mmmm":
            parts.append('<number:month number:style="long" number:textual="true"/>')
        elif k == "mmm":
            parts.append('<number:month number:textual="true"/>')
        elif k == "mm":
            parts.append('<number:month number:style="long"/>')
        elif k == "m":
            parts.append("<number:month/>")
        elif k == "dddd":
            parts.append('<number:day-of-week number:style="long"/>')
        elif k == "ddd":
            parts.append("<number:day-of-week/>")
        elif k == "dd":
            parts.append('<number:day number:style="long"/>')
        elif k == "d":
            parts.append("<number:day/>")
        elif k == "hh":
            parts.append('<number:hours number:style="long"/>')
        elif k == "h":
            parts.append("<number:hours/>")
        elif k == "ss":
            parts.append('<number:seconds number:style="long"/>')
        elif k == "s":
            parts.append("<number:seconds/>")
        elif k.startswith(".0") and parts and "seconds" in parts[-1]:
            parts[-1] = parts[-1].replace("/>", f' number:decimal-places="{len(k) - 1}"/>')
        elif k in ("am/pm", "a/p"):
            parts.append("<number:am-pm/>")
        else:
            if parts and parts[-1].startswith("<number:text>"):
                parts[-1] = parts[-1][:-len("</number:text>")] + escape(t) + "</number:text>"
            else:
                parts.append(_lit(t))
    tag = "date-style" if has_date else "time-style"
    extra = ' number:truncate-on-overflow="false"' if tag == "time-style" and "[" in code else ""
    return tag, f'<number:{tag} style:name="{name}"{extra}>{"".join(parts)}</number:{tag}>'


def to_style(name: str, code: str) -> tuple[str, str, bool]:
    if code == "@":
        return "string", f'<number:text-style style:name="{name}"><number:text-content/></number:text-style>', True
    if is_date(code):
        tag, xml = _date_style(name, code)
        return ("date" if tag == "date-style" else "time"), xml, ";" not in code and "[" not in code.replace("[h]", "").replace("[hh]", "")
    s = section(code)
    body = re.sub(r'"[^"]*"|\\.', "", s)
    m = re.search(r"([0#?,]*)(?:\.([0#?]+))?", body[re.search(r"[0#?]", body).start():] if re.search(r"[0#?]", body) else "")
    ints = m.group(1) if m else ""
    decs = (m.group(2) or "") if m else ""
    num = f'<number:number number:decimal-places="{len(decs)}" number:min-decimal-places="{decs.count("0")}" number:min-integer-digits="{ints.count("0")}"{" number:grouping=\"true\"" if "," in ints else ""}/>'
    exact = not re.search(r'[;?/]|\[(?!\$)', s) and not re.search(r'"', s)
    if re.search(r"E[+-]", body, re.I):
        e = re.search(r"E[+-](0+)", body, re.I)
        return "float", f'<number:number-style style:name="{name}"><number:scientific-number number:decimal-places="{decs.count("0")}" number:min-integer-digits="{max(1, ints.count("0"))}" number:min-exponent-digits="{len(e.group(1)) if e else 2}"/></number:number-style>', exact
    pre, post = (body.split(re.search(r"[0#?]", body).group(0), 1)[0] if re.search(r"[0#?]", body) else ""), ""
    if "%" in body:
        return "percentage", f'<number:percentage-style style:name="{name}">{num}<number:text>%</number:text></number:percentage-style>', exact
    cur = re.search(r"\[\$([^\]-]*)", s)
    symbol = cur.group(1) if cur else ("$" if "$" in pre else "")
    if symbol:
        lead = "$" in pre or (cur and s.find("[$") < s.find("0"))
        sym = f"<number:currency-symbol>{escape(symbol)}</number:currency-symbol>"
        inner = sym + num if lead else num + "<number:text> </number:text>" + sym
        return "currency", f'<number:currency-style style:name="{name}">{inner}</number:currency-style>', exact
    return "float", f'<number:number-style style:name="{name}">{num}</number:number-style>', exact


def _digits(el) -> tuple[int, int, bool]:
    return int(el.get(f"{N}decimal-places", "0") or 0), int(el.get(f"{N}min-integer-digits", "1") or 0), el.get(f"{N}grouping") == "true"


def _num_code(el) -> str:
    dec, ints, grp = _digits(el)
    low = el.get(f"{N}min-decimal-places")
    zeros = dec if low is None else min(dec, int(low or 0))
    head = ("#,##" + "0" * max(1, ints)) if grp else ("0" * ints or "#")
    return head + ("." + "0" * zeros + "#" * (dec - zeros) if dec else "")


def from_style(el) -> str | None:
    tag = el.tag.replace(N, "")
    out = []
    for ch in el:
        k = ch.tag.replace(N, "")
        long = ch.get(f"{N}style") == "long"
        if k == "text":
            t = ch.text or ""
            out.append(t if tag == "percentage-style" and t == "%" else (t if re.fullmatch(r"[\s/:.,\-]*", t) else f'"{t}"'))
        elif k == "number":
            out.append(_num_code(ch))
        elif k == "scientific-number":
            dec, ints, _ = _digits(ch)
            out.append("0" * max(1, ints) + ("." + "0" * dec if dec else "") + "E+" + "0" * int(ch.get(f"{N}min-exponent-digits", "2") or 2))
        elif k == "currency-symbol":
            out.append("$" if (ch.text or "") == "$" else f"[${ch.text or ''}]")
        elif k == "year":
            out.append("yyyy" if long else "yy")
        elif k == "month":
            textual = ch.get(f"{N}textual") == "true"
            out.append(("mmmm" if long else "mmm") if textual else ("mm" if long else "m"))
        elif k == "day":
            out.append("dd" if long else "d")
        elif k == "day-of-week":
            out.append("dddd" if long else "ddd")
        elif k == "hours":
            h = "hh" if long else "h"
            out.append(f"[{h}]" if el.get(f"{N}truncate-on-overflow") == "false" else h)
        elif k == "minutes":
            out.append("mm" if long else "m")
        elif k == "seconds":
            d = int(ch.get(f"{N}decimal-places", "0") or 0)
            out.append(("ss" if long else "s") + ("." + "0" * d if d else ""))
        elif k == "am-pm":
            out.append("AM/PM")
        elif k == "text-content":
            out.append("@")
        elif k == "boolean":
            return None
    code = "".join(out).strip()
    if tag == "percentage-style" and "%" not in code:
        code += "%"
    return code or None
