import struct

SECTOR = 512
MINI = 64
FREE = 0xFFFFFFFF
END = 0xFFFFFFFE
FATSEC = 0xFFFFFFFD
NONE = 0xFFFFFFFF


class _Node:
    def __init__(self, name: str, kind: int, data: bytes = b""):
        self.name = name
        self.kind = kind
        self.data = data
        self.kids: dict[str, "_Node"] = {}
        self.left = self.right = self.child = NONE
        self.color = 1
        self.start = END if kind != 2 else END
        self.size = 0
        self.index = 0


def _key(n: _Node) -> tuple[int, str]:
    return (len(n.name), n.name.upper())


def _balance(nodes: list[_Node], depth: int, deepest: list[int]) -> int:
    if not nodes:
        return NONE
    mid = len(nodes) // 2
    me = nodes[mid]
    me.depth = depth
    deepest[0] = max(deepest[0], depth)
    me.left = _balance(nodes[:mid], depth + 1, deepest)
    me.right = _balance(nodes[mid + 1 :], depth + 1, deepest)
    return me.index


def _tree(parent: _Node, order: list[_Node]) -> None:
    kids = sorted(parent.kids.values(), key=_key)
    for k in kids:
        k.index = len(order)
        order.append(k)
    deepest = [0]
    parent.child = _balance(kids, 0, deepest)
    perfect = len(kids) + 1 & len(kids) == 0
    for k in kids:
        k.color = 1 if perfect or k.depth != deepest[0] else 0
    for k in kids:
        if k.kind == 1:
            _tree(k, order)


def build(files: dict[str, bytes]) -> bytes:
    root = _Node("Root Entry", 5)
    for path, data in files.items():
        parts = path.split("/")
        at = root
        for p in parts[:-1]:
            at = at.kids.setdefault(p, _Node(p, 1))
        at.kids[parts[-1]] = _Node(parts[-1], 2, data)
    order = [root]
    root.index = 0
    _tree(root, order)

    mini = bytearray()
    minifat: list[int] = []
    big: list[tuple[_Node, int]] = []
    for n in order:
        if n.kind != 2:
            continue
        n.size = len(n.data)
        if not n.data:
            n.start = END
        elif n.size < 4096:
            n.start = len(minifat)
            cnt = -(-n.size // MINI)
            minifat.extend(range(len(minifat) + 1, len(minifat) + cnt))
            minifat.append(END)
            mini += n.data.ljust(cnt * MINI, b"\0")
        else:
            big.append((n, -(-n.size // SECTOR)))
    root.size = len(mini)
    mini_secs = -(-len(mini) // SECTOR)
    minifat_secs = -(-len(minifat) // 128)
    dir_secs = -(-len(order) // 4)
    data_secs = sum(c for _, c in big)
    fat_secs = 1
    while fat_secs * 128 < mini_secs + minifat_secs + dir_secs + data_secs + fat_secs:
        fat_secs += 1
    if fat_secs > 109:
        raise ValueError("The VBA project is too large to write.")

    fat: list[int] = []

    def chain(count: int) -> int:
        first = len(fat)
        fat.extend(range(first + 1, first + count))
        fat.append(END)
        return first

    body = bytearray()
    root.start = chain(mini_secs) if mini_secs else END
    body += bytes(mini).ljust(mini_secs * SECTOR, b"\0")
    for n, c in big:
        n.start = chain(c)
        body += n.data.ljust(c * SECTOR, b"\0")
    minifat_start = chain(minifat_secs) if minifat_secs else END
    mf = (minifat + [FREE] * (minifat_secs * 128 - len(minifat)))[: minifat_secs * 128]
    body += struct.pack(f"<{len(mf)}I", *mf)
    dir_start = chain(dir_secs)
    ent = bytearray()
    for n in order:
        raw = n.name.encode("utf-16-le") + b"\0\0"
        ent += raw.ljust(64, b"\0")
        ent += struct.pack("<HBBIII", len(raw), n.kind, n.color, n.left, n.right, n.child)
        ent += b"\0" * 16 + b"\0" * 4 + b"\0" * 16
        ent += struct.pack("<IQ", n.start if n.kind != 1 else 0, n.size if n.kind != 1 else 0)
    while len(ent) < dir_secs * 4 * 128:
        ent += b"\0" * 64 + struct.pack("<HBBIII", 0, 0, 0, NONE, NONE, NONE) + b"\0" * 36 + struct.pack("<IQ", 0, 0)
    body += ent
    fat_start = len(fat)
    fat.extend([FATSEC] * fat_secs)
    fat += [FREE] * (fat_secs * 128 - len(fat))
    body += struct.pack(f"<{len(fat)}I", *fat)

    difat = [fat_start + i for i in range(fat_secs)] + [FREE] * (109 - fat_secs)
    head = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 16
    head += struct.pack("<HHHHH6x", 0x3E, 3, 0xFFFE, 9, 6)
    head += struct.pack("<IIIIIIIII", 0, fat_secs, dir_start, 0, 4096, minifat_start, minifat_secs, END, 0)
    head += struct.pack("<109I", *difat)
    return head + bytes(body)
