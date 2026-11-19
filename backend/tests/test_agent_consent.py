import json
import threading

import pytest

from app import window_key
from app.routers import commands, mcp
from app.services import agents

WS = "ws://127.0.0.1:8199"
COMMAND = {"id": "demo-bold", "title": "Bold", "description": "Make the selection bold", "changes": True, "keys": None}
CALL = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "run_command", "arguments": {"id": "demo-bold"}}}


@pytest.fixture()
def window(client, monkeypatch):
    monkeypatch.setattr(commands, "_catalogue", [COMMAND])
    monkeypatch.setattr(mcp, "_declined_until", 0.0)
    client.put("/api/agents/allowed", json={"allowed": False})
    with client.websocket_connect(WS + "/api/live") as ws:
        ws.send_text(json.dumps({"type": "key", "key": window_key.KEY}))
        yield ws
    client.put("/api/agents/allowed", json={"allowed": False})


@pytest.fixture()
def outside(client):
    hello = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "clientInfo": {"name": "probe-agent"}}}
    return {"mcp-session-id": client.post("/mcp", json=hello).headers["mcp-session-id"]}


def call(client, headers):
    return client.post("/mcp", json=CALL, headers=headers).json()["result"]


def asked(client, ws, headers, answer):
    box = {}
    worker = threading.Thread(target=lambda: box.update(out=call(client, headers)))
    worker.start()
    question = ws.receive_json()
    if answer is not None:
        ws.send_json({"t": "result", "id": question["id"], "ok": True, "result": answer})
    gone = ws.receive_json()
    if answer and answer.get("allowed"):
        ran(ws)
    worker.join(20)
    return question, gone, box["out"]


def ran(ws):
    run = ws.receive_json()
    assert run["command"] == "demo-bold"
    ws.send_json({"t": "result", "id": run["id"], "ok": True, "result": {"ran": True}})


def test_the_question_names_the_agent_the_request_and_the_answers(client, window, outside):
    question, gone, out = asked(client, window, outside, {"allowed": False})
    assert question["t"] == "run" and question["command"] == "__consent__"
    params = question["params"]
    assert params["client"] == params["agent"] == "probe-agent"
    assert params["request"] == question["id"]
    assert (params["tool"], params["command"], params["what"]) == ("run_command", "demo-bold", "run the command Bold")
    assert params["answers"] == ["deny", "once", "always"] and params["alwaysCovers"] == "all"
    assert params["expiresIn"] == mcp.CONSENT_SECONDS and params["expiresAt"] > 0
    assert gone == {"t": "consent-withdrawn", "id": question["id"], "reason": "answered"}
    assert out["isError"] and "did not allow" in out["content"][0]["text"]
    again = call(client, outside)
    assert again["isError"] and "just now" in again["content"][0]["text"]


def test_allow_once_runs_that_call_and_the_next_call_asks_again(client, window, outside):
    first, _, out = asked(client, window, outside, {"allowed": True, "once": True})
    assert not out["isError"] and agents.allowed() is False
    second, _, out = asked(client, window, outside, {"allowed": True, "once": True})
    assert second["command"] == "__consent__" and second["id"] != first["id"]
    assert not out["isError"] and agents.allowed() is False


def test_allow_without_once_still_turns_outside_agents_on(client, window, outside):
    _, _, out = asked(client, window, outside, {"allowed": True})
    assert not out["isError"] and agents.allowed() is True
    box = {}
    worker = threading.Thread(target=lambda: box.update(out=call(client, outside)))
    worker.start()
    ran(window)
    worker.join(20)
    assert not box["out"]["isError"]


def test_a_question_nobody_answers_is_withdrawn(client, window, outside, monkeypatch):
    monkeypatch.setattr(mcp, "CONSENT_SECONDS", 0.3)
    question, gone, out = asked(client, window, outside, None)
    assert question["params"]["expiresIn"] == 0.3
    assert gone == {"t": "consent-withdrawn", "id": question["id"], "reason": "expired"}
    assert out["isError"] and agents.allowed() is False


def test_a_tab_token_is_not_asked(client, window, outside):
    token = agents.mint("consent-test-tab")
    try:
        box = {}
        worker = threading.Thread(target=lambda: box.update(out=call(client, outside | {agents.INAPP_HEADER: token})))
        worker.start()
        ran(window)
        worker.join(20)
        assert not box["out"]["isError"]
    finally:
        agents.drop("consent-test-tab")


def test_a_waiting_question_is_shown_again_to_the_window_that_comes_back(client, outside, monkeypatch):
    monkeypatch.setattr(commands, "_catalogue", [COMMAND])
    monkeypatch.setattr(mcp, "_declined_until", 0.0)
    client.put("/api/agents/allowed", json={"allowed": False})
    box = {}
    worker = threading.Thread(target=lambda: box.update(out=call(client, outside)))
    with client.websocket_connect(WS + "/api/live") as first:
        first.send_text(json.dumps({"type": "key", "key": window_key.KEY}))
        worker.start()
        question = first.receive_json()
    with client.websocket_connect(WS + "/api/live") as second:
        second.send_text(json.dumps({"type": "key", "key": window_key.KEY}))
        assert second.receive_json() == question
        second.send_json({"t": "result", "id": question["id"], "ok": True, "result": {"allowed": True, "once": True}})
        assert second.receive_json() == {"t": "consent-withdrawn", "id": question["id"], "reason": "answered"}
        ran(second)
        worker.join(20)
    assert not box["out"]["isError"] and agents.allowed() is False


def test_blocked_refuses_outside_agents_and_the_tabs_own_token(client, window, outside):
    assert client.put("/api/agents/allowed", json={"choice": "blocked"}).json()["choice"] == "blocked"
    token = agents.mint("blocked-test-tab")
    try:
        for headers in (outside, outside | {agents.INAPP_HEADER: token}):
            out = call(client, headers)
            assert out["isError"] and out["content"][0]["text"] == mcp.BLOCKED
        assert client.put("/api/agents/allowed", json={"allowed": False}).json()["choice"] == "blocked"
        assert client.put("/api/agents/allowed", json={"allowed": True}).json()["choice"] == "allowed"
    finally:
        agents.drop("blocked-test-tab")
        client.put("/api/agents/allowed", json={"choice": "ask"})
