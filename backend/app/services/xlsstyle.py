LINES = {1: "thin", 2: "medium", 3: "dashed", 4: "dotted", 5: "thick", 6: "double", 7: "thin", 8: "medium", 9: "dashed", 10: "medium", 11: "dashed", 12: "medium", 13: "dashed"}
EDGES = (("bt", "top"), ("br", "right"), ("bb", "bottom"), ("bl", "left"))
HOR = {1: "left", 2: "center", 3: "right", 6: "center"}
VER = {0: "top", 1: "middle"}


def _hex(book, index: int | None) -> str | None:
    if index is None:
        return None
    rgb = book.colour_map.get(index)
    if not rgb:
        return None
    return "".join(f"{v:02x}" for v in rgb)


class Looks:
    def __init__(self, book):
        self.book = book
        self.cache: dict[int, str] = {}
        base = book.font_list[0] if book.font_list else None
        self.size = (base.height / 20) if base is not None else 10.0
        self.face = base.name if base is not None else "Calibri"

    def tokens(self, xf_index: int | None) -> str:
        if xf_index is None or xf_index >= len(self.book.xf_list):
            return ""
        if xf_index in self.cache:
            return self.cache[xf_index]
        book = self.book
        xf = book.xf_list[xf_index]
        out: list[str] = []
        font = book.font_list[xf.font_index] if xf.font_index < len(book.font_list) else None
        if font is not None:
            if font.bold:
                out.append("b")
            if font.italic:
                out.append("i")
            if font.underline_type:
                out.append("u")
            if font.struck_out:
                out.append("s")
            if font.height and abs(font.height / 20 - self.size) > 0.01:
                out.append(f"sz:{font.height / 20:g}")
            if font.name and font.name != self.face and ";" not in font.name and ":" not in font.name:
                out.append(f"ff:{font.name}")
            fc = _hex(book, font.colour_index)
            if fc and fc != "000000":
                out.append(f"fc:{fc}")
        bg = xf.background
        if bg is not None and bg.fill_pattern == 1:
            colour = _hex(book, bg.pattern_colour_index)
            if colour:
                out.append(f"bg:{colour}")
        border = xf.border
        if border is not None:
            for tok, edge in EDGES:
                style = getattr(border, f"{edge}_line_style", 0)
                if style in LINES:
                    out.append(f"{tok}:{LINES[style]}:{_hex(book, getattr(border, f'{edge}_colour_index', None)) or '000000'}")
        al = xf.alignment
        if al is not None:
            if al.hor_align in HOR:
                out.append(f"ha:{HOR[al.hor_align]}")
            if al.vert_align in VER:
                out.append(f"va:{VER[al.vert_align]}")
            if al.indent_level:
                out.append(f"in:{int(al.indent_level)}")
            if al.text_wrapped:
                out.append("wrap")
            rot = int(al.rotation or 0)
            if rot == 255:
                out.append("rot:v")
            elif 0 < rot <= 90:
                out.append(f"rot:{rot}")
            elif 90 < rot <= 180:
                out.append(f"rot:{90 - rot}")
        self.cache[xf_index] = ";".join(out)
        return self.cache[xf_index]
