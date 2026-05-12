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
