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
        <ViewToggle view={view} onChange={setView} />
        <DepthSelect depth={depth} onChange={setDepth} />
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

function ViewToggle({ view, onChange }: { view: "semantic" | "source"; onChange: (v: "semantic" | "source") => void }) {
  return (
    <div className="seg-toggle" role="tablist" aria-label="Label view">
      <button
        role="tab"
        aria-selected={view === "semantic"}
        className={view === "semantic" ? "active" : ""}
        onClick={() => onChange("semantic")}
      >
        Semantic
      </button>
      <button
        role="tab"
        aria-selected={view === "source"}
        className={view === "source" ? "active" : ""}
        onClick={() => onChange("source")}
      >
        Source
      </button>
    </div>
  );
}

function DepthSelect({ depth, onChange }: { depth: number; onChange: (d: number) => void }) {
  return (
    <label className="depth-select">
      <span>Depth</span>
      <select value={depth} onChange={(e) => onChange(Number(e.target.value))}>
        {[1, 2, 3, 4, 5].map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </label>
  );
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}
