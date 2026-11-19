import asyncio
import hmac
import json
import os
import secrets

from fastapi import HTTPException, Request, WebSocket

HEADER = "x-formcel-window-key"
STDOUT_ENV = "FORMCEL_WINDOW_KEY_STDOUT"
LINE = "formcel-window-key: "
REFUSED = "Only the FormCel window can do this"
READS = ("GET", "HEAD", "OPTIONS")
OPEN = ("/mcp", "/api/window/key")
REST = "/api/v1/"
KEY = secrets.token_urlsafe(32)
STATE = {"claimed": False, "secondClaim": False}


def stdout_mode() -> bool:
    return os.environ.get(STDOUT_ENV) == "1"


def valid(value) -> bool:
    return isinstance(value, str) and bool(value) and hmac.compare_digest(value.encode("utf-8"), KEY.encode("utf-8"))


def require(request: Request) -> None:
    if not valid(request.headers.get(HEADER)):
        raise HTTPException(403, REFUSED)


def claim() -> str | None:
    if STATE["claimed"]:
        STATE["secondClaim"] = True
        return None
    STATE["claimed"] = True
    return KEY


def rest_token_set() -> bool:
    from .services import aiclient

    return bool(aiclient.api_token())


def open_path(path: str) -> bool:
    return path in OPEN or (path.startswith(REST) and rest_token_set())


async def admit(ws: WebSocket, field: str = "key") -> bool:
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), 10))
    except Exception:
        first = None
    if isinstance(first, dict) and valid(first.get(field)):
        return True
    try:
        await ws.close(code=4403)
    except RuntimeError:
        pass
    return False


class WindowKeyGuard:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope.get("method") in READS or open_path(str(scope.get("path", ""))):
            await self.app(scope, receive, send)
            return
        given = next((v.decode("latin-1") for k, v in scope.get("headers", []) if k.decode("latin-1").lower() == HEADER), None)
        if valid(given):
            await self.app(scope, receive, send)
            return
        body = json.dumps({"detail": REFUSED}).encode("utf-8")
        await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
