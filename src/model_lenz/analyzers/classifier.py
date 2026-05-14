"""Heuristic table classifier.

Categorizes each `Table` as ``fact``, ``dim``, ``parameter``, ``time``,
``calculation_group``, or ``other``. Heuristics combine name suffix, hidden
flag, FK column count, ``dataCategory``, and (when relationships are
available) cardinality direction.

Users can override per-table classification via a ``model_lenz.toml`` file in
the PBIP root, e.g.::

    [classify]
    "Time Period" = "dim"
"""

from __future__ import annotations

from collections import defaultdict

from model_lenz.models.semantic import Classification, Relationship, Table

FACT_SUFFIXES = ("_fct", "_agg_fct", "_agg_rpt", "_agg", "_rpt")
DIM_SUFFIXES = ("_dim",)
PARAM_PREFIXES = ("prm", "_prm")


def classify_tables(
    tables: list[Table],
    relationships: list[Relationship],
    *,
    overrides: dict[str, Classification] | None = None,
) -> None:
    """Mutate each `Table.classification` in place."""
    overrides = overrides or {}

    out_count: dict[str, int] = defaultdict(int)  # outbound many-to-one count per table
    in_count: dict[str, int] = defaultdict(int)  # inbound many-to-one count per table
    for r in relationships:
        if r.cardinality == "many_to_one":
            out_count[r.from_table] += 1
            in_count[r.to_table] += 1
        elif r.cardinality == "one_to_many":
            out_count[r.to_table] += 1
            in_count[r.from_table] += 1

    for t in tables:
        if t.name in overrides:
            t.classification = overrides[t.name]
            continue
        t.classification = _classify_one(t, out_count[t.name], in_count[t.name])


def _classify_one(t: Table, outbound_fk_edges: int, inbound_one_edges: int) -> Classification:
    if t.calculation_group is not None:
        return "calculation_group"

    if (t.data_category or "").lower() == "time":
        return "time"

    name = t.name
    lname = name.lower()

    if any(name.startswith(p) for p in PARAM_PREFIXES):
        return "parameter"

    if any(lname.endswith(s) for s in FACT_SUFFIXES):
        return "fact"
    if any(lname.endswith(s) for s in DIM_SUFFIXES):
        return "dim"

    fk_columns = sum(1 for c in t.columns if c.is_fk or c.name.lower().endswith(("_fk", "_ifk")))

    if t.is_hidden and outbound_fk_edges >= 2:
        return "fact"
    if outbound_fk_edges >= 2 and fk_columns >= 2:
        return "fact"

    if inbound_one_edges >= 1 and fk_columns == 0:
        return "dim"

    # Snowflake middle node: a fact (or another dim) joins to this table as
    # the one-side, but the table also has its own outbound FK to a parent
    # dim. Without this rule, snowflake intermediates fall through to "other"
    # and end up in the disconnected zone instead of the dim row.
    if inbound_one_edges >= 1 and outbound_fk_edges >= 1:
        return "dim"

    # Snowflake leaf: nothing references this table as the one-side, but it
    # has exactly one outbound FK to a parent dim. Classic example: a
    # "Relative Dates" table that links only to the Calendar/Time dim.
    # Multi-FK leaves (likely facts) are caught by the rules above.
    if inbound_one_edges == 0 and outbound_fk_edges == 1:
        return "dim"

    if len(t.columns) <= 2:
        return "parameter"

    return "other"
