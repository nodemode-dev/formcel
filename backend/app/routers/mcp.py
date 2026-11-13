import json
import secrets
import time
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import config
from ..services import agents, bridge
from ..version import VERSION
from . import commands

router = APIRouter()

SUPPORTED = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
INSTRUCTIONS = ("FormCel is a spreadsheet app open on this computer. Every action in its window is a command: find one with "
                "list_commands, read it with describe_command, and run it in the open window with run_command. The person sees "
                "every change happen. The terminal, Claude Code and chat commands are the person's own and are refused.")
SWITCH = "Allow outside agents in FormCel's Preferences"
DECLINE_SECONDS = 600
_sessions: dict[str, str] = {}
_declined_until = 0.0

TOOLS = [
    {"name": "list_commands", "description": "List the commands the FormCel window can run, optionally only those matching every word of text.",
     "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}}},
    {"name": "describe_command", "description": "Describe one command: its title, what it does, whether it changes the workbook and its keys.",
     "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
    {"name": "run_command", "description": "Run a command in the open FormCel window and return its answer.",
     "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}, "params": {"type": "object"}}, "required": ["id"]}},
]


def text_result(value: Any, error: bool = False) -> dict:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return {"content": [{"type": "text", "text": text}], "isError": error}


def rpc_error(request_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def server_port(request: Request) -> int:
    server = request.scope.get("server")
    return server[1] if server and server[1] else config.PORT


async def consent(client: str) -> str | None:
    global _declined_until
    if agents.allowed():
        return None
    if time.monotonic() < _declined_until:
        return f"The person chose not to allow outside agents in FormCel just now. Ask them to turn on {SWITCH}, then retry."
    if not bridge.connected():
        return "No FormCel window is open. Start it with ./formcel and open the app, then retry."
    out = await bridge.call("__consent__", {"client": client}, 180)
    if out.get("ok") and isinstance(out.get("result"), dict) and out["result"].get("allowed") is True:
        agents.set_allowed(True)
        return None
    if out.get("ok"):
        _declined_until = time.monotonic() + DECLINE_SECONDS
    return f"The person did not allow outside agents in FormCel. Ask them to turn on {SWITCH}, then retry."


async def call_tool(name: str, args: dict, client: str, inapp: bool) -> dict:
    if name == "list_commands":
        rows = commands.search(str(args.get("text") or ""))
        return text_result({"commands": [{k: c.get(k) for k in ("id", "title", "description")} for c in rows], "hint": "" if commands._catalogue else commands.EMPTY})
    cid = str(args.get("id") or "")
    if name == "describe_command":
        found = commands.find(cid)
        return text_result(found) if found else text_result(f"No command has the id {cid}; call list_commands for the ids.", True)
    refusal = commands.window_only(cid)
    if refusal:
        return text_result(refusal, True)
    if not inapp:
        why = await consent(client)
        if why:
            return text_result(why, True)
    params = args.get("params")
    out = await commands.execute(cid, params if isinstance(params, dict) else {})
    return text_result(out.get("result") if out["ok"] else out["error"], not out["ok"])


async def dispatch(message: Any, request: Request) -> tuple[dict | None, dict]:
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return rpc_error(None, -32600, "invalid request"), {}
    method, request_id, params = message.get("method"), message.get("id"), message.get("params") or {}
    if not isinstance(method, str) or not isinstance(params, dict):
        return rpc_error(request_id, -32600, "invalid request"), {}
    if "id" not in message:
        return None, {}
    inapp = agents.is_inapp(request.headers.get(agents.INAPP_HEADER))
    sid = request.headers.get("mcp-session-id") or ""
    if method == "initialize":
        asked = params.get("protocolVersion")
        info = params.get("clientInfo") if isinstance(params.get("clientInfo"), dict) else {}
        name = agents.INAPP_CLIENT if inapp else str(info.get("name") or "an outside agent")[:80]
        if name == agents.INAPP_CLIENT and not inapp:
            name += " (outside)"
        sid = secrets.token_urlsafe(16)
        _sessions[sid] = name
        while len(_sessions) > 500:
            _sessions.pop(next(iter(_sessions)))
        result = {"protocolVersion": asked if asked in SUPPORTED else SUPPORTED[0], "capabilities": {"tools": {"listChanged": False}},
                  "serverInfo": {"name": "formcel", "version": VERSION}, "instructions": INSTRUCTIONS}
        return {"jsonrpc": "2.0", "id": request_id, "result": result}, {"Mcp-Session-Id": sid}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}, {}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}, {}
    if method == "tools/call":
        name, arguments = params.get("name"), params.get("arguments")
        if not any(t["name"] == name for t in TOOLS):
            return rpc_error(request_id, -32602, f"unknown tool {name}"), {}
        client = agents.INAPP_CLIENT if inapp else _sessions.get(sid) or request.headers.get("user-agent") or "an outside agent"
        try:
            outcome = await call_tool(str(name), arguments if isinstance(arguments, dict) else {}, client, inapp)
        except Exception as exc:
            outcome = text_result(f"the tool failed: {exc}", True)
        return {"jsonrpc": "2.0", "id": request_id, "result": outcome}, {}
    return rpc_error(request_id, -32601, f"method not found: {method}"), {}


@router.get("/mcp")
def mcp_stream() -> Response:
    return Response(status_code=405, headers={"Allow": "POST, DELETE"})


@router.delete("/mcp")
def mcp_end(request: Request) -> Response:
    _sessions.pop(request.headers.get("mcp-session-id") or "", None)
    return Response(status_code=204)


@router.post("/mcp")
async def mcp(request: Request) -> Response:
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        return JSONResponse(rpc_error(None, -32600, "send the request as application/json"), status_code=415)
    try:
        body = json.loads((await request.body()) or b"null")
    except ValueError:
        return JSONResponse(rpc_error(None, -32700, "parse error"), status_code=400)
    if isinstance(body, list):
        replies = [reply for reply, _ in [await dispatch(item, request) for item in body] if reply is not None]
        return JSONResponse(replies) if replies else Response(status_code=202)
    reply, headers = await dispatch(body, request)
    return JSONResponse(reply, headers=headers) if reply is not None else Response(status_code=202)


class Allowed(BaseModel):
    allowed: bool


@router.get("/api/agents/allowed")
def get_allowed() -> dict:
    return {"allowed": agents.allowed()}


@router.put("/api/agents/allowed")
def put_allowed(body: Allowed) -> dict:
    global _declined_until
    _declined_until = 0.0
    return {"allowed": agents.set_allowed(body.allowed)}


@router.get("/api/mcp/status")
def status(request: Request) -> dict:
    port = server_port(request)
    return {"window": bridge.connected(), "allowed": agents.allowed(), "endpoint": f"http://127.0.0.1:{port}/mcp",
            "tools": [t["name"] for t in TOOLS], "commands": len(commands._catalogue),
            "claude_code": f"claude mcp add --transport http formcel http://127.0.0.1:{port}/mcp"}
