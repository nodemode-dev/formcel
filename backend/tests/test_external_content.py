import time

from app.services import gastriggers, trust, webdata


def _book(client):
    return client.post("/api/workbooks", json={}).json()["id"]


def _resolve(client, wid, keys):
    return client.post("/api/host/resolve", json={"keys": keys, "workbook": wid, "fresh": True}).json()


def test_a_workbook_reads_files_only_after_the_person_allows_it(client, tmp_path):
    data = tmp_path / "numbers.csv"
    data.write_text("a,b\n1,2\n", encoding="utf-8")
    key = f"EXTERNALREF\x1ft:{data}\x1ft:A1:B2"
    wid = _book(client)
    out = _resolve(client, wid, [key])
    assert out["results"][key]["data"] == "e:#N/A" and out["ask"] == "external"
    assert client.get(f"/api/workbooks/{wid}/trust").json()["asked"] is True
    assert client.put(f"/api/workbooks/{wid}/trust", json={"external": True}).json()["external"] is True
    out = _resolve(client, wid, [key])
    assert out["results"][key]["data"].startswith("t:a") and out["ask"] == ""
    other = _book(client)
    client.put(f"/api/workbooks/{other}/trust", json={"external": False})
    out = _resolve(client, other, [key])
    assert out["results"][key]["data"] == "e:#N/A" and out["ask"] == ""


def test_web_functions_refuse_this_computer_and_private_networks(client):
    wid = _book(client)
    client.put(f"/api/workbooks/{wid}/trust", json={"external": True})
    for url in ("http://127.0.0.1:8199/api/health", "http://localhost/", "http://169.254.169.254/latest", "http://10.0.0.1/", "http://[::1]/"):
        key = f"WEBSERVICE\x1ft:{url}"
        out = _resolve(client, wid, [key])["results"][key]
        assert out["data"] == "e:#VALUE!" and "private network" in out["note"], url
    try:
        webdata.fetch("http://192.168.1.1/")
    except webdata.FetchError as e:
        assert "private network" in str(e)
    else:
        raise AssertionError("a private address was fetched")


def test_script_triggers_wait_for_trust(client, monkeypatch):
    wid = _book(client)
    ran = []
    monkeypatch.setattr(gastriggers, "matching", lambda auto, kind: [("onEdit", None)])
    monkeypatch.setattr(gastriggers, "execute", lambda *a, **k: ran.append(a))
    monkeypatch.setattr(gastriggers.gasrun, "available", lambda: True)
    gastriggers.spawn(wid, "edit", {})
    time.sleep(0.3)
    assert ran == []
    trust.put(wid, {"scripts": True})
    gastriggers.spawn(wid, "edit", {})
    time.sleep(0.3)
    assert len(ran) == 1
