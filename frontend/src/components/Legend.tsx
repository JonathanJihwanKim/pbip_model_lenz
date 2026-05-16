import { useState } from "react";

const ITEMS: { color: string; shape: string; label: string }[] = [
  { color: "var(--measure-fill)", shape: "rect", label: "Measure" },
  { color: "#1F6FEB", shape: "hex", label: "Fact" },
  { color: "#3FB68B", shape: "circle", label: "Dim" },
  { color: "#E1A938", shape: "circle", label: "Time" },
  { color: "#A0A4AB", shape: "diamond", label: "Param" },
  { color: "#D44C7B", shape: "stack", label: "Calc group" },
];

export function Legend() {
  const [open, setOpen] = useState(true);
  return (
    <div className={`legend ${open ? "open" : "closed"}`}>
      <button className="legend-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "−" : "Legend"}
      </button>
      {open && (
        <>
          <h4>Nodes</h4>
          <ul>
            {ITEMS.map((it) => (
              <li key={it.label}>
                <span
                  className={`legend-glyph shape-${it.shape}`}
                  style={{ background: it.color }}
                />
                {it.label}
              </li>
            ))}
          </ul>
          <h4>Edges</h4>
          <ul className="edge-legend">
            <li>
              <span className="edge-line solid" /> Direct DAX ref
            </li>
            <li>
              <span className="edge-line dashed" /> Active relationship
            </li>
            <li>
              <span className="edge-line dotted" /> Inactive relationship
            </li>
            <li>
              <span className="edge-line amber" /> Ambiguous path
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
