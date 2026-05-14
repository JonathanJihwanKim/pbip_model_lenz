import { useMemo, useState } from "react";
import { ALL_CLASSIFICATIONS, useStore } from "../store";

type Tab = "measures" | "tables";

const CLASS_LABEL: Record<string, string> = {
  fact: "Fact",
  dim: "Dimension",
  parameter: "Parameter",
  time: "Time",
  calculation_group: "Calc group",
  other: "Other",
};

export function Sidebar() {
  const [tab, setTab] = useState<Tab>("measures");
  const measures = useStore((s) => s.measures);
  const tables = useStore((s) => s.tables);
  const search = useStore((s) => s.search);
  const classFilter = useStore((s) => s.classFilter);
  const toggleClassFilter = useStore((s) => s.toggleClassFilter);
  const selection = useStore((s) => s.selection);
  const selectMeasure = useStore((s) => s.selectMeasure);
  const selectTable = useStore((s) => s.selectTable);

  const measureGroups = useMemo(() => {
    const needle = search.toLowerCase();
    const filtered = measures.filter((m) =>
      !needle
        ? true
        : m.name.toLowerCase().includes(needle) ||
          (m.display_folder ?? "").toLowerCase().includes(needle) ||
          m.table.toLowerCase().includes(needle),
    );
    const groups = new Map<string, typeof filtered>();
    for (const m of filtered) {
      const key = m.display_folder ?? "(no folder)";
      const arr = groups.get(key) ?? [];
      arr.push(m);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [measures, search]);

  const filteredTables = useMemo(() => {
    const needle = search.toLowerCase();
    return tables
      .filter((t) => classFilter.has(t.classification))
      .filter((t) => (!needle ? true : t.name.toLowerCase().includes(needle)));
  }, [tables, search, classFilter]);

  return (
    <aside className="sidebar">
      <div className="seg-toggle sidebar-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "measures"}
          className={tab === "measures" ? "active" : ""}
          onClick={() => setTab("measures")}
        >
          Measures ({measures.length})
        </button>
        <button
          role="tab"
          aria-selected={tab === "tables"}
          className={tab === "tables" ? "active" : ""}
          onClick={() => setTab("tables")}
        >
          Tables ({tables.length})
        </button>
      </div>

      {tab === "tables" && (
        <div className="chip-row">
          {ALL_CLASSIFICATIONS.map((c) => (
            <button
              key={c}
              className={`chip ${classFilter.has(c) ? "on" : "off"}`}
              onClick={() => toggleClassFilter(c)}
              title={`Toggle ${CLASS_LABEL[c]} tables`}
            >
              {CLASS_LABEL[c]}
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-list">
        {tab === "measures" &&
          measureGroups.map(([folder, items]) => (
            <details key={folder} open>
              <summary>
                {folder} <span className="count">{items.length}</span>
              </summary>
              <ul>
                {items.map((m) => {
                  const active =
                    selection?.kind === "measure" &&
                    selection.name === m.name &&
                    selection.table === m.table;
                  return (
                    <li
                      key={`${m.table}::${m.name}`}
                      className={`list-row measure ${active ? "active" : ""}`}
                      onClick={() => selectMeasure(m.table, m.name)}
                      title={`${m.table} · ${m.name}`}
                    >
                      <span className="list-row-name">{m.name}</span>
                      <span className="list-row-meta">{m.table}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}

        {tab === "tables" && (
          <ul>
            {filteredTables.map((t) => {
              const active = selection?.kind === "table" && selection.name === t.name;
              return (
                <li
                  key={t.name}
                  className={`list-row table ${active ? "active" : ""}`}
                  onClick={() => selectTable(t.name)}
                  title={t.source_table ?? ""}
                >
                  <span className={`dot dot-${t.classification}`} />
                  <span className="list-row-name">{t.name}</span>
                  <span className="list-row-meta">
                    {t.measure_count ? `${t.measure_count} m` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
