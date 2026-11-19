import json
import os
import stat
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import window_key
from app.services import agent_programs, agents, claude_code, terminal


def stand_in(folder, name):
    path = folder / name
    path.write_text(f"#!/bin/sh\necho stand-in {name}\nexec sleep 30\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


@pytest.fixture(autouse=True)
def no_claude_run(monkeypatch):
    monkeypatch.setattr(claude_code, "info", lambda fresh=False: {"installed": False})


@pytest.fixture()
def plain_path(monkeypatch):
    monkeypatch.setenv("PATH", "/usr/bin:/bin")


@pytest.fixture()
def programs(tmp_path, monkeypatch):
    stand_in(tmp_path, "codex")
    stand_in(tmp_path, "cursor-agent")
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}/usr/bin:/bin")
    return tmp_path


@pytest.mark.skipif(os.name == "nt", reason="stand-ins are shell scripts")
def test_the_status_says_what_is_installed(plain_path, client):
    agents_now = client.get("/api/claude-code/status").json()["agents"]
    assert {k: v["installed"] for k, v in agents_now.items()} == {"codex": False, "cursor": False}
    assert agents_now["codex"]["install"] and agents_now["cursor"]["install"]


@pytest.mark.skipif(os.name == "nt", reason="stand-ins are shell scripts")
def test_the_status_finds_the_stand_ins(programs, client):
    agents_now = client.get("/api/claude-code/status").json()["agents"]
    assert agents_now["codex"]["path"] == str(programs / "codex")
    assert agents_now["cursor"]["path"] == str(programs / "cursor-agent")
    assert agents_now["codex"]["install"] == ""


@pytest.mark.skipif(os.name == "nt", reason="stand-ins are shell scripts")
def test_a_program_tab_has_its_token_in_its_environment_only(programs, client):
    info = client.post("/api/terminal/agent", json={"kind": "codex", "cols": 80, "rows": 20}).json()
    assert info["kind"] == "codex" and info["title"] == "Codex"
    session = terminal.get(info["id"])
    token = session.env[agents.INAPP_VAR]
    assert agents.is_inapp(token)
    assert session.env[agent_programs.MCP_URL_VAR].endswith("/mcp")
    assert not any(token in part for part in session.argv)
    assert client.post(f"/api/terminal/{info['id']}/restart").status_code == 200
    assert client.delete(f"/api/terminal/{info['id']}").status_code == 200
    assert not agents.is_inapp(token)


def test_a_missing_program_and_an_unknown_kind_are_refused(plain_path, client):
    assert client.post("/api/terminal/agent", json={"kind": "cursor"}).status_code == 404
    assert client.post("/api/terminal/agent", json={"kind": "vim"}).status_code == 422


def test_the_program_route_needs_the_window_key(app):
    with TestClient(app, base_url="http://127.0.0.1:8199") as bare:
        r = bare.post("/api/terminal/agent", json={"kind": "codex"})
    assert r.status_code == 403 and r.json()["detail"] == window_key.REFUSED


def talking(folder, name, version, said):
    path = folder / name
    path.write_text(f'#!/bin/sh\ncase "$1" in\n  --version) echo "{version}"; exit 0;;\n  login|status) echo "{said}"; exit 0;;\nesac\nexec sleep 30\n')
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


@pytest.fixture()
def talkers(tmp_path, monkeypatch):
    talking(tmp_path, "codex", "codex-cli 0.99.0", "Logged in using ChatGPT")
    talking(tmp_path, "cursor-agent", "2026.11.01-abc123", "Not logged in")
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}/usr/bin:/bin")
    for name in ("OPENAI_API_KEY", "CODEX_API_KEY", "CURSOR_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


@pytest.mark.skipif(os.name == "nt", reason="stand-ins are shell scripts")
def test_one_call_reports_every_agent_program(talkers, client):
    now = client.get("/api/agents/status?fresh=true").json()
    assert set(now) == {"claude", "codex", "cursor"}
    assert (now["codex"]["installed"], now["codex"]["version"], now["codex"]["signedIn"]) == (True, "0.99.0", True)
    assert (now["cursor"]["installed"], now["cursor"]["version"], now["cursor"]["signedIn"]) == (True, "2026.11.01-abc123", False)
    assert now["codex"]["install"] == agent_programs.PROGRAMS["codex"]["install"]
    assert client.get("/api/agents/status", headers={"origin": "http://elsewhere.example"}).status_code == 403


@pytest.mark.skipif(os.name == "nt", reason="stand-ins are shell scripts")
def test_missing_programs_report_their_install_line(plain_path, client):
    now = client.get("/api/agents/status?fresh=true").json()
    assert [(now[k]["installed"], now[k]["version"], now[k]["signedIn"]) for k in ("codex", "cursor")] == [(False, None, None)] * 2
    assert all(now[k]["install"] == agent_programs.PROGRAMS[k]["install"] for k in ("codex", "cursor"))
    assert now["claude"]["installed"] is False


@pytest.mark.skipif(os.name == "nt", reason="stand-ins are shell scripts")
def test_a_codex_tab_is_pointed_at_the_engine_by_variable_name(programs, client):
    info = client.post("/api/terminal/agent", json={"kind": "codex"}).json()
    session = terminal.get(info["id"])
    try:
        line = session.argv[-1]
        assert f"mcp_servers.{agent_programs.TAB_SERVER}.url=" in line and agents.INAPP_VAR in line
        assert session.env[agents.INAPP_VAR] not in line
    finally:
        client.delete(f"/api/terminal/{info['id']}")


@pytest.mark.skipif(os.name == "nt", reason="stand-ins are shell scripts")
def test_a_cursor_tab_gets_a_private_config_with_a_placeholder(programs, client):
    info = client.post("/api/terminal/agent", json={"kind": "cursor"}).json()
    session = terminal.get(info["id"])
    try:
        path = Path(info["cwd"]) / ".cursor" / "mcp.json"
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        entry = json.loads(path.read_text(encoding="utf-8"))["mcpServers"][agent_programs.TAB_SERVER]
        assert entry["url"].endswith("/mcp") and entry["headers"] == {agents.INAPP_HEADER: "${env:" + agents.INAPP_VAR + "}"}
        assert session.env[agents.INAPP_VAR] not in path.read_text(encoding="utf-8")
    finally:
        client.delete(f"/api/terminal/{info['id']}")


@pytest.mark.skipif(os.name == "nt", reason="file modes")
def test_the_cursor_config_keeps_what_is_already_there(tmp_path):
    folder = tmp_path / ".cursor"
    folder.mkdir()
    (folder / "mcp.json").write_text('{"mcpServers": {"mine": {"command": "x"}}, "other": 1}', encoding="utf-8")
    agent_programs.cursor_config(str(tmp_path), 4321)
    held = json.loads((folder / "mcp.json").read_text(encoding="utf-8"))
    assert held["other"] == 1 and set(held["mcpServers"]) == {"mine", agent_programs.TAB_SERVER}
    (folder / "mcp.json").write_text("not json", encoding="utf-8")
    agent_programs.cursor_config(str(tmp_path), 4321)
    assert (folder / "mcp.json").read_text(encoding="utf-8") == "not json"


def test_chat_and_a_claude_code_tab_use_the_tab_entry():
    assert set(json.loads(claude_code.inapp_mcp_config(4321))["mcpServers"]) == {agent_programs.TAB_SERVER}
    assert any("mcp__" + agent_programs.TAB_SERVER in part for part in claude_code.terminal_argv("claude", 4321, None, None))
