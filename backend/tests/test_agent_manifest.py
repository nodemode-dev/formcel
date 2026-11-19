import json
import subprocess
import sys

from conftest import REPO

MANIFEST = REPO / "agents" / "manifest.json"


def rpc(client, method, params=None, call_id=1):
    body = {"jsonrpc": "2.0", "id": call_id, "method": method, "params": params or {}}
    return client.post("/mcp", json=body).json()["result"]


def test_the_committed_manifest_is_what_the_sync_writes():
    done = subprocess.run([sys.executable, str(REPO / "setup" / "agents.py"), "sync", "--check"], capture_output=True, text=True, cwd=REPO)
    assert done.returncode == 0, done.stderr


def test_the_manifest_names_the_tools_the_running_server_lists(client):
    mcp = json.loads(MANIFEST.read_text(encoding="utf-8"))["mcp"]
    listed = rpc(client, "tools/list")["tools"]
    assert mcp["tools"] == [t["name"] for t in listed]
    assert mcp["read_only"] == [t["name"] for t in listed if (t.get("annotations") or {}).get("readOnlyHint") is True]
    assert mcp["approval_gated"] == [n for n in mcp["tools"] if n not in mcp["read_only"]]


def test_a_tool_the_manifest_calls_read_only_is_not_asked_about_and_a_gated_one_is(client):
    mcp = json.loads(MANIFEST.read_text(encoding="utf-8"))["mcp"]
    asked = rpc(client, "tools/call", {"name": "run_command", "arguments": {"id": "no-such-command"}})
    assert "run_command" in mcp["approval_gated"] and asked["isError"] is True
    assert "outside agents" in asked["content"][0]["text"] or "No FormCel window is open" in asked["content"][0]["text"]
    for name in mcp["read_only"]:
        answer = rpc(client, "tools/call", {"name": name, "arguments": {"id": "no-such-command"}})
        assert "outside agents" not in answer["content"][0]["text"] and "No FormCel window is open" not in answer["content"][0]["text"]
