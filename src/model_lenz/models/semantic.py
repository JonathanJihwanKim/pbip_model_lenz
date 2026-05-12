from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from model_lenz.models.lineage import SourceLineage

Cardinality = Literal["many_to_one", "one_to_many", "one_to_one", "many_to_many"]
Crossfilter = Literal["single", "both"]
Classification = Literal["fact", "dim", "parameter", "time", "calculation_group", "other"]
PartitionMode = Literal["import", "directQuery", "dual", "calculated"]


class Column(BaseModel):
    name: str
    data_type: str | None = None
    is_hidden: bool = False
    is_key: bool = False
    is_fk: bool = False
    source_column: str | None = None
    description: str | None = None
    lineage_tag: str | None = None
    expression: str | None = None  # for calculated columns


class Partition(BaseModel):
    name: str
    mode: PartitionMode | str = "import"
    query_group: str | None = None
    source_expression: str = ""
    """Raw M expression text."""
    source_lineage: SourceLineage | None = None


class Measure(BaseModel):
    name: str
    table: str
    expression: str
    display_folder: str | None = None
    format_string: str | None = None
    description: str | None = None
    is_hidden: bool = False
    lineage_tag: str | None = None


class Function(BaseModel):
    """User Defined Function (TMDL preview syntax)."""

    name: str
    expression: str
    parameters: list[dict[str, str]] = Field(default_factory=list)
    return_type: str | None = None
    description: str | None = None
    lineage_tag: str | None = None


class CalculationItem(BaseModel):
    name: str
    expression: str
    ordinal: int | None = None
    format_string: str | None = None
    description: str | None = None


class CalculationGroup(BaseModel):
    name: str
    """Hosting table name."""
    precedence: int | None = None
    items: list[CalculationItem] = Field(default_factory=list)


class Table(BaseModel):
    name: str
    classification: Classification = "other"
    is_hidden: bool = False
    data_category: str | None = None
    description: str | None = None
    lineage_tag: str | None = None
    columns: list[Column] = Field(default_factory=list)
    measures: list[Measure] = Field(default_factory=list)
    partitions: list[Partition] = Field(default_factory=list)
    calculation_group: CalculationGroup | None = None


class Relationship(BaseModel):
    id: str
    from_table: str
    from_column: str
    to_table: str
    to_column: str
    cardinality: Cardinality = "many_to_one"
    crossfilter: Crossfilter = "single"
    is_active: bool = True


class Expression(BaseModel):
    """A reusable named M expression from expressions.tmdl."""

    name: str
    kind: str = "m"  # 'm' or 'parameter'
    expression: str
    lineage_tag: str | None = None
    source_lineage: SourceLineage | None = None


class Model(BaseModel):
    """Full parsed PBIP semantic model."""

    name: str | None = None
    tables: list[Table] = Field(default_factory=list)
    relationships: list[Relationship] = Field(default_factory=list)
    expressions: list[Expression] = Field(default_factory=list)
    functions: list[Function] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    def measure_index(self) -> dict[str, Measure]:
        """Return a name → Measure map (last wins on duplicate names)."""
        out: dict[str, Measure] = {}
        for t in self.tables:
            for m in t.measures:
                out[m.name] = m
        return out

    def table_index(self) -> dict[str, Table]:
        return {t.name: t for t in self.tables}
