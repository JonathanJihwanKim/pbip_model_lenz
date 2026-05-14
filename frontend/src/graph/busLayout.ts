/**
 * Bus Layout positioning — Collin Tsui's "Bus Layout" technique adapted for
 * Model Lenz's force-graph component.
 *
 * Three positional zones:
 *   - DIMENSION TABLES occupy the TOP ROW (left → right).
 *   - FACT TABLES occupy the LEFT COLUMN (top → bottom).
 *   - DISCONNECTED TABLES (parameters, calc groups, standalones) sit in a
 *     right-side column, off to the side.
 *
 * Calendar/Time tables are placed first in the dim row (they relate to almost
 * every fact). Facts are sorted by relationship count (most connected first)
 * so the "spine" of the model reads top-down.
 *
 * Output: a `Map<nodeId, {x, y}>` you set as `fx`/`fy` on the simulation
 * nodes. The d3-force simulation then doesn't move them — the positions are
 * pinned. Pan/zoom still works.
 */

import type { Classification } from "../api/types";

export interface PositionableNode {
  id: string;
  label: string;
  classification: Classification | "measure";
}

export interface PositionableEdge {
  id: string;
  source: string;
  target: string;
}

export interface NodePosition {
  x: number;
  y: number;
  zone: "dim-row" | "fact-col" | "disconnected" | "hidden";
}

export interface BusLayoutOptions {
  /** Top-left of the dim row, in graph coordinates. */
  originX: number;
  originY: number;
  /** Horizontal spacing between dim cards. */
  dimSpacing: number;
  /** Vertical spacing between fact cards. */
  factSpacing: number;
  /** Card dimensions for the table-card visual. */
  cardWidth: number;
  cardHeight: number;
  /** Gap between the fact column and the dim row's first card. */
  factToFirstDimGap: number;
  /** Gap between dim row baseline and the first fact row. */
  dimToFirstFactGap: number;
}

export const DEFAULT_LAYOUT: BusLayoutOptions = {
  originX: 80,
  originY: 80,
  dimSpacing: 160,
  factSpacing: 70,
  cardWidth: 130,
  cardHeight: 28,
  factToFirstDimGap: 200,
  dimToFirstFactGap: 80,
};

const TIME_NAME_PATTERN = /\b(date|calendar|time)\b/i;

export function isDimZone(c: PositionableNode["classification"]): boolean {
  return c === "dim" || c === "time";
}

export function isFactZone(c: PositionableNode["classification"]): boolean {
  return c === "fact";
}

export function isDisconnectedZone(c: PositionableNode["classification"]): boolean {
  return c === "parameter" || c === "calculation_group" || c === "other";
}

/** Sort dims so Calendar/Time appear first; then by descending fact-rel count.
 *
 * When `focusedIds` is non-empty AND pack mode is on, focused dims jump to
 *  the front of their ordering bucket (after time tables) so the user sees
 *  every related dim packed at the left of the row, regardless of their
 *  default position. Within "focused" and "unfocused" subsets the original
 *  ordering rules still apply.
 */
function sortDims(
  nodes: PositionableNode[],
  factRelCount: Map<string, number>,
  focusedIds: Set<string> | null,
): PositionableNode[] {
  return [...nodes].sort((a, b) => {
    const aTime = a.classification === "time" || TIME_NAME_PATTERN.test(a.label);
    const bTime = b.classification === "time" || TIME_NAME_PATTERN.test(b.label);
    if (aTime !== bTime) return aTime ? -1 : 1;
    if (focusedIds) {
      const aFocus = focusedIds.has(a.id);
      const bFocus = focusedIds.has(b.id);
      if (aFocus !== bFocus) return aFocus ? -1 : 1;
    }
    const aCount = factRelCount.get(a.id) ?? 0;
    const bCount = factRelCount.get(b.id) ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    return a.label.localeCompare(b.label);
  });
}

/** Reposition snowflake dims (dims with no fact relationships but at least
 *  one dim↔dim edge) to sit immediately after their primary parent in the
 *  row. The "parent" is the dim they share the most edges with; ties resolved
 *  by parent label.
 *
 *  Process snowflakes in BFS order from primary dims so chains nest correctly
 *  (snowflake → snowflake → primary still ends up adjacent to the primary).
 *  Truly disconnected dims (no facts AND no dim-dim edges) keep their
 *  alphabetical tail position from the primary sort.
 */
function clusterSnowflakes(
  ordered: PositionableNode[],
  factRelCount: Map<string, number>,
  dimDimEdges: Map<string, Map<string, number>>,
): PositionableNode[] {
  const isSnowflake = (n: PositionableNode) =>
    (factRelCount.get(n.id) ?? 0) === 0 && (dimDimEdges.get(n.id)?.size ?? 0) > 0;

  const primaries = ordered.filter((n) => !isSnowflake(n));
  const snowflakes = ordered.filter((n) => isSnowflake(n));
  if (snowflakes.length === 0) return ordered;

  // Working list of placed dims in their final order. Start with the primary
  // ordering; we'll splice snowflakes in next to their parents.
  const placed: PositionableNode[] = [...primaries];
  const placedIds = new Set(placed.map((n) => n.id));
  const remaining = new Set(snowflakes.map((n) => n.id));

  // Helper: find the parent ID for a snowflake — the dim it shares the most
  // edges with that's already placed. Tie-break by parent label (stable).
  const pickParent = (sf: PositionableNode): string | null => {
    const links = dimDimEdges.get(sf.id);
    if (!links) return null;
    let best: { id: string; count: number; label: string } | null = null;
    for (const [otherId, count] of links) {
      if (!placedIds.has(otherId)) continue;
      const otherLabel = ordered.find((n) => n.id === otherId)?.label ?? "";
      if (
        !best ||
        count > best.count ||
        (count === best.count && otherLabel.localeCompare(best.label) < 0)
      ) {
        best = { id: otherId, count, label: otherLabel };
      }
    }
    return best?.id ?? null;
  };

  // BFS-ish: keep looping until no snowflake can be placed (chain done or
  // orphaned). Within a pass, place every snowflake whose parent is already
  // placed, in deterministic order.
  let progress = true;
  while (progress && remaining.size > 0) {
    progress = false;
    const placeable: Array<{ sf: PositionableNode; parentId: string }> = [];
    for (const id of remaining) {
      const sf = snowflakes.find((n) => n.id === id);
      if (!sf) continue;
      const parentId = pickParent(sf);
      if (parentId) placeable.push({ sf, parentId });
    }
    // Stable order so layout is deterministic across renders.
    placeable.sort((a, b) => a.sf.label.localeCompare(b.sf.label));
    for (const { sf, parentId } of placeable) {
      const parentIdx = placed.findIndex((n) => n.id === parentId);
      if (parentIdx === -1) continue;
      placed.splice(parentIdx + 1, 0, sf);
      placedIds.add(sf.id);
      remaining.delete(sf.id);
      progress = true;
    }
  }

  // Any snowflake whose parent never got placed (shouldn't happen, but
  // defensive) falls to the end alphabetically.
  if (remaining.size > 0) {
    const orphans = snowflakes
      .filter((n) => remaining.has(n.id))
      .sort((a, b) => a.label.localeCompare(b.label));
    placed.push(...orphans);
  }
  return placed;
}

/** Sort facts by descending dim-rel count, then alphabetical.
 *
 * Same focus-aware behavior as sortDims: focused facts pack to the top of
 *  the column when pack mode is on. */
function sortFacts(
  nodes: PositionableNode[],
  dimRelCount: Map<string, number>,
  focusedIds: Set<string> | null,
): PositionableNode[] {
  return [...nodes].sort((a, b) => {
    if (focusedIds) {
      const aFocus = focusedIds.has(a.id);
      const bFocus = focusedIds.has(b.id);
      if (aFocus !== bFocus) return aFocus ? -1 : 1;
    }
    const aCount = dimRelCount.get(a.id) ?? 0;
    const bCount = dimRelCount.get(b.id) ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Compute positions for visible nodes. Hidden nodes (not in `visibleIds`) get
 * a "hidden" zone marker but still receive coordinates (off-canvas) so the
 * simulation doesn't NaN out.
 *
 * `focusedIds` (optional): when non-null, dims/facts whose IDs are in the set
 *  pack to the front of their respective zones. Used by the "Pack related
 *  tables" toggle so the user can opt into selection-driven reordering.
 */
export function computeBusLayout(
  nodes: PositionableNode[],
  edges: PositionableEdge[],
  visibleIds: Set<string>,
  opts: BusLayoutOptions = DEFAULT_LAYOUT,
  focusedIds: Set<string> | null = null,
): Map<string, NodePosition> {
  // Count cross-zone relationships per visible node (used for sort weight).
  const dimRelCount = new Map<string, number>();
  const factRelCount = new Map<string, number>();
  // Snowflake adjacency: per-dim, count of edges to each *other* dim. Used
  // after the primary sort to slot snowflake children next to their parent.
  const dimDimEdges = new Map<string, Map<string, number>>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const bumpDimDim = (a: string, b: string) => {
    let m = dimDimEdges.get(a);
    if (!m) {
      m = new Map();
      dimDimEdges.set(a, m);
    }
    m.set(b, (m.get(b) ?? 0) + 1);
  };

  for (const e of edges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) continue;
    if (!visibleIds.has(s.id) || !visibleIds.has(t.id)) continue;
    if (isFactZone(s.classification) && isDimZone(t.classification)) {
      dimRelCount.set(s.id, (dimRelCount.get(s.id) ?? 0) + 1);
      factRelCount.set(t.id, (factRelCount.get(t.id) ?? 0) + 1);
    } else if (isDimZone(s.classification) && isFactZone(t.classification)) {
      factRelCount.set(s.id, (factRelCount.get(s.id) ?? 0) + 1);
      dimRelCount.set(t.id, (dimRelCount.get(t.id) ?? 0) + 1);
    } else if (isDimZone(s.classification) && isDimZone(t.classification) && s.id !== t.id) {
      bumpDimDim(s.id, t.id);
      bumpDimDim(t.id, s.id);
    }
  }

  const visible = nodes.filter((n) => visibleIds.has(n.id));
  let dims = sortDims(
    visible.filter((n) => isDimZone(n.classification)),
    factRelCount,
    focusedIds,
  );
  dims = clusterSnowflakes(dims, factRelCount, dimDimEdges);
  const facts = sortFacts(
    visible.filter((n) => isFactZone(n.classification)),
    dimRelCount,
    focusedIds,
  );
  const disconnected = visible
    .filter((n) => isDisconnectedZone(n.classification))
    .sort((a, b) => a.label.localeCompare(b.label));

  const positions = new Map<string, NodePosition>();

  const dimRowY = opts.originY;
  const factColX = opts.originX;
  const firstDimX = opts.originX + opts.factToFirstDimGap;
  const firstFactY = dimRowY + opts.dimToFirstFactGap;

  dims.forEach((n, i) => {
    positions.set(n.id, {
      x: firstDimX + i * opts.dimSpacing,
      y: dimRowY,
      zone: "dim-row",
    });
  });

  facts.forEach((n, i) => {
    positions.set(n.id, {
      x: factColX,
      y: firstFactY + i * opts.factSpacing,
      zone: "fact-col",
    });
  });

  const disconnectedX = firstDimX + Math.max(dims.length, 1) * opts.dimSpacing + 60;
  disconnected.forEach((n, i) => {
    positions.set(n.id, {
      x: disconnectedX,
      y: firstFactY + i * opts.factSpacing,
      zone: "disconnected",
    });
  });

  // Hidden nodes — park off-canvas so the simulation has coordinates but they
  // never render.
  for (const n of nodes) {
    if (positions.has(n.id)) continue;
    positions.set(n.id, { x: -10000, y: -10000, zone: "hidden" });
  }

  return positions;
}

/**
 * Compute the L-shaped path for an edge between two positioned nodes.
 *
 * Three flavours, picked by the zones at each end:
 *   - dim → fact (or fact → dim): two-segment L. Vertical leg at the dim's x,
 *     horizontal leg at the fact's y. Bend at (dimX, factY). Endpoint adjusted
 *     to attach to the fact's LEFT edge and the dim's BOTTOM edge.
 *   - fact → fact: rare anomaly. Straight horizontal/vertical line.
 *   - dim → dim (snowflake): rare anomaly. Straight line in the dim row.
 *   - anything else: straight line.
 *
 * Returns an SVG path "d" attribute.
 */
export function lShapedEdgePath(
  source: NodePosition,
  target: NodePosition,
  cardWidth: number,
  cardHeight: number,
): string {
  // Identify which end is the dim and which is the fact. The renderer passes
  // arbitrary source/target order; we normalize.
  let dim: NodePosition | null = null;
  let fact: NodePosition | null = null;

  if (source.zone === "dim-row" && target.zone === "fact-col") {
    dim = source;
    fact = target;
  } else if (source.zone === "fact-col" && target.zone === "dim-row") {
    dim = target;
    fact = source;
  }

  if (dim && fact) {
    const dimBottomY = dim.y + cardHeight / 2;
    const factLeftX = fact.x - cardWidth / 2;
    const factCenterY = fact.y;
    return `M ${dim.x},${dimBottomY} L ${dim.x},${factCenterY} L ${factLeftX},${factCenterY}`;
  }

  // Anomaly or off-grid: straight line between centers (the renderer can flag
  // these in a different colour to surface them).
  return `M ${source.x},${source.y} L ${target.x},${target.y}`;
}

/** Where to place the cardinality glyph for an edge. Returns null if N/A. */
export function cardinalityGlyphPosition(
  source: NodePosition,
  target: NodePosition,
  cardWidth: number,
  cardHeight: number,
  whichEnd: "dim" | "fact",
): { x: number; y: number } | null {
  let dim: NodePosition | null = null;
  let fact: NodePosition | null = null;
  if (source.zone === "dim-row" && target.zone === "fact-col") {
    dim = source;
    fact = target;
  } else if (source.zone === "fact-col" && target.zone === "dim-row") {
    dim = target;
    fact = source;
  }
  if (!dim || !fact) return null;
  if (whichEnd === "dim") {
    return { x: dim.x + 8, y: dim.y + cardHeight / 2 + 12 };
  }
  return { x: fact.x - cardWidth / 2 - 10, y: fact.y - 5 };
}

/** Decide if an edge is "anomalous" — dim↔dim or fact↔fact instead of dim↔fact. */
export function isAnomalousEdge(
  source: NodePosition,
  target: NodePosition,
): boolean {
  if (source.zone === target.zone && source.zone !== "hidden") return true;
  return false;
}
