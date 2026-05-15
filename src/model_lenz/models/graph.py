from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from model_lenz.models.semantic import Cardinality, Crossfilter

EdgeKind = Literal["direct", "relationship", "userel"]
NodeKind = Literal["measure", "table", "function"]


class GraphNode(BaseModel):
    id: str
    kind: NodeKind
    label: str
    classification: str | None = None  # for table nodes
    source_label: str | None = None  # source-system name if known


class GraphEdge(BaseModel):
    source: str
    target: str
    kind: EdgeKind
    cardinality: Cardinality | None = None
    crossfilter: Crossfilter | None = None
    is_active: bool | None = None
    relationship_id: str | None = None


class Hop(BaseModel):
    """A single edge traversal in an indirect-dependency path."""

    from_table: str
    to_table: str
    from_column: str
    to_column: str
    cardinality: Cardinality
    crossfilter: Crossfilter
    is_active: bool
    relationship_id: str


class IndirectPath(BaseModel):
    hops: list[Hop]


class IndirectTable(BaseModel):
    table: str
    via: str
    """The seed (directly-referenced) table this path started from."""
    depth: int
    ambiguous: bool = False
    crosses_fact: bool = False
    paths: list[IndirectPath] = Field(default_factory=list)


class MeasureRef(BaseModel):
    name: str
    table: str
    expression: str | None = None
    direct_table_count: int = 0
    indirect_table_count: int = 0
    direct_tables: list[str] = Field(default_factory=list)
    indirect_tables: list[str] = Field(default_factory=list)


class ColumnRef(BaseModel):
    table: str
    column: str


class UserelHint(BaseModel):
    from_: str = Field(alias="from")
    to: str

    model_config = {"populate_by_name": True}


class MeasureGraph(BaseModel):
    measure: dict[str, Any]
    direct_tables: list[str] = Field(default_factory=list)
    direct_columns: list[ColumnRef] = Field(default_factory=list)
    referenced_measures: list[MeasureRef] = Field(default_factory=list)
    userel_hints: list[UserelHint] = Field(default_factory=list)
    indirect_tables: list[IndirectTable] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
