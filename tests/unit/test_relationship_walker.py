"""Tests for the relationship graph + indirect-dependency walker."""

from __future__ import annotations

from model_lenz.analyzers.relationships import RelationshipGraph
from model_lenz.models.semantic import Relationship


def _r(
    rid: str,
    f_table: str,
    f_col: str,
    t_table: str,
    t_col: str,
    *,
    cardinality: str = "many_to_one",
    crossfilter: str = "single",
    is_active: bool = True,
) -> Relationship:
    return Relationship(
        id=rid,
        from_table=f_table,
        from_column=f_col,
        to_table=t_table,
        to_column=t_col,
        cardinality=cardinality,
        crossfilter=crossfilter,
        is_active=is_active,
    )


def test_walk_from_fact_finds_dimensions_at_depth_1():
    rels = [
        _r("r1", "Sales", "date_fk", "Date", "date_sk"),
        _r("r2", "Sales", "cust_fk", "Customer", "cust_sk"),
    ]
    rg = RelationshipGraph.from_relationships(rels)
    result = rg.walk({"Sales"}, max_depth=2)
    tables = {it.table for it in result}
    assert tables == {"Date", "Customer"}
    for it in result:
        assert it.depth == 1
        assert it.via == "Sales"


def test_walk_from_dim_does_not_cross_to_other_facts_without_bidi():
    # Sales —— Date —— Returns ; default single-direction filter.
    rels = [
        _r("r1", "Sales", "date_fk", "Date", "date_sk"),
        _r("r2", "Returns", "date_fk", "Date", "date_sk"),
    ]
    rg = RelationshipGraph.from_relationships(rels)
    # Walk from Date (one-side). With single-direction filtering, Date does
    # NOT propagate filters back to Sales/Returns, so the indirect set should
    # be empty.
    result = rg.walk({"Date"}, max_depth=2)
    assert result == []


def test_bidi_relationship_lets_us_walk_back_to_many_side():
    rels = [
        _r("r1", "Sales", "date_fk", "Date", "date_sk", crossfilter="both"),
    ]
    rg = RelationshipGraph.from_relationships(rels)
    result = rg.walk({"Date"}, max_depth=2)
    assert {it.table for it in result} == {"Sales"}


def test_inactive_relationship_skipped_unless_userel_hint():
    rels = [
        _r("r_active", "Sales", "order_date_fk", "Date", "date_sk"),
        _r("r_inactive", "Sales", "ship_date_fk", "Date", "date_sk", is_active=False),
    ]
    rg = RelationshipGraph.from_relationships(rels)

    # Default walk: Date reachable through the active rel (one path).
    result = rg.walk({"Sales"}, max_depth=2)
    assert len(result) == 1
    assert result[0].table == "Date"
    assert len(result[0].paths) == 1

    # With USERELATIONSHIP hint enabling the inactive rel, both edges yield
    # paths, making the result ambiguous.
    result2 = rg.walk(
        {"Sales"},
        max_depth=2,
        userel_hints=[("Sales", "ship_date_fk", "Date", "date_sk")],
    )
    assert len(result2) == 1
    assert result2[0].ambiguous is True
    assert len(result2[0].paths) == 2


def test_ambiguous_paths_when_multiple_rels_reach_same_table():
    rels = [
        _r("a", "Sales", "k1", "Customer", "ck"),
        _r("b", "Sales", "k2", "Customer", "ck"),  # second active rel to Customer
    ]
    rg = RelationshipGraph.from_relationships(rels)
    result = rg.walk({"Sales"}, max_depth=2)
    assert len(result) == 1
    assert result[0].table == "Customer"
    # Two distinct relationship-id paths should be reported.
    sigs = {tuple(h.relationship_id for h in p.hops) for p in result[0].paths}
    assert len(sigs) == 2
    assert result[0].ambiguous is True


def test_depth_limit_is_honored():
    # Sales -> Region -> Country (chain of two many-to-one)
    rels = [
        _r("r1", "Sales", "region_fk", "Region", "region_sk"),
        _r("r2", "Region", "country_fk", "Country", "country_sk"),
    ]
    rg = RelationshipGraph.from_relationships(rels)
    d1 = {it.table: it.depth for it in rg.walk({"Sales"}, max_depth=1)}
    d2 = {it.table: it.depth for it in rg.walk({"Sales"}, max_depth=2)}
    assert d1 == {"Region": 1}
    assert d2 == {"Region": 1, "Country": 2}


def test_seed_table_not_in_results():
    rels = [_r("r1", "Sales", "date_fk", "Date", "date_sk")]
    rg = RelationshipGraph.from_relationships(rels)
    result = rg.walk({"Sales", "Date"}, max_depth=2)
    # Both seeds present — neither should be reported as indirect.
    assert {it.table for it in result} == set()
