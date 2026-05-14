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

PBIP_PATH_HELP = (
    "Path to a PBIP. Recommended: the PBIP ROOT folder (the one "
    "containing the .pbip file and the *.SemanticModel\\ subfolder). "
    "The *.SemanticModel\\ folder itself or its definition\\ subfolder "
    "also work."
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
    pbip_path: Path = typer.Argument(..., exists=True, help=PBIP_PATH_HELP),
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
    pbip_path: Path = typer.Argument(..., exists=True, help=PBIP_PATH_HELP),
) -> None:
    """Print a one-screen human summary of the parsed model."""
    _print_summary(pbip_path)


@app.command(name="version")
def version_cmd() -> None:
    """Print the Model Lenz version."""
    typer.echo(__version__)


@app.command()
def serve(
    pbip_path: Path = typer.Argument(..., exists=True, help=PBIP_PATH_HELP),
    host: str = typer.Option("127.0.0.1", "--host", "-H", help="Bind host."),
    port: int = typer.Option(0, "--port", "-p", help="Bind port (0 = auto)."),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't open a browser."),
) -> None:
    """Start the local web server and open the model in a browser."""
    from model_lenz.server import serve as _serve

    _serve(pbip_path, host=host, port=port, open_browser=not no_browser)


@app.command()
def demo(
    host: str = typer.Option("127.0.0.1", "--host", "-H", help="Bind host."),
    port: int = typer.Option(0, "--port", "-p", help="Bind port (0 = auto)."),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't open a browser."),
) -> None:
    """Serve the bundled tiny demo PBIP - no path or clone needed."""
    from model_lenz.server import serve as _serve

    # Wheel install: bundled at <package>/_demo/tiny_pbip via force-include.
    # Editable install (pip install -e .): fall back to repo's examples/tiny_pbip.
    candidates = [
        Path(__file__).parent / "_demo" / "tiny_pbip",
        Path(__file__).parent.parent.parent / "examples" / "tiny_pbip",
    ]
    demo_path = next((p for p in candidates if p.exists()), None)
    if demo_path is None:
        raise typer.BadParameter(
            "Bundled demo not found. Tried:\n  "
            + "\n  ".join(str(p) for p in candidates)
            + "\nIf you're running from a source checkout, ensure examples/tiny_pbip exists."
        )
    typer.echo(f"Serving bundled demo from {demo_path}")
    _serve(demo_path, host=host, port=port, open_browser=not no_browser)


def main() -> None:  # pragma: no cover
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
