import json
import re

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import config, window_key
from app.services import agents, aiclient, seal

OPEN = {("POST", "/mcp"), ("DELETE", "/mcp"), ("POST", "/api/window/key")}
WS = "ws://127.0.0.1:8199"


@pytest.fixture()
def bare(app):
    with TestClient(app, base_url="http://127.0.0.1:8199") as c:
        yield c


def write_operations(app):
    for path, ops in app.openapi()["paths"].items():
        for method in ops:
            if method.upper() not in ("GET", "HEAD", "OPTIONS"):
                yield method.upper(), path


def test_every_write_needs_the_window_key(app, bare):
    aiclient.set_api_token("")
    loose = []
    for method, path in write_operations(app):
        if (method, path) in OPEN:
            continue
        r = bare.request(method, re.sub(r"\{[^}]+\}", "zz1", path), json={})
        if r.status_code != 403 or r.json().get("detail") != window_key.REFUSED:
            loose.append(f"{method} {path} {r.status_code}")
    assert loose == []


def test_the_rest_api_writes_only_with_its_own_token(bare):
    aiclient.set_api_token("")
    assert bare.post("/api/v1/workbooks", json={"name": "a"}).status_code == 403
    aiclient.set_api_token("t0ken-for-tests")
    try:
        assert bare.post("/api/v1/workbooks", json={"name": "a"}).status_code == 401
        assert bare.post("/api/v1/workbooks", json={"name": "a"}, headers={"Authorization": "Bearer t0ken-for-tests"}).status_code == 201
    finally:
        aiclient.set_api_token("")


def test_the_bootstrap_answers_once(bare, monkeypatch):
    monkeypatch.setitem(window_key.STATE, "claimed", False)
    monkeypatch.setitem(window_key.STATE, "secondClaim", False)
    first = bare.post("/api/window/key")
    assert first.status_code == 200 and window_key.valid(first.json()["key"])
    assert bare.post("/api/window/key").status_code == 409
    assert bare.get("/api/window/state").json()["secondClaim"] is True
    monkeypatch.setenv(window_key.STDOUT_ENV, "1")
    assert bare.post("/api/window/key").status_code == 404


def test_a_kept_key_is_checked_without_a_second_claim(bare, monkeypatch):
    monkeypatch.setitem(window_key.STATE, "claimed", True)
    monkeypatch.setitem(window_key.STATE, "secondClaim", False)
    assert bare.post("/api/window/check", headers={window_key.HEADER: window_key.KEY}).json() == {"ok": True}
    assert bare.post("/api/window/check", headers={window_key.HEADER: "stale"}).status_code == 403
    assert bare.post("/api/window/check").status_code == 403
    assert bare.get("/api/window/state").json()["secondClaim"] is False


def test_the_live_socket_takes_only_a_keyed_window(bare):
    from app.services import bridge

    with pytest.raises(WebSocketDisconnect) as closed:
        with bare.websocket_connect(WS + "/api/live") as ws:
            ws.send_text(json.dumps({"type": "key", "key": "wrong"}))
            ws.receive_text()
    assert closed.value.code == 4403
    assert not bridge.connected()
    with bare.websocket_connect(WS + "/api/live") as ws:
        ws.send_text(json.dumps({"type": "key", "key": window_key.KEY}))
        ws.send_text(json.dumps({"t": "ping"}))
        assert bridge.connected()


@pytest.mark.parametrize("path", ["/api/terminal/zz1/stream", "/api/agent/claude/stream"])
def test_dock_sockets_need_the_key(bare, path):
    with pytest.raises(WebSocketDisconnect) as closed:
        with bare.websocket_connect(WS + path, headers={"origin": "http://127.0.0.1:5199"}) as ws:
            ws.send_text(json.dumps({"type": "input", "data": "echo hi\n"}))
            ws.receive_text()
    assert closed.value.code == 4403


def test_a_keyed_chat_stream_is_served(bare):
    with bare.websocket_connect(WS + "/api/agent/claude/stream", headers={"origin": "http://127.0.0.1:5199"}) as ws:
        ws.send_text(json.dumps({"type": "key", "key": window_key.KEY}))
        assert json.loads(ws.receive_text())["type"] == "state"


def test_only_the_window_changes_agent_access(bare, client):
    assert bare.put("/api/agents/allowed", json={"allowed": True}).status_code == 403
    assert client.put("/api/agents/allowed", json={"allowed": False}).json()["allowed"] is False


def test_an_in_app_token_dies_with_its_tab():
    one, two = agents.mint("tab-one"), agents.mint("tab-two")
    assert one != two and agents.is_inapp(one) and agents.is_inapp(two)
    agents.revoke(one)
    assert not agents.is_inapp(one) and agents.is_inapp(two)
    agents.drop("tab-two")
    assert not agents.is_inapp(two)


class _Memory:
    priority = 5

    def __init__(self):
        self.kept = {}

    def get_password(self, service, name):
        return self.kept.get((service, name))

    def set_password(self, service, name, value):
        self.kept[(service, name)] = value


def test_a_hand_edit_of_agent_access_is_caught(client, monkeypatch):
    from app.services import secrets as store

    memory = _Memory()
    monkeypatch.setattr(store, "_store", lambda: memory)
    seal.reset()
    try:
        client.put("/api/agents/allowed", json={"allowed": True})
        assert client.get("/api/agents/allowed").json() == {"allowed": True, "choice": "allowed", "seal": "ok", "sealBroken": False}
        path = config.DATA_DIR / "settings.json"
        stored = json.loads(path.read_text(encoding="utf-8"))
        stored["seal"] = "0" * 64
        path.write_text(json.dumps(stored), encoding="utf-8")
        assert client.get("/api/agents/allowed").json() == {"allowed": False, "choice": "ask", "seal": "broken", "sealBroken": True}
        assert agents.allowed() is False
    finally:
        client.put("/api/agents/allowed", json={"allowed": False})
        seal.reset()


def test_no_keychain_leaves_the_engine_working(client, monkeypatch):
    from app.services import secrets as store

    monkeypatch.setattr(store, "_store", lambda: None)
    seal.reset()
    try:
        assert client.get("/api/agents/allowed").json()["seal"] == "unavailable"
        assert client.get("/api/health").status_code == 200
    finally:
        seal.reset()
