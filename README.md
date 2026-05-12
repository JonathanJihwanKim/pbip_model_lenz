# Model Lenz

**Open-source PBIP analyzer.** Visualize how DAX measures in your Power BI model relate to fact and dimension tables — both directly (tables referenced inside the measure) and indirectly (tables reachable through the relationship graph). Plus, see Power Query lineage so you know exactly which source-system table feeds each PBIP table.

> Status: early development. M1 (parser + models + CLI `inspect`) is the current target.

## What it does

- Parses the TMDL semantic model in any PBIP folder.
- Indexes every measure, User Defined Function, calculated column, and calculation group.
- For each measure, identifies:
  - **Direct table refs** — tables explicitly named in the DAX expression.
  - **Indirect table refs** — tables reachable from direct refs by walking active relationships, with cardinality and crossfilter direction.
- For each table, surfaces Power Query lineage — both the PBIP-side (transformed) name and the source-system (e.g., BigQuery, Snowflake) name.
- Serves an interactive force-directed graph for exploration (M3 milestone).

## Audiences

- **Power BI developers** — see the true semantic dependency graph behind every measure.
- **Data engineers** — trace which source tables ultimately feed each measure.

## Install (planned)

```bash
pipx install model-lenz
model-lenz path/to/MyReport.SemanticModel
```

## Status

| Milestone | Scope                                              | Status      |
|-----------|----------------------------------------------------|-------------|
| M1        | Parser, models, classifier, CLI `inspect`          | In progress |
| M2        | Relationship walker, FastAPI backend               | Pending     |
| M3        | React + D3 frontend                                | Pending     |
| M4        | Packaging, CI, OSS launch                          | Pending     |

## License

MIT
