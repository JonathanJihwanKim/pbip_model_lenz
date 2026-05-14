# Contributing to Model Lenz

Thanks for your interest in improving Model Lenz. This guide covers how to set up the project locally, where things live, and what kind of changes are most welcome.

## Project layout

```
src/model_lenz/         Python package (parser, analyzers, API, CLI)
  parsers/              TMDL, DAX, M-query parsers
  analyzers/            Classifier, relationship walker, transitive resolver
  models/               Pydantic schemas (the JSON contract)
  api/                  FastAPI routes + cache
  server.py             Uvicorn launcher
  cli.py                Typer entry point: `model-lenz`
  frontend_dist/        Built React bundle (committed at release time)

frontend/               React + Vite + TypeScript source
  src/
    api/                Mirror of the JSON contract + fetch client
    store/              Zustand store
    components/         Header, Sidebar, DetailPanel, Legend
    graph/              D3 force graph (the centerpiece visualization)

tests/
  unit/                 Fast, deterministic unit tests
  e2e/                  Tests that read a real PBIP — gated on
                        $MODEL_LENZ_SAMPLE_PBIP
  fixtures/             Hand-authored TMDL slices

examples/tiny_pbip/     Runnable PBIP shipped with the repo
```

## Dev environment

You need Python 3.10+ and Node 20+.

```bash
# Python side
uv venv --python 3.12
uv pip install -e ".[dev]"

# Frontend side
cd frontend
npm install
```

### Run the test suite

```bash
# Unit tests (fast, run in <2s)
pytest tests/unit -v

# Include the end-to-end sample test (requires a real PBIP)
MODEL_LENZ_SAMPLE_PBIP=/path/to/your/PBIP pytest tests -v

# Or use the included tiny example
MODEL_LENZ_SAMPLE_PBIP=examples/tiny_pbip pytest tests/unit/test_api_routes.py -v
```

### Run the app locally

Two terminals — one for the API, one for the Vite dev server with HMR:

```bash
# Terminal 1: backend
model-lenz serve examples/tiny_pbip --port 8765 --no-browser

# Terminal 2: frontend
cd frontend
npm run dev   # opens http://localhost:5173 with API proxied to :8765
```

For a "production-feel" run that uses the bundled SPA:

```bash
cd frontend && npm run build   # emits to src/model_lenz/frontend_dist/
model-lenz serve examples/tiny_pbip
```

## Style and quality

- **Python**: `ruff` for linting/formatting, `mypy --strict` on `src/model_lenz/models/` only (the JSON contract — strictly typed). Other modules use lenient typing.
- **TypeScript**: `tsc --noEmit` in the frontend; `npm run typecheck`.
- Default to writing **no comments**. Add a comment only when it explains *why* something non-obvious is happening (a hidden constraint, a workaround, a subtle invariant). Don't restate what the code does.
- Tests live next to the layer they exercise (parser tests test parsers, walker tests test the walker). Keep fixtures small and hand-authored — no copy-pasted real-world dumps.

## High-leverage contribution areas

Particularly welcome:

1. **TMDL parser fixtures.** Found a TMDL construct that produces a warning or wrong AST? Add a minimal `.tmdl` snippet to `tests/fixtures/edge_cases/` with the expected behaviour. The parser is intentionally tolerant — every fixture grows the test suite.
2. **M lineage connectors.** Add detection for a connector you use (Snowflake, Databricks, Postgres, REST APIs, etc.) in `src/model_lenz/parsers/m_query.py`. Each connector is a small recognizer + a few tests in `test_m_lineage.py`.
3. **Frontend visual polish.** New node shapes, better edge routing, keyboard shortcuts, accessible focus rings.
4. **Real-world PBIP samples.** Anonymized PBIP folders we can include as fixtures help us catch regressions.

## What's *not* in scope

- Authoring or modifying PBIP files (Model Lenz is read-only by design — the README's FAQ states this explicitly).
- Re-implementing what Tabular Editor or DAX Studio already do well (DAX expression debugging, profile traces).
- Connecting to a live AS/Fabric XMLA endpoint (different problem; XMLA-based introspection might land in a separate sibling tool).

## Pull requests

- One topic per PR.
- Add or update tests for behavior changes.
- Include a one-paragraph description focused on the *why* (commit-message style).
- Keep frontend bundle changes (`src/model_lenz/frontend_dist/`) out of feature PRs — those are regenerated at release time.

## Releasing (maintainers only)

```bash
cd frontend && npm run build      # rebuild the SPA bundle
hatch build                       # produce sdist + wheel into dist/
# verify: pipx install dist/model_lenz-X.Y.Z-py3-none-any.whl
twine upload dist/*               # or use OIDC publish via GitHub Actions
git tag vX.Y.Z && git push --tags
```

Thanks for contributing.
