import { useStore } from "../store";

export function PinnedBar() {
  const pinned = useStore((s) => s.pinned);
  const unpin = useStore((s) => s.unpinSelection);
  const selectMeasure = useStore((s) => s.selectMeasure);
  const selectTable = useStore((s) => s.selectTable);

  if (pinned.length === 0) return null;

  return (
    <div className="pinned-bar">
      <span className="muted">Pinned:</span>
      {pinned.map((p) => (
        <button
          key={`${p.kind}:${p.table}:${p.name}`}
          className="chip on solid"
          onClick={() => {
            if (p.kind === "measure" && p.table) selectMeasure(p.table, p.name);
            else selectTable(p.name);
          }}
        >
          {p.name}
          <span
            className="chip-x"
            onClick={(e) => {
              e.stopPropagation();
              unpin(p);
            }}
          >
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
