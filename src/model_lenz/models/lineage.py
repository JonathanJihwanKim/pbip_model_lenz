from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Confidence = Literal["high", "medium", "low"]


class SourceLineage(BaseModel):
    """Power Query lineage for a single partition or named expression."""

    connector: str | None = None
    """Detected connector name (e.g. 'GoogleBigQuery', 'Sql.Database')."""

    schema_: str | None = Field(default=None, alias="schema")
    """Source-system schema / dataset name when extractable."""

    table: str | None = None
    """Source-system table name when extractable."""

    fully_qualified: str | None = None
    """Best-effort fully-qualified source identifier (project.schema.table or similar)."""

    sql: str | None = None
    """Native SQL text when the partition uses Value.NativeQuery."""

    transformed_steps: list[str] = Field(default_factory=list)
    """Names of transformation steps applied between source and final `in` step."""

    upstream_expressions: list[str] = Field(default_factory=list)
    """Names of other named expressions this partition references (chain order)."""

    confidence: Confidence = "low"

    model_config = {"populate_by_name": True}
