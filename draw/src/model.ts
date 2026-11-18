export const TOOLS = ["pen", "brush", "marker", "pencil", "eraser"] as const;
export type Tool = (typeof TOOLS)[number];

/** Floats per point in `Stroke.points`: x, y, pressure, tiltX, tiltY, twist, t. */
export const STRIDE = 7;

/** A colour is `#rrggbb`, or `ink`: black on light paper, near-white on dark. */
export type Color = string;

export interface Stroke {
  /** Unique and increasing across the drawing: the stroke's order within its layer. */
  seq: number;
  tool: Tool;
  color: Color;
  width: number;
  /** Document space, `STRIDE` numbers a point. */
  points: number[];
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  strokes: readonly Stroke[];
}

export const TOOL_INFO: Record<Tool, { name: string; key: string; widths: readonly [number, number, number] }> = {
  pen: { name: "Pen", key: "P", widths: [1.6, 3.2, 6.4] },
  brush: { name: "Brush", key: "B", widths: [8, 16, 30] },
  marker: { name: "Marker", key: "M", widths: [8, 16, 28] },
  pencil: { name: "Pencil", key: "N", widths: [1.8, 3.4, 6] },
  eraser: { name: "Eraser", key: "E", widths: [10, 24, 48] },
};

export const PAPER = { light: "#F7F5F0", dark: "#1C1C1E" } as const;
export const INK = { light: "#1C1C1E", dark: "#F2F2F4" } as const;

export const SWATCHES: readonly Color[] = ["ink", "#3B82F6", "#FF5A52", "#34C38F", "#FFB020", "#A06BFF"];

export function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

export function isColor(value: unknown): value is Color {
  return typeof value === "string" && (value === "ink" || /^#[0-9a-fA-F]{6}$/.test(value));
}
