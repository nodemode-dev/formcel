import pytest

import formcel_engine

CURATED = [
    ("=SUM(1,2,3)", "6"),
    ("=AVERAGE(2,4)", "3"),
    ("=ROUND(2.5,0)", "3"),
    ("=ROUND(-2.5,0)", "-3"),
    ("=0.1+0.2", "0.3"),
    ("=MOD(-3,2)", "1"),
    ("=\"a\"&1", "a1"),
    ("=TRUE+1", "2"),
    ("=SUMPRODUCT({1,2},{3,4})", "11"),
    ("=DATEVALUE(\"2026-10-26\")", "46321"),
    ("=DATE(1900,3,1)-DATE(1900,2,28)", "2"),
    ("=WEEKDAY(DATE(2026,10,26))", "2"),
    ("=TEXT(DATE(2024,2,29),\"yyyy-mm-dd\")", "2024-02-29"),
    ("=TEXT(DATE(2024,2,29)+1,\"yyyy-mm-dd\")", "2024-03-01"),
    ("=TEXT(EDATE(DATE(2024,1,31),1),\"yyyy-mm-dd\")", "2024-02-29"),
    ("=DATEDIF(DATE(2020,1,1),DATE(2024,6,1),\"m\")", "53"),
    ("=1/0", "#DIV/0!"),
    ("=1/0+NA()", "#DIV/0!"),
    ("=NA()", "#N/A"),
    ("=IFERROR(1/0,\"caught\")", "caught"),
    ("=ISERROR(1/0)", "TRUE"),
    ("=INDIRECT(\"ZZ\")", "#NAME?"),
    ("=UNKNOWNFUNCTION(1)", "#NAME?"),
]


@pytest.fixture
def book():
    return formcel_engine.Workbook()


@pytest.mark.parametrize("formula,expected", CURATED)
def test_a_curated_formula_gives_its_known_answer(book, formula, expected):
    book.set("A1", formula, 0)
    assert book.get("A1", 0) == expected


def test_an_error_travels_through_every_dependent_cell(book):
    book.set("A1", "10", 0)
    book.set("A2", "0", 0)
    book.set("A3", "=A1/A2", 0)
    book.set("A4", "=A3+1", 0)
    book.set("A5", "=SUM(A3:A4)", 0)
    assert [book.get(c, 0) for c in ("A3", "A4", "A5")] == ["#DIV/0!"] * 3
    book.set("A2", "4", 0)
    assert [book.get(c, 0) for c in ("A3", "A4", "A5")] == ["2.5", "3.5", "6"]


def test_a_reference_to_a_deleted_place_is_ref(book):
    book.set("A1", "=#REF!+1", 0)
    assert book.get("A1", 0) == "#REF!"


def test_a_circular_reference_is_caught_and_not_computed_forever(book):
    book.set("B1", "=B2+1", 0)
    book.set("B2", "=B1+1", 0)
    assert book.get("B1", 0).startswith("#")
    assert book.get("B2", 0).startswith("#")
    book.set("B2", "5", 0)
    assert book.get("B1", 0) == "6"


def test_a_self_reference_is_caught(book):
    book.set("C1", "=C1*2", 0)
    assert book.get("C1", 0).startswith("#")


def test_an_array_spills_into_the_cells_below(book):
    book.set("D1", "=SEQUENCE(3)", 0)
    assert [book.get(c, 0) for c in ("D1", "D2", "D3", "D4")] == ["1", "2", "3", ""]


def test_a_blocked_spill_is_an_error_and_clears_when_unblocked(book):
    book.set("E2", "in the way", 0)
    book.set("E1", "=SEQUENCE(3)", 0)
    assert book.get("E1", 0) == "#SPILL!"
    book.set("E2", "", 0)
    assert [book.get(c, 0) for c in ("E1", "E2", "E3")] == ["1", "2", "3"]


def test_a_long_dependency_chain_recalculates_in_order(book):
    book.set("F1", "1", 0)
    for r in range(2, 201):
        book.set(f"F{r}", f"=F{r - 1}+1", 0)
    assert book.get("F200", 0) == "200"
    book.set("F1", "1000", 0)
    assert book.get("F200", 0) == "1199"
    assert book.get("F100", 0) == "1099"


def test_a_cell_read_before_its_inputs_change_is_recalculated(book):
    book.set("G3", "=G1*G2", 0)
    book.set("G1", "6", 0)
    book.set("G2", "7", 0)
    assert book.get("G3", 0) == "42"


def test_lookups_find_exact_matches_and_say_when_there_is_none(book):
    for r, (k, v) in enumerate([("apple", "1"), ("pear", "2"), ("plum", "3")], start=1):
        book.set(f"H{r}", k, 0)
        book.set(f"I{r}", v, 0)
    book.set("J1", "=VLOOKUP(\"pear\",H1:I3,2,FALSE)", 0)
    book.set("J2", "=XLOOKUP(\"plum\",H1:H3,I1:I3)", 0)
    book.set("J3", "=VLOOKUP(\"kiwi\",H1:I3,2,FALSE)", 0)
    book.set("J4", "=MATCH(\"plum\",H1:H3,0)", 0)
    assert [book.get(c, 0) for c in ("J1", "J2", "J3", "J4")] == ["2", "3", "#N/A", "3"]


def test_formulas_across_sheets_follow_their_inputs(book):
    other = book.add_sheet("Data")
    book.set("A1", "21", other)
    book.set("A1", "=Data!A1*2", 0)
    assert book.get("A1", 0) == "42"
    book.set("A1", "50", other)
    assert book.get("A1", 0) == "100"


def test_a_formula_that_does_not_parse_says_so(book):
    book.set("K1", "=1+", 0)
    assert book.get("K1", 0).startswith("#")
