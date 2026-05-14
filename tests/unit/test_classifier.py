"""Tests for the table classifier."""

from __future__ import annotations

from model_lenz.analyzers.classifier import classify_tables
from model_lenz.models.semantic import (
    CalculationGroup,
    Column,
    Relationship,
    Table,
)


def _table(name: str, *, columns: list[Column] | None = None, **kwargs) -> Table:
    return Table(name=name, columns=columns or [], **kwargs)


def test_fact_by_suffix():
    t = _table("sales_fct")
    classify_tables([t], [])
    assert t.classification == "fact"


def test_dim_by_suffix():
    t = _table("customer_dim")
    classify_tables([t], [])
    assert t.classification == "dim"


def test_time_by_data_category():
    t = _table("MyDates", data_category="Time")
    classify_tables([t], [])
    assert t.classification == "time"


def test_parameter_by_prefix():
    t = _table("prmRange")
    classify_tables([t], [])
    assert t.classification == "parameter"


def test_calculation_group_takes_precedence_over_name():
    t = _table("Anything_fct", columns=[])
    t.calculation_group = CalculationGroup(name="Anything_fct")
    classify_tables([t], [])
    assert t.classification == "calculation_group"


def test_fact_inferred_from_hidden_plus_outbound_edges():
    fct = _table(
        "Events",
        columns=[Column(name="date_fk"), Column(name="cust_fk")],
        is_hidden=True,
    )
    dim_d = _table("Date", columns=[Column(name="date_sk")])
    dim_c = _table("Customer", columns=[Column(name="cust_sk")])
    rels = [
        Relationship(
            id="r1", from_table="Events", from_column="date_fk", to_table="Date", to_column="date_sk"
        ),
        Relationship(
            id="r2",
            from_table="Events",
            from_column="cust_fk",
            to_table="Customer",
            to_column="cust_sk",
        ),
    ]
    classify_tables([fct, dim_d, dim_c], rels)
    assert fct.classification == "fact"
    assert dim_d.classification == "dim"
    assert dim_c.classification == "dim"


def test_user_override_wins():
    t = _table("Sales_fct")
    classify_tables([t], [], overrides={"Sales_fct": "dim"})
    assert t.classification == "dim"


def test_snowflake_leaf_classified_as_dim():
    """A table with one outbound FK to a parent dim and no inbound edges
    (e.g. ``Relative Dates`` linking only to ``Time Period``) should be a
    dim, not "other"."""
    parent = _table("Time Period", columns=[Column(name="date_sk")])
    leaf = _table(
        "Relative Dates",
        columns=[
            Column(name="date_fk"),
            Column(name="relative_label"),
            Column(name="bucket"),
        ],
    )
    rels = [
        Relationship(
            id="r1",
            from_table="Relative Dates",
            from_column="date_fk",
            to_table="Time Period",
            to_column="date_sk",
        ),
    ]
    classify_tables([parent, leaf], rels)
    assert parent.classification == "dim"
    assert leaf.classification == "dim"


def test_snowflake_middle_node_classified_as_dim():
    """A dim that both receives a fact's one-side join AND has its own
    outbound FK to a higher-level dim is still a dim."""
    fact = _table(
        "events",
        columns=[Column(name="region_fk"), Column(name="other_fk")],
        is_hidden=True,
    )
    region = _table(
        "Region",
        columns=[Column(name="region_sk"), Column(name="country_fk"), Column(name="name")],
    )
    country = _table("Country", columns=[Column(name="country_sk")])
    other = _table("Other", columns=[Column(name="other_sk")])
    rels = [
        Relationship(
            id="r1", from_table="events", from_column="region_fk",
            to_table="Region", to_column="region_sk",
        ),
        Relationship(
            id="r2", from_table="events", from_column="other_fk",
            to_table="Other", to_column="other_sk",
        ),
        Relationship(
            id="r3", from_table="Region", from_column="country_fk",
            to_table="Country", to_column="country_sk",
        ),
    ]
    classify_tables([fact, region, country, other], rels)
    assert fact.classification == "fact"
    assert region.classification == "dim"  # snowflake middle, was "other" before fix
    assert country.classification == "dim"
    assert other.classification == "dim"
