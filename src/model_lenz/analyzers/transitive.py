"""Transitive measure-reference resolver.

Given a measure expression, walk its DAX refs (`[OtherMeasure]`) and follow
into the referenced measures' own expressions, accumulating *all* table
references along the way. This is what lets the indirect-dep walker discover
fact tables that a measure only touches through a helper measure.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from model_lenz.models.semantic import Measure
from model_lenz.parsers.dax import DaxRefs, extract_refs


@dataclass
class TransitiveRefs:
    direct: DaxRefs
    """Refs found in the measure's own expression (no transitive resolution)."""

    transitive: DaxRefs = field(default_factory=DaxRefs)
    """Union of refs found across all transitively-referenced measures."""

    visited_measures: list[str] = field(default_factory=list)
    """Names of measures that were resolved (in BFS order, excluding the seed)."""

    unresolved_measures: list[str] = field(default_factory=list)
    """Bracket refs that did not match any known measure."""


def resolve(
    seed_expression: str,
    measure_index: dict[str, Measure],
    *,
    max_depth: int = 5,
) -> TransitiveRefs:
    """Resolve all refs reachable through measure-to-measure references.

    `measure_index` maps measure name → `Measure` (last-wins on dup names).
    """
    direct = extract_refs(seed_expression)
    transitive = DaxRefs()
    visited: list[str] = []
    unresolved: list[str] = []

    seen_names: set[str] = set()
    queue: list[tuple[str, int]] = [(name, 1) for name in direct.measures]

    while queue:
        name, depth = queue.pop(0)
        if name in seen_names:
            continue
        seen_names.add(name)

        m = measure_index.get(name)
        if m is None:
            unresolved.append(name)
            continue
        visited.append(name)

        refs = extract_refs(m.expression)
        _merge(transitive, refs)
        if depth < max_depth:
            for child in refs.measures:
                if child not in seen_names:
                    queue.append((child, depth + 1))

    return TransitiveRefs(
        direct=direct,
        transitive=transitive,
        visited_measures=visited,
        unresolved_measures=unresolved,
    )


def _merge(into: DaxRefs, src: DaxRefs) -> None:
    into.tables |= src.tables
    into.columns |= src.columns
    into.measures |= src.measures
    into.userel_hints.extend(src.userel_hints)
    into.unresolved_brackets |= src.unresolved_brackets


def all_tables(refs: TransitiveRefs) -> set[str]:
    """Union of direct and transitive table refs."""
    return set(refs.direct.tables) | set(refs.transitive.tables)


def all_userel_hints(refs: TransitiveRefs) -> list[tuple[str, str, str, str]]:
    return list(refs.direct.userel_hints) + list(refs.transitive.userel_hints)
