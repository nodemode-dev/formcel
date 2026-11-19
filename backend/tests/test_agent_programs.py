import os
import stat

import pytest
from fastapi.testclient import TestClient

from app import window_key
from app.services import agent_programs, agents, terminal


def stand_in(folder, name):
    path = folder / name
    path.write_text(f"#!/bin/sh\necho stand-in {name}\nexec sleep 30\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


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
