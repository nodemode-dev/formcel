import json
import os
import urllib.error
import urllib.request

from .. import config

MAX_TURNS = 6


class NotConfigured(Exception):
    pass


class ModelError(Exception):
    pass


def settings_path():
    return config.DATA_DIR / "settings.json"


def load_settings() -> dict:
    try:
        return json.loads(settings_path().read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def save_settings(data: dict) -> None:
    config.ensure_data_dir()
    p = settings_path()
    tmp = p.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, p)


def public() -> dict:
    ai = load_settings().get("ai") or {}
    return {"configured": bool(ai.get("url")), "kind": ai.get("kind", "openai"), "url": ai.get("url", ""), "model": ai.get("model", ""), "key_set": bool(ai.get("key"))}


def update(kind: str, url: str, model: str, key: str | None) -> dict:
    s = load_settings()
    old = s.get("ai") or {}
    if kind not in ("openai", "anthropic"):
        raise ValueError("the endpoint is openai or anthropic")
    if url and not url.lower().startswith(("http://", "https://")):
        raise ValueError("the endpoint address starts with http:// or https://")
    s["ai"] = {"kind": kind, "url": url.strip(), "model": model.strip(), "key": old.get("key", "") if key is None else key.strip()}
    if not url.strip():
        s.pop("ai")
    save_settings(s)
    return public()


def endpoint() -> dict:
    ai = load_settings().get("ai") or {}
    if not ai.get("url"):
        raise NotConfigured("No AI endpoint is set. Add one in Assistant settings; the key stays in the engine process's data folder, never in the workbook.")
    return ai


def post(url: str, headers: dict, body: dict) -> dict:
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read(8 * 1024 * 1024))
    except urllib.error.HTTPError as e:
        raise ModelError(f"the model endpoint answered {e.code}: {e.read(300).decode('utf-8', 'replace')}")
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise ModelError(f"the model endpoint could not be reached: {e}")


def turn(ai: dict, system: str, messages: list, tools: list) -> dict:
    if ai["kind"] == "anthropic":
        url = ai["url"] if ai["url"].rstrip("/").endswith("/messages") else ai["url"].rstrip("/") + "/v1/messages"
        body = {"model": ai.get("model") or "claude-sonnet-4-5", "max_tokens": 2048, "system": system, "messages": messages}
        if tools:
            body["tools"] = [{"name": t["name"], "description": t["description"], "input_schema": t["parameters"]} for t in tools]
        out = post(url, {"x-api-key": ai.get("key", ""), "anthropic-version": "2023-06-01"}, body)
        text = "".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
        calls = [{"id": b["id"], "name": b["name"], "args": b.get("input", {})} for b in out.get("content", []) if b.get("type") == "tool_use"]
        return {"text": text, "calls": calls, "raw": {"role": "assistant", "content": out.get("content", [])}}
    url = ai["url"] if ai["url"].rstrip("/").endswith("/chat/completions") else ai["url"].rstrip("/") + "/chat/completions"
    body = {"model": ai.get("model") or "default", "messages": [{"role": "system", "content": system}] + messages}
    if tools:
        body["tools"] = [{"type": "function", "function": t} for t in tools]
    headers = {"Authorization": f"Bearer {ai['key']}"} if ai.get("key") else {}
    out = post(url, headers, body)
    try:
        msg = out["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        raise ModelError("the model endpoint answered in a shape FormCel does not read")
    calls = []
    for c in msg.get("tool_calls") or []:
        try:
            args = json.loads(c["function"].get("arguments") or "{}")
        except ValueError:
            args = {}
        calls.append({"id": c["id"], "name": c["function"]["name"], "args": args})
    return {"text": msg.get("content") or "", "calls": calls, "raw": msg}


def add_results(ai: dict, messages: list, reply: dict, results: list[tuple[str, str]]) -> None:
    messages.append(reply["raw"])
    if ai["kind"] == "anthropic":
        messages.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": i, "content": c} for i, c in results]})
    else:
        for i, c in results:
            messages.append({"role": "tool", "tool_call_id": i, "content": c})


def cell_answer(prompt: str, data: list[str]) -> str:
    from .hostcalls import esc

    ai = endpoint()
    if not prompt.strip():
        raise NotConfigured("AI needs a prompt as its first argument.")
    system = "You answer inside one spreadsheet cell. Reply with the answer only: no preamble, no markdown, one short line unless the prompt asks for more."
    content = prompt
    for n, block in enumerate(data, 1):
        content += f"\n\nData {n} (tab separated rows):\n{block}" if len(data) > 1 else f"\n\nData (tab separated rows):\n{block}"
    try:
        reply = turn(ai, system, [{"role": "user", "content": content}], [])
    except ModelError as e:
        raise NotConfigured(str(e))
    return "t:" + esc(reply["text"].strip())


TOOLS = [
    {"name": "read_range", "description": "Read the values and formulas of a range in the open workbook, for example Sheet1!A1:D20.", "parameters": {"type": "object", "properties": {"range": {"type": "string"}}, "required": ["range"]}},
    {"name": "propose_cells", "description": "Propose writing cells starting at a top-left cell. Each value is text, a number, or a formula starting with =. The user decides whether to apply it.", "parameters": {"type": "object", "properties": {"sheet": {"type": "string"}, "start": {"type": "string"}, "rows": {"type": "array", "items": {"type": "array", "items": {"type": ["string", "number"]}}}, "note": {"type": "string"}}, "required": ["start", "rows"]}},
]


def assist(prompt: str, context: dict, read_range) -> dict:
    ai = endpoint()
    system = (
        "You are the assistant inside FormCel, a spreadsheet app. The user has a workbook open. "
        "Use read_range to look at cells and propose_cells to suggest formulas, generated tables, or filled columns; the user applies proposals themselves. "
        "Formulas use Excel syntax. Keep replies short. "
        f"Workbook sheets: {', '.join(context.get('sheets', []))}. Active sheet: {context.get('sheet', '')}. Selection: {context.get('selection', '')}."
    )
    selection = context.get("selected")
    if selection:
        system += "\nSelected cells (formulas or values, tab separated rows):\n" + selection
    messages: list = [{"role": "user", "content": prompt}]
    proposals: list[dict] = []
    text = ""
    for _ in range(MAX_TURNS):
        reply = turn(ai, system, messages, TOOLS)
        text = reply["text"] or text
        if not reply["calls"]:
            break
        results = []
        for c in reply["calls"]:
            if c["name"] == "read_range":
                try:
                    results.append((c["id"], read_range(str(c["args"].get("range", "")))))
                except ValueError as e:
                    results.append((c["id"], f"error: {e}"))
            elif c["name"] == "propose_cells":
                a = c["args"]
                proposals.append({"sheet": a.get("sheet") or context.get("sheet", ""), "start": a.get("start", "A1"), "rows": a.get("rows", []), "note": a.get("note", "")})
                results.append((c["id"], "recorded; the user will decide whether to apply it"))
            else:
                results.append((c["id"], "unknown tool"))
        add_results(ai, messages, reply, results)
    return {"text": text, "proposals": proposals}
