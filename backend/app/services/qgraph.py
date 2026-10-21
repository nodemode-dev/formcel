def lookup(library: dict, ref: str) -> str | None:
    if ref in library:
        return ref
    for k, v in library.items():
        if v.get("name") == ref:
            return k
    return None


def uses(query: dict, library: dict) -> list[str]:
    out: list[str] = []
    src = query.get("source") or {}
    if src.get("kind") == "query" and src.get("query"):
        out.append(src["query"])
    for s in query.get("steps") or []:
        if s.get("query"):
            out.append(s["query"])
        elif isinstance(s.get("other"), dict):
            o = s["other"]
            if (o.get("source") or {}).get("kind") == "query" and o["source"].get("query"):
                out.append(o["source"]["query"])
    seen, res = set(), []
    for r in out:
        k = lookup(library, r)
        if k is not None and k not in seen:
            seen.add(k)
            res.append(k)
    return res


def graph(library: dict) -> dict:
    deps = {k: uses(v, library) for k, v in library.items()}
    order: list[str] = []
    state: dict[str, int] = {}
    cycles: list[list[str]] = []

    def visit(k: str, trail: list[str]) -> None:
        if state.get(k) == 2:
            return
        if state.get(k) == 1:
            cycles.append(trail[trail.index(k):] + [k])
            return
        state[k] = 1
        for d in deps.get(k, []):
            visit(d, trail + [k])
        state[k] = 2
        order.append(k)

    for k in library:
        visit(k, [])
    nodes = []
    for k, v in library.items():
        src = v.get("source") or {}
        nodes.append({
            "id": k,
            "name": v.get("name") or k,
            "kind": src.get("kind", ""),
            "uses": deps[k],
            "usedBy": [o for o, d in deps.items() if k in d],
            "target": v.get("target"),
        })
    return {"nodes": nodes, "order": order, "cycles": cycles}


def refresh_order(library: dict, ids: list[str] | None = None) -> list[str]:
    g = graph(library)
    if g["cycles"]:
        raise ValueError("queries refer to each other in a circle: " + " -> ".join(library[x].get("name") or x for x in g["cycles"][0]))
    return [k for k in g["order"] if ids is None or k in ids]
