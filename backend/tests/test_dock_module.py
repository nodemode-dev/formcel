import importlib.util
import json
import re
import shutil
import subprocess

import pytest

from conftest import REPO

DOCK = REPO / "frontend" / "src" / "dock"
ADAPTER = REPO / "frontend" / "src" / "dock-adapter.ts"


def agents_module():
    spec = importlib.util.spec_from_file_location("formcel_agents_sync", REPO / "setup" / "agents.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_dock_files_match_their_manifest():
    problems = []
    agents_module().check_dock(problems)
    assert problems == []


def test_an_edited_dock_file_is_named(tmp_path, monkeypatch):
    sync = agents_module()
    copy = tmp_path / "dock"
    shutil.copytree(DOCK, copy)
    (copy / "dock.css").write_text((copy / "dock.css").read_text(encoding="utf-8") + "\n", encoding="utf-8")
    monkeypatch.setattr(sync, "DOCK_DIR", str(copy))
    monkeypatch.setattr(sync, "DOCK_MANIFEST", str(copy / "MANIFEST.json"))
    problems = []
    sync.check_dock(problems)
    assert len(problems) == 1 and problems[0].startswith("frontend/src/dock/dock.css ")


LOOKUP = "backend/app/services/agent_lookup.py"


def lookup_problems(sync):
    problems = []
    sync.check_lookup(problems)
    return problems


def test_the_agent_finder_matches_its_recorded_hash():
    assert lookup_problems(agents_module()) == []


def test_an_edited_agent_finder_is_named(tmp_path, monkeypatch):
    sync = agents_module()
    copy = tmp_path / "agent_lookup.py"
    copy.write_bytes((REPO / LOOKUP).read_bytes() + b"\n")
    monkeypatch.setattr(sync, "LOOKUP", str(copy))
    assert lookup_problems(sync) == [f"{LOOKUP}: does not match the hash recorded for version 1.0.0 (the shared finder changes only as a whole new version)"]


def test_a_missing_agent_finder_is_named(tmp_path, monkeypatch):
    sync = agents_module()
    monkeypatch.setattr(sync, "LOOKUP", str(tmp_path / "agent_lookup.py"))
    assert lookup_problems(sync) == [f"{LOOKUP}: missing (the shared finder for the agent programs)"]


def test_the_dock_folder_imports_only_itself_and_xterm():
    found = set()
    for path in DOCK.glob("*.ts"):
        found |= set(re.findall(r"(?:from|import) '([^']+)'", path.read_text(encoding="utf-8")))
    assert {name for name in found if not name.startswith("./") and not name.startswith("@xterm/")} == set()


def test_the_manifest_dock_block_says_bottom_and_right():
    dock = json.loads((REPO / "agents" / "manifest.json").read_text(encoding="utf-8"))["dock"]
    assert dock["positions"] == ["bottom", "right"]
    assert dock["tabs"] == ["chat", "shell", "claude", "codex", "cursor", "agent"]
    assert "'formcel.dock'" in ADAPTER.read_text(encoding="utf-8") and "legacy: jsonLegacy(['formcel.terminal'], true)" in ADAPTER.read_text(encoding="utf-8")


MOVE = """
import { moveLegacy, readState } from '%s';
const m = new Map([['formcel.terminal', JSON.stringify({ open: true, h: 333 })]]);
const store = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
const first = moveLegacy(store, 'formcel.dock', ['formcel.terminal'], { h: 280, w: 440 });
const again = moveLegacy(store, 'formcel.dock', ['formcel.terminal'], { h: 280, w: 440 });
store.setItem('formcel.dock', JSON.stringify({ ...readState(store, 'formcel.dock', [], { h: 280, w: 440 }), side: 'right', w: 500 }));
console.log(JSON.stringify({ first, again, keys: [...m.keys()], state: readState(store, 'formcel.dock', ['formcel.terminal'], { h: 280, w: 440 }) }));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_old_storage_key_is_moved_once(tmp_path):
    script = tmp_path / "move.mjs"
    script.write_text(MOVE % (DOCK / "state.ts").as_posix(), encoding="utf-8")
    done = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", str(script)], capture_output=True, text=True)
    if done.returncode != 0 and "strip-types" in done.stderr:
        pytest.skip("this node cannot strip types")
    out = json.loads(done.stdout)
    assert out["first"] is True and out["again"] is False and out["keys"] == ["formcel.dock"]
    assert out["state"] == {"open": True, "side": "right", "h": 333, "w": 500, "tab": ""}
