"""Tests for source-lineage fields populated by build_measure_graph().

Covers the v0.2 dual-name UI contract: every direct and indirect table node in
the measure-graph payload carries source_label / source_connector /
source_confidence pulled from the highest-confidence partition lineage of the
corresponding semantic-model table.
"""

from __future__ import annotations

from model_lenz.analyzers.measure_graph import build_measure_graph
from model_lenz.analyzers.relationships import RelationshipGraph
from model_lenz.models.lineage import SourceLineage
from model_lenz.models.semantic import (
    Measure,
    Model,
    Partition,
    Relationship,
    Table,
)


def _table(
    name: str,
    classification: str = "other",
    *,
    lineage: SourceLineage | None = None,
    lineages: list[SourceLineage] | None = None,
) -> Table:
    """Build a Table with one or more partitions. `lineages` overrides `lineage`."""
    if lineages is not None:
        partitions = [
            Partition(name=f"p{i}", source_expression="", source_lineage=lin)
            for i, lin in enumerate(lineages)
        ]
    elif lineage is not None:
        partitions = [Partition(name="p0", source_expression="", source_lineage=lineage)]
    else:
        partitions = [Partition(name="p0", source_expression="")]
    return Table(name=name, classification=classification, partitions=partitions)  # type: ignore[arg-type]


def _measure(name: str, table: str, expression: str) -> Measure:
    return Measure(name=name, table=table, expression=expression)


def test_direct_table_meta_carries_source_for_known_connector():
    bq = SourceLineage(
        connector="GoogleBigQuery",
        schema="sales",
        table="fact_orders",
        fully_qualified="prod.sales.fact_orders",
        confidence="high",
    )
    model = Model(
        tables=[
            _table("FactSales", classification="fact", lineage=bq),
            _table("DimDate", classification="time"),
        ],
        relationships=[],
    )
    m = _measure("Total Sales", "FactSales", "SUM ( FactSales[Amount] )")
    g = build_measure_graph(m, model=model, rel_graph=RelationshipGraph.from_relationships([]))

    assert g.direct_tables == ["FactSales"]
    assert len(g.direct_table_meta) == 1
    meta = g.direct_table_meta[0]
    assert meta.label == "FactSales"
    assert meta.source_label == "prod.sales.fact_orders"
    assert meta.source_connector == "GoogleBigQuery"
    assert meta.source_confidence == "high"
    assert meta.classification == "fact"


def test_direct_table_meta_returns_none_source_when_no_lineage():
    model = Model(
        tables=[_table("Parameters", classification="parameter")],
        relationships=[],
    )
    m = _measure("Pick", "Parameters", "SELECTEDVALUE ( Parameters[Pick] )")
    g = build_measure_graph(m, model=model, rel_graph=RelationshipGraph.from_relationships([]))

    assert len(g.direct_table_meta) == 1
    meta = g.direct_table_meta[0]
    assert meta.source_label is None
    assert meta.source_connector is None
    assert meta.source_confidence is None
    assert meta.classification == "parameter"


def test_indirect_table_carries_source_identifiers():
    bq = SourceLineage(
        connector="GoogleBigQuery",
        schema="dims",
        table="dim_date",
        fully_qualified="prod.dims.dim_date",
        confidence="high",
    )
    rels = [
        Relationship(
            id="r1",
            from_table="FactSales",
            from_column="date_fk",
            to_table="DimDate",
            to_column="date_sk",
            cardinality="many_to_one",
            crossfilter="single",
            is_active=True,
        )
    ]
    model = Model(
        tables=[
            _table("FactSales", classification="fact"),
            _table("DimDate", classification="time", lineage=bq),
        ],
        relationships=rels,
    )
    m = _measure("Total Sales", "FactSales", "SUM ( FactSales[Amount] )")
    g = build_measure_graph(
        m, model=model, rel_graph=RelationshipGraph.from_relationships(rels)
    )

    indirect = {it.table: it for it in g.indirect_tables}
    assert "DimDate" in indirect
    assert indirect["DimDate"].source_label == "prod.dims.dim_date"
    assert indirect["DimDate"].source_connector == "GoogleBigQuery"
    assert indirect["DimDate"].source_confidence == "high"


def test_multi_partition_picks_highest_confidence_lineage():
    # Realistic incremental-refresh shape: one archival partition has resolved
    # lineage at "high", a second placeholder partition shows "low" with no
    # table. The picker must surface the high-confidence one.
    placeholder = SourceLineage(connector=None, confidence="low")
    resolved = SourceLineage(
        connector="Sql.Database",
        schema="dbo",
        table="FactSales",
        fully_qualified="[dbo].[FactSales]",
        confidence="high",
    )
    model = Model(
        tables=[_table("FactSales", classification="fact", lineages=[placeholder, resolved])],
        relationships=[],
    )
    m = _measure("Total", "FactSales", "SUM ( FactSales[Amount] )")
    g = build_measure_graph(m, model=model, rel_graph=RelationshipGraph.from_relationships([]))

    meta = g.direct_table_meta[0]
    assert meta.source_confidence == "high"
    assert meta.source_label == "[dbo].[FactSales]"


def test_falls_back_to_table_when_fully_qualified_missing():
    # connector recognized + table extracted but no FQN — picker should still
    # return the bare table name.
    partial = SourceLineage(connector="Snowflake", table="raw_events", confidence="medium")
    model = Model(
        tables=[_table("Events", classification="fact", lineage=partial)],
        relationships=[],
    )
    m = _measure("Cnt", "Events", "COUNTROWS ( Events )")
    g = build_measure_graph(m, model=model, rel_graph=RelationshipGraph.from_relationships([]))

    meta = g.direct_table_meta[0]
    assert meta.source_label == "raw_events"
    assert meta.source_connector == "Snowflake"
    assert meta.source_confidence == "medium"
