"""Relationship graph + indirect-dependency walker.

Builds an undirected `MultiGraph` of tables, where each edge carries the
relationship metadata needed to decide whether filter propagation reaches a
neighbor. Walking from a *seed table set* (the tables a measure directly
references) produces the set of tables that, when filtered, would change the
measure's result — those are the indirect dependencies.

Filter-propagation rules (Power BI semantics):

- A many-to-one edge (T_many — T_one) propagates filters from the *one* side
  to the *many* side by default. So a measure on T_many is also affected by
  filters on T_one, and walking from T_many to T_one is always allowed for
  dependency discovery.
- With ``crossFilteringBehavior: bothDirections`` the reverse propagation is
  also active, so walking from T_one back to T_many is allowed too.
- Inactive relationships are excluded by default, but a per-measure set of
  ``USERELATIONSHIP(t1[c1], t2[c2])`` hints can re-enable specific edges for
  that measure's walk.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Iterable

import networkx as nx

from model_lenz.models.graph import Hop, IndirectPath, IndirectTable
from model_lenz.models.semantic import Relationship


@dataclass
class _EdgeMeta:
    relationship_id: str
    many_table: str
    one_table: str
    many_column: str
    one_column: str
    crossfilter: str  # 'single' | 'both'
    cardinality: str  # 'many_to_one' | 'one_to_many' | 'one_to_one' | 'many_to_many'
    is_active: bool

    def propagates_from(self, node: str) -> bool:
        if node == self.many_table:
            return True
        if node == self.one_table:
            return self.crossfilter == "both" or self.cardinality in (
                "one_to_one",
                "many_to_many",
            )
        return False

    def other(self, node: str) -> str:
        return self.one_table if node == self.many_table else self.many_table


@dataclass
class RelationshipGraph:
    """An undirected MultiGraph of tables with rich edge metadata."""

    graph: nx.MultiGraph = field(default_factory=nx.MultiGraph)

    @classmethod
    def from_relationships(cls, relationships: Iterable[Relationship]) -> "RelationshipGraph":
        rg = cls()
        for r in relationships:
            many, one, m_col, o_col = _orient(r)
            meta = _EdgeMeta(
                relationship_id=r.id,
                many_table=many,
                one_table=one,
                many_column=m_col,
                one_column=o_col,
                crossfilter=r.crossfilter,
                cardinality=r.cardinality,
                is_active=r.is_active,
            )
            rg.graph.add_node(many)
            rg.graph.add_node(one)
            rg.graph.add_edge(many, one, key=r.id, meta=meta)
        return rg

    # ------------------------------------------------------------------ #
    # Indirect-dependency walk
    # ------------------------------------------------------------------ #

    def walk(
        self,
        seeds: set[str],
        *,
        max_depth: int = 2,
        userel_hints: Iterable[tuple[str, str, str, str]] = (),
    ) -> list[IndirectTable]:
        """Return all tables reachable from `seeds` within `max_depth` hops.

        Each returned `IndirectTable` lists the path(s) traversed; if multiple
        distinct paths reach the same table, ``ambiguous`` is set.

        `userel_hints` (from `USERELATIONSHIP(...)` calls) re-enable matching
        inactive relationships for this walk only.
        """
        userel_set = {(t1, c1, t2, c2) for (t1, c1, t2, c2) in userel_hints}
        # By-table lookup of (target table, list of paths)
        results: dict[str, list[list[Hop]]] = {}
        # (seed, edge_id, direction-from) so we don't loop on the same edge.
        visited: set[tuple[str, str, str]] = set()

        for seed in seeds:
            if seed not in self.graph:
                continue
            queue: deque[tuple[str, list[Hop], int]] = deque()
            queue.append((seed, [], 0))
            while queue:
                node, path, depth = queue.popleft()
                if depth >= max_depth:
                    continue
                for _, neighbor, key, data in self.graph.edges(node, keys=True, data=True):
                    meta: _EdgeMeta = data["meta"]
                    if not meta.is_active and not _userel_enables(meta, userel_set):
                        continue
                    if not meta.propagates_from(node):
                        continue
                    edge_key = (seed, meta.relationship_id, node)
                    if edge_key in visited:
                        continue
                    visited.add(edge_key)
                    other = meta.other(node)
                    hop = _make_hop(meta, from_node=node, to_node=other)
                    new_path = path + [hop]
                    if other not in seeds:
                        results.setdefault(other, []).append(new_path)
                    queue.append((other, new_path, depth + 1))

        # Group paths into IndirectTable records.
        seed_set = set(seeds)
        out: list[IndirectTable] = []
        for table, paths in results.items():
            unique_paths = _dedupe_paths(paths)
            depths = sorted({len(p) for p in unique_paths})
            via_seed = unique_paths[0][0].from_table if unique_paths else ""
            crosses_fact = False  # populated by caller with classification info
            out.append(
                IndirectTable(
                    table=table,
                    via=via_seed,
                    depth=depths[0] if depths else 1,
                    ambiguous=len(unique_paths) > 1,
                    crosses_fact=crosses_fact,
                    paths=[IndirectPath(hops=p) for p in unique_paths],
                )
            )
        out.sort(key=lambda x: (x.depth, x.table))
        return out


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _orient(r: Relationship) -> tuple[str, str, str, str]:
    """Return (many_table, one_table, many_column, one_column) for any
    cardinality. For symmetric cardinalities the original orientation is
    preserved.
    """
    if r.cardinality == "many_to_one":
        return (r.from_table, r.to_table, r.from_column, r.to_column)
    if r.cardinality == "one_to_many":
        return (r.to_table, r.from_table, r.to_column, r.from_column)
    # one_to_one and many_to_many: keep authoring direction
    return (r.from_table, r.to_table, r.from_column, r.to_column)


def _userel_enables(meta: _EdgeMeta, userel_set: set[tuple[str, str, str, str]]) -> bool:
    a = (meta.many_table, meta.many_column, meta.one_table, meta.one_column)
    b = (meta.one_table, meta.one_column, meta.many_table, meta.many_column)
    return a in userel_set or b in userel_set


def _make_hop(meta: _EdgeMeta, *, from_node: str, to_node: str) -> Hop:
    if from_node == meta.many_table:
        from_col, to_col = meta.many_column, meta.one_column
    else:
        from_col, to_col = meta.one_column, meta.many_column
    return Hop(
        from_table=from_node,
        to_table=to_node,
        from_column=from_col,
        to_column=to_col,
        cardinality=meta.cardinality,
        crossfilter=meta.crossfilter,
        is_active=meta.is_active,
        relationship_id=meta.relationship_id,
    )


def _dedupe_paths(paths: list[list[Hop]]) -> list[list[Hop]]:
    seen: set[tuple[str, ...]] = set()
    out: list[list[Hop]] = []
    for p in paths:
        sig = tuple(h.relationship_id for h in p)
        if sig in seen:
            continue
        seen.add(sig)
        out.append(p)
    return out
