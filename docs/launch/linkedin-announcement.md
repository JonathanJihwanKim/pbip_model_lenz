# Launch announcement — LinkedIn draft

> Audience: Power BI / Fabric developers, data engineers, BI architects.
> Length target: ~260 words (LinkedIn long-form sweet spot).
> Tone: first-person discovery, concrete, ends with a question to invite comments.

---

I just open-sourced **Model Lenz** — a static analyzer for Power BI projects (PBIP).

Here's the problem it solves.

You're reading a measure like `Correction fault rate`. The DAX expression only mentions `Range` and `Business Unit`. You'd think those are the only tables it depends on. But the moment a user slices the report by `Time Period` or `Order Source`, the result changes.

That's because filters propagate through active relationships. Every fact table the measure transitively touches (through `[Other Measure]` references) drags in every dimension on its star.

The only way to see this today is to open Power BI Desktop, click into the model view, eyeball the arrows, and switch back to the formula bar. Repeat for every measure.

I wanted a tool that just shows me.

So I built one.

```
pipx install model-lenz
model-lenz serve path/to/MyReport.SemanticModel
```

Browser opens. Click any measure. **Solid edges** = direct table refs. **Dashed edges** = indirect tables reached through the relationship graph, with cardinality glyphs (`*:1`, `↔`) on each. `USERELATIONSHIP(...)` overrides honored. Ambiguous paths through multiple fact tables flagged in amber.

A *Semantic ↔ Source* toggle swaps node labels between PBIP table names and source-system names like `report_business_units.business_unit_cur_func_dim` — so the same graph reads naturally for BI developers (semantic view) and data engineers (lineage view).

Built for the new TMDL / PBIP source-control format. Pure static analysis — no XMLA, no live AS connection, no PBIX. Read-only by design.

🔗 github.com/JonathanJihwanKim/pbip_model_lenz · MIT licensed · contributions welcome

What's the part of your model you wish was more visible?

#PowerBI #Fabric #PBIP #TMDL #DAX #DataModeling #OpenSource #DevOps

---

## Variants

### Short form (≤ 100 words, for X / Twitter or BlueSky)

> Open-sourced Model Lenz — a static analyzer for Power BI PBIP projects.
>
> Click any DAX measure → see direct table refs (solid) AND indirect tables reached through active relationships (dashed, with cardinality). `USERELATIONSHIP` overrides honored. Source-system lineage included.
>
> `pipx install model-lenz` · MIT · github.com/JonathanJihwanKim/pbip_model_lenz

### Reply-thread starter (LinkedIn comments)

> Three things I'd love feedback on:
> 1. Which connectors should the M-query lineage detector cover next? (Snowflake / Databricks / REST?)
> 2. Should report-page usage (which visuals consume which measure) land in v0.2 or wait?
> 3. Anyone using `USERELATIONSHIP` in production — does the per-measure inactive-rel toggle match how you reason about it?

## Posting checklist

- [ ] Push the GitHub repo public first (link must resolve).
- [ ] Pin the announcement post to the profile.
- [ ] Reply to each comment with a concrete example from `examples/tiny_pbip` rather than a generic answer.
- [ ] Cross-post to the [Power BI subreddit](https://reddit.com/r/PowerBI) and [Fabric community](https://community.fabric.microsoft.com/) the day after, linking back to the LinkedIn post.
- [ ] Companion blog post on powerbimvp.com within the same week — use the `/blog` skill to draft once the repo is live.
