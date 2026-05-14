"""Integration tests for the FastAPI routes.

Skipped automatically when the development sample at ``D:/sample_powerbi`` is
unavailable.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from model_lenz.server import create_app

SAMPLE = Path(os.environ.get("MODEL_LENZ_SAMPLE_PBIP", "D:/sample_powerbi"))

pytestmark = pytest.mark.skipif(
    not SAMPLE.exists(), reason=f"Sample PBIP not present at {SAMPLE}"
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app(SAMPLE))


def test_healthz(client: TestClient):
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "version" in body
    assert "pbip" in body


def test_model_summary(client: TestClient):
    r = client.get("/api/model")
    assert r.status_code == 200
    body = r.json()
    assert body["counts"]["tables"] == 61
    assert body["counts"]["measures"] == 274
    assert body["counts"]["relationships"] == 87
    assert "fact" in body["classifications"]


def test_list_measures(client: TestClient):
    r = client.get("/api/measures")
    assert r.status_code == 200
    measures = r.json()
    assert len(measures) == 274
    assert any(m["name"] == "Correction fault rate" for m in measures)


def test_measure_graph_correction_fault_rate(client: TestClient):
    r = client.get("/api/measures/Measure/Correction%20fault%20rate/graph")
    assert r.status_code == 200
    g = r.json()
    assert g["measure"]["name"] == "Correction fault rate"
    assert "Range" in g["direct_tables"]
    assert "Business Unit" in g["direct_tables"]
    indirect_names = {it["table"] for it in g["indirect_tables"]}
    # Reaches dim tables via the helper measures' fact references.
    assert "Time Period" in indirect_names or "Customer Fulfilment Flow" in indirect_names
    # And references two helper measures.
    ref_names = {r["name"] for r in g["referenced_measures"]}
    assert "Number of Corrections" in ref_names


def test_measure_graph_404(client: TestClient):
    r = client.get("/api/measures/Measure/NoSuchMeasure/graph")
    assert r.status_code == 404


def test_measure_graph_depth_param_clamps(client: TestClient):
    # depth=1 should yield fewer indirect tables than depth=2 in general.
    r1 = client.get("/api/measures/Measure/Number%20of%20Exceptions/graph?depth=1")
    r2 = client.get("/api/measures/Measure/Number%20of%20Exceptions/graph?depth=2")
    assert r1.status_code == 200 and r2.status_code == 200
    assert len(r2.json()["indirect_tables"]) >= len(r1.json()["indirect_tables"])


def test_userelationship_hint_surfaces():
    client = TestClient(create_app(SAMPLE))
    r = client.get("/api/measures/Measure/Number%20of%20Picked%20Orderlines/graph")
    body = r.json()
    assert body["userel_hints"]
    h = body["userel_hints"][0]
    assert h["from"] == "_orderline_agg_rpt.first_picking_completed_date_fk"
    assert h["to"] == "Time Period.date_sk"


def test_list_tables(client: TestClient):
    r = client.get("/api/tables")
    body = r.json()
    assert len(body) == 61
    bu = next(t for t in body if t["name"] == "Business Unit")
    assert bu["classification"] == "dim"
    assert bu["source_connector"] == "GoogleBigQuery"


def test_get_table_detail(client: TestClient):
    r = client.get("/api/tables/Business%20Unit")
    assert r.status_code == 200
    body = r.json()
    assert body["table"]["name"] == "Business Unit"
    assert isinstance(body["relationships"], list)


def test_search(client: TestClient):
    r = client.get("/api/search?q=correction")
    assert r.status_code == 200
    hits = r.json()
    assert any(h["kind"] == "measure" and "correction" in h["name"].lower() for h in hits)


def test_relationships_endpoint(client: TestClient):
    r = client.get("/api/relationships")
    assert r.status_code == 200
    assert len(r.json()) == 87


def test_openapi_doc_exists(client: TestClient):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    spec = r.json()
    assert spec["info"]["title"] == "Model Lenz"
    assert "/api/measures/{table}/{name}/graph" in spec["paths"]
