"""End-to-end test against a real PBIP project.

Set ``MODEL_LENZ_SAMPLE_PBIP`` to the path of a PBIP project to exercise.
The default of ``D:/sample_powerbi`` matches the development sample but the
test is skipped automatically if the path does not exist.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from model_lenz.parsers.dax import extract_refs
from model_lenz.parsers.pbip import parse_pbip

SAMPLE = Path(os.environ.get("MODEL_LENZ_SAMPLE_PBIP", "D:/sample_powerbi"))


pytestmark = pytest.mark.skipif(
    not SAMPLE.exists(), reason=f"Sample PBIP not present at {SAMPLE}"
)


def _model():
    return parse_pbip(SAMPLE)


def test_summary_counts_match_sample():
    model = _model()
    assert len(model.tables) == 61
    assert sum(len(t.measures) for t in model.tables) == 274
    assert len(model.relationships) == 87
    # Parser should have zero warnings on a real-world model now.
    assert model.warnings == []


def test_correction_fault_rate_direct_refs():
    model = _model()
    measure = next(
        m
        for t in model.tables
        for m in t.measures
        if m.name == "Correction fault rate"
    )
    refs = extract_refs(measure.expression)
    # `Correction fault rate` filters Range and Business Unit.
    assert {"Range", "Business Unit"}.issubset(refs.tables)
    # And references two other measures.
    assert "Number of Corrections" in refs.measures
    assert "Number of Orderlines ready for Handout" in refs.measures


def test_business_unit_lineage_propagates_through_named_expression():
    model = _model()
    bu = next(t for t in model.tables if t.name == "Business Unit")
    partition = bu.partitions[0]
    assert partition.source_lineage is not None
    lineage = partition.source_lineage
    assert lineage.connector == "GoogleBigQuery"
    assert lineage.table == "business_unit_cur_func_dim"
    assert lineage.schema_ == "report_business_units"
    assert "bu_dim_src" in lineage.upstream_expressions


def test_classifier_finds_facts_and_dims():
    model = _model()
    by_class = {t.name: t.classification for t in model.tables}
    assert by_class["_checking_correction_event_fct"] == "fact"
    assert by_class["_picking_exception_event_fct"] == "fact"
    assert by_class["Business Unit"] == "dim"
    assert by_class["Time Period"] == "time"


def test_userel_hint_extracted_from_picked_orderlines_measure():
    model = _model()
    measure = next(
        m
        for t in model.tables
        for m in t.measures
        if m.name == "Number of Picked Orderlines"
    )
    refs = extract_refs(measure.expression)
    assert any(
        h[0] == "_orderline_agg_rpt"
        and h[1] == "first_picking_completed_date_fk"
        and h[2] == "Time Period"
        and h[3] == "date_sk"
        for h in refs.userel_hints
    )
