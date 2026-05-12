"""Tests for the DAX reference extractor."""

from __future__ import annotations

from model_lenz.parsers.dax import extract_refs


def test_simple_column_reference():
    refs = extract_refs("SUM ( Sales[Amount] )")
    assert refs.tables == {"Sales"}
    assert refs.columns == {("Sales", "Amount")}
    assert refs.measures == set()
    assert refs.userel_hints == []


def test_quoted_table_with_spaces():
    refs = extract_refs("SUM ( 'Sales Header'[Amount] )")
    assert refs.tables == {"Sales Header"}
    assert refs.columns == {("Sales Header", "Amount")}


def test_bare_bracket_is_measure_candidate_and_unresolved():
    refs = extract_refs("DIVIDE ( [Total Sales], [Total Cost] )")
    assert refs.measures == {"Total Sales", "Total Cost"}
    assert refs.unresolved_brackets == {"Total Sales", "Total Cost"}
    assert refs.tables == set()


def test_userelationship_emits_hint_and_columns():
    expr = (
        "CALCULATE ( SUM ( Sales[Amount] ), "
        "USERELATIONSHIP ( Sales[ship_date_fk], 'Date'[date_sk] ) )"
    )
    refs = extract_refs(expr)
    assert ("Sales", "ship_date_fk", "Date", "date_sk") in refs.userel_hints
    # Both columns should also appear as plain column references.
    assert ("Sales", "ship_date_fk") in refs.columns
    assert ("Date", "date_sk") in refs.columns
    assert {"Sales", "Date"}.issubset(refs.tables)


def test_filter_picks_up_bare_table_argument():
    expr = "CALCULATE ( SUM ( Sales[Amount] ), FILTER ( 'Customer', 'Customer'[Type] = \"VIP\" ) )"
    refs = extract_refs(expr)
    assert "Customer" in refs.tables
    assert ("Customer", "Type") in refs.columns


def test_iscrossfiltered_table_argument():
    expr = "IF ( ISCROSSFILTERED ( Range ), BLANK (), 1 )"
    refs = extract_refs(expr)
    assert "Range" in refs.tables


def test_comments_are_ignored():
    expr = """
    // a leading comment with [Brackets] and Table[Column]
    /* block /* not nested */
    SUM ( Sales[Amount] )
    """
    refs = extract_refs(expr)
    assert refs.tables == {"Sales"}
    assert refs.columns == {("Sales", "Amount")}
    # Bracketed text inside comments must not have leaked.
    assert refs.measures == set()


def test_string_literal_with_brackets_is_ignored():
    expr = 'CALCULATE ( SUM ( T[c] ), FILTER ( T, T[name] = "[fake]" ) )'
    refs = extract_refs(expr)
    assert refs.columns == {("T", "c"), ("T", "name")}
    assert refs.measures == set()


def test_var_return_does_not_pollute_refs():
    expr = """
    VAR x = SUM ( Sales[Amount] )
    VAR y = COUNTROWS ( Sales )
    RETURN DIVIDE ( x, y )
    """
    refs = extract_refs(expr)
    assert refs.tables == {"Sales"}
    assert refs.columns == {("Sales", "Amount")}
    # `x` and `y` are not measures.
    assert refs.measures == set()
