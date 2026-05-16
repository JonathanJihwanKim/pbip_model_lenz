/**
 * Bus Layout positioning — Collin Tsui's "Bus Layout" technique adapted for
 * Model Lenz's force-graph component.
 *
 * Two orientations:
 *   - "dims-row" (default): dimensions occupy the TOP ROW, facts the LEFT
 *     COLUMN. The Bus Layout convention.
 *   - "dims-col" (swapped): dimensions occupy the LEFT COLUMN, facts the TOP
 *     ROW. Picked automatically by the caller when the visible subgraph is
 *     dim-heavy (e.g. 11 dims + 2 facts) so a wide-thin bbox doesn't force
 *     auto-fit to shrink the cards into illegibility.
 *
 * Calendar/Time tables are placed first in the dim row/column (they relate
 * to almost every fact). Facts are sorted by relationship count (most
 * connected first) so the "spine" of the model reads first-to-last.
 *
 * Output: a `Map<nodeId, {x, y, zone}>` consumed by ForceGraph. Pan/zoom
 * still works; positions are pinned.
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

export type Orientation = "dims-row" | "dims-col";

export interface NodePosition {
  x: number;
  y: number;
  /** Which positional zone this node lives in. The L-shape edge logic
   *  reads both endpoints' zones to pick the right bend direction; the
   *  zone names encode orientation so downstream helpers don't need to
   *  thread the orientation parameter through. */
  zone:
    | "dim-row"
    | "dim-col"
    | "fact-row"
    | "fact-col"
    | "disconnected"
    | "hidden";
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
  cardHeight: 36,
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
 *  pack to the front of their respective zones.
 *
 * `orientation`: "dims-row" (default) puts dims on top, facts on left.
 *  "dims-col" swaps them — used when the visible subgraph is dim-heavy so
 *  auto-fit doesn't squash the cards.
 */
export function computeBusLayout(
  nodes: PositionableNode[],
  edges: PositionableEdge[],
  visibleIds: Set<string>,
  opts: BusLayoutOptions = DEFAULT_LAYOUT,
  focusedIds: Set<string> | null = null,
  orientation: Orientation = "dims-row",
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

  // Spacing constants are named for the DEFAULT orientation. In dims-col
  // mode the dim axis becomes vertical (use the tighter factSpacing) and
  // the fact axis becomes horizontal (use the wider dimSpacing).
  const rowSpacing = opts.dimSpacing; // for whatever class lives in the row
  const colSpacing = opts.factSpacing; // for whatever class lives in the column

  const rowY = opts.originY;
  const colX = opts.originX;
  const rowStartX = opts.originX + opts.factToFirstDimGap;
  const colStartY = rowY + opts.dimToFirstFactGap;

  if (orientation === "dims-row") {
    dims.forEach((n, i) => {
      positions.set(n.id, {
        x: rowStartX + i * rowSpacing,
        y: rowY,
        zone: "dim-row",
      });
    });
    facts.forEach((n, i) => {
      positions.set(n.id, {
        x: colX,
        y: colStartY + i * colSpacing,
        zone: "fact-col",
      });
    });
  } else {
    // dims-col: dims become the left column, facts become the top row.
    dims.forEach((n, i) => {
      positions.set(n.id, {
        x: colX,
        y: colStartY + i * colSpacing,
        zone: "dim-col",
      });
    });
    facts.forEach((n, i) => {
      positions.set(n.id, {
        x: rowStartX + i * rowSpacing,
        y: rowY,
        zone: "fact-row",
      });
    });
  }

  // Disconnected zone parks to the right of whatever's in the top row.
  const rowExtent =
    orientation === "dims-row" ? dims.length : facts.length;
  const disconnectedX = rowStartX + Math.max(rowExtent, 1) * rowSpacing + 60;
  disconnected.forEach((n, i) => {
    positions.set(n.id, {
      x: disconnectedX,
      y: colStartY + i * colSpacing,
      zone: "disconnected",
    });
  });

  // Hidden nodes — park off-canvas so downstream code has coordinates but
  // they never render.
  for (const n of nodes) {
    if (positions.has(n.id)) continue;
    positions.set(n.id, { x: -10000, y: -10000, zone: "hidden" });
  }

  return positions;
}

function isRowZone(z: NodePosition["zone"]): boolean {
  return z === "dim-row" || z === "fact-row";
}
function isColZone(z: NodePosition["zone"]): boolean {
  return z === "fact-col" || z === "dim-col";
}
function isDimGridZone(z: NodePosition["zone"]): boolean {
  return z === "dim-row" || z === "dim-col";
}
function isFactGridZone(z: NodePosition["zone"]): boolean {
  return z === "fact-col" || z === "fact-row";
}

/** Identify which end is the dim and which is the fact, regardless of which
 *  one was passed as source vs target and regardless of orientation. Returns
 *  null if the edge isn't a clean dim↔fact (e.g. snowflake dim↔dim, anomaly,
 *  or one endpoint hidden). */
function classifyEnds(
  source: NodePosition,
  target: NodePosition,
): { dim: NodePosition; fact: NodePosition } | null {
  if (isDimGridZone(source.zone) && isFactGridZone(target.zone)) {
    return { dim: source, fact: target };
  }
  if (isFactGridZone(source.zone) && isDimGridZone(target.zone)) {
    return { dim: target, fact: source };
  }
  return null;
}

/**
 * Compute the L-shaped path for an edge between two positioned nodes.
 *
 * Two valid shapes, picked by which axis the cards live on:
 *   - dim in ROW (top), fact in COL (left): vertical leg at dim's x,
 *     horizontal leg at fact's y. Bend at (dimX, factY). Endpoint attaches
 *     to fact's LEFT edge, start at dim's BOTTOM edge.
 *   - dim in COL (left), fact in ROW (top): horizontal leg at dim's y,
 *     vertical leg at fact's x. Bend at (factX, dimY). Endpoint attaches
 *     to fact's BOTTOM edge, start at dim's RIGHT edge.
 *
 * Anomalies (dim↔dim, fact↔fact, hidden endpoints) get a straight line.
 */
export function lShapedEdgePath(
  source: NodePosition,
  target: NodePosition,
  cardWidth: number,
  cardHeight: number,
): string {
  const ends = classifyEnds(source, target);
  if (!ends) {
    return `M ${source.x},${source.y} L ${target.x},${target.y}`;
  }
  const { dim, fact } = ends;

  if (dim.zone === "dim-row") {
    // Default orientation: dim on top, fact on left.
    const dimBottomY = dim.y + cardHeight / 2;
    const factLeftX = fact.x - cardWidth / 2;
    const factCenterY = fact.y;
    return `M ${dim.x},${dimBottomY} L ${dim.x},${factCenterY} L ${factLeftX},${factCenterY}`;
  }
  // Swapped orientation: dim on left, fact on top.
  const dimRightX = dim.x + cardWidth / 2;
  const factCenterX = fact.x;
  const factBottomY = fact.y + cardHeight / 2;
  return `M ${dimRightX},${dim.y} L ${factCenterX},${dim.y} L ${factCenterX},${factBottomY}`;
}

/** Where to place the cardinality glyph for an edge. Returns null if N/A.
 *  Glyph sits just inside each card on the edge that the L-shape attaches to,
 *  so "1" reads next to the dim and "*" next to the fact in both orientations. */
export function cardinalityGlyphPosition(
  source: NodePosition,
  target: NodePosition,
  cardWidth: number,
  cardHeight: number,
  whichEnd: "dim" | "fact",
): { x: number; y: number } | null {
  const ends = classifyEnds(source, target);
  if (!ends) return null;
  const { dim, fact } = ends;

  if (dim.zone === "dim-row") {
    if (whichEnd === "dim") {
      return { x: dim.x + 8, y: dim.y + cardHeight / 2 + 12 };
    }
    return { x: fact.x - cardWidth / 2 - 10, y: fact.y - 5 };
  }
  // dims-col: glyph for the dim sits to the right of its card; for the fact,
  // just below it.
  if (whichEnd === "dim") {
    return { x: dim.x + cardWidth / 2 + 10, y: dim.y - 5 };
  }
  return { x: fact.x + 8, y: fact.y + cardHeight / 2 + 12 };
}

/** Decide if an edge is "anomalous" — dim↔dim or fact↔fact instead of
 *  dim↔fact. Both orientations need this check; the predicate is now
 *  expressed in terms of "dim grid zone" and "fact grid zone" so it works
 *  for both. */
export function isAnomalousEdge(
  source: NodePosition,
  target: NodePosition,
): boolean {
  if (source.zone === "hidden" || target.zone === "hidden") return false;
  if (isDimGridZone(source.zone) && isDimGridZone(target.zone)) return true;
  if (isFactGridZone(source.zone) && isFactGridZone(target.zone)) return true;
  return false;
}

// Re-exports (used by ForceGraph for zone-label positioning decisions).
export { isRowZone, isColZone };
