"""Tests for the M (Power Query) lineage extractor."""

from __future__ import annotations

from model_lenz.models.lineage import SourceLineage
from model_lenz.models.semantic import Expression, Model, Partition, Table
from model_lenz.parsers.m_query import extract_lineage
from model_lenz.parsers.pbip import _propagate_upstream_lineage


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


# --------------------------------------------------------------------------- #
# _propagate_upstream_lineage — cross-query chain resolution
# --------------------------------------------------------------------------- #


def _partition(upstream: list[str]) -> Partition:
    return Partition(
        name="p",
        source_expression="",
        source_lineage=SourceLineage(upstream_expressions=upstream, confidence="low"),
    )


def test_propagate_resolves_cross_query_chain():
    # Chain: partition → mid_query → base_query (has resolved source).
    # The partition has no table of its own but lists `mid_query` upstream.
    # mid_query lists `base_query` upstream. base_query has a resolved BQ table.
    # After propagation, the partition should inherit base_query's identifiers
    # at confidence "medium" (downgraded from base's "high" because it was inherited).
    base_lin = SourceLineage(
        connector="GoogleBigQuery",
        schema="sales",
        table="fact_orders",
        fully_qualified="prod.sales.fact_orders",
        confidence="high",
    )
    mid_lin = SourceLineage(upstream_expressions=["base_query"], confidence="low")
    model = Model(
        expressions=[
            Expression(name="base_query", expression="...", source_lineage=base_lin),
            Expression(name="mid_query", expression="...", source_lineage=mid_lin),
        ],
        tables=[Table(name="FactSales", partitions=[_partition(["mid_query"])])],
    )

    _propagate_upstream_lineage(model)

    lin = model.tables[0].partitions[0].source_lineage
    assert lin is not None
    assert lin.connector == "GoogleBigQuery"
    assert lin.table == "fact_orders"
    assert lin.fully_qualified == "prod.sales.fact_orders"
    assert lin.confidence == "medium"


def test_propagate_cycle_terminates_without_crash():
    # Cycle: a → b → a. Resolver must not infinite-loop or stack-overflow.
    a_lin = SourceLineage(upstream_expressions=["b"], confidence="low")
    b_lin = SourceLineage(upstream_expressions=["a"], confidence="low")
    model = Model(
        expressions=[
            Expression(name="a", expression="...", source_lineage=a_lin),
            Expression(name="b", expression="...", source_lineage=b_lin),
        ],
        tables=[Table(name="T", partitions=[_partition(["a"])])],
    )

    _propagate_upstream_lineage(model)

    lin = model.tables[0].partitions[0].source_lineage
    assert lin is not None
    # Nothing resolved — table stays None, confidence not lifted to "medium".
    assert lin.table is None
    assert lin.confidence == "low"


def test_propagate_preserves_existing_high_confidence():
    # A partition that already resolved (high confidence directly) is not
    # downgraded by the upstream walker — the propagation only fills gaps.
    direct = SourceLineage(
        connector="Sql.Database",
        schema="dbo",
        table="FactSales",
        fully_qualified="[dbo].[FactSales]",
        upstream_expressions=["aux_query"],
        confidence="high",
    )
    aux = SourceLineage(
        connector="GoogleBigQuery", table="something_else", confidence="high"
    )
    model = Model(
        expressions=[Expression(name="aux_query", expression="...", source_lineage=aux)],
        tables=[
            Table(
                name="FactSales",
                partitions=[
                    Partition(name="p", source_expression="", source_lineage=direct)
                ],
            )
        ],
    )

    _propagate_upstream_lineage(model)

    lin = model.tables[0].partitions[0].source_lineage
    assert lin is not None
    # Already resolved — propagation skips it. Confidence + identifiers unchanged.
    assert lin.connector == "Sql.Database"
    assert lin.table == "FactSales"
    assert lin.confidence == "high"
