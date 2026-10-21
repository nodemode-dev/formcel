from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.styles.colors import COLOR_INDEX, Color

SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]
FILE_THEME = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]
LINES_IN = {"thin": "thin", "hair": "thin", "medium": "medium", "thick": "thick", "dashed": "dashed", "mediumDashed": "dashed",
            "dashDot": "dashed", "mediumDashDot": "dashed", "dashDotDot": "dotted", "mediumDashDotDot": "dotted",
            "slantDashDot": "dashed", "dotted": "dotted", "double": "double"}
EDGES = (("bt", "top"), ("br", "right"), ("bb", "bottom"), ("bl", "left"))


def colour_in(c: Color | None, auto: str | None = None) -> str | None:
    if c is None:
        return None
    if c.type == "rgb" and isinstance(c.rgb, str) and len(c.rgb) >= 6:
        if c.rgb.upper().startswith("00") and len(c.rgb) == 8 and c.rgb.upper() == "00000000":
            return None
        return c.rgb[-6:].lower()
    if c.type == "theme" and isinstance(c.theme, int) and 0 <= c.theme < len(FILE_THEME):
        tint = round((c.tint or 0) * 100)
        return f"t:{FILE_THEME[c.theme]}" + (f":{tint}" if tint else "")
    if c.type == "indexed" and isinstance(c.indexed, int) and c.indexed < len(COLOR_INDEX):
        return COLOR_INDEX[c.indexed][-6:].lower()
    return auto


def tokens_in(cell, default_font: tuple[str, float]) -> str:
    out: list[str] = []
    f = cell.font
    if f is not None:
        if f.b:
            out.append("b")
        if f.i:
            out.append("i")
        if f.u and f.u != "none":
            out.append("u")
        if f.strike:
            out.append("s")
        if f.sz and float(f.sz) != default_font[1]:
            out.append(f"sz:{float(f.sz):g}")
        if f.name and f.name != default_font[0]:
            out.append(f"ff:{f.name}")
        fc = colour_in(f.color)
        if fc and fc not in ("000000", "t:dk1"):
            out.append(f"fc:{fc}")
    fill = cell.fill
    if getattr(fill, "patternType", None) == "solid":
        bg = colour_in(fill.fgColor)
        if bg:
            out.append(f"bg:{bg}")
    b = cell.border
    if b is not None:
        for tok, edge in EDGES:
            side = getattr(b, edge)
            if side is not None and side.style in LINES_IN:
                out.append(f"{tok}:{LINES_IN[side.style]}:{colour_in(side.color) or '000000'}")
    a = cell.alignment
    if a is not None:
        ha = {"left": "left", "center": "center", "centerContinuous": "center", "right": "right"}.get(a.horizontal or "")
        if ha:
            out.append(f"ha:{ha}")
        va = {"top": "top", "center": "middle"}.get(a.vertical or "")
        if va:
            out.append(f"va:{va}")
        if a.indent:
            out.append(f"in:{int(a.indent)}")
        if a.wrap_text:
            out.append("wrap")
        r = int(a.textRotation or 0)
        if r == 255:
            out.append("rot:v")
        elif 0 < r <= 90:
            out.append(f"rot:{r}")
        elif 90 < r <= 180:
            out.append(f"rot:{90 - r}")
    return ";".join(out)


def colour_out(v: str) -> Color:
    if v.startswith("t:"):
        parts = v.split(":")
        slot = parts[1] if len(parts) > 1 else "dk1"
        tint = int(parts[2]) / 100 if len(parts) > 2 and parts[2].lstrip("-").isdigit() else 0.0
        return Color(theme=FILE_THEME.index(slot) if slot in FILE_THEME else 1, tint=tint)
    return Color(rgb="FF" + v[-6:].upper())


def apply_out(cell, text: str, body: str, heading: str) -> None:
    font: dict = {}
    sides: dict = {}
    al: dict = {}
    fill = None
    for tok in text.split(";"):
        k, _, v = tok.partition(":")
        if k in ("b", "i"):
            font[k] = True
        elif k == "u":
            font["u"] = "single"
        elif k == "s":
            font["strike"] = True
        elif k == "sz" and v:
            font["sz"] = float(v)
        elif k == "ff" and v:
            font["name"] = heading if v == "+heading" else body if v == "+body" else v
        elif k == "fc" and v:
            font["color"] = colour_out(v)
        elif k == "bg" and v:
            c = colour_out(v)
            fill = PatternFill(fill_type="solid", fgColor=c, bgColor=c)
        elif k in ("bt", "br", "bb", "bl"):
            line, _, col = v.partition(":")
            sides[dict(EDGES)[k]] = Side(style=line if line in ("thin", "medium", "thick", "dashed", "dotted", "double") else "thin", color=colour_out(col or "000000"))
        elif k == "ha":
            al["horizontal"] = v
        elif k == "va":
            al["vertical"] = "center" if v == "middle" else v
        elif k == "in" and v.isdigit():
            al["indent"] = int(v)
        elif k == "wrap":
            al["wrap_text"] = True
        elif k == "rot" and v:
            if v == "v":
                al["textRotation"] = 255
            else:
                n = int(v)
                al["textRotation"] = n if n >= 0 else 90 - n
    if font:
        font.setdefault("name", body)
        font.setdefault("sz", 10)
        cell.font = Font(**font)
    if fill is not None:
        cell.fill = fill
    if sides:
        cell.border = Border(**sides)
    if al:
        cell.alignment = Alignment(**al)
