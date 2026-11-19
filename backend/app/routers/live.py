from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import window_key
from ..services import bridge

router = APIRouter()
LOCAL = ("127.0.0.1", "::1", "localhost", "testclient")


@router.websocket("/api/live")
async def live(ws: WebSocket) -> None:
    if (ws.client.host if ws.client else "") not in LOCAL:
        await ws.close(code=4403)
        return
    await ws.accept()
    if not await window_key.admit(ws):
        return
    key = bridge.attach(ws)
    try:
        while True:
            message = await ws.receive_json()
            if isinstance(message, dict) and message.get("t") == "result":
                bridge.resolve(message)
    except (WebSocketDisconnect, ValueError):
        pass
    finally:
        bridge.detach(key)
