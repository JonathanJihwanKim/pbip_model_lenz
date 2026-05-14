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

/** Sort dims so Calendar/Time appear first; then by descending fact-rel count. */
function sortDims(
  nodes: PositionableNode[],
  factRelCount: Map<string, number>,
): PositionableNode[] {
  return [...nodes].sort((a, b) => {
    const aTime = a.classification === "time" || TIME_NAME_PATTERN.test(a.label);
    const bTime = b.classification === "time" || TIME_NAME_PATTERN.test(b.label);
    if (aTime !== bTime) return aTime ? -1 : 1;
    const aCount = factRelCount.get(a.id) ?? 0;
    const bCount = factRelCount.get(b.id) ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    return a.label.localeCompare(b.label);
  });
}

/** Sort facts by descending dim-rel count, then alphabetical. */
function sortFacts(
  nodes: PositionableNode[],
  dimRelCount: Map<string, number>,
): PositionableNode[] {
  return [...nodes].sort((a, b) => {
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
 */
export function computeBusLayout(
  nodes: PositionableNode[],
  edges: PositionableEdge[],
  visibleIds: Set<string>,
  opts: BusLayoutOptions = DEFAULT_LAYOUT,
): Map<string, NodePosition> {
  // Count cross-zone relationships per visible node (used for sort weight).
  const dimRelCount = new Map<string, number>();
  const factRelCount = new Map<string, number>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

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
    }
  }

  const visible = nodes.filter((n) => visibleIds.has(n.id));
  const dims = sortDims(visible.filter((n) => isDimZone(n.classification)), factRelCount);
  const facts = sortFacts(visible.filter((n) => isFactZone(n.classification)), dimRelCount);
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
