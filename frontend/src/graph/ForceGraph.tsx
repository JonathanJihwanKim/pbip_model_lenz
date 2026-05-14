/**
 * Bus Layout + Spotlight — the canvas component.
 *
 * Layout is deterministic (no force simulation). Dim/time tables go in the
 * top row, fact tables in the left column, disconnected tables in the right
 * column. Relationship edges are drawn as L-shaped paths with right-angle
 * bends, with cardinality glyphs (1 near dim, * near fact) and a filter
 * arrow always pointing toward the fact.
 *
 * Spotlight: when a measure is selected, a synthetic "measure" node appears
 * in the top-left corner (Tsui's "measures table" position) with solid edges
 * to every direct table reference. Tables NOT on the measure's dependency
 * path drop to ~15% opacity. Edges along the path are bolded; others fade.
 *
 * Pan/zoom via d3-zoom. Click a node to select it. Right-click to pin.
 */

import { useEffect, useMemo, useRef } from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
// Side-effect import: extends d3-selection with .transition() so the
// auto-fit zoom call below can animate. d3-zoom calls .transition() on
// selections internally, but the method only exists once d3-transition has
// been loaded.
import "d3-transition";

import { useStore } from "../store";
import type { Cardinality, RelationshipItem } from "../api/types";
import {
  cardinalityGlyphPosition,
  computeBusLayout,
  DEFAULT_LAYOUT,
  isAnomalousEdge,
  isDimZone,
  isFactZone,
  lShapedEdgePath,
  type NodePosition,
  type PositionableNode,
} from "./busLayout";

const CARD_W = DEFAULT_LAYOUT.cardWidth;
const CARD_H = DEFAULT_LAYOUT.cardHeight;

interface NodeView extends PositionableNode {
  sourceLabel: string | null;
  position: NodePosition;
  visible: boolean;
}

interface EdgeView {
  id: string;
  source: NodeView;
  target: NodeView;
  rel: RelationshipItem;
  path: string;
  anomalous: boolean;
  visible: boolean;
}

const SYNTHETIC_MEASURE_ID = "__synthetic_measure__";

export function ForceGraph() {
  const tables = useStore((s) => s.tables);
  const relationships = useStore((s) => s.relationships);
  const view = useStore((s) => s.view);
  const classFilter = useStore((s) => s.classFilter);
  const selection = useStore((s) => s.selection);
  const measureGraph = useStore((s) => s.measureGraph);
  const selectTable = useStore((s) => s.selectTable);
  const pinSelection = useStore((s) => s.pinSelection);
  const packMode = useStore((s) => s.packMode);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Visibility set: classFilter + selection-driven reveal of disconnected
  // tables that the selected measure happens to touch.
  const visibleNodeIds = useMemo(() => {
    const visible = new Set<string>();
    for (const t of tables) {
      if (classFilter.has(t.classification)) visible.add(`t:${t.name}`);
    }
    if (selection?.kind === "measure" && measureGraph) {
      for (const name of measureGraph.direct_tables) visible.add(`t:${name}`);
      for (const it of measureGraph.indirect_tables) visible.add(`t:${it.table}`);
    }
    if (selection?.kind === "table") {
      visible.add(`t:${selection.name}`);
    }
    return visible;
  }, [tables, classFilter, selection, measureGraph]);

  // Set of node IDs the current selection "relates to" (direct + indirect
  // tables of a measure, or just the table itself). Drives both the Pack
  // toggle's reordering and the auto-fit viewport calculation.
  const relatedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (selection?.kind === "measure" && measureGraph) {
      for (const name of measureGraph.direct_tables) ids.add(`t:${name}`);
      for (const it of measureGraph.indirect_tables) ids.add(`t:${it.table}`);
    } else if (selection?.kind === "table") {
      ids.add(`t:${selection.name}`);
    }
    return ids;
  }, [selection, measureGraph]);

  const layout = useMemo(() => {
    const tableLookup = new Map(tables.map((t) => [t.name, t]));

    const nodes: PositionableNode[] = tables.map((t) => ({
      id: `t:${t.name}`,
      label: t.name,
      classification: t.classification,
    }));

    const edges = relationships
      .filter((r) => tableLookup.has(r.from_table) && tableLookup.has(r.to_table))
      .map((r) => ({
        id: `r:${r.id}`,
        source: `t:${r.from_table}`,
        target: `t:${r.to_table}`,
        rel: r,
      }));

    // Pack mode only kicks in when there's something to pack against.
    const focused = packMode && relatedNodeIds.size > 0 ? relatedNodeIds : null;
    const positions = computeBusLayout(nodes, edges, visibleNodeIds, DEFAULT_LAYOUT, focused);

    const nodeViews: NodeView[] = tables.map((t) => {
      const id = `t:${t.name}`;
      const pos = positions.get(id)!;
      return {
        id,
        label: t.name,
        classification: t.classification,
        sourceLabel: t.source_table,
        position: pos,
        visible: pos.zone !== "hidden",
      };
    });
    const nodeById = new Map(nodeViews.map((n) => [n.id, n]));

    const edgeViews: EdgeView[] = edges
      .map((e) => {
        const s = nodeById.get(e.source)!;
        const t = nodeById.get(e.target)!;
        const path = lShapedEdgePath(s.position, t.position, CARD_W, CARD_H);
        return {
          id: e.id,
          source: s,
          target: t,
          rel: e.rel,
          path,
          anomalous: isAnomalousEdge(s.position, t.position),
          visible: s.visible && t.visible,
        };
      });

    return { nodes: nodeViews, edges: edgeViews, positions };
  }, [tables, relationships, visibleNodeIds, packMode, relatedNodeIds]);

  // Spotlight: when a measure is selected and its graph is loaded, build
  // (a) a synthetic "measure" node in the top-left corner, and
  // (b) solid direct-ref edges from it to each direct-ref table.
  const spotlight = useMemo(() => {
    if (selection?.kind !== "measure" || !measureGraph) return null;
    const directIds = new Set(measureGraph.direct_tables.map((n) => `t:${n}`));
    const indirectIds = new Set(measureGraph.indirect_tables.map((it) => `t:${it.table}`));
    const highlightedRelIds = new Set<string>();
    for (const it of measureGraph.indirect_tables) {
      for (const path of it.paths) {
        for (const hop of path.hops) {
          highlightedRelIds.add(`r:${hop.relationship_id}`);
        }
      }
    }
    // Place the synthetic measure node in the top-left corner — Tsui's
    // "measures" table position. We use the layout's origin minus a small
    // offset so it sits in the corner.
    const measureNode = {
      id: SYNTHETIC_MEASURE_ID,
      label: measureGraph.measure.name,
      x: DEFAULT_LAYOUT.originX,
      y: DEFAULT_LAYOUT.originY,
    };
    // Direct-ref edges go from the measure node to each direct table card's
    // top-left corner (rough approximation — use a curve that doesn't fight
    // the bus L-shapes).
    const directEdges = measureGraph.direct_tables
      .map((tname) => {
        const id = `t:${tname}`;
        const t = layout.nodes.find((n) => n.id === id);
        if (!t) return null;
        const fromX = measureNode.x + CARD_W / 2;
        const fromY = measureNode.y + CARD_H / 2 + 4;
        const toX = t.position.x - CARD_W / 2;
        const toY = t.position.y;
        // Smooth Bezier curve so direct refs don't compete with the L-shapes.
        const midX = (fromX + toX) / 2;
        return {
          id: `direct:${tname}`,
          path: `M ${fromX},${fromY} C ${midX},${fromY} ${midX},${toY} ${toX},${toY}`,
        };
      })
      .filter((e): e is { id: string; path: string } => e !== null);

    return {
      measureNode,
      directIds,
      indirectIds,
      highlightedRelIds,
      directEdges,
    };
  }, [selection, measureGraph, layout]);

  // Pan/zoom setup (run once).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z: ZoomBehavior<SVGSVGElement, unknown> = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (e) => {
        select(svg).select<SVGGElement>("g.viewport").attr("transform", e.transform.toString());
      });
    select(svg).call(z);
    zoomRef.current = z;
  }, []);

  // Auto-fit viewport when a measure is selected (or selection changes).
  // Computes the bounding box of the synthetic measure node + every related
  // table card, then transitions the zoom transform so that box fills the
  // canvas with padding. User pan/zoom after fit is preserved until the next
  // selection change.
  useEffect(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    if (!selection) return;
    if (selection.kind === "measure" && !measureGraph) return; // wait for load

    const positioned = layout.nodes.filter(
      (n) => n.visible && (relatedNodeIds.has(n.id) || (selection.kind === "table" && n.label === selection.name)),
    );
    // Include the synthetic measure node so the corner anchor is in frame.
    const points: Array<{ x: number; y: number }> = positioned.map((n) => ({
      x: n.position.x,
      y: n.position.y,
    }));
    if (selection.kind === "measure") {
      points.push({ x: DEFAULT_LAYOUT.originX, y: DEFAULT_LAYOUT.originY });
    }
    if (points.length === 0) return;

    const pad = CARD_W; // breathing room around the bbox
    const minX = Math.min(...points.map((p) => p.x)) - pad;
    const maxX = Math.max(...points.map((p) => p.x)) + pad;
    const minY = Math.min(...points.map((p) => p.y)) - pad;
    const maxY = Math.max(...points.map((p) => p.y)) + pad;
    const w = maxX - minX;
    const h = maxY - minY;

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Scale to fit; clamp to the configured zoom range.
    const scale = Math.min(rect.width / w, rect.height / h, 1.2);
    const clampedScale = Math.max(0.2, Math.min(4, scale));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = rect.width / 2 - cx * clampedScale;
    const ty = rect.height / 2 - cy * clampedScale;

    select(svg)
      .transition()
      .duration(550)
      .call(z.transform, zoomIdentity.translate(tx, ty).scale(clampedScale));
  }, [selection, measureGraph, relatedNodeIds, layout]);

  // Reset cursor styling on mount; nothing else needs imperative DOM.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {});
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function showTooltip(e: React.MouseEvent, n: NodeView) {
    const el = tooltipRef.current;
    if (!el) return;
    const semantic = n.label;
    const source = n.sourceLabel;
    el.innerHTML = `
      <div class="tt-name">${escape(semantic)}</div>
      ${source ? `<div class="tt-source">${escape(source)}</div>` : ""}
      <div class="tt-class">${n.classification}</div>
    `;
    el.style.opacity = "1";
    el.style.left = `${e.clientX + 14}px`;
    el.style.top = `${e.clientY + 14}px`;
  }

  function hideTooltip() {
    const el = tooltipRef.current;
    if (el) el.style.opacity = "0";
  }

  // Compute per-node opacity once for the current render.
  function nodeOpacity(n: NodeView): number {
    if (!n.visible) return 0;
    if (!spotlight) return 1;
    if (spotlight.directIds.has(n.id) || spotlight.indirectIds.has(n.id)) return 1;
    return 0.18;
  }

  function edgeOpacity(e: EdgeView): number {
    if (!e.visible) return 0;
    if (!spotlight) return e.anomalous ? 0.7 : 0.4;
    if (spotlight.highlightedRelIds.has(e.id)) return 0.95;
    return 0.05;
  }

  function edgeStroke(e: EdgeView): string {
    if (e.anomalous) return "var(--warn)";
    if (spotlight?.highlightedRelIds.has(e.id)) return "var(--text-1)";
    return "var(--edge-rel)";
  }

  function edgeStrokeWidth(e: EdgeView): number {
    if (spotlight?.highlightedRelIds.has(e.id)) return 1.8;
    return 1.0;
  }

  function edgeDash(e: EdgeView): string | undefined {
    if (e.rel.is_active) return undefined;
    return "3 4";
  }

  return (
    <div ref={containerRef} className="graph-container">
      <svg
        ref={svgRef}
        className="graph-svg bus-graph"
        width="100%"
        height="100%"
        role="img"
        aria-label="Model relationship graph (bus layout)"
      >
        <defs>
          <marker
            id="arrow-fact"
            viewBox="0 -5 10 10"
            refX={9}
            refY={0}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M 0,-5 L 10,0 L 0,5 Z" fill="var(--edge-rel)" />
          </marker>
          <marker
            id="arrow-fact-hot"
            viewBox="0 -5 10 10"
            refX={9}
            refY={0}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M 0,-5 L 10,0 L 0,5 Z" fill="var(--text-1)" />
          </marker>
          <marker
            id="arrow-anomaly"
            viewBox="0 -5 10 10"
            refX={9}
            refY={0}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M 0,-5 L 10,0 L 0,5 Z" fill="var(--warn)" />
          </marker>
          <marker
            id="arrow-direct"
            viewBox="0 -5 10 10"
            refX={9}
            refY={0}
            markerWidth={7}
            markerHeight={7}
            orient="auto"
          >
            <path d="M 0,-5 L 10,0 L 0,5 Z" fill="var(--accent)" />
          </marker>
        </defs>

        <g className="viewport">
          {/* Edges first so cards render on top */}
          <g className="edges">
            {layout.edges.map((e) => (
              <g
                key={e.id}
                className="edge"
                style={{ opacity: edgeOpacity(e) }}
              >
                <path
                  d={e.path}
                  fill="none"
                  stroke={edgeStroke(e)}
                  strokeWidth={edgeStrokeWidth(e)}
                  strokeDasharray={edgeDash(e)}
                  markerEnd={
                    e.anomalous
                      ? "url(#arrow-anomaly)"
                      : spotlight?.highlightedRelIds.has(e.id)
                        ? "url(#arrow-fact-hot)"
                        : "url(#arrow-fact)"
                  }
                />
                <CardinalityGlyph edge={e} kind="dim" />
                <CardinalityGlyph edge={e} kind="fact" />
              </g>
            ))}
          </g>

          {/* Spotlight: direct-ref edges from synthetic measure node */}
          {spotlight && (
            <g className="direct-edges">
              {spotlight.directEdges.map((e) => (
                <path
                  key={e.id}
                  d={e.path}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  markerEnd="url(#arrow-direct)"
                  opacity={0.85}
                />
              ))}
            </g>
          )}

          {/* Table cards */}
          <g className="nodes">
            {layout.nodes.map((n) => (
              <g
                key={n.id}
                className={`node node-${n.classification}`}
                style={{
                  // CSS transform (not SVG attribute) so the .bus-graph .node
                  // transition rule animates Pack-mode reshuffles smoothly.
                  transform: `translate(${n.position.x}px, ${n.position.y}px)`,
                  opacity: nodeOpacity(n),
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  selectTable(n.label);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  pinSelection();
                }}
                onMouseEnter={(e) => showTooltip(e, n)}
                onMouseMove={(e) => showTooltip(e, n)}
                onMouseLeave={hideTooltip}
              >
                <rect
                  x={-CARD_W / 2}
                  y={-CARD_H / 2}
                  width={CARD_W}
                  height={CARD_H}
                  rx={4}
                  className="card-rect"
                />
                <text
                  className="card-label"
                  x={0}
                  y={4}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {labelFor(n, view)}
                </text>
              </g>
            ))}
          </g>

          {/* Spotlight measure node */}
          {spotlight && (
            <g
              className="node node-measure"
              transform={`translate(${spotlight.measureNode.x}, ${spotlight.measureNode.y})`}
            >
              <rect
                x={-CARD_W / 2}
                y={-CARD_H / 2}
                width={CARD_W}
                height={CARD_H}
                rx={4}
                className="card-rect measure-rect"
              />
              <text
                className="card-label measure-label"
                x={0}
                y={4}
                textAnchor="middle"
                pointerEvents="none"
              >
                {spotlight.measureNode.label}
              </text>
              <text
                x={0}
                y={-CARD_H / 2 - 4}
                textAnchor="middle"
                className="zone-tag-measure"
              >
                MEASURE
              </text>
            </g>
          )}

          {/* Zone labels */}
          <ZoneLabel
            text="DIMENSIONS / TIME"
            x={DEFAULT_LAYOUT.originX + DEFAULT_LAYOUT.factToFirstDimGap - 30}
            y={DEFAULT_LAYOUT.originY - 36}
          />
          <ZoneLabel
            text="FACTS"
            x={DEFAULT_LAYOUT.originX - 50}
            y={DEFAULT_LAYOUT.originY + DEFAULT_LAYOUT.dimToFirstFactGap - 8}
            rotate={-90}
          />
        </g>
      </svg>
      <div ref={tooltipRef} className="graph-tooltip" />
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Sub-components
// --------------------------------------------------------------------------- //

function CardinalityGlyph({ edge, kind }: { edge: EdgeView; kind: "dim" | "fact" }) {
  const pos = cardinalityGlyphPosition(
    edge.source.position,
    edge.target.position,
    CARD_W,
    CARD_H,
    kind,
  );
  if (!pos) return null;
  // Determine which end is the dim (always shows "1") and which is the fact.
  const sourceIsDim = isDimZone(edge.source.classification);
  const sourceIsFact = isFactZone(edge.source.classification);
  let glyph = "";
  if (kind === "dim") {
    glyph = oneSideGlyph(edge.rel.cardinality, sourceIsDim);
  } else {
    glyph = manySideGlyph(edge.rel.cardinality, sourceIsFact);
  }
  return (
    <text
      x={pos.x}
      y={pos.y}
      className="card-glyph"
      pointerEvents="none"
    >
      {glyph}
    </text>
  );
}

function ZoneLabel({
  text,
  x,
  y,
  rotate = 0,
}: {
  text: string;
  x: number;
  y: number;
  rotate?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      className="zone-label"
      transform={rotate ? `rotate(${rotate}, ${x}, ${y})` : undefined}
      pointerEvents="none"
    >
      {text}
    </text>
  );
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

function labelFor(n: NodeView, view: "semantic" | "source"): string {
  if (view === "source" && n.sourceLabel) return n.sourceLabel;
  return n.label;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/** Glyph for the "one side" of a relationship. */
function oneSideGlyph(card: Cardinality, _sourceIsDim: boolean): string {
  if (card === "many_to_many") return "*";
  return "1";
}

/** Glyph for the "many side" of a relationship. */
function manySideGlyph(card: Cardinality, _sourceIsFact: boolean): string {
  if (card === "one_to_one") return "1";
  return "*";
}
