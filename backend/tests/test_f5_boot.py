from conftest import HEALTH_PATH, VERSION_KEY, VERSION_PATH, _SANDBOX, get_json


def test_engine_boots_on_a_free_port_with_an_empty_data_folder(engine):
    status, body = get_json(engine["base"] + HEALTH_PATH)
    assert status == 200
    assert body["ok"] is True and body["engine"]["loaded"] is True
    assert engine["proc"].poll() is None


def test_engine_reports_the_repository_version(engine, repo_version):
    status, body = get_json(engine["base"] + VERSION_PATH)
    assert status == 200
    assert str(body[VERSION_KEY]).lstrip("v") == repo_version.lstrip("v")
    _, health = get_json(engine["base"] + HEALTH_PATH)
    assert health["engine"]["version"]


def test_engine_keeps_its_workbooks_in_the_data_folder_it_was_given(engine):
    _, health = get_json(engine["base"] + HEALTH_PATH)
    assert health["data_dir"] == str(engine["data"])
    assert {"Exports", "Media", "Templates", "Trash", "Workbooks"} <= {p.name for p in engine["data"].iterdir()}
    assert sorted(p.name for p in (_SANDBOX / "home").iterdir()) == []
