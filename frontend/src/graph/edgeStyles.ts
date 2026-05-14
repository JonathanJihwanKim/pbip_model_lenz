import type { Cardinality, Crossfilter } from "../api/types";

export type EdgeKind = "direct" | "relationship" | "userel";

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  dasharray?: string;
  markerEnd: "arrow" | "arrow-open" | "none";
  markerStart: "arrow" | "arrow-open" | "none";
  opacity: number;
}

export function styleForRelationship(opts: {
  isActive: boolean;
  crossfilter: Crossfilter;
  cardinality: Cardinality;
  highlighted: boolean;
  ambiguous: boolean;
  dimmed: boolean;
}): EdgeStyle {
  const { isActive, crossfilter, highlighted, ambiguous, dimmed } = opts;
  const stroke = ambiguous ? "#F59E0B" : highlighted ? "#94A3B8" : "var(--edge-rel)";
  const opacity = dimmed ? 0.08 : highlighted ? 0.95 : 0.35;
  const dasharray = isActive ? "5 4" : "2 4";
  return {
    stroke,
    strokeWidth: highlighted ? 1.8 : 1.0,
    dasharray,
    markerEnd: "arrow",
    markerStart: crossfilter === "both" ? "arrow" : "none",
    opacity,
  };
}

export function styleForDirect(opts: { dimmed: boolean }): EdgeStyle {
  return {
    stroke: "var(--edge-direct)",
    strokeWidth: 2,
    markerEnd: "none",
    markerStart: "none",
    opacity: opts.dimmed ? 0.08 : 0.95,
  };
}

export function cardinalityGlyph(c: Cardinality): string {
  switch (c) {
    case "many_to_one":
      return "*:1";
    case "one_to_many":
      return "1:*";
    case "one_to_one":
      return "1:1";
    case "many_to_many":
      return "*:*";
  }
}
