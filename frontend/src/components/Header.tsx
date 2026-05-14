import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

export function Header({ pbipPath }: { pbipPath: string }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const depth = useStore((s) => s.depth);
  const setDepth = useStore((s) => s.setDepth);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const summary = useStore((s) => s.summary);

  return (
    <header className="header">
      <div className="header-brand">
        <span className="header-logo" aria-hidden>
          <svg viewBox="0 0 24 24" width="20" height="20">
            <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <line x1="16" y1="16" x2="20" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="header-title">Model Lenz</span>
        <span className="header-pbip" title={pbipPath}>
          {summary?.name ?? shortPath(pbipPath)}
        </span>
      </div>

      <div className="header-search">
        <input
          type="search"
          placeholder="Search measures, tables, columns…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="header-controls">
        <ControlGroup label="Labels">
          <ViewToggle view={view} onChange={setView} />
        </ControlGroup>
        <ControlGroup label="Hops">
          <DepthSelect depth={depth} onChange={setDepth} />
          <DepthHelp />
        </ControlGroup>
        <button
          className="icon-btn"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </header>
  );
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="control-group">
      <span className="control-label">{label}</span>
      {children}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: "semantic" | "source";
  onChange: (v: "semantic" | "source") => void;
}) {
  return (
    <div
      className="seg-toggle"
      role="tablist"
      aria-label="Label view"
      title="Switch table labels between PBIP names (Semantic) and source-system names from Power Query (Source)"
    >
      <button
        role="tab"
        aria-selected={view === "semantic"}
        className={view === "semantic" ? "active" : ""}
        onClick={() => onChange("semantic")}
        title="Semantic — table names as they appear in Power BI Desktop / TMDL"
      >
        Semantic
      </button>
      <button
        role="tab"
        aria-selected={view === "source"}
        className={view === "source" ? "active" : ""}
        onClick={() => onChange("source")}
        title="Source — source-system table names extracted from the Power Query (M) code"
      >
        Source
      </button>
    </div>
  );
}

function DepthSelect({
  depth,
  onChange,
}: {
  depth: number;
  onChange: (d: number) => void;
}) {
  return (
    <select
      value={depth}
      onChange={(e) => onChange(Number(e.target.value))}
      title="How many relationship hops to traverse when finding indirect dependencies"
      aria-label="Indirect-dependency hops"
    >
      {[1, 2, 3, 4, 5].map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
    </select>
  );
}

function DepthHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="help-anchor" ref={ref}>
      <button
        className="help-icon"
        aria-label="What does Hops do?"
        onClick={() => setOpen((v) => !v)}
      >
        ⓘ
      </button>
      {open && (
        <div className="help-popover" role="tooltip">
          <h4>What "Hops" controls</h4>
          <p>
            How many relationship steps Model Lenz walks from the tables your
            measure directly references, looking for tables that <em>also</em>{" "}
            affect the result via filter propagation.
          </p>
          <ul>
            <li>
              <strong>1</strong> — only dimensions one hop from a directly-referenced fact.
            </li>
            <li>
              <strong>2</strong> <em>(recommended)</em> — catches typical
              snowflakes (e.g. <code>HFB → Range → fact</code>).
            </li>
            <li>
              <strong>3–5</strong> — deeper chains; usually noise.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}
