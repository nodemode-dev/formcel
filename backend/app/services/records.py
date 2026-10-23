KINDS = ("stock", "currency")
MAX_RECORDS = 20000
MAX_FIELDS = 200


def to_doc(items: list[tuple]) -> list[dict]:
    return [{"id": i, "kind": k, "entity": e, "provider": p, "at": a, "fields": [list(f) for f in fields]} for i, k, e, p, a, fields in items]


def from_doc(docs) -> list[tuple]:
    out = []
    for d in docs[:MAX_RECORDS] if isinstance(docs, list) else []:
        try:
            fields = [(str(n), str(t), str(v)) for n, t, v in d["fields"][:MAX_FIELDS]]
            rec = (str(d["id"]), str(d["kind"]), str(d["entity"]), str(d.get("provider", "")), int(d.get("at", 0)), fields)
        except (KeyError, TypeError, ValueError):
            continue
        if rec[1] in KINDS and rec[2]:
            out.append(rec)
    return out
