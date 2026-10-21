from .hostcalls import esc

WINDOW_VERBS = {"set", "load", "calculate", "array", "loadarrays", "ignore", "resetignore", "fix", "extload", "extrefresh", "extchange", "extbreak"}


def save(eng, sheets: int) -> dict:
    return {
        "calc": eng.calc("get"),
        "externals": eng.calc("extlines").splitlines(),
        "arrays": [[[int(x) for x in line.split("\t")] for line in eng.calc(f"arrays\t{i}").splitlines()] for i in range(sheets)],
    }


def restore(eng, doc: dict, arrays: list[list]) -> None:
    for i, areas in enumerate(arrays):
        if areas:
            eng.calc(f"loadarrays\t{i}\t" + esc("\n".join("\t".join(str(x) for x in a) for a in areas)))
    if doc.get("externals"):
        eng.calc("extload\t" + esc("\n".join(doc["externals"])))
    if doc.get("calc"):
        eng.calc("load\t" + esc(doc["calc"]))


def run(eng, cmd: str) -> str:
    if cmd.split("\t", 1)[0] not in WINDOW_VERBS:
        raise ValueError("unknown calculation command")
    reply = eng.calc(cmd)
    if reply.startswith("error\t"):
        raise ValueError(reply.split("\t", 1)[1])
    return reply
