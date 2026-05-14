import { useEffect, useMemo, useRef } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { drag as d3drag } from "d3-drag";
import { select } from "d3-selection";
import { zoom as d3zoom, type ZoomBehavior } from "d3-zoom";

import { useStore } from "../store";
import type { Classification, RelationshipItem } from "../api/types";
import { shapePath, styleFor } from "./nodeStyles";
import {
  cardinalityGlyph,
  styleForDirect,
  styleForRelationship,
  type EdgeStyle,
} from "./edgeStyles";

interface NodeDatum extends SimulationNodeDatum {
  id: string;
  label: string;
  sourceLabel: string | null;
  kind: "table" | "measure";
  classification: Classification | "measure";
}

interface LinkDatum extends SimulationLinkDatum<NodeDatum> {
  id: string;
  source: string | NodeDatum;
  target: string | NodeDatum;
  kind: "relationship" | "direct";
  rel?: RelationshipItem;
}

export function ForceGraph() {
  const tables = useStore((s) => s.tables);
  const relationships = useStore((s) => s.relationships);
  const view = useStore((s) => s.view);
  const classFilter = useStore((s) => s.classFilter);
  const selection = useStore((s) => s.selection);
  const measureGraph = useStore((s) => s.measureGraph);
  const selectTable = useStore((s) => s.selectTable);
  const pinSelection = useStore((s) => s.pinSelection);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 800, h: 600 });
  const simRef = useRef<Simulation<NodeDatum, LinkDatum> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Build the persistent table-only graph; the measure node (if any) is
  // added via a separate update path so the layout doesn't reset on click.
  const baseData = useMemo(() => {
    const tableLookup = new Map(tables.map((t) => [t.name, t]));
    const visibleTables = tables.filter((t) => classFilter.has(t.classification));
    const visibleSet = new Set(visibleTables.map((t) => t.name));

    const nodes: NodeDatum[] = visibleTables.map((t) => ({
      id: `t:${t.name}`,
      label: t.name,
      sourceLabel: t.source_table,
      kind: "table",
      classification: t.classification,
    }));

    const links: LinkDatum[] = relationships
      .filter(
        (r) =>
          visibleSet.has(r.from_table) &&
          visibleSet.has(r.to_table) &&
          tableLookup.has(r.from_table) &&
          tableLookup.has(r.to_table),
      )
      .map((r) => ({
        id: `r:${r.id}`,
        source: `t:${r.from_table}`,
        target: `t:${r.to_table}`,
        kind: "relationship",
        rel: r,
      }));

    return { nodes, links };
  }, [tables, relationships, classFilter]);

  // ResizeObserver for the container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      sizeRef.current = { w: r.width, h: r.height };
      simRef.current?.force("center", forceCenter(r.width / 2, r.height / 2));
      simRef.current?.alpha(0.3).restart();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build / rebuild the simulation when the base data changes.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const { w, h } = sizeRef.current;

    // Tear down previous handlers.
    select(svg).selectAll("*").remove();

    const defs = select(svg).append("defs");
    arrowMarker(defs, "arrow", "var(--edge-rel)");
    arrowMarker(defs, "arrow-amber", "#F59E0B");
    arrowMarker(defs, "arrow-bidi-start", "var(--edge-rel)");
    arrowMarker(defs, "arrow-direct", "var(--edge-direct)");

    const root = select(svg).append("g").attr("class", "viewport");
    const linkGroup = root.append("g").attr("class", "links");
    const nodeGroup = root.append("g").attr("class", "nodes");

    const z: ZoomBehavior<SVGSVGElement, unknown> = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on("zoom", (e) => root.attr("transform", e.transform.toString()));
    select(svg).call(z);

    const nodes = baseData.nodes.map((n) => ({ ...n }));
    const links = baseData.links.map((l) => ({ ...l }));

    const sim = forceSimulation<NodeDatum>(nodes)
      .force(
        "link",
        forceLink<NodeDatum, LinkDatum>(links)
          .id((d) => d.id)
          .distance((d) => (d.kind === "direct" ? 90 : 110))
          .strength(0.5),
      )
      .force("charge", forceManyBody<NodeDatum>().strength(-260))
      .force("center", forceCenter(w / 2, h / 2))
      .force(
        "collide",
        forceCollide<NodeDatum>((d) => styleFor(d.classification).size + 12),
      )
      .alphaDecay(0.04);

    simRef.current = sim;

    // Render link & node selections.
    const linkSel = linkGroup
      .selectAll<SVGGElement, LinkDatum>("g.link")
      .data(links, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").attr("class", "link");
        g.append("line").attr("class", "edge");
        g.append("text")
          .attr("class", "edge-label")
          .attr("text-anchor", "middle")
          .attr("dy", -3);
        return g;
      });

    const nodeSel = nodeGroup
      .selectAll<SVGGElement, NodeDatum>("g.node")
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").attr("class", "node").style("cursor", "pointer");
        g.each(function (d) {
          const style = styleFor(d.classification);
          if (style.shape === "circle") {
            select(this)
              .append("circle")
              .attr("r", style.size)
              .attr("fill", style.fill)
              .attr("stroke", style.stroke)
              .attr("stroke-width", 1.5);
          } else {
            select(this)
              .append("path")
              .attr("d", shapePath(style))
              .attr("fill", style.fill)
              .attr("stroke", style.stroke)
              .attr("stroke-width", 1.5);
          }
        });
        g.append("text")
          .attr("class", "node-label")
          .attr("text-anchor", "middle")
          .attr("dy", (d) => styleFor(d.classification).size + 14)
          .attr("font-size", 11)
          .attr("fill", "var(--text-1)")
          .attr("pointer-events", "none");
        return g;
      });

    nodeSel
      .on("click", (e: MouseEvent, d) => {
        e.stopPropagation();
        if (d.kind === "table") selectTable(d.label);
      })
      .on("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        pinSelection();
      })
      .on("mouseenter", (e: MouseEvent, d) => {
        showTooltip(tooltipRef.current, e, d);
      })
      .on("mousemove", (e: MouseEvent, d) => {
        showTooltip(tooltipRef.current, e, d);
      })
      .on("mouseleave", () => hideTooltip(tooltipRef.current))
      .call(
        d3drag<SVGGElement, NodeDatum>()
          .on("start", (event, d) => {
            if (!event.active) sim.alphaTarget(0.2).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    sim.on("tick", () => {
      linkSel
        .select("line")
        .attr("x1", (d) => (d.source as NodeDatum).x ?? 0)
        .attr("y1", (d) => (d.source as NodeDatum).y ?? 0)
        .attr("x2", (d) => (d.target as NodeDatum).x ?? 0)
        .attr("y2", (d) => (d.target as NodeDatum).y ?? 0);
      linkSel
        .select("text")
        .attr("x", (d) => (((d.source as NodeDatum).x ?? 0) + ((d.target as NodeDatum).x ?? 0)) / 2)
        .attr("y", (d) => (((d.source as NodeDatum).y ?? 0) + ((d.target as NodeDatum).y ?? 0)) / 2);
      nodeSel.attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
    });

    select(svg).on("click", () => {
      // background click — leave selection alone, just hide tooltip
      hideTooltip(tooltipRef.current);
    });

    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [baseData, selectTable, pinSelection]);

  // Update node labels when view mode changes.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    select(svg)
      .selectAll<SVGTextElement, NodeDatum>("text.node-label")
      .text((d) => labelFor(d, view));
  }, [view, baseData]);

  // Highlight edges & nodes when a measure (or its graph) changes.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    applyHighlight(svg, selection, measureGraph);
  }, [selection, measureGraph, baseData]);

  return (
    <div ref={containerRef} className="graph-container">
      <svg
        ref={svgRef}
        className="graph-svg"
        width="100%"
        height="100%"
        role="img"
        aria-label="Model relationship graph"
      />
      <div ref={tooltipRef} className="graph-tooltip" />
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

function labelFor(d: NodeDatum, view: "semantic" | "source"): string {
  if (d.kind === "measure") return d.label;
  if (view === "source" && d.sourceLabel) return d.sourceLabel;
  return d.label;
}

function arrowMarker(defs: any, id: string, color: string) {
  defs
    .append("marker")
    .attr("id", id)
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 18)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M 0,-5 L 10,0 L 0,5 Z")
    .attr("fill", color);
}

function showTooltip(el: HTMLDivElement | null, e: MouseEvent, d: NodeDatum) {
  if (!el) return;
  const semantic = d.label;
  const source = d.sourceLabel;
  el.innerHTML = `
    <div class="tt-name">${escape(semantic)}</div>
    ${source ? `<div class="tt-source">${escape(source)}</div>` : ""}
    <div class="tt-class">${d.classification}</div>
  `;
  el.style.opacity = "1";
  el.style.left = `${e.clientX + 14}px`;
  el.style.top = `${e.clientY + 14}px`;
}

function hideTooltip(el: HTMLDivElement | null) {
  if (!el) return;
  el.style.opacity = "0";
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function applyHighlight(
  svg: SVGSVGElement,
  selection: ReturnType<typeof useStore.getState>["selection"],
  measureGraph: ReturnType<typeof useStore.getState>["measureGraph"],
) {
  const sel = select(svg);
  const noSelection = !selection;

  if (noSelection) {
    sel
      .selectAll<SVGGElement, NodeDatum>("g.node")
      .style("opacity", 1);
    sel
      .selectAll<SVGGElement, LinkDatum>("g.link")
      .each(function (d) {
        const g = select(this);
        const style = stylize(d, false, false, false);
        applyEdgeStyle(g, style, d);
      });
    return;
  }

  if (selection?.kind === "table") {
    const focusId = `t:${selection.name}`;
    sel
      .selectAll<SVGGElement, NodeDatum>("g.node")
      .style("opacity", (n) => (n.id === focusId ? 1 : 0.25));
    sel
      .selectAll<SVGGElement, LinkDatum>("g.link")
      .each(function (d) {
        const touches =
          (d.source as NodeDatum).id === focusId || (d.target as NodeDatum).id === focusId;
        const style = stylize(d, touches, false, !touches);
        applyEdgeStyle(select(this), style, d);
      });
    return;
  }

  // Measure selection: highlight direct + indirect tables, dim the rest.
  if (selection?.kind === "measure") {
    if (!measureGraph) {
      // Loading — dim all subtly.
      sel
        .selectAll<SVGGElement, NodeDatum>("g.node")
        .style("opacity", 0.5);
      sel
        .selectAll<SVGGElement, LinkDatum>("g.link")
        .each(function (d) {
          const style = stylize(d, false, false, true);
          applyEdgeStyle(select(this), style, d);
        });
      return;
    }
    const direct = new Set(measureGraph.direct_tables.map((t) => `t:${t}`));
    const indirect = new Set(measureGraph.indirect_tables.map((t) => `t:${t.table}`));
    const indirectAmbiguous = new Set(
      measureGraph.indirect_tables.filter((t) => t.ambiguous).map((t) => `t:${t.table}`),
    );
    const highlightedRels = new Set<string>();
    for (const it of measureGraph.indirect_tables) {
      for (const path of it.paths) {
        for (const hop of path.hops) {
          highlightedRels.add(`r:${hop.relationship_id}`);
        }
      }
    }

    sel
      .selectAll<SVGGElement, NodeDatum>("g.node")
      .style("opacity", (n) =>
        direct.has(n.id) || indirect.has(n.id) ? 1 : 0.18,
      );

    sel
      .selectAll<SVGGElement, LinkDatum>("g.link")
      .each(function (d) {
        const isHighlighted = highlightedRels.has(d.id);
        const sourceId = (d.source as NodeDatum).id;
        const targetId = (d.target as NodeDatum).id;
        const ambiguous =
          isHighlighted &&
          (indirectAmbiguous.has(sourceId) || indirectAmbiguous.has(targetId));
        const style = stylize(d, isHighlighted, ambiguous, !isHighlighted);
        applyEdgeStyle(select(this), style, d);
      });
  }
}

function stylize(
  d: LinkDatum,
  highlighted: boolean,
  ambiguous: boolean,
  dimmed: boolean,
): EdgeStyle {
  if (d.kind === "direct") {
    return styleForDirect({ dimmed });
  }
  return styleForRelationship({
    isActive: d.rel?.is_active ?? true,
    crossfilter: d.rel?.crossfilter ?? "single",
    cardinality: d.rel?.cardinality ?? "many_to_one",
    highlighted,
    ambiguous,
    dimmed,
  });
}

function applyEdgeStyle(g: any, style: EdgeStyle, d: LinkDatum) {
  const line = g.select("line");
  line
    .attr("stroke", style.stroke)
    .attr("stroke-width", style.strokeWidth)
    .attr("stroke-dasharray", style.dasharray ?? null)
    .attr("opacity", style.opacity)
    .attr(
      "marker-end",
      style.markerEnd === "none"
        ? null
        : style.stroke.includes("F59E0B")
          ? "url(#arrow-amber)"
          : style.markerEnd === "arrow"
            ? "url(#arrow)"
            : null,
    )
    .attr(
      "marker-start",
      style.markerStart === "none"
        ? null
        : style.stroke.includes("F59E0B")
          ? "url(#arrow-amber)"
          : "url(#arrow-bidi-start)",
    );

  // Cardinality glyph for highlighted relationship edges only.
  const text = g.select("text");
  if (d.kind === "relationship" && style.opacity > 0.5 && d.rel) {
    text
      .text(cardinalityGlyph(d.rel.cardinality))
      .attr("fill", "var(--text-2)")
      .attr("opacity", 0.9)
      .attr("font-size", 9);
  } else {
    text.text("").attr("opacity", 0);
  }
}
