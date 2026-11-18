import os
import sqlite3

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
    assert _count(orders) == 3
    out = pysand.run("db.execute('delete from orders where id = @id', id=1003)", [], db={"path": orders, "auto": {"settings": {"dbWrite": [orders]}}}, handler=True)
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


def test_db_exec_refuses_a_relative_path(client, orders):
    wid = _book(client, {"dbWrite": ["orders.db"]})
    r = client.post(f"/api/workbooks/{wid}/db/exec", json={"path": "orders.db", "sql": "delete from orders"})
    assert r.status_code == 403
    assert _count(orders) == 3
