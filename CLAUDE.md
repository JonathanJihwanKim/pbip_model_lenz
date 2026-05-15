# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Model Lenz parses a Power BI **PBIP** (TMDL semantic model on disk) and serves an interactive graph of how each DAX measure depends on tables — both directly (mentioned in the expression) and indirectly (reached through active relationships, with `USERELATIONSHIP` overrides). It is **read-only static analysis**; nothing connects to XMLA or executes DAX.

Distribution: a single Python wheel (`uv tool install model-lenz`) that bundles the FastAPI backend, the pre-built React SPA at `src/model_lenz/frontend_dist/`, and a tiny demo PBIP at `examples/tiny_pbip/`.

## Common commands

The repo's [dev.ps1](dev.ps1) (Windows/PowerShell) wraps the rebuild + reinstall + run cycle. Prefer it over individual commands when iterating on a Windows dev box.

```powershell
.\dev.ps1 dev "examples\tiny_pbip"   # two-terminal HMR loop (API on :8765, Vite on :5173)
.\dev.ps1 reinstall                  # rebuild frontend + wheel + force-reinstall global tool
.\dev.ps1 serve "D:\some_pbip"       # reinstall, then serve a PBIP
.\dev.ps1 demo                       # reinstall, then serve the bundled demo
.\dev.ps1 test                       # pytest against the editable .venv
```

Direct equivalents (work on any OS):

```bash
# Backend hot-loop (Terminal 1)
.venv/Scripts/model-lenz serve examples/tiny_pbip --port 8765 --no-browser
# Frontend hot-loop (Terminal 2) — proxies /api/* to :8765
cd frontend && npm run dev

# Lint / typecheck
ruff check src tests
ruff format src tests
mypy src/model_lenz/models           # strict ONLY on models/ (the JSON contract)
cd frontend && npm run typecheck

# Tests
pytest tests/unit -v                                              # fast, no PBIP needed
MODEL_LENZ_SAMPLE_PBIP=examples/tiny_pbip pytest -v               # include e2e
pytest tests/unit/test_relationship_walker.py::test_name -v       # single test

# Frontend build (only needed before release or before `uv tool install` from a local wheel)
cd frontend && npm run build         # outputs to src/model_lenz/frontend_dist/

# Wheel build (maintainers only)
hatch build
```

## Two installs on the same machine — a recurring footgun

A dev box has Model Lenz in **two** places:

1. **`.venv` editable install** (`uv pip install -e ".[dev]"`). Python edits are live immediately. Frontend edits need `npm run build` to refresh `frontend_dist/`.
2. **Global `uv tool install model-lenz`** at `~/.local/bin/`. Stale until you rebuild the wheel AND `uv tool install --force` it. This is what end users get.

When `model-lenz` on the PATH does *not* reflect your code, you almost certainly forgot to rebuild the global tool. `dev.ps1 reinstall` does the whole dance (kill running processes, rebuild SPA, rebuild wheel, force-reinstall, hash-check the bundle). The HMR loop above bypasses both — Vite serves the SPA from source while uvicorn runs from the editable install.

## Releasing — the version-drift footgun

The release workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) triggers on a `v*` tag push, builds the wheel from `pyproject.toml`, and publishes to PyPI via OIDC Trusted Publisher (no token).

The wheel version comes from **two places that must stay in sync** before tagging:

1. [pyproject.toml](pyproject.toml) — `version = "X.Y.Z"`
2. [src/model_lenz/\_\_init\_\_.py](src/model_lenz/__init__.py) — `__version__ = "X.Y.Z"` (CLI's `model-lenz version` reads this; `server.py` exposes it via `/healthz`)

Tagging `vX.Y.Z` without bumping both files publishes a wheel labeled with the *old* version and creates a confusing mismatch between the tag, the GitHub release, and the artifact on PyPI. **Always bump both, commit, then tag** — never tag a commit whose version files don't already match the tag name.

`model-lenz version` against the editable .venv after a bump is the quickest sanity check.

PyPI doesn't allow re-uploading the same version even if a previous publish failed. If a release errors halfway, bump the patch version forward (`0.1.1` → `0.1.2`) rather than re-tagging the same version on a new commit.

Future cleanup worth considering: switch to `hatch-vcs` so the version is derived from the git tag at build time, eliminating the two-file drift class entirely. Not urgent — keep this gotcha in mind until then.

## Architecture — the data flow that touches every layer

A request to `GET /api/measures/{table}/{name}/graph` exercises the whole pipeline. Tracing it is the fastest way to orient:

```
  PBIP folder on disk
        │
        ▼  parsers/pbip.py :: parse_pbip()
  TMDL files → parsers/tmdl.py (indent-aware block parser)
             → for each table: columns / measures / partitions / calc groups
             → parsers/m_query.py for partition + named-expression M lineage
             → analyzers/classifier.py marks each table fact/dim/param/time/calc-group/other
             → _propagate_upstream_lineage() chains M expression refs to deepest source
        │
        ▼  models/semantic.py  (Pydantic — the canonical typed model)
  Model { tables, relationships, expressions, functions, warnings }
        │
        ▼  analyzers/relationships.py :: RelationshipGraph.from_relationships()
  NetworkX MultiGraph of tables, edges carry cardinality/crossfilter/active flags
        │   (cached together with Model by api/cache.py, keyed by abs PBIP path,
        │    invalidated by max mtime of definition/**/*.tmdl)
        ▼  on each /api/measures/.../graph call:
  parsers/dax.py :: extract_refs(expression)           → direct table/column/measure refs + USERELATIONSHIP hints
  analyzers/transitive.py :: resolve()                 → walks DAX measure→measure chain, unions direct refs
  RelationshipGraph.walk(seeds, max_depth, userel_hints)
                                                       → BFS through active edges (+ inactive ones
                                                          re-enabled by USERELATIONSHIP) honouring
                                                          filter-propagation direction
        │
        ▼  analyzers/measure_graph.py :: build_measure_graph()
  MeasureGraph payload  (models/graph.py)
        │
        ▼  api/routes.py
  FastAPI → JSON → frontend/src/api/client.ts → Zustand store → D3 force graph
```

The **central design idea** is the split between *direct* and *indirect* dependencies. Direct = parsed lexically from DAX. Indirect = the set of tables that, when filtered in the report, would change the measure's result — discovered by walking relationships from the direct-ref seeds. Filter-propagation rules are encoded in `_EdgeMeta.propagates_from()` in `analyzers/relationships.py`; everything else flows from there.

## Layer-specific notes

- **`models/` is the JSON contract.** Pydantic schemas here are what the API serializes and what `frontend/src/api/types.ts` mirrors as TypeScript types. mypy runs in `--strict` mode **only on this package**. Changing a field here is a contract change — update the TS mirror in the same commit.
- **Frontend bundle policy.** `src/model_lenz/frontend_dist/` is committed at release time only. Do not include bundle diffs in feature PRs — they are regenerated by `npm run build` during release. The wheel ships `frontend_dist/` via `[tool.hatch.build.targets.wheel.force-include]` in `pyproject.toml`.
- **TMDL parser is intentionally tolerant.** Unknown keywords / malformed blocks produce a `warnings: list[str]` rather than raising. Edge cases belong in `tests/unit/test_tmdl_parser.py` (or `tests/fixtures/edge_cases/`), not in defensive code in the parser itself.
- **M lineage detection.** Each connector (BigQuery, Snowflake, SQL, etc.) is a small recognizer in `parsers/m_query.py` returning a `SourceLineage` with confidence label. Cross-query refs are resolved post-hoc by `_propagate_upstream_lineage()` in `parsers/pbip.py` and tagged `medium` confidence.
- **PBIP path acceptance.** `parse_pbip` accepts the PBIP root, the `*.SemanticModel/` folder, or its `definition/` subfolder — `find_semantic_model()` normalizes them. Keep CLI / test fixtures using whichever form is most readable.
- **CLI commands.** `model-lenz {demo,serve,inspect,summary,version}` — defined in `src/model_lenz/cli.py` with Typer. `serve` and `demo` launch uvicorn via `server.py::serve`; `inspect` writes UTF-8 to stdout via `sys.stdout.buffer` to dodge Windows cp1252 errors on Unicode DAX.
- **In-process cache.** `api/cache.py::ModelCache` parses the PBIP once per server, fingerprints by max TMDL mtime, and re-parses transparently when files change. No need to restart the server after editing the model under analysis.

## Test layout

- `tests/unit/` — fast, deterministic, no filesystem dependence beyond `tests/fixtures/`. Each module mirrors a source module (e.g. `test_relationship_walker.py` ↔ `analyzers/relationships.py`).
- `tests/e2e/test_sample_pbip.py` — gated on `MODEL_LENZ_SAMPLE_PBIP` env var. Skipped in CI by default; point it at `examples/tiny_pbip` (in the repo) or a private PBIP.
- `tests/fixtures/` — small hand-authored TMDL slices. No copy-pasted production dumps.

## Conventions

- **Comments policy** (also in [CONTRIBUTING.md](CONTRIBUTING.md)): default to none. Add a comment only when explaining *why* something non-obvious is happening — a hidden constraint, a workaround, a subtle invariant. Don't restate what the code does.
- **Line length 100** (ruff), `E501` ignored. Ruff rule set: `E, F, I, B, UP, SIM, RUF`.
- **Classification overrides.** Users can drop a `model_lenz.toml` next to their `.pbip` with `[classify]` entries to override the heuristic. Honored by `_load_overrides()` in `parsers/pbip.py`.
- **Out of scope** (from CONTRIBUTING.md): authoring/modifying PBIP files, re-implementing DAX Studio / Tabular Editor features, live XMLA/AS connections.
