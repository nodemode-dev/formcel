import io
import json
import zipfile

from openpyxl import Workbook, load_workbook


def _made_elsewhere():
    wb = Workbook()
    first = wb.active
    first.title = "Summary"
    first["A1"] = "Item"
    first["B1"] = 12.5
    first["B2"] = 7
    first["B3"] = "=SUM(B1:B2)"
    first["B1"].number_format = "#,##0.00"
    first["C1"] = 0.25
    first["C1"].number_format = "0%"
    first.merge_cells("A5:C5")
    first["A5"] = "Merged title"
    second = wb.create_sheet("Data")
    second["A1"] = 3
    second["A2"] = "=Summary!B3*A1"
    wb.create_sheet("Notes")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _import(client, data, name="round.xlsx"):
    r = client.post(f"/api/import?name={name}", content=data)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _export(client, wid):
    r = client.get(f"/api/workbooks/{wid}/export.xlsx")
    assert r.status_code == 200
    return load_workbook(io.BytesIO(r.content))


def test_an_xlsx_round_trip_keeps_values_formulas_formats_merges_and_sheet_order(client):
    back = _export(client, _import(client, _made_elsewhere()))
    assert back.sheetnames == ["Summary", "Data", "Notes"]
    s = back["Summary"]
    assert (s["A1"].value, s["B1"].value, s["B2"].value) == ("Item", 12.5, 7)
    assert s["B3"].value == "=SUM(B1:B2)"
    assert s["B1"].number_format == "#,##0.00"
    assert s["C1"].value == 0.25 and s["C1"].number_format == "0%"
    assert [str(r) for r in s.merged_cells.ranges] == ["A5:C5"]
    assert s["A5"].value == "Merged title"
    assert back["Data"]["A2"].value == "=Summary!B3*A1"


def test_an_imported_workbook_calculates_its_formulas(client):
    from app.services.store import store

    wid = _import(client, _made_elsewhere())
    engine = store().book(wid).engine
    assert engine.get("B3", 0) == "19.5"
    assert engine.get("A2", 1) == "58.5"
    cells = client.get(f"/api/workbooks/{wid}").json()["cells"]
    assert [2, 1, "=SUM(B1:B2)"] in cells[0]


def test_an_exported_file_asks_the_reader_to_recalculate(client):
    wid = _import(client, _made_elsewhere())
    data = client.get(f"/api/workbooks/{wid}/export.xlsx").content
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert 'fullCalcOnLoad="1"' in z.read("xl/workbook.xml").decode()


def test_a_file_that_is_not_a_workbook_is_refused(client):
    r = client.post("/api/import?name=broken.xlsx", content=b"not a zip at all")
    assert r.status_code == 422
    r = client.post("/api/import?name=program.exe", content=b"MZ")
    assert r.status_code == 415
