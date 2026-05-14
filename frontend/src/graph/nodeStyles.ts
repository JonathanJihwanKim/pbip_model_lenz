import type { Classification } from "../api/types";

export interface NodeStyle {
  fill: string;
  stroke: string;
  shape: "circle" | "hexagon" | "rounded-rect" | "diamond" | "stacked-rect";
  size: number; // radius for circle, half-side for diamond, half-width for rect
}

const PALETTE: Record<Classification | "measure", NodeStyle> = {
  measure: { fill: "#7C5CFF", stroke: "#3D2FB8", shape: "rounded-rect", size: 22 },
  fact: { fill: "#1F6FEB", stroke: "#0B3A8A", shape: "hexagon", size: 18 },
  dim: { fill: "#3FB68B", stroke: "#1F6E55", shape: "circle", size: 14 },
  parameter: { fill: "#A0A4AB", stroke: "#5C6068", shape: "diamond", size: 9 },
  time: { fill: "#E1A938", stroke: "#8E681D", shape: "circle", size: 14 },
  calculation_group: { fill: "#D44C7B", stroke: "#7B274B", shape: "stacked-rect", size: 16 },
  other: { fill: "#94A3B8", stroke: "#475569", shape: "circle", size: 12 },
};

export function styleFor(kind: Classification | "measure"): NodeStyle {
  return PALETTE[kind] ?? PALETTE.other;
}

/** SVG path string centered at origin for a given style. */
export function shapePath(style: NodeStyle): string {
  const s = style.size;
  switch (style.shape) {
    case "circle":
      return ""; // rendered as <circle> — caller decides
    case "hexagon": {
      const a = s;
      const b = s * 0.866; // sqrt(3)/2
      return `M ${-a} 0 L ${-a / 2} ${-b} L ${a / 2} ${-b} L ${a} 0 L ${a / 2} ${b} L ${-a / 2} ${b} Z`;
    }
    case "rounded-rect": {
      const w = s * 1.6;
      const h = s * 0.95;
      const r = 6;
      return `M ${-w + r} ${-h} H ${w - r} A ${r} ${r} 0 0 1 ${w} ${-h + r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${-w + r} A ${r} ${r} 0 0 1 ${-w} ${h - r} V ${-h + r} A ${r} ${r} 0 0 1 ${-w + r} ${-h} Z`;
    }
    case "diamond":
      return `M 0 ${-s} L ${s} 0 L 0 ${s} L ${-s} 0 Z`;
    case "stacked-rect": {
      const w = s;
      const h = s * 0.7;
      return `M ${-w} ${-h - 4} h ${2 * w} v ${2 * h - 2} h ${-2 * w} Z M ${-w + 2} ${h - 1} h ${2 * w - 4} v 4 h ${-(2 * w - 4)} Z`;
    }
  }
}
