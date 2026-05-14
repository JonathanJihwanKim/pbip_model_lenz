# Model Lenz

**Open-source PBIP analyzer.** Point it at a Power BI project folder, click any DAX measure, and see exactly what tables it depends on — both directly (referenced in the expression) and indirectly (reached through the relationship graph) — alongside the source-system lineage of every table.

> Status: alpha. Core analysis pipeline (parser → walker → API → SPA) is complete. Packaging and docs are stabilizing for a first public release.

```bash
uv tool install model-lenz       # or: pipx install model-lenz
model-lenz demo                  # opens a built-in 5-table demo in your browser
```

That's it. **Nothing to clone, nothing to download from GitHub.** The wheel includes the CLI, a pre-built React UI, and a tiny demo PBIP — all you need to see the tool in action.

To analyse your own Power BI project:

```bash
model-lenz serve path/to/MyReport-pbip-folder    # the folder containing MyReport.pbip
```

(See [What path do I point at?](#what-path-do-i-point-at) below for the exact folder.)

---

## What it does

When a Power BI developer writes `Total Sales = SUM ( Sales[Amount] )`, the measure technically references only `Sales`. But anyone slicing the report by `Customer` or `Date` is also affecting the result, because filters propagate through active relationships. **Model Lenz makes those implicit dependencies explicit.**

For every measure (including User Defined Functions, calculated columns, and calculation groups), it shows:

- **Direct table refs** — parsed from the DAX expression itself.
- **Referenced measures** — DAX `[Other Measure]` calls, resolved transitively so you see the *real* underlying tables.
- **Indirect tables** — every table reachable from the direct refs by walking *active* relationships, with cardinality (`*:1`, `1:*`), crossfilter direction (single / `↔`), and inactive-rel handling via `USERELATIONSHIP(…)` hints.
- **Source lineage** — for each PBIP table, the source-system table it ultimately loads from (e.g. `report_sales.fact_orders_combined` on BigQuery), with confidence labels.

There's a global **Semantic ↔ Source** toggle so the same graph reads naturally for both audiences:

- **Power BI developers** see PBIP-side table names — the model as it appears in Desktop.
- **Data engineers** see source-system identifiers — the model as it appears in the warehouse.

---

## Install

You only need Python 3.10+. Pick whichever installer you have — they all end with the same `model-lenz` command on your PATH.

> **Do I need to clone the repo?** **No.** Installing from PyPI gives you the full tool, including the bundled `model-lenz demo`. Clone the repo only if you want to contribute code or read the source.

### Windows (PowerShell) — copy-paste

```powershell
# 1. Install uv (one-time, ~10 seconds)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 2. Install Model Lenz as a global tool
uv tool install model-lenz

# 3. Run it — point at the PBIP root folder (the one containing the .pbip file)
model-lenz serve "C:\projects\Sales"
```

If you already have `uv`, only step 2 is needed. After `uv tool install`, **open a new PowerShell window** so the PATH update is picked up.

### macOS / Linux — copy-paste

```bash
# Option A — using uv (fastest)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install model-lenz

# Option B — using pipx (if you already have it)
pipx install model-lenz

# Run it — point at the PBIP root folder (the one containing the .pbip file)
model-lenz serve path/to/Sales
```

### Already have Python and just want it in your environment?

```bash
pip install model-lenz
```

(Not recommended — `uv tool` / `pipx` keep `model-lenz` isolated from your project Pythons.)

### From source (contributors)

```bash
git clone https://github.com/JonathanJihwanKim/pbip_model_lenz
cd pbip_model_lenz
uv pip install -e ".[dev]"
cd frontend && npm install && npm run build && cd ..
model-lenz serve examples/tiny_pbip
```

### What path do I point at?

PBIP saves your project as a folder tree:

```
Sales\                                      ← THIS is the PBIP root — point here
  Sales.pbip                                ← the project file Power BI Desktop opens
  Sales.SemanticModel\                      ← the model (TMDL)
    definition\
      tables\*.tmdl
      relationships.tmdl
      expressions.tmdl
  Sales.Report\                             ← the report (PBIR, JSON)
    definition\
      pages\*\visuals\*\visual.json
```

`model-lenz serve` accepts any of these three paths and they all parse the same model:

| Path you pass                                      | Works? | Notes                                     |
|----------------------------------------------------|--------|--------------------------------------------|
| `Sales`  *(the PBIP root, containing `Sales.pbip`)*| ✅ recommended | Future v0.2 PBIR scanning needs this folder so it can also find `Sales.Report\`. |
| `Sales\Sales.SemanticModel`                         | ✅      | Skips report-side discovery.               |
| `Sales\Sales.SemanticModel\definition`              | ✅      | Same as above.                             |

Quoting: on Windows wrap the path in double quotes if it contains spaces:

```powershell
model-lenz serve "C:\My Reports\Q4 Sales"
```

---

## CLI

```text
$ model-lenz --help

Usage: model-lenz [OPTIONS] COMMAND [ARGS]...

  Open-source PBIP analyzer.

Commands:
  demo      Serve the bundled tiny demo PBIP — no path or clone needed.
  inspect   Parse a PBIP and print the parsed model as JSON.
  serve     Start the local web server and open the model in a browser.
  summary   Print a one-screen human summary of the parsed model.
  version   Print the Model Lenz version.
```

- `model-lenz demo` — the fastest way to see what the tool does. No path, no clone — uses a bundled 5-table model.
- `model-lenz serve <pbip>` — the main experience on your own model: local web app + interactive graph.
- `model-lenz summary <pbip>` — counts, classification breakdown, lineage confidence — useful for CI.
- `model-lenz inspect <pbip> -o model.json` — full parsed model as JSON. Plug it into other tools.

---

## Try it in 30 seconds (no clone needed)

```bash
uv tool install model-lenz   # or: pipx install model-lenz
model-lenz demo              # opens the bundled demo in your browser
```

The bundled demo is a hand-authored 5-table model (Date, Customer, Product, Sales_fct, Measure) with seven measures — including a `USERELATIONSHIP` example, a transitive measure chain (`Margin% → Margin → [Total Sales]/[Total Cost]`), and a SQL-native-query lineage. Click *Margin %* in the left sidebar and watch the dashed edges light up across all three dimensions, even though the expression itself only mentions other measures.

To run against your own model instead:

```bash
model-lenz serve "C:\projects\Sales"   # any PBIP root folder on your disk
```

### Troubleshooting

- **"`pipx` is not recognized" on Windows.** Use `uv tool install` instead (see Install section above) — `uv` is a single-binary installer and doesn't need pip.
- **`model-lenz` isn't found after install.** Open a *new* terminal window. The installer added a directory (`~/.local/bin` on Linux/macOS, `%USERPROFILE%\.local\bin` on Windows) to your PATH, but existing terminals don't see it until they restart.
- **Browser doesn't open automatically.** It prints the URL — copy `http://127.0.0.1:<port>/` into your browser. Add `--no-browser` to suppress the auto-open.
- **"Address already in use".** Pick a port: `model-lenz serve … --port 8765`.

---

## Features

| | |
|---|---|
| **PBIP format** | TMDL semantic model only (no legacy `.pbix` in v1). Reads `definition/tables/*.tmdl`, `definition/relationships.tmdl`, `definition/expressions.tmdl`, `definition/functions/*.tmdl`. |
| **DAX coverage** | Measures · User Defined Functions (preview syntax) · calculated columns · calculation groups · `USERELATIONSHIP` hints · table-arg DAX functions (FILTER, ALL, CALCULATETABLE, …) |
| **Power Query** | Per-partition lineage. Connectors: `GoogleBigQuery`, `Sql.Database`, `Snowflake`, `AzureStorage`, `Csv.Document`, `Excel.Workbook`, `Web.Contents`, `SharePoint`, `OData`, `Json.Document`. Resolves cross-query references to surface the deepest known source. |
| **Relationships** | Active and inactive, all four cardinalities, single and bidirectional crossfilter. Walker honors filter-propagation direction and re-enables inactive relationships when a measure declares `USERELATIONSHIP(…)`. |
| **Classification** | Heuristic fact / dim / parameter / time / calc-group / other, configurable via a `model_lenz.toml` in the PBIP root. |
| **Distribution** | Single `pipx`-installable Python wheel; frontend bundle is included (no Node required at install time). |
| **Read-only** | Model Lenz never modifies your PBIP files. |

---

## Architecture (for contributors)

```
                           ┌───────────────────┐
   .tmdl, .pq files  ───▶  │  Python backend   │  ◀── HTTP /api  ───┐
   in your PBIP            │  parsers /        │                    │
                           │  analyzers /      │   ┌──────────────────┐
                           │  FastAPI          │   │ React + Vite SPA │
                           └───────────────────┘   │ D3 force graph   │
                                  ▲                │ Zustand store    │
                                  │                └──────────────────┘
                           model-lenz CLI
                          (typer + uvicorn)
```

- **Parser layer** ([`src/model_lenz/parsers/`](src/model_lenz/parsers/)) — TMDL block parser (indent-aware state machine), DAX reference extractor (hand-rolled tokenizer), M-query lineage extractor (recursive descent with native-SQL parsing).
- **Analysis layer** ([`src/model_lenz/analyzers/`](src/model_lenz/analyzers/)) — relationship graph + indirect-dep walker on NetworkX, transitive measure resolver, fact/dim classifier.
- **JSON contract** ([`src/model_lenz/models/`](src/model_lenz/models/)) — Pydantic models that the API serializes and the frontend mirrors as TypeScript types.
- **HTTP API** ([`src/model_lenz/api/routes.py`](src/model_lenz/api/routes.py)) — FastAPI; full OpenAPI at `/docs`.
- **Frontend** ([`frontend/`](frontend/)) — React 18 + Vite + TypeScript; force graph in D3 directly (no Cytoscape); Zustand for state.

See [CONTRIBUTING.md](CONTRIBUTING.md) for a deeper tour.

---

## FAQ

**Does Model Lenz modify my PBIP?**
No. It only reads. All processing is in-memory; nothing is written back to the model files.

**Does it need an XMLA endpoint or live AS connection?**
No. It works purely from the PBIP source files on disk. Source control is the only prerequisite — no Power BI Service or Tabular Editor required.

**What about legacy `.pbix` files?**
Not supported in v1. `.pbix` is a zipped legacy bundle; the TMDL-based PBIP format is the going-forward source-of-truth and supersedes it. If there's strong demand, a `.pbix` adapter could land in a later release.

**Does it execute DAX or run queries?**
No. It's purely static analysis — lexical parsing of expressions, walking the relationship graph. Nothing connects to a real data source.

**Why isn't the indirect-table list deeper by default?**
Default walk depth is 2 hops, which captures the typical star or snowflake. Adjust via the depth selector in the header or `?depth=` on the API.

---

## Roadmap

- **v0.2** — Calculation groups in the graph view; calc-column visualizations; export-to-Mermaid.
- **v0.3** — Report-layer (PBIR) measure usage: which pages and visuals consume each measure.
- **v0.4** — DMV / XMLA mode: optional connection to a deployed semantic model for runtime-only metadata.
- Later — `.pbix` adapter, perspective-aware views, sub-graph export for documentation.

Have something else you'd like to see? Open a [feature request](https://github.com/JonathanJihwanKim/pbip_model_lenz/issues/new?template=feature_request.yml).

---

## License

[MIT](LICENSE) — use it commercially, fork it, ship it inside whatever you're building. Attribution appreciated but not required.
