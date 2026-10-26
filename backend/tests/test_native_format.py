import io
import json
import zipfile

KEEP = ("cells", "formats", "merges", "names")


def _book(client):
    wid = client.post("/api/workbooks", json={"title": "Native"}).json()["id"]
    client.post(f"/api/workbooks/{wid}/sheets", json={"name": "Second"})
    r = client.post(f"/api/workbooks/{wid}/cells", json={"sheet": 0, "cells": [[0, 0, "Total"], [0, 1, "40"], [1, 1, "2"], [2, 1, "=B1+B2"], [3, 0, "text with, comma \"quoted\""]]})
    assert r.status_code == 200, r.text
    assert client.post(f"/api/workbooks/{wid}/cells", json={"sheet": 1, "cells": [[0, 0, "=Sheet1!B3*10"]]}).status_code == 200
    assert client.post(f"/api/workbooks/{wid}/formats", json={"sheet": 0, "cells": [[0, 1, "#,##0.00"]]}).status_code == 200
    assert client.put(f"/api/workbooks/{wid}/merges", json={"sheet": 0, "areas": [[5, 0, 5, 2]]}).status_code == 200
    assert client.put(f"/api/workbooks/{wid}/names", json={"name": "Rate", "refers": "=Sheet1!$B$2"}).status_code == 200
    return wid


def _fresh_store():
    from app import config
    from app.services.store import Store

    return Store(config.DATA_DIR)


def test_a_saved_workbook_reads_back_the_same_from_disk(client):
    wid = _book(client)
    before = client.get(f"/api/workbooks/{wid}").json()
    after = json.loads(json.dumps(_fresh_store().get(wid)))
    assert after["sheets"] == before["sheets"] == ["Sheet1", "Second"]
    for key in KEEP:
        assert after[key] == before[key], key
    engine = _fresh_store().book(wid).engine
    assert engine.get("B3", 0) == "42"
    assert engine.get("A1", 1) == "420"


def test_the_fcel_file_is_a_zip_holding_the_workbook(client):
    wid = _book(client)
    r = client.get(f"/api/workbooks/{wid}/export.fcel")
    assert r.status_code == 200
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        assert z.read("mimetype") == b"application/vnd.formcel+zip"
        doc = json.loads(z.read("workbook.json"))
    assert doc["format"] and doc["id"] == wid
    assert [s["name"] for s in doc["sheets"]] == ["Sheet1", "Second"]
    assert [2, 1, "=B1+B2"] in [list(c) for c in doc["sheets"][0]["cells"]]
    assert [3, 0, "text with, comma \"quoted\""] in [list(c) for c in doc["sheets"][0]["cells"]]


def test_saving_leaves_no_temporary_file_behind(client):
    from app import config

    wid = _book(client)
    client.get(f"/api/workbooks/{wid}/export.fcel")
    folder = config.DATA_DIR / "Workbooks"
    assert (folder / f"{wid}.fcel").is_file()
    assert not list(folder.glob("*.tmp"))
