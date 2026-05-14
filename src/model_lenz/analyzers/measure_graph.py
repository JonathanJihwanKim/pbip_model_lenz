"""Build per-measure dependency graphs.

Combines the DAX reference extractor, the transitive measure resolver, and
the relationship walker into a single `MeasureGraph` payload — the JSON
contract the frontend consumes when a user clicks a measure.
"""

from __future__ import annotations

from model_lenz.analyzers import transitive
from model_lenz.analyzers.relationships import RelationshipGraph
from model_lenz.models.graph import (
    ColumnRef,
    IndirectTable,
    MeasureGraph,
    MeasureRef,
    UserelHint,
)
from model_lenz.models.semantic import Measure, Model
from model_lenz.parsers.dax import extract_refs


def build_measure_graph(
    measure: Measure,
    *,
    model: Model,
    rel_graph: RelationshipGraph,
    depth: int = 2,
) -> MeasureGraph:
    measure_index = model.measure_index()
    table_index = model.table_index()

    refs = transitive.resolve(measure.expression, measure_index)

    # Direct refs come from the measure's own expression.
    direct_tables = sorted(refs.direct.tables)
    direct_columns = sorted(refs.direct.columns)
    referenced_measures = sorted(refs.direct.measures)

    # Indirect-dep walking uses the union of direct + transitive table refs as seeds.
    seeds = transitive.all_tables(refs)
    userel_hints = transitive.all_userel_hints(refs)
    indirect_raw = rel_graph.walk(
        seeds, max_depth=depth, userel_hints=userel_hints
    )

    indirect = _annotate_indirect(indirect_raw, table_index)

    warnings: list[str] = []
    if refs.unresolved_measures:
        warnings.append(
            "Unresolved measure references: " + ", ".join(sorted(refs.unresolved_measures))
        )
    # Bracket refs that look like measures but aren't — the difference between
    # `direct.measures` (optimistic) and `measure_index` keys.
    truly_unknown = {
        b
        for b in refs.direct.unresolved_brackets
        if b not in measure_index
    }
    if truly_unknown:
        warnings.append(
            "Unresolved bracket refs (not measures): " + ", ".join(sorted(truly_unknown))
        )

    ref_previews: list[MeasureRef] = []
    for name in referenced_measures:
        if name not in measure_index:
            continue
        ref_m = measure_index[name]
        ref_refs = extract_refs(ref_m.expression)
        ref_indirect = rel_graph.walk(
            set(ref_refs.tables),
            max_depth=depth,
            userel_hints=ref_refs.userel_hints,
        )
        ref_previews.append(
            MeasureRef(
                name=ref_m.name,
                table=ref_m.table,
                expression=ref_m.expression,
                direct_table_count=len(ref_refs.tables),
                indirect_table_count=len(ref_indirect),
            )
        )

    return MeasureGraph(
        measure={
            "name": measure.name,
            "table": measure.table,
            "expression": measure.expression,
            "displayFolder": measure.display_folder,
            "formatString": measure.format_string,
            "description": measure.description,
            "lineageTag": measure.lineage_tag,
        },
        direct_tables=direct_tables,
        direct_columns=[ColumnRef(table=t, column=c) for t, c in direct_columns],
        referenced_measures=ref_previews,
        userel_hints=[
            UserelHint(**{"from": f"{t1}.{c1}", "to": f"{t2}.{c2}"})
            for (t1, c1, t2, c2) in refs.direct.userel_hints
        ],
        indirect_tables=indirect,
        warnings=warnings,
    )


def _annotate_indirect(
    raw: list[IndirectTable], table_index: dict
) -> list[IndirectTable]:
    """Set `crosses_fact` based on table classification of intermediate hops."""
    out: list[IndirectTable] = []
    for it in raw:
        crosses = False
        for path in it.paths:
            for hop in path.hops[1:]:  # skip the seed end
                t = table_index.get(hop.from_table)
                if t and t.classification == "fact":
                    crosses = True
                    break
            if crosses:
                break
        out.append(it.model_copy(update={"crosses_fact": crosses}))
    return out
