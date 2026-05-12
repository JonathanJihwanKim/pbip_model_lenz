"""Model Lenz CLI.

Entry point installed as the ``model-lenz`` console script.

Subcommands:
- ``model-lenz inspect <pbip-path>`` — parse the model and print JSON to stdout.
- ``model-lenz summary <pbip-path>``  — terse human summary.
- ``model-lenz <pbip-path>``          — (M2+) start the local web app. For M1
  this is aliased to ``summary`` so the binary already does something useful.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

import typer

from model_lenz import __version__
from model_lenz.parsers.pbip import parse_pbip

app = typer.Typer(
    name="model-lenz",
    help="Open-source PBIP analyzer.",
    add_completion=False,
    no_args_is_help=True,
)


def _print_summary(pbip_path: Path) -> None:
    model = parse_pbip(pbip_path)
    measure_total = sum(len(t.measures) for t in model.tables)
    classifications: dict[str, int] = {}
    for t in model.tables:
        classifications[t.classification] = classifications.get(t.classification, 0) + 1

    confidence: dict[str, int] = {}
    for t in model.tables:
        for p in t.partitions:
            label = p.source_lineage.confidence if p.source_lineage else "none"
            confidence[label] = confidence.get(label, 0) + 1

    typer.echo(f"Model:         {model.name}")
    typer.echo(f"Tables:        {len(model.tables)}")
    typer.echo(f"Measures:      {measure_total}")
    typer.echo(f"Relationships: {len(model.relationships)}")
    typer.echo(f"Expressions:   {len(model.expressions)}")
    typer.echo(f"Functions:     {len(model.functions)}")
    typer.echo(f"Warnings:      {len(model.warnings)}")
    typer.echo(f"Classification: {classifications}")
    typer.echo(f"Lineage conf  : {confidence}")


@app.command()
def inspect(
    pbip_path: Path = typer.Argument(..., exists=True, help="Path to a PBIP project, .SemanticModel folder, or its definition/."),
    indent: int = typer.Option(2, "--indent", "-i", help="JSON indent (0 for compact)."),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Write JSON to this file instead of stdout."),
) -> None:
    """Parse a PBIP and print the parsed model as JSON."""
    model = parse_pbip(pbip_path)
    blob = model.model_dump(by_alias=True, mode="json")
    rendered = json.dumps(blob, indent=indent if indent > 0 else None, ensure_ascii=False)
    if output:
        output.write_text(rendered, encoding="utf-8")
        typer.echo(f"Wrote {output} ({len(rendered):,} bytes)")
    else:
        # Write to stdout as UTF-8 bytes to avoid Windows cp1252 errors on
        # Unicode characters embedded in DAX/M expressions.
        sys.stdout.buffer.write(rendered.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")


@app.command()
def summary(
    pbip_path: Path = typer.Argument(..., exists=True, help="Path to a PBIP project."),
) -> None:
    """Print a one-screen human summary of the parsed model."""
    _print_summary(pbip_path)


@app.command(name="version")
def version_cmd() -> None:
    """Print the Model Lenz version."""
    typer.echo(__version__)


def main() -> None:  # pragma: no cover
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
