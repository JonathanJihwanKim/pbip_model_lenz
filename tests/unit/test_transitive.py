"""Tests for the transitive measure-reference resolver."""

from __future__ import annotations

from model_lenz.analyzers.transitive import resolve
from model_lenz.models.semantic import Measure


def _m(name: str, table: str, expr: str) -> Measure:
    return Measure(name=name, table=table, expression=expr)


def test_direct_only_when_no_measure_refs():
    measures = {"M": _m("M", "T", "SUM(T[c])")}
    out = resolve("SUM ( T[c] )", measures)
    assert out.direct.tables == {"T"}
    assert out.transitive.tables == set()
    assert out.visited_measures == []


def test_one_hop_pulls_in_referenced_measure_tables():
    measures = {
        "Helper": _m("Helper", "Sales", "SUM ( Sales[Amount] )"),
    }
    out = resolve("DIVIDE ( [Helper], 2 )", measures)
    assert out.transitive.tables == {"Sales"}
    assert out.visited_measures == ["Helper"]


def test_chain_of_two_measures():
    measures = {
        "Inner": _m("Inner", "Fact", "SUM ( Fact[a] )"),
        "Outer": _m("Outer", "Measure", "[Inner] * 2"),
    }
    out = resolve("[Outer]", measures)
    assert out.transitive.tables == {"Fact"}
    assert set(out.visited_measures) == {"Outer", "Inner"}


def test_cycle_detected_and_terminated():
    measures = {
        "A": _m("A", "Measure", "[B]"),
        "B": _m("B", "Measure", "[A] + SUM ( T[c] )"),
    }
    out = resolve("[A]", measures)
    assert "T" in out.transitive.tables
    # Both visited exactly once, no infinite loop.
    assert sorted(out.visited_measures) == ["A", "B"]


def test_unresolved_measure_recorded_not_raised():
    out = resolve("[NoSuchMeasure]", measure_index={})
    assert out.unresolved_measures == ["NoSuchMeasure"]
    assert out.visited_measures == []


def test_userel_hints_propagate_through_transitive():
    measures = {
        "Picked": _m(
            "Picked",
            "Measure",
            "CALCULATE ( SUM ( Sales[Amount] ), USERELATIONSHIP ( Sales[ship_date_fk], 'Date'[date_sk] ) )",
        )
    }
    out = resolve("[Picked]", measures)
    assert out.transitive.userel_hints
    hint = out.transitive.userel_hints[0]
    assert hint == ("Sales", "ship_date_fk", "Date", "date_sk")
