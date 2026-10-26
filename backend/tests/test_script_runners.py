import subprocess
import time

import pytest

from app.services import gasrun, jsfn, vbarun

CELL = """function fill() { SpreadsheetApp.getActiveSheet().getRange("A1").setValue(41 + 1); }
function forever() { while (true) {} }
"""


def _book(client):
    return client.post("/api/workbooks", json={"title": "Scripts"}).json()["id"]


def _scripts(client, wid, code):
    r = client.put(f"/api/workbooks/{wid}/automation", json={"scripts": [{"id": "s1", "name": "Code.gs", "code": code, "gas": True}]})
    assert r.status_code == 200, r.text


@pytest.fixture
def launches(monkeypatch):
    seen = []
    real_popen, real_run = subprocess.Popen, subprocess.run

    def popen(args, *a, **k):
        seen.append(list(args))
        return real_popen(args, *a, **k)

    def run(args, *a, **k):
        seen.append(list(args))
        return real_run(args, *a, **k)

    monkeypatch.setattr(subprocess, "Popen", popen)
    monkeypatch.setattr(subprocess, "run", run)
    return seen


def _runner_calls(seen, marker):
    return [a for a in seen if any(marker in str(x) for x in a)]


def test_an_apps_script_runs_and_changes_the_sheet(client):
    from app.services.store import store

    wid = _book(client)
    _scripts(client, wid, CELL)
    r = client.post(f"/api/workbooks/{wid}/server-scripts/run", json={"fn": "fill"})
    assert r.status_code == 200 and r.json()["ok"], r.text
    assert store().book(wid).engine.get("A1", 0) == "42"


def test_the_apps_script_runner_starts_under_the_permission_model(client, launches):
    wid = _book(client)
    _scripts(client, wid, CELL)
    client.post(f"/api/workbooks/{wid}/server-scripts/run", json={"fn": "fill"})
    calls = _runner_calls(launches, "gas_runner.js")
    assert calls
    args = calls[-1]
    flag = gasrun._PERMISSION[args[0]]
    assert flag in ("--permission", "--experimental-permission") and flag in args
    assert [a for a in args if a.startswith("--allow-fs-read=")] == [f"--allow-fs-read={gasrun.RUNNER}"]
    assert not [a for a in args if a.startswith(("--allow-fs-write", "--allow-child-process", "--allow-worker", "--allow-addons"))]


def test_an_endless_apps_script_is_stopped_at_its_limit(client, monkeypatch):
    monkeypatch.setattr(gasrun, "LIMIT", 2)
    wid = _book(client)
    _scripts(client, wid, CELL)
    started = time.monotonic()
    r = client.post(f"/api/workbooks/{wid}/server-scripts/run", json={"fn": "forever"})
    took = time.monotonic() - started
    assert r.status_code == 200
    assert not r.json()["ok"]
    assert took < 15


def test_a_node_without_the_permission_model_runs_no_script(client, monkeypatch):
    import shutil

    exe = shutil.which("node")
    monkeypatch.setitem(gasrun._PERMISSION, exe, None)
    wid = _book(client)
    _scripts(client, wid, CELL)
    r = client.post(f"/api/workbooks/{wid}/server-scripts/run", json={"fn": "fill"})
    assert r.status_code == 422 and "Node.js 22 or later" in r.json()["detail"]
    with pytest.raises(jsfn.JsUnavailable):
        jsfn.call("function ADD(a, b) { return a + b; }", "ADD", [1, 2])


def test_a_cell_function_returns_its_value_under_the_permission_model(launches):
    assert jsfn.call("function ADD(a, b) { return a + b; }", "ADD", [2, 3]) == 5
    calls = [a for a in launches if "-e" in a]
    assert calls and any(a in ("--permission", "--experimental-permission") for a in calls[-1])
    assert not [a for a in calls[-1] if str(a).startswith("--allow-")]


def test_an_endless_cell_function_is_stopped():
    started = time.monotonic()
    with pytest.raises(jsfn.JsError):
        jsfn.call("function SPIN() { while (true) {} }", "SPIN", [])
    assert time.monotonic() - started < 15


def test_a_vba_macro_runs_under_the_permission_model(client, launches):
    from app.services.store import store

    wid = _book(client)
    code = "Sub Fill()\n    Range(\"B2\").Value = 6 * 7\nEnd Sub"
    r = client.post(f"/api/workbooks/{wid}/vba/run", json={"proc": "Fill", "modules": [{"name": "Module1", "kind": "std", "code": code}]})
    assert r.status_code == 200 and r.json()["ok"], r.text
    assert store().book(wid).engine.get("B2", 0) == "42"
    args = _runner_calls(launches, "vba_runner.mjs")[-1]
    assert any(a in ("--permission", "--experimental-permission") for a in args)
    assert [a for a in args if a.startswith("--allow-fs-read=")] == [f"--allow-fs-read={vbarun.RUNNER}"]


def test_vba_has_no_way_to_the_system(client):
    wid = _book(client)
    for line in ('Shell "true"', 'Kill "x"', 'Dim o: Set o = CreateObject("Scripting.FileSystemObject")'):
        code = "Sub Probe()\n    " + line + "\nEnd Sub"
        r = client.post(f"/api/workbooks/{wid}/vba/run", json={"proc": "Probe", "modules": [{"name": "Module1", "kind": "std", "code": code}]})
        assert r.status_code == 200 and not r.json()["ok"], line


def test_an_endless_vba_macro_is_stopped_at_its_limit(client, monkeypatch):
    monkeypatch.setattr(vbarun, "LIMIT", 2)
    wid = _book(client)
    code = "Sub Spin()\n    Do\n    Loop\nEnd Sub"
    started = time.monotonic()
    r = client.post(f"/api/workbooks/{wid}/vba/run", json={"proc": "Spin", "modules": [{"name": "Module1", "kind": "std", "code": code}]})
    assert r.status_code == 200 and not r.json()["ok"]
    assert time.monotonic() - started < 15


def test_the_runners_clear_network_reach_before_any_script_code():
    source = gasrun.RUNNER.read_text()
    cleared = source.index('process.getBuiltinModule = undefined;')
    assert source.index('process.mainModule = undefined;') < source.index("new vm.Script(")
    assert cleared < source.index("new vm.Script(")
    assert source.index('"fetch"') < source.index("new vm.Script(")
    assert 'process.kill = undefined;' in source
    inline = jsfn.RUNNER
    assert inline.index("process.mainModule = undefined;") < inline.index("new vm.Script(")
    assert '"require"' in inline and "process.kill = undefined;" in inline
