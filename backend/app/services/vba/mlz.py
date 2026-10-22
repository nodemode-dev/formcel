CHUNK = 4096


def decompress(data: bytes) -> bytes:
    if not data or data[0] != 1:
        raise ValueError("Not a compressed VBA container.")
    out = bytearray()
    pos = 1
    n = len(data)
    while pos + 2 <= n:
        head = data[pos] | data[pos + 1] << 8
        end = min(pos + (head & 0x0FFF) + 3, n)
        pos += 2
        if not head & 0x8000:
            out += data[pos : pos + CHUNK]
            pos = end if end - pos >= CHUNK else pos + CHUNK
            continue
        base = len(out)
        while pos < end:
            flags = data[pos]
            pos += 1
            for bit in range(8):
                if pos >= end:
                    break
                if not flags >> bit & 1:
                    out.append(data[pos])
                    pos += 1
                    continue
                token = data[pos] | data[pos + 1] << 8
                pos += 2
                bits = max((len(out) - base - 1).bit_length(), 4)
                length = (token & (0xFFFF >> bits)) + 3
                offset = (token >> (16 - bits)) + 1
                if offset > len(out) - base:
                    raise ValueError("Corrupt VBA copy token.")
                for _ in range(length):
                    out.append(out[-offset])
        pos = end
    return bytes(out)


def _chunk(src: bytes) -> bytes:
    out = bytearray()
    seen: dict[bytes, list[int]] = {}
    i = 0
    n = len(src)
    while i < n:
        at = len(out)
        out.append(0)
        flags = 0
        for bit in range(8):
            if i >= n:
                break
            best = 0
            where = 0
            if i >= 1 and i + 3 <= n:
                bits = max((i - 1).bit_length(), 4)
                limit = (0xFFFF >> bits) + 3
                reach = 1 << bits
                for j in reversed(seen.get(src[i : i + 3], ())[-48:]):
                    if i - j > reach:
                        break
                    k = 3
                    while k < limit and i + k < n and src[j + k] == src[i + k]:
                        k += 1
                    if k > best:
                        best, where = k, i - j
                        if k == limit:
                            break
            if best >= 3:
                bits = max((i - 1).bit_length(), 4)
                token = (where - 1) << (16 - bits) | (best - 3)
                out += bytes((token & 255, token >> 8))
                flags |= 1 << bit
                step = best
            else:
                out.append(src[i])
                step = 1
            for j in range(i, min(i + step, n - 2)):
                seen.setdefault(src[j : j + 3], []).append(j)
            i += step
        out[at] = flags
    return bytes(out)


def compress(data: bytes) -> bytes:
    out = bytearray([1])
    for start in range(0, len(data), CHUNK):
        src = data[start : start + CHUNK]
        body = _chunk(src)
        if len(src) == CHUNK and len(body) > CHUNK - 2 or len(body) > CHUNK + 2:
            out += (0x3000 | (CHUNK - 1)).to_bytes(2, "little") + src.ljust(CHUNK, b"\0")
        else:
            out += (0xB000 | (len(body) + 2 - 3)).to_bytes(2, "little") + body
    return bytes(out)
