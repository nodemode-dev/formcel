import sqlite3

import pytest

from app.services import pquery


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


def test_db_exec_refuses_a_relative_path(client, orders):
    wid = _book(client, {"dbWrite": ["orders.db"]})
    r = client.post(f"/api/workbooks/{wid}/db/exec", json={"path": "orders.db", "sql": "delete from orders"})
    assert r.status_code == 403
    assert _count(orders) == 3
