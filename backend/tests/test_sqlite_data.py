import json
import os
import socket
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.services import pquery, pysand


@pytest.fixture
def orders(tmp_path):
    p = tmp_path / "orders.db"
    con = sqlite3.connect(p)
    con.executescript("create table orders(id integer primary key, customer text, placed text); insert into orders values(1001,'Ada','2026-11-01'),(1002,'Lin','2026-11-02'),(1003,'Sam','2026-11-03');")
    con.commit()
    con.close()
    return str(p)


def _count(path):
    con = sqlite3.connect(path)
    try:
        return con.execute("select count(*) from orders").fetchone()[0]
    finally:
        con.close()


@pytest.mark.parametrize("sql", ["DROP TABLE orders", "select * from orders", "create table x(a)", "PRAGMA journal_mode=delete", "delete from orders; drop table orders"])
def test_sqlite_exec_refuses_anything_but_one_insert_update_or_delete(orders, sql):
    with pytest.raises(pquery.QueryError):
        pquery.sqlite_exec(orders, sql, None)
    assert _count(orders) == 3


def test_sqlite_exec_writes_with_named_params(orders):
    r = pquery.sqlite_exec(orders, "insert into orders(id, customer) values(@id, @c);", {"id": 1004, "c": "Kim"})
    assert r == {"rowcount": 1, "lastrowid": 1004}
    assert pquery.sqlite_exec(orders, "update orders set customer = :c where id = :id", {"id": 1004, "c": "Lee"})["rowcount"] == 1
    assert pquery.sqlite_exec(orders, "delete from orders where id > 1002", None)["rowcount"] == 2
    assert _count(orders) == 2


def test_sqlite_exec_never_creates_a_database(tmp_path):
    p = tmp_path / "none.db"
    with pytest.raises(pquery.QueryError):
        pquery.sqlite_exec(str(p), "delete from orders", None)
    assert not p.exists()


def _book(client, settings=None):
    wid = client.post("/api/workbooks", json={"title": "Orders"}).json()["id"]
    if settings is not None:
        assert client.put(f"/api/workbooks/{wid}/automation", json={"settings": settings}).status_code == 200
    return wid


def test_db_query_reads_and_refuses_writes(client, orders):
    wid = _book(client)
    r = client.post(f"/api/workbooks/{wid}/db/query", json={"path": orders, "sql": "select count(*) as n from orders"})
    assert r.status_code == 200 and r.json() == {"columns": ["n"], "rows": [[3]]}
    assert client.post(f"/api/workbooks/{wid}/db/query", json={"path": orders, "sql": "delete from orders"}).status_code == 422
    assert _count(orders) == 3


def test_db_exec_writes_only_to_a_database_the_workbook_allows(client, orders, tmp_path):
    body = {"path": orders, "sql": "delete from orders where id = @id", "params": {"id": 1003}}
    wid = _book(client)
    r = client.post(f"/api/workbooks/{wid}/db/exec", json=body)
    assert r.status_code == 403 and "data.dbAllowWrite" in r.json()["detail"]
    assert _count(orders) == 3
    other = _book(client, {"dbWrite": [str(tmp_path / "other.db")]})
    assert client.post(f"/api/workbooks/{other}/db/exec", json=body).status_code == 403
    allowed = _book(client, {"dbWrite": [str(tmp_path / ".." / tmp_path.name / "orders.db")]})
    assert client.post(f"/api/workbooks/{allowed}/db/exec", json=body).status_code == 403
    assert client.get(f"/api/workbooks/{allowed}/db/allowed", params={"path": orders}).json() == {"allowed": False}
    assert client.put(f"/api/workbooks/{allowed}/db/allowed", json={"path": orders, "allow": True}).status_code == 200
    assert client.get(f"/api/workbooks/{allowed}/db/allowed", params={"path": orders}).json() == {"allowed": True}
    r = client.post(f"/api/workbooks/{allowed}/db/exec", json=body)
    assert r.status_code == 200 and r.json()["rowcount"] == 1
    assert _count(orders) == 2


needs_posix = pytest.mark.skipif(os.name != "posix", reason="Python cells run on Linux and macOS only")


@needs_posix
def test_python_reads_the_workbook_database(orders):
    db = {"path": orders, "auto": {}}
    assert pysand.run("db.query('select count(*) as n from orders')", [], db=db)["value"] == [[3]]
    assert pysand.run("db.query('select customer from orders where id > @x', x=1001)", [], db=db)["value"] == [["Lin"], ["Sam"]]
    if pysand.pandas_ready():
        assert pysand.run("import pandas as pd\ndb.query('select id from orders where id = @x', x=1001)", [], db=db)["value"] == [["id"], [1001]]
    with pytest.raises(pysand.PyError, match="no database"):
        pysand.run("db.query('select 1')", [], db={"path": "", "auto": {}})


@needs_posix
def test_python_saves_only_from_a_handler_to_an_allowed_database(orders):
    with pytest.raises(pysand.PyError, match="PermissionError: db.execute runs only in a Python handler"):
        pysand.run("db.execute('delete from orders')", [], db={"path": orders, "auto": {"settings": {"dbWrite": [orders]}}})
    with pytest.raises(pysand.PyError, match="PermissionError: Saving to this database is not allowed"):
        pysand.run("db.execute('delete from orders')", [], db={"path": orders, "auto": {}}, handler=True)
    listed = {"path": orders, "auto": {"settings": {"dbWrite": [orders]}}, "wid": "handler-test"}
    with pytest.raises(pysand.PyError, match="PermissionError: Saving to this database is not allowed"):
        pysand.run("db.execute('delete from orders')", [], db=listed, handler=True)
    assert _count(orders) == 3
    pquery.record_allow("handler-test", orders, True)
    out = pysand.run("db.execute('delete from orders where id = @id', id=1003)", [], db=listed, handler=True)
    assert out["value"] == [["rowcount", 1], ["lastrowid", 0]]
    assert _count(orders) == 2


@pytest.fixture
def python_on(client):
    before = client.get("/api/settings/python").json()["enabled"]
    client.put("/api/settings/python", json={"enabled": True})
    yield
    client.put("/api/settings/python", json={"enabled": before})


@needs_posix
def test_a_python_handler_reads_the_database_and_queues_cell_writes(client, orders, python_on):
    handlers = {"count": 'n = db.query("select count(*) as n from orders")[0][0]\nprint("rows", n)\nput("B2", n)', "drop": 'db.execute("delete from orders where id = @id", id=1003)'}
    wid = _book(client, {"pyHandlers": handlers, "dbPath": orders})
    r = client.post(f"/api/workbooks/{wid}/py/run", json={"name": "count", "event": {"type": "button"}})
    assert r.status_code == 200, r.text
    assert r.json()["writes"] == [["B2", 3]] and r.json()["printed"] == ["rows 3"]
    r = client.post(f"/api/workbooks/{wid}/py/run", json={"name": "drop"})
    assert r.status_code == 422 and "PermissionError" in r.json()["detail"]
    assert client.post(f"/api/workbooks/{wid}/py/run", json={"name": "missing"}).status_code == 404
    allowed = _book(client, {"pyHandlers": handlers, "dbPath": orders, "dbWrite": [orders]})
    assert client.post(f"/api/workbooks/{allowed}/py/run", json={"name": "drop"}).status_code == 422
    client.put(f"/api/workbooks/{allowed}/db/allowed", json={"path": orders, "allow": True})
    assert client.post(f"/api/workbooks/{allowed}/py/run", json={"name": "drop"}).status_code == 200
    assert _count(orders) == 2


@needs_posix
def test_a_python_handler_can_change_the_record_it_is_given(client, orders, python_on):
    wid = _book(client, {"pyHandlers": {"stamp": 'record["placed"] = event["today"]\nrecord["customer"] = record["customer"].upper()'}, "dbPath": orders})
    r = client.post(f"/api/workbooks/{wid}/py/run", json={"name": "stamp", "event": {"type": "save", "today": "2026-11-18"}, "record": {"id": None, "customer": "Kim", "placed": None}})
    assert r.status_code == 200, r.text
    assert r.json()["record"] == {"id": None, "customer": "KIM", "placed": "2026-11-18"}


def test_a_python_handler_does_not_run_while_python_is_off(client, orders):
    client.put("/api/settings/python", json={"enabled": False})
    wid = _book(client, {"pyHandlers": {"count": 'put("A1", 1)'}, "dbPath": orders})
    assert client.post(f"/api/workbooks/{wid}/py/run", json={"name": "count"}).status_code == 403


@needs_posix
def test_put_is_refused_in_a_cell_formula():
    with pytest.raises(pysand.PyError, match="PermissionError: put runs only in a Python handler"):
        pysand.run('put("A1", 1)', [])


@pytest.fixture
def formtxt(monkeypatch):
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["content-length"])))
            seen.append((self.path, body))
            name = body.get("template")
            if name == "slow":
                time.sleep(1.0)
            refused = {"missing": (404, "No document missing."), "nobody": (403, "No FormTxt window is open. Start it with ./formtxt and open the app, then retry."), "declined": (403, "The person did not allow outside agents in FormTxt. Ask them to allow it, then retry."), "exists": (409, "/tmp/a.pdf already exists. Send overwrite true to replace it, or choose another name."), "listy": (422, [{"type": "string_type", "loc": ["body", "out"], "msg": "Input should be a valid string", "input": None}]), "broken": (500, "Something broke.")}.get(name)
            ok = refused is None
            out = {"id": "r1", "title": "Invoice", "records": 2, "file": body.get("out", "")} if ok else {"detail": refused[1]}
            self.send_response(200 if ok else refused[0])
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(out).encode())

        def log_message(self, *a):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("FORMTXT_ENGINE_PORT", str(server.server_address[1]))
    yield seen
    server.shutdown()
    server.server_close()


def test_a_report_is_sent_to_formtxt_with_the_workbook_database(client, orders, formtxt):
    wid = _book(client, {"dbPath": orders})
    r = client.post(f"/api/workbooks/{wid}/report", json={"template": "doc1", "sql": "select * from orders", "out": "/tmp/invoice.pdf"})
    assert r.status_code == 200, r.text
    assert r.json() == {"id": "r1", "title": "Invoice", "records": 2, "file": "/tmp/invoice.pdf"}
    assert formtxt == [("/api/reports/run", {"template": "doc1", "data": {"path": orders, "sql": "select * from orders"}, "mode": "list", "format": "pdf", "out": "/tmp/invoice.pdf", "overwrite": False})]
    r = client.post(f"/api/workbooks/{wid}/report", json={"template": "missing", "sql": "select 1"})
    assert r.status_code == 422 and "No document missing." in r.json()["detail"]
    assert client.post(f"/api/workbooks/{_book(client)}/report", json={"template": "doc1", "sql": "select 1"}).status_code == 422


def test_a_report_keeps_formtxts_refusals_apart(client, orders, formtxt):
    wid = _book(client, {"dbPath": orders})
    said = {}
    for name in ("nobody", "declined", "exists", "listy", "broken"):
        r = client.post(f"/api/workbooks/{wid}/report", json={"template": name, "sql": "select 1", "out": "/tmp/a.pdf"})
        said[name] = (r.status_code, r.json()["detail"])
    assert said["nobody"][0] == 403 and "allow outside agents" in said["nobody"][1] and "No FormTxt window is open" in said["nobody"][1]
    assert said["declined"][0] == 403 and "did not allow outside agents" in said["declined"][1]
    assert said["exists"][0] == 409 and "already exists" in said["exists"][1] and "file is in the way" in said["exists"][1]
    assert said["listy"][0] == 422 and said["listy"][1].endswith("out: Input should be a valid string") and "[" not in said["listy"][1]
    assert said["broken"][0] == 502 and "Something broke." in said["broken"][1]


def test_a_report_says_when_formtxt_does_not_answer_in_time(client, orders, formtxt, monkeypatch):
    from app.routers import queries
    monkeypatch.setattr(queries, "REPORT_WAIT", 0.3)
    wid = _book(client, {"dbPath": orders})
    r = client.post(f"/api/workbooks/{wid}/report", json={"template": "slow", "sql": "select 1"})
    assert r.status_code == 504 and r.json()["detail"].startswith("FormTxt did not answer in time.") and "not running" not in r.json()["detail"]


def test_a_report_waits_longer_than_formtxt_does_for_the_person():
    from app.routers import queries
    assert queries.REPORT_WAIT > 180


def test_a_report_without_a_path_sends_no_out(client, orders, formtxt):
    wid = _book(client, {"dbPath": orders})
    for body in ({"template": "doc1", "sql": "select 1"}, {"template": "doc1", "sql": "select 1", "out": None}, {"template": "doc1", "sql": "select 1", "out": "", "overwrite": True}):
        assert client.post(f"/api/workbooks/{wid}/report", json=body).status_code == 200
    assert [sent for _, sent in formtxt] == [{"template": "doc1", "data": {"path": orders, "sql": "select 1"}, "mode": "list", "format": "pdf"}] * 3


def test_a_report_passes_overwrite_with_its_path(client, orders, formtxt):
    wid = _book(client, {"dbPath": orders})
    client.post(f"/api/workbooks/{wid}/report", json={"template": "doc1", "sql": "select 1", "out": "/tmp/a.pdf", "overwrite": True})
    client.post(f"/api/workbooks/{wid}/report", json={"template": "doc1", "sql": "select 1", "out": "/tmp/a.pdf"})
    assert [(sent["out"], sent["overwrite"]) for _, sent in formtxt] == [("/tmp/a.pdf", True), ("/tmp/a.pdf", False)]


def test_a_report_checks_the_template_and_sql_with_formtxts_limits(client, orders, formtxt):
    wid = _book(client, {"dbPath": orders})
    cases = [
        ({"template": "d" * 81, "sql": "select 1"}, "too long: 81 characters, and FormTxt allows 80"),
        ({"template": "  ", "sql": "select 1"}, "Name the FormTxt document"),
        ({"template": "doc1", "sql": "select 1 -- " + "x" * 20_000}, "SQL is too long"),
        ({"template": "doc1", "sql": "  "}, "Give the SQL"),
    ]
    for body, said in cases:
        r = client.post(f"/api/workbooks/{wid}/report", json=body)
        assert r.status_code == 422 and said in r.json()["detail"], r.text
    assert client.post(f"/api/workbooks/{wid}/report", json={"template": "d" * 80, "sql": "select 1"}).status_code == 200
    assert len(formtxt) == 1


def test_a_report_says_when_formtxt_is_not_running(client, orders, monkeypatch):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    monkeypatch.setenv("FORMTXT_ENGINE_PORT", str(port))
    wid = _book(client, {"dbPath": orders})
    r = client.post(f"/api/workbooks/{wid}/report", json={"template": "doc1", "sql": "select 1"})
    assert r.status_code == 503 and r.json()["detail"] == "FormTxt is not running. Open it and try again."


def test_db_exec_refuses_a_relative_path(client, orders):
    wid = _book(client, {"dbWrite": ["orders.db"]})
    r = client.post(f"/api/workbooks/{wid}/db/exec", json={"path": "orders.db", "sql": "delete from orders"})
    assert r.status_code == 403
    assert _count(orders) == 3
