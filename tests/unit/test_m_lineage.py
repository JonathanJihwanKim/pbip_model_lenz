"""Tests for the M (Power Query) lineage extractor."""

from __future__ import annotations

from model_lenz.parsers.m_query import extract_lineage


def test_native_query_with_string_concat_extracts_table():
    expr = (
        "let "
        "Source = Value.NativeQuery("
        'GoogleBigQuery.Database([UseStorageApi=false, BillingProject=_BillingProject]){[Name=_BillingProject]}[Data], '
        '"SELECT * FROM `" & _BillingProject & ".report_x.foo_dim` (\'" & _ReportId & "\')", '
        "null, [EnableFolding=true]) "
        "in Source"
    )
    lineage = extract_lineage(expr)
    assert lineage.connector == "GoogleBigQuery"
    assert lineage.table == "foo_dim"
    assert lineage.schema_ == "report_x"
    assert lineage.confidence == "high"


def test_bigquery_navigation_chain():
    expr = """
    let
        Source = GoogleBigQuery.Database([BillingProject=_BillingProject]),
        #"proj" = Source{[Name=_BillingProject]}[Data],
        #"sales_Schema" = #"proj"{[Name="sales", Kind="Schema"]}[Data],
        #"orders_View" = #"sales_Schema"{[Name="orders", Kind="View"]}[Data]
    in
        #"orders_View"
    """
    lineage = extract_lineage(expr)
    assert lineage.connector == "GoogleBigQuery"
    assert lineage.schema_ == "sales"
    assert lineage.table == "orders"
    assert lineage.confidence == "high"


def test_cross_query_reference_detected():
    expr = """
    let
        Source = bu_dim_src,
        Renamed = Table.RenameColumns(Source,{{"a","b"}})
    in
        Renamed
    """
    lineage = extract_lineage(expr, expression_names={"bu_dim_src", "other_query"})
    # Standalone, this expression has no resolvable source — but its upstream chain is known.
    assert lineage.upstream_expressions == ["bu_dim_src"]
    assert lineage.confidence == "medium"
    assert lineage.transformed_steps == ["Source", "Renamed"]


def test_unknown_connector_low_confidence():
    expr = "let Source = #table({\"a\"}, {{1}}) in Source"
    lineage = extract_lineage(expr)
    assert lineage.confidence == "low"
    assert lineage.table is None


def test_m_comments_stripped():
    expr = """
    let
        // Source = OtherQuery,  -- commented out
        /* Sql.Database("hidden", "secret") */
        Source = Value.NativeQuery(GoogleBigQuery.Database([BillingProject="p"]){[Name="p"]}[Data], "SELECT * FROM `p.s.real_table`", null, [])
    in
        Source
    """
    lineage = extract_lineage(expr)
    assert lineage.table == "real_table"
    assert lineage.schema_ == "s"
