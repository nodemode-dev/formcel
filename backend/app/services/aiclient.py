import json
import os
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

from .. import config
from . import secrets

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


SETTINGS = threading.RLock()


def save_settings(data: dict) -> None:
    config.ensure_data_dir()
    p = settings_path()
    with SETTINGS:
        fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".settings-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp, p)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


def _file_secret(group: str | None, field: str):
    def read() -> str | None:
        s = load_settings()
        return ((s.get(group) or {}) if group else s).get(field) or None

    def write(value: str) -> None:
        with SETTINGS:
            s = load_settings()
            (s.setdefault(group, {}) if group else s)[field] = value
            save_settings(s)

    def clear() -> None:
        with SETTINGS:
            s = load_settings()
            box = (s.get(group) or {}) if group else s
            if field in box:
                box.pop(field)
                save_settings(s)

    return read, write, clear


def ai_key() -> str:
    read, _, clear = _file_secret("ai", "key")
    return secrets.get("ai", read, clear) or ""


def set_ai_key(value: str) -> None:
    read, write, clear = _file_secret("ai", "key")
    if value:
        secrets.put("ai", value, write, clear)
    else:
        secrets.delete("ai", clear)


def api_token() -> str:
    read, _, clear = _file_secret(None, "api_token")
    return secrets.get("api", read, clear) or ""


def set_api_token(value: str) -> None:
    read, write, clear = _file_secret(None, "api_token")
    if value:
        secrets.put("api", value, write, clear)
    else:
        secrets.delete("api", clear)


def public() -> dict:
    ai = load_settings().get("ai") or {}
    return {"configured": bool(ai.get("url")), "kind": ai.get("kind", "openai"), "url": ai.get("url", ""), "model": ai.get("model", ""), "key_set": bool(ai_key()), "store": secrets.where()}


def update(kind: str, url: str, model: str, key: str | None) -> dict:
    if kind not in ("openai", "anthropic"):
        raise ValueError("the endpoint is openai or anthropic")
    if url and not url.lower().startswith(("http://", "https://")):
        raise ValueError("the endpoint address starts with http:// or https://")
    with SETTINGS:
        s = load_settings()
        old_key = (s.get("ai") or {}).get("key")
        s["ai"] = {"kind": kind, "url": url.strip(), "model": model.strip()}
        if old_key:
            s["ai"]["key"] = old_key
        if not url.strip():
            s.pop("ai")
        save_settings(s)
    if key is not None:
        set_ai_key(key.strip())
    if not url.strip():
        set_ai_key("")
    return public()


def endpoint() -> dict:
    ai = dict(load_settings().get("ai") or {})
    if not ai.get("url"):
        raise NotConfigured("No AI endpoint is set. Add one in Assistant settings; the key stays in the engine process's data folder, never in the workbook.")
    ai["key"] = ai_key()
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
    {"name": "create_chart", "description": "Propose a chart of a range, for example Sheet1!A1:C12 with a header row. The user decides whether to insert it. Types: column, column-stacked, bar, bar-stacked, line, area, pie, doughnut, scatter, histogram, waterfall, funnel, radar.", "parameters": {"type": "object", "properties": {"sheet": {"type": "string"}, "range": {"type": "string"}, "type": {"type": "string"}, "title": {"type": "string"}, "byRows": {"type": "boolean"}}, "required": ["range", "type"]}},
    {"name": "create_pivot", "description": "Propose a PivotTable over a source range with a header row, for example Sheet1!A1:D200. rows and cols are field names, values lists {field, func} with func one of sum, count, average, max, min. The user decides whether to build it on a new sheet.", "parameters": {"type": "object", "properties": {"source": {"type": "string"}, "rows": {"type": "array", "items": {"type": "string"}}, "cols": {"type": "array", "items": {"type": "string"}}, "values": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "func": {"type": "string"}}, "required": ["field"]}}, "note": {"type": "string"}}, "required": ["source", "values"]}},
    {"name": "propose_cells", "description": "Propose writing cells starting at a top-left cell. Each value is text, a number, or a formula starting with =. The user decides whether to apply it.", "parameters": {"type": "object", "properties": {"sheet": {"type": "string"}, "start": {"type": "string"}, "rows": {"type": "array", "items": {"type": "array", "items": {"type": ["string", "number"]}}}, "note": {"type": "string"}}, "required": ["start", "rows"]}},
]


def assist(prompt: str, context: dict, read_range) -> dict:
    ai = endpoint()
    system = (
        "You are the assistant inside FormCel, a spreadsheet app. The user has a workbook open. "
        "Use read_range to look at cells and propose_cells to suggest formulas, generated tables, or filled columns; use create_chart and create_pivot when asked for a chart or a PivotTable; the user applies proposals themselves. "
        "Formulas use Excel syntax. Keep replies short. "
        f"Workbook sheets: {', '.join(context.get('sheets', []))}. Active sheet: {context.get('sheet', '')}. Selection: {context.get('selection', '')}."
    )
    selection = context.get("selected")
    if selection:
        system += "\nSelected cells (formulas or values, tab separated rows):\n" + selection
    messages: list = [{"role": "user", "content": prompt}]
    proposals: list[dict] = []
    charts: list[dict] = []
    pivots: list[dict] = []
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
            elif c["name"] == "create_chart":
                a = c["args"]
                charts.append({"sheet": a.get("sheet") or context.get("sheet", ""), "range": str(a.get("range", "")), "type": str(a.get("type", "column")), "title": str(a.get("title", "")), "byRows": bool(a.get("byRows")), "note": str(a.get("title") or a.get("type") or "chart")})
                results.append((c["id"], "recorded; the user will decide whether to insert it"))
            elif c["name"] == "create_pivot":
                a = c["args"]
                pivots.append({"source": str(a.get("source", "")), "rows": [str(x) for x in a.get("rows", [])], "cols": [str(x) for x in a.get("cols", [])], "values": [{"field": str(v.get("field", "")), "func": str(v.get("func", "sum"))} for v in a.get("values", []) if isinstance(v, dict)], "note": str(a.get("note", ""))})
                results.append((c["id"], "recorded; the user will decide whether to build it"))
            else:
                results.append((c["id"], "unknown tool"))
        add_results(ai, messages, reply, results)
    return {"text": text, "proposals": proposals, "charts": charts, "pivots": pivots}
